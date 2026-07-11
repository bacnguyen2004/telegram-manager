import json
import re
from pathlib import Path

from telethon.errors import (
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    PhoneNumberBannedError,
    PhoneNumberInvalidError,
    PhoneNumberUnoccupiedError,
    SessionPasswordNeededError,
)
from telethon.tl import types
from telethon.tl.functions.auth import SignUpRequest

from ....config import BASE_DIR, settings
from ....db import metadata_store
from ..client import pending_auth_session


class TelegramAuthService:
    def __init__(self, api_id: int, api_hash: str, session_dir: Path) -> None:
        self.api_id = api_id
        self.api_hash = api_hash
        self.session_dir = session_dir
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self.pending_auth_dir = BASE_DIR / "runtime" / "pending_auth"
        self.pending_auth_dir.mkdir(parents=True, exist_ok=True)

    async def send_code(self, phone: str) -> dict:
        phone = phone.strip()
        if not phone:
            return self._result("error", "Thieu phone", phone)

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._result("error", str(exc), phone)

        try:
            async with pending_auth_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if await client.is_user_authorized():
                    return self._result(
                        "info",
                        "Session da dang nhap san. Kiem tra GET /api/sessions.",
                        phone,
                    )
                sent = await client.send_code_request(phone)
                self._save_phone_code_hash(phone, sent.phone_code_hash)
                return self._result(
                    "success",
                    "Da gui ma OTP qua Telegram app. Nhap ma o buoc tiep theo.",
                    phone,
                )
        except PhoneNumberBannedError:
            return self._result("error", "So dien thoai da bi cam", phone)
        except PhoneNumberInvalidError:
            return self._result("error", "So dien thoai khong hop le", phone)
        except Exception as exc:
            return self._result("error", str(exc), phone)

    async def login(self, phone: str, code: str, password: str | None = None) -> dict:
        phone = phone.strip()
        code = code.strip()
        password = (password or "").strip() or None

        if not phone:
            return self._result("error", "Thieu phone", phone)

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._result("error", str(exc), phone)

        session_base = self.session_dir / phone
        session_file = session_base.with_suffix(".session")
        if not session_file.exists():
            return self._result(
                "error",
                "Chua gui OTP. Hay goi POST /api/auth/send-code truoc.",
                phone,
            )

        phone_code_hash = self._load_phone_code_hash(phone)

        try:
            async with pending_auth_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if await client.is_user_authorized():
                    me = await client.get_me()
                    self._clear_pending_auth(phone)
                    result = self._success_result(phone, session_file, me)
                    self._persist_login(phone, me)
                    return result

                if password and not code:
                    await client.sign_in(password=password)
                elif password and phone_code_hash and code:
                    try:
                        await client.sign_in(phone, code, phone_code_hash=phone_code_hash)
                    except SessionPasswordNeededError:
                        await client.sign_in(password=password)
                elif code:
                    if not phone_code_hash:
                        return self._result(
                            "error",
                            "Thieu phone_code_hash. Hay goi POST /api/auth/send-code lai.",
                            phone,
                        )
                    try:
                        await client.sign_in(phone, code, phone_code_hash=phone_code_hash)
                    except SessionPasswordNeededError:
                        if not password:
                            return self._result(
                                "need_2fa",
                                "Tai khoan bat 2FA. Gui lai POST /api/auth/login kem password.",
                                phone,
                            )
                        await client.sign_in(password=password)
                else:
                    return self._result("error", "Thieu code", phone)

                me = await client.get_me()
                self._clear_pending_auth(phone)
                result = self._success_result(phone, session_file, me)
                self._persist_login(phone, me)
                return result
        except PhoneNumberUnoccupiedError:
            return self._result(
                "need_signup",
                "So chua co tai khoan Telegram. Nhap ten de hoan tat dang ky.",
                phone,
            )
        except PhoneCodeInvalidError:
            return self._result("error", "Ma OTP khong hop le", phone)
        except PhoneCodeExpiredError:
            return self._result("error", "Ma OTP da het han. Hay gui lai send-code.", phone)
        except PhoneNumberBannedError:
            return self._result("error", "So dien thoai da bi cam", phone)
        except Exception as exc:
            return self._result("error", str(exc), phone)

    async def register(
        self,
        phone: str,
        code: str,
        first_name: str,
        last_name: str = "",
    ) -> dict:
        phone = phone.strip()
        code = code.strip()
        first_name = first_name.strip()
        last_name = (last_name or "").strip()

        if not phone:
            return self._result("error", "Thieu phone", phone)
        if not code:
            return self._result("error", "Thieu code", phone)
        if not first_name:
            return self._result("error", "Thieu first_name", phone)

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._result("error", str(exc), phone)

        session_base = self.session_dir / phone
        session_file = session_base.with_suffix(".session")
        if not session_file.exists():
            return self._result(
                "error",
                "Chua gui OTP. Hay goi POST /api/auth/send-code truoc.",
                phone,
            )

        phone_code_hash = self._load_phone_code_hash(phone)
        if not phone_code_hash:
            return self._result(
                "error",
                "Thieu phone_code_hash. Hay goi POST /api/auth/send-code lai.",
                phone,
            )

        try:
            async with pending_auth_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if await client.is_user_authorized():
                    me = await client.get_me()
                    self._clear_pending_auth(phone)
                    result = self._success_result(phone, session_file, me)
                    self._persist_login(phone, me)
                    return result

                result = await client(
                    SignUpRequest(
                        phone_number=phone,
                        phone_code_hash=phone_code_hash,
                        first_name=first_name,
                        last_name=last_name,
                    )
                )
                if not isinstance(result, types.auth.Authorization):
                    return self._result(
                        "error",
                        "Dang ky that bai: phan hoi khong hop le tu Telegram",
                        phone,
                    )
                await client._on_login(result.user)
                me = await client.get_me()
                self._clear_pending_auth(phone)
                result = self._success_result(
                    phone,
                    session_file,
                    me,
                    message="Dang ky thanh cong, da tao file .session",
                )
                self._persist_login(phone, me)
                return result
        except PhoneCodeInvalidError:
            return self._result("error", "Ma OTP khong hop le", phone)
        except PhoneCodeExpiredError:
            return self._result("error", "Ma OTP da het han. Hay gui lai send-code.", phone)
        except PhoneNumberBannedError:
            return self._result("error", "So dien thoai da bi cam", phone)
        except Exception as exc:
            return self._result("error", str(exc), phone)

    def _pending_auth_path(self, phone: str) -> Path:
        safe_phone = re.sub(r"[^0-9A-Za-z_+-]+", "_", phone)
        return self.pending_auth_dir / f"{safe_phone}.json"

    def _save_phone_code_hash(self, phone: str, phone_code_hash: str) -> None:
        path = self._pending_auth_path(phone)
        path.write_text(
            json.dumps({"phone": phone, "phone_code_hash": phone_code_hash}),
            encoding="utf-8",
        )

    def _load_phone_code_hash(self, phone: str) -> str | None:
        path = self._pending_auth_path(phone)
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("phone_code_hash")

    def _clear_pending_auth(self, phone: str) -> None:
        path = self._pending_auth_path(phone)
        path.unlink(missing_ok=True)

    @staticmethod
    def _persist_login(phone: str, me) -> None:
        metadata_store.record_login(
            phone,
            telegram_user_id=getattr(me, "id", None),
            username=getattr(me, "username", None),
            first_name=getattr(me, "first_name", None),
            last_name=getattr(me, "last_name", None),
        )

    @staticmethod
    def _result(status: str, message: str, phone: str) -> dict:
        return {"status": status, "message": message, "phone": phone}

    @staticmethod
    def _success_result(
        phone: str,
        session_file: Path,
        me,
        message: str = "Dang nhap thanh cong, da tao file .session",
    ) -> dict:
        return {
            "status": "success",
            "message": message,
            "phone": phone,
            "first_name": me.first_name or "",
            "last_name": me.last_name or "",
            "username": me.username or "",
            "session_file": str(session_file),
        }
