from datetime import timezone

from telethon import TelegramClient


class ChatSerializer:
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

    def dialog_preview_from_row(self, row: dict) -> dict:
        return self._dialog_preview_from_row(row)

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

    async def resolve_sender_names(
        self,
        client: TelegramClient,
        messages: list,
    ) -> dict[int, str]:
        return await self._resolve_sender_names(client, messages)

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

    def build_message_row(
        self,
        message,
        *,
        me_id: int | None,
        sender_names: dict[int, str],
        pinned: bool = False,
    ) -> dict:
        return self._build_message_row(
            message,
            me_id=me_id,
            sender_names=sender_names,
            pinned=pinned,
        )

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
        filename = ChatSerializer._media_file_name(message)
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
