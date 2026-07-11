import asyncio
import logging
import random
import re
import time

from ....schemas.campaign import CampaignLineResult, CampaignScript
from ...telegram import telegram_message_service
from .audit_log import record_job_finish, record_job_start
from .store import campaign_job_store

logger = logging.getLogger(__name__)


_FLOOD_WAIT_RE = re.compile(r"Flood wait (\d+)s", re.IGNORECASE)


class CampaignRunner:
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
        job = campaign_job_store.prepare_resume(job_id)
        if job is None:
            return False
        return self.start(job_id)

    def retry_line(self, job_id: int, line_id: int) -> bool:
        job = campaign_job_store.reset_line_for_retry(job_id, line_id)
        if job is None:
            return False
        return self.start(job_id, only_line_id=line_id)

    async def _run_job(self, job_id: int, *, only_line_id: int | None = None) -> None:
        try:
            job = campaign_job_store.get(job_id)
            if job is None:
                return
            script = campaign_job_store.load_script(job)
            campaign_job_store.mark_running(job_id)
            record_job_start(job_id, script, only_line_id=only_line_id)
            await self._execute_script(job_id, script, only_line_id=only_line_id)
        except Exception as exc:
            self._finish_job(job_id, "error", error_message=str(exc), only_line_id=only_line_id)
        finally:
            self._active_jobs.discard(job_id)

    def _finish_job(
        self,
        job_id: int,
        status: str,
        *,
        error_message: str | None = None,
        only_line_id: int | None = None,
    ) -> None:
        campaign_job_store.mark_finished(job_id, status, error_message)
        record_job_finish(
            job_id,
            status,
            error_message=error_message,
            only_line_id=only_line_id,
        )

    async def _execute_script(
        self,
        job_id: int,
        script: CampaignScript,
        *,
        only_line_id: int | None = None,
    ) -> None:
        job = campaign_job_store.get(job_id)
        if job is None:
            return

        peer_id = (script.peer_id or script.group_link).strip()
        speakers = {item.id: item for item in script.speakers}
        ordered_lines = sorted(script.lines, key=lambda item: item.id)
        results_by_id = {
            item.line_id: item for item in campaign_job_store.get_line_results(job_id)
        }
        schedule_mode = self._uses_schedule(script)

        sent_ids: dict[int, int] = {}
        previous_speaker_id: str | None = None
        previous_message_id: int | None = None

        for line in ordered_lines:
            existing = results_by_id.get(line.id)
            if existing and existing.status == "success" and existing.message_id:
                sent_ids[line.id] = existing.message_id
                previous_message_id = existing.message_id
                previous_speaker_id = line.speaker_id

        # Absolute schedule clock (resume-safe: anchor after last successful at_sec)
        start_mono = self._schedule_start_mono(ordered_lines, results_by_id)

        completed = sum(
            1
            for item in results_by_id.values()
            if item.status in ("success", "error", "skipped")
        )
        success_count = sum(1 for item in results_by_id.values() if item.status == "success")
        error_count = sum(1 for item in results_by_id.values() if item.status == "error")

        for index, line in enumerate(ordered_lines):
            if campaign_job_store.should_stop(job_id):
                self._finish_job(job_id, "stopped", only_line_id=only_line_id)
                return

            existing = results_by_id.get(line.id)
            if only_line_id is not None:
                if line.id != only_line_id:
                    continue
            elif existing and existing.status in ("success", "skipped"):
                continue

            speaker = speakers.get(line.speaker_id)
            if speaker is None:
                result = CampaignLineResult(
                    line_id=line.id,
                    speaker_id=line.speaker_id,
                    phone="",
                    status="error",
                    detail="Khong tim thay vai dien",
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
                campaign_job_store.update_line_result(
                    job_id,
                    result,
                    completed_lines=completed,
                    success_lines=success_count,
                    error_lines=error_count,
                )
                if not script.continue_on_error:
                    self._finish_job(job_id, "error", only_line_id=only_line_id)
                    return
                continue

            phone = speaker.phone.strip()
            reply_to = self._resolve_reply_to(
                line,
                sent_ids,
                previous_speaker_id,
                previous_message_id,
                script.reply_on_speaker_change,
            )

            typing_wanted = self._pick_typing_delay(script, line.text)
            typing_seconds = typing_wanted
            wait_before = 0.0
            at_sec = getattr(line, "at_sec", None)

            if schedule_mode:
                # Fold typing INTO the script gap so total time tracks at_sec
                target_at = int(at_sec) if at_sec is not None else None
                if target_at is None:
                    # Inject / line without at_sec: small gap after previous schedule
                    target_at = int(time.monotonic() - start_mono) + 3
                remaining = (start_mono + target_at) - time.monotonic()
                wait_before, typing_seconds = self.fold_typing_into_remaining(
                    remaining, typing_wanted
                )
                if wait_before > 0.05:
                    wait_i = max(1, int(round(wait_before)))
                    wait_result = CampaignLineResult(
                        line_id=line.id,
                        speaker_id=line.speaker_id,
                        phone=phone,
                        status="pending",
                        detail=self._wait_detail(
                            wait_i,
                            False,
                            schedule_at=target_at,
                            typing_sec=typing_seconds,
                        ),
                        reply_to_msg_id=reply_to,
                    )
                    campaign_job_store.update_line_result(
                        job_id,
                        wait_result,
                        completed_lines=completed,
                        success_lines=success_count,
                        error_lines=error_count,
                    )
                    await self._sleep_with_stop(job_id, wait_before)
                    if campaign_job_store.should_stop(job_id):
                        self._finish_job(job_id, "stopped", only_line_id=only_line_id)
                        return

            running = CampaignLineResult(
                line_id=line.id,
                speaker_id=line.speaker_id,
                phone=phone,
                status="running",
                detail=self._running_detail(
                    typing_seconds,
                    reply_to,
                    line.reply_to,
                    schedule_at=int(at_sec) if schedule_mode and at_sec is not None else None,
                ),
                reply_to_msg_id=reply_to,
            )
            campaign_job_store.update_line_result(
                job_id,
                running,
                completed_lines=completed,
                success_lines=success_count,
                error_lines=error_count,
            )

            if typing_seconds > 0:
                await self._typing_with_stop(
                    job_id,
                    phone,
                    peer_id,
                    typing_seconds,
                )
                if campaign_job_store.should_stop(job_id):
                    self._finish_job(job_id, "stopped", only_line_id=only_line_id)
                    return

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
                result = CampaignLineResult(
                    line_id=line.id,
                    speaker_id=line.speaker_id,
                    phone=phone,
                    status="success",
                    message_id=message_id if isinstance(message_id, int) else None,
                    reply_to_msg_id=reply_to,
                    detail=self._success_detail(
                        send_result.get("message") or "",
                        message_id if isinstance(message_id, int) else None,
                        reply_to,
                        line.reply_to,
                        typing_seconds=typing_seconds,
                    ),
                )
                completed += 1
                success_count += 1
            else:
                result = CampaignLineResult(
                    line_id=line.id,
                    speaker_id=line.speaker_id,
                    phone=phone,
                    status="error",
                    reply_to_msg_id=reply_to,
                    detail=self._error_detail(
                        send_result.get("message") or "",
                        reply_to,
                        line.reply_to,
                    ),
                )
                completed += 1
                error_count += 1

            results_by_id[line.id] = result
            campaign_job_store.update_line_result(
                job_id,
                result,
                completed_lines=completed,
                success_lines=success_count,
                error_lines=error_count,
            )

            if result.status == "error" and not script.continue_on_error:
                self._finish_job(job_id, "error", only_line_id=only_line_id)
                return

            if only_line_id is not None:
                break

            # Pick up live-injected lines while job is still running
            if only_line_id is None:
                job_fresh = campaign_job_store.get(job_id)
                if job_fresh is not None:
                    script = campaign_job_store.load_script(job_fresh)
                    speakers = {item.id: item for item in script.speakers}
                    peer_id = (script.peer_id or script.group_link).strip()
                    schedule_mode = self._uses_schedule(script)
                    new_ordered = sorted(script.lines, key=lambda item: item.id)
                    if len(new_ordered) > len(ordered_lines):
                        ordered_lines.extend(new_ordered[len(ordered_lines) :])
                    for item in campaign_job_store.get_line_results(job_id):
                        results_by_id[item.line_id] = item

            # Legacy mode only: random gap AFTER send (schedule mode waits BEFORE next line)
            if not schedule_mode and index < len(ordered_lines) - 1:
                next_line = ordered_lines[index + 1]
                speaker_changed = line.speaker_id != next_line.speaker_id
                delay_seconds = self._pick_delay(script, speaker_changed)
                if delay_seconds > 0:
                    next_speaker = speakers.get(next_line.speaker_id)
                    wait_result = CampaignLineResult(
                        line_id=next_line.id,
                        speaker_id=next_line.speaker_id,
                        phone=next_speaker.phone.strip() if next_speaker else "",
                        status="pending",
                        detail=self._wait_detail(delay_seconds, speaker_changed),
                    )
                    campaign_job_store.update_line_result(
                        job_id,
                        wait_result,
                        completed_lines=completed,
                        success_lines=success_count,
                        error_lines=error_count,
                    )
                    await self._sleep_with_stop(job_id, delay_seconds)

        # Final drain: injects that arrived after last original line
        if only_line_id is None and not campaign_job_store.should_stop(job_id):
            job_fresh = campaign_job_store.get(job_id)
            if job_fresh is not None:
                script = campaign_job_store.load_script(job_fresh)
                speakers = {item.id: item for item in script.speakers}
                peer_id = (script.peer_id or script.group_link).strip()
                results_by_id = {
                    item.line_id: item
                    for item in campaign_job_store.get_line_results(job_id)
                }
                for line in sorted(script.lines, key=lambda item: item.id):
                    if campaign_job_store.should_stop(job_id):
                        self._finish_job(job_id, "stopped", only_line_id=only_line_id)
                        return
                    existing = results_by_id.get(line.id)
                    if existing and existing.status in ("success", "skipped", "error"):
                        if existing.status == "success" and existing.message_id:
                            sent_ids[line.id] = existing.message_id
                        continue
                    # Process remaining pending (same path as main loop — simplified)
                    speaker = speakers.get(line.speaker_id)
                    if speaker is None:
                        continue
                    phone = speaker.phone.strip()
                    reply_to = self._resolve_reply_to(
                        line,
                        sent_ids,
                        previous_speaker_id,
                        previous_message_id,
                        script.reply_on_speaker_change,
                    )
                    typing_wanted = self._pick_typing_delay(script, line.text)
                    typing_seconds = typing_wanted
                    at_sec = getattr(line, "at_sec", None)
                    if self._uses_schedule(script):
                        target_at = (
                            int(at_sec)
                            if at_sec is not None
                            else int(time.monotonic() - start_mono) + 3
                        )
                        remaining = (start_mono + target_at) - time.monotonic()
                        wait_before, typing_seconds = self.fold_typing_into_remaining(
                            remaining, typing_wanted
                        )
                        if wait_before > 0.05:
                            wait_i = max(1, int(round(wait_before)))
                            wait_result = CampaignLineResult(
                                line_id=line.id,
                                speaker_id=line.speaker_id,
                                phone=phone,
                                status="pending",
                                detail=self._wait_detail(
                                    wait_i,
                                    False,
                                    schedule_at=target_at,
                                    typing_sec=typing_seconds,
                                ),
                                reply_to_msg_id=reply_to,
                            )
                            campaign_job_store.update_line_result(
                                job_id,
                                wait_result,
                                completed_lines=completed,
                                success_lines=success_count,
                                error_lines=error_count,
                            )
                            await self._sleep_with_stop(job_id, wait_before)
                            if campaign_job_store.should_stop(job_id):
                                self._finish_job(
                                    job_id, "stopped", only_line_id=only_line_id
                                )
                                return
                    running = CampaignLineResult(
                        line_id=line.id,
                        speaker_id=line.speaker_id,
                        phone=phone,
                        status="running",
                        detail=self._running_detail(
                            typing_seconds,
                            reply_to,
                            line.reply_to,
                            schedule_at=int(at_sec) if at_sec is not None else None,
                        ),
                        reply_to_msg_id=reply_to,
                    )
                    campaign_job_store.update_line_result(
                        job_id,
                        running,
                        completed_lines=completed,
                        success_lines=success_count,
                        error_lines=error_count,
                    )
                    if typing_seconds > 0:
                        await self._typing_with_stop(
                            job_id, phone, peer_id, typing_seconds
                        )
                        if campaign_job_store.should_stop(job_id):
                            self._finish_job(
                                job_id, "stopped", only_line_id=only_line_id
                            )
                            return
                    send_result = await self._send_with_flood_retry(
                        phone, peer_id, line.text, reply_to
                    )
                    if send_result.get("status") == "success":
                        message_id = send_result.get("message_id")
                        if isinstance(message_id, int):
                            sent_ids[line.id] = message_id
                            previous_message_id = message_id
                        previous_speaker_id = line.speaker_id
                        result = CampaignLineResult(
                            line_id=line.id,
                            speaker_id=line.speaker_id,
                            phone=phone,
                            status="success",
                            message_id=message_id
                            if isinstance(message_id, int)
                            else None,
                            reply_to_msg_id=reply_to,
                            detail=self._success_detail(
                                send_result.get("message") or "",
                                message_id if isinstance(message_id, int) else None,
                                reply_to,
                                line.reply_to,
                                typing_seconds=typing_seconds,
                            ),
                        )
                        completed += 1
                        success_count += 1
                    else:
                        result = CampaignLineResult(
                            line_id=line.id,
                            speaker_id=line.speaker_id,
                            phone=phone,
                            status="error",
                            reply_to_msg_id=reply_to,
                            detail=self._error_detail(
                                send_result.get("message") or "",
                                reply_to,
                                line.reply_to,
                            ),
                        )
                        completed += 1
                        error_count += 1
                    results_by_id[line.id] = result
                    campaign_job_store.update_line_result(
                        job_id,
                        result,
                        completed_lines=completed,
                        success_lines=success_count,
                        error_lines=error_count,
                    )
                    if result.status == "error" and not script.continue_on_error:
                        self._finish_job(job_id, "error", only_line_id=only_line_id)
                        return
                    if not self._uses_schedule(script):
                        delay_seconds = self._pick_delay(script, True)
                        if delay_seconds > 0:
                            await self._sleep_with_stop(job_id, delay_seconds)

        self._finish_job(
            job_id,
            self._resolve_final_status(job_id, error_count),
            only_line_id=only_line_id,
        )

    @staticmethod
    def _uses_schedule(script: CampaignScript) -> bool:
        if getattr(script, "schedule_mode", False):
            return True
        return any(getattr(ln, "at_sec", None) is not None for ln in script.lines)

    @staticmethod
    def _schedule_start_mono(ordered_lines, results_by_id: dict) -> float:
        """Monotonic t0 so completed lines' at_sec stay on the absolute schedule."""
        now = time.monotonic()
        last_at: int | None = None
        for line in ordered_lines:
            existing = results_by_id.get(line.id)
            if (
                existing
                and existing.status == "success"
                and getattr(line, "at_sec", None) is not None
            ):
                last_at = int(line.at_sec)
        if last_at is not None:
            return now - float(last_at)
        return now

    @staticmethod
    def fold_typing_into_remaining(
        remaining_sec: float, typing_wanted: int
    ) -> tuple[float, int]:
        """Split remaining time until at_sec into (wait_before_typing, typing).

        Typing is counted *inside* the script gap — not added after it.
        When typing is enabled we **never** drop it to 0 just because the gap is
        tight (that used to hide Telegram "đang nhập" entirely for rem in (0,1)).
        Late lines still get a short visible flash (may slightly overshoot schedule).
        """
        wanted = max(0, int(typing_wanted or 0))
        if wanted <= 0:
            return max(0.0, float(remaining_sec)), 0
        rem = float(remaining_sec)
        if rem <= 0:
            # Late — still show a short "đang gõ" pulse (Telegram needs ~1s+)
            return 0.0, min(3, wanted)
        # Prefer keeping typing visible; int(rem)<1 used to zero it out
        typing = min(wanted, max(1, int(rem)))
        if rem < 1.0:
            # Sub-second gap: skip silent wait, flash typing (slight schedule overshoot)
            return 0.0, min(wanted, 2)
        wait = max(0.0, rem - typing)
        return wait, typing

    @staticmethod
    def _running_detail(
        typing_seconds: int,
        reply_to_msg_id: int | None,
        reply_to_line: int | None,
        *,
        schedule_at: int | None = None,
    ) -> str:
        parts: list[str] = []
        if typing_seconds > 0:
            parts.append(f"Dang go ({typing_seconds}s)...")
        else:
            parts.append("Dang gui...")
        if schedule_at is not None:
            parts.append(f"t+{schedule_at}s")
        if reply_to_line is not None:
            parts.append(f"Tra loi dong #{reply_to_line}")
        elif reply_to_msg_id is not None:
            parts.append(f"Reply TG #{reply_to_msg_id}")
        return " · ".join(parts)

    @staticmethod
    def _wait_detail(
        delay_seconds: int,
        speaker_changed: bool,
        *,
        schedule_at: int | None = None,
        typing_sec: int = 0,
    ) -> str:
        if schedule_at is not None:
            parts = [f"Cho delay ({delay_seconds}s) — lich t+{schedule_at}s"]
            if typing_sec > 0:
                parts.append(f"go {typing_sec}s")
            return " · ".join(parts)
        kind = "doi nguoi" if speaker_changed else "cung nguoi"
        return f"Cho delay ({delay_seconds}s) — {kind}"

    @staticmethod
    def _success_detail(
        base_message: str,
        message_id: int | None,
        reply_to_msg_id: int | None,
        reply_to_line: int | None,
        *,
        typing_seconds: int = 0,
    ) -> str:
        parts: list[str] = []
        normalized = str(base_message or "").strip().lower()
        if reply_to_line is not None:
            parts.append(f"Tra loi dong #{reply_to_line}")
        elif reply_to_msg_id is not None or "tra loi" in normalized:
            parts.append("Da tra loi tin nhan")
        elif normalized not in ("da gui tin nhan", "da gui", ""):
            parts.append(str(base_message).strip())
        else:
            parts.append("Da gui tin nhan")
        if typing_seconds > 0:
            parts.append(f"Go {typing_seconds}s")
        if message_id is not None:
            parts.append(f"TG #{message_id}")
        if reply_to_msg_id is not None and reply_to_line is None:
            parts.append(f"Reply TG #{reply_to_msg_id}")
        return " · ".join(parts)

    @staticmethod
    def _error_detail(
        message: str,
        reply_to_msg_id: int | None,
        reply_to_line: int | None,
    ) -> str:
        parts: list[str] = []
        detail = str(message or "").strip() or "Gui that bai"
        parts.append(detail)
        if reply_to_line is not None:
            parts.append(f"Tra loi dong #{reply_to_line}")
        elif reply_to_msg_id is not None:
            parts.append(f"Reply TG #{reply_to_msg_id}")
        return " · ".join(parts)

    @staticmethod
    def _resolve_final_status(job_id: int, error_count: int) -> str:
        if campaign_job_store.should_stop(job_id):
            return "stopped"
        if error_count > 0:
            return "error"
        has_pending = any(
            item.status == "pending"
            for item in campaign_job_store.get_line_results(job_id)
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
    def _pick_delay(script: CampaignScript, speaker_changed: bool) -> int:
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

    @staticmethod
    def _pick_typing_delay(script: CampaignScript, text: str = "") -> int:
        """Duration of Telegram SetTyping ("đang gõ") before send.

        When typing_max_sec > 0 we always return at least 1s so the indicator
        is visible (even for short acks). Longer text leans toward the high end.
        """
        timing = script.timing
        low = int(timing.typing_min_sec)
        high = int(timing.typing_max_sec)
        if high <= 0:
            return 0
        if low > high:
            low, high = high, low

        cleaned = (text or "").strip()
        n = len(cleaned)

        # Length-based base window (phone chat feel), then clamp to [low, high]
        if n <= 4:
            base_lo, base_hi = 1, 2
        elif n <= 12:
            base_lo, base_hi = 2, 4
        elif n <= 28:
            base_lo, base_hi = 2, 5
        elif n <= 60:
            base_lo, base_hi = 3, 6
        else:
            base_lo, base_hi = 4, 8

        lo = max(low, base_lo) if low > 0 else base_lo
        hi = max(base_hi, lo)
        lo = max(1, min(lo, high))  # typing enabled → never skip entirely
        hi = max(lo, min(hi, high))
        return random.randint(lo, hi)

    async def _typing_with_stop(
        self,
        job_id: int,
        phone: str,
        peer_id: str,
        seconds: int,
    ) -> None:
        """Keep Telegram typing indicator alive for `seconds`.

        Holds one authorized Telethon session open for the whole duration
        (Telethon ``client.action`` re-sends SetTyping ~every 3s). The old
        connect→SetTyping→release loop could drop the indicator immediately
        when the TCP session was not kept warm.
        """
        if seconds <= 0:
            return
        result = await telegram_message_service.send_typing_for(
            phone,
            peer_id,
            float(seconds),
            should_stop=lambda: campaign_job_store.should_stop(job_id),
        )
        if result.get("status") != "success":
            # Do not fail the line — message may still send — but log for diagnosis
            logger.warning(
                "SetTyping that bai job=%s phone=%s peer=%s: %s",
                job_id,
                phone,
                peer_id,
                result.get("message") or "unknown",
            )

    async def _sleep_with_stop(self, job_id: int, seconds: float | int) -> None:
        total = max(0.0, float(seconds))
        if total <= 0:
            return
        elapsed = 0.0
        while elapsed < total:
            if campaign_job_store.should_stop(job_id):
                return
            step = min(0.5, total - elapsed)
            await asyncio.sleep(step)
            elapsed += step


campaign_runner = CampaignRunner()