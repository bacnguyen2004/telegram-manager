from app.services.telegram import dialogs


async def test_get_message_photo_success(client, monkeypatch):
    async def mock_get_message_photo(phone: str, peer_id: str, message_id: int):
        return b"\xff\xd8\xff fake-jpeg", "image/jpeg"

    monkeypatch.setattr(
        dialogs.telegram_dialog_service,
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
        dialogs.telegram_dialog_service,
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
        dialogs.telegram_dialog_service,
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
    ):
        captured["offset_id"] = offset_id
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
        dialogs.telegram_dialog_service,
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
        dialogs.telegram_dialog_service,
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
        dialogs.telegram_dialog_service,
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
        dialogs.telegram_dialog_service,
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