import re
from urllib.parse import parse_qs, urlparse

from telethon import TelegramClient
from telethon.tl.types import MessageMediaWebPage

_TME_POST_LINK_RE = re.compile(
    r"https?://t\.me/(?:c/(\d+)|([A-Za-z0-9_]+))/(\d+)",
    re.IGNORECASE,
)


class PollLinksMixin:
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
