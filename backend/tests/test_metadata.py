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


def test_list_audit_logs_and_group_scans(client):
    phone = "+84901230000"
    metadata_store.record_login(
        phone,
        telegram_user_id=42,
        username="audit_user",
        first_name="Audit",
        last_name="User",
    )
    metadata_store.record_group_scan(
        phone,
        [{"is_channel": False, "title": "G1"}, {"is_channel": True, "title": "C1"}],
    )

    audit_res = client.get("/api/metadata/audit", params={"phone": phone, "limit": 10})
    assert audit_res.status_code == 200
    audit_body = audit_res.json()
    assert audit_body["success"] is True
    assert audit_body["data"]["database_enabled"] is True
    assert audit_body["data"]["total"] >= 2
    assert any(item["action"] == "auth.login" for item in audit_body["data"]["items"])

    scan_res = client.get("/api/metadata/group-scans", params={"phone": phone, "limit": 5})
    assert scan_res.status_code == 200
    scan_body = scan_res.json()
    assert scan_body["success"] is True
    assert scan_body["data"]["items"][0]["total"] == 2

    overview_res = client.get("/api/metadata/overview")
    assert overview_res.status_code == 200
    overview_body = overview_res.json()
    assert overview_body["data"]["session_meta_count"] >= 1
    assert overview_body["data"]["audit_log_count"] >= 2

    sessions_res = client.get("/api/metadata/sessions")
    assert sessions_res.status_code == 200
    sessions_body = sessions_res.json()
    assert any(item["phone"] == phone for item in sessions_body["data"]["items"])


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