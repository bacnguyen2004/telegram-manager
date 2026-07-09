import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from telethon.errors import (
    FloodWaitError,
    UsernameInvalidError,
    UsernameNotModifiedError,
    UsernameOccupiedError,
)
from telethon.tl.functions.account import (
    GetAuthorizationsRequest,
    ResetAuthorizationRequest,
    UpdateProfileRequest,
    UpdateUsernameRequest,
)
from telethon.tl.functions.photos import DeletePhotosRequest, UploadProfilePhotoRequest
from telethon.tl.functions.users import GetFullUserRequest
from telethon.tl.types import InputPhoto

from ....config import settings
from ....db import metadata_store
from ..client import telethon_session
from .sessions import SessionService


class ProfileService(SessionService):
    async def get_me(self, phone: str) -> dict:
        settings.validate_telegram_config()

        phone = phone.strip()
        if not phone:
            return self._me_result("error", phone, message="Thieu phone")

        session_base = self.session_dir / phone
        session_file = session_base.with_suffix(".session")
        if not session_file.exists():
            return self._me_result(
                "error",
                phone,
                message=f"Khong tim thay file session: {session_file}",
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._me_result(
                        "unauthorized",
                        phone,
                        message="Session chua dang nhap hoac da het han",
                    )

                me = await client.get_me()
                about = await self._fetch_about(client, me)
                return self._me_payload(phone, me, about=about)
        except FloodWaitError as exc:
            return self._me_result(
                "error",
                phone,
                message=f"Flood wait {exc.seconds}s",
            )
        except Exception as exc:
            return self._me_result("error", phone, message=str(exc))

    async def list_authorizations(self, phone: str) -> dict:
        settings.validate_telegram_config()

        phone = phone.strip()
        if not phone:
            return self._authorizations_result("error", phone, message="Thieu phone")

        session_file = (self.session_dir / phone).with_suffix(".session")
        if not session_file.exists():
            return self._authorizations_result(
                "error",
                phone,
                message=f"Khong tim thay file session: {session_file}",
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._authorizations_result(
                        "unauthorized",
                        phone,
                        message="Session chua dang nhap hoac da het han",
                    )

                result = await client(GetAuthorizationsRequest())
                items: list[dict] = []
                for auth in result.authorizations:
                    items.append(
                        {
                            "hash": format(auth.hash, "d"),
                            "current": bool(auth.current),
                            "device_model": auth.device_model or "",
                            "platform": auth.platform or "",
                            "system_version": auth.system_version or "",
                            "api_id": auth.api_id,
                            "app_name": auth.app_name or "",
                            "date_created": self._auth_timestamp(auth.date_created),
                            "date_active": self._auth_timestamp(auth.date_active),
                            "ip": auth.ip or "",
                            "country": auth.country or "",
                            "region": auth.region or "",
                        }
                    )
                return {
                    "status": "success",
                    "phone": phone,
                    "total": len(items),
                    "items": items,
                    "message": "OK",
                }
        except FloodWaitError as exc:
            return self._authorizations_result(
                "error",
                phone,
                message=f"Flood wait {exc.seconds}s",
            )
        except Exception as exc:
            return self._authorizations_result("error", phone, message=str(exc))

    async def revoke_authorization(self, phone: str, auth_hash: str) -> dict:
        settings.validate_telegram_config()

        phone = phone.strip()
        auth_hash = auth_hash.strip()
        if not phone or not auth_hash:
            return {
                "status": "error",
                "phone": phone,
                "hash": auth_hash,
                "message": "Thieu phone hoac hash",
            }

        session_file = (self.session_dir / phone).with_suffix(".session")
        if not session_file.exists():
            return {
                "status": "error",
                "phone": phone,
                "hash": auth_hash,
                "message": f"Khong tim thay file session: {session_file}",
            }

        try:
            hash_value = int(auth_hash)
        except ValueError:
            return {
                "status": "error",
                "phone": phone,
                "hash": auth_hash,
                "message": "Hash khong hop le",
            }

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return {
                        "status": "error",
                        "phone": phone,
                        "hash": auth_hash,
                        "message": "Session chua dang nhap hoac da het han",
                    }

                await client(ResetAuthorizationRequest(hash=hash_value))
                return {
                    "status": "success",
                    "phone": phone,
                    "hash": auth_hash,
                    "message": "Da dang xuat thiet bi",
                }
        except FloodWaitError as exc:
            return {
                "status": "error",
                "phone": phone,
                "hash": auth_hash,
                "message": f"Flood wait {exc.seconds}s",
            }
        except Exception as exc:
            return {
                "status": "error",
                "phone": phone,
                "hash": auth_hash,
                "message": str(exc),
            }

    def _avatar_file_path(self, phone: str) -> Path:
        safe_phone = re.sub(r"[^0-9A-Za-z_+-]+", "_", phone)
        return settings.avatar_dir / f"{safe_phone}.jpg"

    def _remove_avatar_file(self, phone: str) -> None:
        avatar_file = self._avatar_file_path(phone)
        if avatar_file.exists():
            avatar_file.unlink()

    async def _sync_avatar(self, client, phone: str) -> tuple[bool | None, str | None]:
        settings.avatar_dir.mkdir(parents=True, exist_ok=True)
        dest = self._avatar_file_path(phone)
        try:
            downloaded = await client.download_profile_photo("me", file=str(dest))
            if not downloaded:
                self._remove_avatar_file(phone)
                return False, None
            saved = Path(downloaded)
            if not saved.exists() or saved.stat().st_size == 0:
                self._remove_avatar_file(phone)
                return False, None
            return True, str(saved.resolve())
        except Exception:
            return None, None

    async def _fetch_about(self, client, me) -> str:
        try:
            full = await client(GetFullUserRequest(me))
            return full.full_user.about or ""
        except Exception:
            return ""

    async def update_profile(
        self,
        phone: str,
        *,
        first_name: str,
        last_name: str,
        username: str,
        about: str,
    ) -> dict:
        settings.validate_telegram_config()

        phone = phone.strip()
        first_name = first_name.strip()
        last_name = last_name.strip()
        username = username.strip().lstrip("@")
        about = about.strip()

        if not phone:
            return self._profile_result("error", phone, message="Thieu phone")
        if not first_name:
            return self._profile_result("error", phone, message="Ten khong duoc de trong")

        session_file = (self.session_dir / phone).with_suffix(".session")
        if not session_file.exists():
            return self._profile_result(
                "error",
                phone,
                message=f"Khong tim thay file session: {session_file}",
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._profile_result(
                        "unauthorized",
                        phone,
                        message="Session chua dang nhap hoac da het han",
                    )

                me = await client.get_me()
                current_first = me.first_name or ""
                current_last = me.last_name or ""
                current_username = me.username or ""
                current_about = await self._fetch_about(client, me)

                if (
                    first_name != current_first
                    or last_name != current_last
                    or about != current_about
                ):
                    await client(
                        UpdateProfileRequest(
                            first_name=first_name,
                            last_name=last_name,
                            about=about,
                        )
                    )

                if username != current_username:
                    try:
                        await client(UpdateUsernameRequest(username=username))
                    except UsernameNotModifiedError:
                        pass
                    except UsernameOccupiedError:
                        return self._profile_result(
                            "error",
                            phone,
                            message="Username da duoc su dung",
                        )
                    except UsernameInvalidError:
                        return self._profile_result(
                            "error",
                            phone,
                            message="Username khong hop le (5-32 ky tu, a-z, 0-9, _)",
                        )

                me = await client.get_me()
                updated_about = await self._fetch_about(client, me)
                display = " ".join(
                    part for part in [me.first_name, me.last_name] if part
                ).strip()
                metadata_store.sync_session(
                    phone,
                    telegram_user_id=me.id,
                    username=me.username,
                    display_name=display or None,
                    status="active",
                    source="imported",
                    last_error=None,
                )
                metadata_store.record_audit(
                    phone,
                    action="sessions.profile.update",
                    resource=phone,
                    status="success",
                    detail={
                        "first_name": me.first_name,
                        "last_name": me.last_name,
                        "username": me.username,
                        "about": updated_about,
                    },
                )
                return self._me_payload(
                    phone,
                    me,
                    about=updated_about,
                    status="success",
                )
        except FloodWaitError as exc:
            return self._profile_result(
                "error",
                phone,
                message=f"Flood wait {exc.seconds}s",
            )
        except Exception as exc:
            return self._profile_result("error", phone, message=str(exc))

    @staticmethod
    def _image_file_suffix(file_bytes: bytes) -> str:
        """Pick temp file extension from magic bytes (DiceBear/UI return PNG)."""
        if file_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
            return ".png"
        if file_bytes.startswith(b"\xff\xd8\xff"):
            return ".jpg"
        if len(file_bytes) >= 12 and file_bytes[:4] == b"RIFF" and file_bytes[8:12] == b"WEBP":
            return ".webp"
        if file_bytes.startswith(b"GIF8"):
            return ".gif"
        return ".jpg"

    async def upload_avatar(self, phone: str, file_bytes: bytes) -> dict:
        settings.validate_telegram_config()

        phone = phone.strip()
        if not phone:
            return self._avatar_update_result("error", phone, message="Thieu phone")
        if not file_bytes:
            return self._avatar_update_result("error", phone, message="File anh trong")

        session_file = (self.session_dir / phone).with_suffix(".session")
        if not session_file.exists():
            return self._avatar_update_result(
                "error",
                phone,
                message=f"Khong tim thay file session: {session_file}",
            )

        temp_path: str | None = None
        try:
            suffix = self._image_file_suffix(file_bytes)
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
                temp_file.write(file_bytes)
                temp_path = temp_file.name

            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._avatar_update_result(
                        "unauthorized",
                        phone,
                        message="Session chua dang nhap hoac da het han",
                    )

                # Telethon has no client.upload_profile_photo — upload file then set profile photo.
                uploaded = await client.upload_file(temp_path)
                await client(UploadProfilePhotoRequest(file=uploaded))
                has_avatar, avatar_path = await self._sync_avatar(client, phone)
                me = await client.get_me()
                display = " ".join(
                    part for part in [me.first_name, me.last_name] if part
                ).strip()
                metadata_store.sync_session(
                    phone,
                    telegram_user_id=me.id,
                    username=me.username,
                    display_name=display or None,
                    status="active",
                    source="imported",
                    has_avatar=has_avatar,
                    avatar_path=avatar_path,
                )
                metadata_store.record_audit(
                    phone,
                    action="sessions.avatar.upload",
                    resource=phone,
                    status="success",
                    detail={"has_avatar": has_avatar, "format": suffix.lstrip(".")},
                )
                return self._avatar_update_result(
                    "success",
                    phone,
                    has_avatar=bool(has_avatar),
                    message="Da cap nhat avatar",
                )
        except FloodWaitError as exc:
            return self._avatar_update_result(
                "error",
                phone,
                message=f"Flood wait {exc.seconds}s",
            )
        except Exception as exc:
            return self._avatar_update_result("error", phone, message=str(exc))
        finally:
            if temp_path:
                Path(temp_path).unlink(missing_ok=True)

    async def delete_avatar(self, phone: str) -> dict:
        settings.validate_telegram_config()

        phone = phone.strip()
        if not phone:
            return self._avatar_update_result("error", phone, message="Thieu phone")

        session_file = (self.session_dir / phone).with_suffix(".session")
        if not session_file.exists():
            return self._avatar_update_result(
                "error",
                phone,
                message=f"Khong tim thay file session: {session_file}",
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._avatar_update_result(
                        "unauthorized",
                        phone,
                        message="Session chua dang nhap hoac da het han",
                    )

                photos = await client.get_profile_photos("me")
                if photos:
                    await client(
                        DeletePhotosRequest(
                            id=[
                                InputPhoto(
                                    id=photo.id,
                                    access_hash=photo.access_hash,
                                    file_reference=photo.file_reference,
                                )
                                for photo in photos
                            ]
                        )
                    )

                self._remove_avatar_file(phone)
                me = await client.get_me()
                display = " ".join(
                    part for part in [me.first_name, me.last_name] if part
                ).strip()
                metadata_store.sync_session(
                    phone,
                    telegram_user_id=me.id,
                    username=me.username,
                    display_name=display or None,
                    status="active",
                    source="imported",
                    has_avatar=False,
                    avatar_path=None,
                )
                metadata_store.record_audit(
                    phone,
                    action="sessions.avatar.delete",
                    resource=phone,
                    status="success",
                )
                return self._avatar_update_result(
                    "success",
                    phone,
                    has_avatar=False,
                    message="Da xoa avatar",
                )
        except FloodWaitError as exc:
            return self._avatar_update_result(
                "error",
                phone,
                message=f"Flood wait {exc.seconds}s",
            )
        except Exception as exc:
            return self._avatar_update_result("error", phone, message=str(exc))

    def get_avatar_bytes(self, phone: str) -> tuple[bytes, str] | dict:
        phone = phone.strip()
        if not phone:
            return {"message": "Thieu phone"}

        snapshot = metadata_store.get_session_snapshot(phone)
        if not snapshot or not snapshot.get("has_avatar"):
            return {"message": "Chua co avatar"}

        avatar_path = snapshot.get("avatar_path")
        if not avatar_path:
            avatar_file = self._avatar_file_path(phone)
        else:
            avatar_file = Path(avatar_path)

        if not avatar_file.exists() or avatar_file.stat().st_size == 0:
            return {"message": "Khong tim thay file avatar"}

        return avatar_file.read_bytes(), "image/jpeg"

    def _me_payload(
        self,
        phone: str,
        me,
        *,
        about: str = "",
        status: str = "success",
    ) -> dict:
        snapshot = metadata_store.get_session_snapshot(phone)
        has_avatar = bool(snapshot and snapshot.get("has_avatar"))
        return {
            "status": status,
            "phone": phone,
            "me_id": me.id,
            "first_name": me.first_name,
            "last_name": me.last_name,
            "username": me.username,
            "about": about,
            "has_avatar": has_avatar,
            "message": "OK",
        }

    @staticmethod
    def _me_result(status: str, phone: str, *, message: str) -> dict:
        return {
            "status": status,
            "phone": phone,
            "has_avatar": False,
            "message": message,
        }

    @staticmethod
    def _profile_result(status: str, phone: str, *, message: str) -> dict:
        return {
            "status": status,
            "phone": phone,
            "has_avatar": False,
            "message": message,
        }

    @staticmethod
    def _avatar_update_result(
        status: str,
        phone: str,
        *,
        has_avatar: bool = False,
        message: str,
    ) -> dict:
        return {
            "status": status,
            "phone": phone,
            "has_avatar": has_avatar,
            "message": message,
        }

    @staticmethod
    def _authorizations_result(status: str, phone: str, *, message: str) -> dict:
        return {
            "status": status,
            "phone": phone,
            "total": 0,
            "items": [],
            "message": message,
        }

    @staticmethod
    def _auth_timestamp(value: datetime | int | None) -> str | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc).isoformat()
        if not value:
            return None
        return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
