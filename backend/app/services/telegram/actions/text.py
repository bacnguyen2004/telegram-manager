import asyncio
from collections.abc import Callable

from telethon.tl.functions.messages import SetTypingRequest
from telethon.tl.types import SendMessageTypingAction

from ...common.errors import MISSING_PEER_MESSAGE, MISSING_PHONE_MESSAGE
from ...common.validation import normalize_phone, validate_text
from ..client import run_with_authorized_client
from .base import MessageActionBase


class TextActionService(MessageActionBase):
    async def send_message(self, phone: str, peer_id: str, text: str) -> dict:
        return await self._send(phone, peer_id, text)

    async def edit_message(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
        text: str,
    ) -> dict:
        phone = normalize_phone(phone)
        peer_ref = str(peer_id or "").strip()
        text = (text or "").strip()

        if not phone:
            return self._error(phone, peer_ref, MISSING_PHONE_MESSAGE, message_id=message_id)
        if not peer_ref:
            return self._error(phone, peer_ref, MISSING_PEER_MESSAGE, message_id=message_id)
        if message_id < 1:
            return self._error(phone, peer_ref, "message_id khong hop le", message_id=message_id)
        text_error = validate_text(text, max_len=4096, field="noi dung tin nhan")
        if text_error:
            # keep legacy messages used by tests/UI
            if text_error.startswith("Thieu"):
                return self._error(phone, peer_ref, "Thieu noi dung tin nhan", message_id=message_id)
            return self._error(phone, peer_ref, "Noi dung qua dai", message_id=message_id)

        async def operation(client):
            entity = await self._resolve_peer(client, peer_ref)
            edited = await client.edit_message(entity, message_id, text)
            edited_id = getattr(edited, "id", message_id)
            return {
                "status": "success",
                "phone": phone,
                "peer_id": peer_ref,
                "message_id": edited_id,
                "reply_to_msg_id": None,
                "message": "Da sua tin nhan",
            }

        return await run_with_authorized_client(
            phone,
            api_id=self.api_id,
            api_hash=self.api_hash,
            session_dir=self.session_dir,
            on_error=lambda msg: self._error(phone, peer_ref, msg, message_id=message_id),
            operation=operation,
        )

    async def delete_messages(
        self,
        phone: str,
        peer_id: str,
        message_ids: list[int],
    ) -> dict:
        phone = normalize_phone(phone)
        peer_ref = str(peer_id or "").strip()
        ids = sorted({int(item) for item in message_ids if int(item) > 0})

        if not phone:
            return self._bulk_delete_error(phone, peer_ref, MISSING_PHONE_MESSAGE, ids)
        if not peer_ref:
            return self._bulk_delete_error(phone, peer_ref, MISSING_PEER_MESSAGE, ids)
        if not ids:
            return self._bulk_delete_error(phone, peer_ref, "Thieu message_ids", ids)
        if len(ids) > 50:
            return self._bulk_delete_error(phone, peer_ref, "Toi da 50 tin moi lan", ids)

        async def operation(client):
            entity = await self._resolve_peer(client, peer_ref)
            await client.delete_messages(entity, ids)
            return {
                "status": "success",
                "phone": phone,
                "peer_id": peer_ref,
                "message_id": ids[-1],
                "reply_to_msg_id": None,
                "deleted_count": len(ids),
                "message_ids": ids,
                "message": f"Da xoa {len(ids)} tin nhan",
            }

        return await run_with_authorized_client(
            phone,
            api_id=self.api_id,
            api_hash=self.api_hash,
            session_dir=self.session_dir,
            on_error=lambda msg: self._bulk_delete_error(phone, peer_ref, msg, ids),
            operation=operation,
        )

    async def delete_message(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
    ) -> dict:
        phone = normalize_phone(phone)
        peer_ref = str(peer_id or "").strip()

        if not phone:
            return self._error(phone, peer_ref, MISSING_PHONE_MESSAGE, message_id=message_id)
        if not peer_ref:
            return self._error(phone, peer_ref, MISSING_PEER_MESSAGE, message_id=message_id)
        if message_id < 1:
            return self._error(phone, peer_ref, "message_id khong hop le", message_id=message_id)

        async def operation(client):
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

        return await run_with_authorized_client(
            phone,
            api_id=self.api_id,
            api_hash=self.api_hash,
            session_dir=self.session_dir,
            on_error=lambda msg: self._error(phone, peer_ref, msg, message_id=message_id),
            operation=operation,
        )

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

    async def send_typing(self, phone: str, peer_id: str) -> dict:
        """One-shot SetTyping (Telegram drops the indicator after ~5s)."""
        phone = normalize_phone(phone)
        peer_ref = str(peer_id or "").strip()

        if not phone:
            return self._error(phone, peer_ref, MISSING_PHONE_MESSAGE)
        if not peer_ref:
            return self._error(phone, peer_ref, MISSING_PEER_MESSAGE)

        async def operation(client):
            entity = await self._resolve_peer(client, peer_ref)
            # InputPeer required; resolve() also converts, but be explicit
            input_peer = await client.get_input_entity(entity)
            await client(
                SetTypingRequest(peer=input_peer, action=SendMessageTypingAction())
            )
            return {
                "status": "success",
                "phone": phone,
                "peer_id": peer_ref,
                "message_id": None,
                "reply_to_msg_id": None,
                "message": "Da gui typing",
            }

        return await run_with_authorized_client(
            phone,
            api_id=self.api_id,
            api_hash=self.api_hash,
            session_dir=self.session_dir,
            on_error=lambda msg: self._error(phone, peer_ref, msg),
            operation=operation,
        )

    async def send_typing_for(
        self,
        phone: str,
        peer_id: str,
        seconds: float,
        *,
        should_stop: Callable[[], bool] | None = None,
    ) -> dict:
        """Hold connection and keep "đang nhập" visible for ``seconds``.

        Uses Telethon ``client.action(..., 'typing')`` which re-sends
        SetTyping ~every 3s while the context is open. Critical for campaign:
        open→type→close thrashing can cancel the indicator before anyone sees it.
        """
        phone = normalize_phone(phone)
        peer_ref = str(peer_id or "").strip()
        duration = max(0.0, float(seconds or 0))

        if not phone:
            return self._error(phone, peer_ref, MISSING_PHONE_MESSAGE)
        if not peer_ref:
            return self._error(phone, peer_ref, MISSING_PEER_MESSAGE)
        if duration <= 0:
            return {
                "status": "success",
                "phone": phone,
                "peer_id": peer_ref,
                "message_id": None,
                "reply_to_msg_id": None,
                "message": "Bo qua typing",
            }

        async def operation(client):
            entity = await self._resolve_peer(client, peer_ref)
            # delay=3: Telegram expires typing after ~5s
            async with client.action(entity, "typing", delay=3):
                elapsed = 0.0
                while elapsed < duration:
                    if should_stop is not None and should_stop():
                        break
                    step = min(0.5, duration - elapsed)
                    await asyncio.sleep(step)
                    elapsed += step
            return {
                "status": "success",
                "phone": phone,
                "peer_id": peer_ref,
                "message_id": None,
                "reply_to_msg_id": None,
                "message": "Da gui typing",
            }

        return await run_with_authorized_client(
            phone,
            api_id=self.api_id,
            api_hash=self.api_hash,
            session_dir=self.session_dir,
            on_error=lambda msg: self._error(phone, peer_ref, msg),
            operation=operation,
        )

    async def pin_message(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
        *,
        unpin: bool = False,
    ) -> dict:
        phone = normalize_phone(phone)
        peer_ref = str(peer_id or "").strip()

        if not phone:
            return self._pin_error(phone, peer_ref, MISSING_PHONE_MESSAGE, message_id)
        if not peer_ref:
            return self._pin_error(phone, peer_ref, MISSING_PEER_MESSAGE, message_id)
        if message_id < 1:
            return self._pin_error(phone, peer_ref, "message_id khong hop le", message_id)

        async def operation(client):
            entity = await self._resolve_peer(client, peer_ref)
            message = await client.get_messages(entity, ids=message_id)
            if not message:
                return self._pin_error(phone, peer_ref, "Khong tim thay tin nhan", message_id)

            await client.pin_message(entity, message, notify=False, unpin=unpin)
            return {
                "status": "success",
                "phone": phone,
                "peer_id": peer_ref,
                "message_id": message_id,
                "reply_to_msg_id": None,
                "pinned": not unpin,
                "message": "Da bo ghim" if unpin else "Da ghim tin nhan",
            }

        return await run_with_authorized_client(
            phone,
            api_id=self.api_id,
            api_hash=self.api_hash,
            session_dir=self.session_dir,
            on_error=lambda msg: self._pin_error(phone, peer_ref, msg, message_id),
            operation=operation,
        )

    async def _send(
        self,
        phone: str,
        peer_id: str,
        text: str,
        *,
        reply_to_msg_id: int | None = None,
        success_message: str = "Da gui tin nhan",
    ) -> dict:
        phone = normalize_phone(phone)
        peer_ref = str(peer_id or "").strip()
        text = (text or "").strip()

        if not phone:
            return self._error(phone, peer_ref, MISSING_PHONE_MESSAGE)
        if not peer_ref:
            return self._error(phone, peer_ref, MISSING_PEER_MESSAGE)
        if not text:
            return self._error(phone, peer_ref, "Thieu noi dung tin nhan")
        if reply_to_msg_id is not None and reply_to_msg_id < 1:
            return self._error(phone, peer_ref, "reply_to_msg_id khong hop le")

        async def operation(client):
            entity = await self._resolve_peer(client, peer_ref)
            if reply_to_msg_id is not None:
                sent = await client.send_message(entity, text, reply_to=reply_to_msg_id)
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

        return await run_with_authorized_client(
            phone,
            api_id=self.api_id,
            api_hash=self.api_hash,
            session_dir=self.session_dir,
            on_error=lambda msg: self._error(phone, peer_ref, msg),
            operation=operation,
        )
