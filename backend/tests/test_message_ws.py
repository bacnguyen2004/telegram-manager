import asyncio

import pytest
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.config import settings
from app.services.realtime import message_poll, message_ws
from app.services.realtime.message_ws import MessageWsManager
from app.services.telegram import dialogs


def _sample_message(message_id: int = 88) -> dict:
    return {
        "id": message_id,
        "date": "01/07/2026 12:00:00",
        "sender_id": "1",
        "sender_name": "A",
        "outgoing": False,
        "content_type": "text",
        "has_media": False,
        "has_photo": False,
        "text": "hello stream",
        "edited": False,
        "edited_date": "",
        "reactions": [],
    }


def _install_poll_mocks(monkeypatch, *, first_batch_id: int = 88) -> dict:
    calls = {"count": 0}

    async def mock_get_new_messages(
        phone: str,
        peer_id: str,
        min_id: int,
        limit: int = 50,
    ):
        calls["count"] += 1
        if calls["count"] == 1:
            return {
                "status": "success",
                "phone": phone,
                "peer_id": peer_id,
                "messages": [_sample_message(first_batch_id)],
                "message": "OK",
            }
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "messages": [],
            "message": "OK",
        }

    def mock_dialog_preview_from_row(row: dict) -> dict:
        return {
            "last_message": row["text"],
            "last_message_id": row["id"],
            "date": row["date"],
        }

    monkeypatch.setattr(
        dialogs.telegram_dialog_service,
        "get_new_messages",
        mock_get_new_messages,
    )
    monkeypatch.setattr(
        dialogs.telegram_dialog_service,
        "_dialog_preview_from_row",
        mock_dialog_preview_from_row,
    )
    monkeypatch.setattr(message_poll, "DEFAULT_POLL_INTERVAL", 0.01)
    return calls


class FakeWebSocket:
    def __init__(self) -> None:
        self.client_state = WebSocketState.CONNECTED
        self.sent: list[dict] = []
        self._receive_waiter: asyncio.Future[dict] = asyncio.get_running_loop().create_future()

    async def accept(self) -> None:
        return None

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)

    async def receive(self) -> dict:
        return await self._receive_waiter

    async def close(self, code: int | None = None) -> None:
        self.client_state = WebSocketState.DISCONNECTED
        if not self._receive_waiter.done():
            self._receive_waiter.set_exception(WebSocketDisconnect(code or 1000))

    def disconnect(self) -> None:
        self.client_state = WebSocketState.DISCONNECTED
        if not self._receive_waiter.done():
            self._receive_waiter.set_exception(WebSocketDisconnect(1000))


async def _wait_for_event(
    websocket: FakeWebSocket,
    event_type: str,
    *,
    timeout: float = 2.0,
) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        for payload in websocket.sent:
            if payload.get("type") == event_type:
                return payload
        await asyncio.sleep(0.01)
    raise AssertionError(f"Timed out waiting for event type: {event_type}")


@pytest.fixture
def manager(monkeypatch) -> MessageWsManager:
    monkeypatch.setattr(settings, "telegram_listener_enabled", False)
    monkeypatch.setattr(settings, "telegram_realtime_mode", "polling")
    test_manager = MessageWsManager(max_connections_per_phone=5, ping_interval=60.0)
    monkeypatch.setattr(message_ws, "message_ws_manager", test_manager)
    monkeypatch.setattr("app.routers.dialogs.message_ws_manager", test_manager)
    return test_manager


async def test_manager_shared_poll_for_multiple_subscribers(manager, monkeypatch):
    calls = {"count": 0}

    async def mock_get_new_messages(
        phone: str,
        peer_id: str,
        min_id: int,
        limit: int = 50,
    ):
        calls["count"] += 1
        if calls["count"] <= 2:
            return {
                "status": "success",
                "phone": phone,
                "peer_id": peer_id,
                "messages": [],
                "message": "OK",
            }
        if calls["count"] == 3:
            return {
                "status": "success",
                "phone": phone,
                "peer_id": peer_id,
                "messages": [_sample_message()],
                "message": "OK",
            }
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "messages": [],
            "message": "OK",
        }

    monkeypatch.setattr(
        dialogs.telegram_dialog_service,
        "get_new_messages",
        mock_get_new_messages,
    )
    monkeypatch.setattr(
        dialogs.telegram_dialog_service,
        "_dialog_preview_from_row",
        lambda row: {
            "last_message": row["text"],
            "last_message_id": row["id"],
            "date": row["date"],
        },
    )
    monkeypatch.setattr(message_poll, "DEFAULT_POLL_INTERVAL", 0.01)

    phone = "+84901234567"
    peer_id = "123456789"
    ws_a = FakeWebSocket()
    ws_b = FakeWebSocket()

    task_a = asyncio.create_task(manager.handle_connection(ws_a, phone, peer_id, 1))
    task_b = asyncio.create_task(manager.handle_connection(ws_b, phone, peer_id, 1))

    await asyncio.sleep(0.05)
    assert any(item["type"] == "connected" for item in ws_a.sent)
    assert any(item["type"] == "connected" for item in ws_b.sent)

    await _wait_for_event(ws_a, "messages")
    await _wait_for_event(ws_b, "messages")
    assert calls["count"] == 3

    ws_a.disconnect()
    ws_b.disconnect()
    await asyncio.gather(task_a, task_b, return_exceptions=True)


async def test_manager_resync_required_for_stale_cursor(manager, monkeypatch):
    _install_poll_mocks(monkeypatch, first_batch_id=95)
    phone = "+84901234567"
    peer_id = "123456789"
    ws_leader = FakeWebSocket()
    ws_late = FakeWebSocket()

    leader_task = asyncio.create_task(
        manager.handle_connection(ws_leader, phone, peer_id, 1),
    )
    await asyncio.sleep(0.05)
    await _wait_for_event(ws_leader, "messages")

    late_task = asyncio.create_task(
        manager.handle_connection(ws_late, phone, peer_id, 1),
    )
    await asyncio.sleep(0.05)

    event_types = {payload["type"] for payload in ws_late.sent}
    assert "resync_required" in event_types
    assert "connected" in event_types
    resync = next(item for item in ws_late.sent if item["type"] == "resync_required")
    assert resync["cursor"] == 95

    ws_leader.disconnect()
    ws_late.disconnect()
    await asyncio.gather(leader_task, late_task, return_exceptions=True)


async def test_manager_rejects_when_phone_connection_limit_reached(manager, monkeypatch):
    _install_poll_mocks(monkeypatch)
    manager.max_connections_per_phone = 1
    phone = "+84901234567"
    ws_open = FakeWebSocket()
    ws_rejected = FakeWebSocket()

    open_task = asyncio.create_task(
        manager.handle_connection(ws_open, phone, "123456789", 1),
    )
    await asyncio.sleep(0.05)

    rejected_task = asyncio.create_task(
        manager.handle_connection(ws_rejected, phone, "987654321", 1),
    )
    await asyncio.sleep(0.05)

    assert ws_rejected.sent[0]["type"] == "error"
    assert ws_rejected.client_state == WebSocketState.DISCONNECTED

    ws_open.disconnect()
    await asyncio.gather(open_task, rejected_task, return_exceptions=True)


async def test_manager_cleans_up_empty_room(manager, monkeypatch):
    _install_poll_mocks(monkeypatch)
    phone = "+84901234567"
    peer_id = "123456789"
    room_key = manager.room_key(phone, peer_id)
    websocket = FakeWebSocket()

    task = asyncio.create_task(manager.handle_connection(websocket, phone, peer_id, 1))
    await asyncio.sleep(0.05)
    assert room_key in manager._rooms

    websocket.disconnect()
    await task
    assert room_key not in manager._rooms
    assert manager._phone_counts.get(phone, 0) == 0