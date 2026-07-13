from ....schemas.campaign import (
    CampaignScript,
    CampaignValidationData,
    CampaignValidationIssue,
)

def validate_campaign_script_structure(script: CampaignScript) -> CampaignValidationData:
    """Structural checks only — no style/craft bans or suggestions."""
    issues: list[CampaignValidationIssue] = []
    speaker_ids = {item.id for item in script.speakers}
    line_ids = {line.id for line in script.lines}
    refs_by_id = {line.id: line.script_ref for line in script.lines}

    if not script.group_link.strip():
        issues.append(
            CampaignValidationIssue(
                level="warning",
                code="missing_group",
                message="Chua nhap link nhom — can co truoc khi chay tac vu",
            )
        )

    phones = [item.phone.strip() for item in script.speakers if item.phone.strip()]
    if len(phones) != len(set(phones)):
        issues.append(
            CampaignValidationIssue(
                level="error",
                code="duplicate_phone",
                message="Hai vai dang dung cung mot so dien thoai",
            )
        )

    if not script.lines:
        issues.append(
            CampaignValidationIssue(
                level="error",
                code="no_lines",
                message="Khong co dong hop le trong kich ban",
            )
        )

    for line in script.lines:
        if line.speaker_id not in speaker_ids:
            issues.append(
                CampaignValidationIssue(
                    level="error",
                    code="unknown_speaker",
                    message=f"Dong #{line.id}: khong tim thay vai '{line.speaker_id}'",
                    line_id=line.id,
                )
            )
        if line.reply_to is not None and line.reply_to not in line_ids:
            target_ref = refs_by_id.get(line.reply_to)
            issues.append(
                CampaignValidationIssue(
                    level="error",
                    code="invalid_reply",
                    message=(
                        f"Dong #{line.script_ref} (id {line.id}): reply_to #{target_ref or line.reply_to} "
                        f"khong ton tai — dong dich co the bi bo qua khi parse (kiem tra ten vai)"
                    ),
                    line_id=line.id,
                )
            )

    if script.timing.delay_min_sec > script.timing.delay_max_sec:
        issues.append(
            CampaignValidationIssue(
                level="warning",
                code="delay_range",
                message="delay_min_sec lon hon delay_max_sec — se tu hoan doi khi chay",
            )
        )

    if (
        script.timing.speaker_change_delay_min_sec
        > script.timing.speaker_change_delay_max_sec
    ):
        issues.append(
            CampaignValidationIssue(
                level="warning",
                code="speaker_delay_range",
                message=(
                    "speaker_change_delay_min_sec lon hon max — se tu hoan doi khi chay"
                ),
            )
        )

    if script.timing.typing_min_sec > script.timing.typing_max_sec:
        issues.append(
            CampaignValidationIssue(
                level="warning",
                code="typing_range",
                message="typing_min_sec lon hon typing_max_sec — se tu hoan doi khi chay",
            )
        )

    has_errors = any(item.level == "error" for item in issues)
    return CampaignValidationData(
        valid=not has_errors and bool(script.lines),
        line_count=len(script.lines),
        issues=issues,
        script=script if script.lines else None,
    )