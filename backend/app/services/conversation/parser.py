import re

from ...schemas.conversation import (
    ConversationLineInput,
    ConversationParseRequest,
    ConversationScriptInput,
    ConversationSpeakerInput,
    ConversationTimingInput,
    ConversationValidationIssue,
)


_LINE_MARKER_RE = re.compile(
    r"^(?:#\s*)?(\d+)\s+([^:]{1,80}?)(?:\s+reply(?:_to)?\s+#?\s*(\d+))?\s*:\s*(.+)$",
    re.IGNORECASE,
)
_LINE_SIMPLE_REPLY_RE = re.compile(
    r"^([^:]{1,80}?)\s+reply(?:_to)?\s+#?\s*(\d+)\s*:\s*(.+)$",
    re.IGNORECASE,
)
_LINE_SIMPLE_RE = re.compile(r"^([^:]{1,80}):\s*(.+)$")
_ROUND_RE = re.compile(r"^Round\s+(\d+)\s*$", re.IGNORECASE)
_SEPARATOR_RE = re.compile(r"^-{3,}$")
_TELEGRAM_EXPORT_RE = re.compile(r"^\[\d{1,2}/\d{1,2}/\d{4}[^\]]*\]\s*[^:]+:\s*", re.IGNORECASE)
_PERSON_SPEAKER_RE = re.compile(r"^person\s*([a-z])$", re.IGNORECASE)


def _normalize_label(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def _clean_line(raw: str) -> str:
    line = raw.strip()
    if not line:
        return ""
    line = _TELEGRAM_EXPORT_RE.sub("", line).strip()
    return line


def _clean_speaker_label(value: str) -> str:
    speaker = re.sub(r"\s+", " ", value.strip())
    match = _PERSON_SPEAKER_RE.match(speaker)
    if match:
        return f"Person {match.group(1).upper()}"
    return speaker


def _speaker_id_for_label(
    label: str,
    speakers: list[ConversationSpeakerInput],
) -> str | None:
    cleaned = _clean_speaker_label(label)
    normalized = _normalize_label(cleaned)

    for speaker in speakers:
        if _normalize_label(speaker.label) == normalized:
            return speaker.id

    person_match = _PERSON_SPEAKER_RE.match(normalized)
    if person_match:
        index = ord(person_match.group(1).lower()) - ord("a")
        if 0 <= index < len(speakers):
            return speakers[index].id

    return None


def _finalize_parsed_lines(lines: list[ConversationLineInput]) -> list[ConversationLineInput]:
    if not lines:
        return []

    ordered = sorted(lines, key=lambda item: item.id)
    ref_map = {line.id: index for index, line in enumerate(ordered, start=1)}
    finalized: list[ConversationLineInput] = []

    for index, line in enumerate(ordered, start=1):
        script_ref = line.id
        reply_to = line.reply_to
        if reply_to is not None and reply_to in ref_map:
            reply_to = ref_map[reply_to]

        finalized.append(
            ConversationLineInput(
                id=index,
                script_ref=script_ref,
                speaker_id=line.speaker_id,
                text=line.text,
                reply_to=reply_to,
            )
        )

    return finalized


def parse_conversation_script(
    payload: ConversationParseRequest,
) -> tuple[ConversationScriptInput, list[ConversationValidationIssue]]:
    speakers = payload.speakers
    lines: list[ConversationLineInput] = []
    skipped: list[ConversationValidationIssue] = []
    next_auto_id = 1

    for raw in payload.script_text.splitlines():
        line = _clean_line(raw)
        if not line or _SEPARATOR_RE.match(line) or _ROUND_RE.match(line):
            continue

        script_number: int | None = None
        marker_match = _LINE_MARKER_RE.match(line)
        if marker_match:
            script_number = int(marker_match.group(1))
            label = marker_match.group(2).strip()
            reply_to = int(marker_match.group(3)) if marker_match.group(3) else None
            text = marker_match.group(4).strip()
            line_id = script_number
            next_auto_id = max(next_auto_id, script_number + 1)
        else:
            reply_match = _LINE_SIMPLE_REPLY_RE.match(line)
            if reply_match:
                label = reply_match.group(1).strip()
                reply_to = int(reply_match.group(2))
                text = reply_match.group(3).strip()
                line_id = next_auto_id
                script_number = line_id
                next_auto_id += 1
            else:
                simple_match = _LINE_SIMPLE_RE.match(line)
                if not simple_match:
                    continue
                label = simple_match.group(1).strip()
                text = simple_match.group(2).strip()
                line_id = next_auto_id
                script_number = line_id
                reply_to = None
                next_auto_id += 1

        speaker_id = _speaker_id_for_label(label, speakers)
        if not speaker_id or not text:
            ref = script_number if script_number is not None else "?"
            reason = "khong nhan dien duoc vai" if not speaker_id else "khong co noi dung"
            skipped.append(
                ConversationValidationIssue(
                    level="error",
                    code="skipped_line",
                    message=f"Dong #{ref} ({label or '?'}) bi bo qua — {reason}",
                    line_id=script_number if isinstance(script_number, int) else None,
                )
            )
            continue

        lines.append(
            ConversationLineInput(
                id=line_id,
                script_ref=script_number if script_number is not None else line_id,
                speaker_id=speaker_id,
                text=text,
                reply_to=reply_to,
            )
        )

    script = ConversationScriptInput(
        group_link=payload.group_link.strip(),
        peer_id=payload.peer_id,
        speakers=speakers,
        lines=_finalize_parsed_lines(lines),
        timing=payload.timing,
        reply_on_speaker_change=payload.reply_on_speaker_change,
        continue_on_error=payload.continue_on_error,
    )
    return script, skipped