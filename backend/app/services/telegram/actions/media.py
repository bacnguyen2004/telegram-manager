import io

from ...common.errors import MISSING_PEER_MESSAGE, MISSING_PHONE_MESSAGE
from ...common.validation import normalize_phone
from ..client import run_with_authorized_client
from .base import MessageActionBase


class MediaActionService(MessageActionBase):
    async def send_media(
        self,
        phone: str,
        peer_id: str,
        file_bytes: bytes,
        filename: str,
        *,
        caption: str | None = None,
        reply_to_msg_id: int | None = None,
        media_kind: str = "image",
    ) -> dict:
        phone = normalize_phone(phone)
        peer_ref = str(peer_id or "").strip()
        caption = (caption or "").strip()
        filename = (filename or "image.jpg").strip() or "image.jpg"

        if not phone:
            return self._error(phone, peer_ref, MISSING_PHONE_MESSAGE)
        if not peer_ref:
            return self._error(phone, peer_ref, MISSING_PEER_MESSAGE)
        if not file_bytes:
            return self._error(phone, peer_ref, "File rong")
        if reply_to_msg_id is not None and reply_to_msg_id < 1:
            return self._error(phone, peer_ref, "reply_to_msg_id khong hop le")
        if len(caption) > 1024:
            return self._error(phone, peer_ref, "Caption toi da 1024 ky tu")

        async def operation(client):
            entity = await self._resolve_peer(client, peer_ref)
            buffer = io.BytesIO(file_bytes)
            buffer.name = filename
            send_kwargs: dict = {
                "caption": caption or None,
                "reply_to": reply_to_msg_id,
            }
            if media_kind == "document":
                send_kwargs["force_document"] = True
            elif media_kind == "video":
                send_kwargs["supports_streaming"] = True
            else:
                send_kwargs["force_document"] = False

            sent = await client.send_file(entity, buffer, **send_kwargs)
            success_labels = {
                "image": "Da gui anh",
                "video": "Da gui video",
                "document": "Da gui file",
            }
            return {
                "status": "success",
                "phone": phone,
                "peer_id": peer_ref,
                "message_id": getattr(sent, "id", None),
                "reply_to_msg_id": reply_to_msg_id,
                "message": success_labels.get(media_kind, "Da gui media"),
            }

        return await run_with_authorized_client(
            phone,
            api_id=self.api_id,
            api_hash=self.api_hash,
            session_dir=self.session_dir,
            on_error=lambda msg: self._error(phone, peer_ref, msg),
            operation=operation,
        )
