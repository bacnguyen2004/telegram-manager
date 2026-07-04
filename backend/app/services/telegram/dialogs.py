import io
from datetime import datetime, timezone
from pathlib import Path

from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.functions.messages import GetFullChatRequest
from telethon.tl.types import Channel, Chat, InputMessagesFilterPinned

from ...config import settings
from .client import telethon_session
from .reactions import default_reactions_policy, fetch_peer_reactions_policy

PINNED_MESSAGES_PAGE_SIZE = 30
PINNED_MESSAGES_MAX_LIMIT = 100


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
                    "limit": limit,
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
        around_id: int = 0,
        offset_date: str = "",
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        limit = max(1, min(int(limit or 40), 100))
        offset_id = max(0, int(offset_id or 0))
        around_id = max(0, int(around_id or 0))
        parsed_offset_date = self._parse_offset_date(offset_date)

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
                has_more_older = False
                if around_id > 0:
                    messages, has_more_older = await self._fetch_messages_around(
                        client,
                        entity,
                        around_id,
                        limit,
                    )
                elif parsed_offset_date is not None:
                    messages = await client.get_messages(
                        entity,
                        limit=limit,
                        offset_date=parsed_offset_date,
                    )
                    has_more_older = len(messages) >= limit
                else:
                    fetch_kwargs: dict = {"limit": limit}
                    if offset_id > 0:
                        fetch_kwargs["offset_id"] = offset_id
                    messages = await client.get_messages(entity, **fetch_kwargs)
                    has_more_older = len(messages) >= limit
                me = await client.get_me()
                me_id = getattr(me, "id", None)
                sender_names = await self._resolve_sender_names(client, messages)

                pinned_raw, _pinned_has_more = await self._fetch_pinned_raw(
                    client,
                    entity,
                    limit=PINNED_MESSAGES_PAGE_SIZE,
                )
                pinned_sender_names = await self._resolve_sender_names(
                    client, pinned_raw
                )
                pinned_rows = [
                    self._build_message_row(
                        message,
                        me_id=me_id,
                        sender_names=pinned_sender_names,
                        pinned=True,
                    )
                    for message in pinned_raw
                    if getattr(message, "id", None)
                ]
                pinned_ids = {row["id"] for row in pinned_rows}

                rows: list[dict] = []
                ordered_messages = sorted(
                    [msg for msg in messages if getattr(msg, "id", None)],
                    key=lambda msg: int(msg.id),
                )
                for message in ordered_messages:
                    rows.append(
                        self._build_message_row(
                            message,
                            me_id=me_id,
                            sender_names=sender_names,
                            pinned=message.id in pinned_ids,
                        )
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
                    "has_more_older": has_more_older,
                    "reactions_policy": reactions_policy,
                    "pinned_messages": pinned_rows,
                    "message": "OK",
                }
        except FloodWaitError as exc:
            return self._messages_error(phone, peer_ref, f"Flood wait {exc.seconds}s")
        except Exception as exc:
            return self._messages_error(phone, peer_ref, str(exc))

    async def _fetch_messages_around(
        self,
        client: TelegramClient,
        entity,
        around_id: int,
        limit: int,
    ) -> tuple[list, bool]:
        half = max(1, limit // 2)
        target_result = await client.get_messages(entity, ids=around_id)
        target = (
            target_result
            if target_result and getattr(target_result, "id", None)
            else None
        )
        if isinstance(target_result, list):
            target = next(
                (item for item in target_result if getattr(item, "id", None)),
                None,
            )

        newer = await client.get_messages(entity, min_id=around_id, limit=half)
        older = await client.get_messages(entity, offset_id=around_id, limit=half)

        by_id: dict[int, object] = {}
        for batch in (newer, older, [target] if target else []):
            for message in batch or []:
                message_id = getattr(message, "id", None)
                if message_id:
                    by_id[int(message_id)] = message

        if not by_id:
            return [], False

        ordered = sorted(by_id.values(), key=lambda item: int(getattr(item, "id", 0)))
        trimmed = ordered[-limit:]
        oldest_id = int(getattr(trimmed[0], "id", 0) or 0)
        has_more = any(
            int(getattr(message, "id", 0) or 0) < oldest_id for message in by_id.values()
        )
        return trimmed, has_more

    @staticmethod
    def _parse_offset_date(value: str) -> datetime | None:
        raw = str(value or "").strip()
        if not raw:
            return None
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
            try:
                parsed = datetime.strptime(raw, fmt)
                return parsed.replace(tzinfo=timezone.utc)
            except ValueError:
                continue
        return None

    async def get_pinned_messages(
        self,
        phone: str,
        peer_id: str,
        limit: int = PINNED_MESSAGES_PAGE_SIZE,
        skip: int = 0,
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        limit = max(1, min(int(limit or PINNED_MESSAGES_PAGE_SIZE), PINNED_MESSAGES_MAX_LIMIT))
        skip = max(0, int(skip or 0))

        if not phone:
            return self._pinned_error(phone, peer_ref, "Thieu phone")
        if not peer_ref:
            return self._pinned_error(phone, peer_ref, "Thieu peer_id")

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._pinned_error(phone, peer_ref, str(exc))

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._pinned_error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._pinned_error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                    )

                entity = await self._resolve_peer(client, peer_ref)
                pinned_raw, has_more = await self._fetch_pinned_raw(
                    client,
                    entity,
                    limit=limit,
                    skip=skip,
                )
                me = await client.get_me()
                me_id = getattr(me, "id", None)
                sender_names = await self._resolve_sender_names(client, pinned_raw)
                rows = [
                    self._build_message_row(
                        message,
                        me_id=me_id,
                        sender_names=sender_names,
                        pinned=True,
                    )
                    for message in pinned_raw
                    if getattr(message, "id", None)
                ]

                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "total": len(rows),
                    "messages": rows,
                    "has_more_pinned": has_more,
                    "message": "OK",
                }
        except FloodWaitError as exc:
            return self._pinned_error(phone, peer_ref, f"Flood wait {exc.seconds}s")
        except Exception as exc:
            return self._pinned_error(phone, peer_ref, str(exc))

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

    async def get_new_messages(
        self,
        phone: str,
        peer_id: str,
        min_id: int,
        limit: int = 50,
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        limit = max(1, min(int(limit or 50), 100))
        min_id = max(0, int(min_id or 0))

        if not phone:
            return self._messages_error(phone, peer_ref, "Thieu phone")
        if not peer_ref:
            return self._messages_error(phone, peer_ref, "Thieu peer_id")
        if min_id < 1:
            return self._messages_error(phone, peer_ref, "min_id khong hop le")

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
                raw_messages = await client.get_messages(
                    entity,
                    min_id=min_id,
                    limit=limit,
                )
                filtered = [
                    msg
                    for msg in raw_messages or []
                    if getattr(msg, "id", None) and int(msg.id) > min_id
                ]
                me = await client.get_me()
                me_id = getattr(me, "id", None)
                sender_names = await self._resolve_sender_names(client, filtered)
                rows = [
                    self._build_message_row(
                        message,
                        me_id=me_id,
                        sender_names=sender_names,
                    )
                    for message in sorted(filtered, key=lambda item: int(item.id))
                ]

                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "title": "",
                    "messages": rows,
                    "total": len(rows),
                    "has_more_older": False,
                    "reactions_policy": await fetch_peer_reactions_policy(
                        client, entity
                    ),
                    "pinned_messages": [],
                    "message": "OK",
                }
        except FloodWaitError as exc:
            return self._messages_error(phone, peer_ref, f"Flood wait {exc.seconds}s")
        except Exception as exc:
            return self._messages_error(phone, peer_ref, str(exc))

    async def search_messages(
        self,
        phone: str,
        peer_id: str,
        query: str,
        limit: int = 50,
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        query = (query or "").strip()
        limit = max(1, min(int(limit or 50), 100))

        if not phone:
            return self._messages_error(phone, peer_ref, "Thieu phone")
        if not peer_ref:
            return self._messages_error(phone, peer_ref, "Thieu peer_id")
        if len(query) < 2:
            return self._messages_error(phone, peer_ref, "Tu khoa tim kiem qua ngan")

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
                raw_messages = await client.get_messages(
                    entity,
                    search=query,
                    limit=limit,
                )
                filtered = [
                    msg for msg in raw_messages or [] if getattr(msg, "id", None)
                ]
                me = await client.get_me()
                me_id = getattr(me, "id", None)
                sender_names = await self._resolve_sender_names(client, filtered)
                rows = [
                    self._build_message_row(
                        message,
                        me_id=me_id,
                        sender_names=sender_names,
                    )
                    for message in sorted(filtered, key=lambda item: int(item.id))
                ]

                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "title": "",
                    "messages": rows,
                    "total": len(rows),
                    "has_more_older": False,
                    "reactions_policy": await fetch_peer_reactions_policy(
                        client, entity
                    ),
                    "pinned_messages": [],
                    "message": "OK",
                }
        except FloodWaitError as exc:
            return self._messages_error(phone, peer_ref, f"Flood wait {exc.seconds}s")
        except Exception as exc:
            return self._messages_error(phone, peer_ref, str(exc))

    @staticmethod
    def _dialog_preview_from_row(row: dict) -> dict:
        text = (row.get("text") or "").strip()
        if not text or text == "[photo]":
            content_type = row.get("content_type") or "media"
            text = f"[{content_type}]"
        return {
            "peer_id": "",
            "last_message": text[:200],
            "last_message_id": row.get("id"),
            "date": row.get("date") or "",
        }

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

    async def get_message_media(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
    ) -> tuple[bytes, str, str] | dict:
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
                if not message or not getattr(message, "media", None):
                    return self._photo_error("Tin nhan khong co media")

                buffer = io.BytesIO()
                content_type = self._message_content_type(message)
                if content_type == "photo":
                    await client.download_media(message, file=buffer, thumb=-1)
                    data = buffer.getvalue()
                    if not data:
                        buffer = io.BytesIO()
                        await client.download_media(message, file=buffer)
                        data = buffer.getvalue()
                    mime = "image/jpeg"
                    filename = "photo.jpg"
                else:
                    await client.download_media(message, file=buffer)
                    data = buffer.getvalue()
                    mime, filename = self._media_mime_and_name(message, content_type)

                if not data:
                    return self._photo_error("Khong tai duoc media")

                return data, mime, filename
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

    async def _fetch_pinned_raw(
        self,
        client: TelegramClient,
        entity,
        *,
        limit: int,
        skip: int = 0,
    ) -> tuple[list, bool]:
        page_limit = max(1, min(limit, PINNED_MESSAGES_MAX_LIMIT))
        skip = max(0, int(skip or 0))
        need_total = skip + page_limit + 1
        collected: list = []
        seen: set[int] = set()
        search_offset_id = 0

        def add_messages(items) -> None:
            if not items:
                return
            if not isinstance(items, list):
                items = [items]
            for message in items:
                message_id = getattr(message, "id", None)
                if not message_id:
                    continue
                mid = int(message_id)
                if mid in seen:
                    continue
                seen.add(mid)
                collected.append(message)

        while len(collected) < need_total:
            prev_len = len(collected)
            round_limit = min(100, need_total - len(collected))
            try:
                async for message in client.iter_messages(
                    entity,
                    filter=InputMessagesFilterPinned(),
                    limit=round_limit,
                    offset_id=search_offset_id,
                ):
                    add_messages(message)
                    if len(collected) >= need_total:
                        break
            except Exception:
                break

            if len(collected) == prev_len:
                break

            search_offset_id = min(
                int(getattr(message, "id", 0) or 0) for message in collected
            )
            if search_offset_id <= 0:
                break

        if skip <= 0:
            for pinned_id in await self._legacy_pinned_ids(client, entity):
                try:
                    message = await client.get_messages(entity, ids=pinned_id)
                    add_messages(message)
                except Exception:
                    continue

        collected.sort(
            key=lambda message: int(getattr(message, "id", 0) or 0),
            reverse=True,
        )
        page = collected[skip : skip + page_limit]
        has_more = len(collected) > skip + page_limit
        return page, has_more

    async def _legacy_pinned_ids(self, client: TelegramClient, entity) -> list[int]:
        ids: list[int] = []
        try:
            if isinstance(entity, Channel):
                full = await client(GetFullChannelRequest(channel=entity))
                pinned_id = int(getattr(full.full_chat, "pinned_msg_id", 0) or 0)
                if pinned_id > 0:
                    ids.append(pinned_id)
            elif isinstance(entity, Chat):
                full = await client(GetFullChatRequest(chat_id=entity.id))
                pinned_id = int(getattr(full.full_chat, "pinned_msg_id", 0) or 0)
                if pinned_id > 0:
                    ids.append(pinned_id)
        except Exception:
            return ids
        return ids

    def _build_message_row(
        self,
        message,
        *,
        me_id: int | None,
        sender_names: dict[int, str],
        pinned: bool = False,
    ) -> dict:
        sender_id = self._extract_sender_id(message)
        sender_name = sender_names.get(sender_id, "") if sender_id else ""
        content_type = self._message_content_type(message)
        has_photo = self._has_displayable_photo(message)
        text = message.message or ""
        is_poll = bool(getattr(message, "poll", None))
        if is_poll and not text:
            poll = getattr(message, "poll", None)
            question = getattr(poll, "question", None) if poll else None
            text = (getattr(question, "text", None) or "Poll") if question else "Poll"
        if not text and message.media and not has_photo and not is_poll:
            text = f"[{content_type}]"

        reply_to_msg_id = None
        reply_to_text = ""
        reply_to_sender_name = ""
        reply_header = getattr(message, "reply_to", None)
        if reply_header is not None:
            reply_to_msg_id = int(getattr(reply_header, "reply_to_msg_id", 0) or 0) or None
            reply_to_text = str(getattr(reply_header, "quote_text", None) or "").strip()

        media_file_name = self._media_file_name(message)
        edit_date = getattr(message, "edit_date", None)
        edited = bool(edit_date)

        return {
            "id": message.id,
            "date": self._format_dt(message.date, with_seconds=True),
            "sender_id": sender_id or "",
            "sender_name": sender_name,
            "outgoing": bool(
                getattr(message, "out", False) or (sender_id and sender_id == me_id)
            ),
            "content_type": "poll" if is_poll else content_type,
            "has_media": bool(message.media) or is_poll,
            "has_photo": has_photo,
            "text": text[:2000],
            "pinned": pinned,
            "is_poll": is_poll,
            "reply_to_msg_id": reply_to_msg_id,
            "reply_to_text": reply_to_text[:500],
            "reply_to_sender_name": reply_to_sender_name,
            "media_file_name": media_file_name,
            "edited": edited,
            "edited_date": self._format_dt(edit_date, with_seconds=True) if edited else "",
            "reactions": self._format_reactions(message),
        }

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
    def _media_file_name(message) -> str:
        document = getattr(message, "document", None)
        if not document:
            return ""
        for attr in getattr(document, "attributes", None) or []:
            name = getattr(attr, "file_name", None)
            if name:
                return str(name)
        return ""

    @staticmethod
    def _media_mime_and_name(message, content_type: str) -> tuple[str, str]:
        document = getattr(message, "document", None)
        mime = ""
        if document:
            mime = str(getattr(document, "mime_type", None) or "").strip()
        filename = TelegramDialogService._media_file_name(message)
        defaults = {
            "video": ("video/mp4", "video.mp4"),
            "audio": ("audio/ogg", "audio.ogg"),
            "sticker": ("image/webp", "sticker.webp"),
            "document": ("application/octet-stream", "file.bin"),
            "photo": ("image/jpeg", "photo.jpg"),
        }
        default_mime, default_name = defaults.get(content_type, ("application/octet-stream", "media.bin"))
        return mime or default_mime, filename or default_name

    @staticmethod
    def _message_content_type(message) -> str:
        if getattr(message, "poll", None):
            return "poll"
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
    def _pinned_error(phone: str, peer_id: str, message: str) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "total": 0,
            "messages": [],
            "has_more_pinned": False,
            "message": message,
        }

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
            "pinned_messages": [],
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