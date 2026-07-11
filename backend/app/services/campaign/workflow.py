"""Campaign business orchestration (Hội thoại product).

Routers stay thin: validate HTTP envelope only; this module owns plan/job
flow, validation side-effects, market warnings, and campaign audit.
Runtime execution stays in ``services.campaign.execution``.
"""

from __future__ import annotations

from ...db import metadata_store
from ...schemas.campaign import (
    MAX_CAMPAIGN_LINES,
    CampaignGoalDraftData,
    CampaignGoalDraftRequest,
    CampaignInjectData,
    CampaignInjectRequest,
    CampaignJobCreateData,
    CampaignJobCreateRequest,
    CampaignJobData,
    CampaignMarketContext,
    CampaignPlanData,
    CampaignPlanRequest,
    CampaignValidationIssue,
)
from .execution import campaign_runner, campaign_job_store
from .goal_draft import build_goal_draft
from .inject import inject_into_job
from .normalize import plan_to_script, validate_campaign_script
from .planner import plan_campaign


class CampaignNotFoundError(LookupError):
    """Job or line not found."""


class CampaignConflictError(Exception):
    """Job state conflict (already running, cannot resume/retry)."""


class CampaignBadRequestError(ValueError):
    """Invalid input or job state for the requested operation."""


class CampaignUpstreamError(Exception):
    """AI / external dependency failure (map to HTTP 502)."""


def _unique_speaker_phones(speakers) -> None:
    phones = [s.phone.strip() for s in speakers]
    if len(phones) != len(set(phones)):
        raise CampaignBadRequestError("Hai vai dang dung cung so dien thoai")


def _resolve_target_lines(payload: CampaignPlanRequest) -> int:
    if payload.target_lines is not None:
        return int(payload.target_lines)
    sec = {"light": 70, "normal": 55, "dense": 40}.get(payload.density, 55)
    return max(
        4, min(MAX_CAMPAIGN_LINES, round((payload.duration_min * 60) / sec) + 1)
    )


def _audit(
    phone: str,
    *,
    action: str,
    resource: str,
    status: str,
    detail: dict,
) -> None:
    metadata_store.record_audit(
        phone,
        action=action,
        resource=resource,
        status=status,
        detail=detail,
    )


class CampaignWorkflow:
    """Facade used by ``/api/campaign/*`` routes."""

    async def create_plan(self, payload: CampaignPlanRequest) -> CampaignPlanData:
        _unique_speaker_phones(payload.speakers)

        try:
            plan, market_raw = await plan_campaign(payload)
        except ValueError as exc:
            raise CampaignBadRequestError(str(exc)) from exc
        except Exception as exc:
            raise CampaignUpstreamError(f"AI plan that bai: {exc}") from exc

        script = plan_to_script(
            plan,
            speakers=payload.speakers,
            group_link=payload.group_link or payload.peer_id or "",
            peer_id=payload.peer_id,
        )
        validation = validate_campaign_script(script)

        target = _resolve_target_lines(payload)
        actual = len(plan.lines)
        if actual != target:
            validation.issues = [
                CampaignValidationIssue(
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
                validation.issues = [
                    CampaignValidationIssue(
                        level="warning",
                        code="market_unavailable",
                        message=(
                            "Khong lay duoc gia live (CoinGecko). "
                            f"Plan van chay nhung AI co the bia gia. "
                            f"Chi tiet: {market_model.error or 'unknown'}"
                        ),
                    ),
                    *list(validation.issues),
                ]

        if payload.speakers:
            _audit(
                payload.speakers[0].phone,
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

        return CampaignPlanData(
            plan=plan,
            script=script,
            validation=validation,
            market=market_model,
        )

    async def market_snapshot(
        self,
        *,
        refresh: bool = False,
        q: str = "",
        tags: str = "",
    ) -> CampaignMarketContext:
        tag_list = [t.strip().lower() for t in tags.split(",") if t.strip()]
        q_clean = q.strip()
        try:
            from ..market import (
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
            return CampaignMarketContext(
                **snap.to_dict(),
                brief=format_market_brief(snap),
                ok=True,
                error=None,
                filter_q=q_clean,
                filter_tags=tag_list,
            )
        except Exception as exc:
            return CampaignMarketContext(
                ok=False,
                error=str(exc),
                source="coingecko_simple_price",
                news=[],
                filter_q=q_clean,
                filter_tags=tag_list,
            )

    def goal_draft(self, payload: CampaignGoalDraftRequest) -> CampaignGoalDraftData:
        goal = build_goal_draft(payload)
        return CampaignGoalDraftData(goal=goal, source="template")

    def start_job(self, payload: CampaignJobCreateRequest) -> CampaignJobCreateData:
        if not payload.group_link.strip():
            raise CampaignBadRequestError("Thieu link nhom")
        _unique_speaker_phones(payload.speakers)

        script = plan_to_script(
            payload.plan,
            speakers=payload.speakers,
            group_link=payload.group_link,
            peer_id=payload.peer_id,
        )
        validation = validate_campaign_script(script)
        if not validation.valid or validation.script is None:
            message = (
                validation.issues[0].message
                if validation.issues
                else "Ke hoach khong hop le"
            )
            raise CampaignBadRequestError(message)

        job = campaign_job_store.create(validation.script)
        started = campaign_runner.start(job.id or 0)
        if not started and job.id is not None:
            campaign_job_store.mark_finished(
                job.id, "error", "Job dang chay hoac khong khoi dong duoc"
            )

        if payload.speakers:
            _audit(
                payload.speakers[0].phone,
                action="campaign.start",
                resource=payload.group_link,
                status="success" if started else "error",
                detail={
                    "job_id": job.id,
                    "title": payload.plan.title,
                    "lines": job.total_lines,
                },
            )

        return CampaignJobCreateData(
            job_id=job.id or 0,
            status=job.status if started else "error",
            total_lines=job.total_lines,
            title=payload.plan.title,
        )

    def get_job(self, job_id: int) -> CampaignJobData:
        job = campaign_job_store.get(job_id)
        if job is None:
            raise CampaignNotFoundError("Khong tim thay job")
        return campaign_job_store.to_data(job)

    def stop_job(self, job_id: int) -> CampaignJobData:
        job = campaign_job_store.request_stop(job_id)
        if job is None:
            raise CampaignNotFoundError("Khong tim thay job")
        refreshed = campaign_job_store.get(job_id)
        return campaign_job_store.to_data(refreshed)  # type: ignore[arg-type]

    def resume_job(self, job_id: int) -> CampaignJobData:
        job = campaign_job_store.get(job_id)
        if job is None:
            raise CampaignNotFoundError("Khong tim thay job")
        if job.status == "running" or campaign_runner.is_active(job_id):
            raise CampaignConflictError("Job dang chay")
        if job.status not in ("stopped", "done", "error", "pending"):
            raise CampaignBadRequestError(
                f"Khong the resume job status={job.status}"
            )

        results = campaign_job_store.get_line_results(job_id)
        remaining = [
            item for item in results if item.status not in ("success", "skipped")
        ]
        if not remaining and job.status == "done":
            raise CampaignBadRequestError(
                "Job da gui het cac dong — khong con gi de tiep tuc"
            )

        started = campaign_runner.resume(job_id)
        if not started:
            raise CampaignConflictError("Khong the resume job")

        _audit(
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

        refreshed = campaign_job_store.get(job_id)
        return campaign_job_store.to_data(refreshed)  # type: ignore[arg-type]

    def retry_line(self, job_id: int, line_id: int) -> CampaignJobData:
        job = campaign_job_store.get(job_id)
        if job is None:
            raise CampaignNotFoundError("Khong tim thay job")
        if job.status == "running" or campaign_runner.is_active(job_id):
            raise CampaignConflictError("Job dang chay — dung truoc khi retry")

        script = campaign_job_store.load_script(job)
        line_ids = {line.id for line in script.lines}
        if line_id not in line_ids:
            raise CampaignNotFoundError(f"Khong tim thay dong #{line_id}")

        started = campaign_runner.retry_line(job_id, line_id)
        if not started:
            raise CampaignConflictError("Khong the retry dong nay")

        _audit(
            "campaign",
            action="campaign.retry_line",
            resource=str(job_id),
            status="success",
            detail={"job_id": job_id, "line_id": line_id},
        )

        refreshed = campaign_job_store.get(job_id)
        return campaign_job_store.to_data(refreshed)  # type: ignore[arg-type]

    async def inject(
        self, job_id: int, payload: CampaignInjectRequest
    ) -> CampaignInjectData:
        try:
            result = await inject_into_job(job_id, payload)
        except LookupError as exc:
            raise CampaignNotFoundError(str(exc)) from exc
        except ValueError as exc:
            raise CampaignBadRequestError(str(exc)) from exc
        except Exception as exc:
            raise CampaignUpstreamError(f"Inject that bai: {exc}") from exc

        _audit(
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
        return CampaignInjectData(**result)


campaign_workflow = CampaignWorkflow()
