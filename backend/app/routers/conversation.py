from fastapi import APIRouter, HTTPException, Query

from ..schemas.common import ApiEnvelope
from ..schemas.conversation import (
    ConversationJobCreateData,
    ConversationJobCreateRequest,
    ConversationJobData,
    ConversationJobListData,
    ConversationParseRequest,
    ConversationScriptInput,
    ConversationValidateData,
)
from ..services.conversation import (
    conversation_job_store,
    conversation_runner,
    parse_conversation_script,
    validate_conversation_script,
)
from ..utils.responses import success_response


router = APIRouter(prefix="/conversation", tags=["conversation"])


@router.post("/validate", response_model=ApiEnvelope[ConversationValidateData])
async def validate_conversation(payload: ConversationScriptInput) -> dict:
    data = validate_conversation_script(payload)
    return success_response(data.model_dump())


@router.post("/parse", response_model=ApiEnvelope[ConversationValidateData])
async def parse_conversation(payload: ConversationParseRequest) -> dict:
    script, skipped = parse_conversation_script(payload)
    data = validate_conversation_script(script)
    if skipped:
        data.issues = skipped + data.issues
        if any(item.level == "error" for item in skipped):
            data.valid = False
    return success_response(data.model_dump())


@router.get("/jobs", response_model=ApiEnvelope[ConversationJobListData])
async def list_conversation_jobs(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict:
    jobs, total = conversation_job_store.list_jobs(limit=limit, offset=offset)
    data = ConversationJobListData(
        items=[conversation_job_store.to_summary(job) for job in jobs],
        total=total,
        limit=limit,
        offset=offset,
    )
    return success_response(data.model_dump())


@router.post("/jobs", response_model=ApiEnvelope[ConversationJobCreateData])
async def create_conversation_job(payload: ConversationJobCreateRequest) -> dict:
    script = payload.script
    if not script.group_link.strip():
        raise HTTPException(status_code=400, detail="Thieu link nhom")
    validation = validate_conversation_script(script)
    if not validation.valid or validation.script is None:
        message = validation.issues[0].message if validation.issues else "Kich ban khong hop le"
        raise HTTPException(status_code=400, detail=message)

    if payload.start_line_id is not None:
        line_ids = {line.id for line in script.lines}
        if payload.start_line_id not in line_ids:
            raise HTTPException(status_code=400, detail=f"start_line_id #{payload.start_line_id} khong ton tai")

    carried_results = payload.carried_line_results
    if payload.start_line_id is not None and carried_results:
        line_ids = {line.id for line in validation.script.lines}
        carried_results = [
            item
            for item in carried_results
            if item.line_id in line_ids
            and item.line_id < payload.start_line_id
            and item.status == "success"
        ]
    else:
        carried_results = []

    job = conversation_job_store.create(
        validation.script,
        start_line_id=payload.start_line_id,
        carried_line_results=carried_results,
    )
    started = conversation_runner.start(job.id or 0)
    if not started and job.id is not None:
        conversation_job_store.mark_finished(job.id, "error", "Job dang chay hoac khong khoi dong duoc")

    data = ConversationJobCreateData(
        job_id=job.id or 0,
        status=job.status,
        total_lines=job.total_lines,
    )
    return success_response(data.model_dump())


@router.get("/jobs/{job_id}", response_model=ApiEnvelope[ConversationJobData])
async def get_conversation_job(job_id: int) -> dict:
    job = conversation_job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Khong tim thay job")
    data = conversation_job_store.to_data(job)
    return success_response(data.model_dump())


@router.post("/jobs/{job_id}/resume", response_model=ApiEnvelope[ConversationJobData])
async def resume_conversation_job(job_id: int) -> dict:
    job = conversation_job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Khong tim thay job")
    if job.status == "running" or conversation_runner.is_active(job_id):
        raise HTTPException(status_code=409, detail="Job dang chay")
    if job.status not in ("stopped", "done", "error", "pending"):
        raise HTTPException(status_code=400, detail=f"Khong the resume job status={job.status}")

    started = conversation_runner.resume(job_id)
    if not started:
        raise HTTPException(status_code=409, detail="Khong the resume job")

    refreshed = conversation_job_store.get(job_id)
    data = conversation_job_store.to_data(refreshed)  # type: ignore[arg-type]
    return success_response(data.model_dump())


@router.post("/jobs/{job_id}/lines/{line_id}/retry", response_model=ApiEnvelope[ConversationJobData])
async def retry_conversation_line(job_id: int, line_id: int) -> dict:
    job = conversation_job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Khong tim thay job")
    if job.status == "running" or conversation_runner.is_active(job_id):
        raise HTTPException(status_code=409, detail="Job dang chay")

    script = conversation_job_store.load_script(job)
    line_ids = {line.id for line in script.lines}
    if line_id not in line_ids:
        raise HTTPException(status_code=404, detail=f"Khong tim thay dong #{line_id}")

    started = conversation_runner.retry_line(job_id, line_id)
    if not started:
        raise HTTPException(status_code=409, detail="Khong the retry dong nay")

    refreshed = conversation_job_store.get(job_id)
    data = conversation_job_store.to_data(refreshed)  # type: ignore[arg-type]
    return success_response(data.model_dump())


@router.post("/jobs/{job_id}/stop", response_model=ApiEnvelope[ConversationJobData])
async def stop_conversation_job(job_id: int) -> dict:
    job = conversation_job_store.request_stop(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Khong tim thay job")
    data = conversation_job_store.to_data(job)
    return success_response(data.model_dump())