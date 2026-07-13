"""Public API for Hội thoại UI — thin HTTP adapter over CampaignWorkflow."""

from fastapi import APIRouter, HTTPException, Query

from ..schemas.campaign import (
    CampaignAiStatusData,
    CampaignJobCreateData,
    CampaignJobCreateRequest,
    CampaignJobData,
    CampaignMarketContext,
    CampaignPlanData,
    CampaignPlanRequest,
)
from ..schemas.common import ApiEnvelope
from ..services.campaign.workflow import (
    CampaignBadRequestError,
    CampaignConflictError,
    CampaignNotFoundError,
    CampaignUpstreamError,
    campaign_workflow,
)
from ..utils.responses import success_response

router = APIRouter(prefix="/campaign", tags=["campaign"])


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, CampaignNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, CampaignConflictError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, CampaignBadRequestError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, CampaignUpstreamError):
        return HTTPException(status_code=502, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


@router.get("/ai-status", response_model=ApiEnvelope[CampaignAiStatusData])
async def campaign_ai_status() -> dict:
    from ..services.ai.llm import ai_status_payload_async

    data = CampaignAiStatusData(**(await ai_status_payload_async()))
    return success_response(data.model_dump())


@router.post("/plan", response_model=ApiEnvelope[CampaignPlanData])
async def create_campaign_plan(payload: CampaignPlanRequest) -> dict:
    try:
        data = await campaign_workflow.create_plan(payload)
    except (CampaignBadRequestError, CampaignUpstreamError) as exc:
        raise _http_error(exc) from exc
    return success_response(data.model_dump())


@router.get("/market", response_model=ApiEnvelope[CampaignMarketContext])
async def campaign_market_snapshot(
    refresh: bool = False,
    q: str = Query(default="", max_length=120),
    tags: str = Query(
        default="",
        max_length=120,
        description="Comma-separated tags: btc,eth,sol,etf,regulation,macro,other",
    ),
) -> dict:
    """Preview live BTC/ETH/SOL prices + 24h news used for campaign grounding."""
    data = await campaign_workflow.market_snapshot(refresh=refresh, q=q, tags=tags)
    return success_response(data.model_dump())


@router.post("/jobs", response_model=ApiEnvelope[CampaignJobCreateData])
async def start_campaign_job(payload: CampaignJobCreateRequest) -> dict:
    try:
        data = campaign_workflow.start_job(payload)
    except CampaignBadRequestError as exc:
        raise _http_error(exc) from exc
    return success_response(data.model_dump())


@router.get("/jobs/{job_id}", response_model=ApiEnvelope[CampaignJobData])
async def get_campaign_job(job_id: int) -> dict:
    try:
        data = campaign_workflow.get_job(job_id)
    except CampaignNotFoundError as exc:
        raise _http_error(exc) from exc
    return success_response(data.model_dump())


@router.post("/jobs/{job_id}/stop", response_model=ApiEnvelope[CampaignJobData])
async def stop_campaign_job(job_id: int) -> dict:
    try:
        data = campaign_workflow.stop_job(job_id)
    except CampaignNotFoundError as exc:
        raise _http_error(exc) from exc
    return success_response(data.model_dump())


@router.post("/jobs/{job_id}/resume", response_model=ApiEnvelope[CampaignJobData])
async def resume_campaign_job(job_id: int) -> dict:
    """Continue a stopped/error job from remaining pending/error lines."""
    try:
        data = campaign_workflow.resume_job(job_id)
    except (
        CampaignNotFoundError,
        CampaignBadRequestError,
        CampaignConflictError,
    ) as exc:
        raise _http_error(exc) from exc
    return success_response(data.model_dump())
