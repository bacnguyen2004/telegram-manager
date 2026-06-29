import json
import re
from pathlib import Path

from telethon.errors import (
    ChannelPrivateError,
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    PhoneNumberBannedError,
    PhoneNumberInvalidError,
    PrivacyKeyInvalidError,
    PrivacyTooLongError,
    SessionPasswordNeededError,
)
from telethon.tl.functions.account import SetPrivacyRequest
from telethon.tl.functions.messages import GetHistoryRequest
from telethon.tl.types import (
    InputPrivacyKeyChatInvite,
    InputPrivacyValueAllowAll,
    InputPrivacyValueAllowContacts,
    InputPrivacyValueDisallowAll,
)

from ...config import BASE_DIR, settings
from .client import telethon_session


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
            async with telethon_session(
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
                    "Da gui ma OTP qua Telegram app. Tiep theo goi POST /api/auth/login hoac /api/auth/register",
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
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if await client.is_user_authorized():
                    me = await client.get_me()
                    self._clear_pending_auth(phone)
                    return self._success_result(phone, session_file, me)

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
                return self._success_result(phone, session_file, me)
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
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if await client.is_user_authorized():
                    me = await client.get_me()
                    self._clear_pending_auth(phone)
                    return self._success_result(phone, session_file, me)

                await client.sign_up(
                    code,
                    first_name=first_name,
                    last_name=last_name,
                    phone=phone,
                    phone_code_hash=phone_code_hash,
                )
                me = await client.get_me()
                self._clear_pending_auth(phone)
                return self._success_result(
                    phone,
                    session_file,
                    me,
                    message="Dang ky thanh cong, da tao file .session",
                )
        except PhoneCodeInvalidError:
            return self._result("error", "Ma OTP khong hop le", phone)
        except PhoneCodeExpiredError:
            return self._result("error", "Ma OTP da het han. Hay gui lai send-code.", phone)
        except PhoneNumberBannedError:
            return self._result("error", "So dien thoai da bi cam", phone)
        except Exception as exc:
            return self._result("error", str(exc), phone)

    async def get_login_code(self, phone: str) -> dict:
        phone = phone.strip()
        if not phone:
            return {"status": "error", "phone": phone, "code": "", "message": "Thieu phone"}

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return {"status": "error", "phone": phone, "code": "", "message": str(exc)}

        session_base = self.session_dir / phone
        session_file = session_base.with_suffix(".session")
        if not session_file.exists():
            return {
                "status": "error",
                "phone": phone,
                "code": "",
                "message": f"Khong tim thay file session: {session_file}",
            }

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return {
                        "status": "error",
                        "phone": phone,
                        "code": "",
                        "message": "Session chua dang nhap hoac da het han",
                    }

                bot = await client.get_entity(777000)
                history = await client(
                    GetHistoryRequest(
                        peer=bot,
                        limit=1,
                        offset_date=None,
                        offset_id=0,
                        max_id=0,
                        min_id=0,
                        add_offset=0,
                        hash=0,
                    )
                )
                if history.messages:
                    code_message = history.messages[0].message
                    code_digits = "".join(char for char in code_message if char.isdigit())
                    if code_digits:
                        return {
                            "status": "success",
                            "phone": phone,
                            "code": code_digits,
                            "message": "OK",
                        }

                return {
                    "status": "error",
                    "phone": phone,
                    "code": "",
                    "message": "Khong tim thay ma xac thuc trong tin nhan Telegram",
                }
        except ChannelPrivateError:
            return {
                "status": "error",
                "phone": phone,
                "code": "",
                "message": "Khong co quyen truy cap",
            }
        except Exception as exc:
            return {"status": "error", "phone": phone, "code": "", "message": str(exc)}

    async def update_2fa(
        self,
        phone: str,
        new_password: str,
        current_password: str | None = None,
        hint: str = "",
    ) -> dict:
        phone = phone.strip()
        new_password = new_password.strip()
        current_password = (current_password or "").strip() or None
        hint = (hint or "").strip()

        if not phone:
            return self._result("error", "Thieu phone", phone)
        if not new_password:
            return self._result("error", "Thieu new_password", phone)

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._result("error", str(exc), phone)

        session_base = self.session_dir / phone
        session_file = session_base.with_suffix(".session")
        if not session_file.exists():
            return self._result(
                "error",
                f"Khong tim thay file session: {session_file}",
                phone,
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._result("error", "Session chua dang nhap hoac da het han", phone)

                if current_password:
                    await client.edit_2fa(
                        current_password=current_password,
                        new_password=new_password,
                        hint=hint,
                    )
                else:
                    await client.edit_2fa(new_password=new_password, hint=hint)

                return self._result("success", "Cap nhat 2FA thanh cong", phone)
        except Exception as exc:
            return self._result("error", str(exc), phone)

    async def update_privacy(self, phone: str, rule_type: str) -> dict:
        phone = phone.strip()
        rule_type = rule_type.strip().lower()

        if not phone:
            return self._result("error", "Thieu phone", phone)

        if rule_type == "all":
            rule = InputPrivacyValueAllowAll()
        elif rule_type == "contacts":
            rule = InputPrivacyValueAllowContacts()
        elif rule_type == "nobody":
            rule = InputPrivacyValueDisallowAll()
        else:
            return self._result(
                "error",
                "rule_type khong hop le. Dung: all | contacts | nobody",
                phone,
            )

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._result("error", str(exc), phone)

        session_base = self.session_dir / phone
        session_file = session_base.with_suffix(".session")
        if not session_file.exists():
            return self._result(
                "error",
                f"Khong tim thay file session: {session_file}",
                phone,
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._result("error", "Session chua dang nhap hoac da het han", phone)

                await client(
                    SetPrivacyRequest(
                        key=InputPrivacyKeyChatInvite(),
                        rules=[rule],
                    )
                )
                return {
                    "status": "success",
                    "message": "Cap nhat quyen rieng tu thanh cong",
                    "phone": phone,
                    "rule_type": rule_type,
                }
        except PrivacyKeyInvalidError:
            return self._result("error", "Khoa quyen rieng tu khong hop le", phone)
        except PrivacyTooLongError:
            return self._result("error", "Qua nhieu thuc the", phone)
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


telegram_auth_service = TelegramAuthService(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)