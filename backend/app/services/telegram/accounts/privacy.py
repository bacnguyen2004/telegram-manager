from telethon.errors import (
    PrivacyKeyInvalidError,
    PrivacyTooLongError,
)
from telethon.tl.functions.account import SetPrivacyRequest
from telethon.tl.types import (
    InputPrivacyKeyChatInvite,
    InputPrivacyValueAllowAll,
    InputPrivacyValueAllowContacts,
    InputPrivacyValueDisallowAll,
)

from ....config import settings
from ..client import telethon_session
from .auth import TelegramAuthService


class PrivacyService(TelegramAuthService):
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
