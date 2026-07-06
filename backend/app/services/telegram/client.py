from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from telethon import TelegramClient

from ...config import session_lock, settings


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

    async with session_lock.acquire(phone):
        session_base = session_dir / phone.strip()
        client = TelegramClient(str(session_base), api_id, api_hash)
        await client.connect()
        try:
            yield client
        finally:
            await client.disconnect()