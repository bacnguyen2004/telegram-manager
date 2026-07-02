import json
from datetime import datetime, timezone

from sqlmodel import Session, col, func, select

from ...db.engine import get_engine
from ...db.models import ConversationJob
from ...schemas.conversation import (
    ConversationJobData,
    ConversationJobSummary,
    ConversationLineResult,
    ConversationScriptInput,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


class ConversationJobStore:
    def create(
        self,
        script: ConversationScriptInput,
        *,
        start_line_id: int | None = None,
    ) -> ConversationJob:
        now = _utc_now()
        line_results = []
        for line in sorted(script.lines, key=lambda item: item.id):
            if start_line_id is not None and line.id < start_line_id:
                status = "skipped"
            else:
                status = "pending"
            line_results.append(
                ConversationLineResult(
                    line_id=line.id,
                    speaker_id=line.speaker_id,
                    phone=self._phone_for_speaker(script, line.speaker_id),
                    status=status,
                    detail="Bo qua" if status == "skipped" else "",
                ).model_dump()
            )

        job = ConversationJob(
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
            refreshed = session.get(ConversationJob, job.id)
            return refreshed or job

    def get(self, job_id: int) -> ConversationJob | None:
        with Session(get_engine()) as session:
            return session.get(ConversationJob, job_id)

    def list_jobs(self, *, limit: int = 20, offset: int = 0) -> tuple[list[ConversationJob], int]:
        safe_limit = max(1, min(limit, 100))
        safe_offset = max(0, offset)
        with Session(get_engine()) as session:
            total = session.exec(select(func.count()).select_from(ConversationJob)).one()
            jobs = session.exec(
                select(ConversationJob)
                .order_by(col(ConversationJob.created_at).desc())
                .offset(safe_offset)
                .limit(safe_limit)
            ).all()
            return list(jobs), int(total)

    def recover_orphaned_jobs(self) -> int:
        now = _utc_now()
        recovered = 0
        with Session(get_engine()) as session:
            jobs = session.exec(
                select(ConversationJob).where(ConversationJob.status == "running")
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

    def request_stop(self, job_id: int) -> ConversationJob | None:
        with Session(get_engine()) as session:
            job = session.get(ConversationJob, job_id)
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

    def prepare_resume(self, job_id: int) -> ConversationJob | None:
        with Session(get_engine()) as session:
            job = session.get(ConversationJob, job_id)
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

    def reset_line_for_retry(self, job_id: int, line_id: int) -> ConversationJob | None:
        with Session(get_engine()) as session:
            job = session.get(ConversationJob, job_id)
            if job is None:
                return None
            if job.status == "running":
                return None

            results = self._load_line_results(job)
            found = False
            for index, item in enumerate(results):
                if item.line_id == line_id:
                    results[index] = ConversationLineResult(
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
            return session.get(ConversationJob, job_id)

    def mark_running(self, job_id: int) -> None:
        self._update_job(job_id, status="running", stop_requested=False)

    def mark_finished(self, job_id: int, status: str, error_message: str | None = None) -> None:
        self._update_job(job_id, status=status, error_message=error_message)

    def update_line_result(
        self,
        job_id: int,
        line_result: ConversationLineResult,
        *,
        completed_lines: int,
        success_lines: int,
        error_lines: int,
    ) -> None:
        with Session(get_engine()) as session:
            job = session.get(ConversationJob, job_id)
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

    def to_data(self, job: ConversationJob) -> ConversationJobData:
        return ConversationJobData(
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

    def to_summary(self, job: ConversationJob) -> ConversationJobSummary:
        return ConversationJobSummary(
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

    def load_script(self, job: ConversationJob) -> ConversationScriptInput:
        return ConversationScriptInput.model_validate_json(job.script_json)

    def get_line_results(self, job_id: int) -> list[ConversationLineResult]:
        job = self.get(job_id)
        if job is None:
            return []
        return self._load_line_results(job)

    def _load_line_results(self, job: ConversationJob) -> list[ConversationLineResult]:
        raw = json.loads(job.line_results_json or "[]")
        return [ConversationLineResult.model_validate(item) for item in raw]

    def _phone_for_speaker(self, script: ConversationScriptInput, speaker_id: str) -> str:
        for speaker in script.speakers:
            if speaker.id == speaker_id:
                return speaker.phone.strip()
        return ""

    def _recalculate_counters(self, job_id: int) -> None:
        with Session(get_engine()) as session:
            job = session.get(ConversationJob, job_id)
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
            job = session.get(ConversationJob, job_id)
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


conversation_job_store = ConversationJobStore()