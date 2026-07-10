from fastapi import APIRouter, HTTPException, Query

from ..db import metadata_store
from ..schemas.campaign import (
    CampaignAiStatusData,
    CampaignGoalDraftData,
    CampaignGoalDraftRequest,
    CampaignInjectData,
    CampaignInjectRequest,
    CampaignJobCreateData,
    CampaignJobCreateRequest,
    CampaignMarketContext,
    CampaignPlanData,
    CampaignPlanRequest,
)
from ..schemas.common import ApiEnvelope
from ..schemas.conversation import ConversationJobData
from ..services.campaign import (
    plan_campaign,
    plan_to_conversation_script,
    validate_campaign_script,
)
from ..services.campaign.goal_draft import build_goal_draft
from ..services.campaign.inject import inject_into_job
from ..services.conversation import conversation_job_store, conversation_runner
from ..utils.responses import success_response

router = APIRouter(prefix="/campaign", tags=["campaign"])


@router.get("/ai-status", response_model=ApiEnvelope[CampaignAiStatusData])
async def campaign_ai_status() -> dict:
    from ..services.ai.llm import ai_status_payload_async

    data = CampaignAiStatusData(**(await ai_status_payload_async()))
    return success_response(data.model_dump())


@router.post("/plan", response_model=ApiEnvelope[CampaignPlanData])
async def create_campaign_plan(payload: CampaignPlanRequest) -> dict:
    phones = [s.phone.strip() for s in payload.speakers]
    if len(phones) != len(set(phones)):
        raise HTTPException(status_code=400, detail="Hai vai dang dung cung so dien thoai")

    try:
        plan, market_raw = await plan_campaign(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI plan that bai: {exc}") from exc

    script = plan_to_conversation_script(
        plan,
        speakers=payload.speakers,
        group_link=payload.group_link or payload.peer_id or "",
        peer_id=payload.peer_id,
    )
    validation = validate_campaign_script(script)

    # Surface target vs actual line count to the UI
    target = payload.target_lines
    if target is None:
        sec = {"light": 70, "normal": 55, "dense": 40}.get(payload.density, 55)
        from ..schemas.campaign import MAX_CAMPAIGN_LINES

        target = max(
            4, min(MAX_CAMPAIGN_LINES, round((payload.duration_min * 60) / sec) + 1)
        )
    actual = len(plan.lines)
    if actual != target:
        from ..schemas.conversation import ConversationValidationIssue

        validation.issues = [
            ConversationValidationIssue(
                level="warning",
                code="line_count_mismatch",
                message=(
                    f"Ban yeu cau {target} luot nhung AI tra {actual} dong. "
                    f"Co the lap lai plan hoac Start voi {actual} dong hien co."
                ),
            ),
            *list(validation.issues),
        ]

    market_model: CampaignMarketContext | None = None
    if market_raw is not None:
        market_model = CampaignMarketContext(**market_raw)
        if not market_model.ok:
            from ..schemas.conversation import ConversationValidationIssue

            validation.issues = [
                ConversationValidationIssue(
                    level="warning",
                    code="market_unavailable",
                    message=(
                        "Khong lay duoc gia live (CoinGecko). "
                        f"Plan van chay nhung AI co the bia gia. Chi tiet: {market_model.error or 'unknown'}"
                    ),
                ),
                *list(validation.issues),
            ]

    for speaker in payload.speakers:
        metadata_store.record_audit(
            speaker.phone,
            action="campaign.plan",
            resource=payload.group_link or payload.peer_id or "campaign",
            status="success",
            detail={
                "title": plan.title,
                "lines": len(plan.lines),
                "target_lines": target,
                "duration_min": plan.duration_min,
                "goal": payload.goal[:200],
                "market_ok": bool(market_model and market_model.ok),
            },
        )
        break  # one audit row is enough

    data = CampaignPlanData(
        plan=plan,
        script=script,
        validation=validation,
        market=market_model,
    )
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
    tag_list = [t.strip().lower() for t in tags.split(",") if t.strip()]
    q_clean = q.strip()
    try:
        from ..services.market import (
            clear_market_cache,
            fetch_crypto_snapshot,
            format_market_brief,
        )

        if refresh:
            clear_market_cache()
        snap = await fetch_crypto_snapshot(
            use_cache=not refresh and not q_clean and not tag_list,
            q=q_clean or None,
            tags=tag_list or None,
        )
        data = CampaignMarketContext(
            **snap.to_dict(),
            brief=format_market_brief(snap),
            ok=True,
            error=None,
            filter_q=q_clean,
            filter_tags=tag_list,
        )
        return success_response(data.model_dump())
    except Exception as exc:
        data = CampaignMarketContext(
            ok=False,
            error=str(exc),
            source="coingecko_simple_price",
            news=[],
            filter_q=q_clean,
            filter_tags=tag_list,
        )
        return success_response(data.model_dump())


@router.post("/goal-draft", response_model=ApiEnvelope[CampaignGoalDraftData])
async def campaign_goal_draft(payload: CampaignGoalDraftRequest) -> dict:
    """Deterministic goal paragraph from wizard fields (no LLM)."""
    goal = build_goal_draft(payload)
    return success_response(
        CampaignGoalDraftData(goal=goal, source="template").model_dump()
    )


@router.post("/jobs", response_model=ApiEnvelope[CampaignJobCreateData])
async def start_campaign_job(payload: CampaignJobCreateRequest) -> dict:
    if not payload.group_link.strip():
        raise HTTPException(status_code=400, detail="Thieu link nhom")

    phones = [s.phone.strip() for s in payload.speakers]
    if len(phones) != len(set(phones)):
        raise HTTPException(status_code=400, detail="Hai vai dang dung cung so dien thoai")

    script = plan_to_conversation_script(
        payload.plan,
        speakers=payload.speakers,
        group_link=payload.group_link,
        peer_id=payload.peer_id,
    )
    validation = validate_campaign_script(script)
    if not validation.valid or validation.script is None:
        message = (
            validation.issues[0].message if validation.issues else "Ke hoach khong hop le"
        )
        raise HTTPException(status_code=400, detail=message)

    job = conversation_job_store.create(validation.script)
    started = conversation_runner.start(job.id or 0)
    if not started and job.id is not None:
        conversation_job_store.mark_finished(
            job.id, "error", "Job dang chay hoac khong khoi dong duoc"
        )

    for speaker in payload.speakers:
        metadata_store.record_audit(
            speaker.phone,
            action="campaign.start",
            resource=payload.group_link,
            status="success" if started else "error",
            detail={
                "job_id": job.id,
                "title": payload.plan.title,
                "lines": job.total_lines,
            },
        )
        break

    data = CampaignJobCreateData(
        job_id=job.id or 0,
        status=job.status if started else "error",
        total_lines=job.total_lines,
        title=payload.plan.title,
    )
    return success_response(data.model_dump())


@router.get("/jobs/{job_id}", response_model=ApiEnvelope[ConversationJobData])
async def get_campaign_job(job_id: int) -> dict:
    job = conversation_job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Khong tim thay job")
    data = conversation_job_store.to_data(job)
    return success_response(data.model_dump())


@router.post("/jobs/{job_id}/inject", response_model=ApiEnvelope[CampaignInjectData])
async def inject_campaign_job(job_id: int, payload: CampaignInjectRequest) -> dict:
    """AI-generate 2–5 lines about live news/price and append to a running job."""
    try:
        result = await inject_into_job(job_id, payload)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Inject that bai: {exc}") from exc

    metadata_store.record_audit(
        "campaign",
        action="campaign.inject",
        resource=str(job_id),
        status="success",
        detail={
            "job_id": job_id,
            "injected": result.get("injected_count"),
            "total": result.get("new_total_lines"),
        },
    )
    return success_response(CampaignInjectData(**result).model_dump())


@router.post("/jobs/{job_id}/stop", response_model=ApiEnvelope[ConversationJobData])
async def stop_campaign_job(job_id: int) -> dict:
    job = conversation_job_store.request_stop(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Khong tim thay job")
    refreshed = conversation_job_store.get(job_id)
    data = conversation_job_store.to_data(refreshed)  # type: ignore[arg-type]
    return success_response(data.model_dump())


@router.post("/jobs/{job_id}/resume", response_model=ApiEnvelope[ConversationJobData])
async def resume_campaign_job(job_id: int) -> dict:
    """Continue a stopped / error campaign from remaining (non-success) lines."""
    job = conversation_job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Khong tim thay job")
    if job.status == "running" or conversation_runner.is_active(job_id):
        raise HTTPException(status_code=409, detail="Job dang chay")
    if job.status not in ("stopped", "done", "error", "pending"):
        raise HTTPException(
            status_code=400,
            detail=f"Khong the resume job status={job.status}",
        )

    # Nothing left to send
    results = conversation_job_store.get_line_results(job_id)
    remaining = [
        item
        for item in results
        if item.status not in ("success", "skipped")
    ]
    if not remaining and job.status == "done":
        raise HTTPException(
            status_code=400,
            detail="Job da gui het cac dong — khong con gi de tiep tuc",
        )

    started = conversation_runner.resume(job_id)
    if not started:
        raise HTTPException(status_code=409, detail="Khong the resume job")

    metadata_store.record_audit(
        "campaign",
        action="campaign.resume",
        resource=str(job_id),
        status="success",
        detail={
            "job_id": job_id,
            "remaining": len(remaining),
            "prev_status": job.status,
        },
    )

    refreshed = conversation_job_store.get(job_id)
    data = conversation_job_store.to_data(refreshed)  # type: ignore[arg-type]
    return success_response(data.model_dump())


@router.post(
    "/jobs/{job_id}/lines/{line_id}/retry",
    response_model=ApiEnvelope[ConversationJobData],
)
async def retry_campaign_line(job_id: int, line_id: int) -> dict:
    """Retry a single failed/pending campaign line (e.g. after fixing acc permissions)."""
    job = conversation_job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Khong tim thay job")
    if job.status == "running" or conversation_runner.is_active(job_id):
        raise HTTPException(status_code=409, detail="Job dang chay — dung truoc khi retry")

    script = conversation_job_store.load_script(job)
    line_ids = {line.id for line in script.lines}
    if line_id not in line_ids:
        raise HTTPException(status_code=404, detail=f"Khong tim thay dong #{line_id}")

    started = conversation_runner.retry_line(job_id, line_id)
    if not started:
        raise HTTPException(status_code=409, detail="Khong the retry dong nay")

    metadata_store.record_audit(
        "campaign",
        action="campaign.retry_line",
        resource=str(job_id),
        status="success",
        detail={"job_id": job_id, "line_id": line_id},
    )

    refreshed = conversation_job_store.get(job_id)
    data = conversation_job_store.to_data(refreshed)  # type: ignore[arg-type]
    return success_response(data.model_dump())
