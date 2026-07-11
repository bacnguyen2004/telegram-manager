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
other coin / AI / airdrop / bot / life → BTC briefly → drift again.
It does NOT loop mechanically through BTC → ETH → SOL → news → BTC.

Each generation batch has a HARD BEAT from beat / beat_block.
Make that PRIMARY dominate this batch.
Do not keep writing the same majors+news loop with new wording.

MARKET SHARE RULES come with the beat as high / medium / low.
If market_share=low, most lines are NOT about BTC/ETH/SOL prices.

=== SPEAKER PERSONALITIES (critical — blur roles) ===
Each speaker_id has a speaker_card: persona + style + tics + avoid.
"role" is only a SOFT prior, not a job title.

Rules:
- Act like a person with mood, not an NPC template.
- Mix moves: react, ask, disagree, change topic, go quiet, double-text, be wrong.
- Lead may cite data, but sometimes sounds unsure or asks others.
- Reactor may joke or complain, but must also have real short takes.
- Echo may agree sometimes, but must also push back, ignore, or open a topic.
- Member/lurker is usually quiet but may start a topic occasionally.
- Prefer distinct voices.
- The lead must not host the whole room.

=== NO HOST TRANSITIONS (critical) ===
Forbidden because they sound like AI or meeting narration:
"to sum up", "overall", "back to", "speaking of", "on another note",
"let's move on", "as I said earlier", "to recap", "in conclusion".
Real Telegram users just drop the next thought.

=== REDUCE OVERUSE (not hard bans) ===
These are fine in small amounts, but do not repeat the same reply shape:
- "Fair, but" / "Yeah, but" / "True, but"
- Same / Not sold / Kinda as openers
- Lol / Ouch / Pain / Wtf / Lmao
Rotate with natural alternatives: Nah / Idk / Looks off / Hard pass / Wait /
Hmm / Bro no / a real short take / an abrupt topic jump.

=== MESSAGE SHAPE (Telegram phone bubbles — critical) ===
Real Telegram messages are short.
Prefer short–long rhythm instead of polished complete sentences.

Target mix per batch:
| Length     | Share   | Pattern |
| 1–2 words  | ~5–10%  | pure micro-ack or reaction |
| 3–5 words  | 35–40%  | short take |
| 6–8 words  | 30–35%  | normal take |
| 9–12 words | 15–20%  | fuller take |
| >12 words  | 0–5%    | almost never; split into bubbles |

MICRO-ACK AS ITS OWN BUBBLE:
Less natural:
A: Me too, feels steady near here

More natural:
A: Me too
A: Feels steady near here

Pure micro-acks should remain uncommon overall, but when used, prefer a separate
bubble instead of gluing everything into one sentence.

=== SAME-SPEAKER BURSTS (required) ===
Real Telegram users often send several consecutive bubbles before someone responds.

For every batch:
- Include multiple same-speaker bursts.
- About 25–40% of all lines should belong to same-speaker consecutive sequences.
- Include several 2-message bursts.
- Include at least one 3-message burst when target_lines >= 15.
- A 4-message burst is allowed occasionally.
- Never allow more than 4 consecutive lines from one speaker.
- Do not force a speaker change after every message.
- Avoid mechanical A-B-C-D-A-B-C-D rotation.
- Avoid long clean A-B-A-B ping-pong.

Split one thought naturally:
Good:
A: Ok
A: That project sounds decent

Good:
B: Wait
B: Wrong chart
B: My bad

Good:
C: Yeah
C: Could work
C: Not buying yet though

Bad:
A: Ok, that project sounds decent and I might check it later

Better:
A: Ok
A: That project sounds decent
A: Might check it later

=== NATURAL MESSAGE TIMING (critical) ===
Do not distribute messages evenly across the full duration.
Telegram timing must be clustered and irregular.

Same-speaker consecutive bubbles:
- Usually 0–4 seconds apart.
- A quick correction may be 0–2 seconds apart.
- A follow-up thought may be 2–7 seconds apart.
- Two instant bubbles may share the same at_sec occasionally.
- Do not place normal double-text messages 20–60 seconds apart.

Direct replies:
- Usually 3–20 seconds after the relevant message.
- Sometimes reply later to an older line.

Normal pauses:
- Commonly 10–45 seconds.
- Occasionally 45–120 seconds when the room goes quiet.

Timing rules:
- Keep at_sec non-decreasing.
- Do not use nearly identical gaps repeatedly.
- Do not calculate duration / target_lines and spread messages evenly.
- duration_min is an approximate chat window, not a spacing formula.
- The final message does not need to land exactly on duration_min.

Good timing:
{"at_sec": 21, "speaker_id": "a", "action": "send", "text": "Ok", "reply_to_line": null}
{"at_sec": 22, "speaker_id": "a", "action": "send", "text": "That project sounds decent", "reply_to_line": null}

Good timing:
{"at_sec": 45, "speaker_id": "b", "action": "send", "text": "Wait", "reply_to_line": null}
{"at_sec": 47, "speaker_id": "b", "action": "send", "text": "Wrong chart", "reply_to_line": null}
{"at_sec": 50, "speaker_id": "b", "action": "send", "text": "My bad", "reply_to_line": null}

Good speaker rhythm:
A: BTC looks sleepy
A: Still holding though
C: Yeah
C: Volume looks weak
C: Or wait
C: Wrong timeframe
B: Lmao
A: Anyone checked that project?
B: Not yet
B: Looks decent from the homepage

=== REPLY BEHAVIOR ===
- Use replies only when someone is answering a specific earlier message.
- About 15–25% of lines may be replies.
- A reply must point to an earlier line in the same batch.
- Do not reply to your own immediately previous message unless correcting it is truly natural.
- Do not make every answer a formal reply.
- Sometimes reply to an older line after another topic briefly interrupts.

=== HUMAN MESS (critical) ===
The chat should feel slightly imperfect, not like polished copy:
- Slang: lol, lmao, bro, idk, wtf, nvm, my bad, wait, fr, tbh
- Incomplete thoughts: "or wait", "actually nvm", "ignore that"
- Small corrections or double-sends
- One slightly off-topic line sometimes
- Rare typo-ish wording is okay
Do not make every line a neat "Fair, but ETH still..." sentence.

=== ANTI-LOOP (price + motifs) ===
- do_not_reuse_phrases means banned phrase reuse.
- already_said_topics is context only; do not re-explain it.
- Repeat the same exact level at most 1–2 times in this batch.
- Prefer vibe language over repeating exact numbers.
- Each news theme should appear only 1–2 casual times in the full plan.
- TOP MOVERS are gossip context only, never promotional copy.

Good:
- Messy speaker order
- Same-speaker bursts
- Irregular timing
- Some delayed replies
- Short–long rhythm
- Non-leads opening topics

Bad:
- A-B-C-D panel rotation
- One message per speaker every turn
- Equal 28-second or 30-second gaps
- Lead hosting every topic
- Price in most lines
- Every reply starting with the same phrase
- All messages having similar length

Language lock: en | vi | auto from goal — one language only.
Market facts: only from LIVE MARKET FACTS.
Never invent prices, percentages, headlines, laws, ETF flows, dates, upgrades,
or organization actions.

Silent check before JSON:
1. Is the HARD BEAT clearly dominant?
2. Are voices distinct and varied?
3. Does the conversation progress instead of restating majors?
4. Are there several natural 2-message bursts?
5. Is there at least one 3-message burst when target_lines >= 15?
6. Are same-speaker burst gaps mostly 0–4 seconds?
7. Are the overall timing gaps irregular rather than evenly spaced?
8. Is the lead not hosting everything?
9. Are replies valid and used only when appropriate?
10. Are all facts grounded in LIVE MARKET FACTS?
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

Continue from previous_tail. Do not restart or summarize.
This batch has a NEW HARD BEAT. Switch naturally by saying the new thing,
without host transitions such as "speaking of", "back to", or "to sum up".

already_said_topics + do_not_reuse_phrases = banned rehash.
speaker_cards are soft personalities, not fixed NPC jobs.
Non-leads should open at least half of new threads.

Keep:
- Exact need_lines
- One language
- Mostly 3–8 word phone-chat messages
- A few 1–2 word bubbles
- Uneven participation
- Several same-speaker 2-message bursts
- At least one 3-message burst when need_lines >= 15
- Maximum 4 consecutive messages from one speaker
- About 25–40% of lines inside same-speaker bursts
- Same-speaker burst gaps usually 0–4 seconds
- Irregular pauses elsewhere
- Replies only when answering a specific earlier line
- About 15–25% replies

When agreeing and adding a thought, prefer two bubbles sometimes:
A: Me too
A: Feels steady near here

Do not:
- Alternate speakers after every line
- Spread timestamps evenly
- Put normal same-speaker double-texts 20–60 seconds apart
- Restart old BTC/ETH/SOL summaries
- Overuse Same / Not sold / Lol / Ouch / Pain
- Use cast names inside message text
- Invent facts not present in LIVE MARKET FACTS
"""


def _cast_lines(payload: dict[str, Any]) -> list[str]:
    cards = payload.get("speaker_cards")
    if isinstance(cards, list) and cards:
        rows: list[str] = []
        for card in cards:
            if not isinstance(card, dict):
                continue
            rows.append(
                f"- id={card.get('id')} role_hint={card.get('role')} "
                f"persona={card.get('persona') or 'unique person'} | "
                f"style={card.get('style')} | tics={card.get('tics')} | "
                f"avoid={card.get('avoid')}"
            )
        if rows:
            return rows

    rows: list[str] = []
    for item in payload.get("speakers") or []:
        if not isinstance(item, dict):
            continue
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
            "Do not invent exact prices, percentages, headlines, laws, ETF flows, "
            "dates, upgrades, or organization actions.\n"
            "=== END MARKET CONTEXT ===\n"
        )

    return (
        "\n\n=== LIVE MARKET FACTS ===\n"
        f"{market_block}\n"
        "This is the only factual ground truth. Use it casually, not as news copy.\n"
        "PRICE DISCIPLINE: exact levels must stay sparse unless the beat is market_scan.\n"
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

    return (
        "\n\n=== HARD BEAT FOR THIS BATCH (must dominate) ===\n"
        f"{block}\n"
        "=== END HARD BEAT ===\n"
    )


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
            "Tickers BTC/ETH/SOL are allowed. No English sentences."
        )
    return (
        "LANGUAGE AUTO: choose one language from the goal and keep it for every "
        "text field. Do not mix English and Vietnamese."
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


def _quality_rubric(target: Any) -> str:
    return (
        "\nQUALITY RUBRIC (conversation-level):\n"
        f"- Count: exactly {target} lines.\n"
        "- Beat: PRIMARY focus is obvious when skimming the batch.\n"
        "- Arc: not another majors+news recap with synonyms.\n"
        "- Anti-host: no meeting-like transitions or summaries.\n"
        "- Personalities: distinct voices; soft roles, not NPC templates.\n"
        "- Shape: most messages contain 3–8 words.\n"
        "- Micro-bubbles: a few natural 1–2 word lines.\n"
        "- Split thoughts: use separate bubbles for short reaction + main thought.\n"
        "- Replies: about 15–25%, only when contextually appropriate.\n"
        "- Speaker bursts: 25–40% of lines inside same-speaker sequences.\n"
        "- Burst count: several 2-message bursts.\n"
        "- Triple burst: at least one when target >= 15.\n"
        "- Burst cap: never more than 4 consecutive lines from one speaker.\n"
        "- Burst timing: same-speaker messages usually 0–4 seconds apart.\n"
        "- Overall timing: irregular clusters and pauses, never equal spacing.\n"
        "- Duration: final line need not land exactly on duration_min.\n"
        "- Speaker order: reject near-constant alternation.\n"
        "- Grounding: only facts included in LIVE MARKET FACTS.\n"
        "- Language: one language; no cast labels inside text.\n"
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
            "avoid": (
                "mechanical rotation, one-message-per-speaker rhythm, "
                "long A-B-A-B ping-pong, and equal timestamp intervals"
            ),
            "require": (
                "several same-speaker 2-message bursts; at least one "
                "3-message burst for batches >= 15 lines; maximum 4 consecutive"
            ),
            "target_share": (
                "about 25-40 percent of lines should be inside consecutive "
                "same-speaker bursts"
            ),
            "timing": (
                "same-speaker burst gaps usually 0-4 seconds; other gaps "
                "irregular from a few seconds to over one minute"
            ),
        },
    }


def validate_chat_rhythm(lines: list[dict[str, Any]]) -> list[str]:
    """Return human-readable rhythm errors for a generated batch."""
    errors: list[str] = []
    if not lines:
        return ["No lines generated"]

    same_speaker_pairs = 0
    max_consecutive = 1
    current_consecutive = 1
    gaps: list[int] = []

    for index, line in enumerate(lines):
        action = line.get("action")
        reply_to = line.get("reply_to_line")

        if action == "send" and reply_to is not None:
            errors.append(f"Line {index + 1}: send must use reply_to_line=null")
        elif action == "reply":
            if not isinstance(reply_to, int) or reply_to < 1 or reply_to >= index + 1:
                errors.append(
                    f"Line {index + 1}: reply_to_line must point to an earlier line"
                )

        if index == 0:
            continue

        previous = lines[index - 1]
        previous_time = int(previous.get("at_sec", 0))
        current_time = int(line.get("at_sec", 0))
        gap = current_time - previous_time
        gaps.append(gap)

        if gap < 0:
            errors.append(f"Line {index + 1}: at_sec decreased")

        if line.get("speaker_id") == previous.get("speaker_id"):
            same_speaker_pairs += 1
            current_consecutive += 1
            max_consecutive = max(max_consecutive, current_consecutive)
            if gap > 8:
                errors.append(
                    f"Lines {index}–{index + 1}: same-speaker gap is too long ({gap}s)"
                )
        else:
            current_consecutive = 1

    minimum_pairs = max(2, len(lines) // 6)
    if same_speaker_pairs < minimum_pairs:
        errors.append(
            "Too few same-speaker consecutive pairs: "
            f"{same_speaker_pairs}, expected at least {minimum_pairs}"
        )

    if len(lines) >= 15 and max_consecutive < 3:
        errors.append("No 3-message same-speaker burst found")

    if max_consecutive > 4:
        errors.append("More than 4 consecutive messages from one speaker")

    if len(gaps) >= 6:
        rounded = [round(gap / 2) * 2 for gap in gaps]
        most_common_count = max(rounded.count(value) for value in set(rounded))
        if most_common_count / len(rounded) >= 0.6:
            errors.append("Message timing looks evenly distributed")

    return errors


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
        "Obey the HARD BEAT: this batch must read as that focus, not a majors loop.\n\n"
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
        "The NEW HARD BEAT must progress the conversation without rehashing old topics.\n\n"
        f"{_language_rule(str(language))}\n\n"
        f"{json.dumps(body, ensure_ascii=False, indent=2)}\n"
        f"{_beat_section(payload)}"
        f"{_market_section(payload)}"
        f"{retry}"
        f"{_quality_rubric(need)}"
        f"\nREQUIRED JSON: lines.length === {need}.\n"
    )