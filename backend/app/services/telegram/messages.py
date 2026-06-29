from pathlib import Path

from telethon import TelegramClient
from telethon.errors import FloodWaitError

from ...config import settings
from .client import telethon_session


class TelegramMessageService:
    def __init__(self, api_id: int, api_hash: str, session_dir: Path) -> None:
        self.api_id = api_id
        self.api_hash = api_hash
        self.session_dir = session_dir

    async def send_message(self, phone: str, peer_id: str, text: str) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        text = (text or "").strip()

        if not phone:
            return self._error(phone, peer_ref, "Thieu phone")
        if not peer_ref:
            return self._error(phone, peer_ref, "Thieu peer_id")
        if not text:
            return self._error(phone, peer_ref, "Thieu noi dung tin nhan")

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._error(phone, peer_ref, str(exc))

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                    )

                entity = await self._resolve_peer(client, peer_ref)
                sent = await client.send_message(entity, text)

                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "message_id": getattr(sent, "id", None),
                    "message": "Da gui tin nhan",
                }
        except FloodWaitError as exc:
            return self._error(phone, peer_ref, f"Flood wait {exc.seconds}s")
        except Exception as exc:
            return self._error(phone, peer_ref, str(exc))

    async def _resolve_peer(self, client: TelegramClient, peer_ref: str):
        if peer_ref.lstrip("-").isdigit():
            return await client.get_entity(int(peer_ref))
        normalized = peer_ref.strip().rstrip("/")
        if "t.me/" in normalized:
            normalized = normalized.split("/")[-1]
        return await client.get_entity(normalized)

    def _session_file(self, phone: str) -> Path:
        return (self.session_dir / phone).with_suffix(".session")

    @staticmethod
    def _error(phone: str, peer_id: str, message: str) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": None,
            "message": message,
        }


telegram_message_service = TelegramMessageService(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)