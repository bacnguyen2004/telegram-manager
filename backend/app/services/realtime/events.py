from typing import Any

STREAM_EVENT_CONNECTED = "connected"
STREAM_EVENT_MESSAGES = "messages"
STREAM_EVENT_EDITED = "edited"
STREAM_EVENT_DELETED = "deleted"
STREAM_EVENT_REACTION = "reaction"
STREAM_EVENT_READ = "read"
STREAM_EVENT_HEARTBEAT = "heartbeat"
STREAM_EVENT_RESYNC_REQUIRED = "resync_required"
STREAM_EVENT_ERROR = "error"

REALTIME_MODE_POLLING = "polling"
REALTIME_MODE_EVENT = "event"
REALTIME_MODE_HYBRID = "hybrid"

MAX_SEEN_MESSAGE_IDS = 1000

StreamPayload = dict[str, Any]


def normalize_realtime_mode(
    raw_mode: str,
    *,
    listener_enabled_legacy: bool | None = None,
) -> str:
    mode = (raw_mode or "").strip().lower()
    if mode in {REALTIME_MODE_POLLING, REALTIME_MODE_EVENT, REALTIME_MODE_HYBRID}:
        return mode
    if listener_enabled_legacy is False:
        return REALTIME_MODE_POLLING
    if listener_enabled_legacy is True:
        return REALTIME_MODE_EVENT
    return REALTIME_MODE_HYBRID


def filter_new_messages(
    seen_ids: set[int],
    messages: list[dict],
    *,
    max_seen: int = MAX_SEEN_MESSAGE_IDS,
) -> list[dict]:
    fresh: list[dict] = []
    for item in messages:
        message_id = int(item.get("id") or 0)
        if message_id < 1 or message_id in seen_ids:
            continue
        seen_ids.add(message_id)
        fresh.append(item)

    if len(seen_ids) > max_seen:
        keep = sorted(seen_ids)[-max_seen:]
        seen_ids.clear()
        seen_ids.update(keep)

    return fresh


def mark_messages_seen(seen_ids: set[int], messages: list[dict]) -> None:
    for item in messages:
        message_id = int(item.get("id") or 0)
        if message_id > 0:
            seen_ids.add(message_id)