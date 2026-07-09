"""Poll / todo actions (public API). Helpers live in poll_*.py mixins."""
from telethon.errors import FloodWaitError
from telethon.errors import MessagePollClosedError, RevoteNotAllowedError
from telethon.tl.functions.messages import (
    AddPollAnswerRequest,
    AppendTodoListRequest,
    SendVoteRequest,
    ToggleTodoCompletedRequest,
)
from telethon.tl.types import InputPollAnswer, TodoItem

from ....config import settings
from ..client import telethon_session
from .base import MessageActionBase
from .poll_extract import PollExtractMixin
from .poll_links import PollLinksMixin
from .poll_resolve import PollResolveMixin
from .poll_serialize import PollSerializeMixin


class PollActionService(
    PollResolveMixin,
    PollExtractMixin,
    PollSerializeMixin,
    PollLinksMixin,
    MessageActionBase,
):
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


