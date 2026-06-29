from app.services.telegram import messages


async def test_send_message_success(client, monkeypatch):
    async def mock_send_message(phone: str, peer_id: str, text: str) -> dict:
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": 42,
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