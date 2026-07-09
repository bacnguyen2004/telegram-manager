from datetime import datetime, timezone

from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.functions.messages import GetFullChatRequest
from telethon.tl.types import Channel, Chat, InputMessagesFilterPinned

from ....config import settings
from ..client import telethon_session
from ..reactions import default_reactions_policy, fetch_peer_reactions_policy
from .dialogs import DialogService
from .serializer import ChatSerializer

PINNED_MESSAGES_PAGE_SIZE = 30
PINNED_MESSAGES_MAX_LIMIT = 100


class MessagesReaderService(DialogService, ChatSerializer):
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
