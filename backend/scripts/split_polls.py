"""Split actions/polls.py helpers into poll_*.py mixins; keep public API in polls.py."""
from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POLLS = ROOT / "app" / "services" / "telegram" / "actions" / "polls.py"
ACTIONS = POLLS.parent

GROUPS = {
    "poll_links.py": {
        "class": "PollLinksMixin",
        "imports": '''\
import re
from urllib.parse import parse_qs, urlparse

from telethon import TelegramClient

_TME_POST_LINK_RE = re.compile(
    r"https?://t\\.me/(?:c/(\\d+)|([A-Za-z0-9_]+))/(\\d+)",
    re.IGNORECASE,
)
''',
        "methods": [
            "_split_message_link",
            "_build_message_link",
            "_normalize_fetched_message",
            "_webpage_target_link",
            "_warm_entity_from_link",
            "_message_ref_from_link",
            "_fetch_message_from_link",
            "_resolve_poll_message",
        ],
    },
    "poll_extract.py": {
        "class": "PollExtractMixin",
        "imports": '''\
from telethon.tl.types import MessageMediaPoll, MessageMediaToDo, MessageMediaWebPage
''',
        "methods": [
            "_poll_object_from_message",
            "_todo_from_message",
            "_extract_votable",
            "_extract_poll",
            "_poll_result",
            "_user_todo_completion_ids",
        ],
    },
    "poll_serialize.py": {
        "class": "PollSerializeMixin",
        "imports": '''\
from telethon.tl.types import TextWithEntities
''',
        "methods": [
            "_text_with_entities",
            "_can_append_options",
            "_next_todo_item_id",
            "_find_added_option",
            "_votable_settings",
            "_serialize_poll_option",
            "_peer_user_id",
            "_poll_option_stats_key",
            "_poll_vote_meta",
            "_suggest_option_index",
            "_text_with_entities_label",
            "_votable_question_label",
            "_option_label",
            "_poll_question_label",
            "_poll_answer_label",
        ],
    },
    "poll_resolve.py": {
        "class": "PollResolveMixin",
        "imports": '''\
import base64
''',
        "methods": [
            "_decode_poll_option_param",
            "_normalize_vote_tokens",
            "_resolve_votable_token",
            "_decode_option_hex",
            "_bytes_to_todo_id",
            "_resolve_poll_option_bytes",
            "_resolve_todo_option_bytes",
            "_resolve_votable_option_bytes",
            "_resolve_votable_option",
            "_resolve_poll_option",
        ],
    },
}

PUBLIC = [
    "get_poll_info",
    "vote_poll",
    "cancel_poll_vote",
    "add_poll_option",
    "add_poll_option_vote",
]


def extract_methods(source: str, class_name: str) -> dict[str, str]:
    tree = ast.parse(source)
    lines = source.splitlines(keepends=True)
    target = next(
        n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == class_name
    )
    methods: dict[str, str] = {}
    for item in target.body:
        if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        start = item.lineno
        if item.decorator_list:
            start = min(d.lineno for d in item.decorator_list)
        end = item.end_lineno
        methods[item.name] = "".join(lines[start - 1 : end]).rstrip() + "\n"
    return methods


def main() -> None:
    source = POLLS.read_text(encoding="utf-8")
    methods = extract_methods(source, "PollActionService")
    assigned = set(PUBLIC)
    for meta in GROUPS.values():
        assigned.update(meta["methods"])
    missing = set(methods) - assigned
    if missing:
        raise SystemExit(f"Unassigned methods: {sorted(missing)}")
    extra = assigned - set(methods)
    if extra - set(PUBLIC):
        # public always present
        pass
    for name in PUBLIC:
        if name not in methods:
            raise SystemExit(f"Missing public {name}")

    for filename, meta in GROUPS.items():
        parts = [meta["imports"].rstrip() + "\n\n\n", f"class {meta['class']}:\n"]
        for m in meta["methods"]:
            if m not in methods:
                raise SystemExit(f"Missing {m} for {filename}")
            parts.append(methods[m])
            parts.append("\n")
        path = ACTIONS / filename
        path.write_text("".join(parts).rstrip() + "\n", encoding="utf-8")
        print("wrote", path.relative_to(ROOT), "methods", len(meta["methods"]))

    # Rewrite polls.py with public methods only + mixins
    public_body = []
    for m in PUBLIC:
        public_body.append(methods[m])
        public_body.append("\n")

    new_polls = f'''\
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
{"".join(public_body)}
'''
    # public methods already have 4-space indent as class body — good
    # Fix: class body methods need to stay indented; they already are from extraction.
    # But we put them after class line without extra indent - they're already "    async def"
    POLLS.write_text(new_polls, encoding="utf-8")
    print("wrote polls.py public API only")

    # Post-process public methods to use run_with_authorized_client would be a separate manual step
    # Keep original session boilerplate in public methods for now (safer).


if __name__ == "__main__":
    main()
