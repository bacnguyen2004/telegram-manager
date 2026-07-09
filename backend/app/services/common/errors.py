"""Map common Telegram / session errors to service messages."""
from __future__ import annotations

from telethon.errors import FloodWaitError


def flood_wait_message(exc: FloodWaitError) -> str:
    return f"Flood wait {exc.seconds}s"


def missing_session_message(session_file) -> str:
    return f"Khong tim thay file session: {session_file}"


UNAUTHORIZED_MESSAGE = "Session chua dang nhap hoac da het han"
MISSING_PHONE_MESSAGE = "Thieu phone"
MISSING_PEER_MESSAGE = "Thieu peer_id"
