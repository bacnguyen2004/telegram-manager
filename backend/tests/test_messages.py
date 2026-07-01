from app.services.telegram import messages


async def test_send_message_success(client, monkeypatch):
    async def mock_send_message(phone: str, peer_id: str, text: str) -> dict:
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": 42,
            "reply_to_msg_id": None,
            "message": "Da gui tin nhan",
        }

    monkeypatch.setattr(
        messages.telegram_message_service,
        "send_message",
        mock_send_message,
    )

    response = client.post(
        "/api/messages/send",
        json={
            "phone": "+84901234567",
            "peer_id": "123456789",
            "text": "Xin chao",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    data = body["data"]
    assert data["status"] == "success"
    assert data["phone"] == "+84901234567"
    assert data["peer_id"] == "123456789"
    assert data["message_id"] == 42


async def test_send_message_service_error(client, monkeypatch):
    async def mock_send_message(phone: str, peer_id: str, text: str) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": None,
            "reply_to_msg_id": None,
            "message": "Session chua dang nhap hoac da het han",
        }

    monkeypatch.setattr(
        messages.telegram_message_service,
        "send_message",
        mock_send_message,
    )

    response = client.post(
        "/api/messages/send",
        json={
            "phone": "+84901234567",
            "peer_id": "123456789",
            "text": "Xin chao",
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "error"
    assert "het han" in data["message"]


async def test_reply_message_success(client, monkeypatch):
    async def mock_reply_message(
        phone: str,
        peer_id: str,
        text: str,
        reply_to_msg_id: int,
    ) -> dict:
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": 99,
            "reply_to_msg_id": reply_to_msg_id,
            "message": "Da tra loi tin nhan",
        }

    monkeypatch.setattr(
        messages.telegram_message_service,
        "reply_message",
        mock_reply_message,
    )

    response = client.post(
        "/api/messages/reply",
        json={
            "phone": "+84901234567",
            "peer_id": "123456789",
            "reply_to_msg_id": 55,
            "text": "Tra loi day",
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "success"
    assert data["reply_to_msg_id"] == 55
    assert data["message_id"] == 99


async def test_delete_message_success(client, monkeypatch):
    async def mock_delete_message(phone: str, peer_id: str, message_id: int) -> dict:
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "message": "Da xoa tin nhan",
        }

    monkeypatch.setattr(
        messages.telegram_message_service,
        "delete_message",
        mock_delete_message,
    )

    response = client.delete(
        "/api/messages/55?phone=%2B84901234567&peer_id=123456789",
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "success"
    assert data["message_id"] == 55


async def test_send_media_success(client, monkeypatch):
    async def mock_send_media(
        phone: str,
        peer_id: str,
        file_bytes: bytes,
        filename: str,
        *,
        caption: str | None = None,
        reply_to_msg_id: int | None = None,
    ) -> dict:
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": 77,
            "reply_to_msg_id": reply_to_msg_id,
            "message": "Da gui anh",
        }

    monkeypatch.setattr(
        messages.telegram_message_service,
        "send_media",
        mock_send_media,
    )

    response = client.post(
        "/api/messages/send-media",
        data={
            "phone": "+84901234567",
            "peer_id": "123456789",
            "caption": "Xem anh nay",
            "reply_to_msg_id": "12",
        },
        files={"file": ("photo.jpg", b"fake-image-bytes", "image/jpeg")},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "success"
    assert data["message_id"] == 77
    assert data["reply_to_msg_id"] == 12


def test_send_media_rejects_non_image(client):
    response = client.post(
        "/api/messages/send-media",
        data={
            "phone": "+84901234567",
            "peer_id": "123456789",
        },
        files={"file": ("doc.pdf", b"%PDF", "application/pdf")},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "error"
    assert "JPEG" in data["message"]


async def test_send_reaction_success(client, monkeypatch):
    async def mock_send_reaction(
        phone: str, peer_id: str, message_id: int, emoji: str
    ) -> dict:
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "emoji": emoji,
            "message": "Da them reaction",
        }

    monkeypatch.setattr(
        messages.telegram_message_service,
        "send_reaction",
        mock_send_reaction,
    )

    response = client.post(
        "/api/messages/react",
        json={
            "phone": "+84901234567",
            "peer_id": "123456789",
            "message_id": 42,
            "emoji": "👍",
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "success"
    assert data["emoji"] == "👍"
    assert data["message_id"] == 42


async def test_send_reaction_not_allowed(client, monkeypatch):
    async def mock_send_reaction(
        phone: str, peer_id: str, message_id: int, emoji: str
    ) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "emoji": None,
            "message": "Group nay khong cho phep emoji nay. Duoc phep: 👍 ❤️",
        }

    monkeypatch.setattr(
        messages.telegram_message_service,
        "send_reaction",
        mock_send_reaction,
    )

    response = client.post(
        "/api/messages/react",
        json={
            "phone": "+84901234567",
            "peer_id": "123456789",
            "message_id": 42,
            "emoji": "🔥",
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "error"
    assert "khong cho phep" in data["message"].lower()


async def test_remove_reaction_success(client, monkeypatch):
    async def mock_remove_reaction(phone: str, peer_id: str, message_id: int) -> dict:
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "emoji": None,
            "message": "Da xoa reaction",
        }

    monkeypatch.setattr(
        messages.telegram_message_service,
        "remove_reaction",
        mock_remove_reaction,
    )

    response = client.delete(
        "/api/messages/react?phone=%2B84901234567&peer_id=123456789&message_id=42",
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "success"
    assert data["emoji"] is None


def test_send_message_validation_empty_text(client):
    response = client.post(
        "/api/messages/send",
        json={
            "phone": "+84901234567",
            "peer_id": "123456789",
            "text": "",
        },
    )

    assert response.status_code == 422
    body = response.json()
    assert body["success"] is False
    assert body["error"] == "Validation error"