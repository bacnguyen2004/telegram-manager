from app.services.realtime import poller as message_poll
from app.services.telegram import telegram_dialog_service


async def test_get_message_photo_success(client, monkeypatch):
    async def mock_get_message_photo(phone: str, peer_id: str, message_id: int):
        return b"\xff\xd8\xff fake-jpeg", "image/jpeg"

    monkeypatch.setattr(
        telegram_dialog_service,
        "get_message_photo",
        mock_get_message_photo,
    )

    response = client.get(
        "/api/dialogs/%2B84901234567/messages/42/photo?peer_id=123456789",
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/jpeg")
    assert response.content == b"\xff\xd8\xff fake-jpeg"


async def test_get_message_photo_not_found(client, monkeypatch):
    async def mock_get_message_photo(phone: str, peer_id: str, message_id: int):
        return {"status": "error", "message": "Tin nhan khong co anh"}

    monkeypatch.setattr(
        telegram_dialog_service,
        "get_message_photo",
        mock_get_message_photo,
    )

    response = client.get(
        "/api/dialogs/%2B84901234567/messages/42/photo?peer_id=123456789",
    )

    assert response.status_code == 404


async def test_mark_dialog_read_success(client, monkeypatch):
    async def mock_mark_dialog_read(phone: str, peer_id: str, max_id: int = 0):
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "read_inbox_max_id": max_id or 999,
            "unread_count": 0,
            "message": "OK",
        }

    monkeypatch.setattr(
        telegram_dialog_service,
        "mark_dialog_read",
        mock_mark_dialog_read,
    )

    response = client.post(
        "/api/dialogs/%2B84901234567/read",
        json={"peer_id": "123456789", "max_id": 999},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["status"] == "success"
    assert body["data"]["read_inbox_max_id"] == 999
    assert body["data"]["unread_count"] == 0


async def test_get_messages_with_offset_id(client, monkeypatch):
    captured: dict = {}

    async def mock_get_messages(
        phone: str,
        peer_id: str,
        limit: int = 40,
        offset_id: int = 0,
        around_id: int = 0,
        offset_date: str = "",
    ):
        captured["offset_id"] = offset_id
        captured["around_id"] = around_id
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "title": "Test Chat",
            "messages": [{"id": 10, "date": "", "sender_id": "", "sender_name": "",
                         "outgoing": False, "content_type": "text", "has_media": False,
                         "has_photo": False, "text": "hi"}],
            "total": 1,
            "has_more_older": False,
            "reactions_policy": {
                "enabled": True,
                "mode": "some",
                "allowed_emojis": ["👍", "❤️"],
                "has_custom": False,
            },
            "message": "OK",
        }

    monkeypatch.setattr(
        telegram_dialog_service,
        "get_messages",
        mock_get_messages,
    )

    response = client.get(
        "/api/dialogs/%2B84901234567/messages?peer_id=123456789&limit=50&offset_id=99",
    )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert captured["offset_id"] == 99
    assert body["data"]["has_more_older"] is False
    assert body["data"]["reactions_policy"]["mode"] == "some"
    assert body["data"]["reactions_policy"]["allowed_emojis"] == ["👍", "❤️"]


async def test_get_messages_without_offset_id(client, monkeypatch):
    captured: dict = {}

    async def mock_get_messages(
        phone: str,
        peer_id: str,
        limit: int = 40,
        offset_id: int = 0,
        around_id: int = 0,
        offset_date: str = "",
    ):
        captured["offset_id"] = offset_id
        captured["limit"] = limit
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "title": "Fresh Chat",
            "messages": [],
            "total": 0,
            "has_more_older": False,
            "message": "OK",
        }

    monkeypatch.setattr(
        telegram_dialog_service,
        "get_messages",
        mock_get_messages,
    )

    response = client.get(
        "/api/dialogs/%2B84901234567/messages?peer_id=123456789&limit=40",
    )

    assert response.status_code == 200
    assert captured["offset_id"] == 0
    assert captured["limit"] == 40


async def test_get_messages_has_more_older(client, monkeypatch):
    async def mock_get_messages(
        phone: str,
        peer_id: str,
        limit: int = 40,
        offset_id: int = 0,
        around_id: int = 0,
        offset_date: str = "",
    ):
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "title": "Long Chat",
            "messages": [
                {
                    "id": index,
                    "date": "",
                    "sender_id": "",
                    "sender_name": "",
                    "outgoing": False,
                    "content_type": "text",
                    "has_media": False,
                    "has_photo": False,
                    "text": f"msg-{index}",
                }
                for index in range(50)
            ],
            "total": 50,
            "has_more_older": True,
            "message": "OK",
        }

    monkeypatch.setattr(
        telegram_dialog_service,
        "get_messages",
        mock_get_messages,
    )

    response = client.get(
        "/api/dialogs/%2B84901234567/messages?peer_id=123456789&limit=50",
    )

    body = response.json()
    assert body["success"] is True
    assert body["data"]["has_more_older"] is True
    assert body["data"]["total"] == 50


async def test_get_pinned_messages_success(client, monkeypatch):
    async def mock_get_pinned_messages(
        phone: str,
        peer_id: str,
        limit: int = 10,
        skip: int = 0,
    ):
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "total": 1,
            "messages": [
                {
                    "id": 101,
                    "date": "01/07/2026 12:00:00",
                    "sender_id": "1",
                    "sender_name": "Admin",
                    "outgoing": False,
                    "content_type": "text",
                    "has_media": False,
                    "has_photo": False,
                    "text": "Tin ghim",
                    "reactions": [],
                }
            ],
            "message": "OK",
        }

    monkeypatch.setattr(
        telegram_dialog_service,
        "get_pinned_messages",
        mock_get_pinned_messages,
    )

    response = client.get(
        "/api/dialogs/%2B84901234567/pinned",
        params={"peer_id": "123456789", "limit": 5},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["total"] == 1
    assert body["data"]["messages"][0]["id"] == 101


async def test_search_dialog_messages_success(client, monkeypatch):
    captured: dict = {}

    async def mock_search_messages(
        phone: str,
        peer_id: str,
        query: str,
        limit: int = 50,
    ):
        captured["query"] = query
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "title": "",
            "total": 1,
            "messages": [
                {
                    "id": 77,
                    "date": "01/07/2026 12:00:00",
                    "sender_id": "1",
                    "sender_name": "A",
                    "outgoing": False,
                    "content_type": "text",
                    "has_media": False,
                    "has_photo": False,
                    "text": "hello world",
                    "edited": False,
                    "edited_date": "",
                    "reactions": [],
                }
            ],
            "has_more_older": False,
            "message": "OK",
        }

    monkeypatch.setattr(
        telegram_dialog_service,
        "search_messages",
        mock_search_messages,
    )

    response = client.get(
        "/api/dialogs/%2B84901234567/messages/search",
        params={"peer_id": "123456789", "q": "hello"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert captured["query"] == "hello"
    assert body["data"]["messages"][0]["id"] == 77


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


async def test_ws_dialog_messages_stream(client, monkeypatch):
    from app.config import settings
    from app.services.realtime import manager as message_ws
    from app.services.realtime.manager import MessageWsManager

    monkeypatch.setattr(settings, "telegram_realtime_mode", "polling")
    fresh_manager = MessageWsManager(max_connections_per_phone=10, ping_interval=60.0)
    monkeypatch.setattr(message_ws, "message_ws_manager", fresh_manager)
    monkeypatch.setattr("app.routers.dialogs.message_ws_manager", fresh_manager)

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
                "messages": [],
                "message": "OK",
            }
        if calls["count"] == 2:
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

    def mock_dialog_preview_from_row(row: dict) -> dict:
        return {
            "last_message": row["text"],
            "last_message_id": row["id"],
            "date": row["date"],
        }

    monkeypatch.setattr(
        telegram_dialog_service,
        "get_new_messages",
        mock_get_new_messages,
    )
    monkeypatch.setattr(
        telegram_dialog_service,
        "_dialog_preview_from_row",
        mock_dialog_preview_from_row,
    )
    monkeypatch.setattr(message_poll, "DEFAULT_POLL_INTERVAL", 0.01)

    with client.websocket_connect(
        "/api/dialogs/%2B84901234567/messages/ws",
        params={"peer_id": "123456789", "min_id": 1},
    ) as websocket:
        first = websocket.receive_json()
        if first["type"] == "connected":
            connected = first
            payload = websocket.receive_json()
        else:
            payload = first
            connected = websocket.receive_json()
        assert connected["type"] == "connected"
        assert connected["cursor"] == 1
        assert payload["type"] == "messages"
        assert payload["messages"][0]["id"] == 88
        assert payload["dialog_preview"]["peer_id"] == "123456789"


async def test_iter_dialog_message_poll(monkeypatch):
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
                "messages": [_sample_message(91)],
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
        telegram_dialog_service,
        "get_new_messages",
        mock_get_new_messages,
    )
    monkeypatch.setattr(
        telegram_dialog_service,
        "_dialog_preview_from_row",
        mock_dialog_preview_from_row,
    )
    monkeypatch.setattr(message_poll, "DEFAULT_POLL_INTERVAL", 0.01)

    payloads = []
    async for payload in message_poll.iter_dialog_message_poll(
        "+84901234567",
        "123456789",
        1,
    ):
        payloads.append(payload)
        if len(payloads) >= 2:
            break

    assert payloads[0]["type"] == "connected"
    assert payloads[1]["type"] == "messages"
    assert payloads[1]["messages"][0]["id"] == 91
    assert payloads[1]["dialog_preview"]["peer_id"] == "123456789"


async def test_mark_dialog_read_error(client, monkeypatch):
    async def mock_mark_dialog_read(phone: str, peer_id: str, max_id: int = 0):
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "read_inbox_max_id": 0,
            "unread_count": 0,
            "message": "Session chua dang nhap",
        }

    monkeypatch.setattr(
        telegram_dialog_service,
        "mark_dialog_read",
        mock_mark_dialog_read,
    )

    response = client.post(
        "/api/dialogs/%2B84901234567/read",
        json={"peer_id": "123456789", "max_id": 42},
    )

    body = response.json()
    assert body["success"] is True
    assert body["data"]["status"] == "error"
    assert body["data"]["message"] == "Session chua dang nhap"