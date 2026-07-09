from pathlib import Path

from telethon import TelegramClient

from ...common.validation import normalize_peer_ref
from ..client.ops import session_file_for


class MessageActionBase:
    def __init__(self, api_id: int, api_hash: str, session_dir: Path) -> None:
        self.api_id = api_id
        self.api_hash = api_hash
        self.session_dir = session_dir

    async def _resolve_peer(self, client: TelegramClient, peer_ref: str):
        if peer_ref.lstrip("-").isdigit():
            return await client.get_entity(int(peer_ref))
        return await client.get_entity(normalize_peer_ref(peer_ref))

    def _session_file(self, phone: str) -> Path:
        return session_file_for(self.session_dir, phone)

    @staticmethod
    def _error(
        phone: str,
        peer_id: str,
        message: str,
        *,
        message_id: int | None = None,
    ) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "message": message,
        }

    @staticmethod
    def _bulk_forward_error(
        phone: str,
        from_peer_id: str,
        to_peer_id: str,
        message: str,
        message_ids: list[int],
    ) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": to_peer_id,
            "from_peer_id": from_peer_id,
            "to_peer_id": to_peer_id,
            "message_id": message_ids[-1] if message_ids else None,
            "reply_to_msg_id": None,
            "forwarded_count": 0,
            "message_ids": [],
            "message": message,
        }

    @staticmethod
    def _bulk_delete_error(
        phone: str,
        peer_id: str,
        message: str,
        message_ids: list[int],
    ) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_ids[-1] if message_ids else None,
            "reply_to_msg_id": None,
            "deleted_count": 0,
            "message_ids": [],
            "message": message,
        }

    def _forward_error(
        phone: str,
        from_peer_id: str,
        to_peer_id: str,
        message: str,
        message_id: int | None = None,
    ) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": to_peer_id,
            "from_peer_id": from_peer_id,
            "to_peer_id": to_peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "message": message,
        }

    @staticmethod
    def _pin_error(
        phone: str,
        peer_id: str,
        message: str,
        message_id: int | None = None,
    ) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "pinned": False,
            "message": message,
        }

    @staticmethod
    def _react_error(
        phone: str,
        peer_id: str,
        message: str,
        *,
        message_id: int | None = None,
    ) -> dict:
        payload = MessageActionBase._error(
            phone, peer_id, message, message_id=message_id
        )
        payload["emoji"] = None
        return payload

    @staticmethod
    def _vote_error(
        phone: str,
        peer_id: str,
        message: str,
        *,
        message_id: int | None = None,
    ) -> dict:
        payload = MessageActionBase._error(
            phone, peer_id, message, message_id=message_id
        )
        payload["option"] = None
        return payload

    @staticmethod
    def _add_poll_option_error(
        phone: str,
        peer_id: str,
        message: str,
        *,
        message_id: int | None = None,
        label: str | None = None,
        option_hex: str | None = None,
        todo_item_id: int | None = None,
    ) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "label": label,
            "option_hex": option_hex,
            "todo_item_id": todo_item_id,
            "voted": False,
            "message": message,
        }

    @staticmethod
    def _empty_poll_settings() -> dict:
        return {
            "kind": "poll",
            "multiple_choice": False,
            "open_answers": False,
            "shuffle_answers": False,
            "revoting_allowed": True,
            "closed": False,
            "quiz": False,
            "public_voters": False,
            "close_date": None,
        }

    @staticmethod
    def _poll_info_error(
        phone: str,
        peer_id: str,
        message: str,
        *,
        message_id: int | None = None,
    ) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "question": "",
            **MessageActionBase._empty_poll_settings(),
            "options": [],
            "suggested_option_index": None,
            "message": message,
        }
