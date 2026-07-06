import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from starlette.websockets import WebSocketState

from app.config import settings
from app.services.realtime import message_ws
from app.services.realtime.message_ws import MessageWsManager
from app.services.telegram import listener as listener_module
from app.services.telegram.listener import TelegramListenerService


def _fake_message(message_id: int = 501) -> SimpleNamespace:
    return SimpleNamespace(
        id=message_id,
        message="realtime hello",
        date=None,
        media=None,
        photo=None,
        poll=None,
        out=False,
        sender_id=99,
        peer_id=SimpleNamespace(user_id=123456789),
        reply_to=None,
        edit_date=None,
    )


def _fake_event(message_id: int = 501) -> SimpleNamespace:
    return SimpleNamespace(
        message=_fake_message(message_id),
        chat_id=123456789,
    )


@pytest.fixture
def ws_manager(monkeypatch) -> MessageWsManager:
    test_manager = MessageWsManager(max_connections_per_phone=5, ping_interval=60.0)
    monkeypatch.setattr(message_ws, "message_ws_manager", test_manager)
    monkeypatch.setattr("app.routers.dialogs.message_ws_manager", test_manager)
    return test_manager


async def test_publish_incoming_message_broadcasts_to_room(ws_manager):
    from app.services.realtime.message_ws import MessageStreamRoom, WsSubscriber

    room_key = ws_manager.room_key("+84901234567", "123456789")
    fake_socket = MagicMock()
    fake_socket.client_state = WebSocketState.CONNECTED
    fake_socket.send_json = AsyncMock()

    ws_manager._rooms[room_key] = MessageStreamRoom(
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
        "text": "realtime hello",
        "date": "01/07/2026 12:00:00",
        "sender_id": "99",
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
        "last_message": "realtime hello",
        "last_message_id": 501,
        "date": "01/07/2026 12:00:00",
    }

    await ws_manager.publish_incoming_message(
        "+84901234567",
        "123456789",
        [row],
        preview,
    )

    assert ws_manager._rooms[room_key].cursor == 501
    fake_socket.send_json.assert_awaited_once()
    payload = fake_socket.send_json.await_args.args[0]
    assert payload["type"] == "messages"
    assert payload["messages"][0]["id"] == 501


async def test_listener_handle_new_message_publishes(monkeypatch, ws_manager):
    monkeypatch.setattr(settings, "telegram_listener_enabled", True)

    service = TelegramListenerService()
    published: dict = {}

    async def mock_publish(phone, peer_id, messages, preview):
        published["phone"] = phone
        published["peer_id"] = peer_id
        published["messages"] = messages
        published["preview"] = preview

    monkeypatch.setattr(
        message_ws.message_ws_manager,
        "publish_incoming_message",
        mock_publish,
    )

    fake_client = MagicMock()
    fake_client.get_me = AsyncMock(
        return_value=SimpleNamespace(id=1),
    )

    monkeypatch.setattr(
        listener_module.telegram_dialog_service,
        "_resolve_sender_names",
        AsyncMock(return_value={99: "Tester"}),
    )
    monkeypatch.setattr(
        listener_module.telegram_dialog_service,
        "_build_message_row",
        lambda message, me_id=None, sender_names=None, pinned=False: {
            "id": message.id,
            "text": message.message,
            "date": "",
            "sender_id": "99",
            "sender_name": "Tester",
            "outgoing": False,
            "content_type": "text",
            "has_media": False,
            "has_photo": False,
            "edited": False,
            "edited_date": "",
            "reactions": [],
        },
    )
    monkeypatch.setattr(
        listener_module.telegram_dialog_service,
        "_dialog_preview_from_row",
        lambda row: {
            "peer_id": "",
            "last_message": row["text"],
            "last_message_id": row["id"],
            "date": "",
        },
    )

    class LockedClientCtx:
        async def __aenter__(self):
            return fake_client

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(
        listener_module.telethon_client_pool,
        "locked_client",
        lambda phone: LockedClientCtx(),
    )

    await service._handle_new_message("+84901234567", _fake_event())

    assert published["phone"] == "+84901234567"
    assert published["peer_id"] == "123456789"
    assert published["messages"][0]["id"] == 501
    assert published["preview"]["peer_id"] == "123456789"


async def test_ws_manager_event_mode_uses_listener_without_poll(monkeypatch):
    monkeypatch.setattr(settings, "telegram_realtime_mode", "event")
    monkeypatch.setattr(settings, "telegram_listener_enabled", True)

    ensure_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(
        "app.services.telegram.listener.telegram_listener.ensure_listening",
        ensure_mock,
    )

    manager = MessageWsManager(max_connections_per_phone=5, ping_interval=60.0)
    room = message_ws.MessageStreamRoom(
        phone="+84901234567",
        peer_id="123456789",
        cursor=1,
    )

    await manager._ensure_listener(
        room,
        manager.room_key("+84901234567", "123456789"),
        "+84901234567",
    )

    ensure_mock.assert_awaited_once_with("+84901234567")
    assert room.poll_task is None