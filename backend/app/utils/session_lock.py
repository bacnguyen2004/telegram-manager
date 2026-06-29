import asyncio
import os
import re
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path


class SessionLockTimeoutError(TimeoutError):
    pass


class SessionLock:
    """Per-phone lock: asyncio lock (same process) + lock file (cross-process)."""

    def __init__(
        self,
        lock_dir: Path,
        *,
        timeout: float = 120.0,
        stale_seconds: float = 300.0,
        poll_interval: float = 0.25,
    ) -> None:
        self.lock_dir = lock_dir
        self.timeout = timeout
        self.stale_seconds = stale_seconds
        self.poll_interval = poll_interval
        self._async_locks: dict[str, asyncio.Lock] = {}
        self._registry_lock = asyncio.Lock()

    def ensure_lock_dir(self) -> None:
        self.lock_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _safe_phone_key(phone: str) -> str:
        return re.sub(r"[^0-9A-Za-z_+-]+", "_", phone.strip()) or "unknown"

    def _lock_path(self, phone: str) -> Path:
        return self.lock_dir / f"{self._safe_phone_key(phone)}.lock"

    def _cleanup_stale(self, path: Path) -> None:
        if not path.exists():
            return
        try:
            if time.time() - path.stat().st_mtime > self.stale_seconds:
                path.unlink(missing_ok=True)
        except OSError:
            pass

    def _try_acquire_file(self, path: Path) -> bool:
        self._cleanup_stale(path)
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            try:
                payload = f"{os.getpid()}\n{time.time()}\n".encode()
                os.write(fd, payload)
            finally:
                os.close(fd)
            return True
        except FileExistsError:
            return False
        except OSError:
            return False

    def _release_file(self, path: Path) -> None:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass

    async def _get_async_lock(self, phone: str) -> asyncio.Lock:
        async with self._registry_lock:
            lock = self._async_locks.get(phone)
            if lock is None:
                lock = asyncio.Lock()
                self._async_locks[phone] = lock
            return lock

    @asynccontextmanager
    async def acquire(self, phone: str) -> AsyncIterator[None]:
        phone = phone.strip()
        if not phone:
            yield
            return

        self.ensure_lock_dir()
        async_lock = await self._get_async_lock(phone)
        async with async_lock:
            path = self._lock_path(phone)
            deadline = time.monotonic() + self.timeout
            while time.monotonic() < deadline:
                if self._try_acquire_file(path):
                    try:
                        yield
                    finally:
                        self._release_file(path)
                    return
                await asyncio.sleep(self.poll_interval)

            raise SessionLockTimeoutError(
                f"Session {phone} dang duoc su dung boi request khac "
                f"(timeout {int(self.timeout)}s)"
            )