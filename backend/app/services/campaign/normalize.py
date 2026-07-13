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


def _min_gap_for(plan: CampaignPlan, i: int) -> int:
    """Min seconds between line i-1 and i."""
    if i <= 0:
        return 0
    same = plan.lines[i].speaker_id == plan.lines[i - 1].speaker_id
    return 2 if same else 3


def _cluster_burst_indices(
    times: list[int],
    *,
    burst_gap_max: int,
    max_burst_size: int = 6,
) -> list[list[int]]:
    """Group line indices into bursts (adjacent gaps <= burst_gap_max).

    Caps burst length so a multi-chunk dump of 30 tight msgs becomes several
    short bursts we can pause between — not one monologue block.
    """
    if not times:
        return []
    max_burst_size = max(2, int(max_burst_size))
    bursts: list[list[int]] = [[0]]
    for i in range(1, len(times)):
        gap = times[i] - times[i - 1]
        same_burst = gap <= burst_gap_max and len(bursts[-1]) < max_burst_size
        if same_burst:
            bursts[-1].append(i)
        else:
            bursts.append([i])
    return bursts


def _split_oversized_bursts(
    bursts: list[list[int]],
    *,
    max_burst_size: int = 6,
) -> list[list[int]]:
    out: list[list[int]] = []
    for idxs in bursts:
        if len(idxs) <= max_burst_size:
            out.append(idxs)
            continue
        for start in range(0, len(idxs), max_burst_size):
            chunk = idxs[start : start + max_burst_size]
            # Avoid leaving a singleton tail when possible
            if (
                len(chunk) == 1
                and out
                and len(out[-1]) < max_burst_size
            ):
                out[-1].extend(chunk)
            else:
                out.append(chunk)
    return out


def _place_bursts_across_span(
    plan: CampaignPlan,
    times_in: list[int],
    span_target: int,
) -> list[int]:
    """Map messages across the full duration with natural bursts + pauses.

    Linear scale alone preserves pathological multi-chunk shapes (all chat in
    the first 2 minutes, then an 18-minute dead zone). This clusters tight
    AI gaps into bursts and redistributes *pauses between bursts* evenly.
    """
    n = len(times_in)
    if n <= 1:
        return [0] * n

    # Ideal number of bursts for this duration (~one every 1.5–2 min)
    ideal_bursts = max(2, min(n // 2, max(4, span_target // 100)))
    max_burst_size = max(2, min(6, (n + ideal_bursts - 1) // ideal_bursts))

    # Treat gaps up to this as "same burst" (phone double-tap / quick reply)
    burst_gap_max = 45
    bursts = _cluster_burst_indices(
        times_in, burst_gap_max=burst_gap_max, max_burst_size=max_burst_size
    )
    if len(bursts) < min(ideal_bursts, n) and n >= 6:
        bursts = _cluster_burst_indices(
            times_in, burst_gap_max=20, max_burst_size=max_burst_size
        )
    bursts = _split_oversized_bursts(bursts, max_burst_size=max_burst_size)
    if len(bursts) < 2:
        # Fallback: chunk into groups of 3–5
        bursts = []
        i = 0
        while i < n:
            size = min(max_burst_size, 4 if n - i > 5 else max(1, n - i))
            if n - i - size == 1:
                size = n - i
            bursts.append(list(range(i, min(n, i + size))))
            i += size

    # Internal gaps inside each burst (keep AI micro-timing, clamp 2–40s)
    internal: list[list[int]] = []
    for bi, idxs in enumerate(bursts):
        igaps: list[int] = []
        for j in range(1, len(idxs)):
            li = idxs[j]
            raw_g = max(0, times_in[li] - times_in[idxs[j - 1]])
            g = raw_g if raw_g > 0 else _min_gap_for(plan, li)
            g = max(_min_gap_for(plan, li), min(40, g))
            igaps.append(g)
        internal.append(igaps)

    burst_spans = [sum(ig) for ig in internal]
    total_internal = sum(burst_spans)
    pause_slots = max(0, len(bursts) - 1)
    # Leave ~55–70% of time for inter-burst pauses (group-chat feel)
    pause_budget = max(0, span_target - total_internal)
    if pause_slots == 0:
        pauses: list[int] = []
    else:
        # Even-ish pauses with mild variation from original AI inter-burst gaps
        raw_pauses: list[int] = []
        for bi in range(pause_slots):
            a = bursts[bi][-1]
            b = bursts[bi + 1][0]
            raw_pauses.append(max(0, times_in[b] - times_in[a]))
        # Cap absurd AI pauses before weighting
        max_raw = max(90, int(span_target * 0.12))
        capped = [min(max_raw, max(30, p if p > 0 else 60)) for p in raw_pauses]
        weight_sum = sum(capped) or 1
        pauses = []
        left = pause_budget
        for i, w in enumerate(capped):
            if i == pause_slots - 1:
                pauses.append(max(30, left))
            else:
                p = int(round(pause_budget * (w / weight_sum)))
                p = max(30, min(max_raw, p))
                p = min(p, left - 30 * (pause_slots - i - 1))
                pauses.append(max(30, p))
                left -= pauses[-1]

        # If pause budget too small, shrink mins
        if sum(pauses) > pause_budget and pause_budget > 0:
            scale = pause_budget / sum(pauses)
            pauses = [max(15, int(round(p * scale))) for p in pauses]
            # Fix sum
            drift = pause_budget - sum(pauses)
            if pauses:
                pauses[-1] = max(15, pauses[-1] + drift)

    # Build absolute times
    out = [0] * n
    t = 0
    for bi, idxs in enumerate(bursts):
        out[idxs[0]] = t
        for j, li in enumerate(idxs[1:], start=1):
            t = out[idxs[j - 1]] + internal[bi][j - 1]
            out[li] = t
        if bi < len(pauses):
            t = out[idxs[-1]] + pauses[bi]
        else:
            t = out[idxs[-1]]

    # Snap end to span_target
    if out[-1] <= 0:
        return [int(round(i * span_target / (n - 1))) for i in range(n)]

    if out[-1] != span_target:
        # Prefer extending the last pause rather than scaling micro-bursts
        deficit = span_target - out[-1]
        if deficit > 0 and pause_slots > 0:
            # Push everything after first burst proportionally for residual only
            scale = span_target / float(out[-1])
            out = [int(round(x * scale)) for x in out]
        elif deficit < 0:
            scale = span_target / float(out[-1])
            out = [int(round(x * scale)) for x in out]
        out[0] = 0
        out[-1] = span_target

    # Enforce min gaps
    for i in range(1, n):
        out[i] = max(out[i], out[i - 1] + _min_gap_for(plan, i))
    if out[-1] > span_target and out[-1] > 0:
        scale = span_target / float(out[-1])
        out = [int(round(x * scale)) for x in out]
        out[0] = 0
        for i in range(1, n):
            out[i] = max(out[i], out[i - 1] + _min_gap_for(plan, i))
        out[-1] = max(out[-1], out[-2] + _min_gap_for(plan, n - 1)) if n > 1 else 0
        if out[-1] > span_target * 1.08:
            # Last resort: even-ish end fix
            out[-1] = span_target
    elif out[-1] < span_target * 0.92:
        # Stretch residual into the last inter-message gap that is a pause
        out[-1] = span_target

    return out


def fit_timeline_to_duration(
    plan: CampaignPlan,
    duration_min: int | None = None,
) -> CampaignPlan:
    """Fit plan.at_sec into ~duration_min with natural burst/pause rhythm.

    - Fills the full window (20 min request → last ≈ 1200s).
    - Avoids multi-chunk pathology: 40 msgs in 2 min then 18 min silence.
    - Keeps tight AI gaps as short bursts; redistributes long pauses.
    """
    if not plan.lines:
        return plan

    mins = _clamp_duration(int(duration_min or plan.duration_min or 20))
    span_target = max(60, mins * 60)
    n = len(plan.lines)

    raw = [max(0, int(line.at_sec or 0)) for line in plan.lines]
    base = raw[0]
    times = [t - base for t in raw]
    last = times[-1] if times else 0

    if n == 1:
        times = [0]
    elif last <= 0:
        times = [int(round(i * span_target / (n - 1))) for i in range(n)]
    else:
        times = _place_bursts_across_span(plan, times, span_target)

    # Final safety: first=0, non-decreasing, end near span
    times[0] = 0
    for i in range(1, n):
        times[i] = max(times[i], times[i - 1] + _min_gap_for(plan, i))
    if n > 1 and times[-1] < span_target:
        times[-1] = span_target
        for i in range(n - 2, 0, -1):
            times[i] = min(times[i], times[i + 1] - _min_gap_for(plan, i + 1))
            times[i] = max(times[i], times[i - 1] + _min_gap_for(plan, i))

    new_lines = [
        line.model_copy(update={"at_sec": times[i]})
        for i, line in enumerate(plan.lines)
    ]
    return plan.model_copy(update={"lines": new_lines, "duration_min": mins})


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
    # Guarantee runtime length matches plan.duration_min (AI often under-schedules)
    plan = fit_timeline_to_duration(plan, plan.duration_min)

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
