import asyncio
import random
import re

from ...schemas.conversation import ConversationLineResult, ConversationScriptInput
from ..telegram import telegram_message_service
from .store import conversation_job_store


_FLOOD_WAIT_RE = re.compile(r"Flood wait (\d+)s", re.IGNORECASE)


class ConversationRunner:
    def __init__(self) -> None:
        self._active_jobs: set[int] = set()

    def is_active(self, job_id: int) -> bool:
        return job_id in self._active_jobs

    def start(self, job_id: int, *, only_line_id: int | None = None) -> bool:
        if job_id in self._active_jobs:
            return False
        self._active_jobs.add(job_id)
        asyncio.create_task(self._run_job(job_id, only_line_id=only_line_id))
        return True

    def resume(self, job_id: int) -> bool:
        job = conversation_job_store.prepare_resume(job_id)
        if job is None:
            return False
        return self.start(job_id)

    def retry_line(self, job_id: int, line_id: int) -> bool:
        job = conversation_job_store.reset_line_for_retry(job_id, line_id)
        if job is None:
            return False
        return self.start(job_id, only_line_id=line_id)

    async def _run_job(self, job_id: int, *, only_line_id: int | None = None) -> None:
        try:
            job = conversation_job_store.get(job_id)
            if job is None:
                return
            script = conversation_job_store.load_script(job)
            conversation_job_store.mark_running(job_id)
            await self._execute_script(job_id, script, only_line_id=only_line_id)
        except Exception as exc:
            conversation_job_store.mark_finished(job_id, "error", str(exc))
        finally:
            self._active_jobs.discard(job_id)

    async def _execute_script(
        self,
        job_id: int,
        script: ConversationScriptInput,
        *,
        only_line_id: int | None = None,
    ) -> None:
        job = conversation_job_store.get(job_id)
        if job is None:
            return

        peer_id = (script.peer_id or script.group_link).strip()
        speakers = {item.id: item for item in script.speakers}
        ordered_lines = sorted(script.lines, key=lambda item: item.id)
        results_by_id = {
            item.line_id: item for item in conversation_job_store.get_line_results(job_id)
        }

        sent_ids: dict[int, int] = {}
        previous_speaker_id: str | None = None
        previous_message_id: int | None = None

        for line in ordered_lines:
            existing = results_by_id.get(line.id)
            if existing and existing.status == "success" and existing.message_id:
                sent_ids[line.id] = existing.message_id
                previous_message_id = existing.message_id
                previous_speaker_id = line.speaker_id

        completed = sum(
            1
            for item in results_by_id.values()
            if item.status in ("success", "error", "skipped")
        )
        success_count = sum(1 for item in results_by_id.values() if item.status == "success")
        error_count = sum(1 for item in results_by_id.values() if item.status == "error")

        for index, line in enumerate(ordered_lines):
            if conversation_job_store.should_stop(job_id):
                conversation_job_store.mark_finished(job_id, "stopped")
                return

            existing = results_by_id.get(line.id)
            if only_line_id is not None:
                if line.id != only_line_id:
                    continue
            elif existing and existing.status in ("success", "skipped"):
                continue

            speaker = speakers.get(line.speaker_id)
            if speaker is None:
                result = ConversationLineResult(
                    line_id=line.id,
                    speaker_id=line.speaker_id,
                    phone="",
                    status="error",
                    detail="Khong tim thay vai",
                )
                if existing and existing.status == "success" and only_line_id is None:
                    completed = max(0, completed - 1)
                    success_count = max(0, success_count - 1)
                elif existing and existing.status == "error" and only_line_id is None:
                    completed = max(0, completed - 1)
                    error_count = max(0, error_count - 1)
                completed += 1
                error_count += 1
                results_by_id[line.id] = result
                conversation_job_store.update_line_result(
                    job_id,
                    result,
                    completed_lines=completed,
                    success_lines=success_count,
                    error_lines=error_count,
                )
                if not script.continue_on_error:
                    conversation_job_store.mark_finished(job_id, "error")
                    return
                continue

            phone = speaker.phone.strip()
            running = ConversationLineResult(
                line_id=line.id,
                speaker_id=line.speaker_id,
                phone=phone,
                status="running",
                detail="Dang gui...",
            )
            conversation_job_store.update_line_result(
                job_id,
                running,
                completed_lines=completed,
                success_lines=success_count,
                error_lines=error_count,
            )

            reply_to = self._resolve_reply_to(
                line,
                sent_ids,
                previous_speaker_id,
                previous_message_id,
                script.reply_on_speaker_change,
            )

            send_result = await self._send_with_flood_retry(
                phone,
                peer_id,
                line.text,
                reply_to,
            )

            if existing and existing.status == "success" and only_line_id == line.id:
                completed = max(0, completed - 1)
                success_count = max(0, success_count - 1)
            elif existing and existing.status == "error" and only_line_id == line.id:
                completed = max(0, completed - 1)
                error_count = max(0, error_count - 1)

            if send_result.get("status") == "success":
                message_id = send_result.get("message_id")
                if isinstance(message_id, int):
                    sent_ids[line.id] = message_id
                    previous_message_id = message_id
                previous_speaker_id = line.speaker_id
                result = ConversationLineResult(
                    line_id=line.id,
                    speaker_id=line.speaker_id,
                    phone=phone,
                    status="success",
                    message_id=message_id if isinstance(message_id, int) else None,
                    reply_to_msg_id=reply_to,
                    detail=send_result.get("message") or "Da gui",
                )
                completed += 1
                success_count += 1
            else:
                result = ConversationLineResult(
                    line_id=line.id,
                    speaker_id=line.speaker_id,
                    phone=phone,
                    status="error",
                    reply_to_msg_id=reply_to,
                    detail=send_result.get("message") or "Gui that bai",
                )
                completed += 1
                error_count += 1

            results_by_id[line.id] = result
            conversation_job_store.update_line_result(
                job_id,
                result,
                completed_lines=completed,
                success_lines=success_count,
                error_lines=error_count,
            )

            if result.status == "error" and not script.continue_on_error:
                conversation_job_store.mark_finished(job_id, "error")
                return

            if only_line_id is not None:
                break

            if index < len(ordered_lines) - 1:
                next_line = ordered_lines[index + 1]
                speaker_changed = line.speaker_id != next_line.speaker_id
                delay_seconds = self._pick_delay(script, speaker_changed)
                if delay_seconds > 0:
                    await self._sleep_with_stop(job_id, delay_seconds)

        conversation_job_store.mark_finished(
            job_id,
            self._resolve_final_status(job_id, error_count),
        )

    @staticmethod
    def _resolve_final_status(job_id: int, error_count: int) -> str:
        if conversation_job_store.should_stop(job_id):
            return "stopped"
        if error_count > 0:
            return "error"
        has_pending = any(
            item.status == "pending"
            for item in conversation_job_store.get_line_results(job_id)
        )
        if has_pending:
            return "pending"
        return "done"

    def _resolve_reply_to(
        self,
        line,
        sent_ids: dict[int, int],
        previous_speaker_id: str | None,
        previous_message_id: int | None,
        reply_on_speaker_change: bool,
    ) -> int | None:
        if line.reply_to is not None:
            return sent_ids.get(line.reply_to)
        if (
            reply_on_speaker_change
            and previous_speaker_id
            and previous_speaker_id != line.speaker_id
            and previous_message_id
        ):
            return previous_message_id
        return None

    async def _send_with_flood_retry(
        self,
        phone: str,
        peer_id: str,
        text: str,
        reply_to: int | None,
        *,
        max_attempts: int = 3,
    ) -> dict:
        last_result: dict = {"status": "error", "message": "Khong gui duoc"}
        for attempt in range(max_attempts):
            if reply_to:
                last_result = await telegram_message_service.reply_message(
                    phone,
                    peer_id,
                    text,
                    reply_to,
                )
            else:
                last_result = await telegram_message_service.send_message(
                    phone,
                    peer_id,
                    text,
                )
            if last_result.get("status") == "success":
                return last_result

            wait_seconds = self._parse_flood_wait(last_result.get("message", ""))
            if wait_seconds is None or attempt >= max_attempts - 1:
                return last_result
            await asyncio.sleep(wait_seconds)
        return last_result

    @staticmethod
    def _parse_flood_wait(message: str) -> int | None:
        match = _FLOOD_WAIT_RE.search(str(message or ""))
        if not match:
            return None
        return max(int(match.group(1)), 1)

    @staticmethod
    def _pick_delay(script: ConversationScriptInput, speaker_changed: bool) -> int:
        timing = script.timing
        if speaker_changed:
            low = timing.speaker_change_delay_min_sec
            high = timing.speaker_change_delay_max_sec
        else:
            low = timing.delay_min_sec
            high = timing.delay_max_sec
        if high <= 0:
            return 0
        if low > high:
            low, high = high, low
        return random.randint(low, high)

    async def _sleep_with_stop(self, job_id: int, seconds: int) -> None:
        elapsed = 0.0
        while elapsed < seconds:
            if conversation_job_store.should_stop(job_id):
                return
            step = min(0.5, seconds - elapsed)
            await asyncio.sleep(step)
            elapsed += step


conversation_runner = ConversationRunner()