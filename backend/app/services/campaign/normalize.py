"""Convert AI campaign plan → CampaignScript for existing runner."""

from __future__ import annotations

from typing import Any

from ...schemas.campaign import (
    CampaignPlan,
    CampaignPlanLine,
    CampaignScript,
    CampaignScriptLine,
    CampaignSpeakerInput,
    CampaignSpeakerRuntimeInput,
    CampaignTimingInput,
    CampaignValidationData,
    CampaignValidationIssue,
)
from .execution.validator import validate_campaign_script_structure


def _clamp_duration(minutes: int) -> int:
    from ...schemas.campaign import MAX_CAMPAIGN_DURATION_MIN

    return max(5, min(int(minutes or 20), MAX_CAMPAIGN_DURATION_MIN))


def _phone_sentence_case(text: str) -> str:
    """Phone keyboard auto-caps the first letter of each message."""
    t = (text or "").strip()
    if not t:
        return t
    # Keep intentional all-caps acronyms of 2–5 chars (BTC, ETH, OK…)
    if t.isupper() and 2 <= len(t) <= 5:
        return t
    first = t[0]
    if first.isalpha() and first.islower():
        return first.upper() + t[1:]
    return t


def sanitize_plan_replies(lines: list[CampaignPlanLine]) -> list[CampaignPlanLine]:
    """Ensure reply_to_line always points to an earlier line (1-based), else fix/downgrade."""
    fixed: list[CampaignPlanLine] = []
    for index, line in enumerate(lines):
        # Current line is 1-based = index + 1; valid reply targets are 1..index
        if line.action != "reply":
            fixed.append(line.model_copy(update={"action": "send", "reply_to_line": None}))
            continue
        reply = line.reply_to_line
        if reply is not None and 1 <= int(reply) <= index:
            fixed.append(line.model_copy(update={"reply_to_line": int(reply)}))
            continue
        if index > 0:
            # Default: reply to previous message
            fixed.append(line.model_copy(update={"action": "reply", "reply_to_line": index}))
        else:
            fixed.append(line.model_copy(update={"action": "send", "reply_to_line": None}))
    return fixed


def parse_plan_dict(raw: dict[str, Any]) -> CampaignPlan:
    lines_in = raw.get("lines") or []
    lines: list[CampaignPlanLine] = []
    for index, item in enumerate(lines_in):
        if not isinstance(item, dict):
            continue
        text = _phone_sentence_case(str(item.get("text") or "").strip())
        if not text:
            continue
        action = str(item.get("action") or "send").strip().lower()
        if action not in {"send", "reply"}:
            action = "send"
        reply_to = item.get("reply_to_line")
        try:
            reply_to_line = int(reply_to) if reply_to not in (None, "", 0) else None
        except (TypeError, ValueError):
            reply_to_line = None
        if action == "send":
            reply_to_line = None
        # reply must be earlier in THIS batch (1-based). Current line becomes len(lines)+1
        if action == "reply":
            cur_1based = len(lines) + 1
            if reply_to_line is None or reply_to_line < 1 or reply_to_line >= cur_1based:
                if len(lines) > 0:
                    reply_to_line = len(lines)  # previous
                else:
                    action = "send"
                    reply_to_line = None
        lines.append(
            CampaignPlanLine(
                at_sec=max(0, int(item.get("at_sec") or 0)),
                speaker_id=str(item.get("speaker_id") or "").strip(),
                action=action,  # type: ignore[arg-type]
                text=text[:4096],
                reply_to_line=reply_to_line,
            )
        )
    if not lines:
        raise ValueError("Plan khong co dong hop le")

    lines = sanitize_plan_replies(lines)

    # Non-decreasing times; same-speaker bursts allow tighter gaps (phone double-tap)
    ordered: list[CampaignPlanLine] = []
    last_t = -2
    last_speaker = ""
    for line in lines:
        min_gap = 2 if (ordered and line.speaker_id == last_speaker) else 3
        t = max(line.at_sec, last_t + min_gap)
        ordered.append(line.model_copy(update={"at_sec": t}))
        last_t = t
        last_speaker = line.speaker_id

    duration = _clamp_duration(int(raw.get("duration_min") or 20))
    title = str(raw.get("title") or "Campaign").strip()[:120] or "Campaign"
    return CampaignPlan(title=title, duration_min=duration, lines=ordered)


def plan_to_script(
    plan: CampaignPlan,
    *,
    speakers: list[CampaignSpeakerInput],
    group_link: str,
    peer_id: str | None = None,
) -> CampaignScript:
    speaker_models = [
        CampaignSpeakerRuntimeInput(
            id=item.id.strip(),
            label=(item.label or item.id).strip()[:80] or item.id,
            phone=item.phone.strip(),
        )
        for item in speakers
    ]
    speaker_ids = {s.id for s in speaker_models}

    conv_lines: list[CampaignScriptLine] = []
    for index, line in enumerate(plan.lines, start=1):
        sid = line.speaker_id
        if sid not in speaker_ids:
            # try case-insensitive / fallback first speaker
            match = next((s for s in speaker_models if s.id.lower() == sid.lower()), None)
            sid = match.id if match else speaker_models[0].id

        reply_to: int | None = None
        if line.action == "reply" and line.reply_to_line:
            # reply_to_line is 1-based index in plan.lines
            target = int(line.reply_to_line)
            if 1 <= target < index:
                reply_to = target

        conv_lines.append(
            CampaignScriptLine(
                id=index,
                script_ref=index,
                speaker_id=sid,
                text=line.text.strip(),
                reply_to=reply_to,
                # Absolute schedule from campaign plan (runner folds typing into this)
                at_sec=max(0, int(line.at_sec or 0)),
            )
        )

    # Fallback ranges only used if schedule_mode is off; campaign keeps them mild
    same_gaps: list[int] = []
    change_gaps: list[int] = []
    for i in range(1, len(plan.lines)):
        g = max(1, plan.lines[i].at_sec - plan.lines[i - 1].at_sec)
        if plan.lines[i].speaker_id == plan.lines[i - 1].speaker_id:
            same_gaps.append(g)
        else:
            change_gaps.append(g)

    if same_gaps:
        mid_s = sorted(same_gaps)[len(same_gaps) // 2]
        delay_min = max(2, min(5, int(mid_s * 0.5) or 2))
        delay_max = max(delay_min + 1, min(12, int(mid_s * 1.2) or 6))
    else:
        delay_min, delay_max = 3, 8

    if change_gaps:
        mid_c = sorted(change_gaps)[len(change_gaps) // 2]
        change_min = max(delay_max + 1, min(180, int(mid_c * 0.65) or 8))
        change_max = max(change_min + 2, min(240, int(mid_c * 1.25) or 16))
    elif same_gaps:
        change_min, change_max = max(8, delay_max + 2), max(14, delay_max + 8)
    else:
        change_min, change_max = 8, 18

    timing = CampaignTimingInput(
        delay_min_sec=min(delay_min, 600),
        delay_max_sec=min(delay_max, 600),
        speaker_change_delay_min_sec=min(change_min, 900),
        speaker_change_delay_max_sec=min(change_max, 900),
        # Typing is folded INTO at_sec gaps (not added on top)
        typing_min_sec=2,
        typing_max_sec=7,
    )

    return CampaignScript(
        version=1,
        group_link=group_link.strip(),
        peer_id=(peer_id or group_link).strip() or None,
        speakers=speaker_models,
        lines=conv_lines,
        timing=timing,
        # Campaign plans already mark reply vs send explicitly (action + reply_to_line).
        reply_on_speaker_change=False,
        # One restricted acc (can't write) should not kill the whole campaign
        continue_on_error=True,
        # Absolute at_sec schedule — typing counted inside each gap
        schedule_mode=True,
    )


def validate_campaign_script(script: CampaignScript) -> CampaignValidationData:
    data = validate_campaign_script_structure(script)
    # Campaign requires group before start
    if not script.group_link.strip():
        data.issues = [
            CampaignValidationIssue(
                level="error",
                code="missing_group",
                message="Thieu link nhom / peer de chay chien dich",
            ),
            *data.issues,
        ]
        data.valid = False
    return data
