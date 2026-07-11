import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from telethon import TelegramClient

from ....config import session_lock, settings


async def _disconnect_quietly(client: TelegramClient) -> None:
    try:
        if client.is_connected():
            await client.disconnect()
        # Let cancelled Telethon _recv_loop settle (avoids ignored GeneratorExit)
        await asyncio.sleep(0)
    except Exception:
        pass


@asynccontextmanager
async def _ephemeral_telethon_client(
    phone: str,
    api_id: int,
    api_hash: str,
    session_dir: Path,
    *,
    extra_client_kwargs: dict | None = None,
) -> AsyncIterator[TelegramClient]:
    """Direct Telethon client under session file lock (not the authorized pool)."""
    async with session_lock.acquire(phone):
        session_base = session_dir / phone.strip()
        from ..proxy import telethon_client_kwargs_for_phone

        client_kwargs: dict = dict(telethon_client_kwargs_for_phone(phone))
        if extra_client_kwargs:
            client_kwargs.update(extra_client_kwargs)
        client = TelegramClient(str(session_base), api_id, api_hash, **client_kwargs)
        await client.connect()
        try:
            yield client
        finally:
            await _disconnect_quietly(client)


@asynccontextmanager
async def pending_auth_session(
    phone: str,
    api_id: int,
    api_hash: str,
    session_dir: Path,
) -> AsyncIterator[TelegramClient]:
    """Client for OTP login/register: may create new session; never uses the pool.

    The pool only serves authorized accounts. Pending auth must open a direct
    client so ``send_code`` / ``sign_in`` / ``SignUp`` work under default
    ``TELEGRAM_LISTENER_ENABLED=true``.
    """
    async with _ephemeral_telethon_client(
        phone, api_id, api_hash, session_dir
    ) as client:
        yield client


@asynccontextmanager
async def telethon_session(
    phone: str,
    api_id: int,
    api_hash: str,
    session_dir: Path,
) -> AsyncIterator[TelegramClient]:
    if settings.telegram_listener_enabled:
        from .pool import telethon_client_pool

        async with telethon_client_pool.operation(phone) as client:
            yield client
        return

    async with _ephemeral_telethon_client(
        phone, api_id, api_hash, session_dir
    ) as client:
        yield client
