from ...schemas.conversation import (
    ConversationScriptInput,
    ConversationValidateData,
    ConversationValidationIssue,
)

MAX_CONSECUTIVE_PER_SPEAKER = 4


def validate_conversation_script(script: ConversationScriptInput) -> ConversationValidateData:
    issues: list[ConversationValidationIssue] = []
    speaker_ids = {item.id for item in script.speakers}
    speaker_labels = {item.id: item.label for item in script.speakers}
    line_ids = {line.id for line in script.lines}
    refs_by_id = {line.id: line.script_ref for line in script.lines}

    if not script.group_link.strip():
        issues.append(
            ConversationValidationIssue(
                level="warning",
                code="missing_group",
                message="Chua nhap link nhom — can co truoc khi chay tac vu",
            )
        )

    if len(script.speakers) < 2:
        issues.append(
            ConversationValidationIssue(
                level="warning",
                code="single_speaker",
                message="Chi co 1 vai — hoi thoai can it nhat 2 nguoi",
            )
        )

    phones = [item.phone.strip() for item in script.speakers if item.phone.strip()]
    if len(phones) != len(set(phones)):
        issues.append(
            ConversationValidationIssue(
                level="error",
                code="duplicate_phone",
                message="Hai vai dang dung cung mot so dien thoai",
            )
        )

    if not script.lines:
        issues.append(
            ConversationValidationIssue(
                level="error",
                code="no_lines",
                message="Khong co dong hop le trong kich ban",
            )
        )

    for line in script.lines:
        if line.speaker_id not in speaker_ids:
            issues.append(
                ConversationValidationIssue(
                    level="error",
                    code="unknown_speaker",
                    message=f"Dong #{line.id}: khong tim thay vai '{line.speaker_id}'",
                    line_id=line.id,
                )
            )
        if line.reply_to is not None and line.reply_to not in line_ids:
            target_ref = refs_by_id.get(line.reply_to)
            issues.append(
                ConversationValidationIssue(
                    level="error",
                    code="invalid_reply",
                    message=(
                        f"Dong #{line.script_ref} (id {line.id}): reply_to #{target_ref or line.reply_to} "
                        f"khong ton tai — dong dich co the bi bo qua khi parse (kiem tra ten vai)"
                    ),
                    line_id=line.id,
                )
            )
        if len(line.text) > 500:
            issues.append(
                ConversationValidationIssue(
                    level="warning",
                    code="long_line",
                    message=f"Dong #{line.id}: cau dai ({len(line.text)} ky tu), co the khong tu nhien",
                    line_id=line.id,
                )
            )

    ordered = sorted(script.lines, key=lambda item: item.id)
    max_run = _max_consecutive_per_speaker(ordered)
    if max_run > MAX_CONSECUTIVE_PER_SPEAKER:
        issues.append(
            ConversationValidationIssue(
                level="error",
                code="max_consecutive",
                message=(
                    f"Mot vai noi lien tiep {max_run} cau — toi da {MAX_CONSECUTIVE_PER_SPEAKER}"
                ),
            )
        )

    if script.timing.delay_min_sec > script.timing.delay_max_sec:
        issues.append(
            ConversationValidationIssue(
                level="warning",
                code="delay_range",
                message="delay_min_sec lon hon delay_max_sec — se tu hoan doi khi chay",
            )
        )

    has_errors = any(item.level == "error" for item in issues)
    return ConversationValidateData(
        valid=not has_errors and bool(script.lines),
        line_count=len(script.lines),
        issues=issues,
        script=script if script.lines else None,
    )


def _max_consecutive_per_speaker(lines) -> int:
    max_run = 0
    current_run = 0
    previous_speaker = ""
    for line in lines:
        if line.speaker_id == previous_speaker:
            current_run += 1
        else:
            current_run = 1
            previous_speaker = line.speaker_id
        max_run = max(max_run, current_run)
    return max_run