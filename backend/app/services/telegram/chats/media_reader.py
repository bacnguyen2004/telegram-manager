import io

from telethon.errors import FloodWaitError

from ....config import settings
from ..client import telethon_session
from .dialogs import DialogService


class MediaReaderService(DialogService):
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

    @staticmethod
    def _photo_error(message: str) -> dict:
        return {"status": "error", "message": message}
