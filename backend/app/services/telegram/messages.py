import io
from pathlib import Path

from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.functions.messages import SendReactionRequest
from telethon.tl.types import ReactionEmoji, ReactionEmpty

from ...config import settings
from .client import telethon_session
from .reactions import (
    fetch_peer_reactions_policy,
    format_reaction_error,
    is_emoji_allowed,
    reaction_not_allowed_message,
)


class TelegramMessageService:
    def __init__(self, api_id: int, api_hash: str, session_dir: Path) -> None:
        self.api_id = api_id
        self.api_hash = api_hash
        self.session_dir = session_dir

    async def send_message(self, phone: str, peer_id: str, text: str) -> dict:
        return await self._send(phone, peer_id, text)

    async def delete_message(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()

        if not phone:
            return self._error(phone, peer_ref, "Thieu phone", message_id=message_id)
        if not peer_ref:
            return self._error(phone, peer_ref, "Thieu peer_id", message_id=message_id)
        if message_id < 1:
            return self._error(phone, peer_ref, "message_id khong hop le", message_id=message_id)

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._error(phone, peer_ref, str(exc), message_id=message_id)

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
                message_id=message_id,
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
                        message_id=message_id,
                    )

                entity = await self._resolve_peer(client, peer_ref)
                await client.delete_messages(entity, message_id)

                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "message_id": message_id,
                    "reply_to_msg_id": None,
                    "message": "Da xoa tin nhan",
                }
        except FloodWaitError as exc:
            return self._error(
                phone, peer_ref, f"Flood wait {exc.seconds}s", message_id=message_id
            )
        except Exception as exc:
            return self._error(phone, peer_ref, str(exc), message_id=message_id)

    async def reply_message(
        self,
        phone: str,
        peer_id: str,
        text: str,
        reply_to_msg_id: int,
    ) -> dict:
        return await self._send(
            phone,
            peer_id,
            text,
            reply_to_msg_id=reply_to_msg_id,
            success_message="Da tra loi tin nhan",
        )

    async def send_reaction(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
        emoji: str,
    ) -> dict:
        emoji = (emoji or "").strip()
        if not emoji:
            return self._react_error(phone, peer_id, "Thieu emoji", message_id=message_id)

        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        if not phone:
            return self._react_error(phone, peer_ref, "Thieu phone", message_id=message_id)
        if not peer_ref:
            return self._react_error(phone, peer_ref, "Thieu peer_id", message_id=message_id)
        if message_id < 1:
            return self._react_error(
                phone, peer_ref, "message_id khong hop le", message_id=message_id
            )

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._react_error(phone, peer_ref, str(exc), message_id=message_id)

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._react_error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
                message_id=message_id,
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._react_error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                        message_id=message_id,
                    )

                entity = await self._resolve_peer(client, peer_ref)
                message = await client.get_messages(entity, ids=message_id)
                if not message:
                    return self._react_error(
                        phone,
                        peer_ref,
                        "Khong tim thay tin nhan",
                        message_id=message_id,
                    )

                current = self._user_chosen_emoji(message)
                reactions_policy = await fetch_peer_reactions_policy(client, entity)

                if current == emoji:
                    await client(
                        SendReactionRequest(
                            peer=entity,
                            msg_id=message_id,
                            reaction=[ReactionEmpty()],
                        )
                    )
                    return {
                        "status": "success",
                        "phone": phone,
                        "peer_id": peer_ref,
                        "message_id": message_id,
                        "reply_to_msg_id": None,
                        "emoji": None,
                        "message": "Da bo reaction",
                    }

                if not is_emoji_allowed(reactions_policy, emoji):
                    return self._react_error(
                        phone,
                        peer_ref,
                        reaction_not_allowed_message(reactions_policy, emoji),
                        message_id=message_id,
                    )

                if current:
                    await client(
                        SendReactionRequest(
                            peer=entity,
                            msg_id=message_id,
                            reaction=[ReactionEmpty()],
                        )
                    )

                await client(
                    SendReactionRequest(
                        peer=entity,
                        msg_id=message_id,
                        reaction=[ReactionEmoji(emoticon=emoji)],
                        add_to_recent=True,
                    )
                )

                success_message = (
                    "Da doi reaction" if current else "Da them reaction"
                )
                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "message_id": message_id,
                    "reply_to_msg_id": None,
                    "emoji": emoji,
                    "message": success_message,
                }
        except FloodWaitError as exc:
            return self._react_error(
                phone, peer_ref, f"Flood wait {exc.seconds}s", message_id=message_id
            )
        except Exception as exc:
            return self._react_error(
                phone,
                peer_ref,
                format_reaction_error(exc),
                message_id=message_id,
            )

    async def remove_reaction(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
    ) -> dict:
        return await self._react(
            phone,
            peer_id,
            message_id,
            reaction=[ReactionEmpty()],
            emoji=None,
            success_message="Da xoa reaction",
        )

    async def send_media(
        self,
        phone: str,
        peer_id: str,
        file_bytes: bytes,
        filename: str,
        *,
        caption: str | None = None,
        reply_to_msg_id: int | None = None,
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        caption = (caption or "").strip()
        filename = (filename or "image.jpg").strip() or "image.jpg"

        if not phone:
            return self._error(phone, peer_ref, "Thieu phone")
        if not peer_ref:
            return self._error(phone, peer_ref, "Thieu peer_id")
        if not file_bytes:
            return self._error(phone, peer_ref, "File rong")
        if reply_to_msg_id is not None and reply_to_msg_id < 1:
            return self._error(phone, peer_ref, "reply_to_msg_id khong hop le")
        if len(caption) > 1024:
            return self._error(phone, peer_ref, "Caption toi da 1024 ky tu")

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
                buffer = io.BytesIO(file_bytes)
                buffer.name = filename
                sent = await client.send_file(
                    entity,
                    buffer,
                    caption=caption or None,
                    reply_to=reply_to_msg_id,
                    force_document=False,
                )

                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "message_id": getattr(sent, "id", None),
                    "reply_to_msg_id": reply_to_msg_id,
                    "message": "Da gui anh",
                }
        except FloodWaitError as exc:
            return self._error(phone, peer_ref, f"Flood wait {exc.seconds}s")
        except Exception as exc:
            return self._error(phone, peer_ref, str(exc))

    async def _send(
        self,
        phone: str,
        peer_id: str,
        text: str,
        *,
        reply_to_msg_id: int | None = None,
        success_message: str = "Da gui tin nhan",
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        text = (text or "").strip()

        if not phone:
            return self._error(phone, peer_ref, "Thieu phone")
        if not peer_ref:
            return self._error(phone, peer_ref, "Thieu peer_id")
        if not text:
            return self._error(phone, peer_ref, "Thieu noi dung tin nhan")
        if reply_to_msg_id is not None and reply_to_msg_id < 1:
            return self._error(phone, peer_ref, "reply_to_msg_id khong hop le")

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
                if reply_to_msg_id is not None:
                    sent = await client.send_message(
                        entity,
                        text,
                        reply_to=reply_to_msg_id,
                    )
                else:
                    sent = await client.send_message(entity, text)

                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "message_id": getattr(sent, "id", None),
                    "reply_to_msg_id": reply_to_msg_id,
                    "message": success_message,
                }
        except FloodWaitError as exc:
            return self._error(phone, peer_ref, f"Flood wait {exc.seconds}s")
        except Exception as exc:
            return self._error(phone, peer_ref, str(exc))

    async def _react(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
        *,
        reaction: list,
        emoji: str | None,
        success_message: str,
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()

        if not phone:
            return self._react_error(phone, peer_ref, "Thieu phone", message_id=message_id)
        if not peer_ref:
            return self._react_error(phone, peer_ref, "Thieu peer_id", message_id=message_id)
        if message_id < 1:
            return self._react_error(
                phone, peer_ref, "message_id khong hop le", message_id=message_id
            )

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._react_error(phone, peer_ref, str(exc), message_id=message_id)

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._react_error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
                message_id=message_id,
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._react_error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                        message_id=message_id,
                    )

                entity = await self._resolve_peer(client, peer_ref)
                await client(
                    SendReactionRequest(
                        peer=entity,
                        msg_id=message_id,
                        reaction=reaction,
                        add_to_recent=True,
                    )
                )

                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "message_id": message_id,
                    "reply_to_msg_id": None,
                    "emoji": emoji,
                    "message": success_message,
                }
        except FloodWaitError as exc:
            return self._react_error(
                phone, peer_ref, f"Flood wait {exc.seconds}s", message_id=message_id
            )
        except Exception as exc:
            return self._react_error(
                phone,
                peer_ref,
                format_reaction_error(exc),
                message_id=message_id,
            )

    @staticmethod
    def _user_chosen_emoji(message) -> str | None:
        reactions_obj = getattr(message, "reactions", None)
        if not reactions_obj:
            return None
        for item in getattr(reactions_obj, "results", None) or []:
            if getattr(item, "chosen_order", None) is None:
                continue
            reaction = getattr(item, "reaction", None)
            if reaction is not None and hasattr(reaction, "emoticon"):
                return reaction.emoticon or None
        return None

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
    def _react_error(
        phone: str,
        peer_id: str,
        message: str,
        *,
        message_id: int | None = None,
    ) -> dict:
        payload = TelegramMessageService._error(
            phone, peer_id, message, message_id=message_id
        )
        payload["emoji"] = None
        return payload


telegram_message_service = TelegramMessageService(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)