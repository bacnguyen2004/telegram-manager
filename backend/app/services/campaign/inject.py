"""Live-inject a short multi-account burst into a running conversation job."""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Any

from ...schemas.campaign import CampaignInjectRequest, CampaignPlanLine
from ...schemas.conversation import ConversationLineInput
from ..ai.llm import generate_chat_text, is_ai_configured
from ..conversation.store import conversation_job_store
from .normalize import parse_plan_dict

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)

INJECT_SYSTEM = """You continue an ongoing Telegram group chat with a short burst.

Return ONLY valid JSON:
{
  "lines": [
    {
      "at_sec": <int, non-decreasing from 0>,
      "speaker_id": "<one id from cast>",
      "action": "send" | "reply",
      "text": "one Telegram message bubble",
      "reply_to_line": <1-based earlier line in THIS burst, or null>
    }
  ]
}

Technical contract:
- lines.length must equal line_count exactly.
- Use only speaker_id values from cast.
- action="reply" must point to an earlier line in this burst.
- action="send" must use reply_to_line=null.
- No markdown, links, cast labels, or phone numbers inside text.

Intent:
This is not a new campaign and not a report. It is a small interruption in a
live chat: someone notices a price/news angle, another person reacts, and the
conversation keeps moving. Match recent_messages in language, tone, and energy.

Good burst qualities:
- Phone-chat length mix: include 1–2 word reactions (Yep, Same, Pain, Hard pass)
  among 3–8 word lines; almost never >12 words. Do not pad every line.
- "Fair, but…" / Same / Lol are fine occasionally — just don't spam one shape.
- Human mess ok: lol, idk, wait, nvm in moderation.
- One or two lines can be replies if they clearly answer the previous line.
- Selected news is paraphrased as casual context, not pasted as a headline.
- Live prices are used only as casual reference — do not restate the same level spam.
- No intro, no closing summary, no analyst voice.
"""


def _extract_json(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    fence = _JSON_FENCE_RE.search(cleaned)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        data = json.loads(cleaned)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        data = json.loads(cleaned[start : end + 1])
        if isinstance(data, dict):
            return data
    raise ValueError("Khong parse duoc JSON inject tu model")


def _language_hint(recent_messages: list[dict[str, str]]) -> str:
    text = " ".join(item.get("text", "") for item in recent_messages[-6:])
    decomposed = unicodedata.normalize("NFD", text)
    has_diacritic = any(unicodedata.category(ch) == "Mn" for ch in decomposed)
    has_vietnamese_d = "\u0111" in text.lower()
    if has_diacritic or has_vietnamese_d:
        return "Vietnamese"
    if text.strip():
        return "English"
    return "Infer from angle/selected news, but use one language only"


async def inject_into_job(job_id: int, payload: CampaignInjectRequest) -> dict[str, Any]:
    if not is_ai_configured():
        raise ValueError(
            "AI chua cau hinh - dat AI_ENABLED=true va OPENAI_API_KEY trong backend/.env"
        )

    job = conversation_job_store.get(job_id)
    if job is None:
        raise LookupError("Khong tim thay job")
    if job.status not in ("running", "pending"):
        raise ValueError(f"Job khong dang chay (status={job.status})")

    script = conversation_job_store.load_script(job)
    if not script.speakers:
        raise ValueError("Job khong co speakers")

    line_count = max(2, min(5, int(payload.line_count)))
    selected = [t.strip() for t in (payload.selected_news or []) if t and str(t).strip()]
    angle = (payload.angle or "").strip()

    market_brief = ""
    if payload.use_live_price or selected:
        try:
            from ..market import fetch_crypto_snapshot, format_market_brief

            snap = await fetch_crypto_snapshot(use_cache=True)
            market_brief = format_market_brief(
                snap,
                selected_news=selected if selected else ([] if payload.use_live_price else None),
            )
        except Exception as exc:
            market_brief = f"Prices unavailable: {exc}"

    results = conversation_job_store.get_line_results(job_id)
    success_ids = {r.line_id for r in results if r.status == "success"}
    recent_texts: list[dict[str, str]] = []
    for line in sorted(script.lines, key=lambda x: x.id):
        if line.id in success_ids:
            recent_texts.append({"speaker_id": line.speaker_id, "text": line.text[:200]})
    recent_texts = recent_texts[-12:]

    cast = [{"id": s.id, "label": s.label, "phone": s.phone} for s in script.speakers]

    user_body = {
        "line_count": line_count,
        "language_hint": _language_hint(recent_texts),
        "angle": angle or None,
        "selected_news": selected,
        "cast": cast,
        "recent_messages": recent_texts,
        "style": {
            "shape": "small continuation of existing phone chat",
            "reply_count": "0-1 replies for 2 lines, 1-2 replies for 3-5 lines",
            "quality": "sounds sendable by normal friends, not polished analysis",
        },
    }
    user_prompt = (
        "Inject a short chat burst as JSON only.\n\n"
        f"{json.dumps(user_body, ensure_ascii=False, indent=2)}\n\n"
    )
    if market_brief:
        user_prompt += (
            "=== LIVE MARKET FACTS ===\n"
            f"{market_brief}\n"
            "Use as casual material only. Do not paste titles.\n"
            "=== END LIVE MARKET FACTS ===\n"
        )
    user_prompt += (
        "\nQUALITY RUBRIC:\n"
        f"- Exactly {line_count} lines.\n"
        "- Same language as recent_messages.\n"
        "- Every line is short and sendable by a normal person.\n"
        "- The burst continues the nearby context instead of restarting.\n"
        "- News/price is conversational material, not a report.\n"
        f"\nREQUIRED JSON: lines.length === {line_count}.\n"
    )

    model_override = (payload.model or "").strip() or None
    raw = await generate_chat_text(
        system_prompt=INJECT_SYSTEM,
        user_prompt=user_prompt,
        max_output_tokens=max(1200, line_count * 220),
        temperature=0.82,
        model=model_override,
    )
    data = _extract_json(raw)
    plan = parse_plan_dict(
        {
            "title": "inject",
            "duration_min": 5,
            "lines": data.get("lines") or [],
        }
    )
    if len(plan.lines) < 2:
        raise ValueError("AI inject tra qua it dong")

    plan_lines = plan.lines[:line_count]
    max_id = max((ln.id for ln in script.lines), default=0)
    # Anchor inject burst after the latest scheduled line (or +5s after last at_sec)
    last_at = 0
    for ln in script.lines:
        if ln.at_sec is not None:
            last_at = max(last_at, int(ln.at_sec))
    burst_base = last_at + 5
    valid_speakers = {s.id for s in script.speakers}
    new_conv_lines: list[ConversationLineInput] = []
    plan_out: list[CampaignPlanLine] = []

    for i, pl in enumerate(plan_lines):
        sid = (
            pl.speaker_id
            if pl.speaker_id in valid_speakers
            else script.speakers[i % len(script.speakers)].id
        )
        new_id = max_id + 1 + i
        reply_to = None
        if pl.action == "reply" and pl.reply_to_line:
            local = int(pl.reply_to_line)
            if 1 <= local <= i:
                reply_to = max_id + local
        # Map burst-local at_sec onto absolute job timeline
        local_at = max(0, int(pl.at_sec or 0))
        abs_at = burst_base + local_at
        if i > 0:
            prev_abs = new_conv_lines[-1].at_sec or burst_base
            abs_at = max(abs_at, int(prev_abs) + 2)
        new_conv_lines.append(
            ConversationLineInput(
                id=new_id,
                script_ref=new_id,
                speaker_id=sid,
                text=pl.text.strip()[:4096],
                reply_to=reply_to,
                at_sec=abs_at,
            )
        )
        plan_out.append(
            CampaignPlanLine(
                at_sec=pl.at_sec,
                speaker_id=sid,
                action=pl.action if pl.action in ("send", "reply") else "send",
                text=pl.text.strip()[:4096],
                reply_to_line=pl.reply_to_line if pl.action == "reply" else None,
            )
        )

    updated = conversation_job_store.append_lines(job_id, new_conv_lines)
    if updated is None:
        raise ValueError("Khong append duoc line (job co the da ket thuc)")

    return {
        "job_id": job_id,
        "injected_count": len(new_conv_lines),
        "new_total_lines": updated.total_lines,
        "lines": [ln.model_dump() for ln in plan_out],
        "status": updated.status,
    }
