"""
Restructure app/services into domain packages with facade re-exports.
Safe to re-run: overwrites new modules; facades replace old module bodies.
"""
from __future__ import annotations

import re
import shutil
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES = ROOT / "app" / "services"
TELEGRAM = SERVICES / "telegram"
REALTIME = SERVICES / "realtime"
CONVERSATION = SERVICES / "conversation"


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def write(path: Path, content: str) -> None:
    ensure_dir(path.parent)
    path.write_text(content.rstrip() + "\n", encoding="utf-8")
    print(f"  write {path.relative_to(ROOT)}")


def extract_class_methods(source: str, class_name: str) -> tuple[str, dict[str, str], str]:
    """Return (pre_class, {method_name: source_with_decorators}, post_class) via AST line ranges."""
    import ast

    tree = ast.parse(source)
    lines = source.splitlines(keepends=True)
    target = None
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            target = node
            break
    if target is None:
        raise RuntimeError(f"class {class_name} not found")

    # pre: everything before class line
    pre = "".join(lines[: target.lineno - 1])
    # post: after class end_lineno
    post = "".join(lines[target.end_lineno :])

    methods: dict[str, str] = {}
    for item in target.body:
        if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        start = item.lineno
        if item.decorator_list:
            start = min(d.lineno for d in item.decorator_list)
        end = item.end_lineno
        chunk = "".join(lines[start - 1 : end])
        methods[item.name] = chunk.rstrip() + "\n"
    return pre, methods, post


def build_mixin(
    class_name: str,
    methods: dict[str, str],
    method_names: list[str],
    *,
    imports: str,
    bases: str = "",
) -> str:
    parts = [imports.rstrip() + "\n\n\n", f"class {class_name}{bases}:\n"]
    for name in method_names:
        if name not in methods:
            raise KeyError(f"Missing method {name} for {class_name}")
        parts.append(methods[name])
        if not parts[-1].endswith("\n"):
            parts.append("\n")
        parts.append("\n")
    return "".join(parts).rstrip() + "\n"


def restructure_messages() -> None:
    print("== messages -> actions/*")
    src_path = TELEGRAM / "messages.py"
    source = src_path.read_text(encoding="utf-8")
    pre, methods, post = extract_class_methods(source, "TelegramMessageService")

    # Verify key methods present
    required = [
        "send_message",
        "edit_message",
        "delete_messages",
        "delete_message",
        "reply_message",
        "send_typing",
        "send_reaction",
        "remove_reaction",
        "get_poll_info",
        "vote_poll",
        "cancel_poll_vote",
        "add_poll_option",
        "add_poll_option_vote",
        "send_media",
        "forward_messages",
        "forward_message",
        "pin_message",
        "_send",
        "_react",
        "_resolve_peer",
        "_session_file",
        "_error",
    ]
    missing = [m for m in required if m not in methods]
    if missing:
        raise RuntimeError(f"Failed to extract methods: {missing}. got={sorted(methods)}")

    actions = TELEGRAM / "actions"
    ensure_dir(actions)

    common_imports = '''\
from pathlib import Path

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

import base64
import io
import re
from urllib.parse import parse_qs, urlparse

from ....config import settings
from ..client import telethon_session
from ..reactions import (
    fetch_peer_reactions_policy,
    format_reaction_error,
    is_emoji_allowed,
    reaction_not_allowed_message,
)

_TME_POST_LINK_RE = re.compile(
    r"https?://t\\.me/(?:c/(\\d+)|([A-Za-z0-9_]+))/(\\d+)",
    re.IGNORECASE,
)
'''

    base_methods = [
        "__init__",
        "_resolve_peer",
        "_session_file",
        "_error",
        "_bulk_forward_error",
        "_bulk_delete_error",
        "_forward_error",
        "_pin_error",
        "_react_error",
        "_vote_error",
        "_add_poll_option_error",
        "_empty_poll_settings",  # used by _poll_info_error (class-qualified)
        "_poll_info_error",
    ]
    text_methods = [
        "send_message",
        "edit_message",
        "delete_messages",
        "delete_message",
        "reply_message",
        "send_typing",
        "pin_message",
        "_send",
    ]
    reaction_methods = [
        "send_reaction",
        "remove_reaction",
        "_react",
        "_user_chosen_emoji",
    ]
    media_methods = ["send_media"]
    forward_methods = ["forward_messages", "forward_message"]

    used = set(base_methods + text_methods + reaction_methods + media_methods + forward_methods)
    poll_methods = [n for n in methods if n not in used]
    # keep stable-ish order: public first then private as in original extraction order
    original_order = list(methods.keys())
    poll_methods = [n for n in original_order if n in set(poll_methods)]

    # Rewrite class-qualified staticmethod refs after split
    def fix_msg_refs(text: str, cls: str) -> str:
        return text.replace("TelegramMessageService.", f"{cls}.")

    write(
        actions / "base.py",
        fix_msg_refs(
            build_mixin(
                "MessageActionBase",
                methods,
                base_methods,
                imports='''\
from pathlib import Path

from telethon import TelegramClient
''',
            ),
            "MessageActionBase",
        ),
    )

    write(
        actions / "text.py",
        build_mixin(
            "TextActionService",
            methods,
            text_methods,
            imports='''\
from telethon.errors import FloodWaitError
from telethon.tl.functions.messages import SetTypingRequest
from telethon.tl.types import SendMessageTypingAction

from ....config import settings
from ..client import telethon_session
from .base import MessageActionBase
''',
            bases="(MessageActionBase)",
        ),
    )

    write(
        actions / "reactions.py",
        fix_msg_refs(
            build_mixin(
                "ReactionActionService",
                methods,
                reaction_methods,
                imports='''\
from telethon.errors import FloodWaitError
from telethon.tl.functions.messages import SendReactionRequest
from telethon.tl.types import ReactionEmoji, ReactionEmpty

from ....config import settings
from ..client import telethon_session
from ..reactions import (
    fetch_peer_reactions_policy,
    format_reaction_error,
    is_emoji_allowed,
    reaction_not_allowed_message,
)
from .base import MessageActionBase
''',
                bases="(MessageActionBase)",
            ),
            "MessageActionBase",
        ),
    )

    write(
        actions / "media.py",
        build_mixin(
            "MediaActionService",
            methods,
            media_methods,
            imports='''\
import io

from telethon.errors import FloodWaitError

from ....config import settings
from ..client import telethon_session
from .base import MessageActionBase
''',
            bases="(MessageActionBase)",
        ),
    )

    write(
        actions / "forwarding.py",
        build_mixin(
            "ForwardingService",
            methods,
            forward_methods,
            imports='''\
from telethon.errors import FloodWaitError

from ....config import settings
from ..client import telethon_session
from .base import MessageActionBase
''',
            bases="(MessageActionBase)",
        ),
    )

    write(
        actions / "polls.py",
        fix_msg_refs(
            build_mixin(
                "PollActionService",
                methods,
                poll_methods,
                imports='''\
import base64
import re
from urllib.parse import parse_qs, urlparse

from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.errors import MessagePollClosedError, RevoteNotAllowedError
from telethon.tl.functions.messages import (
    AddPollAnswerRequest,
    AppendTodoListRequest,
    SendVoteRequest,
    ToggleTodoCompletedRequest,
)
from telethon.tl.types import (
    InputPollAnswer,
    MessageMediaPoll,
    MessageMediaToDo,
    MessageMediaWebPage,
    TextWithEntities,
    TodoItem,
)

from ....config import settings
from ..client import telethon_session
from .base import MessageActionBase

_TME_POST_LINK_RE = re.compile(
    r"https?://t\\.me/(?:c/(\\d+)|([A-Za-z0-9_]+))/(\\d+)",
    re.IGNORECASE,
)
''',
                bases="(MessageActionBase)",
            ),
            "MessageActionBase",
        ),
    )

    # groups will be added later; placeholder import in __init__
    write(
        actions / "__init__.py",
        '''\
from ....config import settings
from .base import MessageActionBase
from .forwarding import ForwardingService
from .media import MediaActionService
from .polls import PollActionService
from .reactions import ReactionActionService
from .text import TextActionService


class TelegramMessageService(
    TextActionService,
    MediaActionService,
    ForwardingService,
    ReactionActionService,
    PollActionService,
):
    """Facade combining message action domains (text/media/forward/react/poll)."""


telegram_message_service = TelegramMessageService(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)

__all__ = [
    "ForwardingService",
    "MediaActionService",
    "MessageActionBase",
    "PollActionService",
    "ReactionActionService",
    "TelegramMessageService",
    "TextActionService",
    "telegram_message_service",
]
''',
    )

    # facade at old path
    write(
        TELEGRAM / "messages.py",
        '''\
"""Backward-compatible facade for telegram message actions. """
from .actions import TelegramMessageService, telegram_message_service

__all__ = ["TelegramMessageService", "telegram_message_service"]
''',
    )


def restructure_dialogs() -> None:
    print("== dialogs -> chats/*")
    src = (TELEGRAM / "dialogs.py").read_text(encoding="utf-8")
    pre, methods, post = extract_class_methods(src, "TelegramDialogService")

    chats = TELEGRAM / "chats"
    ensure_dir(chats)

    serializer_methods = [
        "_dialog_preview_from_row",
        "dialog_preview_from_row",
        "_extract_sender_id",
        "_format_entity_name",
        "_resolve_sender_names",
        "resolve_sender_names",
        "_build_message_row",
        "build_message_row",
        "_format_dt",
        "_has_displayable_photo",
        "_format_reactions",
        "_media_file_name",
        "_media_mime_and_name",
        "_message_content_type",
    ]
    media_methods = ["get_message_photo", "get_message_media", "_photo_error"]
    reader_methods = [
        "get_messages",
        "_fetch_messages_around",
        "_parse_offset_date",
        "get_pinned_messages",
        "mark_dialog_read",
        "get_new_messages",
        "search_messages",
        "_read_dialog_inbox_state",
        "_fetch_pinned_raw",
        "_legacy_pinned_ids",
        "_pinned_error",
        "_messages_error",
        "_mark_read_error",
    ]
    dialog_methods = [
        "__init__",
        "list_dialogs",
        "_resolve_peer",
        "_session_file",
        "_dialogs_error",
    ]

    # remaining methods go into dialogs if any missed
    assigned = set(serializer_methods + media_methods + reader_methods + dialog_methods)
    leftover = [n for n in methods if n not in assigned]
    if leftover:
        print("  leftover dialog methods -> dialogs:", leftover)
        dialog_methods.extend(leftover)

    write(
        chats / "serializer.py",
        build_mixin(
            "ChatSerializer",
            methods,
            serializer_methods,
            imports='''\
from datetime import timezone

from telethon import TelegramClient
''',
        ),
    )
    # fix TelegramDialogService refs inside serializer
    ser_path = chats / "serializer.py"
    ser = ser_path.read_text(encoding="utf-8")
    ser = ser.replace("TelegramDialogService._media_file_name", "ChatSerializer._media_file_name")
    write(ser_path, ser)

    write(
        chats / "media_reader.py",
        build_mixin(
            "MediaReaderService",
            methods,
            media_methods,
            imports='''\
import io

from telethon.errors import FloodWaitError

from ....config import settings
from ..client import telethon_session
from .dialogs import DialogService
''',
            bases="(DialogService)",
        ),
    )

    write(
        chats / "messages_reader.py",
        build_mixin(
            "MessagesReaderService",
            methods,
            reader_methods,
            imports='''\
from datetime import datetime, timezone

from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.functions.messages import GetFullChatRequest
from telethon.tl.types import Channel, Chat, InputMessagesFilterPinned

from ....config import settings
from ..client import telethon_session
from ..reactions import default_reactions_policy, fetch_peer_reactions_policy
from .dialogs import DialogService
from .serializer import ChatSerializer

PINNED_MESSAGES_PAGE_SIZE = 30
PINNED_MESSAGES_MAX_LIMIT = 100
''',
            bases="(DialogService, ChatSerializer)",
        ),
    )

    write(
        chats / "dialogs.py",
        build_mixin(
            "DialogService",
            methods,
            dialog_methods,
            imports='''\
from pathlib import Path

from telethon import TelegramClient
from telethon.errors import FloodWaitError

from ....config import settings
from ..client import telethon_session
from .serializer import ChatSerializer

PINNED_MESSAGES_PAGE_SIZE = 30
PINNED_MESSAGES_MAX_LIMIT = 100
''',
            bases="(ChatSerializer)",
        ),
    )

    write(
        chats / "__init__.py",
        '''\
from ....config import settings
from .dialogs import DialogService
from .media_reader import MediaReaderService
from .messages_reader import MessagesReaderService
from .serializer import ChatSerializer


class TelegramDialogService(
    MessagesReaderService,
    MediaReaderService,
    DialogService,
):
    """Facade for dialog list, message read, and media download."""


telegram_dialog_service = TelegramDialogService(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)

__all__ = [
    "ChatSerializer",
    "DialogService",
    "MediaReaderService",
    "MessagesReaderService",
    "TelegramDialogService",
    "telegram_dialog_service",
]
''',
    )

    write(
        TELEGRAM / "dialogs.py",
        '''\
"""Backward-compatible facade for chat/dialog services. """
from .chats import TelegramDialogService, telegram_dialog_service

__all__ = ["TelegramDialogService", "telegram_dialog_service"]
''',
    )


def restructure_auth() -> None:
    print("== auth -> accounts/auth + privacy")
    src = (TELEGRAM / "auth.py").read_text(encoding="utf-8")
    pre, methods, post = extract_class_methods(src, "TelegramAuthService")

    accounts = TELEGRAM / "accounts"
    ensure_dir(accounts)

    privacy_methods = ["update_2fa", "update_privacy"]
    auth_methods = [n for n in methods if n not in privacy_methods]
    # ensure helpers stay with auth (base)
    original_order = list(methods.keys())
    auth_methods = [n for n in original_order if n not in privacy_methods]

    write(
        accounts / "auth.py",
        build_mixin(
            "TelegramAuthService",
            methods,
            auth_methods,
            imports='''\
import json
import re
from pathlib import Path

from telethon.errors import (
    ChannelPrivateError,
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    PhoneNumberBannedError,
    PhoneNumberInvalidError,
    PhoneNumberUnoccupiedError,
    SessionPasswordNeededError,
)
from telethon.tl.functions.auth import SignUpRequest
from telethon.tl.functions.messages import GetHistoryRequest
from telethon.tl.types import (
    InputPrivacyKeyChatInvite,
    InputPrivacyValueAllowAll,
    InputPrivacyValueAllowContacts,
    InputPrivacyValueDisallowAll,
)

from ....config import BASE_DIR, settings
from ....db import metadata_store
from ..client import telethon_session
''',
        ),
    )
    # privacy inherits auth for _result and config fields
    write(
        accounts / "privacy.py",
        build_mixin(
            "PrivacyService",
            methods,
            privacy_methods,
            imports='''\
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
''',
            bases="(TelegramAuthService)",
        ),
    )


def restructure_sessions() -> None:
    print("== sessions -> accounts/sessions + profile")
    src = (TELEGRAM / "sessions.py").read_text(encoding="utf-8")
    pre, methods, post = extract_class_methods(src, "TelegramSessionService")

    accounts = TELEGRAM / "accounts"
    ensure_dir(accounts)

    profile_methods = [
        "get_me",
        "list_authorizations",
        "revoke_authorization",
        "_avatar_file_path",
        "_remove_avatar_file",
        "_sync_avatar",
        "_fetch_about",
        "update_profile",
        "upload_avatar",
        "delete_avatar",
        "get_avatar_bytes",
        "_me_payload",
        "_me_result",
        "_profile_result",
        "_avatar_update_result",
        "_authorizations_result",
        "_auth_timestamp",
    ]
    session_methods = [n for n in methods if n not in profile_methods]
    original_order = list(methods.keys())
    session_methods = [n for n in original_order if n not in profile_methods]
    profile_methods = [n for n in original_order if n in set(profile_methods)]

    write(
        accounts / "sessions.py",
        build_mixin(
            "SessionService",
            methods,
            session_methods,
            imports='''\
import asyncio
import re
from pathlib import Path

from telethon.errors import FloodWaitError

from ....config import BASE_DIR, session_lock, settings
from ....db import metadata_store
from ..client import telethon_session
''',
        ),
    )

    write(
        accounts / "profile.py",
        build_mixin(
            "ProfileService",
            methods,
            profile_methods,
            imports='''\
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

from ....config import settings
from ....db import metadata_store
from ..client import telethon_session
from .sessions import SessionService
''',
            bases="(SessionService)",
        ),
    )

    write(
        accounts / "__init__.py",
        '''\
from ....config import settings
from .auth import TelegramAuthService
from .privacy import PrivacyService
from .profile import ProfileService
from .sessions import SessionService


class TelegramAuthServiceFacade(PrivacyService, TelegramAuthService):
    """Auth + privacy (2FA / invite privacy)."""


class TelegramSessionService(ProfileService, SessionService):
    """Session CRUD + profile/avatar/authorizations."""


telegram_auth_service = TelegramAuthServiceFacade(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)

telegram_session_service = TelegramSessionService(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)

__all__ = [
    "PrivacyService",
    "ProfileService",
    "SessionService",
    "TelegramAuthService",
    "TelegramAuthServiceFacade",
    "TelegramSessionService",
    "telegram_auth_service",
    "telegram_session_service",
]
''',
    )

    write(
        TELEGRAM / "auth.py",
        '''\
"""Backward-compatible facade for account auth/privacy. """
from .accounts import TelegramAuthServiceFacade as TelegramAuthService
from .accounts import telegram_auth_service

__all__ = ["TelegramAuthService", "telegram_auth_service"]
''',
    )
    write(
        TELEGRAM / "sessions.py",
        '''\
"""Backward-compatible facade for session/profile services. """
from .accounts import TelegramSessionService, telegram_session_service

__all__ = ["TelegramSessionService", "telegram_session_service"]
''',
    )


def restructure_groups() -> None:
    print("== groups -> actions/groups")
    src = TELEGRAM / "groups.py"
    text = src.read_text(encoding="utf-8")
    # fix relative imports for new location
    text = text.replace("from ...config", "from ....config")
    text = text.replace("from ...db", "from ....db")
    text = text.replace("from .client", "from ..client")
    write(TELEGRAM / "actions" / "groups.py", text)

    # append export to actions/__init__
    init = (TELEGRAM / "actions" / "__init__.py").read_text(encoding="utf-8")
    if "telegram_group_service" not in init:
        init = init.replace(
            "from .text import TextActionService",
            "from .groups import TelegramGroupService, telegram_group_service\nfrom .text import TextActionService",
        )
        init = init.replace(
            '__all__ = [',
            '__all__ = [\n    "TelegramGroupService",\n    "telegram_group_service",',
        )
        write(TELEGRAM / "actions" / "__init__.py", init)

    write(
        TELEGRAM / "groups.py",
        '''\
""" Backward-compatible facade for group actions. """
from .actions.groups import TelegramGroupService, telegram_group_service

__all__ = ["TelegramGroupService", "telegram_group_service"]
''',
    )


def restructure_client() -> None:
    print("== client/pool -> telegram/client/*")
    client_dir = TELEGRAM / "client"
    ensure_dir(client_dir)

    client_py = TELEGRAM / "client.py"
    client_bak = TELEGRAM / "client.py.bak_src"
    if not client_py.exists() and client_bak.exists():
        client_py.write_text(client_bak.read_text(encoding="utf-8"), encoding="utf-8")

    session_src = client_py.read_text(encoding="utf-8") if client_py.exists() else ""
    # Prefer bak if current looks wrong
    if client_bak.exists() and (
        not session_src or "telethon_session" not in session_src or session_src.count("\n") < 10
    ):
        session_src = client_bak.read_text(encoding="utf-8")

    pool_path = TELEGRAM / "pool.py"
    pool_bak = TELEGRAM / "pool.py.bak_src"
    pool_src = pool_path.read_text(encoding="utf-8") if pool_path.exists() else ""
    if pool_bak.exists() and (
        "TelethonClientPool" not in pool_src or "Backward-compatible" in pool_src
    ):
        pool_src = pool_bak.read_text(encoding="utf-8")

    if "telethon_session" in session_src:
        session_body = session_src.replace("from ...config", "from ....config")
        write(client_dir / "session.py", session_body)

        if "TelethonClientPool" in pool_src:
            pool_body = pool_src.replace("from ...config", "from ....config")
            write(client_dir / "pool.py", pool_body)

        write(
            client_dir / "lock.py",
            '''\
"""Session lock re-export at service layer (implementation in utils)."""
from ....config import session_lock
from ....utils.session_lock import SessionLock, SessionLockTimeoutError

__all__ = ["SessionLock", "SessionLockTimeoutError", "session_lock"]
''',
        )
        write(
            client_dir / "__init__.py",
            '''\
from .pool import TelethonClientPool, telethon_client_pool
from .session import telethon_session

__all__ = [
    "TelethonClientPool",
    "telethon_client_pool",
    "telethon_session",
]
''',
        )

        # Cannot keep both client.py and client/ package — package is the import path.
        client_py = TELEGRAM / "client.py"
        if client_py.exists():
            client_py.unlink()
            print("  removed telegram/client.py (replaced by telegram/client/ package)")

        write(
            TELEGRAM / "pool.py",
            '''\
"""Backward-compatible facade for Telethon client pool. """
from .client.pool import TelethonClientPool, telethon_client_pool

__all__ = ["TelethonClientPool", "telethon_client_pool"]
''',
        )


def restructure_common() -> None:
    print("== common/*")
    common = SERVICES / "common"
    ensure_dir(common)
    write(
        common / "results.py",
        '''\
"""Shared response-shaped helpers used by services.

Routers still use app.utils.responses for HTTP envelopes.
Domain services often return status/message payloads — keep small builders here.
"""
from __future__ import annotations

from typing import Any


def status_result(status: str, message: str, **extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"status": status, "message": message}
    payload.update(extra)
    return payload


def error_status(message: str, **extra: Any) -> dict[str, Any]:
    return status_result("error", message, **extra)


def success_status(message: str, **extra: Any) -> dict[str, Any]:
    return status_result("success", message, **extra)
''',
    )
    write(
        common / "validation.py",
        '''\
"""Shared input normalization / validation for services."""
from __future__ import annotations

import re

_PHONE_SAFE_RE = re.compile(r"[^0-9A-Za-z_+-]+")


def normalize_phone(phone: str | None) -> str:
    return (phone or "").strip()


def safe_phone_key(phone: str) -> str:
    return _PHONE_SAFE_RE.sub("_", phone.strip()) or "unknown"


def clamp_limit(value: int | None, *, default: int, minimum: int = 1, maximum: int = 500) -> int:
    try:
        n = int(value if value is not None else default)
    except (TypeError, ValueError):
        n = default
    return max(minimum, min(n, maximum))


def validate_text(text: str | None, *, max_len: int = 4096, field: str = "text") -> str | None:
    """Return error message or None if ok. Empty string is an error."""
    value = (text or "").strip()
    if not value:
        return f"Thieu {field}"
    if len(value) > max_len:
        return f"{field} qua dai"
    return None


def normalize_peer_ref(peer_ref: str) -> str:
    normalized = peer_ref.strip().rstrip("/")
    if "t.me/" in normalized:
        normalized = normalized.split("/")[-1]
    return normalized
''',
    )
    write(
        common / "errors.py",
        '''\
"""Map common Telegram / session errors to service messages."""
from __future__ import annotations

from telethon.errors import FloodWaitError


def flood_wait_message(exc: FloodWaitError) -> str:
    return f"Flood wait {exc.seconds}s"


def missing_session_message(session_file) -> str:
    return f"Khong tim thay file session: {session_file}"


UNAUTHORIZED_MESSAGE = "Session chua dang nhap hoac da het han"
MISSING_PHONE_MESSAGE = "Thieu phone"
''',
    )
    write(
        common / "unit_of_work.py",
        '''\
"""Optional DB unit-of-work helpers (thin wrapper around engine sessions)."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlmodel import Session

from ...db.engine import get_engine


@contextmanager
def db_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session
''',
    )
    write(
        common / "__init__.py",
        '''\
from .errors import (
    UNAUTHORIZED_MESSAGE,
    flood_wait_message,
    missing_session_message,
)
from .results import error_status, status_result, success_status
from .validation import (
    clamp_limit,
    normalize_peer_ref,
    normalize_phone,
    safe_phone_key,
    validate_text,
)

__all__ = [
    "UNAUTHORIZED_MESSAGE",
    "clamp_limit",
    "error_status",
    "flood_wait_message",
    "missing_session_message",
    "normalize_peer_ref",
    "normalize_phone",
    "safe_phone_key",
    "status_result",
    "success_status",
    "validate_text",
]
''',
    )


def restructure_automation() -> None:
    print("== conversation -> automation/conversation (facade)")
    auto = SERVICES / "automation"
    conv_new = auto / "conversation"
    ensure_dir(conv_new)

    if CONVERSATION.exists():
        for name in ["parser.py", "validator.py", "runner.py", "store.py", "audit_log.py"]:
            src = CONVERSATION / name
            if not src.exists():
                continue
            text = src.read_text(encoding="utf-8")
            # services/conversation/X -> services/automation/conversation/X : one more level
            text = text.replace("from ...schemas", "from ....schemas")
            text = text.replace("from ...db", "from ....db")
            text = text.replace("from ..telegram", "from ...telegram")
            # audit_log was audit.py in proposal; keep audit_log name for less churn
            write(conv_new / name, text)

        write(
            conv_new / "__init__.py",
            '''\
from .parser import parse_conversation_script
from .runner import conversation_runner
from .store import conversation_job_store
from .validator import validate_conversation_script

__all__ = [
    "conversation_job_store",
    "conversation_runner",
    "parse_conversation_script",
    "validate_conversation_script",
]
''',
        )
        write(
            auto / "__init__.py",
            '''\
from .conversation import (
    conversation_job_store,
    conversation_runner,
    parse_conversation_script,
    validate_conversation_script,
)

__all__ = [
    "conversation_job_store",
    "conversation_runner",
    "parse_conversation_script",
    "validate_conversation_script",
]
''',
        )
        # facade at old conversation path
        write(
            CONVERSATION / "__init__.py",
            '''\
"""Backward-compatible facade for conversation automation. """
from ..automation.conversation import (
    conversation_job_store,
    conversation_runner,
    parse_conversation_script,
    validate_conversation_script,
)

__all__ = [
    "conversation_job_store",
    "conversation_runner",
    "parse_conversation_script",
    "validate_conversation_script",
]
''',
        )
        # Keep submodules importable for tests: app.services.conversation.parser etc.
        for name in ["parser", "validator", "runner", "store", "audit_log"]:
            write(
                CONVERSATION / f"{name}.py",
                f'''\
"""Backward-compatible facade."""
from ..automation.conversation.{name} import *  # noqa: F403
''',
            )


def restructure_realtime() -> None:
    print("== realtime publisher facade")
    # Already split; add publisher.py that re-exports publish helpers from manager if any
    manager = (REALTIME / "manager.py").read_text(encoding="utf-8")
    # extract publish methods if present
    pub_path = REALTIME / "publisher.py"
    if not pub_path.exists() or "publish" in manager:
        write(
            pub_path,
            '''\
"""Realtime publish helpers — thin re-export of MessageWsManager publish APIs."""
from .manager import MessageWsManager, message_ws_manager

__all__ = ["MessageWsManager", "message_ws_manager"]
''',
        )
    bridge = REALTIME / "bridge.py"
    if not bridge.exists():
        write(
            bridge,
            '''\
"""Bridge Telegram listener events into the realtime publisher.

Listener currently imports message_ws_manager directly; this module documents
the integration point and re-exports the manager for future wiring.
"""
from .manager import message_ws_manager
from .publisher import MessageWsManager

__all__ = ["MessageWsManager", "message_ws_manager"]
''',
        )


def restructure_metadata() -> None:
    print("== metadata service package (thin)")
    meta = SERVICES / "metadata"
    ensure_dir(meta)
    write(
        meta / "audit.py",
        '''\
"""Business audit access used by routers/services."""
from ...db import metadata_store

__all__ = ["metadata_store"]
''',
    )
    write(
        meta / "roster.py",
        '''\
"""Roster store access used by routers/services."""
from ...db import roster_store

__all__ = ["roster_store"]
''',
    )
    write(
        meta / "__init__.py",
        '''\
from .audit import metadata_store
from .roster import roster_store

__all__ = ["metadata_store", "roster_store"]
''',
    )


def fix_actions_client_imports() -> None:
    """After client package move, telegram modules import from .client which is package."""
    # client package __init__ exports telethon_session — `from ..client import telethon_session` works
    # pool facades ok
    pass


def update_telegram_init() -> None:
    write(
        TELEGRAM / "__init__.py",
        '''\
from .auth import telegram_auth_service
from .dialogs import telegram_dialog_service
from .groups import telegram_group_service
from .listener import telegram_listener
from .messages import telegram_message_service
from .pool import telethon_client_pool
from .sessions import telegram_session_service

__all__ = [
    "telegram_auth_service",
    "telegram_dialog_service",
    "telegram_group_service",
    "telegram_listener",
    "telegram_message_service",
    "telethon_client_pool",
    "telegram_session_service",
]
''',
    )


def main() -> None:
    # Order: extract from current monoliths before overwriting facades
    # First backup? we rewrite messages/dialogs/auth/sessions in place as facades
    # So extract first in each restructure_* function from original files.

    # Preserve originals temporarily if re-running on facades
    for name in ["messages.py", "dialogs.py", "auth.py", "sessions.py", "groups.py", "client.py", "pool.py"]:
        path = TELEGRAM / name
        bak = TELEGRAM / f"{name}.bak_src"
        if not path.exists():
            if bak.exists():
                print(f"  restore missing {name} from bak")
                path.write_text(bak.read_text(encoding="utf-8"), encoding="utf-8")
            continue
        text = path.read_text(encoding="utf-8")
        if "Backward-compatible facade" in text or text.count("\n") < 30:
            if bak.exists():
                print(f"  restore {name} from bak")
                path.write_text(bak.read_text(encoding="utf-8"), encoding="utf-8")
            else:
                print(f"  WARN {name} looks like facade and no bak")

    # Save backups of originals once
    for name in ["messages.py", "dialogs.py", "auth.py", "sessions.py", "groups.py", "client.py", "pool.py"]:
        path = TELEGRAM / name
        bak = TELEGRAM / f"{name}.bak_src"
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        if "Backward-compatible facade" not in text and text.count("\n") > 30:
            bak.write_text(text, encoding="utf-8")

    restructure_common()
    restructure_client()
    restructure_messages()
    restructure_dialogs()
    restructure_auth()
    restructure_sessions()
    restructure_groups()
    restructure_automation()
    restructure_realtime()
    restructure_metadata()
    update_telegram_init()
    print("DONE")


if __name__ == "__main__":
    main()
