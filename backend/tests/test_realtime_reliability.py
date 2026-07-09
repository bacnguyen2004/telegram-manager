from unittest.mock import AsyncMock, MagicMock

import pytest
from starlette.websockets import WebSocketState

from app.config import settings
from app.services.realtime import manager as message_ws
from app.services.realtime.events import filter_new_messages
from app.services.realtime.manager import MessageWsManager
from app.services.realtime.rooms import MessageStreamRoom, WsSubscriber


@pytest.fixture
def manager(monkeypatch) -> MessageWsManager:
    monkeypatch.setattr(settings, "telegram_realtime_mode", "hybrid")
    monkeypatch.setattr(settings, "telegram_listener_enabled", True)
    return MessageWsManager(max_connections_per_phone=5, ping_interval=60.0)


def test_filter_new_messages_dedups_by_id():
    seen: set[int] = set()
    rows = [
        {"id": 10, "text": "a"},
        {"id": 10, "text": "a-dup"},
        {"id": 11, "text": "b"},
    ]
    fresh = filter_new_messages(seen, rows)
    assert [item["id"] for item in fresh] == [10, 11]
    assert filter_new_messages(seen, rows) == []


async def test_publish_incoming_message_skips_duplicate_ids(manager):
    room_key = manager.room_key("+84901234567", "123456789")
    fake_socket = MagicMock()
    fake_socket.client_state = WebSocketState.CONNECTED
    fake_socket.send_json = AsyncMock()

    manager._rooms[room_key] = MessageStreamRoom(
        phone="+84901234567",
        peer_id="123456789",
        cursor=10,
        subscribers={
            "sub-1": WsSubscriber(
                websocket=fake_socket,
                subscriber_id="sub-1",
                min_id=10,
                last_seen_id=10,
            )
        },
    )

    row = {
        "id": 501,
        "text": "once",
        "date": "",
        "sender_id": "1",
        "sender_name": "A",
        "outgoing": False,
        "content_type": "text",
        "has_media": False,
        "has_photo": False,
        "edited": False,
        "edited_date": "",
        "reactions": [],
    }
    preview = {
        "peer_id": "123456789",
        "last_message": "once",
        "last_message_id": 501,
        "date": "",
    }

    await manager.publish_incoming_message("+84901234567", "123456789", [row], preview)
    await manager.publish_incoming_message("+84901234567", "123456789", [row], preview)

    assert fake_socket.send_json.await_count == 1


async def test_hybrid_mode_starts_poll_and_listener(monkeypatch):
    monkeypatch.setattr(settings, "telegram_realtime_mode", "hybrid")
    ensure_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(
        "app.services.telegram.listener.telegram_listener.ensure_listening",
        ensure_mock,
    )

    manager = MessageWsManager(max_connections_per_phone=5, ping_interval=60.0)
    room = MessageStreamRoom(phone="+84901234567", peer_id="123456789", cursor=1)

    await manager._ensure_listener(
        room,
        manager.room_key("+84901234567", "123456789"),
        "+84901234567",
    )

    ensure_mock.assert_awaited_once()
    assert room.poll_task is not None
    assert not room.poll_task.done()
    room.poll_task.cancel()


async def test_send_gap_fill_pushes_missing_messages(monkeypatch, manager):
    room_key = manager.room_key("+84901234567", "123456789")
    fake_socket = MagicMock()
    fake_socket.client_state = WebSocketState.CONNECTED
    fake_socket.send_json = AsyncMock()

    room = MessageStreamRoom(phone="+84901234567", peer_id="123456789", cursor=20)
    subscriber = WsSubscriber(
        websocket=fake_socket,
        subscriber_id="sub-1",
        min_id=10,
        last_seen_id=10,
    )
    manager._rooms[room_key] = room

    async def mock_get_new_messages(phone, peer_id, min_id, limit=50):
        return {
            "status": "success",
            "messages": [
                {
                    "id": 21,
                    "text": "gap",
                    "date": "01/07/2026 12:00:00",
                    "sender_id": "1",
                    "sender_name": "A",
                    "outgoing": False,
                    "content_type": "text",
                    "has_media": False,
                    "has_photo": False,
                    "edited": False,
                    "edited_date": "",
                    "reactions": [],
                }
            ],
        }

    monkeypatch.setattr(
        message_ws.telegram_dialog_service,
        "get_new_messages",
        mock_get_new_messages,
    )
    monkeypatch.setattr(
        message_ws.telegram_dialog_service,
        "_dialog_preview_from_row",
        lambda row: {
            "peer_id": "",
            "last_message": row["text"],
            "last_message_id": row["id"],
            "date": row["date"],
        },
    )

    await manager._send_gap_fill(subscriber, room, 10)

    fake_socket.send_json.assert_awaited_once()
    payload = fake_socket.send_json.await_args.args[0]
    assert payload["type"] == "messages"
    assert payload["gap_fill"] is True
    assert payload["messages"][0]["id"] == 21
    assert room.cursor == 21