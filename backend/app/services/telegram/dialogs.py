import io
from datetime import datetime, timezone
from pathlib import Path

from telethon import TelegramClient
from telethon.errors import FloodWaitError

from ...config import settings
from .client import telethon_session
from .reactions import default_reactions_policy, fetch_peer_reactions_policy


class TelegramDialogService:
    def __init__(self, api_id: int, api_hash: str, session_dir: Path) -> None:
        self.api_id = api_id
        self.api_hash = api_hash
        self.session_dir = session_dir

    async def list_dialogs(self, phone: str, limit: int = 200) -> dict:
        phone = phone.strip()
        limit = max(1, min(int(limit or 200), 500))

        if not phone:
            return self._dialogs_error(phone, "Thieu phone")

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._dialogs_error(phone, str(exc))

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._dialogs_error(
                phone,
                f"Khong tim thay file session: {session_file}",
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._dialogs_error(
                        phone,
                        "Session chua dang nhap hoac da het han",
                    )

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
                    "counts": counts,
                    "dialogs": items,
                    "message": "OK",
                }
        except FloodWaitError as exc:
            return self._dialogs_error(phone, f"Flood wait {exc.seconds}s")
        except Exception as exc:
            return self._dialogs_error(phone, str(exc))

    async def get_messages(
        self,
        phone: str,
        peer_id: str,
        limit: int = 40,
        offset_id: int = 0,
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        limit = max(1, min(int(limit or 40), 100))
        offset_id = max(0, int(offset_id or 0))

        if not phone:
            return self._messages_error(phone, peer_ref, "Thieu phone")
        if not peer_ref:
            return self._messages_error(phone, peer_ref, "Thieu peer_id")

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._messages_error(phone, peer_ref, str(exc))

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._messages_error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._messages_error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                    )

                entity = await self._resolve_peer(client, peer_ref)
                reactions_policy = await fetch_peer_reactions_policy(client, entity)
                fetch_kwargs: dict = {"limit": limit}
                if offset_id > 0:
                    fetch_kwargs["offset_id"] = offset_id
                messages = await client.get_messages(entity, **fetch_kwargs)
                me = await client.get_me()
                me_id = getattr(me, "id", None)
                sender_names = await self._resolve_sender_names(client, messages)

                rows: list[dict] = []
                for message in reversed(messages):
                    sender_id = self._extract_sender_id(message)
                    sender_name = (
                        sender_names.get(sender_id, "") if sender_id else ""
                    )

                    content_type = self._message_content_type(message)
                    has_photo = self._has_displayable_photo(message)
                    text = message.message or ""
                    if not text and message.media and not has_photo:
                        text = f"[{content_type}]"

                    rows.append(
                        {
                            "id": message.id,
                            "date": self._format_dt(message.date, with_seconds=True),
                            "sender_id": sender_id or "",
                            "sender_name": sender_name,
                            "outgoing": bool(
                                getattr(message, "out", False)
                                or (sender_id and sender_id == me_id)
                            ),
                            "content_type": content_type,
                            "has_media": bool(message.media),
                            "has_photo": has_photo,
                            "text": text[:2000],
                            "reactions": self._format_reactions(message),
                        }
                    )

                title = (
                    getattr(entity, "title", None)
                    or getattr(entity, "first_name", None)
                    or getattr(entity, "username", "")
                    or peer_ref
                )

                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "title": str(title),
                    "messages": rows,
                    "total": len(rows),
                    "has_more_older": len(messages) >= limit,
                    "reactions_policy": reactions_policy,
                    "message": "OK",
                }
        except FloodWaitError as exc:
            return self._messages_error(phone, peer_ref, f"Flood wait {exc.seconds}s")
        except Exception as exc:
            return self._messages_error(phone, peer_ref, str(exc))

    async def mark_dialog_read(
        self,
        phone: str,
        peer_id: str,
        max_id: int = 0,
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        max_id = max(0, int(max_id or 0))

        if not phone:
            return self._mark_read_error(phone, peer_ref, "Thieu phone")
        if not peer_ref:
            return self._mark_read_error(phone, peer_ref, "Thieu peer_id")

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._mark_read_error(phone, peer_ref, str(exc))

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._mark_read_error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._mark_read_error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                    )

                entity = await self._resolve_peer(client, peer_ref)

                if max_id <= 0:
                    latest = await client.get_messages(entity, limit=1)
                    max_id = int(getattr(latest[0], "id", 0) or 0) if latest else 0

                if max_id > 0:
                    message = await client.get_messages(entity, ids=max_id)
                    if message:
                        await client.send_read_acknowledge(entity, message=message)
                    else:
                        await client.send_read_acknowledge(entity, max_id=max_id)

                read_max_id, unread_count = await self._read_dialog_inbox_state(
                    client,
                    entity,
                    fallback_read_max_id=max_id,
                )

                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "read_inbox_max_id": read_max_id,
                    "unread_count": unread_count,
                    "message": "OK",
                }
        except FloodWaitError as exc:
            return self._mark_read_error(phone, peer_ref, f"Flood wait {exc.seconds}s")
        except Exception as exc:
            return self._mark_read_error(phone, peer_ref, str(exc))

    async def get_message_photo(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
    ) -> tuple[bytes, str] | dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()

        if not phone:
            return self._photo_error("Thieu phone")
        if not peer_ref:
            return self._photo_error("Thieu peer_id")
        if message_id < 1:
            return self._photo_error("message_id khong hop le")

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._photo_error(str(exc))

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._photo_error(f"Khong tim thay file session: {session_file}")

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._photo_error(
                        "Session chua dang nhap hoac da het han",
                    )

                entity = await self._resolve_peer(client, peer_ref)
                message = await client.get_messages(entity, ids=message_id)
                if not message or not self._has_displayable_photo(message):
                    return self._photo_error("Tin nhan khong co anh")

                buffer = io.BytesIO()
                await client.download_media(message, file=buffer, thumb=-1)
                data = buffer.getvalue()
                if not data:
                    buffer = io.BytesIO()
                    await client.download_media(message, file=buffer)
                    data = buffer.getvalue()

                if not data:
                    return self._photo_error("Khong tai duoc anh")

                return data, "image/jpeg"
        except FloodWaitError as exc:
            return self._photo_error(f"Flood wait {exc.seconds}s")
        except Exception as exc:
            return self._photo_error(str(exc))

    async def _read_dialog_inbox_state(
        self,
        client: TelegramClient,
        entity,
        *,
        fallback_read_max_id: int = 0,
    ) -> tuple[int, int]:
        dialogs = await client.get_dialogs(limit=1, offset_peer=entity)
        if not dialogs:
            return fallback_read_max_id, 0

        dialog = dialogs[0]
        unread_count = int(getattr(dialog, "unread_count", 0) or 0)
        inner_dialog = getattr(dialog, "dialog", None)
        read_max_id = (
            int(getattr(inner_dialog, "read_inbox_max_id", 0) or 0)
            if inner_dialog is not None
            else fallback_read_max_id
        )
        return read_max_id or fallback_read_max_id, unread_count

    @staticmethod
    def _extract_sender_id(message) -> int | None:
        from_id = getattr(message, "from_id", None)
        if from_id is None:
            return None
        sender_id = getattr(from_id, "user_id", None) or getattr(
            from_id,
            "channel_id",
            None,
        )
        return int(sender_id) if sender_id else None

    @staticmethod
    def _format_entity_name(entity) -> str:
        title = getattr(entity, "title", None)
        if title:
            return str(title).strip()
        name = " ".join(
            part
            for part in [
                getattr(entity, "first_name", "") or "",
                getattr(entity, "last_name", "") or "",
            ]
            if part
        ).strip()
        username = getattr(entity, "username", "") or ""
        entity_id = getattr(entity, "id", "")
        return name or username or str(entity_id)

    async def _resolve_sender_names(
        self,
        client: TelegramClient,
        messages: list,
    ) -> dict[int, str]:
        cache: dict[int, str] = {}
        missing_ids: set[int] = set()

        for message in messages:
            if getattr(message, "out", False):
                continue
            sender_id = self._extract_sender_id(message)
            if not sender_id:
                continue

            sender = getattr(message, "sender", None)
            if sender is not None:
                cache[sender_id] = self._format_entity_name(sender)
                continue

            missing_ids.add(sender_id)

        if missing_ids:
            entities = await client.get_entities(list(missing_ids))
            if not isinstance(entities, list):
                entities = [entities]
            for entity in entities:
                if entity is not None:
                    entity_id = getattr(entity, "id", None)
                    if entity_id is not None:
                        cache[int(entity_id)] = self._format_entity_name(entity)

        for sender_id in missing_ids:
            cache.setdefault(sender_id, str(sender_id))

        return cache

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
    def _format_dt(value, *, with_seconds: bool = False) -> str:
        if not value:
            return ""
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        if with_seconds:
            return value.astimezone().strftime("%d/%m/%Y %H:%M:%S")
        return value.astimezone().strftime("%d/%m/%Y %H:%M")

    @staticmethod
    def _has_displayable_photo(message) -> bool:
        if getattr(message, "photo", None):
            return True
        document = getattr(message, "document", None)
        if document:
            mime = (getattr(document, "mime_type", None) or "").lower()
            return mime.startswith("image/")
        return False

    @staticmethod
    def _format_reactions(message) -> list[dict]:
        reactions_obj = getattr(message, "reactions", None)
        if not reactions_obj:
            return []

        rows: list[dict] = []
        for item in getattr(reactions_obj, "results", None) or []:
            reaction = getattr(item, "reaction", None)
            emoji = ""
            if reaction is not None and hasattr(reaction, "emoticon"):
                emoji = reaction.emoticon or ""
            elif reaction is not None and hasattr(reaction, "document_id"):
                emoji = f"custom:{reaction.document_id}"
            if not emoji:
                continue
            rows.append(
                {
                    "emoji": emoji,
                    "count": int(getattr(item, "count", 0) or 0),
                    "chosen": getattr(item, "chosen_order", None) is not None,
                }
            )
        return rows

    @staticmethod
    def _message_content_type(message) -> str:
        if getattr(message, "photo", None):
            return "photo"
        if getattr(message, "sticker", None):
            return "sticker"
        if getattr(message, "video", None):
            return "video"
        if getattr(message, "voice", None) or getattr(message, "audio", None):
            return "audio"
        if getattr(message, "document", None):
            return "document"
        if getattr(message, "message", None):
            return "text"
        if getattr(message, "media", None):
            return "media"
        return "unknown"

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

    @staticmethod
    def _photo_error(message: str) -> dict:
        return {"status": "error", "message": message}

    @staticmethod
    def _messages_error(phone: str, peer_id: str, message: str) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "title": "",
            "total": 0,
            "messages": [],
            "has_more_older": False,
            "reactions_policy": default_reactions_policy(),
            "message": message,
        }

    @staticmethod
    def _mark_read_error(phone: str, peer_id: str, message: str) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "read_inbox_max_id": 0,
            "unread_count": 0,
            "message": message,
        }


telegram_dialog_service = TelegramDialogService(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)