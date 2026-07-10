"""AI campaign planner — chunked generation to hit large target_lines."""

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
from .conversation_beats import (
    ai_transition_hits,
    beat_compliance_issues,
    beat_for_batch,
    build_speaker_cards,
    extract_banned_phrases,
    format_beat_block,
    host_dominance_issues,
    major_density,
    motif_rehash_issues,
)
from .normalize import parse_plan_dict, sanitize_plan_replies
from .prompts import (
    CONTINUATION_SYSTEM_PROMPT,
    SYSTEM_PROMPT,
    build_continuation_prompt,
    build_user_prompt,
)

# One-shot is unreliable above ~50 lines (JSON truncated). Chunk for larger targets.
# Long jobs (e.g. 150 lines) use smaller chunks so continuations stay on-track.
CHUNK_SIZE = 40
_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)


def chunk_size_for_target(total: int) -> int:
    """Smaller batches for long campaigns (less topic restart per call)."""
    t = max(1, int(total))
    if t >= 120:
        return 25
    if t >= 80:
        return 30
    if t >= 50:
        return 35
    return CHUNK_SIZE


def phase_for_batch(batch_index: int, total_batches: int) -> str:
    """Narrative phase for long multi-batch plans."""
    if total_batches <= 1:
        return "single"
    # 1-based index
    ratio = batch_index / max(1, total_batches)
    if batch_index == 1:
        return "open"
    if ratio <= 0.4:
        return "build"
    if ratio <= 0.75:
        return "mid"
    if batch_index == total_batches:
        return "close"
    return "late"


def speaker_usage_hint(
    lines: list[CampaignPlanLine],
    cast_ids: list[str],
    *,
    lead_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Who talked too much / too little so far (for messy balance)."""
    from collections import Counter

    if not cast_ids:
        return {"counts": {}, "boost": [], "ease": [], "anti_host": []}
    counts = Counter(ln.speaker_id for ln in lines if ln.speaker_id in cast_ids)
    for cid in cast_ids:
        counts.setdefault(cid, 0)
    n = max(1, len(lines))
    avg = n / max(1, len(cast_ids))
    boost = [cid for cid, c in counts.items() if c < avg * 0.55]
    ease = [cid for cid, c in counts.items() if c > avg * 1.45]
    leads = list(lead_ids or [])
    # Always ease leads a bit if they already spoke ≥ avg (anti-host)
    for lid in leads:
        if counts.get(lid, 0) >= avg and lid not in ease:
            ease.append(lid)
        if lid in boost:
            boost = [b for b in boost if b != lid]
    # Prefer boosting non-leads for topic opens
    non_lead_boost = [b for b in boost if b not in leads] or boost
    return {
        "counts": dict(counts),
        "boost": non_lead_boost,  # underused — appear more + open topics
        "ease": ease,  # overused — appear less
        "anti_host": leads,
        "note": (
            "Non-lead speakers must open ≥ half of new micro-topics this batch. "
            "Lead is a peer, never a host/moderator."
        ),
    }


def phase_instructions(phase: str, *, already_topics: list[str]) -> str:
    topics = ", ".join(already_topics) if already_topics else "(none yet)"
    if phase == "open":
        return (
            "PHASE open: start today's price vibe. At most ONE light news gossip. "
            "No greeting-all. Phone length mix (~10–15% 1–2 words: Same/Pain/Yep). "
            "~15–25% replies. Include 1 same-speaker double if natural."
        )
    if phase == "build":
        return (
            f"PHASE build: keep flow from previous_tail. already_said={topics}. "
            "Mostly price/vibe banter; at most one NEW news theme if not already said. "
            "Do not restart. Sprinkle 1–2 word reactions. ~20% reply. "
            "1–2 back-to-back same speaker ok."
        )
    if phase == "mid":
        return (
            f"PHASE mid: deep chat. already_said news={topics}. "
            "Avoid recycling sideways/bored/patience/volume-thin/63k-hold loops. "
            "Rotate NEW micro-angles: who added size, mild disagree, AFK/work, weekend once, "
            "soft news callback once, "
            "ONE alt from TOP MOVERS if listed (not touching / rekt / lol pump) — no shill. "
            "Keep short–long rhythm (Hard pass / Good call between longer takes). "
            "~20% reply; ≥2 same-speaker pairs. Messy order. Voices differ."
        )
    if phase == "late":
        return (
            f"PHASE late: already_said={topics} banned for full rehash. "
            "NO more 'bored waiting' / 'paint dry' / 'patience is key' if used earlier. "
            "Fresh takes: who is still in, small level watch, one disagree, quiet stack. "
            "More 1–2 word bubbles as energy drops. "
            "~20% reply; ≥1 same-speaker double. Boost underused speakers."
        )
    if phase == "close":
        return (
            "PHASE close: wind down WITHOUT overall/summary speeches or slogan patience. "
            "2–4 last takes + several 1–2 word exits (I'm out / Yep / Pain); "
            "optional 1 reply; no new news dump; no formal goodbye."
        )
    return (
        "Keep phone market chat with short–long length mix; no host tone; "
        "messy speakers; some replies."
    )


def campaign_phase_guidance(phase: str, *, already_topics: list[str]) -> str:
    """Soft narrative guidance for the current batch.

    Keep this principle-based. Specific example phrases here tend to leak into
    generated messages.
    """
    topics = ", ".join(already_topics) if already_topics else "none yet"
    if phase == "open":
        return (
            "PHASE open: establish today's market mood with a few short price/vibe lines. "
            "At most ONE light news angle. No formal greeting. "
            "Do not stack three BTC level mentions in a row."
        )
    if phase == "build":
        return (
            f"PHASE build: continue from previous_tail. Already touched: {topics}. "
            "React, lightly disagree, or add a small observation. "
            "Start branching: one trade take or mild conflict. Do not restart news."
        )
    if phase == "mid":
        return (
            f"PHASE mid: chat is underway. Already touched: {topics} — do not rehash. "
            "REQUIRED branch this batch: pick 2+ of "
            "(entry/exit flex or regret | mild disagree | AFK/life once | "
            "meme/lol | rekt/not-touching | ONE alt from TOP MOVERS gossip). "
            "Cap exact price strings — most lines zero prices. Voices differ by role."
        )
    if phase == "late":
        return (
            f"PHASE late: people remember ({topics}). "
            "Shorter reactions, who is still in vs out, underused speakers. "
            "No recap speech. No 'waiting for breakout' if already said."
        )
    if phase == "close":
        return (
            "PHASE close: wind down with a few short last takes. "
            "No formal summary, no goodbye speech, no new news dump, no patience slogan."
        )
    return (
        "Keep short phone market chat with progression: react, branch, emotion. "
        "No host tone; messy speakers; some replies."
    )


def branch_hints_for_phase(phase: str, already_topics: list[str]) -> list[str]:
    """Concrete micro-branch suggestions for the model payload (not example chat text)."""
    used = set(already_topics)
    hints: list[str] = []
    if phase in ("build", "mid", "late", "single"):
        if "trade_flex" not in used:
            hints.append("someone mentions a small entry/exit or size add")
        if "mild_disagree" not in used:
            hints.append("mild disagreement on whether to hold or sit out")
        if "life_afk" not in used:
            hints.append("one AFK/work/life side note")
        if "rekt_out" not in used:
            hints.append("rekt / I'm out / not touching that energy once")
        if "meme_alts" not in used and "alt_mover" not in used:
            hints.append("optional one alt from TOP MOVERS as gossip only")
        if "sideways_bored" in used or "patience_hold" in used:
            hints.append("ban more bored/patience loops — use a fresh angle")
    if phase in ("mid", "late"):
        hints.append("prefer zero exact prices on most lines this batch")
    return hints[:6]


def _extract_json_object(text: str) -> dict[str, Any]:
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
    raise ValueError("Khong parse duoc JSON plan tu model")


def _tokens_for_chunk(chunk_lines: int) -> int:
    # Generous per-chunk budget so JSON is not cut mid-array
    return max(6000, min(16_000, int(chunk_lines) * 160 + 1500))


def _chunk_sizes(total: int, size: int = CHUNK_SIZE) -> list[int]:
    sizes: list[int] = []
    left = total
    while left > 0:
        n = min(size, left)
        sizes.append(n)
        left -= n
    return sizes


def _rescale_timeline(plan: CampaignPlan, duration_min: int) -> CampaignPlan:
    """Space lines evenly across duration (index-based — stable after multi-chunk merge)."""
    if not plan.lines:
        return plan
    span = max(1, int(duration_min) * 60)
    n = len(plan.lines)
    if n == 1:
        return plan.model_copy(
            update={
                "lines": [plan.lines[0].model_copy(update={"at_sec": 0})],
                "duration_min": duration_min,
            }
        )

    # Even by index avoids huge cliffs between LLM batches (merge used to create gaps)
    new_lines: list[CampaignPlanLine] = []
    last = -3
    for i, line in enumerate(plan.lines):
        t = int(round(i * span / (n - 1)))
        # same-speaker slightly tighter is ok; enforce min gap
        min_gap = 2 if (new_lines and line.speaker_id == new_lines[-1].speaker_id) else 3
        t = max(t, last + min_gap)
        new_lines.append(line.model_copy(update={"at_sec": t}))
        last = t

    # If min-gaps pushed past span, compress back into [0, span]
    if new_lines[-1].at_sec > span and n > 1:
        end = max(1, new_lines[-1].at_sec)
        compressed: list[CampaignPlanLine] = []
        last = -3
        for line in new_lines:
            t = int(round(line.at_sec * span / end))
            t = max(t, last + 2)
            compressed.append(line.model_copy(update={"at_sec": t}))
            last = t
        new_lines = compressed

    return plan.model_copy(update={"lines": new_lines, "duration_min": duration_min})


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
        raw = {**raw, "duration_min": fallback_duration, "title": raw.get("title") or "Campaign"}
    if "title" not in raw:
        raw = {**raw, "title": "Campaign"}
    return parse_plan_dict(raw)


def _merge_chunk_lines(
    existing: list[CampaignPlanLine],
    chunk: list[CampaignPlanLine],
) -> list[CampaignPlanLine]:
    """Append chunk lines; rewrite reply_to_line from batch-local 1-based → global 1-based."""
    offset = len(existing)
    merged = list(existing)
    for i, line in enumerate(chunk):
        # i is 0-based index within chunk; valid local reply targets are 1..i
        reply = line.reply_to_line
        action = line.action
        new_reply: int | None = None
        if action == "reply":
            if reply is not None and 1 <= int(reply) <= i:
                new_reply = offset + int(reply)
            elif i > 0:
                new_reply = offset + i  # previous line in this chunk
            elif offset > 0:
                new_reply = offset  # last line of previous batch
            else:
                action = "send"
                new_reply = None
        # Sequential placeholder times; final _rescale_timeline is index-based
        base_t = (existing[-1].at_sec + 8) if existing and i == 0 else 0
        if merged:
            at_sec = merged[-1].at_sec + (4 if line.speaker_id == merged[-1].speaker_id else 8)
        else:
            at_sec = base_t + max(0, line.at_sec)
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
        {"speaker_id": line.speaker_id, "text": line.text[:120], "action": line.action}
        for line in tail
    ]


# Theme tags for anti-repeat across long multi-chunk plans
_TOPIC_PATTERNS: list[tuple[str, tuple[str, ...]]] = [
    ("clarity_act", ("clarity act", "clarity")),
    ("sec_nominees", ("sec nominee", "sec pick", "white house", "nominees for sec", "no dem")),
    ("eth_ai_bugs", ("foundation", "ai to", "ai hunting", "bug", "bugs")),
    ("cftc_deriv", ("cftc", "phantom", "hyperliquid", "onchain deriv", "derivatives")),
    ("etf_outflow", ("etf", "outflow", "outflows")),
    ("meme_alts", ("meme", "altcoin", "alts")),
    ("hold_stack", ("holding", "stacking", "hodl", "adding more", "scoop")),
    ("grayscale_cfo", ("grayscale", "cfo")),
    ("coinbase_reshuffle", ("coinbase", "reshuffle", "reshuffled")),
    ("avax_nasdaq", ("avax", "nasdaq")),
    ("ai_crypto", ("ai + crypto", "ai and crypto", "crypto ai", "ai crypto")),
    # Branch / human markers (positive diversity signals)
    (
        "trade_flex",
        (
            "just bought",
            "just sold",
            "took profit",
            "closed my",
            "entered",
            "added size",
            "scaled in",
            "scaled out",
            "bought a bit",
            "sold a bit",
            "mua",
            "bán",
            "chốt",
            "vào lệnh",
        ),
    ),
    (
        "mild_disagree",
        (
            "nah i",
            "disagree",
            "not buying",
            "still in",
            "i'm out",
            "im out",
            "no way",
            "not me",
            "không mua",
            "tôi out",
            "t out",
        ),
    ),
    (
        "life_afk",
        (
            "afk",
            "brb",
            "at work",
            "gotta go",
            "dinner",
            "gym",
            "back later",
            "đi làm",
            "ăn cơm",
            "đi ngủ",
        ),
    ),
    (
        "off_meta",
        (
            "airdrop",
            "chatgpt",
            "claude",
            "telegram bot",
            "the bot",
            "on x",
            "twitter",
            "nft",
            "steam",
            "new game",
            "ai tool",
            "ai tools",
        ),
    ),
    (
        "rekt_out",
        (
            "rekt",
            "got wrecked",
            "not touching",
            "looks fake",
            "this is fake",
            "baghold",
            "liquidat",
            "cháy",
            "gồng lỗ",
            "không đụng",
        ),
    ),
    ("alt_mover", ("gainer", "loser", "pumping hard", "dumping hard", "up 20", "down 15")),
    # Vibe loops (half of long plans die here)
    (
        "sideways_bored",
        (
            "sideway",
            "sideways",
            "bored",
            "boring",
            "paint dry",
            "ghost town",
            "molasses",
            "waiting game",
            "so sideways",
            "running in place",
            "quiet market",
            "market is quiet",
            "yên ắng",
            "ì ạch",
        ),
    ),
    (
        "volume_thin",
        ("volume", "thin volume", "low volume", "volume's", "volumes"),
    ),
    (
        "patience_hold",
        (
            "patience",
            "patient",
            "holding tight",
            "no rush",
            "hodling",
            "hold my",
            "still holding",
            "patience is key",
        ),
    ),
    (
        "breakout_hope",
        (
            "breakout",
            "break out",
            "next pump",
            "fireworks",
            "fingers crossed",
            "next spark",
            "waiting for 64",
            "chờ breakout",
        ),
    ),
    (
        "price_loop_levels",
        (
            "near 63k",
            "around 63k",
            "63k",
            "64k",
            "1745",
            "1,745",
            "near 78",
            "around 78",
            "near 1750",
            "1,750",
            "around 1750",
            "near 1,750",
        ),
    ),
]

# News-only subset vs vibe loops vs positive branch signals
_NEWS_TOPIC_TAGS = {
    "clarity_act",
    "sec_nominees",
    "eth_ai_bugs",
    "cftc_deriv",
    "etf_outflow",
    "meme_alts",
    "grayscale_cfo",
    "coinbase_reshuffle",
    "avax_nasdaq",
    "ai_crypto",
}
_VIBE_TOPIC_TAGS = {
    "sideways_bored",
    "volume_thin",
    "patience_hold",
    "breakout_hope",
    "price_loop_levels",
    "hold_stack",
}
_BRANCH_TOPIC_TAGS = {
    "trade_flex",
    "mild_disagree",
    "life_afk",
    "rekt_out",
    "alt_mover",
    "off_meta",
}

# Approx price tokens in chat (EN + VI casual)
_PRICE_TOKEN_RE = re.compile(
    r"(?:"
    r"\b\d{2,3}\s*k\b|"  # 63k, 64 k
    r"\b(?:btc|eth|sol)\b.{0,12}\b\d|"  # BTC near 63…
    r"\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|"  # 1,750
    r"\b(?:around|near|at|~|khoảng|gần|tầm)\s+\d"
    r")",
    re.IGNORECASE,
)
_SOFT_ACK_RE = re.compile(
    r"^\s*(yeah|yep|true|exactly|could be|might|maybe|fair|ok|okay|right|sure|"
    r"đúng|ừ|uh|hmm|haha|lol)\s*[.!?…]*\s*$",
    re.IGNORECASE,
)


def extract_said_topics(lines: list[CampaignPlanLine]) -> list[str]:
    """Which recurring themes already appeared (for continuation anti-loop)."""
    found: list[str] = []
    blob = " ".join((ln.text or "").lower() for ln in lines)
    for tag, keys in _TOPIC_PATTERNS:
        if any(k in blob for k in keys):
            found.append(tag)
    return found


def topic_repeat_score(lines: list[CampaignPlanLine]) -> float:
    """
    Rough 0..1 score of how much the chunk re-chews news themes.
    High = too many lines hit the same tagged topics.
    """
    if len(lines) < 8:
        return 0.0
    hits = 0
    news_patterns = [(t, k) for t, k in _TOPIC_PATTERNS if t in _NEWS_TOPIC_TAGS]
    for ln in lines:
        t = (ln.text or "").lower()
        if any(any(k in t for k in keys) for _, keys in news_patterns):
            hits += 1
    return hits / max(1, len(lines))


def vibe_repeat_score(lines: list[CampaignPlanLine]) -> float:
    """0..1 how much this batch is only sideways/bored/patience/price-loop filler."""
    if len(lines) < 6:
        return 0.0
    hits = 0
    vibe_patterns = [(t, k) for t, k in _TOPIC_PATTERNS if t in _VIBE_TOPIC_TAGS]
    for ln in lines:
        t = (ln.text or "").lower()
        if any(any(k in t for k in keys) for _, keys in vibe_patterns):
            hits += 1
    return hits / max(1, len(lines))


def price_density_score(lines: list[CampaignPlanLine]) -> float:
    """0..1 share of lines that contain approximate price tokens."""
    if not lines:
        return 0.0
    hits = 0
    for ln in lines:
        if _PRICE_TOKEN_RE.search(ln.text or ""):
            hits += 1
    return hits / max(1, len(lines))


def soft_ack_score(lines: list[CampaignPlanLine]) -> float:
    """0..1 share of pure soft-ack bubbles (Yeah / True / Could be…)."""
    if not lines:
        return 0.0
    hits = sum(1 for ln in lines if _SOFT_ACK_RE.match((ln.text or "").strip()))
    return hits / max(1, len(lines))


def _word_count(text: str) -> int:
    return len((text or "").strip().split())


def ultra_short_score(lines: list[CampaignPlanLine]) -> float:
    """0..1 share of 1–2 word Telegram bubbles (Yep / Same / Hard pass)."""
    if not lines:
        return 0.0
    hits = sum(1 for ln in lines if 1 <= _word_count(ln.text or "") <= 2)
    return hits / max(1, len(lines))


# "Me too, rest of take…" / "True, eth still…" glued on one line
_GLUED_MICRO_ACK_RE = re.compile(
    r"^\s*(?:"
    r"me too|i agree|true|exactly|yep|yeah|same|fair enough|ok|okay|"
    r"nah|nope|lol|lmao|pain|ouch|facts|rip"
    r")\s*[,–—-]\s+\S+",
    re.IGNORECASE,
)


def glued_micro_ack_count(lines: list[CampaignPlanLine]) -> int:
    """Count lines that glue a micro-ack + continuation with comma/dash."""
    return sum(1 for ln in lines if _GLUED_MICRO_ACK_RE.search((ln.text or "").strip()))


def long_message_score(lines: list[CampaignPlanLine]) -> float:
    """0..1 share of lines longer than 12 words (should stay rare)."""
    if not lines:
        return 0.0
    hits = sum(1 for ln in lines if _word_count(ln.text or "") > 12)
    return hits / max(1, len(lines))


_FAIR_BUT_RE = re.compile(
    r"\bfair\s*,?\s*but\b|\byeah\s*,?\s*but\b|\btrue\s*,?\s*but\b",
    re.IGNORECASE,
)


def fair_but_score(lines: list[CampaignPlanLine]) -> float:
    """0..1 share of 'Fair, but…' / 'Yeah, but…' formula lines (AI crutch)."""
    if not lines:
        return 0.0
    hits = sum(1 for ln in lines if _FAIR_BUT_RE.search(ln.text or ""))
    return hits / max(1, len(lines))


def fair_but_count(lines: list[CampaignPlanLine]) -> int:
    return sum(1 for ln in lines if _FAIR_BUT_RE.search(ln.text or ""))


_HUMAN_MESS_RE = re.compile(
    r"(?:"
    r"\blol\b|\blmao\b|\bbro\b|\bidk\b|\bwtf\b|\bnvm\b|\bmy bad\b|"
    r"\bwait\b|\bfr\b|\btbh\b|\blmao\b|\bomg\b|"
    r"\.\.\.|…|"
    r"\bactually nvm\b|\bwait no\b|\bignore that\b|"
    r"\bgonna\b|\bwanna\b"
    r")",
    re.IGNORECASE,
)


def human_mess_score(lines: list[CampaignPlanLine]) -> float:
    """0..1 share of lines with casual mess markers (lol/idk/…/nvm)."""
    if not lines:
        return 0.0
    hits = sum(1 for ln in lines if _HUMAN_MESS_RE.search(ln.text or ""))
    return hits / max(1, len(lines))


# Reactor-bot: pure reaction tokens as the whole (or start of) message
_REACTOR_MOTIF_RE = re.compile(
    r"^\s*(lol|lmao|ouch|pain|wtf|wild|brutal|damn|same|nah|yep|true|facts|rip)\b",
    re.IGNORECASE,
)

# Echo-bot reply openers
_ECHO_SHAPE_RE = re.compile(
    r"^\s*(same\b|not sold\b|kinda\b|fair enough\b|true\b|yeah\b|yep\b)",
    re.IGNORECASE,
)

# Lead sounding certain / hosty
_LEAD_CERTAIN_RE = re.compile(
    r"(?:"
    r"\bconfirmed\b|\bexactly\b|\bthe key is\b|\bas expected\b|"
    r"\bremember\b|\bkeep in mind\b|\bimportant(ly)?\b|"
    r"\bto be clear\b|\bbasically\b"
    r")",
    re.IGNORECASE,
)

_LEAD_UNCERTAIN_RE = re.compile(
    r"(?:"
    r"\bnot sure\b|\bidk\b|\banyone (checked|see|saw)\b|"
    r"\bheard (something|rumors?)?\b|\bcould be wrong\b|"
    r"\bmaybe\b|\bmight\b|\?\s*$"
    r")",
    re.IGNORECASE,
)


def reactor_motif_score(lines: list[CampaignPlanLine]) -> float:
    """0..1 share of lines that open with stock reaction tokens."""
    if not lines:
        return 0.0
    hits = sum(1 for ln in lines if _REACTOR_MOTIF_RE.search((ln.text or "").strip()))
    return hits / max(1, len(lines))


def echo_shape_score(lines: list[CampaignPlanLine]) -> float:
    """0..1 share of lines that open like an Echo-bot (Same / Not sold / Kinda…)."""
    if not lines:
        return 0.0
    hits = sum(1 for ln in lines if _ECHO_SHAPE_RE.search((ln.text or "").strip()))
    return hits / max(1, len(lines))


def lead_uncertain_hits(
    lines: list[CampaignPlanLine],
    *,
    lead_ids: set[str],
) -> int:
    if not lead_ids:
        return 0
    n = 0
    for ln in lines:
        if ln.speaker_id not in lead_ids:
            continue
        t = ln.text or ""
        if _LEAD_UNCERTAIN_RE.search(t):
            n += 1
    return n


def lead_line_count(lines: list[CampaignPlanLine], *, lead_ids: set[str]) -> int:
    return sum(1 for ln in lines if ln.speaker_id in lead_ids)


def branch_diversity_score(lines: list[CampaignPlanLine]) -> float:
    """How many distinct human-branch themes appear (0..1 vs expected set)."""
    if len(lines) < 6:
        return 1.0  # short batches: don't punish
    found = set(extract_said_topics(lines)) & _BRANCH_TOPIC_TAGS
    # Expect at least 2 branch types in mid-length batches
    return min(1.0, len(found) / 2.0)


def back_to_back_count(speaker_ids: list[str]) -> int:
    """How many times the same speaker speaks twice in a row."""
    if len(speaker_ids) < 2:
        return 0
    return sum(1 for i in range(1, len(speaker_ids)) if speaker_ids[i] == speaker_ids[i - 1])


def reply_rate(lines: list[CampaignPlanLine]) -> float:
    if not lines:
        return 0.0
    return sum(1 for ln in lines if ln.action == "reply") / len(lines)


def round_robin_score(speaker_ids: list[str]) -> float:
    """
    How "perfect panel rotation" the sequence is (0..1).
    High score ≈ every window of size |unique speakers| is all-different (A-B-C-D style).
    """
    if len(speaker_ids) < 4:
        return 0.0
    n = len({s for s in speaker_ids if s})
    if n < 2:
        return 0.0
    # Prefer cast-size window; if many speakers, cap window at 4 for sensitivity
    window = min(n, 4)
    if len(speaker_ids) < window + 1:
        return 0.0
    hits = 0
    total = 0
    for i in range(0, len(speaker_ids) - window + 1):
        chunk = speaker_ids[i : i + window]
        total += 1
        if len(set(chunk)) == window:
            hits += 1
    if total == 0:
        return 0.0
    # Also penalize exact repeating cycle of first `n` speakers
    cycle = speaker_ids[:n]
    if len(set(cycle)) == n and len(speaker_ids) >= n * 2:
        repeats = 0
        blocks = 0
        for i in range(0, len(speaker_ids) - n + 1, n):
            block = speaker_ids[i : i + n]
            if len(block) < n:
                break
            blocks += 1
            if block == cycle:
                repeats += 1
        if blocks >= 2 and repeats / blocks >= 0.75:
            return 1.0
    return hits / total


async def _generate_chunk(
    base_payload: dict[str, Any],
    *,
    need_lines: int,
    batch_index: int,
    total_batches: int,
    previous_lines: list[CampaignPlanLine],
    is_first: bool,
) -> CampaignPlan:
    already_topics = extract_said_topics(previous_lines)
    cast_ids = [
        str(s.get("id") or "").strip()
        for s in (base_payload.get("speakers") or [])
        if isinstance(s, dict) and str(s.get("id") or "").strip()
    ]
    phase = phase_for_batch(batch_index, total_batches)
    beat = beat_for_batch(batch_index, total_batches)
    speakers_raw = [
        s
        for s in (base_payload.get("speakers") or [])
        if isinstance(s, dict)
    ]
    speaker_cards = build_speaker_cards(speakers_raw)
    lead_ids = [
        str(c.get("id") or "")
        for c in speaker_cards
        if str(c.get("role") or "").lower() == "lead"
    ]
    usage = speaker_usage_hint(previous_lines, cast_ids, lead_ids=lead_ids)
    global_target = int(base_payload.get("global_target") or need_lines)
    banned = extract_banned_phrases(previous_lines, limit=16)
    beat_block = format_beat_block(beat, already_topics=already_topics)
    payload = {
        **base_payload,
        "target_lines": need_lines,
        "batch": {
            "index": batch_index,
            "total_batches": total_batches,
            "already_have": len(previous_lines),
            "global_target": global_target,
            "is_continuation": not is_first,
            "phase": phase,
            "beat_id": beat.get("id"),
            "long_plan": global_target >= 80,
        },
        "previous_tail": _tail_for_prompt(previous_lines, n=22),
        "already_said_topics": already_topics,
        "phase_instructions": campaign_phase_guidance(phase, already_topics=already_topics),
        "beat": {
            "id": beat.get("id"),
            "primary": beat.get("primary"),
            "market_share": beat.get("market_share"),
            "instruction": beat.get("instruction"),
            "schedule": beat.get("schedule"),
        },
        "beat_block": beat_block,
        "branch_hints": branch_hints_for_phase(phase, already_topics),
        "speaker_usage": usage,
        "speaker_cards": speaker_cards,
        "do_not_reuse_phrases": banned,
        "anti_host_rule": (
            "NO HOST: topic opens must be shared. "
            "reactor/degen/skeptic/member open threads often. "
            "Lead shouldn't run the whole room. "
            "Avoid host transitions when overused: 'to sum up', 'back to', "
            "'speaking of', 'on another note', 'let's move on', 'overall…'. "
            "Phrases like 'Fair, but…' / Lol / Same are fine — just don't spam them."
        ),
        "human_mess_rule": (
            "Soft only: include a few pure micro-ack bubbles (whole line is just "
            "True / Exactly / Me too / Yep — examples, not a fixed list). "
            "When ack + take: prefer two lines ('Me too' then 'Feels steady at 63k') "
            "instead of almost always one line ('Me too, feels steady at 63k'). "
            "One-line combined is still allowed sometimes — not banned. "
            "Also optional: split 'Could be fine, but volume looks low' into two bubbles."
        ),
        "persona_rule": (
            "Roles are SOFT only. Reduce cliché overuse (not hard bans): "
            "if Echo already did Same/Not sold a lot, try another move; "
            "if Reactor already did Lol/Ouch/Pain a lot, give a real take; "
            "Lead can know things — also sometimes unsure or asks. "
            "Each speaker_id is a person with mood — mix react/ask/disagree/open."
        ),
        "long_plan_note": (
            f"Full campaign is {global_target} lines (batch {batch_index}/{total_batches}). "
            f"HARD BEAT this batch: {beat.get('id')} — {beat.get('primary')}. "
            "Do NOT recycle BTC→ETH→SOL→same-news loop from earlier batches. "
            "Conversation must PROGRESS: new focus each batch per beat schedule. "
            "Each speaker_id must keep its fingerprint (style/tics). "
            "ANTI-HOST: non-lead speakers open ≥ half of new micro-topics; "
            "no moderator transitions (Speaking of / Back to / To sum up)."
            if global_target >= 40
            else (
                f"This batch beat: {beat.get('id')}. "
                "Share topic opens; no host transitions."
            )
        ),
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
    plan = _parse_lines_only(raw, fallback_duration=int(base_payload.get("duration_min") or 20))

    # Cast labels that must not appear in message text
    cast_labels = [
        str(s.get("label") or "").strip()
        for s in (base_payload.get("speakers") or [])
        if isinstance(s, dict) and str(s.get("label") or "").strip()
    ]

    def _needs_retry(p: CampaignPlan) -> str | None:
        if len(p.lines) < max(2, int(need_lines * 0.85)):
            return (
                f"You returned {len(p.lines)} lines; need EXACTLY {need_lines}. "
                "Shorter messages. Complete JSON only."
            )
        ids = [ln.speaker_id for ln in p.lines]
        rr = round_robin_score(ids)
        b2b = back_to_back_count(ids)
        if rr >= 0.50 and len(ids) >= 6:
            seq = "-".join(ids[:16])
            return (
                f"Speaker order too round-robin (score={rr:.2f}): {seq}… "
                "Panel-like cycle. Use MESSY order with some same-speaker doubles "
                f"(need ≥1 back-to-back pair). EXACTLY {need_lines} lines."
            )
        # Long batches with zero doubles still feel like strict turns
        if need_lines >= 12 and b2b == 0 and rr >= 0.35:
            return (
                "Speaker order is too even (no same-speaker back-to-back). "
                "Add 1–3 places where the SAME speaker sends two lines near each other. "
                f"Still MESSY, not A-B-C-D. EXACTLY {need_lines} lines."
            )
        # Reply rate too low on longer batches
        rr_rate = reply_rate(p.lines)
        if need_lines >= 10 and rr_rate < 0.12:
            return (
                f"Too few replies (reply rate={rr_rate:.2f}). "
                "Use action=reply on ~15–25% of lines when answering a prior take. "
                f"EXACTLY {need_lines} lines."
            )
        # Continuation must not re-chew old NEWS themes (not vibe tags)
        if not is_first and already_topics:
            news_already = [t for t in already_topics if t in _NEWS_TOPIC_TAGS]
            rehash = 0
            for ln in p.lines:
                t = (ln.text or "").lower()
                for tag in news_already:
                    keys = next((k for name, k in _TOPIC_PATTERNS if name == tag), ())
                    if any(k in t for k in keys):
                        rehash += 1
                        break
            if rehash >= max(3, need_lines // 4):
                return (
                    f"You re-opened already_said news topics too much ({news_already}). "
                    "At most ONE soft callback; otherwise NEW angles, not full rehash. "
                    f"EXACTLY {need_lines} lines."
                )
        # Mid/late: vibe filler loop (bored/sideways/patience/63k)
        phase = str((payload.get("batch") or {}).get("phase") or "")
        if phase in ("mid", "late", "close") or (
            not is_first and int((payload.get("batch") or {}).get("global_target") or 0) >= 80
        ):
            vs = vibe_repeat_score(p.lines)
            if vs >= 0.55 and need_lines >= 10:
                return (
                    f"Vibe loop too high (score={vs:.2f}): too much sideways/bored/patience/"
                    "volume-thin/same price levels. Rewrite with FRESH micro-angles "
                    "(disagree, AFK, who added, rekt, meme once). "
                    f"EXACTLY {need_lines} lines. Avoid slogan 'patience is key'."
                )
        # Overused (not banned): Fair, but… / Yeah, but…
        fb = fair_but_count(p.lines)
        if need_lines >= 10 and fb >= 4:
            return (
                f"'Fair, but…' / 'Yeah, but…' appears {fb} times — a bit much. "
                "Still allowed, just diversify some disagrees (Nah / Idk / Hard pass / "
                "Wait / a short take / jump topic). EXACTLY "
                f"{need_lines} lines."
            )
        # Soft limits only when clearly overused — never hard quotas
        ack = soft_ack_score(p.lines)
        if need_lines >= 14 and ack >= 0.38:
            return (
                f"Pure soft-ack share is high (score={ack:.2f}). "
                "Still allowed — just ease off a little and mix more short takes. "
                f"EXACTLY {need_lines} lines."
            )
        if need_lines >= 14:
            us = ultra_short_score(p.lines)
            # Soft: if almost zero pure micro bubbles but many glued "Me too, …" lines
            glued = glued_micro_ack_count(p.lines)
            if us < 0.03 and glued >= 3:
                return (
                    f"Many glued acks on one line ({glued}× like 'Me too, …' / 'True, …') "
                    f"but almost no pure 1–2 word bubbles (share={us:.2f}). "
                    "Soft fix: split a few into two bubbles — first line only the ack "
                    "('Me too' / 'True'), next line the take. Combined one-liners still "
                    f"ok sometimes. EXACTLY {need_lines} lines."
                )
            # Only cap extreme micro-ack spam
            if us > 0.22:
                return (
                    f"Pure 1–2 word bubbles are quite dense (share={us:.2f}). "
                    "Limit a bit — keep some, not most lines. EXACTLY "
                    f"{need_lines} lines."
                )
            longish = long_message_score(p.lines)
            if longish > 0.15:
                return (
                    f"Quite a few lines >12 words (share={longish:.2f}). "
                    "Optionally split a couple compound takes into two short lines. "
                    f"EXACTLY {need_lines} lines."
                )
            # Polished-only batch: need a bit of human mess
            hm = human_mess_score(p.lines)
            if hm < 0.05:
                return (
                    f"Chat is too polished (human-mess score={hm:.2f}). "
                    "Add natural mess: lol / lmao / idk / wtf / nvm / wait / bro / … "
                    "or one mind-change (actually nvm). EXACTLY "
                    f"{need_lines} lines."
                )
            # Overused role clichés (allowed, just reduce if heavy)
            rm = reactor_motif_score(p.lines)
            if rm >= 0.35:
                return (
                    f"Reaction openers (Lol/Ouch/Pain/Wtf/Same…) are heavy "
                    f"(score={rm:.2f}). Keep some, but mix in more real short takes too. "
                    f"EXACTLY {need_lines} lines."
                )
            es = echo_shape_score(p.lines)
            if es >= 0.32:
                return (
                    f"Same/Not sold/Kinda openers are heavy (score={es:.2f}). "
                    "Still fine sometimes — just vary a few replies with pushback, "
                    "a new angle, or a plain take. EXACTLY "
                    f"{need_lines} lines."
                )
            lead_ids = {
                str(c.get("id") or "")
                for c in speaker_cards
                if isinstance(c, dict) and str(c.get("role") or "").lower() == "lead"
            }
            lead_ids.discard("")
            if lead_ids and need_lines >= 14:
                n_lead = lead_line_count(p.lines, lead_ids=lead_ids)
                if n_lead >= 5 and lead_uncertain_hits(p.lines, lead_ids=lead_ids) == 0:
                    return (
                        "Lead has many lines and all sound certain. "
                        "Optional: one unsure/ask line ('not sure' / 'anyone checked?') "
                        "so they don't only data-dump. EXACTLY "
                        f"{need_lines} lines."
                    )
        # Mid/late batches with no human branch diversity
        if phase in ("mid", "late") and need_lines >= 12:
            bd = branch_diversity_score(p.lines)
            if bd < 0.5:
                return (
                    "Batch lacks human micro-topics (trade flex, disagree, AFK, rekt, alt gossip). "
                    "Add 2+ of those angles; stop looping BTC/ETH levels. "
                    f"EXACTLY {need_lines} lines."
                )
        # HARD beat compliance (conversation rhythm)
        for issue in beat_compliance_issues(p.lines, beat, need_lines=need_lines):
            return f"{issue} EXACTLY {need_lines} lines. Follow beat_block PRIMARY."
        # AI moderator transitions
        ai_hits = ai_transition_hits(p.lines)
        if ai_hits:
            return (
                f"Forbidden host transitions found ({ai_hits[:4]}). "
                "Never use: to sum up / back to / speaking of / on another note / overall. "
                "Jump topics by just saying the new thing. "
                f"EXACTLY {need_lines} lines."
            )
        # Lead / one-speaker host dominance
        for issue in host_dominance_issues(
            p.lines,
            speaker_cards=speaker_cards,
            cast_ids=cast_ids,
            need_lines=need_lines,
        ):
            return f"{issue} EXACTLY {need_lines} lines."
        # Motif rehash vs history (63k, coinbase, etc.)
        for issue in motif_rehash_issues(
            previous_lines, p.lines, need_lines=need_lines
        ):
            return f"{issue} EXACTLY {need_lines} lines."
        # Banned phrase reuse from earlier batches
        if banned and need_lines >= 10:
            blob = " ".join((ln.text or "").lower() for ln in p.lines)
            hits = [ph for ph in banned if ph in blob]
            if len(hits) >= 3:
                return (
                    f"Reused old phrases too much: {hits[:5]}. "
                    "Paraphrase differently; change the angle per beat. "
                    f"EXACTLY {need_lines} lines."
                )
        # Price density: stricter outside market_scan; mid/late even tighter
        pd = price_density_score(p.lines)
        beat_id = str(beat.get("id") or "")
        if beat_id == "market_scan":
            pd_limit = 0.45
        elif phase in ("mid", "late", "close"):
            pd_limit = 0.22
        else:
            pd_limit = 0.28
        if need_lines >= 10 and pd >= pd_limit:
            return (
                f"Too many exact price/level mentions (density={pd:.2f}, limit={pd_limit}). "
                "Do NOT re-chew the same BTC/ETH level (63k / 1750…). "
                "Prefer vibes without numbers: still soft / looks heavy / holding up. "
                f"Most lines ZERO prices. EXACTLY {need_lines} lines."
            )
        # First batch: news density too high
        if is_first and topic_repeat_score(p.lines) >= 0.45:
            return (
                "Too many news-dump lines. Most lines should be short price/vibe chat; "
                f"only 1–2 light news gossips. EXACTLY {need_lines} lines."
            )
        # Cast display name leaked into text
        for ln in p.lines:
            low = (ln.text or "").lower()
            for lab in cast_labels:
                if lab and len(lab) >= 3 and lab.lower() in low:
                    return (
                        f"Do not put cast names/labels in message text (found '{lab}'). "
                        f"Rewrite without names. EXACTLY {need_lines} lines."
                    )
        return None

    reason = _needs_retry(plan)
    if reason:
        try:
            retry_payload = {**payload, "instruction_retry": reason}
            if is_first:
                user = build_user_prompt(retry_payload)
                system = SYSTEM_PROMPT
            else:
                user = build_continuation_prompt(retry_payload)
                system = CONTINUATION_SYSTEM_PROMPT
            raw = await _call_llm(
                system_prompt=system,
                user_prompt=user,
                max_tokens=min(16_000, max_tokens + 2000),
                model=model if isinstance(model, str) else None,
            )
            retried = _parse_lines_only(
                raw, fallback_duration=int(base_payload.get("duration_min") or 20)
            )
            old_rr = round_robin_score([ln.speaker_id for ln in plan.lines])
            new_rr = round_robin_score([ln.speaker_id for ln in retried.lines])
            old_topic = topic_repeat_score(plan.lines)
            new_topic = topic_repeat_score(retried.lines)
            old_vibe = vibe_repeat_score(plan.lines)
            new_vibe = vibe_repeat_score(retried.lines)
            old_b2b = back_to_back_count([ln.speaker_id for ln in plan.lines])
            new_b2b = back_to_back_count([ln.speaker_id for ln in retried.lines])
            old_pd = price_density_score(plan.lines)
            new_pd = price_density_score(retried.lines)
            old_ack = soft_ack_score(plan.lines)
            new_ack = soft_ack_score(retried.lines)
            old_bd = branch_diversity_score(plan.lines)
            new_bd = branch_diversity_score(retried.lines)
            old_beat_n = len(beat_compliance_issues(plan.lines, beat, need_lines=need_lines))
            new_beat_n = len(beat_compliance_issues(retried.lines, beat, need_lines=need_lines))
            old_maj = major_density(plan.lines)
            new_maj = major_density(retried.lines)
            old_host_n = len(
                host_dominance_issues(
                    plan.lines,
                    speaker_cards=speaker_cards,
                    cast_ids=cast_ids,
                    need_lines=need_lines,
                )
            )
            new_host_n = len(
                host_dominance_issues(
                    retried.lines,
                    speaker_cards=speaker_cards,
                    cast_ids=cast_ids,
                    need_lines=need_lines,
                )
            )
            old_ai = len(ai_transition_hits(plan.lines))
            new_ai = len(ai_transition_hits(retried.lines))
            if len(retried.lines) >= max(2, int(need_lines * 0.75)) and (
                new_rr <= old_rr
                or new_topic < old_topic
                or new_vibe < old_vibe
                or new_b2b > old_b2b
                or new_pd < old_pd
                or new_ack < old_ack
                or new_bd > old_bd
                or new_beat_n < old_beat_n
                or new_maj < old_maj
                or new_host_n < old_host_n
                or new_ai < old_ai
                or reply_rate(retried.lines) > reply_rate(plan.lines)
                or len(retried.lines) > len(plan.lines)
            ):
                plan = retried
        except Exception:
            pass

    # Trim if model overshot
    if len(plan.lines) > need_lines:
        plan = plan.model_copy(update={"lines": plan.lines[:need_lines]})
    return plan


async def plan_campaign(
    request: CampaignPlanRequest,
) -> tuple[CampaignPlan, dict[str, Any] | None]:
    """
    Returns (plan, market_context_dict_or_none).
    Large targets are generated in chunks then merged + rescaled.
    """
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
    # Explicit list from UI (including empty = "don't talk news")
    selected_news = [t.strip() for t in (request.selected_news or []) if t and str(t).strip()]
    must_discuss_news = [
        t.strip() for t in (request.must_discuss_news or []) if t and str(t).strip()
    ]
    # Must items always count as selected topics
    for title in must_discuss_news:
        if title not in selected_news:
            selected_news.append(title)
    news_keywords = [t.strip() for t in (request.news_keywords or []) if t and str(t).strip()]
    # Also allow topic_bullets as extra manual talking points
    topic_bullets = [t.strip() for t in (request.topic_bullets or []) if t and str(t).strip()]

    if request.use_market_context:
        try:
            from ..market import fetch_crypto_snapshot, format_market_brief

            snap = await fetch_crypto_snapshot(use_cache=True)
            # Prefer user-selected headlines; if UI sent selected_news use that list
            # (even empty). If field omitted entirely (None), use all RSS news.
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

    base_payload: dict[str, Any] = {
        "goal": request.goal.strip(),
        "duration_min": request.duration_min,
        "density": request.density,
        "language": request.language,
        "group_link": request.group_link,
        "peer_id": request.peer_id,
        "topic_bullets": topic_bullets,
        "selected_news": selected_news,
        "must_discuss_news": must_discuss_news,
        "news_keywords": news_keywords,
        "speakers": speakers,
        "market_brief": market_brief,
        "global_target": target_lines,
        "model": model_override,
    }

    csize = chunk_size_for_target(target_lines)
    sizes = _chunk_sizes(target_lines, csize)
    all_lines: list[CampaignPlanLine] = []
    title = "Campaign"

    for index, need in enumerate(sizes, start=1):
        chunk_plan = await _generate_chunk(
            base_payload,
            need_lines=need,
            batch_index=index,
            total_batches=len(sizes),
            previous_lines=all_lines,
            is_first=(index == 1),
        )
        if index == 1 and chunk_plan.title:
            title = chunk_plan.title
        if not chunk_plan.lines:
            raise ValueError(f"AI tra batch {index}/{len(sizes)} rong")
        all_lines = _merge_chunk_lines(all_lines, chunk_plan.lines)

    # Safety trim / note if still short after all chunks
    if len(all_lines) > target_lines:
        all_lines = all_lines[:target_lines]

    all_lines = sanitize_plan_replies(all_lines)

    # If short after all chunks, one more top-up batch (long jobs need full count)
    if len(all_lines) < target_lines:
        deficit = target_lines - len(all_lines)
        # Cap top-up size
        top_up = min(deficit, csize)
        try:
            extra = await _generate_chunk(
                base_payload,
                need_lines=top_up,
                batch_index=len(sizes) + 1,
                total_batches=len(sizes) + 1,
                previous_lines=all_lines,
                is_first=False,
            )
            if extra.lines:
                all_lines = _merge_chunk_lines(all_lines, extra.lines[:top_up])
        except Exception:
            pass
        if len(all_lines) > target_lines:
            all_lines = all_lines[:target_lines]
        all_lines = sanitize_plan_replies(all_lines)

    plan = CampaignPlan(
        title=title[:120] or "Campaign",
        duration_min=request.duration_min,
        lines=all_lines,
    )
    plan = _rescale_timeline(plan, request.duration_min)
    return plan, market_ctx
