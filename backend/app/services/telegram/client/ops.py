"""Shared Telethon session gate used by action/chat services.

Eliminates repeated:
  validate config → session file → connect → authorized → FloodWait handling
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import TypeVar

from telethon import TelegramClient
from telethon.errors import FloodWaitError

from ....config import settings
from ...common.errors import (
    MISSING_PHONE_MESSAGE,
    UNAUTHORIZED_MESSAGE,
    flood_wait_message,
    missing_session_message,
)
from .session import telethon_session

T = TypeVar("T")

Operation = Callable[[TelegramClient], Awaitable[T]]
ErrorBuilder = Callable[[str], T]
ExceptionMapper = Callable[[Exception], str]


def session_file_for(session_dir: Path, phone: str) -> Path:
    return (session_dir / phone.strip()).with_suffix(".session")


async def run_with_authorized_client(
    phone: str,
    *,
    api_id: int,
    api_hash: str,
    session_dir: Path,
    on_error: ErrorBuilder[T],
    operation: Operation[T],
    map_exception: ExceptionMapper | None = None,
) -> T:
    """Run ``operation(client)`` on an authorized Telethon client.

    Pre-flight failures and Telegram transport errors are converted via
    ``on_error(message)`` so callers keep their existing dict-shaped results.
    """
    phone = (phone or "").strip()
    if not phone:
        return on_error(MISSING_PHONE_MESSAGE)

    try:
        settings.validate_telegram_config()
    except ValueError as exc:
        return on_error(str(exc))

    session_file = session_file_for(session_dir, phone)
    if not session_file.exists():
        return on_error(missing_session_message(session_file))

    try:
        async with telethon_session(phone, api_id, api_hash, session_dir) as client:
            if not await client.is_user_authorized():
                return on_error(UNAUTHORIZED_MESSAGE)
            return await operation(client)
    except FloodWaitError as exc:
        return on_error(flood_wait_message(exc))
    except Exception as exc:
        message = map_exception(exc) if map_exception is not None else str(exc)
        return on_error(message)
