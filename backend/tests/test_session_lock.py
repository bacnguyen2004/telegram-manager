import asyncio
import os
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.telegram.client import telethon_session
from app.utils.session_lock import SessionLock, SessionLockTimeoutError


@pytest.fixture
def lock(tmp_path: Path) -> SessionLock:
    return SessionLock(
        tmp_path / "locks",
        timeout=1.5,
        stale_seconds=600,
        poll_interval=0.05,
    )


async def test_lock_acquire_and_release(lock: SessionLock):
    phone = "+84901234567"

    async with lock.acquire(phone):
        assert lock._lock_path(phone).exists()

    assert not lock._lock_path(phone).exists()


async def test_lock_serializes_same_phone(lock: SessionLock):
    phone = "+84901234567"
    state = {"active": 0, "max_active": 0}

    async def worker() -> None:
        async with lock.acquire(phone):
            state["active"] += 1
            state["max_active"] = max(state["max_active"], state["active"])
            await asyncio.sleep(0.15)
            state["active"] -= 1

    await asyncio.gather(worker(), worker())
    assert state["max_active"] == 1


async def test_lock_allows_different_phones_in_parallel(lock: SessionLock):
    state = {"active": 0, "max_active": 0}

    async def worker(phone: str) -> None:
        async with lock.acquire(phone):
            state["active"] += 1
            state["max_active"] = max(state["max_active"], state["active"])
            await asyncio.sleep(0.1)
            state["active"] -= 1

    await asyncio.gather(worker("+84111111111"), worker("+84222222222"))
    assert state["max_active"] == 2


async def test_lock_timeout_when_busy(lock: SessionLock):
    """Simulate 2 workers: separate SessionLock instances, shared lock_dir."""
    phone = "+84901234567"
    worker_b = SessionLock(
        lock.lock_dir,
        timeout=0.5,
        stale_seconds=600,
        poll_interval=0.05,
    )
    holder_ready = asyncio.Event()

    async def holder() -> None:
        async with lock.acquire(phone):
            holder_ready.set()
            await asyncio.sleep(1)

    holder_task = asyncio.create_task(holder())
    await holder_ready.wait()

    with pytest.raises(SessionLockTimeoutError):
        async with worker_b.acquire(phone):
            pass

    await holder_task


async def test_telethon_session_uses_lock_for_same_phone(test_paths):
    phone = "+84901234567"
    session_dir = test_paths["session_dir"]
    state = {"active": 0, "max_active": 0}

    fake_client = MagicMock()
    fake_client.connect = AsyncMock()
    fake_client.disconnect = AsyncMock()
    fake_client.is_connected = MagicMock(return_value=True)

    async def run() -> None:
        with patch(
            "app.services.telegram.client.session.TelegramClient",
            return_value=fake_client,
        ):
            async with telethon_session(phone, 123456, "hash", session_dir):
                state["active"] += 1
                state["max_active"] = max(state["max_active"], state["active"])
                await asyncio.sleep(0.1)
                state["active"] -= 1

    await asyncio.gather(run(), run())
    assert state["max_active"] == 1


def test_cleanup_stale_removes_dead_pid_lock(lock: SessionLock):
    phone = "+84901111111"
    lock.ensure_lock_dir()
    path = lock._lock_path(phone)
    path.write_text("99999999\n0\n", encoding="utf-8")
    import time

    old = time.time() - 10_000
    os.utime(path, (old, old))

    lock._cleanup_stale(path)
    assert not path.exists()


def test_cleanup_stale_keeps_live_pid_lock(lock: SessionLock):
    phone = "+84902222222"
    lock.ensure_lock_dir()
    path = lock._lock_path(phone)
    path.write_text(f"{os.getpid()}\n0\n", encoding="utf-8")
    import time

    old = time.time() - 10_000
    os.utime(path, (old, old))

    lock._cleanup_stale(path)
    assert path.exists()