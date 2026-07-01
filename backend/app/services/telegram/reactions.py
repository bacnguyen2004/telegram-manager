from __future__ import annotations

from telethon import TelegramClient
from telethon.errors import ReactionEmptyError, ReactionInvalidError, ReactionsTooManyError
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.functions.messages import GetFullChatRequest
from telethon.tl.types import (
    Channel,
    Chat,
    ChatReactionsAll,
    ChatReactionsNone,
    ChatReactionsSome,
    ReactionCustomEmoji,
    ReactionEmoji,
    User,
)

DEFAULT_QUICK_REACTIONS = ("👍", "❤️", "🔥", "👏", "😂")


def default_reactions_policy() -> dict:
    return {
        "enabled": True,
        "mode": "all",
        "allowed_emojis": list(DEFAULT_QUICK_REACTIONS),
        "has_custom": False,
    }


def parse_available_reactions(available) -> dict:
    if available is None:
        return default_reactions_policy()
    if isinstance(available, ChatReactionsNone):
        return {
            "enabled": False,
            "mode": "none",
            "allowed_emojis": [],
            "has_custom": False,
        }
    if isinstance(available, ChatReactionsAll):
        return {
            "enabled": True,
            "mode": "all",
            "allowed_emojis": list(DEFAULT_QUICK_REACTIONS),
            "has_custom": False,
        }
    if isinstance(available, ChatReactionsSome):
        emojis: list[str] = []
        has_custom = False
        for reaction in available.reactions or []:
            if isinstance(reaction, ReactionEmoji):
                emoticon = (reaction.emoticon or "").strip()
                if emoticon:
                    emojis.append(emoticon)
            elif isinstance(reaction, ReactionCustomEmoji):
                has_custom = True
        return {
            "enabled": bool(emojis or has_custom),
            "mode": "some",
            "allowed_emojis": emojis,
            "has_custom": has_custom,
        }
    return default_reactions_policy()


async def fetch_peer_reactions_policy(client: TelegramClient, entity) -> dict:
    if isinstance(entity, User):
        return default_reactions_policy()
    if isinstance(entity, Channel):
        full = await client(GetFullChannelRequest(channel=entity))
        return parse_available_reactions(full.full_chat.available_reactions)
    if isinstance(entity, Chat):
        full = await client(GetFullChatRequest(chat_id=entity.id))
        return parse_available_reactions(full.full_chat.available_reactions)
    return default_reactions_policy()


def is_emoji_allowed(policy: dict, emoji: str) -> bool:
    emoji = (emoji or "").strip()
    if not emoji or emoji.startswith("custom:"):
        return False
    if not policy.get("enabled", True):
        return False

    mode = policy.get("mode", "all")
    if mode == "all":
        return True
    if mode == "none":
        return False
    return emoji in (policy.get("allowed_emojis") or [])


def reaction_not_allowed_message(policy: dict, emoji: str) -> str:
    if not policy.get("enabled", True) or policy.get("mode") == "none":
        return "Group nay da tat reaction"
    if policy.get("has_custom") and not (policy.get("allowed_emojis") or []):
        return "Group nay chi cho phep custom emoji (chua ho tro tren web)"
    allowed = policy.get("allowed_emojis") or []
    if allowed:
        preview = " ".join(allowed[:6])
        return f"Group nay khong cho phep emoji nay. Duoc phep: {preview}"
    return "Group nay khong cho phep emoji nay"


def format_reaction_error(exc: Exception) -> str:
    if isinstance(exc, ReactionInvalidError):
        return "Group nay khong cho phep emoji nay"
    if isinstance(exc, ReactionEmptyError):
        return "Group nay da tat reaction"
    if isinstance(exc, ReactionsTooManyError):
        return "Da dat gioi han so reaction tren tin nhan"
    return str(exc)