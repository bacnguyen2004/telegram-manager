from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from telethon.tl import types

from app.config import settings
from app.schemas.auth import LoginData, SendCodeData
from app.services.telegram import telegram_auth_service
from app.services.telegram.client.pool import telethon_client_pool


def test_login_data_accepts_need_signup():
    data = LoginData(
        status="need_signup",
        message="So chua co tai khoan",
        phone="+84901234567",
    )
    assert data.status == "need_signup"


def test_send_code_success_message():
    data = SendCodeData(
        status="success",
        message="Da gui ma OTP qua Telegram app. Nhap ma o buoc tiep theo.",
        phone="+84901234567",
    )
    assert "Nhap ma" in data.message


def _fake_me(**kwargs):
    defaults = {
        "id": 42,
        "first_name": "Test",
        "last_name": "User",
        "username": "tester",
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


class _PendingClientCtx:
    def __init__(self, client):
        self.client = client

    async def __aenter__(self):
        return self.client

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.fixture
def auth_service(test_paths, monkeypatch, tmp_path):
    pending = tmp_path / "pending_auth"
    pending.mkdir()
    monkeypatch.setattr(telegram_auth_service, "pending_auth_dir", pending)
    return telegram_auth_service


@pytest.mark.asyncio
async def test_send_code_works_when_listener_enabled(test_paths, monkeypatch, auth_service):
    """Default production path: listener on, pool would reject missing session."""
    phone = "+84901234567"
    monkeypatch.setattr(settings, "telegram_listener_enabled", True)

    fake_client = MagicMock()
    fake_client.is_user_authorized = AsyncMock(return_value=False)
    fake_client.send_code_request = AsyncMock(
        return_value=SimpleNamespace(phone_code_hash="hash-abc")
    )

    ensure_spy = AsyncMock(
        side_effect=FileNotFoundError("pool should not be used for pending auth")
    )
    monkeypatch.setattr(telethon_client_pool, "ensure_connected", ensure_spy)

    with patch(
        "app.services.telegram.accounts.auth.pending_auth_session",
        lambda *a, **k: _PendingClientCtx(fake_client),
    ):
        result = await auth_service.send_code(phone)

    assert result["status"] == "success"
    assert result["phone"] == phone
    assert auth_service._load_phone_code_hash(phone) == "hash-abc"
    ensure_spy.assert_not_awaited()
    fake_client.send_code_request.assert_awaited_once_with(phone)


@pytest.mark.asyncio
async def test_login_signs_in_via_pending_auth(test_paths, monkeypatch, auth_service):
    phone = "+84901234567"
    monkeypatch.setattr(settings, "telegram_listener_enabled", True)

    session_file = test_paths["session_dir"] / f"{phone}.session"
    session_file.write_bytes(b"")
    auth_service._save_phone_code_hash(phone, "hash-xyz")

    me = _fake_me()
    fake_client = MagicMock()
    fake_client.is_user_authorized = AsyncMock(return_value=False)
    fake_client.sign_in = AsyncMock()
    fake_client.get_me = AsyncMock(return_value=me)

    with patch(
        "app.services.telegram.accounts.auth.pending_auth_session",
        lambda *a, **k: _PendingClientCtx(fake_client),
    ):
        with patch.object(auth_service, "_persist_login"):
            result = await auth_service.login(phone, "12345")

    assert result["status"] == "success"
    assert result["first_name"] == "Test"
    fake_client.sign_in.assert_awaited_once_with(
        phone, "12345", phone_code_hash="hash-xyz"
    )
    assert auth_service._load_phone_code_hash(phone) is None


@pytest.mark.asyncio
async def test_register_success_with_authorization_type(
    test_paths, monkeypatch, auth_service
):
    phone = "+84901234567"
    monkeypatch.setattr(settings, "telegram_listener_enabled", True)

    session_file = test_paths["session_dir"] / f"{phone}.session"
    session_file.write_bytes(b"")
    auth_service._save_phone_code_hash(phone, "hash-reg")

    from telethon.tl.types import User

    me = _fake_me(first_name="Nguyen", last_name="A", username="")
    user = User(id=99, first_name="Nguyen", last_name="A")
    auth_result = types.auth.Authorization(user=user)

    fake_client = AsyncMock()
    fake_client.is_user_authorized = AsyncMock(return_value=False)
    fake_client.return_value = auth_result  # await client(SignUpRequest(...))
    fake_client._on_login = AsyncMock()
    fake_client.get_me = AsyncMock(return_value=me)

    with patch(
        "app.services.telegram.accounts.auth.pending_auth_session",
        lambda *a, **k: _PendingClientCtx(fake_client),
    ):
        with patch.object(auth_service, "_persist_login"):
            result = await auth_service.register(phone, "12345", "Nguyen", "A")

    assert result["status"] == "success", result
    assert "Dang ky" in result["message"]
    assert result["first_name"] == "Nguyen"
    fake_client._on_login.assert_awaited_once_with(user)
