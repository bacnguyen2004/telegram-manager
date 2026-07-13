"""Prompts for AI campaign planner — technical JSON contract only.

No craft rules, bans, quality rubrics, or retry suggestions.
Style/intent come only from the UI goal (and optional market facts).
"""

from __future__ import annotations

import json
from typing import Any


SYSTEM_PROMPT = """You write a multi-account Telegram group chat about the crypto market.

TASK (always):
1) Write natural chat bubbles (crypto market today — price vibe, news, bags, reactions).
2) Distribute those messages reasonably across the user duration_min window
   (at_sec from 0 → near duration_min*60).
3) Return ONLY valid JSON (no markdown fences, no commentary).

JSON shape:
{
  "title": "short title",
  "duration_min": <int — copy from input>,
  "lines": [
    {
      "at_sec": <int, non-decreasing from 0>,
      "speaker_id": "<one id from cast_ids>",
      "action": "send" | "reply",
      "text": "one Telegram message bubble",
      "reply_to_line": <1-based earlier line in this batch, or null>
    }
  ]
}

Technical only:
- lines.length must equal target_lines exactly.
- speaker_id must be one of cast_ids.
- action="reply" → reply_to_line points to an earlier line in THIS batch.
- action="send" → reply_to_line=null.
- TIMELINE (from user INPUT duration_min):
  - First line at_sec ≈ 0; last line at_sec ≈ duration_min*60
    (20 min → ~1200; 60 min → ~3600).
  - Pace the WHOLE chat across that window — not all messages in the first 2–5 minutes.
  - Natural group chat: short bursts then longer pauses (not metronome-even).
  - If batch.at_sec_window is set, place THIS batch only inside start→end seconds.
  - Continuation: continue after previous_tail inside the given window.
- Write every line.text in the LANGUAGE required by the user payload / PREFS (see LANGUAGE).
- If LIVE MARKET FACTS are provided, do not invent prices, %, or headlines not listed.
- Prefer approximate wording over inventing alternate percentages.
- Prefer short Telegram bubbles over market-host recap sentences.
"""


CONTINUATION_SYSTEM_PROMPT = """You continue a multi-account Telegram crypto-market group chat.

TASK: keep writing the same chat, still paced across the global duration_min window.
Return ONLY valid JSON:
{
  "lines": [
    {
      "at_sec": <int, non-decreasing>,
      "speaker_id": "<one id from cast_ids>",
      "action": "send" | "reply",
      "text": "one Telegram message bubble",
      "reply_to_line": <1-based earlier line in this batch, or null>
    }
  ]
}

Technical only:
- Continue from previous_tail (do not restart the conversation).
- lines.length must equal need_lines exactly.
- speaker_id must be one of cast_ids.
- action/reply_to_line rules same as full plan.
- TIMELINE: non-decreasing at_sec; use batch.at_sec_window if present;
  full campaign ends near duration_min*60. Natural bursts + pauses.
- Keep the same LANGUAGE as previous_tail and LANGUAGE PREFS (do not switch languages mid-chat).
- If LIVE MARKET FACTS are provided, do not invent prices or headlines not listed there.
"""


def _cast_lines(payload: dict[str, Any]) -> list[str]:
    cards = payload.get("speaker_cards")
    if isinstance(cards, list) and cards:
        rows: list[str] = []
        for card in cards:
            if not isinstance(card, dict):
                continue
            rows.append(
                f"- id={card.get('id')} role={card.get('role')} "
                f"persona={card.get('persona') or ''}"
            )
        if rows:
            return rows

    rows: list[str] = []
    for item in payload.get("speakers") or []:
        if not isinstance(item, dict):
            continue
        rows.append(
            f"- id={item.get('id')} label={item.get('label')} "
            f"role={str(item.get('role') or 'member').strip().lower()}"
        )
    return rows


def _market_section(payload: dict[str, Any]) -> str:
    market_block = str(payload.get("market_brief") or "").strip()
    if not market_block:
        return ""
    return (
        "\n\n=== LIVE MARKET FACTS ===\n"
        f"{market_block}\n"
        "=== END LIVE MARKET FACTS ===\n"
    )


def _cast_ids(payload: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    for item in payload.get("speakers") or []:
        if not isinstance(item, dict):
            continue
        speaker_id = str(item.get("id") or "").strip()
        if speaker_id:
            ids.append(speaker_id)

    if not ids:
        for card in payload.get("speaker_cards") or []:
            if isinstance(card, dict) and card.get("id"):
                ids.append(str(card["id"]))

    return ids


def _shared_payload(payload: dict[str, Any], *, target_key: str) -> dict[str, Any]:
    cast_ids = _cast_ids(payload)
    return {
        "goal": payload.get("goal"),
        target_key: payload.get("target_lines"),
        "duration_min": payload.get("duration_min"),
        "density": payload.get("density") or "normal",
        "language": payload.get("language") or "auto",
        "cast": _cast_lines(payload),
        "cast_ids": cast_ids,
        "speaker_cards": payload.get("speaker_cards") or [],
        "batch": payload.get("batch") or {},
        "topic_bullets": payload.get("topic_bullets") or [],
        "selected_news": payload.get("selected_news") or [],
        "must_discuss_news": payload.get("must_discuss_news") or [],
        "news_keywords": payload.get("news_keywords") or [],
        "previous_tail": payload.get("previous_tail") or [],
    }


def _resolve_length_mix(payload: dict[str, Any]) -> tuple[int, int, int]:
    """Return short/medium/long percentages that sum to ~100."""
    s = payload.get("message_length_short_pct")
    m = payload.get("message_length_medium_pct")
    l = payload.get("message_length_long_pct")
    if all(isinstance(x, int) for x in (s, m, l)):
        total = int(s) + int(m) + int(l)  # type: ignore[arg-type]
        if total > 0:
            return int(s), int(m), int(l)  # type: ignore[arg-type]

    preset = str(payload.get("message_length_preset") or "mostly_short").lower()
    if preset == "mixed":
        return 50, 40, 10
    if preset == "detailed":
        return 30, 50, 20
    return 70, 25, 5  # mostly_short


def _batch_line_count(payload: dict[str, Any]) -> int | None:
    need = payload.get("target_lines") or payload.get("need_lines")
    try:
        n = int(need) if need is not None else None
    except (TypeError, ValueError):
        return None
    return n if n and n > 0 else None


def _fact_budget_prefs(payload: dict[str, Any]) -> list[str]:
    """Reaction-first chat when the live fact set is narrow (few coins + news)."""
    bits: list[str] = []
    has_market = bool(str(payload.get("market_brief") or "").strip())
    selected = payload.get("selected_news") or []
    must = payload.get("must_discuss_news") or []
    has_news = (
        (isinstance(selected, list) and len(selected) > 0)
        or (isinstance(must, list) and len(must) > 0)
    )
    if not has_market and not has_news:
        return bits

    intensity = str(payload.get("market_intensity") or "medium").lower()
    if intensity == "low":
        fact_pct, react_pct = 22, 78
    elif intensity == "high":
        fact_pct, react_pct = 42, 58
    else:
        fact_pct, react_pct = 30, 70

    n_lines = _batch_line_count(payload) or 40
    # Per major coin: ~8% of batch, clamp 2..4 for typical 30–50 line batches
    coin_cap = max(2, min(4, int(round(n_lines * 0.08)) or 2))
    movers_cap = 2 if n_lines >= 30 else 1
    must_cap = 2
    news_cap = 1

    bits.append(
        f"FACT vs REACTION MIX (narrow fact set is normal — do NOT invent more data): "
        f"~{fact_pct}% of lines may TOUCH a live fact (price vibe, % mover, or news paraphrase). "
        f"~{react_pct}% of lines must be pure REACTION with no new number and no re-stated headline — "
        f"feeling, expectation, strategy, joke, question, bag talk, wait-for-catalyst. "
        f"People discuss more than they re-announce the same print."
    )
    bits.append(
        f"FACT BUDGET (hard caps for this batch of ~{n_lines} lines): "
        f"BTC price/level wording ≤ {coin_cap} times; "
        f"ETH ≤ {coin_cap}; SOL ≤ {coin_cap}; "
        f"exact mover % mentions ≤ {movers_cap} total; "
        f"each selected news theme ≤ {news_cap} paraphrase"
        + (f"; must_discuss themes ≤ {must_cap} each" if must else "")
        + ". "
        "After a fact hits its cap, later mentions of that coin/news = reaction only "
        "(no restating the same number or 'still near Xk')."
    )
    bits.append(
        "ANGLE DIVERSITY (same topic OK, same wording FORBIDDEN): "
        "If the room is still about BTC, rotate angles — chart feel, volume dead, "
        "wait for US open / big news, 'thought we'd break', bag hold, FOMO/regret, "
        "ask someone else — NOT a chain of 'BTC still ~64k / sideway / chưa break / quanh 64k'. "
        "Example good stretch: "
        "'chart hôm nay buồn ngủ' → 'chưa chịu thoát vùng' → 'chờ tin lớn' → "
        "'tưởng sáng nay break' → 'volume im' → 'đợi Mỹ mở cửa' "
        "(topic BTC, zero repeated price print)."
    )
    bits.append(
        "FORBIDDEN fact loops: three or more lines that only rephrase the same price level "
        "or the same headline. Prefer short reactions after the first clear fact drop."
    )

    previous_tail = payload.get("previous_tail") or []
    if isinstance(previous_tail, list) and len(previous_tail) > 0:
        bits.append(
            "CONTINUATION FACT MEMORY: previous_tail already spent some fact mentions. "
            "Do NOT restart with the same BTC/ETH/SOL price wording from the tail. "
            "Advance angles; only spend remaining fact budget on a NEW angle or unspent news."
        )
    return bits


def _language_prefs(payload: dict[str, Any]) -> list[str]:
    """Hard language lock — language was only in JSON before and models often ignored it."""
    raw = str(payload.get("language") or "auto").strip().lower()
    if raw in {"", "auto"}:
        return [
            "LANGUAGE: follow the goal language; if goal mixes languages, pick the dominant one "
            "and stay consistent for all lines.text."
        ]
    if raw in {"en", "english", "eng"}:
        return [
            "LANGUAGE (HARD RULE): Write EVERY lines[].text in English only. "
            "FORBIDDEN: Vietnamese words, Vietnamese diacritics, or code-switching "
            "(no 'thôi', 'đúng', 'vẫn', 'quanh', 'chờ', etc.). "
            "Tickers (BTC/ETH/SOL) and numbers are fine. "
            "User goal may mention Language: English — obey that over any Vietnamese samples."
        ]
    if raw in {"vi", "vn", "vietnamese", "tieng viet", "tiếng việt"}:
        return [
            "LANGUAGE (HARD RULE): Write EVERY lines[].text in Vietnamese only "
            "(natural chat, diacritics OK). "
            "FORBIDDEN: full English sentences or English-only bubbles "
            "(loanwords like BTC, ETH, ok, lol are fine)."
        ]
    if raw in {"bilingual", "mix", "mixed", "vi+en", "en+vi", "vi_en"}:
        return [
            "LANGUAGE (HARD RULE): Bilingual Vietnamese + English chat is allowed. "
            "Mix naturally per speaker (some VI, some EN, or short code-switch). "
            "Do NOT force every line into one language."
        ]
    return [
        f"LANGUAGE (HARD RULE): Write all lines[].text in language code «{raw}». "
        "Do not switch away from that language."
    ]


def _generation_prefs(payload: dict[str, Any]) -> str:
    bits: list[str] = []
    bits.extend(_language_prefs(payload))
    bits.extend(_fact_budget_prefs(payload))

    # Explicit Telegram reply share (UI slider) — was missing from prefs before
    reply_rate = payload.get("reply_rate")
    n_lines = _batch_line_count(payload)
    try:
        rr = float(reply_rate) if reply_rate is not None else None
    except (TypeError, ValueError):
        rr = None
    if rr is not None and 0 < rr <= 1:
        pct = int(round(rr * 100))
        if n_lines is not None and n_lines >= 2:
            target_replies = max(1, min(n_lines - 1, int(round(n_lines * rr))))
            lo = max(1, target_replies - 1)
            hi = min(n_lines - 1, target_replies + 1)
            bits.append(
                f"TELEGRAM REPLY RATE: about {pct}% of lines must use action=\"reply\" "
                f"(target ~{target_replies} replies in this batch of {n_lines}, "
                f"acceptable {lo}–{hi}). "
                f"Each reply sets reply_to_line to an earlier 1-based line in THIS batch "
                f"(often the previous message or a recent question). "
                f"Remaining lines use action=\"send\" with reply_to_line=null. "
                f"FORBIDDEN: almost all send with zero replies when rate is {pct}%."
            )
        else:
            bits.append(
                f"TELEGRAM REPLY RATE: about {pct}% of lines must use action=\"reply\" "
                f"with reply_to_line pointing to an earlier line; rest are send."
            )

    numeric = str(payload.get("numeric_detail") or "approx").lower()
    if numeric == "none":
        bits.append("No exact prices or percents — vibes only (chilling, pumped, weak).")
    elif numeric == "exact":
        bits.append("When citing a figure, copy LIVE MARKET FACTS exactly.")
    else:
        bits.append(
            "Prefer approximate only (near 64k, up a lot). "
            "Do not invent alternate percentages for movers."
        )

    short_p, med_p, long_p = _resolve_length_mix(payload)
    bits.append(
        f"MESSAGE LENGTH MIX (by line count, not characters): "
        f"~{short_p}% SHORT (1–8 words, fragments OK), "
        f"~{med_p}% MEDIUM (9–16 words), "
        f"~{long_p}% LONG (17–28 words max). "
        "Do NOT make almost every line medium/complete sentences. "
        "Many lines should be just a few words (BTC chill / yeah / sol weak tho)."
    )

    style = str(payload.get("chat_style") or "messy").lower()
    allow_typos = bool(payload.get("allow_typos", False))
    allow_acks = bool(payload.get("allow_acks", True))
    allow_filler = bool(payload.get("allow_filler", False))

    if style == "clean":
        bits.append(
            "CHAT STYLE clean: short Telegram bubbles, mostly correct grammar."
        )
    elif style == "casual":
        bits.append(
            "CHAT STYLE casual: phone chat, fragments ok (tho, tbh, lol). "
            "Not every line is a full subject-verb sentence."
        )
    elif style == "degen":
        bits.append(
            "CHAT STYLE degen: crypto-group energy — lmao, ngmi, send it, bro. "
            "Very short, still readable."
        )
    else:
        bits.append(
            "CHAT STYLE messy: real Telegram — incomplete thoughts, short reactions, "
            "not polished host sentences."
        )

    # Split intensity: prefer continuous %; fall back to legacy enum
    split_pct_raw = payload.get("split_continue_pct")
    split_pct: int | None = None
    try:
        if split_pct_raw is not None:
            split_pct = max(0, min(100, int(split_pct_raw)))
    except (TypeError, ValueError):
        split_pct = None
    if split_pct is None:
        legacy = str(payload.get("split_bubbles") or "often").lower()
        split_pct = {"off": 0, "sometimes": 25, "often": 65}.get(legacy, 65)

    # Resolve max consecutive early — split prefs must respect this hard cap
    max_c = payload.get("max_consecutive_same_speaker")
    try:
        max_c_i = max(1, min(5, int(max_c))) if max_c is not None else 3
    except (TypeError, ValueError):
        max_c_i = 3

    # Core Telegram habit: short bubble then continue from SAME speaker
    if split_pct <= 15:
        bits.append(
            f"SPLIT BUBBLES ~{split_pct}% (LOW): almost no multi-bubble monologues. "
            "Prefer one complete bubble per turn, then SWITCH speaker. "
            "At most a rare double (ok → short take) — roughly 1 double per ~10 lines. "
            f"HARD: never more than {max_c_i} lines in a row from the same speaker_id. "
            "FORBIDDEN: open with 3–4 scene-setting lines from the same person "
            "(Morning / chart / BTC / news as one monologue)."
        )
    elif split_pct <= 40:
        bits.append(
            f"SPLIT BUBBLES ~{split_pct}%: about that share of adjacent pairs may be "
            "the SAME speaker continuing (short opener → real take). "
            "Example: 'ok' then 'BTC still chill near here'. "
            f"HARD CAP: max {max_c_i} consecutive lines from one speaker_id "
            "(a double/triple counts toward this). "
            "Do NOT pack both into one long message."
        )
    else:
        bits.append(
            f"SPLIT BUBBLES ~{split_pct}% (Telegram multi-bubble habit): "
            "many thoughts are 2 bubbles from the SAME speaker_id back-to-back. "
            "First bubble = tiny (ok / wait / yeah / true / lol / hmm) OR a short fragment. "
            "Second bubble = the actual point (i love this market / sol looks weak tho). "
            f"Target about {split_pct}% of adjacent pairs as same-speaker continues, "
            f"but NEVER exceed {max_c_i} consecutive lines from one speaker_id. "
            "FORBIDDEN: always one complete polished sentence per person then switch."
        )

    if allow_acks and style != "clean" and split_pct > 15:
        bits.append(
            "ACK / OPENER bubbles: pure short lines (ok, yeah, true, same, wait, lmao, idk) "
            "are valid as the FIRST half of a split — then continue on the next line."
        )
    if allow_typos:
        bits.append(
            "TYPOS optional: rare light typos only; never typo tickers or numbers."
        )
    if allow_filler:
        bits.append(
            "FILLER: rare playful one-liners only if they still fit the chat energy."
        )

    max_news = payload.get("max_news_topics")
    if isinstance(max_news, int) and max_news >= 0:
        bits.append(f"Use at most {max_news} news themes in this batch.")

    openers = payload.get("opening_speaker_ids") or []
    if openers:
        bits.append(
            f"If this is the first batch, first line speaker_id must be one of {openers}."
        )

    # Opening quality: only for first batch (no previous_tail). Ending stays loose.
    previous_tail = payload.get("previous_tail") or []
    is_first_batch = not (
        isinstance(previous_tail, list) and len(previous_tail) > 0
    )
    if is_first_batch:
        lang = str(payload.get("language") or "auto").strip().lower()
        if lang in {"en", "english", "eng"}:
            if split_pct <= 15:
                open_examples = (
                    "Examples (English, low-split — pick ONE style, not a template): "
                    "a: 'chart is dead today' → b: 'btc just sitting'; "
                    "or a: 'anyone still in sol' → b: 'bag stuck lol'; "
                    "or a: 'eth volume trash' → b: 'waiting on a catalyst'"
                )
            else:
                open_examples = (
                    "Examples (English): a: 'chart is dead today' → a: 'no real moves' "
                    "(only if split allows) → b: 'eth looking better tho?'"
                )
        elif lang in {"bilingual", "mix", "mixed", "vi+en", "en+vi", "vi_en"}:
            open_examples = (
                "Examples (mix OK): jump into chart/bag talk — not a formal greeting round."
            )
        else:
            if split_pct <= 15:
                open_examples = (
                    "Examples (VI, low-split — đổi style mỗi plan): "
                    "a: 'chart im quá' → b: 'btc quanh đây thoi'; "
                    "hoặc a: 'ai còn hold sol' → b: 'mình kẹt từ dip'; "
                    "hoặc a: 'eth volume yếu' → b: 'chờ catalyst'"
                )
            else:
                open_examples = (
                    "Examples (VI): a: 'chart im quá' → a: 'chưa break' (nếu split cho phép) "
                    "→ b: 'eth hôm nay sao'"
                )
        open_max = min(max_c_i, 2 if split_pct <= 15 else max_c_i)
        bits.append(
            "OPENING (first batch — real start; ending may trail off): "
            f"First {min(4, max(2, open_max + 1))} lines set the room WITHOUT one person monologuing. "
            f"HARD: opening run from one speaker_id ≤ {open_max} lines "
            f"(global max consecutive is {max_c_i}; low split ⇒ keep open short). "
            "Jump into chart / bag / coin talk — group already 'online', no formal greeting. "
            f"{open_examples}. "
            "FORBIDDEN first-line openers (overused templates): "
            "'Morning', 'Morning all', 'Good morning', 'GM', 'Gm everyone', "
            "'Chào buổi sáng', 'Sáng nay ae', 'Hello everyone', 'Hi all'. "
            "Do NOT start every plan with a time-of-day greeting. "
            "FORBIDDEN: four lines in a row from the lead (greeting + chart + BTC + news). "
            "FORBIDDEN: bare pure-ack only as the whole open. "
            "Opening must obey LANGUAGE hard rule above."
        )

    order = str(payload.get("speaker_order") or "natural").lower()

    bits.append(
        f"MAX CONSECUTIVE SAME SPEAKER (HARD CAP): never more than {max_c_i} "
        f"back-to-back lines with the same speaker_id anywhere in this batch "
        f"(including opening and splits). A 4th consecutive line from the same person is FORBIDDEN."
    )

    if order == "rotate":
        bits.append(
            "SPEAKER ORDER: rotate fairly between cast_ids (A-B-C-D-A-B…). "
            "Almost never send two lines in a row from the same speaker "
            f"(still hard-capped at {max_c_i})."
        )
    elif order == "messy":
        bits.append(
            "SPEAKER ORDER: messy, uneven. Pattern like a a · c · b b b · d · a. "
            f"Doubles/triples OK but never exceed {max_c_i} consecutive. "
            "FORBIDDEN: strict round-robin A-B-C-D-A-B-C-D."
        )
    elif order == "lead_heavy":
        bits.append(
            "SPEAKER ORDER: lead may speak more and take short doubles. "
            f"Others still appear. Consecutive same speaker ≤ {max_c_i}. "
            "FORBIDDEN: perfect rotation A-B-C-D each cycle."
        )
    else:
        # natural — allow doubles but respect hard max (do not force high same-speaker rate when max is low)
        if max_c_i <= 1:
            same_pair_hint = "Almost no same-speaker adjacent pairs."
        elif max_c_i == 2:
            same_pair_hint = (
                "Some doubles OK (~15–25% adjacent same speaker); no triples."
            )
        else:
            same_pair_hint = (
                f"About 20–35% adjacent pairs may be same speaker; max run {max_c_i}."
            )
        bits.append(
            "SPEAKER ORDER: natural Telegram group, NOT strict round-robin. "
            f"{same_pair_hint} "
            f"HARD CAP {max_c_i} consecutive. "
            "FORBIDDEN: lead monologue of 4+ scene lines at the start. "
            "FORBIDDEN patterns: strict A-B-C-D-A-B-C-D panel cycling only."
        )

    bits.append(
        "Match each speaker_card style (short vs detailed, slang, questions). "
        "Avoid host transitions: Switching gears / Back to markets / Overall / To summarize."
    )
    return "\n".join(f"- {b}" for b in bits)


def _task_block(payload: dict[str, Any], *, lines_key: str) -> str:
    """Clear mission line: crypto chat + distribute over user duration input."""
    try:
        mins = int(payload.get("duration_min") or 20)
    except (TypeError, ValueError):
        mins = 20
    mins = max(5, mins)
    span = mins * 60
    try:
        n_lines = int(payload.get(lines_key) or payload.get("target_lines") or 0)
    except (TypeError, ValueError):
        n_lines = 0
    batch = payload.get("batch") if isinstance(payload.get("batch"), dict) else {}
    window = batch.get("at_sec_window") if isinstance(batch, dict) else None

    lines_bit = f"{n_lines} messages" if n_lines > 0 else "the requested number of messages"
    task = (
        f"TASK: Write a natural multi-account Telegram chat about today's crypto market "
        f"({lines_bit}). Distribute messages reasonably across the user duration input "
        f"duration_min={mins} minutes (at_sec 0 → ~{span}). "
        f"Return only the JSON script."
    )
    if isinstance(window, dict) and window.get("start") is not None:
        task += (
            f" This batch only covers at_sec {window.get('start')}–{window.get('end')} "
            f"(global end {window.get('global_end', span)})."
        )
    return task


def build_user_prompt(payload: dict[str, Any]) -> str:
    target = payload.get("target_lines")
    body = _shared_payload(payload, target_key="target_lines")
    goal = str(payload.get("goal") or "").strip()
    goal_block = f"GOAL (from user):\n{goal}\n\n" if goal else ""
    prefs = _generation_prefs(payload)
    lang = str(payload.get("language") or "auto").strip()
    mins = int(body.get("duration_min") or 20)
    span = mins * 60
    task = _task_block(payload, lines_key="target_lines")

    return (
        f"{task}\n\n"
        f"{goal_block}"
        f"PREFS:\n{prefs}\n\n"
        f"{json.dumps(body, ensure_ascii=False, indent=2)}\n"
        f"{_market_section(payload)}"
        f"\nREQUIRED JSON: lines.length === {target}. "
        f"duration_min === {mins}. "
        f"All text in language={lang}. "
        f"last line at_sec ≈ {span}.\n"
    )


def build_continuation_prompt(payload: dict[str, Any]) -> str:
    need = payload.get("target_lines")
    body = _shared_payload(payload, target_key="need_lines")
    body["need_lines"] = need
    goal = str(payload.get("goal") or "").strip()
    goal_block = f"GOAL (from user):\n{goal}\n\n" if goal else ""
    prefs = _generation_prefs(payload)
    lang = str(payload.get("language") or "auto").strip()
    mins = int(body.get("duration_min") or 20)
    span = mins * 60
    task = _task_block(payload, lines_key="need_lines")

    return (
        f"{task}\n\n"
        f"{goal_block}"
        f"PREFS:\n{prefs}\n\n"
        f"{json.dumps(body, ensure_ascii=False, indent=2)}\n"
        f"{_market_section(payload)}"
        f"\nREQUIRED JSON: lines.length === {need}. "
        f"All text in language={lang}. "
        f"Global duration_min={mins} (campaign ends near {span}s).\n"
    )
