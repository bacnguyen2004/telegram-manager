import asyncio
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
from telethon.tl.functions.photos import DeletePhotosRequest
from telethon.tl.functions.users import GetFullUserRequest
from telethon.tl.types import InputPhoto

from ...config import BASE_DIR, session_lock, settings
from ...db import metadata_store
from .client import telethon_session


class TelegramSessionService:
    def __init__(self, api_id: int, api_hash: str, session_dir: Path) -> None:
        self.api_id = api_id
        self.api_hash = api_hash
        self.session_dir = session_dir
        self.session_dir.mkdir(parents=True, exist_ok=True)

    def list_phones_on_disk(self) -> list[str]:
        if not self.session_dir.exists():
            return []
        return sorted(path.stem for path in self.session_dir.glob("*.session"))

    def list_sessions(self) -> dict:
        sessions = self.list_phones_on_disk()
        return {"total": len(sessions), "sessions": sessions}

    def resolve_phones(self, phones: list[str] | None) -> list[str]:
        if phones:
            return [phone.strip() for phone in phones if phone.strip()]
        return self.list_phones_on_disk()

    def get_session(self, phone: str) -> dict:
        phone = phone.strip()
        if not phone:
            return self._detail_result(
                "not_found",
                phone,
                exists=False,
                session_file="",
                message="Thieu phone",
            )

        session_base = self.session_dir / phone
        session_file = session_base.with_suffix(".session")
        journal_file = session_base.with_suffix(".session-journal")

        if not session_file.exists():
            return self._detail_result(
                "not_found",
                phone,
                exists=False,
                session_file=str(session_file),
                has_journal=journal_file.exists(),
                message=f"Khong tim thay file session: {session_file}",
            )

        stat = session_file.stat()
        modified_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
        db_metadata = metadata_store.get_session_snapshot(phone)

        return self._detail_result(
            "success",
            phone,
            exists=True,
            session_file=str(session_file),
            size_bytes=stat.st_size,
            modified_at=modified_at,
            has_journal=journal_file.exists(),
            message="OK",
            db_metadata=db_metadata,
        )

    async def delete_session(self, phone: str) -> dict:
        phone = phone.strip()
        if not phone:
            return self._delete_result("error", phone, message="Thieu phone")

        session_base = self.session_dir / phone
        session_file = session_base.with_suffix(".session")
        journal_file = session_base.with_suffix(".session-journal")
        pending_auth_file = self._pending_auth_path(phone)

        if not session_file.exists() and not journal_file.exists():
            return self._delete_result(
                "error",
                phone,
                message=f"Khong tim thay file session: {session_file}",
            )

        try:
            async with session_lock.acquire(phone):
                deleted_files: list[str] = []
                if session_file.exists():
                    session_file.unlink()
                    deleted_files.append(str(session_file))
                if journal_file.exists():
                    journal_file.unlink()
                    deleted_files.append(str(journal_file))

                pending_auth_cleared = pending_auth_file.exists()
                if pending_auth_cleared:
                    pending_auth_file.unlink()

                metadata_store.record_audit(
                    phone,
                    action="sessions.delete",
                    resource=phone,
                    status="success",
                    detail={"deleted_files": deleted_files},
                )
                metadata_store.remove_session_meta(phone)
                self._remove_avatar_file(phone)

                return self._delete_result(
                    "success",
                    phone,
                    deleted_files=deleted_files,
                    pending_auth_cleared=pending_auth_cleared,
                    message="Da xoa session",
                )
        except Exception as exc:
            return self._delete_result("error", phone, message=str(exc))

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

    async def check_sessions(self, phones: list[str] | None = None) -> dict:
        settings.validate_telegram_config()

        target_phones = self.resolve_phones(phones)
        results: list[dict] = []

        for index, phone in enumerate(target_phones):
            if index > 0:
                await asyncio.sleep(0.5)
            results.append(await self._check_one(phone))

        active = sum(1 for item in results if item["status"] == "active")
        unauthorized = sum(1 for item in results if item["status"] == "unauthorized")
        error = sum(1 for item in results if item["status"] == "error")

        return {
            "total": len(target_phones),
            "active": active,
            "unauthorized": unauthorized,
            "error": error,
            "sessions": results,
        }

    async def _check_one(self, phone: str) -> dict:
        session_base = self.session_dir / phone
        session_file = session_base.with_suffix(".session")
        if not session_file.exists():
            return self._result(
                phone,
                "error",
                str(session_file),
                message=f"Khong tim thay file session: {session_file}",
            )

        checked_at = datetime.now(timezone.utc).isoformat()

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    message = "Session chua dang nhap hoac da het han"
                    metadata_store.sync_session(
                        phone,
                        telegram_user_id=None,
                        username=None,
                        display_name=None,
                        status="unauthorized",
                        source="imported",
                        last_error=message,
                    )
                    return self._result(
                        phone,
                        "unauthorized",
                        str(session_file),
                        message=message,
                        last_synced_at=checked_at,
                    )

                me = await client.get_me()
                username = me.username
                display = " ".join(part for part in [me.first_name, me.last_name] if part).strip()
                message = f"Live: {display or phone}"
                if username:
                    message += f" (@{username})"

                has_avatar, avatar_path = await self._sync_avatar(client, phone)
                metadata_store.sync_session(
                    phone,
                    telegram_user_id=me.id,
                    username=username,
                    display_name=display or None,
                    status="active",
                    source="imported",
                    last_error=None,
                    has_avatar=has_avatar,
                    avatar_path=avatar_path,
                )

                return {
                    "phone": phone,
                    "status": "active",
                    "session_file": str(session_file),
                    "me_id": me.id,
                    "username": username,
                    "message": message,
                    "last_synced_at": checked_at,
                }
        except FloodWaitError as exc:
            message = f"Flood wait {exc.seconds}s"
            metadata_store.sync_session(
                phone,
                telegram_user_id=None,
                username=None,
                display_name=None,
                status="error",
                source="imported",
                last_error=message,
            )
            return self._result(
                phone,
                "error",
                str(session_file),
                message=message,
                last_synced_at=checked_at,
            )
        except Exception as exc:
            metadata_store.sync_session(
                phone,
                telegram_user_id=None,
                username=None,
                display_name=None,
                status="error",
                source="imported",
                last_error=str(exc),
            )
            return self._result(
                phone,
                "error",
                str(session_file),
                message=str(exc),
                last_synced_at=checked_at,
            )

    def _pending_auth_path(self, phone: str) -> Path:
        safe_phone = re.sub(r"[^0-9A-Za-z_+-]+", "_", phone)
        return BASE_DIR / "runtime" / "pending_auth" / f"{safe_phone}.json"

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

    async def upload_avatar(self, phone: str, file_bytes: bytes) -> dict:
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

        temp_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as temp_file:
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

                await client.upload_profile_photo(temp_path)
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
                    detail={"has_avatar": has_avatar},
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

    @staticmethod
    def _detail_result(
        status: str,
        phone: str,
        *,
        exists: bool,
        session_file: str,
        size_bytes: int | None = None,
        modified_at: str | None = None,
        has_journal: bool = False,
        message: str,
        db_metadata: dict | None = None,
    ) -> dict:
        payload = {
            "status": status,
            "phone": phone,
            "exists": exists,
            "session_file": session_file,
            "size_bytes": size_bytes,
            "modified_at": modified_at,
            "has_journal": has_journal,
            "message": message,
        }
        if db_metadata is not None:
            payload["db_metadata"] = db_metadata
        return payload

    @staticmethod
    def _delete_result(
        status: str,
        phone: str,
        *,
        deleted_files: list[str] | None = None,
        pending_auth_cleared: bool = False,
        message: str,
    ) -> dict:
        return {
            "status": status,
            "phone": phone,
            "deleted_files": deleted_files or [],
            "pending_auth_cleared": pending_auth_cleared,
            "message": message,
        }

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

    @staticmethod
    def _result(
        phone: str,
        status: str,
        session_file: str,
        *,
        message: str,
        me_id: int | None = None,
        username: str | None = None,
        last_synced_at: str | None = None,
    ) -> dict:
        return {
            "phone": phone,
            "status": status,
            "session_file": session_file,
            "me_id": me_id,
            "username": username,
            "message": message,
            "last_synced_at": last_synced_at,
        }


telegram_session_service = TelegramSessionService(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)