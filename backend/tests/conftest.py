import pytest
from fastapi.testclient import TestClient

from app.config import session_lock, settings
from app.db import init_db, reset_engine
from app.main import app
from app.services.telegram import auth, dialogs, groups, messages, sessions


TELEGRAM_SERVICES = (
    sessions.telegram_session_service,
    auth.telegram_auth_service,
    groups.telegram_group_service,
    dialogs.telegram_dialog_service,
    messages.telegram_message_service,
)


@pytest.fixture
def test_paths(tmp_path, monkeypatch):
    session_dir = tmp_path / "sessions"
    lock_dir = tmp_path / "locks"
    session_dir.mkdir()
    lock_dir.mkdir()

    monkeypatch.setattr(settings, "telegram_api_id", 123456)
    monkeypatch.setattr(settings, "telegram_api_hash", "test_api_hash")
    monkeypatch.setattr(settings, "session_dir", session_dir)
    monkeypatch.setattr(settings, "session_lock_dir", lock_dir)
    monkeypatch.setattr(session_lock, "lock_dir", lock_dir)

    db_file = tmp_path / "test.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{db_file.as_posix()}")
    monkeypatch.setattr(settings, "database_enabled", True)
    monkeypatch.setattr(settings, "telegram_listener_enabled", False)
    monkeypatch.setattr(settings, "telegram_realtime_mode", "polling")
    reset_engine()
    init_db()

    for service in TELEGRAM_SERVICES:
        monkeypatch.setattr(service, "session_dir", session_dir)
        monkeypatch.setattr(service, "api_id", 123456)
        monkeypatch.setattr(service, "api_hash", "test_api_hash")

    return {"session_dir": session_dir, "lock_dir": lock_dir}


@pytest.fixture
def client(test_paths):
    with TestClient(app) as test_client:
        yield test_client