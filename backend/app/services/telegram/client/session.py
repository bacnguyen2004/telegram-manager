import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from telethon import TelegramClient

from ....config import session_lock, settings


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
        from ..proxy import telethon_proxy_for_phone

        proxy = telethon_proxy_for_phone(phone)
        client_kwargs: dict = {}
        if proxy is not None:
            client_kwargs["proxy"] = proxy
        client = TelegramClient(str(session_base), api_id, api_hash, **client_kwargs)
        await client.connect()
        try:
            yield client
        finally:
            try:
                if client.is_connected():
                    await client.disconnect()
                # Let cancelled Telethon _recv_loop settle (avoids ignored GeneratorExit)
                await asyncio.sleep(0)
            except Exception:
                pass
