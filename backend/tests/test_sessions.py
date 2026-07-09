def test_list_sessions_empty(client, test_paths):
    response = client.get("/api/sessions")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["total"] == 0
    assert body["data"]["sessions"] == []


def test_list_sessions_with_files(client, test_paths):
    session_dir = test_paths["session_dir"]
    (session_dir / "+84901234567.session").write_bytes(b"fake-session")
    (session_dir / "+84334668651.session").write_bytes(b"fake-session")

    response = client.get("/api/sessions")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["total"] == 2
    assert "+84334668651" in data["sessions"]
    assert "+84901234567" in data["sessions"]


def test_get_session_not_found(client):
    response = client.get("/api/sessions/%2B84909999999")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "not_found"
    assert data["exists"] is False


def test_list_authorizations_session_not_found(client):
    response = client.get("/api/sessions/%2B84909999999/authorizations")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "error"
    assert data["total"] == 0
    assert data["items"] == []


def test_auth_timestamp_accepts_datetime():
    from datetime import datetime, timezone

    from app.services.telegram.accounts import TelegramSessionService

    value = datetime(2026, 7, 1, 10, 0, 0, tzinfo=timezone.utc)
    assert TelegramSessionService._auth_timestamp(value) == "2026-07-01T10:00:00+00:00"
    assert TelegramSessionService._auth_timestamp(1_700_000_000) == "2023-11-14T22:13:20+00:00"


def test_image_file_suffix_from_magic_bytes():
    from app.services.telegram.accounts import TelegramSessionService

    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    jpg = b"\xff\xd8\xff\xe0" + b"\x00" * 16
    webp = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 8
    assert TelegramSessionService._image_file_suffix(png) == ".png"
    assert TelegramSessionService._image_file_suffix(jpg) == ".jpg"
    assert TelegramSessionService._image_file_suffix(webp) == ".webp"


async def test_list_authorizations_success(client, test_paths, monkeypatch):
    from app.services.telegram import telegram_session_service

    phone = "+84901234567"
    (test_paths["session_dir"] / f"{phone}.session").write_bytes(b"fake-session")

    async def mock_list_authorizations(target_phone: str) -> dict:
        return {
            "status": "success",
            "phone": target_phone,
            "total": 2,
            "items": [
                {
                    "hash": "111",
                    "current": True,
                    "device_model": "PC",
                    "platform": "Windows",
                    "app_name": "Telegram Manager",
                    "date_active": "2026-07-01T10:00:00+00:00",
                },
                {
                    "hash": "222",
                    "current": False,
                    "device_model": "iPhone",
                    "platform": "iOS",
                    "app_name": "Telegram iOS",
                    "date_active": "2026-06-30T08:00:00+00:00",
                },
            ],
            "message": "OK",
        }

    monkeypatch.setattr(
        telegram_session_service,
        "list_authorizations",
        mock_list_authorizations,
    )

    response = client.get("/api/sessions/%2B84901234567/authorizations")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    data = body["data"]
    assert data["status"] == "success"
    assert data["total"] == 2
    assert len(data["items"]) == 2
    assert data["items"][0]["current"] is True


async def test_revoke_authorization_success(client, test_paths, monkeypatch):
    from app.services.telegram import telegram_session_service

    phone = "+84901234567"
    (test_paths["session_dir"] / f"{phone}.session").write_bytes(b"fake-session")

    async def mock_revoke_authorization(target_phone: str, auth_hash: str) -> dict:
        return {
            "status": "success",
            "phone": target_phone,
            "hash": auth_hash,
            "message": "Da dang xuat thiet bi",
        }

    monkeypatch.setattr(
        telegram_session_service,
        "revoke_authorization",
        mock_revoke_authorization,
    )

    response = client.delete("/api/sessions/%2B84901234567/authorizations/222")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "success"
    assert data["hash"] == "222"


def test_get_session_avatar_not_found(client):
    response = client.get("/api/sessions/%2B84909999999/avatar")

    assert response.status_code == 404


async def test_update_session_profile_success(client, test_paths, monkeypatch):
    from app.services.telegram import telegram_session_service

    phone = "+84901234567"
    (test_paths["session_dir"] / f"{phone}.session").write_bytes(b"fake-session")

    async def mock_update_profile(
        target_phone: str,
        *,
        first_name: str,
        last_name: str,
        username: str,
        about: str,
    ) -> dict:
        return {
            "status": "success",
            "phone": target_phone,
            "me_id": 123,
            "first_name": first_name,
            "last_name": last_name,
            "username": username or None,
            "about": about,
            "has_avatar": False,
            "message": "OK",
        }

    monkeypatch.setattr(
        telegram_session_service,
        "update_profile",
        mock_update_profile,
    )

    response = client.patch(
        "/api/sessions/%2B84901234567/profile",
        json={
            "first_name": "Nguyen",
            "last_name": "Van A",
            "username": "nguyenvana",
            "about": "Hello from tool",
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "success"
    assert data["first_name"] == "Nguyen"
    assert data["username"] == "nguyenvana"
    assert data["about"] == "Hello from tool"


def test_get_session_avatar_success(client, test_paths):
    from app.db import metadata_store

    phone = "+84901234567"
    session_dir = test_paths["session_dir"]
    (session_dir / f"{phone}.session").write_bytes(b"fake-session")

    avatar_dir = test_paths["session_dir"].parent / "avatars"
    avatar_dir.mkdir(parents=True, exist_ok=True)
    avatar_file = avatar_dir / "+84901234567.jpg"
    avatar_file.write_bytes(b"\xff\xd8\xff fake-jpeg")

    metadata_store.sync_session(
        phone,
        telegram_user_id=123,
        username="testuser",
        display_name="Test User",
        status="active",
        source="imported",
        has_avatar=True,
        avatar_path=str(avatar_file),
    )

    response = client.get("/api/sessions/%2B84901234567/avatar")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/jpeg")
    assert response.content == avatar_file.read_bytes()


async def test_revoke_authorization_error(client, test_paths, monkeypatch):
    from app.services.telegram import telegram_session_service

    phone = "+84901234567"
    (test_paths["session_dir"] / f"{phone}.session").write_bytes(b"fake-session")

    async def mock_revoke_authorization(target_phone: str, auth_hash: str) -> dict:
        return {
            "status": "error",
            "phone": target_phone,
            "hash": auth_hash,
            "message": "Khong tim thay phien",
        }

    monkeypatch.setattr(
        telegram_session_service,
        "revoke_authorization",
        mock_revoke_authorization,
    )

    response = client.delete("/api/sessions/%2B84901234567/authorizations/missing")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "error"
    assert "Khong tim thay" in data["message"]