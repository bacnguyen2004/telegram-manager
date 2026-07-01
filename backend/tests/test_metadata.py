import pytest
from sqlmodel import Session, select

from app.config import settings
from app.db import metadata_store
from app.db.engine import get_engine, init_db, reset_engine
from app.db.models import AuditLog, GroupScan, SessionMeta


@pytest.fixture(autouse=True)
def metadata_db(tmp_path, monkeypatch):
    db_file = tmp_path / "metadata_test.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{db_file.as_posix()}")
    monkeypatch.setattr(settings, "database_enabled", True)
    reset_engine()
    init_db()


def test_record_login_creates_session_meta():
    metadata_store.record_login(
        "+84901112233",
        telegram_user_id=12345,
        username="demo_user",
        first_name="Demo",
        last_name="User",
    )

    with Session(get_engine()) as session:
        row = session.get(SessionMeta, "+84901112233")
        assert row is not None
        assert row.telegram_user_id == 12345
        assert row.username == "demo_user"
        assert row.display_name == "Demo User"
        assert row.source == "otp_login"
        assert row.status == "active"

        audits = session.exec(
            select(AuditLog).where(AuditLog.phone == "+84901112233")
        ).all()
        assert len(audits) == 1
        assert audits[0].action == "auth.login"


def test_sync_session_updates_existing_row():
    phone = "+84909998877"
    metadata_store.sync_session(
        phone,
        telegram_user_id=99,
        username="repeat",
        display_name="A B",
        status="active",
        source="imported",
    )
    first_synced = None
    with Session(get_engine()) as session:
        row = session.get(SessionMeta, phone)
        assert row is not None
        assert row.source == "imported"
        first_synced = row.last_synced_at

    metadata_store.sync_session(
        phone,
        telegram_user_id=99,
        username="repeat_new",
        display_name="A B",
        status="active",
        source="imported",
    )

    with Session(get_engine()) as session:
        row = session.get(SessionMeta, phone)
        assert row is not None
        assert row.username == "repeat_new"
        assert row.last_synced_at >= first_synced

        audits = session.exec(select(AuditLog).where(AuditLog.phone == phone)).all()
        actions = [item.action for item in audits]
        assert "sessions.import" in actions
        assert "sessions.sync" in actions


def test_record_group_scan_and_snapshot():
    phone = "+84901234567"
    metadata_store.sync_session(
        phone,
        telegram_user_id=1,
        username="scan_user",
        display_name="Scan",
        status="active",
        source="imported",
    )
    metadata_store.record_group_scan(
        phone,
        [
            {"is_channel": False, "title": "Group A"},
            {"is_channel": True, "title": "Channel B"},
        ],
    )

    snapshot = metadata_store.get_session_snapshot(phone)
    assert snapshot is not None
    assert snapshot["status"] == "active"
    assert snapshot["source"] == "imported"
    assert snapshot["last_group_scan"]["total"] == 2
    assert snapshot["last_group_scan"]["group_count"] == 1
    assert snapshot["last_group_scan"]["channel_count"] == 1
    assert len(snapshot["recent_audit"]) >= 2

    with Session(get_engine()) as session:
        scans = session.exec(select(GroupScan).where(GroupScan.phone == phone)).all()
        assert len(scans) == 1


def test_remove_session_meta_keeps_audit_history():
    phone = "+84907654321"
    metadata_store.sync_session(
        phone,
        telegram_user_id=7,
        username=None,
        display_name="X",
        status="active",
        source="imported",
    )
    metadata_store.record_audit(
        phone,
        action="sessions.delete",
        resource=phone,
        status="success",
    )
    metadata_store.remove_session_meta(phone)

    with Session(get_engine()) as session:
        assert session.get(SessionMeta, phone) is None
        audits = session.exec(select(AuditLog).where(AuditLog.phone == phone)).all()
        assert len(audits) >= 2