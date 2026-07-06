import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path

from telethon import TelegramClient

from ...config import session_lock, settings

logger = logging.getLogger(__name__)


@dataclass
class _PhoneClientState:
    client: TelegramClient | None = None
    refcount: int = 0
    listener_refs: int = 0
    op_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    connect_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class TelethonClientPool:
    def __init__(self, api_id: int, api_hash: str, session_dir: Path) -> None:
        self.api_id = api_id
        self.api_hash = api_hash
        self.session_dir = session_dir
        self._states: dict[str, _PhoneClientState] = {}
        self._registry_lock = asyncio.Lock()

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

    async def ensure_connected(self, phone: str) -> TelegramClient:
        phone = phone.strip()
        if not phone:
            raise ValueError("Thieu phone")

        state = await self._get_state(phone)
        async with state.connect_lock:
            if state.client and state.client.is_connected():
                return state.client

            session_file = self._session_file(phone)
            if not session_file.exists():
                raise FileNotFoundError(f"Khong tim thay file session: {session_file}")

            async with session_lock.acquire(phone):
                if state.client and state.client.is_connected():
                    return state.client

                if state.client is not None:
                    try:
                        await state.client.disconnect()
                    except Exception:
                        pass
                    state.client = None

                client = TelegramClient(
                    str(self._session_base(phone)),
                    self.api_id,
                    self.api_hash,
                    auto_reconnect=True,
                )
                await client.connect()
                if not await client.is_user_authorized():
                    await client.disconnect()
                    state.client = None
                    raise PermissionError("Session chua dang nhap hoac da het han")

                state.client = client
                return client

    async def acquire_listener(self, phone: str) -> TelegramClient:
        state = await self._get_state(phone)
        client = await self.ensure_connected(phone)
        state.listener_refs += 1
        state.refcount += 1
        return client

    async def release_listener(self, phone: str) -> None:
        phone = phone.strip()
        state = await self._get_state(phone)
        state.listener_refs = max(0, state.listener_refs - 1)
        await self._release(phone, state)

    async def _borrow(self, phone: str, state: _PhoneClientState) -> TelegramClient:
        client = await self.ensure_connected(phone)
        state.refcount += 1
        return client

    async def _release(self, phone: str, state: _PhoneClientState) -> None:
        state.refcount = max(0, state.refcount - 1)
        if state.refcount > 0:
            return

        if state.client is None:
            return

        async with state.connect_lock:
            if state.refcount > 0 or state.client is None:
                return
            try:
                await state.client.disconnect()
            except Exception:
                logger.exception("TelethonClientPool disconnect failed for %s", phone)
            state.client = None

    @asynccontextmanager
    async def locked_client(self, phone: str) -> AsyncIterator[TelegramClient]:
        phone = phone.strip()
        state = await self._get_state(phone)
        async with state.op_lock:
            client = await self.ensure_connected(phone)
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

    async def shutdown(self) -> None:
        async with self._registry_lock:
            phones = list(self._states.keys())

        for phone in phones:
            state = await self._get_state(phone)
            async with state.connect_lock:
                state.refcount = 0
                state.listener_refs = 0
                if state.client is not None:
                    try:
                        await state.client.disconnect()
                    except Exception:
                        logger.exception("TelethonClientPool shutdown failed for %s", phone)
                    state.client = None

        async with self._registry_lock:
            self._states.clear()


telethon_client_pool = TelethonClientPool(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)