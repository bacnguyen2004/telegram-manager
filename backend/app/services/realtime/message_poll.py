import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from ..telegram.dialogs import telegram_dialog_service

PollPayload = dict[str, Any]
IsCancelled = Callable[[], bool] | Callable[[], Awaitable[bool]]

DEFAULT_POLL_INTERVAL = 2.0
DEFAULT_HEARTBEAT_IDLE_TICKS = 15


async def _is_cancelled(callback: IsCancelled | None) -> bool:
    if callback is None:
        return False
    result = callback()
    if asyncio.iscoroutine(result):
        return bool(await result)
    return bool(result)


async def iter_dialog_message_poll(
    phone: str,
    peer_id: str,
    min_id: int,
    *,
    poll_interval: float = DEFAULT_POLL_INTERVAL,
    heartbeat_idle_ticks: int = DEFAULT_HEARTBEAT_IDLE_TICKS,
    is_cancelled: IsCancelled | None = None,
) -> Any:
    cursor = min_id
    idle_ticks = 0

    yield {"type": "connected", "cursor": cursor}

    while True:
        if await _is_cancelled(is_cancelled):
            break

        result = await telegram_dialog_service.get_new_messages(
            phone,
            peer_id,
            cursor,
            50,
        )
        if result.get("status") == "success":
            messages = result.get("messages") or []
            if messages:
                cursor = max(int(cursor), max(int(item["id"]) for item in messages))
                latest = messages[-1]
                preview = telegram_dialog_service._dialog_preview_from_row(latest)
                preview["peer_id"] = str(peer_id)
                yield {
                    "type": "messages",
                    "messages": messages,
                    "dialog_preview": preview,
                }
                idle_ticks = 0
            else:
                idle_ticks += 1
        else:
            idle_ticks += 1
            yield {
                "type": "error",
                "message": str(result.get("message") or "Khong lay duoc tin moi"),
            }

        if idle_ticks > 0 and idle_ticks % heartbeat_idle_ticks == 0:
            yield {"type": "heartbeat"}

        if await _is_cancelled(is_cancelled):
            break

        await asyncio.sleep(poll_interval)