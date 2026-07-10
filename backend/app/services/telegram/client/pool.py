import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path

from telethon import TelegramClient

from ....config import session_lock, settings

logger = logging.getLogger(__name__)


@dataclass
class _PhoneClientState:
    client: TelegramClient | None = None
    refcount: int = 0
    listener_refs: int = 0
    op_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    connect_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    idle_task: asyncio.Task | None = None


async def _safe_disconnect(client: TelegramClient | None, *, phone: str, reason: str) -> None:
    """Disconnect Telethon client without leaking noisy GeneratorExit on Windows."""
    if client is None:
        return
    try:
        if client.is_connected():
            await client.disconnect()
        # Let cancelled _recv_loop tasks settle before the client is GC'd
        await asyncio.sleep(0)
    except (asyncio.CancelledError, GeneratorExit):
        raise
    except Exception:
        logger.debug(
            "Telethon disconnect (%s) for %s raised; ignored",
            reason,
            phone,
            exc_info=True,
        )


class TelethonClientPool:
    """Shared Telethon clients per phone.

    Clients stay warm for a short idle window after the last operation so
    campaign typing/send bursts do not connect/disconnect every second
    (which surfaces as ``Connection._recv_loop`` GeneratorExit noise).
    """

    def __init__(self, api_id: int, api_hash: str, session_dir: Path) -> None:
        self.api_id = api_id
        self.api_hash = api_hash
        self.session_dir = session_dir
        self._states: dict[str, _PhoneClientState] = {}
        self._registry_lock = asyncio.Lock()

    @property
    def idle_seconds(self) -> float:
        # Prefer dedicated env; fall back to listener idle (default 300s)
        raw = getattr(settings, "telegram_client_idle_seconds", None)
        if raw is not None:
            try:
                return max(5.0, float(raw))
            except (TypeError, ValueError):
                pass
        try:
            return max(5.0, float(settings.telegram_listener_idle_seconds))
        except (TypeError, ValueError):
            return 120.0

    def _session_base(self, phone: str) -> Path:
        return self.session_dir / phone.strip()

    def _session_file(self, phone: str) -> Path:
        return self._session_base(phone).with_suffix(".session")

    async def _get_state(self, phone: str) -> _PhoneClientState:
        phone = phone.strip()
        async with self._registry_lock:
            state = self._states.get(phone)
            if state is None:
                state = _PhoneClientState()
                self._states[phone] = state
            return state

    def _cancel_idle(self, state: _PhoneClientState) -> None:
        task = state.idle_task
        state.idle_task = None
        if task is not None and not task.done():
            task.cancel()

    def _schedule_idle_disconnect(self, phone: str, state: _PhoneClientState) -> None:
        self._cancel_idle(state)
        delay = self.idle_seconds

        async def _idle() -> None:
            try:
                await asyncio.sleep(delay)
            except asyncio.CancelledError:
                return
            await self._idle_disconnect(phone)

        try:
            state.idle_task = asyncio.create_task(_idle())
        except RuntimeError:
            # No running loop (shutdown edge) — disconnect immediately later
            state.idle_task = None

    async def _idle_disconnect(self, phone: str) -> None:
        state = await self._get_state(phone)
        async with state.connect_lock:
            if state.refcount > 0 or state.listener_refs > 0:
                return
            client = state.client
            state.client = None
            state.idle_task = None
        await _safe_disconnect(client, phone=phone, reason="idle")

    async def ensure_connected(self, phone: str) -> TelegramClient:
        phone = phone.strip()
        if not phone:
            raise ValueError("Thieu phone")

        state = await self._get_state(phone)
        async with state.connect_lock:
            self._cancel_idle(state)
            if state.client and state.client.is_connected():
                return state.client

            session_file = self._session_file(phone)
            if not session_file.exists():
                raise FileNotFoundError(f"Khong tim thay file session: {session_file}")

            async with session_lock.acquire(phone):
                if state.client and state.client.is_connected():
                    return state.client

                if state.client is not None:
                    old = state.client
                    state.client = None
                    await _safe_disconnect(old, phone=phone, reason="reconnect")

                from ..proxy import telethon_proxy_for_phone

                proxy = telethon_proxy_for_phone(phone)
                client_kwargs: dict = {"auto_reconnect": True}
                if proxy is not None:
                    client_kwargs["proxy"] = proxy
                client = TelegramClient(
                    str(self._session_base(phone)),
                    self.api_id,
                    self.api_hash,
                    **client_kwargs,
                )
                await client.connect()
                if not await client.is_user_authorized():
                    await _safe_disconnect(client, phone=phone, reason="unauthorized")
                    state.client = None
                    raise PermissionError("Session chua dang nhap hoac da het han")

                state.client = client
                return client

    async def acquire_listener(self, phone: str) -> TelegramClient:
        state = await self._get_state(phone)
        client = await self.ensure_connected(phone)
        state.listener_refs += 1
        state.refcount += 1
        self._cancel_idle(state)
        return client

    async def release_listener(self, phone: str) -> None:
        phone = phone.strip()
        state = await self._get_state(phone)
        state.listener_refs = max(0, state.listener_refs - 1)
        await self._release(phone, state)

    async def _borrow(self, phone: str, state: _PhoneClientState) -> TelegramClient:
        client = await self.ensure_connected(phone)
        state.refcount += 1
        self._cancel_idle(state)
        return client

    async def _release(self, phone: str, state: _PhoneClientState) -> None:
        state.refcount = max(0, state.refcount - 1)
        if state.refcount > 0 or state.listener_refs > 0:
            return
        if state.client is None:
            return
        # Keep connection warm for the next typing/send in campaign / dialogs
        self._schedule_idle_disconnect(phone, state)

    @asynccontextmanager
    async def locked_client(self, phone: str) -> AsyncIterator[TelegramClient]:
        phone = phone.strip()
        state = await self._get_state(phone)
        async with state.op_lock:
            client = await self.ensure_connected(phone)
            self._cancel_idle(state)
            yield client

    @asynccontextmanager
    async def operation(self, phone: str) -> AsyncIterator[TelegramClient]:
        phone = phone.strip()
        state = await self._get_state(phone)
        async with state.op_lock:
            client = await self._borrow(phone, state)
            try:
                yield client
            finally:
                await self._release(phone, state)

    async def get_client_if_connected(self, phone: str) -> TelegramClient | None:
        state = await self._get_state(phone)
        if state.client and state.client.is_connected():
            return state.client
        return None

    async def drop_client(self, phone: str) -> None:
        """Force-disconnect pooled client so next op reconnects (e.g. after proxy change)."""
        phone = phone.strip()
        if not phone:
            return
        state = await self._get_state(phone)
        self._cancel_idle(state)
        async with state.connect_lock:
            state.refcount = 0
            state.listener_refs = 0
            client = state.client
            state.client = None
        await _safe_disconnect(client, phone=phone, reason="drop")

    async def shutdown(self) -> None:
        async with self._registry_lock:
            phones = list(self._states.keys())

        for phone in phones:
            state = await self._get_state(phone)
            self._cancel_idle(state)
            async with state.connect_lock:
                state.refcount = 0
                state.listener_refs = 0
                client = state.client
                state.client = None
            await _safe_disconnect(client, phone=phone, reason="shutdown")

        async with self._registry_lock:
            self._states.clear()


telethon_client_pool = TelethonClientPool(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)
