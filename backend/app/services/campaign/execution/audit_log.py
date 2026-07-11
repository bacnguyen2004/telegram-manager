from ....db import metadata_store
from ....schemas.campaign import CampaignScript
from .store import campaign_job_store


def _primary_phone(script: CampaignScript) -> str:
    for speaker in script.speakers:
        phone = speaker.phone.strip()
        if phone:
            return phone
    return ""


def _timing_detail(script: CampaignScript) -> dict[str, int]:
    timing = script.timing
    return {
        "delay_min_sec": timing.delay_min_sec,
        "delay_max_sec": timing.delay_max_sec,
        "speaker_change_delay_min_sec": timing.speaker_change_delay_min_sec,
        "speaker_change_delay_max_sec": timing.speaker_change_delay_max_sec,
        "typing_min_sec": timing.typing_min_sec,
        "typing_max_sec": timing.typing_max_sec,
    }


def _map_finish_status(status: str) -> str:
    if status == "done":
        return "success"
    if status == "error":
        return "error"
    return "info"


def record_job_start(
    job_id: int,
    script: CampaignScript,
    *,
    only_line_id: int | None = None,
) -> None:
    phone = _primary_phone(script)
    if not phone:
        return

    peer_id = (script.peer_id or script.group_link).strip()
    detail: dict[str, object] = {
        "job_id": job_id,
        "total_lines": len(script.lines),
        "speakers": [f"{item.id}:{item.phone.strip()}" for item in script.speakers],
        **_timing_detail(script),
    }
    if only_line_id is not None:
        detail["only_line_id"] = only_line_id

    metadata_store.record_audit(
        phone,
        action="conversation.start",
        resource=peer_id or script.group_link.strip(),
        status="info",
        detail=detail,
    )


def record_job_finish(
    job_id: int,
    status: str,
    *,
    error_message: str | None = None,
    only_line_id: int | None = None,
) -> None:
    job = campaign_job_store.get(job_id)
    if job is None:
        return

    script = campaign_job_store.load_script(job)
    phone = _primary_phone(script)
    if not phone:
        return

    peer_id = (script.peer_id or script.group_link).strip()
    detail: dict[str, object] = {
        "job_id": job_id,
        "total_lines": job.total_lines,
        "completed_lines": job.completed_lines,
        "success_lines": job.success_lines,
        "error_lines": job.error_lines,
        "final_status": status,
    }
    if error_message:
        detail["error_message"] = error_message
    if only_line_id is not None:
        detail["only_line_id"] = only_line_id

    metadata_store.record_audit(
        phone,
        action="conversation.run",
        resource=peer_id or job.group_link.strip(),
        status=_map_finish_status(status),
        detail=detail,
    )