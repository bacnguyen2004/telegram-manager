import json
from datetime import datetime, timezone

from sqlmodel import Session, col, func, select

from ....db.engine import get_engine
from ....db.models import CampaignJob
from ....schemas.campaign import (
    CampaignJobData,
    CampaignJobSummary,
    CampaignLineResult,
    CampaignScript,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


class CampaignJobStore:
    def create(
        self,
        script: CampaignScript,
        *,
        start_line_id: int | None = None,
        carried_line_results: list[CampaignLineResult] | None = None,
    ) -> CampaignJob:
        now = _utc_now()
        carried_map: dict[int, CampaignLineResult] = {}
        if carried_line_results:
            for item in carried_line_results:
                if item.status == "success":
                    carried_map[item.line_id] = item

        line_results = []
        for line in sorted(script.lines, key=lambda item: item.id):
            phone = self._phone_for_speaker(script, line.speaker_id)
            if start_line_id is not None and line.id < start_line_id:
                carried = carried_map.get(line.id)
                if carried:
                    line_results.append(
                        CampaignLineResult(
                            line_id=line.id,
                            speaker_id=line.speaker_id,
                            phone=phone or carried.phone,
                            status="success",
                            message_id=carried.message_id,
                            reply_to_msg_id=carried.reply_to_msg_id,
                            detail=self._carried_detail(carried),
                        ).model_dump()
                    )
                    continue
                line_results.append(
                    CampaignLineResult(
                        line_id=line.id,
                        speaker_id=line.speaker_id,
                        phone=phone,
                        status="skipped",
                        detail=f"Bo qua — chay tu dong #{start_line_id}",
                    ).model_dump()
                )
                continue

            line_results.append(
                CampaignLineResult(
                    line_id=line.id,
                    speaker_id=line.speaker_id,
                    phone=phone,
                    status="pending",
                    detail="",
                ).model_dump()
            )

        job = CampaignJob(
            status="pending",
            group_link=script.group_link.strip(),
            peer_id=(script.peer_id or script.group_link).strip(),
            script_json=script.model_dump_json(),
            total_lines=len(script.lines),
            completed_lines=0,
            success_lines=0,
            error_lines=0,
            stop_requested=False,
            line_results_json=json.dumps(line_results, ensure_ascii=False),
            created_at=now,
            updated_at=now,
        )
        with Session(get_engine()) as session:
            session.add(job)
            session.commit()
            session.refresh(job)
            self._recalculate_counters(job.id or 0)
            refreshed = session.get(CampaignJob, job.id)
            return refreshed or job

    def get(self, job_id: int) -> CampaignJob | None:
        with Session(get_engine()) as session:
            return session.get(CampaignJob, job_id)

    def list_jobs(self, *, limit: int = 20, offset: int = 0) -> tuple[list[CampaignJob], int]:
        safe_limit = max(1, min(limit, 100))
        safe_offset = max(0, offset)
        with Session(get_engine()) as session:
            total = session.exec(select(func.count()).select_from(CampaignJob)).one()
            jobs = session.exec(
                select(CampaignJob)
                .order_by(col(CampaignJob.created_at).desc())
                .offset(safe_offset)
                .limit(safe_limit)
            ).all()
            return list(jobs), int(total)

    def recover_orphaned_jobs(self) -> int:
        now = _utc_now()
        recovered = 0
        with Session(get_engine()) as session:
            jobs = session.exec(
                select(CampaignJob).where(CampaignJob.status == "running")
            ).all()
            for job in jobs:
                job.status = "stopped"
                job.stop_requested = True
                job.error_message = "Server restarted — bam Resume de tiep tuc"
                job.updated_at = now
                session.add(job)
                recovered += 1
            if recovered:
                session.commit()
        return recovered

    def request_stop(self, job_id: int) -> CampaignJob | None:
        with Session(get_engine()) as session:
            job = session.get(CampaignJob, job_id)
            if job is None:
                return None
            job.stop_requested = True
            if job.status == "running":
                job.status = "stopped"
            job.updated_at = _utc_now()
            session.add(job)
            session.commit()
            session.refresh(job)
            return job

    def prepare_resume(self, job_id: int) -> CampaignJob | None:
        with Session(get_engine()) as session:
            job = session.get(CampaignJob, job_id)
            if job is None:
                return None
            if job.status == "running":
                return None
            job.stop_requested = False
            job.status = "pending"
            job.error_message = None
            job.updated_at = _utc_now()
            session.add(job)
            session.commit()
            session.refresh(job)
            return job

    def reset_line_for_retry(self, job_id: int, line_id: int) -> CampaignJob | None:
        with Session(get_engine()) as session:
            job = session.get(CampaignJob, job_id)
            if job is None:
                return None
            if job.status == "running":
                return None

            results = self._load_line_results(job)
            found = False
            for index, item in enumerate(results):
                if item.line_id == line_id:
                    results[index] = CampaignLineResult(
                        line_id=item.line_id,
                        speaker_id=item.speaker_id,
                        phone=item.phone,
                        status="pending",
                        detail="Cho retry",
                    )
                    found = True
                    break
            if not found:
                return None

            job.line_results_json = json.dumps(
                [item.model_dump() for item in results],
                ensure_ascii=False,
            )
            job.stop_requested = False
            job.status = "pending"
            job.error_message = None
            job.updated_at = _utc_now()
            session.add(job)
            session.commit()
            session.refresh(job)
            self._recalculate_counters(job_id)
            return session.get(CampaignJob, job_id)

    def mark_running(self, job_id: int) -> None:
        self._update_job(job_id, status="running", stop_requested=False)

    def mark_finished(self, job_id: int, status: str, error_message: str | None = None) -> None:
        self._update_job(job_id, status=status, error_message=error_message)

    def update_line_result(
        self,
        job_id: int,
        line_result: CampaignLineResult,
        *,
        completed_lines: int,
        success_lines: int,
        error_lines: int,
    ) -> None:
        with Session(get_engine()) as session:
            job = session.get(CampaignJob, job_id)
            if job is None:
                return
            results = self._load_line_results(job)
            replaced = False
            for index, item in enumerate(results):
                if item.line_id == line_result.line_id:
                    results[index] = line_result
                    replaced = True
                    break
            if not replaced:
                results.append(line_result)
            job.line_results_json = json.dumps(
                [item.model_dump() for item in results],
                ensure_ascii=False,
            )
            job.completed_lines = completed_lines
            job.success_lines = success_lines
            job.error_lines = error_lines
            job.updated_at = _utc_now()
            session.add(job)
            session.commit()

    def should_stop(self, job_id: int) -> bool:
        job = self.get(job_id)
        return bool(job and job.stop_requested)

    def to_data(self, job: CampaignJob) -> CampaignJobData:
        return CampaignJobData(
            id=job.id or 0,
            status=job.status,  # type: ignore[arg-type]
            total_lines=job.total_lines,
            completed_lines=job.completed_lines,
            success_lines=job.success_lines,
            error_lines=job.error_lines,
            group_link=job.group_link,
            stop_requested=job.stop_requested,
            line_results=self._load_line_results(job),
            script=self.load_script(job),
            created_at=_iso(job.created_at),
            updated_at=_iso(job.updated_at),
            error_message=job.error_message,
        )

    def to_summary(self, job: CampaignJob) -> CampaignJobSummary:
        return CampaignJobSummary(
            id=job.id or 0,
            status=job.status,
            total_lines=job.total_lines,
            completed_lines=job.completed_lines,
            success_lines=job.success_lines,
            error_lines=job.error_lines,
            group_link=job.group_link,
            created_at=_iso(job.created_at),
            updated_at=_iso(job.updated_at),
        )

    def load_script(self, job: CampaignJob) -> CampaignScript:
        return CampaignScript.model_validate_json(job.script_json)

    def append_lines(
        self,
        job_id: int,
        lines: list,
    ) -> CampaignJob | None:
        """Append script lines + pending results. Only while job active."""
        from ....schemas.campaign import CampaignScriptLine

        if not lines:
            return self.get(job_id)

        with Session(get_engine()) as session:
            job = session.get(CampaignJob, job_id)
            if job is None:
                return None
            if job.status not in ("running", "pending"):
                return None
            if job.stop_requested:
                return None

            script = CampaignScript.model_validate_json(job.script_json)
            results = self._load_line_results(job)
            existing_ids = {ln.id for ln in script.lines}
            added = 0
            for raw in lines:
                if isinstance(raw, CampaignScriptLine):
                    line = raw
                else:
                    line = CampaignScriptLine.model_validate(raw)
                if line.id in existing_ids:
                    continue
                script.lines.append(line)
                existing_ids.add(line.id)
                phone = self._phone_for_speaker(script, line.speaker_id)
                results.append(
                    CampaignLineResult(
                        line_id=line.id,
                        speaker_id=line.speaker_id,
                        phone=phone,
                        status="pending",
                        detail="Inject — cho gui",
                    )
                )
                added += 1

            if added == 0:
                session.refresh(job)
                return job

            # Cap safety
            if len(script.lines) > 500:
                return None

            job.script_json = script.model_dump_json()
            job.total_lines = len(script.lines)
            job.line_results_json = json.dumps(
                [item.model_dump() for item in results],
                ensure_ascii=False,
            )
            job.updated_at = _utc_now()
            session.add(job)
            session.commit()
            session.refresh(job)
            self._recalculate_counters(job_id)
            return session.get(CampaignJob, job_id)

    def get_line_results(self, job_id: int) -> list[CampaignLineResult]:
        job = self.get(job_id)
        if job is None:
            return []
        return self._load_line_results(job)

    def _load_line_results(self, job: CampaignJob) -> list[CampaignLineResult]:
        raw = json.loads(job.line_results_json or "[]")
        return [CampaignLineResult.model_validate(item) for item in raw]

    @staticmethod
    def _carried_detail(carried: CampaignLineResult) -> str:
        parts = ["Giu tu job truoc"]
        if carried.message_id is not None:
            parts.append(f"TG #{carried.message_id}")
        if carried.detail and carried.detail.strip() not in ("", "Da gui", "Da gui truoc"):
            parts.append(carried.detail.strip())
        return " · ".join(parts)

    def _phone_for_speaker(self, script: CampaignScript, speaker_id: str) -> str:
        for speaker in script.speakers:
            if speaker.id == speaker_id:
                return speaker.phone.strip()
        return ""

    def _recalculate_counters(self, job_id: int) -> None:
        with Session(get_engine()) as session:
            job = session.get(CampaignJob, job_id)
            if job is None:
                return
            results = self._load_line_results(job)
            completed = 0
            success_count = 0
            error_count = 0
            for item in results:
                if item.status in ("success", "error", "skipped"):
                    completed += 1
                if item.status == "success":
                    success_count += 1
                if item.status == "error":
                    error_count += 1
            job.completed_lines = completed
            job.success_lines = success_count
            job.error_lines = error_count
            job.updated_at = _utc_now()
            session.add(job)
            session.commit()

    def _update_job(
        self,
        job_id: int,
        *,
        status: str | None = None,
        error_message: str | None = None,
        stop_requested: bool | None = None,
    ) -> None:
        with Session(get_engine()) as session:
            job = session.get(CampaignJob, job_id)
            if job is None:
                return
            if status is not None:
                job.status = status
            if error_message is not None:
                job.error_message = error_message
            if stop_requested is not None:
                job.stop_requested = stop_requested
            job.updated_at = _utc_now()
            session.add(job)
            session.commit()


campaign_job_store = CampaignJobStore()