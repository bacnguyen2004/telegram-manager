from pathlib import Path

from telethon import TelegramClient
from telethon.errors import (
    ChannelsTooMuchError,
    FloodWaitError,
    InviteHashEmptyError,
    InviteHashExpiredError,
    InviteHashInvalidError,
    UserAlreadyParticipantError,
)
from telethon.tl.functions.channels import JoinChannelRequest, LeaveChannelRequest
from telethon.tl.functions.messages import ImportChatInviteRequest

from ...config import settings


class TelegramGroupService:
    def __init__(self, api_id: int, api_hash: str, session_dir: Path) -> None:
        self.api_id = api_id
        self.api_hash = api_hash
        self.session_dir = session_dir

    async def join_group(
        self,
        phone: str,
        group_link: str,
        captcha_enabled: bool = False,
        captcha_timeout: int = 60,
    ) -> dict:
        phone = phone.strip()
        group_link = group_link.strip()

        if not phone:
            return self._action_result("error", phone, group_link, "Thieu phone")
        if not group_link:
            return self._action_result("error", phone, group_link, "Thieu group_link")

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._action_result("error", phone, group_link, str(exc))

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._action_result(
                "error",
                phone,
                group_link,
                f"Khong tim thay file session: {session_file}",
            )

        _ = captcha_enabled, captcha_timeout  # captcha solver — phase sau

        session_base = self.session_dir / phone
        client = TelegramClient(str(session_base), self.api_id, self.api_hash)
        await client.connect()
        try:
            if not await client.is_user_authorized():
                return self._action_result(
                    "error",
                    phone,
                    group_link,
                    "Session chua dang nhap hoac da het han",
                )

            if "+" in group_link:
                invite_code = group_link.split("+", 1)[1].split("?")[0].strip("/")
                await client(ImportChatInviteRequest(invite_code))
            elif "t.me/" in group_link:
                group_name = group_link.rstrip("/").split("/")[-1]
                await client(JoinChannelRequest(group_name))
            else:
                await client(JoinChannelRequest(group_link))

            return self._action_result(
                "success",
                phone,
                group_link,
                "Tham gia nhom thanh cong",
            )
        except UserAlreadyParticipantError:
            return self._action_result(
                "info",
                phone,
                group_link,
                "Da join nhom roi",
            )
        except ChannelsTooMuchError:
            return self._action_result(
                "error",
                phone,
                group_link,
                "Da tham gia qua nhieu nhom",
            )
        except InviteHashEmptyError:
            return self._action_result("error", phone, group_link, "Ma moi trong")
        except InviteHashExpiredError:
            return self._action_result("error", phone, group_link, "Ma moi da het han")
        except InviteHashInvalidError:
            return self._action_result("error", phone, group_link, "Ma moi khong hop le")
        except FloodWaitError as exc:
            return self._action_result(
                "error",
                phone,
                group_link,
                f"Flood wait {exc.seconds}s",
            )
        except Exception as exc:
            return self._action_result("error", phone, group_link, str(exc))
        finally:
            await client.disconnect()

    async def leave_group(self, phone: str, group_link: str) -> dict:
        phone = phone.strip()
        group_link = group_link.strip()

        if not phone:
            return self._action_result("error", phone, group_link, "Thieu phone")
        if not group_link:
            return self._action_result("error", phone, group_link, "Thieu group_link")

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._action_result("error", phone, group_link, str(exc))

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._action_result(
                "error",
                phone,
                group_link,
                f"Khong tim thay file session: {session_file}",
            )

        if "t.me/" in group_link:
            group_ref: str | int = group_link.rstrip("/").split("/")[-1]
        else:
            group_ref = group_link
        if isinstance(group_ref, str) and group_ref.isdigit():
            group_ref = int(group_ref)

        session_base = self.session_dir / phone
        client = TelegramClient(str(session_base), self.api_id, self.api_hash)
        await client.connect()
        try:
            if not await client.is_user_authorized():
                return self._action_result(
                    "error",
                    phone,
                    group_link,
                    "Session chua dang nhap hoac da het han",
                )

            peer = await client.get_entity(group_ref)
            await client(LeaveChannelRequest(peer))
            return self._action_result(
                "success",
                phone,
                group_link,
                "Da roi nhom",
            )
        except FloodWaitError as exc:
            return self._action_result(
                "error",
                phone,
                group_link,
                f"Flood wait {exc.seconds}s",
            )
        except Exception as exc:
            return self._action_result("error", phone, group_link, str(exc))
        finally:
            await client.disconnect()

    async def leave_all_groups(self, phone: str) -> dict:
        phone = phone.strip()

        if not phone:
            return self._leave_all_result("error", phone, 0, "Thieu phone")

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._leave_all_result("error", phone, 0, str(exc))

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._leave_all_result(
                "error",
                phone,
                0,
                f"Khong tim thay file session: {session_file}",
            )

        session_base = self.session_dir / phone
        client = TelegramClient(str(session_base), self.api_id, self.api_hash)
        await client.connect()
        try:
            if not await client.is_user_authorized():
                return self._leave_all_result(
                    "error",
                    phone,
                    0,
                    "Session chua dang nhap hoac da het han",
                )

            dialogs = await client.get_dialogs()
            left_count = 0
            for dialog in dialogs:
                if not (dialog.is_group or dialog.is_channel):
                    continue
                try:
                    await client(LeaveChannelRequest(dialog.entity))
                    left_count += 1
                except FloodWaitError:
                    raise
                except Exception:
                    continue

            return self._leave_all_result(
                "success",
                phone,
                left_count,
                f"Da roi {left_count} nhom/channel",
            )
        except FloodWaitError as exc:
            return self._leave_all_result(
                "error",
                phone,
                0,
                f"Flood wait {exc.seconds}s",
            )
        except Exception as exc:
            return self._leave_all_result("error", phone, 0, str(exc))
        finally:
            await client.disconnect()

    async def list_groups(self, phone: str, limit: int = 1000) -> dict:
        phone = phone.strip()
        limit = max(1, min(int(limit or 1000), 5000))

        if not phone:
            return {
                "status": "error",
                "phone": phone,
                "total": 0,
                "groups": [],
                "message": "Thieu phone",
            }

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return {
                "status": "error",
                "phone": phone,
                "total": 0,
                "groups": [],
                "message": str(exc),
            }

        session_file = self._session_file(phone)
        if not session_file.exists():
            return {
                "status": "error",
                "phone": phone,
                "total": 0,
                "groups": [],
                "message": f"Khong tim thay file session: {session_file}",
            }

        session_base = self.session_dir / phone
        client = TelegramClient(str(session_base), self.api_id, self.api_hash)
        await client.connect()
        try:
            if not await client.is_user_authorized():
                return {
                    "status": "error",
                    "phone": phone,
                    "total": 0,
                    "groups": [],
                    "message": "Session chua dang nhap hoac da het han",
                }

            dialogs = await client.get_dialogs(limit=limit)
            groups: list[dict] = []
            for dialog in dialogs:
                if not (dialog.is_group or dialog.is_channel):
                    continue
                entity = dialog.entity
                username = getattr(entity, "username", None) or ""
                is_channel = dialog.is_channel and not dialog.is_group
                groups.append(
                    {
                        "id": entity.id,
                        "title": dialog.name or "",
                        "username": username,
                        "link": f"https://t.me/{username}" if username else "",
                        "members_count": getattr(entity, "participants_count", None) or 0,
                        "is_channel": is_channel,
                        "type": "Channel" if is_channel else "Group",
                    }
                )

            groups.sort(key=lambda item: (item.get("title") or "").lower())
            return {
                "status": "success",
                "phone": phone,
                "total": len(groups),
                "groups": groups,
                "message": "OK",
            }
        except FloodWaitError as exc:
            return {
                "status": "error",
                "phone": phone,
                "total": 0,
                "groups": [],
                "message": f"Flood wait {exc.seconds}s",
            }
        except Exception as exc:
            return {
                "status": "error",
                "phone": phone,
                "total": 0,
                "groups": [],
                "message": str(exc),
            }
        finally:
            await client.disconnect()

    def _session_file(self, phone: str) -> Path:
        return (self.session_dir / phone).with_suffix(".session")

    @staticmethod
    def _leave_all_result(
        status: str,
        phone: str,
        left_count: int,
        message: str,
    ) -> dict:
        return {
            "status": status,
            "phone": phone,
            "left_count": left_count,
            "message": message,
        }

    @staticmethod
    def _action_result(
        status: str,
        phone: str,
        group_link: str,
        message: str,
    ) -> dict:
        return {
            "status": status,
            "phone": phone,
            "group_link": group_link,
            "message": message,
        }


telegram_group_service = TelegramGroupService(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)