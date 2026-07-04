import base64
import io
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.errors import MessagePollClosedError, RevoteNotAllowedError
from telethon.tl.functions.messages import (
    AddPollAnswerRequest,
    AppendTodoListRequest,
    SendReactionRequest,
    SendVoteRequest,
    SetTypingRequest,
    ToggleTodoCompletedRequest,
)
from telethon.tl.types import (
    InputPollAnswer,
    MessageMediaPoll,
    MessageMediaToDo,
    MessageMediaWebPage,
    ReactionEmoji,
    ReactionEmpty,
    SendMessageTypingAction,
    TextWithEntities,
    TodoItem,
)

_TME_POST_LINK_RE = re.compile(
    r"https?://t\.me/(?:c/(\d+)|([A-Za-z0-9_]+))/(\d+)",
    re.IGNORECASE,
)

from ...config import settings
from .client import telethon_session
from .reactions import (
    fetch_peer_reactions_policy,
    format_reaction_error,
    is_emoji_allowed,
    reaction_not_allowed_message,
)


class TelegramMessageService:
    def __init__(self, api_id: int, api_hash: str, session_dir: Path) -> None:
        self.api_id = api_id
        self.api_hash = api_hash
        self.session_dir = session_dir

    async def send_message(self, phone: str, peer_id: str, text: str) -> dict:
        return await self._send(phone, peer_id, text)

    async def edit_message(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
        text: str,
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        text = (text or "").strip()

        if not phone:
            return self._error(phone, peer_ref, "Thieu phone", message_id=message_id)
        if not peer_ref:
            return self._error(phone, peer_ref, "Thieu peer_id", message_id=message_id)
        if message_id < 1:
            return self._error(phone, peer_ref, "message_id khong hop le", message_id=message_id)
        if not text:
            return self._error(phone, peer_ref, "Thieu noi dung tin nhan", message_id=message_id)
        if len(text) > 4096:
            return self._error(phone, peer_ref, "Noi dung qua dai", message_id=message_id)

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._error(phone, peer_ref, str(exc), message_id=message_id)

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
                message_id=message_id,
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                        message_id=message_id,
                    )

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
        except FloodWaitError as exc:
            return self._error(phone, peer_ref, f"Flood wait {exc.seconds}s", message_id=message_id)
        except Exception as exc:
            return self._error(phone, peer_ref, str(exc), message_id=message_id)

    async def delete_messages(
        self,
        phone: str,
        peer_id: str,
        message_ids: list[int],
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        ids = sorted({int(item) for item in message_ids if int(item) > 0})

        if not phone:
            return self._bulk_delete_error(phone, peer_ref, "Thieu phone", ids)
        if not peer_ref:
            return self._bulk_delete_error(phone, peer_ref, "Thieu peer_id", ids)
        if not ids:
            return self._bulk_delete_error(phone, peer_ref, "Thieu message_ids", ids)
        if len(ids) > 50:
            return self._bulk_delete_error(phone, peer_ref, "Toi da 50 tin moi lan", ids)

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._bulk_delete_error(phone, peer_ref, str(exc), ids)

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._bulk_delete_error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
                ids,
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._bulk_delete_error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                        ids,
                    )

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
        except FloodWaitError as exc:
            return self._bulk_delete_error(
                phone, peer_ref, f"Flood wait {exc.seconds}s", ids
            )
        except Exception as exc:
            return self._bulk_delete_error(phone, peer_ref, str(exc), ids)

    async def delete_message(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()

        if not phone:
            return self._error(phone, peer_ref, "Thieu phone", message_id=message_id)
        if not peer_ref:
            return self._error(phone, peer_ref, "Thieu peer_id", message_id=message_id)
        if message_id < 1:
            return self._error(phone, peer_ref, "message_id khong hop le", message_id=message_id)

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._error(phone, peer_ref, str(exc), message_id=message_id)

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
                message_id=message_id,
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                        message_id=message_id,
                    )

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
        except FloodWaitError as exc:
            return self._error(
                phone, peer_ref, f"Flood wait {exc.seconds}s", message_id=message_id
            )
        except Exception as exc:
            return self._error(phone, peer_ref, str(exc), message_id=message_id)

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
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()

        if not phone:
            return self._error(phone, peer_ref, "Thieu phone")
        if not peer_ref:
            return self._error(phone, peer_ref, "Thieu peer_id")

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._error(phone, peer_ref, str(exc))

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                    )

                entity = await self._resolve_peer(client, peer_ref)
                await client(
                    SetTypingRequest(peer=entity, action=SendMessageTypingAction())
                )

                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "message_id": None,
                    "reply_to_msg_id": None,
                    "message": "Da gui typing",
                }
        except FloodWaitError as exc:
            return self._error(phone, peer_ref, f"Flood wait {exc.seconds}s")
        except Exception as exc:
            return self._error(phone, peer_ref, str(exc))

    async def send_reaction(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
        emoji: str,
    ) -> dict:
        emoji = (emoji or "").strip()
        if not emoji:
            return self._react_error(phone, peer_id, "Thieu emoji", message_id=message_id)

        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        if not phone:
            return self._react_error(phone, peer_ref, "Thieu phone", message_id=message_id)
        if not peer_ref:
            return self._react_error(phone, peer_ref, "Thieu peer_id", message_id=message_id)
        if message_id < 1:
            return self._react_error(
                phone, peer_ref, "message_id khong hop le", message_id=message_id
            )

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._react_error(phone, peer_ref, str(exc), message_id=message_id)

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._react_error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
                message_id=message_id,
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._react_error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                        message_id=message_id,
                    )

                entity = await self._resolve_peer(client, peer_ref)
                message = await client.get_messages(entity, ids=message_id)
                if not message:
                    return self._react_error(
                        phone,
                        peer_ref,
                        "Khong tim thay tin nhan",
                        message_id=message_id,
                    )

                current = self._user_chosen_emoji(message)
                reactions_policy = await fetch_peer_reactions_policy(client, entity)

                if current == emoji:
                    await client(
                        SendReactionRequest(
                            peer=entity,
                            msg_id=message_id,
                            reaction=[ReactionEmpty()],
                        )
                    )
                    return {
                        "status": "success",
                        "phone": phone,
                        "peer_id": peer_ref,
                        "message_id": message_id,
                        "reply_to_msg_id": None,
                        "emoji": None,
                        "message": "Da bo reaction",
                    }

                if not is_emoji_allowed(reactions_policy, emoji):
                    return self._react_error(
                        phone,
                        peer_ref,
                        reaction_not_allowed_message(reactions_policy, emoji),
                        message_id=message_id,
                    )

                if current:
                    await client(
                        SendReactionRequest(
                            peer=entity,
                            msg_id=message_id,
                            reaction=[ReactionEmpty()],
                        )
                    )

                await client(
                    SendReactionRequest(
                        peer=entity,
                        msg_id=message_id,
                        reaction=[ReactionEmoji(emoticon=emoji)],
                        add_to_recent=True,
                    )
                )

                success_message = (
                    "Da doi reaction" if current else "Da them reaction"
                )
                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "message_id": message_id,
                    "reply_to_msg_id": None,
                    "emoji": emoji,
                    "message": success_message,
                }
        except FloodWaitError as exc:
            return self._react_error(
                phone, peer_ref, f"Flood wait {exc.seconds}s", message_id=message_id
            )
        except Exception as exc:
            return self._react_error(
                phone,
                peer_ref,
                format_reaction_error(exc),
                message_id=message_id,
            )

    async def get_poll_info(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
        *,
        link: str | None = None,
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()

        if not phone:
            return self._poll_info_error(phone, peer_ref, "Thieu phone", message_id=message_id)
        if not peer_ref:
            return self._poll_info_error(phone, peer_ref, "Thieu peer_id", message_id=message_id)
        if message_id < 1:
            return self._poll_info_error(
                phone, peer_ref, "message_id khong hop le", message_id=message_id
            )

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._poll_info_error(phone, peer_ref, str(exc), message_id=message_id)

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._poll_info_error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
                message_id=message_id,
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._poll_info_error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                        message_id=message_id,
                    )

                entity = await self._resolve_peer(client, peer_ref)
                message_link = (link or "").strip() or self._build_message_link(
                    peer_ref, message_id
                )
                clean_link, _url_option = self._split_message_link(message_link)
                poll_data, error_message = await self._resolve_poll_message(
                    client,
                    entity,
                    message_id,
                    clean_link or message_link,
                )
                if error_message:
                    return self._poll_info_error(
                        phone, peer_ref, error_message, message_id=message_id
                    )

                kind, source, options, poll_message_id, poll_message = poll_data
                _, url_option_bytes = self._split_message_link(message_link or "")
                suggested = self._suggest_option_index(kind, options, url_option_bytes)
                poll_settings = self._votable_settings(kind, source)
                me = await client.get_me()
                vote_meta = self._poll_vote_meta(kind, poll_message, me.id)
                serialized_options = [
                    self._serialize_poll_option(
                        kind,
                        item,
                        index,
                        chosen=vote_meta["option_stats"].get(
                            self._poll_option_stats_key(kind, item, index),
                            {},
                        ).get("chosen", False),
                        voters=vote_meta["option_stats"].get(
                            self._poll_option_stats_key(kind, item, index),
                            {},
                        ).get("voters"),
                    )
                    for index, item in enumerate(options)
                ]
                user_voted = any(option["chosen"] for option in serialized_options)
                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "message_id": poll_message_id,
                    "question": self._votable_question_label(kind, source),
                    **poll_settings,
                    "options": serialized_options,
                    "suggested_option_index": suggested,
                    "user_voted": user_voted,
                    "total_voters": vote_meta["total_voters"],
                    "can_view_stats": vote_meta["can_view_stats"],
                    "message": "OK",
                }
        except FloodWaitError as exc:
            return self._poll_info_error(
                phone, peer_ref, f"Flood wait {exc.seconds}s", message_id=message_id
            )
        except Exception as exc:
            return self._poll_info_error(phone, peer_ref, str(exc), message_id=message_id)

    async def vote_poll(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
        option: str = "",
        *,
        options: list[str] | None = None,
        link: str | None = None,
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        option_raw = (option or "").strip()

        if not phone:
            return self._vote_error(phone, peer_ref, "Thieu phone", message_id=message_id)
        if not peer_ref:
            return self._vote_error(phone, peer_ref, "Thieu peer_id", message_id=message_id)
        if message_id < 1:
            return self._vote_error(
                phone, peer_ref, "message_id khong hop le", message_id=message_id
            )
        message_link = (link or "").strip() or self._build_message_link(peer_ref, message_id)
        _clean_link, url_option_bytes = self._split_message_link(message_link)
        selection_tokens = self._normalize_vote_tokens(option_raw, options)
        if not selection_tokens and not url_option_bytes:
            return self._vote_error(phone, peer_ref, "Thieu lua chon poll", message_id=message_id)

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._vote_error(phone, peer_ref, str(exc), message_id=message_id)

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._vote_error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
                message_id=message_id,
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._vote_error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                        message_id=message_id,
                    )

                entity = await self._resolve_peer(client, peer_ref)
                clean_link, url_option_bytes = self._split_message_link(message_link)
                poll_data, error_message = await self._resolve_poll_message(
                    client,
                    entity,
                    message_id,
                    clean_link or message_link,
                )

                poll_message_id = message_id
                poll_message = None
                vote_kind = "poll"
                poll_option_bytes: list[bytes] = []
                todo_item_ids: list[int] = []
                option_labels: list[str] = []

                if poll_data:
                    vote_kind, source, option_items, poll_message_id, poll_message = poll_data
                    if vote_kind == "poll" and getattr(source, "closed", False):
                        return self._vote_error(
                            phone, peer_ref, "Poll da dong", message_id=poll_message_id
                        )

                    tokens = selection_tokens[:]
                    if not tokens and url_option_bytes:
                        tokens = [url_option_bytes.hex()]

                    if not tokens:
                        return self._vote_error(
                            phone, peer_ref, "Thieu lua chon poll", message_id=poll_message_id
                        )

                    for token in tokens:
                        resolved = self._resolve_votable_token(
                            vote_kind, option_items, token
                        )
                        if resolved is None and url_option_bytes and len(tokens) == 1:
                            resolved = self._resolve_votable_option_bytes(
                                vote_kind, option_items, url_option_bytes
                            )
                        if resolved is None:
                            labels = ", ".join(
                                f"{index + 1}. {self._option_label(vote_kind, item)}"
                                for index, item in enumerate(option_items)
                            )
                            return self._vote_error(
                                phone,
                                peer_ref,
                                f"Lua chon khong hop le ({token}). Co: {labels}",
                                message_id=poll_message_id,
                            )
                        kind, value, label = resolved
                        if kind == "poll" and isinstance(value, bytes):
                            poll_option_bytes.append(value)
                            option_labels.append(label)
                        elif kind == "todo" and isinstance(value, int):
                            todo_item_ids.append(value)
                            option_labels.append(label)

                    if vote_kind == "poll" and not poll_option_bytes:
                        return self._vote_error(
                            phone,
                            peer_ref,
                            "Khong co lua chon poll hop le",
                            message_id=poll_message_id,
                        )
                    if vote_kind == "todo" and not todo_item_ids:
                        return self._vote_error(
                            phone,
                            peer_ref,
                            "Khong co lua chon todo hop le",
                            message_id=poll_message_id,
                        )
                elif url_option_bytes:
                    poll_option_bytes = [url_option_bytes]
                    option_labels = [option_raw or "option"]
                elif selection_tokens:
                    for token in selection_tokens:
                        option_bytes = self._decode_option_hex(token)
                        if option_bytes is None:
                            return self._vote_error(
                                phone,
                                peer_ref,
                                error_message or "Khong tim thay poll",
                                message_id=message_id,
                            )
                        poll_option_bytes.append(option_bytes)
                        option_labels.append(token)
                else:
                    return self._vote_error(
                        phone,
                        peer_ref,
                        error_message or "Khong tim thay poll",
                        message_id=message_id,
                    )

                if poll_message is not None:
                    vote_entity = await client.get_input_entity(poll_message.peer_id)
                else:
                    vote_entity = entity

                option_label = ", ".join(option_labels) or option_raw or "option"

                if vote_kind == "todo":
                    await client(
                        ToggleTodoCompletedRequest(
                            peer=vote_entity,
                            msg_id=poll_message_id,
                            completed=todo_item_ids,
                            incompleted=[],
                        )
                    )
                else:
                    try:
                        await client(
                            SendVoteRequest(
                                peer=vote_entity,
                                msg_id=poll_message_id,
                                options=poll_option_bytes,
                            )
                        )
                    except Exception as exc:
                        if (
                            poll_message is not None
                            and hasattr(poll_message, "click")
                            and len(poll_option_bytes) == 1
                        ):
                            target = poll_option_bytes[0]
                            await poll_message.click(
                                filter=lambda answer: getattr(answer, "option", None)
                                == target
                            )
                        else:
                            raise exc

                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "message_id": poll_message_id,
                    "reply_to_msg_id": None,
                    "option": option_label,
                    "message": f"Da vote: {option_label}",
                }
        except MessagePollClosedError:
            return self._vote_error(phone, peer_ref, "Poll da dong", message_id=message_id)
        except FloodWaitError as exc:
            return self._vote_error(
                phone, peer_ref, f"Flood wait {exc.seconds}s", message_id=message_id
            )
        except Exception as exc:
            return self._vote_error(phone, peer_ref, str(exc), message_id=message_id)

    async def cancel_poll_vote(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
        *,
        link: str | None = None,
        options: list[str] | None = None,
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        selection_tokens = self._normalize_vote_tokens("", options)

        if not phone:
            return self._vote_error(phone, peer_ref, "Thieu phone", message_id=message_id)
        if not peer_ref:
            return self._vote_error(phone, peer_ref, "Thieu peer_id", message_id=message_id)
        if message_id < 1:
            return self._vote_error(
                phone, peer_ref, "message_id khong hop le", message_id=message_id
            )

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._vote_error(phone, peer_ref, str(exc), message_id=message_id)

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._vote_error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
                message_id=message_id,
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._vote_error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                        message_id=message_id,
                    )

                entity = await self._resolve_peer(client, peer_ref)
                message_link = (link or "").strip() or self._build_message_link(
                    peer_ref, message_id
                )
                clean_link, _url_option = self._split_message_link(message_link)
                poll_data, error_message = await self._resolve_poll_message(
                    client,
                    entity,
                    message_id,
                    clean_link or message_link,
                )
                if error_message or not poll_data:
                    return self._vote_error(
                        phone,
                        peer_ref,
                        error_message or "Khong tim thay poll",
                        message_id=message_id,
                    )

                kind, source, option_items, poll_message_id, poll_message = poll_data
                if kind == "poll" and getattr(source, "closed", False):
                    return self._vote_error(
                        phone, peer_ref, "Poll da dong", message_id=poll_message_id
                    )
                if kind == "poll" and getattr(source, "revoting_disabled", False):
                    return self._vote_error(
                        phone,
                        peer_ref,
                        "Poll khong cho phep huy hoac doi vote",
                        message_id=poll_message_id,
                    )

                if poll_message is not None:
                    vote_entity = await client.get_input_entity(poll_message.peer_id)
                else:
                    vote_entity = entity

                if kind == "todo":
                    todo_item_ids: list[int] = []
                    if selection_tokens:
                        for token in selection_tokens:
                            resolved = self._resolve_votable_token(
                                kind, option_items, token
                            )
                            if resolved is None:
                                return self._vote_error(
                                    phone,
                                    peer_ref,
                                    f"Lua chon khong hop le ({token})",
                                    message_id=poll_message_id,
                                )
                            _vote_kind, value, _label = resolved
                            if isinstance(value, int):
                                todo_item_ids.append(value)
                    else:
                        todo_item_ids = await self._user_todo_completion_ids(
                            client, poll_message
                        )

                    if not todo_item_ids:
                        return self._vote_error(
                            phone,
                            peer_ref,
                            "Acc chua chon muc nao de huy",
                            message_id=poll_message_id,
                        )

                    await client(
                        ToggleTodoCompletedRequest(
                            peer=vote_entity,
                            msg_id=poll_message_id,
                            completed=[],
                            incompleted=todo_item_ids,
                        )
                    )
                    label = ", ".join(str(item_id) for item_id in todo_item_ids)
                    return {
                        "status": "success",
                        "phone": phone,
                        "peer_id": peer_ref,
                        "message_id": poll_message_id,
                        "reply_to_msg_id": None,
                        "option": label,
                        "message": "Da huy vote todo",
                    }

                await client(
                    SendVoteRequest(
                        peer=vote_entity,
                        msg_id=poll_message_id,
                        options=[],
                    )
                )
                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "message_id": poll_message_id,
                    "reply_to_msg_id": None,
                    "option": None,
                    "message": "Da huy vote poll",
                }
        except RevoteNotAllowedError:
            return self._vote_error(
                phone,
                peer_ref,
                "Poll khong cho phep huy hoac doi vote",
                message_id=message_id,
            )
        except MessagePollClosedError:
            return self._vote_error(phone, peer_ref, "Poll da dong", message_id=message_id)
        except FloodWaitError as exc:
            return self._vote_error(
                phone, peer_ref, f"Flood wait {exc.seconds}s", message_id=message_id
            )
        except Exception as exc:
            return self._vote_error(phone, peer_ref, str(exc), message_id=message_id)

    async def add_poll_option(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
        label: str,
        *,
        link: str | None = None,
        vote_after: bool = False,
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        label = (label or "").strip()

        if not phone:
            return self._add_poll_option_error(phone, peer_ref, "Thieu phone", message_id)
        if not peer_ref:
            return self._add_poll_option_error(phone, peer_ref, "Thieu peer_id", message_id)
        if message_id < 1:
            return self._add_poll_option_error(
                phone, peer_ref, "message_id khong hop le", message_id
            )
        if not label:
            return self._add_poll_option_error(
                phone, peer_ref, "Thieu noi dung dap an", message_id
            )
        if len(label) > 200:
            return self._add_poll_option_error(
                phone, peer_ref, "Dap an toi da 200 ky tu", message_id
            )

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._add_poll_option_error(phone, peer_ref, str(exc), message_id)

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._add_poll_option_error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
                message_id,
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._add_poll_option_error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                        message_id,
                    )

                entity = await self._resolve_peer(client, peer_ref)
                message_link = (link or "").strip() or self._build_message_link(
                    peer_ref, message_id
                )
                clean_link, _url_option = self._split_message_link(message_link)
                poll_data, error_message = await self._resolve_poll_message(
                    client,
                    entity,
                    message_id,
                    clean_link or message_link,
                )
                if error_message or not poll_data:
                    return self._add_poll_option_error(
                        phone,
                        peer_ref,
                        error_message or "Khong tim thay poll",
                        message_id,
                    )

                kind, source, options, poll_message_id, poll_message = poll_data
                if not self._can_append_options(kind, source):
                    return self._add_poll_option_error(
                        phone,
                        peer_ref,
                        "Poll khong cho phep them dap an",
                        message_id=poll_message_id,
                    )
                if kind == "poll" and getattr(source, "closed", False):
                    return self._add_poll_option_error(
                        phone, peer_ref, "Poll da dong", message_id=poll_message_id
                    )

                if poll_message is not None:
                    vote_entity = await client.get_input_entity(poll_message.peer_id)
                else:
                    vote_entity = entity

                title = self._text_with_entities(label)
                if kind == "poll":
                    await client(
                        AddPollAnswerRequest(
                            peer=vote_entity,
                            msg_id=poll_message_id,
                            answer=InputPollAnswer(text=title),
                        )
                    )
                else:
                    next_id = self._next_todo_item_id(options)
                    await client(
                        AppendTodoListRequest(
                            peer=vote_entity,
                            msg_id=poll_message_id,
                            list=[TodoItem(id=next_id, title=title)],
                        )
                    )

                refreshed, refresh_error = await self._resolve_poll_message(
                    client,
                    entity,
                    message_id,
                    clean_link or message_link,
                )
                if refresh_error or not refreshed:
                    return self._add_poll_option_error(
                        phone,
                        peer_ref,
                        refresh_error or "Khong tai lai duoc poll sau khi them",
                        message_id=poll_message_id,
                    )

                refreshed_kind, _source, refreshed_options, _, _ = refreshed
                added = self._find_added_option(refreshed_kind, refreshed_options, label)
                if added is None:
                    return self._add_poll_option_error(
                        phone,
                        peer_ref,
                        "Da them nhung khong tim thay dap an moi",
                        message_id=poll_message_id,
                    )

                option_hex, todo_item_id = added
                voted = False
                vote_message = f"Da them dap an: {label}"

                if vote_after:
                    vote_tokens: list[str] = []
                    if option_hex:
                        vote_tokens = [option_hex]
                    elif todo_item_id is not None:
                        vote_tokens = [str(todo_item_id)]

                    if vote_tokens:
                        vote_result = await self.add_poll_option_vote(
                            client,
                            vote_entity,
                            poll_message_id,
                            refreshed_kind,
                            refreshed_options,
                            vote_tokens,
                            poll_message,
                        )
                        if vote_result.get("status") == "error":
                            return self._add_poll_option_error(
                                phone,
                                peer_ref,
                                vote_result.get("message", "Vote sau khi them that bai"),
                                message_id=poll_message_id,
                                label=label,
                                option_hex=option_hex,
                                todo_item_id=todo_item_id,
                            )
                        voted = True
                        vote_message = f"Da them va vote: {label}"

                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "message_id": poll_message_id,
                    "reply_to_msg_id": None,
                    "label": label,
                    "option_hex": option_hex,
                    "todo_item_id": todo_item_id,
                    "voted": voted,
                    "message": vote_message,
                }
        except MessagePollClosedError:
            return self._add_poll_option_error(
                phone, peer_ref, "Poll da dong", message_id=message_id
            )
        except FloodWaitError as exc:
            return self._add_poll_option_error(
                phone, peer_ref, f"Flood wait {exc.seconds}s", message_id=message_id
            )
        except Exception as exc:
            return self._add_poll_option_error(phone, peer_ref, str(exc), message_id=message_id)

    async def add_poll_option_vote(
        self,
        client,
        vote_entity,
        poll_message_id: int,
        kind: str,
        options: list,
        tokens: list[str],
        poll_message,
    ) -> dict:
        poll_option_bytes: list[bytes] = []
        todo_item_ids: list[int] = []

        for token in tokens:
            resolved = self._resolve_votable_token(kind, options, token)
            if resolved is None:
                return {"status": "error", "message": f"Lua chon khong hop le ({token})"}
            vote_kind, value, _label = resolved
            if vote_kind == "poll" and isinstance(value, bytes):
                poll_option_bytes.append(value)
            elif vote_kind == "todo" and isinstance(value, int):
                todo_item_ids.append(value)

        try:
            if kind == "todo":
                if not todo_item_ids:
                    return {"status": "error", "message": "Khong co lua chon todo hop le"}
                await client(
                    ToggleTodoCompletedRequest(
                        peer=vote_entity,
                        msg_id=poll_message_id,
                        completed=todo_item_ids,
                        incompleted=[],
                    )
                )
            else:
                if not poll_option_bytes:
                    return {"status": "error", "message": "Khong co lua chon poll hop le"}
                await client(
                    SendVoteRequest(
                        peer=vote_entity,
                        msg_id=poll_message_id,
                        options=poll_option_bytes,
                    )
                )
        except Exception as exc:
            if (
                poll_message is not None
                and hasattr(poll_message, "click")
                and len(poll_option_bytes) == 1
            ):
                target = poll_option_bytes[0]
                await poll_message.click(
                    filter=lambda answer: getattr(answer, "option", None) == target
                )
            else:
                return {"status": "error", "message": str(exc)}

        return {"status": "success", "message": "OK"}

    async def remove_reaction(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
    ) -> dict:
        return await self._react(
            phone,
            peer_id,
            message_id,
            reaction=[ReactionEmpty()],
            emoji=None,
            success_message="Da xoa reaction",
        )

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
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        caption = (caption or "").strip()
        filename = (filename or "image.jpg").strip() or "image.jpg"

        if not phone:
            return self._error(phone, peer_ref, "Thieu phone")
        if not peer_ref:
            return self._error(phone, peer_ref, "Thieu peer_id")
        if not file_bytes:
            return self._error(phone, peer_ref, "File rong")
        if reply_to_msg_id is not None and reply_to_msg_id < 1:
            return self._error(phone, peer_ref, "reply_to_msg_id khong hop le")
        if len(caption) > 1024:
            return self._error(phone, peer_ref, "Caption toi da 1024 ky tu")

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._error(phone, peer_ref, str(exc))

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                    )

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
        except FloodWaitError as exc:
            return self._error(phone, peer_ref, f"Flood wait {exc.seconds}s")
        except Exception as exc:
            return self._error(phone, peer_ref, str(exc))

    async def forward_messages(
        self,
        phone: str,
        from_peer_id: str,
        to_peer_id: str,
        message_ids: list[int],
    ) -> dict:
        phone = phone.strip()
        from_ref = str(from_peer_id or "").strip()
        to_ref = str(to_peer_id or "").strip()
        ids = sorted({int(item) for item in message_ids if int(item) > 0})

        if not phone:
            return self._bulk_forward_error(phone, from_ref, to_ref, "Thieu phone", ids)
        if not from_ref:
            return self._bulk_forward_error(phone, from_ref, to_ref, "Thieu from_peer_id", ids)
        if not to_ref:
            return self._bulk_forward_error(phone, from_ref, to_ref, "Thieu to_peer_id", ids)
        if not ids:
            return self._bulk_forward_error(phone, from_ref, to_ref, "Thieu message_ids", ids)
        if len(ids) > 50:
            return self._bulk_forward_error(phone, from_ref, to_ref, "Toi da 50 tin moi lan", ids)

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._bulk_forward_error(phone, from_ref, to_ref, str(exc), ids)

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._bulk_forward_error(
                phone,
                from_ref,
                to_ref,
                f"Khong tim thay file session: {session_file}",
                ids,
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._bulk_forward_error(
                        phone,
                        from_ref,
                        to_ref,
                        "Session chua dang nhap hoac da het han",
                        ids,
                    )

                from_entity = await self._resolve_peer(client, from_ref)
                to_entity = await self._resolve_peer(client, to_ref)
                source_messages = await client.get_messages(from_entity, ids=ids)
                if not isinstance(source_messages, list):
                    source_messages = [source_messages]
                source_messages = [
                    item for item in source_messages if item and getattr(item, "id", None)
                ]
                if not source_messages:
                    return self._bulk_forward_error(
                        phone,
                        from_ref,
                        to_ref,
                        "Khong tim thay tin nhan",
                        ids,
                    )

                forwarded = await client.forward_messages(
                    to_entity,
                    source_messages,
                    from_peer=from_entity,
                )
                forwarded_ids = [
                    int(getattr(item, "id", 0) or 0)
                    for item in (forwarded if isinstance(forwarded, list) else [forwarded])
                    if getattr(item, "id", None)
                ]

                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": to_ref,
                    "from_peer_id": from_ref,
                    "to_peer_id": to_ref,
                    "message_id": forwarded_ids[-1] if forwarded_ids else None,
                    "reply_to_msg_id": None,
                    "forwarded_count": len(forwarded_ids),
                    "message_ids": forwarded_ids,
                    "message": f"Da forward {len(forwarded_ids)} tin nhan",
                }
        except FloodWaitError as exc:
            return self._bulk_forward_error(
                phone, from_ref, to_ref, f"Flood wait {exc.seconds}s", ids
            )
        except Exception as exc:
            return self._bulk_forward_error(phone, from_ref, to_ref, str(exc), ids)

    async def forward_message(
        self,
        phone: str,
        from_peer_id: str,
        to_peer_id: str,
        message_id: int,
    ) -> dict:
        phone = phone.strip()
        from_ref = str(from_peer_id or "").strip()
        to_ref = str(to_peer_id or "").strip()

        if not phone:
            return self._forward_error(phone, from_ref, to_ref, "Thieu phone", message_id)
        if not from_ref:
            return self._forward_error(phone, from_ref, to_ref, "Thieu from_peer_id", message_id)
        if not to_ref:
            return self._forward_error(phone, from_ref, to_ref, "Thieu to_peer_id", message_id)
        if message_id < 1:
            return self._forward_error(
                phone, from_ref, to_ref, "message_id khong hop le", message_id
            )

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._forward_error(phone, from_ref, to_ref, str(exc), message_id)

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._forward_error(
                phone,
                from_ref,
                to_ref,
                f"Khong tim thay file session: {session_file}",
                message_id,
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._forward_error(
                        phone,
                        from_ref,
                        to_ref,
                        "Session chua dang nhap hoac da het han",
                        message_id,
                    )

                from_entity = await self._resolve_peer(client, from_ref)
                to_entity = await self._resolve_peer(client, to_ref)
                message = await client.get_messages(from_entity, ids=message_id)
                if not message:
                    return self._forward_error(
                        phone,
                        from_ref,
                        to_ref,
                        "Khong tim thay tin nhan",
                        message_id,
                    )

                forwarded = await client.forward_messages(
                    to_entity,
                    message,
                    from_peer=from_entity,
                )
                forwarded_id = getattr(forwarded[0], "id", None) if forwarded else None

                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": to_ref,
                    "from_peer_id": from_ref,
                    "to_peer_id": to_ref,
                    "message_id": forwarded_id,
                    "reply_to_msg_id": None,
                    "message": "Da forward tin nhan",
                }
        except FloodWaitError as exc:
            return self._forward_error(
                phone, from_ref, to_ref, f"Flood wait {exc.seconds}s", message_id
            )
        except Exception as exc:
            return self._forward_error(phone, from_ref, to_ref, str(exc), message_id)

    async def pin_message(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
        *,
        unpin: bool = False,
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()

        if not phone:
            return self._pin_error(phone, peer_ref, "Thieu phone", message_id)
        if not peer_ref:
            return self._pin_error(phone, peer_ref, "Thieu peer_id", message_id)
        if message_id < 1:
            return self._pin_error(phone, peer_ref, "message_id khong hop le", message_id)

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._pin_error(phone, peer_ref, str(exc), message_id)

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._pin_error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
                message_id,
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._pin_error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                        message_id,
                    )

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
        except FloodWaitError as exc:
            return self._pin_error(phone, peer_ref, f"Flood wait {exc.seconds}s", message_id)
        except Exception as exc:
            return self._pin_error(phone, peer_ref, str(exc), message_id)

    async def _send(
        self,
        phone: str,
        peer_id: str,
        text: str,
        *,
        reply_to_msg_id: int | None = None,
        success_message: str = "Da gui tin nhan",
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()
        text = (text or "").strip()

        if not phone:
            return self._error(phone, peer_ref, "Thieu phone")
        if not peer_ref:
            return self._error(phone, peer_ref, "Thieu peer_id")
        if not text:
            return self._error(phone, peer_ref, "Thieu noi dung tin nhan")
        if reply_to_msg_id is not None and reply_to_msg_id < 1:
            return self._error(phone, peer_ref, "reply_to_msg_id khong hop le")

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._error(phone, peer_ref, str(exc))

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                    )

                entity = await self._resolve_peer(client, peer_ref)
                if reply_to_msg_id is not None:
                    sent = await client.send_message(
                        entity,
                        text,
                        reply_to=reply_to_msg_id,
                    )
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
        except FloodWaitError as exc:
            return self._error(phone, peer_ref, f"Flood wait {exc.seconds}s")
        except Exception as exc:
            return self._error(phone, peer_ref, str(exc))

    async def _react(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
        *,
        reaction: list,
        emoji: str | None,
        success_message: str,
    ) -> dict:
        phone = phone.strip()
        peer_ref = str(peer_id or "").strip()

        if not phone:
            return self._react_error(phone, peer_ref, "Thieu phone", message_id=message_id)
        if not peer_ref:
            return self._react_error(phone, peer_ref, "Thieu peer_id", message_id=message_id)
        if message_id < 1:
            return self._react_error(
                phone, peer_ref, "message_id khong hop le", message_id=message_id
            )

        try:
            settings.validate_telegram_config()
        except ValueError as exc:
            return self._react_error(phone, peer_ref, str(exc), message_id=message_id)

        session_file = self._session_file(phone)
        if not session_file.exists():
            return self._react_error(
                phone,
                peer_ref,
                f"Khong tim thay file session: {session_file}",
                message_id=message_id,
            )

        try:
            async with telethon_session(
                phone, self.api_id, self.api_hash, self.session_dir
            ) as client:
                if not await client.is_user_authorized():
                    return self._react_error(
                        phone,
                        peer_ref,
                        "Session chua dang nhap hoac da het han",
                        message_id=message_id,
                    )

                entity = await self._resolve_peer(client, peer_ref)
                await client(
                    SendReactionRequest(
                        peer=entity,
                        msg_id=message_id,
                        reaction=reaction,
                        add_to_recent=True,
                    )
                )

                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "message_id": message_id,
                    "reply_to_msg_id": None,
                    "emoji": emoji,
                    "message": success_message,
                }
        except FloodWaitError as exc:
            return self._react_error(
                phone, peer_ref, f"Flood wait {exc.seconds}s", message_id=message_id
            )
        except Exception as exc:
            return self._react_error(
                phone,
                peer_ref,
                format_reaction_error(exc),
                message_id=message_id,
            )

    @staticmethod
    def _user_chosen_emoji(message) -> str | None:
        reactions_obj = getattr(message, "reactions", None)
        if not reactions_obj:
            return None
        for item in getattr(reactions_obj, "results", None) or []:
            if getattr(item, "chosen_order", None) is None:
                continue
            reaction = getattr(item, "reaction", None)
            if reaction is not None and hasattr(reaction, "emoticon"):
                return reaction.emoticon or None
        return None

    @staticmethod
    def _decode_poll_option_param(value: str) -> bytes | None:
        token = (value or "").strip()
        if not token:
            return None
        padded = token + "=" * (-len(token) % 4)
        for decoder in (base64.urlsafe_b64decode, base64.b64decode):
            try:
                return decoder(padded)
            except Exception:
                continue
        return None

    @classmethod
    def _split_message_link(cls, link: str) -> tuple[str, bytes | None]:
        raw = (link or "").strip()
        if not raw:
            return "", None

        option_bytes = None
        if "?" in raw:
            parsed = urlparse(raw if "://" in raw else f"https://{raw}")
            query = parse_qs(parsed.query)
            for key in ("option", "vote"):
                values = query.get(key)
                if values:
                    option_bytes = cls._decode_poll_option_param(values[0])
                    break
            if parsed.netloc:
                raw = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
            else:
                raw = raw.split("?")[0]
        raw = raw.split("#")[0].rstrip("/")
        return raw, option_bytes

    @staticmethod
    async def _user_todo_completion_ids(client, message) -> list[int]:
        media = getattr(message, "media", None)
        if not isinstance(media, MessageMediaToDo):
            return []

        me = await client.get_me()
        my_id = getattr(me, "id", None)
        if my_id is None:
            return []

        item_ids: list[int] = []
        for completion in getattr(media, "completions", None) or []:
            completed_by = getattr(completion, "completed_by", None)
            user_id = getattr(completed_by, "user_id", None)
            if user_id == my_id:
                item_ids.append(completion.id)
        return item_ids

    @staticmethod
    def _text_with_entities(value: str) -> TextWithEntities:
        return TextWithEntities(text=value, entities=[])

    @staticmethod
    def _can_append_options(kind: str, source) -> bool:
        if kind == "todo":
            return bool(getattr(source, "others_can_append", False))
        return bool(getattr(source, "open_answers", False))

    @staticmethod
    def _next_todo_item_id(items: list) -> int:
        max_id = 0
        for item in items:
            item_id = getattr(item, "id", 0) or 0
            if item_id > max_id:
                max_id = item_id
        return max_id + 1

    @classmethod
    def _find_added_option(
        cls,
        kind: str,
        options: list,
        label: str,
    ) -> tuple[str | None, int | None] | None:
        target = label.casefold().strip()
        matches: list[tuple[str | None, int | None]] = []

        for item in options:
            item_label = cls._option_label(kind, item).casefold().strip()
            if item_label != target:
                continue
            if kind == "poll":
                option_bytes = getattr(item, "option", b"") or b""
                matches.append((option_bytes.hex(), None))
            else:
                matches.append((None, getattr(item, "id", None)))

        if not matches:
            return None
        return matches[-1]

    @staticmethod
    def _empty_poll_settings() -> dict:
        return {
            "kind": "poll",
            "multiple_choice": False,
            "open_answers": False,
            "shuffle_answers": False,
            "revoting_allowed": True,
            "closed": False,
            "quiz": False,
            "public_voters": False,
            "close_date": None,
        }

    @classmethod
    def _votable_settings(cls, kind: str, source) -> dict:
        if kind == "todo":
            return {
                "kind": "todo",
                "multiple_choice": True,
                "open_answers": bool(getattr(source, "others_can_append", False)),
                "shuffle_answers": False,
                "revoting_allowed": bool(
                    getattr(source, "others_can_complete", True)
                ),
                "closed": False,
                "quiz": False,
                "public_voters": False,
                "close_date": None,
            }

        close_date = getattr(source, "close_date", None)
        close_date_value = None
        if close_date is not None and hasattr(close_date, "isoformat"):
            close_date_value = close_date.isoformat()

        return {
            "kind": "poll",
            "multiple_choice": bool(getattr(source, "multiple_choice", False)),
            "open_answers": bool(getattr(source, "open_answers", False)),
            "shuffle_answers": bool(getattr(source, "shuffle_answers", False)),
            "revoting_allowed": not bool(getattr(source, "revoting_disabled", False)),
            "closed": bool(getattr(source, "closed", False)),
            "quiz": bool(getattr(source, "quiz", False)),
            "public_voters": bool(getattr(source, "public_voters", False)),
            "close_date": close_date_value,
        }

    @classmethod
    def _serialize_poll_option(
        cls,
        kind: str,
        item,
        index: int,
        *,
        chosen: bool = False,
        voters: int | None = None,
    ) -> dict:
        label = cls._option_label(kind, item) or str(index + 1)
        if kind == "poll":
            option_bytes = getattr(item, "option", b"") or b""
            return {
                "index": index + 1,
                "label": label,
                "option_hex": option_bytes.hex(),
                "todo_item_id": None,
                "chosen": chosen,
                "voters": voters,
            }
        return {
            "index": index + 1,
            "label": label,
            "option_hex": "",
            "todo_item_id": getattr(item, "id", None),
            "chosen": chosen,
            "voters": voters,
        }

    @staticmethod
    def _peer_user_id(peer) -> int | None:
        if peer is None:
            return None
        user_id = getattr(peer, "user_id", None)
        if user_id is not None:
            return int(user_id)
        return None

    @classmethod
    def _poll_option_stats_key(cls, kind: str, item, index: int) -> str:
        if kind == "poll":
            option_bytes = getattr(item, "option", b"") or b""
            return option_bytes.hex()
        todo_item_id = getattr(item, "id", None)
        if todo_item_id is not None:
            return f"todo:{todo_item_id}"
        return f"todo-index:{index + 1}"

    @classmethod
    def _poll_vote_meta(cls, kind: str, poll_message, me_id: int) -> dict:
        option_stats: dict[str, dict] = {}
        total_voters: int | None = None
        can_view_stats = False

        if not poll_message:
            return {
                "option_stats": option_stats,
                "total_voters": total_voters,
                "can_view_stats": can_view_stats,
            }

        media = getattr(poll_message, "media", None)
        if kind == "poll" and isinstance(media, MessageMediaPoll):
            results = getattr(media, "results", None)
            if results is not None:
                total_voters = getattr(results, "total_voters", None)
                can_view_stats = bool(getattr(results, "can_view_stats", False))
                for item in getattr(results, "results", None) or []:
                    option_bytes = getattr(item, "option", b"") or b""
                    option_stats[option_bytes.hex()] = {
                        "chosen": bool(getattr(item, "chosen", False)),
                        "voters": getattr(item, "voters", None),
                    }
        elif kind == "todo" and isinstance(media, MessageMediaToDo):
            for completion in getattr(media, "completions", None) or []:
                if cls._peer_user_id(getattr(completion, "completed_by", None)) != me_id:
                    continue
                todo_item_id = getattr(completion, "id", None)
                if todo_item_id is None:
                    continue
                option_stats[f"todo:{todo_item_id}"] = {
                    "chosen": True,
                    "voters": None,
                }

        return {
            "option_stats": option_stats,
            "total_voters": total_voters,
            "can_view_stats": can_view_stats,
        }

    @staticmethod
    def _normalize_vote_tokens(option_raw: str, options_list: list[str] | None) -> list[str]:
        if options_list:
            return [token.strip() for token in options_list if token.strip()]
        option_raw = (option_raw or "").strip()
        if not option_raw:
            return []
        if "," in option_raw:
            return [part.strip() for part in option_raw.split(",") if part.strip()]
        return [option_raw]

    @classmethod
    def _resolve_votable_token(
        cls,
        kind: str,
        options: list,
        token: str,
    ) -> tuple[str, bytes | int, str] | None:
        token = (token or "").strip()
        if not token:
            return None

        if kind == "poll":
            hex_bytes = cls._decode_option_hex(token)
            if hex_bytes is not None:
                resolved = cls._resolve_poll_option_bytes(options, hex_bytes)
                if resolved is not None:
                    vote_bytes, label = resolved
                    return "poll", vote_bytes, label

            resolved = cls._resolve_poll_option(options, token)
            if resolved is not None:
                vote_bytes, label = resolved
                return "poll", vote_bytes, label
            return None

        if token.isdigit():
            numeric = int(token)
            for item in options:
                if getattr(item, "id", None) == numeric:
                    label = cls._option_label("todo", item) or str(numeric)
                    return "todo", numeric, label
            index = numeric - 1
            if 0 <= index < len(options):
                item = options[index]
                label = cls._option_label("todo", item) or str(index + 1)
                return "todo", item.id, label

        target = token.casefold()
        for item in options:
            label = cls._option_label("todo", item)
            if label.casefold() == target:
                return "todo", item.id, label

        for item in options:
            label = cls._option_label("todo", item)
            if target in label.casefold():
                return "todo", item.id, label

        return None

    @staticmethod
    def _decode_option_hex(value: str) -> bytes | None:
        token = (value or "").strip()
        if not token or len(token) % 2 != 0:
            return None
        if not all(char in "0123456789abcdefABCDEF" for char in token):
            return None
        try:
            return bytes.fromhex(token)
        except ValueError:
            return None

    @staticmethod
    def _bytes_to_todo_id(option_bytes: bytes) -> int | None:
        if not option_bytes:
            return None
        if len(option_bytes) == 1:
            return option_bytes[0]
        try:
            return int(option_bytes.decode("ascii"))
        except (ValueError, UnicodeDecodeError):
            return None

    @classmethod
    def _suggest_option_index(
        cls,
        kind: str,
        options: list,
        option_bytes: bytes | None,
    ) -> int | None:
        if not option_bytes:
            return None
        if kind == "poll":
            for index, answer in enumerate(options):
                if answer.option == option_bytes:
                    return index + 1
            return None

        todo_id = cls._bytes_to_todo_id(option_bytes)
        if todo_id is None:
            return None
        for index, item in enumerate(options):
            if getattr(item, "id", None) == todo_id:
                return index + 1
        return None

    @classmethod
    def _resolve_poll_option_bytes(
        cls,
        answers: list,
        option_bytes: bytes,
    ) -> tuple[bytes, str] | None:
        for answer in answers:
            if answer.option == option_bytes:
                label = cls._poll_answer_label(answer) or ""
                return answer.option, label or "option"
        return None

    @classmethod
    def _resolve_todo_option_bytes(
        cls,
        items: list,
        option_bytes: bytes,
    ) -> tuple[int, str] | None:
        todo_id = cls._bytes_to_todo_id(option_bytes)
        if todo_id is None:
            return None
        for item in items:
            if getattr(item, "id", None) == todo_id:
                label = cls._option_label("todo", item) or str(todo_id)
                return item.id, label
        return None

    @classmethod
    def _resolve_votable_option_bytes(
        cls,
        kind: str,
        options: list,
        option_bytes: bytes,
    ) -> tuple[str, bytes | None, int | None, str] | None:
        if kind == "poll":
            resolved = cls._resolve_poll_option_bytes(options, option_bytes)
            if resolved is None:
                return None
            vote_bytes, label = resolved
            return "poll", vote_bytes, None, label

        resolved = cls._resolve_todo_option_bytes(options, option_bytes)
        if resolved is None:
            return None
        item_id, label = resolved
        return "todo", None, item_id, label

    @classmethod
    def _resolve_votable_option(
        cls,
        kind: str,
        options: list,
        option_raw: str,
    ) -> tuple[str, bytes | None, int | None, str] | None:
        if kind == "poll":
            resolved = cls._resolve_poll_option(options, option_raw)
            if resolved is None:
                return None
            vote_bytes, label = resolved
            return "poll", vote_bytes, None, label

        option_raw = option_raw.strip()
        if not option_raw:
            return None

        if option_raw.isdigit():
            index = int(option_raw) - 1
            if 0 <= index < len(options):
                item = options[index]
                label = cls._option_label("todo", item) or str(index + 1)
                return "todo", None, item.id, label
            return None

        target = option_raw.casefold()
        for item in options:
            label = cls._option_label("todo", item)
            if label.casefold() == target:
                return "todo", None, item.id, label

        for item in options:
            label = cls._option_label("todo", item)
            if target in label.casefold():
                return "todo", None, item.id, label

        return None

    @staticmethod
    def _build_message_link(peer_ref: str, message_id: int) -> str | None:
        peer_ref = peer_ref.strip()
        if peer_ref.startswith("@"):
            return f"https://t.me/{peer_ref[1:]}/{message_id}"
        if peer_ref.startswith("-100"):
            inner = peer_ref[4:]
            if inner.isdigit():
                return f"https://t.me/c/{inner}/{message_id}"
        return None

    @staticmethod
    def _normalize_fetched_message(message):
        if isinstance(message, list):
            return message[0] if message else None
        return message

    @staticmethod
    def _poll_object_from_message(message):
        if not message:
            return None

        media = getattr(message, "media", None)
        if isinstance(media, MessageMediaPoll):
            return media.poll

        media_poll = getattr(media, "poll", None)
        if media_poll is not None:
            return media_poll

        message_poll = getattr(message, "poll", None)
        if isinstance(message_poll, MessageMediaPoll):
            return message_poll.poll

        nested_poll = getattr(message_poll, "poll", None)
        if nested_poll is not None:
            return nested_poll

        return message_poll

    @staticmethod
    def _todo_from_message(message):
        media = getattr(message, "media", None)
        if isinstance(media, MessageMediaToDo):
            return media.todo
        return None

    @classmethod
    def _extract_votable(cls, message) -> tuple | None:
        if not message:
            return None

        poll_message_id = getattr(message, "id", None)
        if not poll_message_id:
            return None

        todo = cls._todo_from_message(message)
        if todo is not None:
            items = list(getattr(todo, "list", None) or [])
            if items:
                return "todo", todo, items, poll_message_id

        poll = cls._poll_object_from_message(message)
        if poll is not None:
            answers = list(getattr(poll, "answers", None) or [])
            if answers:
                return "poll", poll, answers, poll_message_id

        return None

    @classmethod
    def _extract_poll(cls, message) -> tuple | None:
        extracted = cls._extract_votable(message)
        if not extracted or extracted[0] != "poll":
            return None
        _kind, poll, answers, poll_message_id = extracted
        return poll, answers, poll_message_id

    @staticmethod
    def _webpage_target_link(message) -> str | None:
        media = getattr(message, "media", None)
        if not isinstance(media, MessageMediaWebPage):
            return None

        webpage = getattr(media, "webpage", None)
        if not webpage:
            return None

        for attr in ("url", "display_url"):
            url = (getattr(webpage, attr, None) or "").strip()
            if _TME_POST_LINK_RE.search(url):
                return url
        return None

    @classmethod
    def _poll_result(cls, message) -> tuple | None:
        extracted = cls._extract_votable(message)
        if not extracted:
            return None
        kind, source, options, poll_message_id = extracted
        return kind, source, options, poll_message_id, message

    @classmethod
    async def _warm_entity_from_link(cls, client, link: str) -> None:
        match = _TME_POST_LINK_RE.search(link)
        if not match:
            return
        channel_id, username, _msg_id = match.groups()
        try:
            if username:
                await client.get_entity(username)
            elif channel_id:
                await client.get_entity(int(f"-100{channel_id}"))
        except Exception:
            return

    @classmethod
    def _message_ref_from_link(cls, link: str) -> tuple[str | int, int] | None:
        match = _TME_POST_LINK_RE.search((link or "").strip())
        if not match:
            return None

        channel_id, username, message_id = match.groups()
        if not message_id:
            return None

        peer_ref: str | int
        if username:
            peer_ref = username
        elif channel_id:
            peer_ref = int(f"-100{channel_id}")
        else:
            return None

        return peer_ref, int(message_id)

    @classmethod
    async def _fetch_message_from_link(cls, client, link: str):
        ref = cls._message_ref_from_link(link)
        if not ref:
            return None

        peer_ref, message_id = ref
        try:
            entity = await client.get_entity(peer_ref)
            message = await client.get_messages(entity, ids=message_id)
            return cls._normalize_fetched_message(message)
        except Exception:
            return None

    @classmethod
    async def _resolve_poll_message(
        cls,
        client,
        entity,
        message_id: int,
        link: str | None = None,
    ):
        message = None
        link = (link or "").strip()

        if link:
            await cls._warm_entity_from_link(client, link)
            message = await cls._fetch_message_from_link(client, link)

        if not message:
            message = cls._normalize_fetched_message(
                await client.get_messages(entity, ids=message_id)
            )

        if not message:
            return None, "Không tìm thấy tin nhắn"

        result = cls._poll_result(message)
        if result:
            return result, None

        for delta in range(1, 11):
            for mid in (message_id - delta, message_id + delta):
                if mid < 1:
                    continue
                nearby = cls._normalize_fetched_message(
                    await client.get_messages(entity, ids=mid)
                )
                result = cls._poll_result(nearby)
                if result:
                    return result, None

        reply_to = getattr(message, "reply_to", None)
        reply_id = getattr(reply_to, "reply_to_msg_id", None) if reply_to else None
        if reply_id:
            parent = cls._normalize_fetched_message(
                await client.get_messages(entity, ids=reply_id)
            )
            result = cls._poll_result(parent)
            if result:
                return result, None

        webpage_link = cls._webpage_target_link(message)
        if webpage_link and webpage_link.rstrip("/") != link.rstrip("/"):
            try:
                await cls._warm_entity_from_link(client, webpage_link)
                target = await cls._fetch_message_from_link(client, webpage_link)
                result = cls._poll_result(target)
                if result:
                    return result, None
            except Exception:
                pass

        media = getattr(message, "media", None)
        media_name = type(media).__name__ if media else "none"
        preview = (getattr(message, "message", None) or "").strip()[:80]
        hints: list[str] = []
        if reply_id:
            hints.append("link trỏ tới tin reply — thử link trực tiếp bài poll")
        if media_name == "MessageMediaWebPage":
            hints.append(
                "đây là tin preview link — bấm giữ tin poll gốc rồi Copy link"
            )
        if media_name == "MessageMediaUnsupported":
            hints.append(
                "Telethon chưa nhận diện được định dạng poll mới — cần cập nhật thư viện"
            )
        if getattr(message, "poll", None) is None and media_name == "none":
            hints.append("acc có thể chưa join group hoặc không đọc được tin này")

        hint_text = f" ({'; '.join(hints)})" if hints else ""
        detail = f" Loại media: {media_name}."
        if preview:
            detail += f" Nội dung: «{preview}»"

        return None, f"Tin nhắn không phải poll{hint_text}.{detail}"

    @staticmethod
    def _text_with_entities_label(value) -> str:
        if value is None:
            return ""
        if hasattr(value, "text"):
            return (value.text or "").strip()
        return str(value).strip()

    @classmethod
    def _votable_question_label(cls, kind: str, source) -> str:
        if kind == "poll":
            return cls._poll_question_label(source)
        return cls._text_with_entities_label(getattr(source, "title", None))

    @classmethod
    def _option_label(cls, kind: str, option) -> str:
        if kind == "poll":
            return cls._poll_answer_label(option)
        return cls._text_with_entities_label(getattr(option, "title", None))

    @staticmethod
    def _poll_question_label(poll) -> str:
        question = getattr(poll, "question", None)
        if question is None:
            return ""
        if hasattr(question, "text"):
            return (question.text or "").strip()
        return str(question).strip()

    @staticmethod
    def _poll_answer_label(answer) -> str:
        text = getattr(answer, "text", None)
        if text is None:
            return ""
        if hasattr(text, "text"):
            return (text.text or "").strip()
        return str(text).strip()

    @classmethod
    def _resolve_poll_option(
        cls,
        answers: list,
        option_raw: str,
    ) -> tuple[bytes, str] | None:
        option_raw = option_raw.strip()
        if not option_raw:
            return None

        hex_bytes = cls._decode_option_hex(option_raw)
        if hex_bytes is not None:
            resolved = cls._resolve_poll_option_bytes(answers, hex_bytes)
            if resolved is not None:
                return resolved

        if option_raw.isdigit():
            index = int(option_raw) - 1
            if 0 <= index < len(answers):
                answer = answers[index]
                return answer.option, cls._poll_answer_label(answer) or str(index + 1)
            return None

        target = option_raw.casefold()
        for answer in answers:
            label = cls._poll_answer_label(answer)
            if label.casefold() == target:
                return answer.option, label

        for answer in answers:
            label = cls._poll_answer_label(answer)
            if target in label.casefold():
                return answer.option, label

        return None

    async def _resolve_peer(self, client: TelegramClient, peer_ref: str):
        if peer_ref.lstrip("-").isdigit():
            return await client.get_entity(int(peer_ref))
        normalized = peer_ref.strip().rstrip("/")
        if "t.me/" in normalized:
            normalized = normalized.split("/")[-1]
        return await client.get_entity(normalized)

    def _session_file(self, phone: str) -> Path:
        return (self.session_dir / phone).with_suffix(".session")

    @staticmethod
    def _error(
        phone: str,
        peer_id: str,
        message: str,
        *,
        message_id: int | None = None,
    ) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "message": message,
        }

    @staticmethod
    @staticmethod
    def _bulk_forward_error(
        phone: str,
        from_peer_id: str,
        to_peer_id: str,
        message: str,
        message_ids: list[int],
    ) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": to_peer_id,
            "from_peer_id": from_peer_id,
            "to_peer_id": to_peer_id,
            "message_id": message_ids[-1] if message_ids else None,
            "reply_to_msg_id": None,
            "forwarded_count": 0,
            "message_ids": [],
            "message": message,
        }

    @staticmethod
    def _bulk_delete_error(
        phone: str,
        peer_id: str,
        message: str,
        message_ids: list[int],
    ) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_ids[-1] if message_ids else None,
            "reply_to_msg_id": None,
            "deleted_count": 0,
            "message_ids": [],
            "message": message,
        }

    def _forward_error(
        phone: str,
        from_peer_id: str,
        to_peer_id: str,
        message: str,
        message_id: int | None = None,
    ) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": to_peer_id,
            "from_peer_id": from_peer_id,
            "to_peer_id": to_peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "message": message,
        }

    @staticmethod
    def _pin_error(
        phone: str,
        peer_id: str,
        message: str,
        message_id: int | None = None,
    ) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "pinned": False,
            "message": message,
        }

    @staticmethod
    def _react_error(
        phone: str,
        peer_id: str,
        message: str,
        *,
        message_id: int | None = None,
    ) -> dict:
        payload = TelegramMessageService._error(
            phone, peer_id, message, message_id=message_id
        )
        payload["emoji"] = None
        return payload

    @staticmethod
    def _vote_error(
        phone: str,
        peer_id: str,
        message: str,
        *,
        message_id: int | None = None,
    ) -> dict:
        payload = TelegramMessageService._error(
            phone, peer_id, message, message_id=message_id
        )
        payload["option"] = None
        return payload

    @staticmethod
    def _add_poll_option_error(
        phone: str,
        peer_id: str,
        message: str,
        *,
        message_id: int | None = None,
        label: str | None = None,
        option_hex: str | None = None,
        todo_item_id: int | None = None,
    ) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "label": label,
            "option_hex": option_hex,
            "todo_item_id": todo_item_id,
            "voted": False,
            "message": message,
        }

    @staticmethod
    def _poll_info_error(
        phone: str,
        peer_id: str,
        message: str,
        *,
        message_id: int | None = None,
    ) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "question": "",
            **TelegramMessageService._empty_poll_settings(),
            "options": [],
            "suggested_option_index": None,
            "message": message,
        }


telegram_message_service = TelegramMessageService(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)
