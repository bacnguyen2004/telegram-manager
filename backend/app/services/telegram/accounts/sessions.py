import asyncio
import re
from pathlib import Path

from telethon.errors import FloodWaitError

from ....config import BASE_DIR, session_lock, settings
from ....db import metadata_store
from ..client import telethon_session


class SessionService:
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
            deleted_files: list[str] = []
            pending_auth_cleared = False
            async with session_lock.acquire(phone):
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

            # Outside file lock: tear down live pool/listener so a warm client
            # does not keep using a deleted .session.
            try:
                from ..listener import telegram_listener

                await telegram_listener.stop_listening(phone)
            except Exception:
                pass
            try:
                from ..client.pool import telethon_client_pool

                await telethon_client_pool.drop_client(phone)
            except Exception:
                pass

            return self._delete_result(
                "success",
                phone,
                deleted_files=deleted_files,
                pending_auth_cleared=pending_auth_cleared,
                message="Da xoa session",
            )
        except Exception as exc:
            return self._delete_result("error", phone, message=str(exc))

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
