"""AI campaign planner — chunked generation for large target_lines.

UI-facing only: goal + speakers + market + counts. No craft rules / retries.
"""

from __future__ import annotations

import json
import re
from typing import Any

from ...schemas.campaign import (
    MAX_CAMPAIGN_LINES,
    CampaignPlan,
    CampaignPlanLine,
    CampaignPlanRequest,
)
from ..ai.llm import generate_chat_text, is_ai_configured
from .normalize import fit_timeline_to_duration, parse_plan_dict, sanitize_plan_replies
from .prompts import (
    CONTINUATION_SYSTEM_PROMPT,
    SYSTEM_PROMPT,
    build_continuation_prompt,
    build_user_prompt,
)

CHUNK_SIZE = 40
_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)


def chunk_size_for_target(total: int) -> int:
    t = max(1, int(total))
    if t >= 120:
        return 25
    if t >= 80:
        return 30
    if t >= 50:
        return 35
    return CHUNK_SIZE


def build_speaker_cards(speakers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map UI speaker rows → LLM cards (never include phone)."""
    cards: list[dict[str, Any]] = []
    for item in speakers:
        if not isinstance(item, dict):
            continue
        sid = str(item.get("id") or "").strip()
        if not sid:
            continue
        role = str(item.get("role") or "member").strip().lower()
        assets_raw = item.get("preferred_assets") or item.get("favorite_assets") or []
        assets: list[str] = []
        if isinstance(assets_raw, list):
            for a in assets_raw[:6]:
                s = str(a or "").strip()
                if s and s not in assets:
                    assets.append(s[:24])
        card: dict[str, Any] = {
            "id": sid,
            "role": role,
            "label": str(item.get("label") or "")[:40],
            "persona": str(item.get("label") or role),
            "style": str(item.get("message_style") or item.get("style") or ""),
            "tics": str(item.get("emoji_habit") or "")[:40],
            "avoid": "",
        }
        if item.get("activity"):
            card["activity"] = str(item["activity"])[:16]
        if item.get("message_style") or item.get("style"):
            card["message_style"] = str(
                item.get("message_style") or item.get("style") or ""
            )[:16]
        if item.get("sentiment"):
            card["sentiment"] = str(item["sentiment"])[:16]
        if assets:
            card["preferred_assets"] = assets
        if item.get("can_open") is not None:
            card["can_open"] = bool(item.get("can_open"))
        cards.append(card)
    return cards


def _extract_json_object(text: str) -> dict[str, Any]:
    cleaned = (text or "").strip()
    m = _JSON_FENCE_RE.search(cleaned)
    if m:
        cleaned = m.group(1).strip()
    try:
        data = json.loads(cleaned)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        data = json.loads(cleaned[start : end + 1])
        if isinstance(data, dict):
            return data
    raise ValueError("Khong parse duoc JSON plan tu model")


def _tokens_for_chunk(chunk_lines: int) -> int:
    return max(6000, min(16_000, int(chunk_lines) * 160 + 1500))


def _chunk_sizes(total: int, size: int = CHUNK_SIZE) -> list[int]:
    sizes: list[int] = []
    left = total
    while left > 0:
        n = min(size, left)
        sizes.append(n)
        left -= n
    return sizes


async def _call_llm(
    *,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    model: str | None = None,
) -> dict[str, Any]:
    raw_text = await generate_chat_text(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=0.8,
        max_output_tokens=max_tokens,
        model=model,
    )
    return _extract_json_object(raw_text)


def _parse_lines_only(raw: dict[str, Any], *, fallback_duration: int) -> CampaignPlan:
    if "lines" not in raw:
        raise ValueError("Chunk JSON thieu lines")
    if "duration_min" not in raw:
        raw = {
            **raw,
            "duration_min": fallback_duration,
            "title": raw.get("title") or "Campaign",
        }
    if "title" not in raw:
        raw = {**raw, "title": "Campaign"}
    return parse_plan_dict(raw)


def _merge_chunk_lines(
    existing: list[CampaignPlanLine],
    chunk: list[CampaignPlanLine],
) -> list[CampaignPlanLine]:
    """Merge batch lines; preserve AI at_sec spacing (no algorithmic rewrite).

    Continuation batches usually restart at_sec near 0 — shift so the chunk
    continues after the last existing timestamp while keeping relative gaps.
    """
    offset = len(existing)
    merged = list(existing)

    t_shift = 0
    if existing and chunk:
        gap = 4 if chunk[0].speaker_id == existing[-1].speaker_id else 8
        # If model already continues absolute timeline, keep it.
        if chunk[0].at_sec >= existing[-1].at_sec + gap:
            t_shift = 0
        else:
            t_shift = existing[-1].at_sec + gap - int(chunk[0].at_sec or 0)

    for i, line in enumerate(chunk):
        reply = line.reply_to_line
        action = line.action
        new_reply: int | None = None
        if action == "reply":
            if reply is not None and 1 <= int(reply) <= i:
                new_reply = offset + int(reply)
            elif i > 0:
                new_reply = offset + i
            elif offset > 0:
                new_reply = offset
            else:
                action = "send"
                new_reply = None

        at_sec = max(0, int(line.at_sec or 0) + t_shift)
        if merged:
            min_gap = 2 if line.speaker_id == merged[-1].speaker_id else 3
            at_sec = max(at_sec, merged[-1].at_sec + min_gap)

        merged.append(
            line.model_copy(
                update={
                    "action": action,  # type: ignore[arg-type]
                    "reply_to_line": new_reply,
                    "at_sec": at_sec,
                }
            )
        )
    return sanitize_plan_replies(merged)


def _tail_for_prompt(lines: list[CampaignPlanLine], n: int = 18) -> list[dict[str, str]]:
    tail = lines[-n:] if lines else []
    return [
        {
            "speaker_id": line.speaker_id,
            "text": line.text[:120],
            "action": line.action,
        }
        for line in tail
    ]


async def _generate_chunk(
    base_payload: dict[str, Any],
    *,
    need_lines: int,
    batch_index: int,
    total_batches: int,
    previous_lines: list[CampaignPlanLine],
    is_first: bool,
) -> CampaignPlan:
    speakers_raw = [
        s for s in (base_payload.get("speakers") or []) if isinstance(s, dict)
    ]
    speakers_for_llm = [
        {k: v for k, v in s.items() if k != "phone"} for s in speakers_raw
    ]
    speaker_cards = build_speaker_cards(speakers_for_llm)
    global_target = int(base_payload.get("global_target") or need_lines)
    duration_min = int(base_payload.get("duration_min") or 20)
    span = max(60, duration_min * 60)
    # Hint each batch which slice of the global timeline it should cover
    if total_batches <= 1:
        window_start, window_end = 0, span
    else:
        window_start = int(round((batch_index - 1) * span / total_batches))
        window_end = int(round(batch_index * span / total_batches))
    payload = {
        **base_payload,
        "target_lines": need_lines,
        "batch": {
            "index": batch_index,
            "total_batches": total_batches,
            "already_have": len(previous_lines),
            "global_target": global_target,
            "is_continuation": not is_first,
            "at_sec_window": {
                "start": window_start,
                "end": window_end,
                "global_end": span,
            },
        },
        "previous_tail": _tail_for_prompt(previous_lines, n=22),
        "speaker_cards": speaker_cards,
    }
    max_tokens = _tokens_for_chunk(need_lines)

    if is_first:
        system = SYSTEM_PROMPT
        user = build_user_prompt(payload)
    else:
        system = CONTINUATION_SYSTEM_PROMPT
        user = build_continuation_prompt(payload)

    model = base_payload.get("model")
    raw = await _call_llm(
        system_prompt=system,
        user_prompt=user,
        max_tokens=max_tokens,
        model=model if isinstance(model, str) else None,
    )
    plan = _parse_lines_only(
        raw, fallback_duration=int(base_payload.get("duration_min") or 20)
    )
    if len(plan.lines) > need_lines:
        plan = plan.model_copy(update={"lines": plan.lines[:need_lines]})
    return plan


async def plan_campaign(
    request: CampaignPlanRequest,
) -> tuple[CampaignPlan, dict[str, Any] | None]:
    """Returns (plan, market_context_dict_or_none)."""
    if not is_ai_configured():
        raise ValueError(
            "AI chua cau hinh — dat AI_ENABLED=true va OPENAI_API_KEY trong backend/.env"
        )

    speakers = [item.model_dump() for item in request.speakers]
    target_lines = request.target_lines
    if target_lines is None:
        sec = {"light": 70, "normal": 55, "dense": 40}.get(request.density, 55)
        target_lines = max(
            4, min(MAX_CAMPAIGN_LINES, round((request.duration_min * 60) / sec) + 1)
        )
    target_lines = max(4, min(MAX_CAMPAIGN_LINES, int(target_lines)))

    market_ctx: dict[str, Any] | None = None
    market_brief = ""
    selected_news = [
        t.strip() for t in (request.selected_news or []) if t and str(t).strip()
    ]
    must_discuss_news = [
        t.strip() for t in (request.must_discuss_news or []) if t and str(t).strip()
    ]
    for title in must_discuss_news:
        if title not in selected_news:
            selected_news.append(title)
    news_keywords = [
        t.strip() for t in (request.news_keywords or []) if t and str(t).strip()
    ]
    topic_bullets = [
        t.strip() for t in (request.topic_bullets or []) if t and str(t).strip()
    ]

    if request.use_market_context:
        try:
            from ..market import fetch_crypto_snapshot, format_market_brief

            snap = await fetch_crypto_snapshot(use_cache=True)
            market_brief = format_market_brief(
                snap,
                selected_news=selected_news if request.selected_news is not None else None,
                must_discuss_news=must_discuss_news or None,
                news_keywords=news_keywords or None,
            )
            if topic_bullets:
                market_brief += "\n\nEXTRA TOPIC BULLETS (from user):\n" + "\n".join(
                    f"- {t}" for t in topic_bullets[:20]
                )
            market_ctx = {
                **snap.to_dict(),
                "brief": market_brief,
                "selected_news": selected_news,
                "must_discuss_news": must_discuss_news,
                "ok": True,
                "error": None,
            }
        except Exception as exc:
            market_ctx = {
                "fetched_at": "",
                "source": "coingecko_simple_price",
                "coins": [],
                "notes": [],
                "news": [],
                "news_source": "",
                "news_error": None,
                "gainers": [],
                "losers": [],
                "movers_source": "",
                "movers_error": None,
                "selected_news": selected_news,
                "must_discuss_news": must_discuss_news,
                "brief": "",
                "ok": False,
                "error": str(exc),
            }
            if selected_news or must_discuss_news or topic_bullets:
                bits = ["USER-SELECTED TOPICS (prices unavailable):"]
                if must_discuss_news:
                    bits.append("MUST-DISCUSS:")
                    for t in must_discuss_news[:12]:
                        bits.append(f"- {t}")
                for t in (selected_news or topic_bullets)[:20]:
                    if t not in must_discuss_news:
                        bits.append(f"- {t}")
                market_brief = "\n".join(bits)

    model_override = (request.model or "").strip() or None
    opening_ids = [
        str(s.get("id") or "")
        for s in speakers
        if isinstance(s, dict) and s.get("can_open") is True
    ]
    # Cap selected news by max_news_topics for the prompt
    max_news = int(getattr(request, "max_news_topics", 2) or 2)
    selected_for_prompt = selected_news[: max(0, max_news)]
    must_for_prompt = must_discuss_news[: max(0, max_news)]

    base_payload: dict[str, Any] = {
        "goal": request.goal.strip(),
        "duration_min": request.duration_min,
        "density": request.density,
        "language": request.language,
        "group_link": request.group_link,
        "peer_id": request.peer_id,
        "topic_bullets": topic_bullets,
        "selected_news": selected_for_prompt,
        "must_discuss_news": must_for_prompt,
        "news_keywords": news_keywords,
        "speakers": speakers,
        "market_brief": market_brief,
        "global_target": target_lines,
        "model": model_override,
        "market_intensity": getattr(request, "market_intensity", None) or "medium",
        "numeric_detail": getattr(request, "numeric_detail", None) or "approx",
        "max_news_topics": max_news,
        "opening_speaker_ids": opening_ids,
        "message_length_preset": getattr(request, "message_length_preset", None)
        or "mostly_short",
        "message_length_short_pct": getattr(request, "message_length_short_pct", None),
        "message_length_medium_pct": getattr(
            request, "message_length_medium_pct", None
        ),
        "message_length_long_pct": getattr(request, "message_length_long_pct", None),
        "speaker_order": getattr(request, "speaker_order", None) or "natural",
        "max_consecutive_same_speaker": int(
            getattr(request, "max_consecutive_same_speaker", None) or 3
        ),
        "chat_style": getattr(request, "chat_style", None) or "messy",
        "allow_typos": bool(getattr(request, "allow_typos", False)),
        "allow_acks": bool(getattr(request, "allow_acks", True)),
        "allow_filler": bool(getattr(request, "allow_filler", False)),
        "split_bubbles": getattr(request, "split_bubbles", None) or "often",
        "split_continue_pct": getattr(request, "split_continue_pct", None),
        "reply_rate": getattr(request, "reply_rate", None),
        "target_lines": target_lines,
    }

    csize = chunk_size_for_target(target_lines)
    sizes = _chunk_sizes(target_lines, csize)
    all_lines: list[CampaignPlanLine] = []
    title = "Campaign"
    duration = request.duration_min

    for batch_index, need in enumerate(sizes, start=1):
        chunk = await _generate_chunk(
            base_payload,
            need_lines=need,
            batch_index=batch_index,
            total_batches=len(sizes),
            previous_lines=all_lines,
            is_first=batch_index == 1,
        )
        if batch_index == 1 and chunk.title:
            title = chunk.title
        if chunk.duration_min:
            duration = chunk.duration_min
        all_lines = _merge_chunk_lines(all_lines, chunk.lines)

    # Keep relative AI spacing, but stretch/compress to the requested duration
    # (models often only schedule ~2–5 min for a 20–60 min goal).
    plan = CampaignPlan(
        title=title,
        duration_min=request.duration_min or duration,
        lines=all_lines,
    )
    plan = fit_timeline_to_duration(plan, request.duration_min)
    return plan, market_ctx
