"""Prompts for AI campaign planner (full + chunked continuation)."""

from __future__ import annotations

import json
from typing import Any


SYSTEM_PROMPT = """You are writing a realistic Telegram group chat between several accounts.

Return only valid JSON, with no markdown fences and no explanation:
{
  "title": "short title",
  "duration_min": <int>,
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

Technical contract:
- lines.length must equal target_lines exactly.
- speaker_id must be one of cast_ids.
- Keep one language for every text field.
- action="reply" must point to an earlier line in this batch.
- action="send" must use reply_to_line=null.
- Do not put cast labels, names, or phone numbers inside message text.
- No markdown, hashtags, links, or @mentions.

=== CONVERSATION > SENTENCES (most important) ===
Quality is judged on the WHOLE chat arc, not each line alone.
A real trader Telegram over ~100 messages has RHYTHM:
price scan → someone longs/shorts → "entry where?" → stop-loss pain →
other coin / AI / airdrop / bot / life → back to BTC briefly → drift again.
It does NOT loop: BTC → ETH → SOL → Grayscale → Coinbase → BTC → ETH…

Each generation batch has a HARD BEAT (see beat / beat_block in the payload).
You MUST make that PRIMARY dominate this batch. Do not keep writing the same
majors+news loop with new wording.

MARKET SHARE RULES come with the beat (high/medium/low).
If market_share=low, most lines are NOT about BTC/ETH/SOL prices.

=== SPEAKER PERSONALITIES (critical — blur roles) ===
Each speaker_id has a speaker_card: persona + style + tics + avoid.
"role" is only a SOFT prior, not a job title. Prefer variety so people don't
read as pure Reactor-bot or Echo-bot after many lines.

Rules (no hard bans — just avoid overusing one move):
- Act like a PERSON with mood, not an NPC template.
- Mix moves: react, ask, disagree, change topic, go quiet, double-text, be wrong.
- Lead: can cite data, but also sometimes unsure ("not sure", "anyone checked?",
  "could be wrong") so they don't always sound all-knowing.
- Reactor: Lol/Ouch/Pain/Wtf are fine in moderation — don't make every line that.
  Sprinkle real content takes too (5–10 words).
- Echo: "Same" / "Not sold" are fine sometimes — don't use them as the only reply shape.
  Also push back, ignore, or open a new angle.
- Member/lurker: usually quiet; can still START a topic once in a while.

Prefer distinct voices. Prefer lead not hosting the whole room.

=== NO HOST TRANSITIONS (critical) ===
FORBIDDEN phrases (they sound like AI/meeting host):
"to sum up", "overall…", "back to…", "speaking of…", "on another note",
"let's move on", "as I said earlier", "to recap", "in conclusion".
Real Telegram just drops the next thought with no stage direction.

=== REDUCE OVERUSE (not bans) ===
These are OK in small amounts — just don't spam the same shape every reply:
- "Fair, but…" / "Yeah, but…" / "True, but…" — fine 1–2 times, not every disagree
- Same / Not sold / Kinda as openers — fine occasionally, rotate with other moves
- Lol / Ouch / Pain / Wtf / Lmao — fine as flavor, not every reactor line
When you already used a crutch, next time pick something else: Nah / Idk /
Looks off / Hard pass / Wait / Hmm / Bro no / a real short take / jump topic.

=== MESSAGE SHAPE (Telegram phone bubbles — critical) ===
Real TG chats are SHORT. Prefer short–long rhythm without spam.

Target mix per batch:
| Length     | Share   | Pattern |
| 1–2 words  | ~5–10%  | pure micro-ack/react (sparing — not every few lines) |
| 3–5 words  | 35–40%  | short take |
| 6–8 words  | 30–35%  | normal take |
| 9–12 words | 15–20%  | fuller take |
| >12 words  | 0–5%    | almost never — prefer split (see double-tap) |

MICRO-ACK AS ITS OWN BUBBLE (pattern only — not a fixed word list):
Often Telegram is TWO messages, not one glued sentence:
  Less natural:  "Me too, feels like it's steady at 63k"
  More natural:  "Me too"
                 "Feels like it's steady at 63k"
Same idea: "True" / "Exactly" / "Yep" as the WHOLE first bubble, then the next
bubble (same speaker double-tap or another person) carries the rest.
You may still write one combined line sometimes — just not almost always.
Pure micro-acks stay uncommon overall (~5–10%), but when you use them, prefer
the split so readers actually see 1-word bubbles.

DOUBLE-TAP (optional, not required every time):
Also works for "A, but B" takes:
  "Could be fine" then "Volume looks low though"
Use when it feels natural.

Rhythm (GOOD):
A: BTC sleepy near here
B: True
A: Still holding?
C: Could be fine
C: Volume looks low though
B: Yep

=== HUMAN MESS (critical) ===
Chat should feel slightly imperfect — not polished essay:
- Slang: lol, lmao, bro, idk, wtf, nvm, my bad, wait, fr, tbh
- Incomplete: trailing "…", cut-off thought, "or wait—"
- Mind change: "actually nvm" / "wait no" / "ignore that"
- Offbeat: one line slightly off-topic then someone yanks back with "anyway eth"
- Typo-ish ok once in a while: "tht" / "gonna" / double-send fix
Do NOT make every line clean "Fair, but ETH still…"

=== ANTI-LOOP (price + motifs) ===
- do_not_reuse_phrases: ban paste.
- already_said_topics: context only, not re-explain.
- Same exact level (63k / 1750…) at most 1–2 times THIS batch; skip if already heavy in previous_tail.
- Prefer vibe without numbers: "still soft" / "holding up" / "looks heavy" over repeating "BTC 63k".
- Each news theme at most 1–2 casual hits FULL plan.

Good: messy speakers; non-leads open; doubles; ~15–25% replies; short–long rhythm.
Bad: lead hosts; panel A-B-C-D; price in most lines; "Fair, but" every reply; all 8-word lines.

Language lock: en | vi (diacritics) | auto from goal — one language only.
Market facts: only from LIVE MARKET FACTS. No invented prices/headlines.
TOP MOVERS: gossip only, no shill.

Silent check before JSON:
1. HARD BEAT primary obvious?
2. Voices varied (not one crutch phrase on repeat)?
3. Progressing vs restating same BTC/ETH level too often?
4. Some 1–2 word lines mixed in; short–long rhythm?
5. Lead not only data dumps; reactor not only reaction tokens?
"""


CONTINUATION_SYSTEM_PROMPT = """You continue an existing Telegram group chat.

Return only valid JSON:
{
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

Continue from previous_tail. Do NOT restart.
This batch has a NEW HARD BEAT — switch focus by just saying the new thing
(no "speaking of" / "back to" / "to sum up"). Do not synonym-loop majors+news.

already_said_topics + do_not_reuse_phrases = banned rehash.
speaker_cards = soft personalities (role is a hint only). Reduce role clichés:
less Same/Not sold every echo reply, less Lol/Ouch/Pain every reactor line,
lead sometimes unsure. Non-leads open ≥ half of new threads.

Keep: exact need_lines, same language, phone-chat length mix, uneven order,
occasional doubles, replies when answering.
LENGTH: most 3–8 words; a few pure 1–2 word bubbles (True / Me too / Exactly style).
When agreeing then adding a take: prefer TWO lines
  "Me too" + "Feels steady near here"
not almost always one line "Me too, feels steady near here".
Combined one-liners still allowed sometimes — no ban; just don't make them the default.
If one phrase repeats a lot, ease off.
No summary, no host voice, no cast names in text.
"""


def _cast_lines(payload: dict[str, Any]) -> list[str]:
    cards = payload.get("speaker_cards")
    if isinstance(cards, list) and cards:
        rows: list[str] = []
        for c in cards:
            if not isinstance(c, dict):
                continue
            rows.append(
                f"- id={c.get('id')} role_hint={c.get('role')} "
                f"persona={c.get('persona') or 'unique person'} | "
                f"style={c.get('style')} | tics={c.get('tics')} | avoid={c.get('avoid')}"
            )
        if rows:
            return rows
    cast = payload.get("speakers") or []
    rows = []
    for item in cast:
        role = str(item.get("role") or "member").strip().lower()
        rows.append(
            f"- id={item.get('id')} label={item.get('label')} role={role}"
        )
    return rows


def _market_section(payload: dict[str, Any]) -> str:
    market_block = str(payload.get("market_brief") or "").strip()
    if not market_block:
        return (
            "\n\n=== MARKET CONTEXT ===\n"
            "No live market facts are available. Keep the chat general. "
            "Do not invent exact prices, percentages, headlines, laws, ETF flows, or organization actions.\n"
            "=== END MARKET CONTEXT ===\n"
        )
    return (
        "\n\n=== LIVE MARKET FACTS ===\n"
        f"{market_block}\n"
        "Ground truth only. Casual chat, not news copy.\n"
        "PRICE DISCIPLINE: sparse levels; most lines zero exact prices unless beat is market_scan.\n"
        "=== END LIVE MARKET FACTS ===\n"
    )


def _beat_section(payload: dict[str, Any]) -> str:
    block = str(payload.get("beat_block") or "").strip()
    if not block:
        beat = payload.get("beat") or {}
        if isinstance(beat, dict) and beat.get("id"):
            block = (
                f"BEAT id={beat.get('id')} primary={beat.get('primary')}\n"
                f"{beat.get('instruction') or ''}"
            )
    if not block:
        return ""
    return f"\n\n=== HARD BEAT FOR THIS BATCH (must dominate) ===\n{block}\n=== END HARD BEAT ===\n"


def _language_rule(language: str | None) -> str:
    lang = (language or "auto").strip().lower()
    if lang in ("en", "english"):
        return (
            "LANGUAGE LOCK: English only. Casual phone English. "
            "No Vietnamese sentences."
        )
    if lang in ("vi", "vietnamese", "vn"):
        return (
            "LANGUAGE LOCK: Vietnamese only, with correct Vietnamese diacritics. "
            "Tickers BTC/ETH/SOL are ok. No English sentences."
        )
    return (
        "LANGUAGE AUTO: choose one language from the goal and keep it for every text field. "
        "Do not mix English and Vietnamese."
    )


def _cast_ids(payload: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    for item in payload.get("speakers") or []:
        sid = str(item.get("id") or "").strip()
        if sid:
            ids.append(sid)
    if not ids:
        for c in payload.get("speaker_cards") or []:
            if isinstance(c, dict) and c.get("id"):
                ids.append(str(c["id"]))
    return ids


def _quality_rubric(target: Any) -> str:
    return (
        "\nQUALITY RUBRIC (conversation-level):\n"
        f"- Count: exactly {target} lines.\n"
        "- Beat: PRIMARY focus of this batch is obvious if you skim the batch.\n"
        "- Arc: not another full majors+news recap with new synonyms.\n"
        "- Anti-host: non-leads open threads; no Speaking of / Back to / To sum up.\n"
        "- Personalities: soft roles — reduce cliché overuse, don't hard-ban phrases.\n"
        "- Lead: sometimes unsure/asks; Reactor/Echo: vary openers, not one template.\n"
        "- Shape: most 3–8 words; a few pure 1-word/2-word bubbles visible in the batch.\n"
        "- Prefer split: 'Me too' then next line for the take — not always 'Me too, …' one line.\n"
        "- Combined lines still ok sometimes; ease off spam; replies ~15–25%.\n"
        "- Grounding: only live market / selected news / goal facts.\n"
        "- Language: one language; no cast labels in text.\n"
    )


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
        "beat": payload.get("beat") or {},
        "topic_bullets": payload.get("topic_bullets") or [],
        "selected_news": payload.get("selected_news") or [],
        "must_discuss_news": payload.get("must_discuss_news") or [],
        "news_keywords": payload.get("news_keywords") or [],
        "previous_tail": payload.get("previous_tail") or [],
        "already_said_topics": payload.get("already_said_topics") or [],
        "do_not_reuse_phrases": payload.get("do_not_reuse_phrases") or [],
        "phase_guidance": payload.get("phase_instructions") or "",
        "speaker_usage": payload.get("speaker_usage") or {},
        "branch_hints": payload.get("branch_hints") or [],
        "anti_host_rule": payload.get("anti_host_rule") or "",
        "speaker_order_hint": {
            "avoid": "-".join(cast_ids + cast_ids) if cast_ids else "a-b-c-d-a-b-c-d",
            "prefer": (
                "uneven; non-leads open topics often; lead must not open every thread"
            ),
        },
    }


def build_user_prompt(payload: dict[str, Any]) -> str:
    target = payload.get("target_lines")
    language = payload.get("language") or "auto"
    body = _shared_payload(payload, target_key="target_lines")
    retry = ""
    if payload.get("instruction_retry"):
        retry = f"\n\nRETRY NOTE:\n{payload['instruction_retry']}\n"
    long_note = str(payload.get("long_plan_note") or "").strip()

    return (
        "Write this campaign chat batch as JSON only.\n"
        "Obey the HARD BEAT: the batch must read as that focus, not a majors loop.\n\n"
        f"{_language_rule(str(language))}\n\n"
        + (f"{long_note}\n\n" if long_note else "")
        + f"{json.dumps(body, ensure_ascii=False, indent=2)}\n"
        f"{_beat_section(payload)}"
        f"{_market_section(payload)}"
        f"{retry}"
        f"{_quality_rubric(target)}"
        f"\nREQUIRED JSON: lines.length === {target}.\n"
    )


def build_continuation_prompt(payload: dict[str, Any]) -> str:
    need = payload.get("target_lines")
    language = payload.get("language") or "auto"
    body = _shared_payload(payload, target_key="need_lines")
    body["need_lines"] = need
    retry = ""
    if payload.get("instruction_retry"):
        retry = f"\n\nRETRY NOTE:\n{payload['instruction_retry']}\n"

    return (
        "Continue the campaign chat as JSON only.\n"
        "NEW HARD BEAT this batch — progress the conversation; do not synonym-loop old topics.\n\n"
        f"{_language_rule(str(language))}\n\n"
        f"{json.dumps(body, ensure_ascii=False, indent=2)}\n"
        f"{_beat_section(payload)}"
        f"{_market_section(payload)}"
        f"{retry}"
        f"{_quality_rubric(need)}"
        f"\nREQUIRED JSON: lines.length === {need}.\n"
    )
