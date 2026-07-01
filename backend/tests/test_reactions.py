from telethon.tl.types import (
    ChatReactionsAll,
    ChatReactionsNone,
    ChatReactionsSome,
    ReactionCustomEmoji,
    ReactionEmoji,
)

from app.services.telegram.reactions import (
    default_reactions_policy,
    format_reaction_error,
    is_emoji_allowed,
    parse_available_reactions,
    reaction_not_allowed_message,
)
from telethon.errors import ReactionInvalidError


def test_parse_available_reactions_all():
    policy = parse_available_reactions(ChatReactionsAll())
    assert policy["enabled"] is True
    assert policy["mode"] == "all"
    assert "👍" in policy["allowed_emojis"]


def test_parse_available_reactions_none():
    policy = parse_available_reactions(ChatReactionsNone())
    assert policy["enabled"] is False
    assert policy["mode"] == "none"
    assert policy["allowed_emojis"] == []


def test_parse_available_reactions_some():
    policy = parse_available_reactions(
        ChatReactionsSome(
            reactions=[
                ReactionEmoji(emoticon="👍"),
                ReactionEmoji(emoticon="❤️"),
            ]
        )
    )
    assert policy["enabled"] is True
    assert policy["mode"] == "some"
    assert policy["allowed_emojis"] == ["👍", "❤️"]
    assert policy["has_custom"] is False


def test_parse_available_reactions_custom_only():
    policy = parse_available_reactions(
        ChatReactionsSome(reactions=[ReactionCustomEmoji(document_id=123)])
    )
    assert policy["enabled"] is True
    assert policy["mode"] == "some"
    assert policy["allowed_emojis"] == []
    assert policy["has_custom"] is True


def test_is_emoji_allowed_modes():
    all_policy = default_reactions_policy()
    assert is_emoji_allowed(all_policy, "👍") is True

    some_policy = {"enabled": True, "mode": "some", "allowed_emojis": ["👍"]}
    assert is_emoji_allowed(some_policy, "👍") is True
    assert is_emoji_allowed(some_policy, "🔥") is False

    none_policy = {"enabled": False, "mode": "none", "allowed_emojis": []}
    assert is_emoji_allowed(none_policy, "👍") is False


def test_reaction_not_allowed_message_some():
    policy = {"enabled": True, "mode": "some", "allowed_emojis": ["👍", "❤️"]}
    message = reaction_not_allowed_message(policy, "🔥")
    assert "👍" in message
    assert "❤️" in message


def test_format_reaction_error_invalid():
    message = format_reaction_error(ReactionInvalidError(request=None))
    assert "khong cho phep" in message.lower()