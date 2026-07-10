"""Conversation beat-sheet: forces multi-batch plans to change focus over time.

Soft prompt hints alone still produce BTC→ETH→SOL→news→BTC loops.
Each batch gets a hard PRIMARY focus so the full chat has trader-group rhythm:
price → trades → drift → alt/off-meta → return → wind-down.
"""

from __future__ import annotations

import re
from typing import Any

# Beat catalog — ids are stable for tests / logging.
# `market_share`: high|medium|low — how much of the batch may discuss majors/news.
# `must_tags`: detectors from planner topic patterns (soft requirement).
# `avoid_if_already`: if these tags already dominate history, skip this beat when possible.
BEAT_CATALOG: list[dict[str, Any]] = [
    {
        "id": "market_scan",
        "primary": "price/vibe on majors only",
        "market_share": "high",
        "instruction": (
            "PRIMARY: short BTC/ETH/SOL vibe + levels. "
            "At most ONE light news mention. No trade flex yet. No off-topic."
        ),
        "must_any": [],
        "forbid_heavy": ["airdrop", "game", "bot farm"],
    },
    {
        "id": "trade_desk",
        "primary": "positions / entries / stops",
        "market_share": "medium",
        "instruction": (
            "PRIMARY: trader desk talk — who is long/short, entry ask, size, stop-loss pain, "
            "took profit / still in. Prices only as side color, not every line. "
            "At least 3 lines clearly about a position or entry/SL."
        ),
        "must_any": ["trade_flex", "mild_disagree", "rekt_out"],
        "forbid_heavy": [],
    },
    {
        "id": "news_once",
        "primary": "one news gossip then leave it",
        "market_share": "medium",
        "instruction": (
            "PRIMARY: one selected/must news angle as casual gossip (2–4 lines max), "
            "then people react and move on. Do NOT re-explain news already in already_said_topics."
        ),
        "must_any": [],
        "forbid_heavy": [],
    },
    {
        "id": "off_meta",
        "primary": "crypto-adjacent off-topic",
        "market_share": "low",
        "instruction": (
            "PRIMARY: drift off pure price — AI tools, airdrop rumor, X/twitter drama, "
            "Telegram bot, game/NFT joke, or weekend plans. "
            "Majors (BTC/ETH/SOL) in ≤25% of lines. This batch must NOT rehash old news titles."
        ),
        "must_any": ["life_afk", "off_meta"],
        "forbid_heavy": [],
    },
    {
        "id": "alt_chase",
        "primary": "one alt / mover",
        "market_share": "medium",
        "instruction": (
            "PRIMARY: one alt from TOP MOVERS (or a secondary coin) as gossip — "
            "not touching / rekt / lol pump / entry where?. No shill, no contracts. "
            "Then 1–2 people bounce back briefly."
        ),
        "must_any": ["alt_mover", "meme_alts", "rekt_out"],
        "forbid_heavy": [],
    },
    {
        "id": "rekt_debate",
        "primary": "loss / disagreement / who is out",
        "market_share": "medium",
        "instruction": (
            "PRIMARY: stop-loss, got rekt, baghold fear, who is out vs still holding. "
            "Mild conflict. Do not restart the same news dump."
        ),
        "must_any": ["rekt_out", "mild_disagree", "trade_flex"],
        "forbid_heavy": [],
    },
    {
        "id": "life_afk",
        "primary": "life / AFK / human side",
        "market_share": "low",
        "instruction": (
            "PRIMARY: work, dinner, gym, sleep, brb, family — human side of a trader group. "
            "Only light chart comments. Majors in ≤20% of lines."
        ),
        "must_any": ["life_afk"],
        "forbid_heavy": [],
    },
    {
        "id": "btc_return",
        "primary": "short return to majors",
        "market_share": "medium",
        "instruction": (
            "PRIMARY: brief return to BTC/ETH after a detour — new micro-take only, "
            "no full re-scan of all levels and all old news. Then drift is ok."
        ),
        "must_any": [],
        "forbid_heavy": [],
    },
    {
        "id": "wind_down",
        "primary": "last short takes",
        "market_share": "low",
        "instruction": (
            "PRIMARY: wind down — short last takes, who is watching vs sleeping, "
            "no summary speech, no new news dump, no patience slogan."
        ),
        "must_any": [],
        "forbid_heavy": [],
    },
]

_BEAT_BY_ID = {b["id"]: b for b in BEAT_CATALOG}

# Role → soft personality (NOT a rigid script). Blur boundaries so readers
# cannot label "this is always Reactor" after a few lines.
ROLE_FINGERPRINTS: dict[str, dict[str, str]] = {
    "lead": {
        "style": (
            "talks a bit more / notices structure sometimes — still just a peer. "
            "Can know things; also sometimes wrong, unsure, or asks the room"
        ),
        "tics": (
            "chart notes mixed with 'not sure' / 'anyone checked?' / 'heard something' / "
            "plain reactions with no data"
        ),
        "avoid": (
            "only data dumps every turn; summing up the whole room; "
            "host transitions if overused ('speaking of' / 'back to')"
        ),
    },
    "reactor": {
        "style": (
            "quick emotional peer — short reactions and real takes (5–10 words). "
            "Can open threads. Lol/Ouch/Pain are fine in moderation"
        ),
        "tics": (
            "damn / nah / wait what / that hurt / wild / lol / ouch / pain — "
            "rotate; also full short opinions"
        ),
        "avoid": (
            "using the same reaction token almost every line; long macro essays"
        ),
    },
    "echo": {
        "style": (
            "often riffs on others; also disagrees, changes subject, or drops a new angle. "
            "Same/Not sold are fine sometimes — just not the only move"
        ),
        "tics": (
            "soft agree, pushback, 'wait different thing—', AFK, trade flex, "
            "occasionally Same / Not sold / Kinda"
        ),
        "avoid": (
            "Same/Not sold/Kinda as almost every reply in a batch; pure echo of lead only"
        ),
    },
    "member": {
        "style": (
            "quieter, dry; can go long silent then open something unexpected "
            "(work, alt, meme, random question)"
        ),
        "tics": "deadpan; late join; occasional 'wait what did I miss'; sometimes starts a new thread",
        "avoid": "host voice; only one-word forever; long multi-clause analysis",
    },
    "degen": {
        "style": "risk-on, impulsive, can brag size or chase — also gets scared and sits out",
        "tics": "size jokes, rekt energy, 'not touching'; sometimes quiet after a loss",
        "avoid": "formal macro; always bullish; host transitions",
    },
    "skeptic": {
        "style": "doubtful but not a broken record; can admit a move looks real once",
        "tics": "trap / fake / sit out; also 'ok maybe' when wrong",
        "avoid": "calling every green candle fake; summarizing the group",
    },
    "lurker": {
        "style": "rare; usually short; occasionally a cold accurate take that surprises",
        "tics": "shows up mid-thread; one sharp line then gone",
        "avoid": "long market monologues; becoming the host",
    },
}

# Extra persona flavor by cast slot so same role ≠ same voice
_PERSONA_FLAVOR: list[str] = [
    "slightly more impatient than the others",
    "slightly more chill / slower replies",
    "likes numbers less; talks vibe more",
    "likes concrete levels more; less slang",
    "often half-AFK / multitasking tone",
    "more FOMO-prone this session",
    "more capital-preservation mood today",
]

# Phrases that scream "AI moderator" in Telegram
_AI_TRANSITION_RE = re.compile(
    r"(?:"
    r"\bto sum up\b|\bsumming up\b|\bin summary\b|\boverall[,]?\b|"
    r"\bback to\b|\bspeaking of\b|"
    r"\bon another note\b|\bchanging (the )?topic\b|"
    r"\blet'?s (?:circle back|get back|move on|return)\b|"
    r"\bas (?:i|we) (?:said|mentioned) earlier\b|"
    r"\bto recap\b|\bin conclusion\b|"
    r"\banyway[,]?\s+back\b"
    r")",
    re.IGNORECASE,
)

_SOFT_ACK_LINE = re.compile(
    r"^\s*(yeah|yep|true|exactly|could be|might|maybe|fair|ok|okay|right|sure|"
    r"đúng|ừ|uh|hmm|haha|lol)\s*[.!?…]*\s*$",
    re.IGNORECASE,
)


def fingerprint_for_role(role: str) -> dict[str, str]:
    r = (role or "member").strip().lower()
    return ROLE_FINGERPRINTS.get(r, ROLE_FINGERPRINTS["member"])


def build_speaker_cards(speakers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Stable per-speaker personality cards for the LLM payload.

    Roles are soft priors only — each card must feel like a person, not a job title.
    """
    cards: list[dict[str, Any]] = []
    slot = 0
    for item in speakers:
        if not isinstance(item, dict):
            continue
        sid = str(item.get("id") or "").strip()
        if not sid:
            continue
        role = str(item.get("role") or "member").strip().lower()
        fp = fingerprint_for_role(role)
        flavor = _PERSONA_FLAVOR[slot % len(_PERSONA_FLAVOR)]
        slot += 1
        cards.append(
            {
                "id": sid,
                "role": role,
                "label": str(item.get("label") or "")[:40],
                "persona": (
                    f"Soft role hint '{role}' only — write as a unique person ({flavor}). "
                    "Do not act like a fixed NPC job every line."
                ),
                "style": fp["style"],
                "tics": fp["tics"],
                "avoid": fp["avoid"],
            }
        )
    return cards


def _pick_beat_ids(total_batches: int) -> list[str]:
    """Assign beat ids across batches for trader-group rhythm."""
    n = max(1, int(total_batches))
    if n == 1:
        return ["trade_desk"]  # single batch: force some position talk, not pure levels

    # Core rhythm template (will tile / trim)
    rhythm = [
        "market_scan",
        "trade_desk",
        "news_once",
        "off_meta",
        "alt_chase",
        "rekt_debate",
        "btc_return",
        "life_afk",
        "trade_desk",
        "off_meta",
        "btc_return",
        "wind_down",
    ]

    if n == 2:
        return ["market_scan", "trade_desk"]
    if n == 3:
        return ["market_scan", "trade_desk", "off_meta"]
    if n == 4:
        return ["market_scan", "trade_desk", "off_meta", "wind_down"]
    if n == 5:
        return ["market_scan", "trade_desk", "off_meta", "alt_chase", "wind_down"]

    out: list[str] = []
    # Always open with market, close with wind
    body_n = n - 2
    body_pool = [b for b in rhythm if b not in ("market_scan", "wind_down")]
    # Prefer unique consecutive primaries
    out.append("market_scan")
    i = 0
    while len(out) < n - 1 and body_n > 0:
        bid = body_pool[i % len(body_pool)]
        i += 1
        if out and out[-1] == bid:
            continue
        out.append(bid)
        if len(out) - 1 >= body_n:
            break
    # Pad if short
    while len(out) < n - 1:
        cand = body_pool[len(out) % len(body_pool)]
        if out[-1] == cand:
            cand = body_pool[(len(out) + 1) % len(body_pool)]
        out.append(cand)
    out.append("wind_down")
    return out[:n]


def beat_for_batch(batch_index: int, total_batches: int) -> dict[str, Any]:
    """1-based batch_index → beat dict for that chunk."""
    ids = _pick_beat_ids(total_batches)
    idx = max(0, min(len(ids) - 1, batch_index - 1))
    beat_id = ids[idx]
    base = dict(_BEAT_BY_ID.get(beat_id) or _BEAT_BY_ID["market_scan"])
    base["batch_index"] = batch_index
    base["total_batches"] = total_batches
    base["schedule"] = ids
    return base


def format_beat_block(beat: dict[str, Any], *, already_topics: list[str]) -> str:
    topics = ", ".join(already_topics) if already_topics else "none yet"
    share = beat.get("market_share") or "medium"
    share_rule = {
        "high": "Majors/news may dominate this batch (~50–70% of lines ok).",
        "medium": "Majors/news ≤ ~40% of lines; rest is the PRIMARY focus.",
        "low": "Majors/news ≤ ~25% of lines; PRIMARY must dominate.",
    }.get(str(share), "Keep market talk secondary unless primary is price.")
    return (
        f"BEAT id={beat.get('id')} primary={beat.get('primary')}\n"
        f"{beat.get('instruction')}\n"
        f"MARKET SHARE RULE: {share_rule}\n"
        f"Already covered themes (do not re-explain): {topics}\n"
        "If previous_tail is still on an old topic, transition in 1–2 lines then commit to this beat."
    )


_MAJOR_RE = re.compile(
    r"\b(btc|bitcoin|eth|ethereum|sol|solana|63k|64k|1750|1,?7\d{2}|around \d|near \d)\b",
    re.I,
)
_TRADE_RE = re.compile(
    r"\b(long|short|entry|stop|sl\b|tp\b|took profit|position|leverag|"
    r"bought|sold|scaled|still in|i'?m out|rekt|liquidat|"
    r"mua|bán|chốt|cắt lỗ|vào lệnh|stoploss)\b",
    re.I,
)
_OFF_META_RE = re.compile(
    r"\b(airdrop|ai\b|chatgpt|claude|bot|twitter|x\.com|nft|game|steam|"
    r"weekend|gym|dinner|work|brb|afk|sleep|family|meme)\b",
    re.I,
)
_NEWSISH_RE = re.compile(
    r"\b(grayscale|coinbase|sec\b|etf|cftc|clarity|nasdaq|foundation|cfo|"
    r"reshuffle|nominee|outflow)\b",
    re.I,
)


def major_density(lines: list[Any]) -> float:
    if not lines:
        return 0.0
    hits = 0
    for ln in lines:
        text = getattr(ln, "text", None) or (ln.get("text") if isinstance(ln, dict) else "") or ""
        if _MAJOR_RE.search(text):
            hits += 1
    return hits / max(1, len(lines))


def trade_density(lines: list[Any]) -> float:
    if not lines:
        return 0.0
    hits = 0
    for ln in lines:
        text = getattr(ln, "text", None) or (ln.get("text") if isinstance(ln, dict) else "") or ""
        if _TRADE_RE.search(text):
            hits += 1
    return hits / max(1, len(lines))


def off_meta_density(lines: list[Any]) -> float:
    if not lines:
        return 0.0
    hits = 0
    for ln in lines:
        text = getattr(ln, "text", None) or (ln.get("text") if isinstance(ln, dict) else "") or ""
        if _OFF_META_RE.search(text):
            hits += 1
    return hits / max(1, len(lines))


def newsish_density(lines: list[Any]) -> float:
    if not lines:
        return 0.0
    hits = 0
    for ln in lines:
        text = getattr(ln, "text", None) or (ln.get("text") if isinstance(ln, dict) else "") or ""
        if _NEWSISH_RE.search(text):
            hits += 1
    return hits / max(1, len(lines))


def beat_compliance_issues(
    lines: list[Any],
    beat: dict[str, Any],
    *,
    need_lines: int,
) -> list[str]:
    """Return human retry reasons if batch ignores its beat."""
    if need_lines < 8 or not lines:
        return []
    bid = str(beat.get("id") or "")
    share = str(beat.get("market_share") or "medium")
    issues: list[str] = []
    md = major_density(lines)
    td = trade_density(lines)
    od = off_meta_density(lines)
    nd = newsish_density(lines)

    if share == "low" and md >= 0.45:
        issues.append(
            f"Beat {bid} requires LOW major-price share but major density={md:.2f}. "
            "Most lines must follow PRIMARY (off-topic / life / wind), not BTC/ETH/SOL."
        )
    if share == "medium" and md >= 0.55:
        issues.append(
            f"Beat {bid}: too much major price talk (density={md:.2f}). "
            "Shift to PRIMARY focus; majors as side color only."
        )
    if bid == "trade_desk" and td < 0.15:
        issues.append(
            "Beat trade_desk: need clearer position talk "
            "(long/short, entry, SL, took profit, still in / out). "
            f"trade density={td:.2f} too low."
        )
    if bid in ("off_meta", "life_afk") and od < 0.12:
        issues.append(
            f"Beat {bid}: need human/off-meta lines (AI, airdrop, work, gym, bot, X…). "
            f"off-meta density={od:.2f} too low."
        )
    if bid == "rekt_debate" and td < 0.12 and od < 0.08:
        issues.append(
            "Beat rekt_debate: need rekt/SL/out vs still-in conflict, not another price loop."
        )
    if bid == "news_once" and nd > 0.45:
        issues.append(
            "Beat news_once: news gossip is too dense — 2–4 lines then leave it; rest reactions."
        )
    if bid in ("alt_chase", "off_meta", "life_afk", "rekt_debate") and nd >= 0.28:
        issues.append(
            f"Beat {bid}: re-hashing org news (Grayscale/Coinbase/SEC…) too much "
            f"(news density={nd:.2f}). Leave old news alone."
        )
    return issues


# Phrase reuse: crude tokens to ban restating
_STOP = {
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "of",
    "in",
    "on",
    "for",
    "is",
    "are",
    "be",
    "this",
    "that",
    "it",
    "we",
    "you",
    "i",
    "my",
    "our",
    "just",
    "still",
    "like",
    "with",
    "at",
    "as",
    "so",
    "but",
    "if",
    "not",
    "no",
    "yes",
    "yeah",
    "btc",
    "eth",
    "sol",
}


def extract_banned_phrases(lines: list[Any], *, limit: int = 18) -> list[str]:
    """Frequent multi-word-ish chunks already used — model must paraphrase differently."""
    from collections import Counter

    counts: Counter[str] = Counter()
    for ln in lines:
        text = getattr(ln, "text", None) or (ln.get("text") if isinstance(ln, dict) else "") or ""
        low = re.sub(r"[^a-z0-9àáạảãâăèéẹẻẽêìíịỉĩòóọỏõôơùúụủũưỳýỵỷỹđ\s%k$]", " ", text.lower())
        words = [w for w in low.split() if w and w not in _STOP and len(w) > 1]
        for i in range(len(words) - 1):
            bigram = f"{words[i]} {words[i + 1]}"
            if any(ch.isdigit() for ch in bigram) or len(bigram) >= 6:
                counts[bigram] += 1
        for i in range(len(words) - 2):
            tri = f"{words[i]} {words[i + 1]} {words[i + 2]}"
            if len(tri) >= 10:
                counts[tri] += 1
    # Prefer phrases seen more than once
    ranked = [p for p, c in counts.most_common(40) if c >= 2 or any(ch.isdigit() for ch in p)]
    return ranked[:limit]


def _line_text(ln: Any) -> str:
    return getattr(ln, "text", None) or (ln.get("text") if isinstance(ln, dict) else "") or ""


def _line_speaker(ln: Any) -> str:
    return str(
        getattr(ln, "speaker_id", None)
        or (ln.get("speaker_id") if isinstance(ln, dict) else "")
        or ""
    )


def _line_action(ln: Any) -> str:
    return str(
        getattr(ln, "action", None) or (ln.get("action") if isinstance(ln, dict) else "") or "send"
    )


def ai_transition_hits(lines: list[Any]) -> list[str]:
    """Return matched AI-moderator transition snippets found in lines."""
    found: list[str] = []
    for ln in lines:
        text = _line_text(ln)
        m = _AI_TRANSITION_RE.search(text)
        if m:
            found.append(m.group(0).strip().lower())
    return found


def topic_open_counts(lines: list[Any]) -> dict[str, int]:
    """
    Approximate who opens micro-threads (not pure reactions).
    Heuristic: non-reply, non-ack sends that start the batch or follow a
    reply / speaker change — i.e. someone kicking a new direction.
    """
    from collections import Counter

    opens: Counter[str] = Counter()
    for i, ln in enumerate(lines):
        if _line_action(ln) == "reply":
            continue
        text = (_line_text(ln) or "").strip()
        if not text or _SOFT_ACK_LINE.match(text):
            continue
        sid = _line_speaker(ln)
        if not sid:
            continue
        if i == 0:
            opens[sid] += 1
            continue
        prev = lines[i - 1]
        prev_sid = _line_speaker(prev)
        if _line_action(prev) == "reply" or prev_sid != sid:
            opens[sid] += 1
    return dict(opens)


def lead_ids_from_cards(speaker_cards: list[dict[str, Any]]) -> list[str]:
    return [
        str(c.get("id") or "").strip()
        for c in speaker_cards
        if isinstance(c, dict) and str(c.get("role") or "").lower() == "lead" and c.get("id")
    ]


def host_dominance_issues(
    lines: list[Any],
    *,
    speaker_cards: list[dict[str, Any]] | None = None,
    cast_ids: list[str] | None = None,
    need_lines: int,
) -> list[str]:
    """
    Detect one speaker (usually lead) hosting the room:
    - too high share of all lines
    - too high share of topic opens
    """
    if need_lines < 10 or not lines:
        return []
    from collections import Counter

    cards = speaker_cards or []
    leads = lead_ids_from_cards(cards)
    ids = cast_ids or [
        str(c.get("id") or "").strip() for c in cards if isinstance(c, dict) and c.get("id")
    ]
    if len(ids) < 3 and len(leads) < 1:
        return []

    counts = Counter(_line_speaker(ln) for ln in lines if _line_speaker(ln))
    n = max(1, sum(counts.values()))
    issues: list[str] = []

    # Any single speaker > 42% of lines when cast has 3+
    if len(ids) >= 3:
        for sid, c in counts.items():
            share = c / n
            if share >= 0.42:
                issues.append(
                    f"Speaker {sid} talks too much ({share:.0%} of lines). "
                    "Redistribute: other members must open topics and talk more. "
                    "Nobody hosts the room."
                )
                break

    opens = topic_open_counts(lines)
    total_opens = sum(opens.values())
    if total_opens >= 4:
        # Prefer checking lead; else top opener
        check_ids = leads or ([max(opens, key=opens.get)] if opens else [])  # type: ignore[arg-type]
        for sid in check_ids:
            oshare = opens.get(sid, 0) / max(1, total_opens)
            if oshare >= 0.55:
                issues.append(
                    f"Speaker {sid} opens too many threads ({opens.get(sid, 0)}/{total_opens}). "
                    "Non-lead members (reactor/degen/skeptic/member) must open ≥ half of "
                    "new micro-topics. Lead is a peer, not a moderator."
                )
                break
        # Even without lead role: one person shouldn't open ≥65%
        if opens:
            top_sid = max(opens, key=opens.get)  # type: ignore[arg-type]
            if opens[top_sid] / total_opens >= 0.65 and total_opens >= 5:
                issues.append(
                    f"Speaker {top_sid} dominates topic opens. "
                    "Spread thread-starts across cast."
                )

    return issues


def motif_rehash_issues(
    previous_lines: list[Any],
    batch_lines: list[Any],
    *,
    need_lines: int,
) -> list[str]:
    """
    If history already hammered specific levels/news tokens, batch must barely touch them.
    """
    if need_lines < 8 or not batch_lines:
        return []
    # Tokens that get over-chewed in long trader chats
    motifs = [
        ("63k", r"\b63\s*k\b"),
        ("64k", r"\b64\s*k\b"),
        ("1750", r"\b1,?7(?:45|50|48|52)\b"),
        ("avax_nasdaq", r"\bavax\b|\bnasdaq\b"),
        ("coinbase", r"\bcoinbase\b|\breshuffl"),
        ("grayscale", r"\bgrayscale\b|\bcfo\b"),
        ("perplexity_ai", r"\bperplexity\b|\bchatgpt\b|\bclaude\b"),
    ]
    prev_blob = " ".join(_line_text(ln) for ln in previous_lines).lower()
    batch_blob = " ".join(_line_text(ln) for ln in batch_lines).lower()
    issues: list[str] = []
    thick: list[str] = []
    for name, pat in motifs:
        cre = re.compile(pat, re.I)
        prev_n = len(cre.findall(prev_blob))
        batch_n = len(cre.findall(batch_blob))
        if prev_n >= 3 and batch_n >= 2:
            thick.append(f"{name}(prev={prev_n},batch={batch_n})")
        elif prev_n >= 2 and batch_n >= 3:
            thick.append(f"{name}(prev={prev_n},batch={batch_n})")
    if thick:
        issues.append(
            "Motif rehash too thick: "
            + ", ".join(thick)
            + ". Mention each at most once softly or skip; use NEW angles."
        )
    return issues

