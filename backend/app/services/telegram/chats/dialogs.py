from pathlib import Path

from telethon import TelegramClient

from ...common.errors import MISSING_PHONE_MESSAGE
from ...common.validation import clamp_limit, normalize_peer_ref, normalize_phone
from ..client import run_with_authorized_client
from ..client.ops import session_file_for
from .serializer import ChatSerializer

PINNED_MESSAGES_PAGE_SIZE = 30
PINNED_MESSAGES_MAX_LIMIT = 100


class DialogService(ChatSerializer):
    def __init__(self, api_id: int, api_hash: str, session_dir: Path) -> None:
        self.api_id = api_id
        self.api_hash = api_hash
        self.session_dir = session_dir

    async def list_dialogs(self, phone: str, limit: int = 200) -> dict:
        phone = normalize_phone(phone)
        limit = clamp_limit(limit, default=200, minimum=1, maximum=500)

        if not phone:
            return self._dialogs_error(phone, MISSING_PHONE_MESSAGE)

        async def operation(client):
            dialogs = await client.get_dialogs(limit=limit)
            items: list[dict] = []
            counts = {"private": 0, "bot": 0, "group": 0, "channel": 0}

            for dialog in dialogs:
                entity = dialog.entity
                username = getattr(entity, "username", None) or ""
                peer_id = getattr(dialog, "id", None)
                title = dialog.name or username or str(peer_id or "")

                is_bot = bool(getattr(entity, "bot", False))
                is_channel = bool(dialog.is_channel and not dialog.is_group)
                is_group = bool(dialog.is_group)
                is_private = bool(dialog.is_user and not is_bot)

                if is_bot:
                    kind = "bot"
                elif is_channel:
                    kind = "channel"
                elif is_group:
                    kind = "group"
                elif is_private:
                    kind = "private"
                else:
                    kind = "chat"

                if kind in counts:
                    counts[kind] += 1

                message = dialog.message
                preview = getattr(message, "message", "") or ""
                if not preview and getattr(message, "media", None):
                    preview = f"[{self._message_content_type(message)}]"

                inner_dialog = getattr(dialog, "dialog", None)
                read_inbox_max_id = (
                    int(getattr(inner_dialog, "read_inbox_max_id", 0) or 0)
                    if inner_dialog is not None
                    else 0
                )

                items.append(
                    {
                        "id": str(peer_id or getattr(entity, "id", "")),
                        "entity_id": str(getattr(entity, "id", "")),
                        "title": title,
                        "username": username,
                        "kind": kind,
                        "is_private": is_private,
                        "is_group": is_group,
                        "is_channel": is_channel,
                        "is_bot": is_bot,
                        "link": f"https://t.me/{username}" if username else "",
                        "unread_count": int(getattr(dialog, "unread_count", 0) or 0),
                        "read_inbox_max_id": read_inbox_max_id,
                        "pinned": bool(getattr(dialog, "pinned", False)),
                        "muted": bool(getattr(dialog, "muted", False)),
                        "date": self._format_dt(message.date if message else None),
                        "last_message_id": getattr(message, "id", "") if message else "",
                        "last_message": preview[:260],
                    }
                )

            return {
                "status": "success",
                "phone": phone,
                "total": len(items),
                "limit": limit,
                "counts": counts,
                "dialogs": items,
                "message": "OK",
            }

        return await run_with_authorized_client(
            phone,
            api_id=self.api_id,
            api_hash=self.api_hash,
            session_dir=self.session_dir,
            on_error=lambda msg: self._dialogs_error(phone, msg),
            operation=operation,
        )

    async def _resolve_peer(self, client: TelegramClient, peer_ref: str):
        if peer_ref.lstrip("-").isdigit():
            return await client.get_entity(int(peer_ref))
        return await client.get_entity(normalize_peer_ref(peer_ref))

    def _session_file(self, phone: str) -> Path:
        return session_file_for(self.session_dir, phone)

    @staticmethod
    def _dialogs_error(phone: str, message: str) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "total": 0,
            "counts": {"private": 0, "bot": 0, "group": 0, "channel": 0},
            "dialogs": [],
            "message": message,
        }
