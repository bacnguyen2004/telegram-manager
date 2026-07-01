import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session, select

from ..config import settings
from .engine import get_engine
from .models import AuditLog, GroupScan, SessionMeta, utc_now


logger = logging.getLogger(__name__)


class MetadataStore:
    """Persist business metadata in PostgreSQL (Telethon .session stays on disk)."""

    def _session(self) -> Session:
        return Session(get_engine())

    def _run(self, action: str, callback) -> None:
        if not settings.database_enabled:
            return
        try:
            with self._session() as session:
                callback(session)
                session.commit()
        except Exception:
            logger.exception("MetadataStore.%s failed", action)

    def sync_session(
        self,
        phone: str,
        *,
        telegram_user_id: int | None,
        username: str | None,
        display_name: str | None,
        status: str,
        source: str = "imported",
        last_error: str | None = None,
        has_avatar: bool = False,
        avatar_path: str | None = None,
        audit_action: str | None = None,
    ) -> None:
        phone = phone.strip()
        if not phone:
            return
        now = utc_now()

        def _write(db: Session) -> None:
            row = db.get(SessionMeta, phone)
            is_new = row is None
            if is_new:
                row = SessionMeta(
                    phone=phone,
                    source=source,
                    imported_at=now,
                )
            else:
                row.source = source

            row.telegram_user_id = telegram_user_id
            row.username = username
            row.display_name = display_name
            row.status = status
            row.last_synced_at = now
            row.last_error = last_error
            row.has_avatar = has_avatar
            row.avatar_path = avatar_path
            if has_avatar and avatar_path:
                row.avatar_updated_at = now

            db.add(row)

            if audit_action is None:
                audit_action_name = "sessions.import" if is_new else "sessions.sync"
            else:
                audit_action_name = audit_action

            self._append_audit(
                db,
                phone=phone,
                action=audit_action_name,
                resource=phone,
                status="success" if status == "active" else status,
                detail={
                    "telegram_user_id": telegram_user_id,
                    "username": username,
                    "source": source,
                },
            )

        self._run("sync_session", _write)

    def record_login(
        self,
        phone: str,
        *,
        telegram_user_id: int | None,
        username: str | None,
        first_name: str | None,
        last_name: str | None,
    ) -> None:
        display_name = " ".join(
            part for part in [first_name or "", last_name or ""] if part
        ).strip() or None

        self.sync_session(
            phone,
            telegram_user_id=telegram_user_id,
            username=username,
            display_name=display_name,
            status="active",
            source="otp_login",
            last_error=None,
            audit_action="auth.login",
        )

    def record_group_scan(self, phone: str, groups: list[dict[str, Any]]) -> None:
        phone = phone.strip()
        if not phone:
            return

        group_count = sum(1 for item in groups if not item.get("is_channel"))
        channel_count = sum(1 for item in groups if item.get("is_channel"))
        total = len(groups)

        def _write(db: Session) -> None:
            db.add(
                GroupScan(
                    phone=phone,
                    total=total,
                    group_count=group_count,
                    channel_count=channel_count,
                    scanned_at=utc_now(),
                )
            )
            self._append_audit(
                db,
                phone=phone,
                action="groups.scan",
                resource=phone,
                status="success",
                detail={
                    "total": total,
                    "group_count": group_count,
                    "channel_count": channel_count,
                },
            )

        self._run("record_group_scan", _write)

    def record_audit(
        self,
        phone: str,
        *,
        action: str,
        status: str,
        resource: str | None = None,
        detail: dict[str, Any] | str | None = None,
    ) -> None:
        phone = phone.strip()
        if not phone:
            return

        def _write(db: Session) -> None:
            self._append_audit(
                db,
                phone=phone,
                action=action,
                resource=resource,
                status=status,
                detail=detail,
            )

        self._run("record_audit", _write)

    def remove_session_meta(self, phone: str) -> None:
        phone = phone.strip()
        if not phone:
            return

        def _write(db: Session) -> None:
            row = db.get(SessionMeta, phone)
            if row is not None:
                db.delete(row)

        self._run("remove_session_meta", _write)

    def list_audit_logs(
        self,
        *,
        phone: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        if not settings.database_enabled:
            return {
                "database_enabled": False,
                "total": 0,
                "limit": limit,
                "offset": offset,
                "items": [],
            }

        phone = (phone or "").strip() or None
        limit = max(1, min(limit, 200))
        offset = max(0, offset)

        try:
            with self._session() as session:
                statement = select(AuditLog)
                if phone:
                    statement = statement.where(AuditLog.phone == phone)
                statement = statement.order_by(AuditLog.created_at.desc())

                rows = session.exec(statement).all()
                total = len(rows)
                page = rows[offset : offset + limit]

                return {
                    "database_enabled": True,
                    "total": total,
                    "limit": limit,
                    "offset": offset,
                    "items": [
                        {
                            "id": item.id,
                            "phone": item.phone,
                            "action": item.action,
                            "resource": item.resource,
                            "status": item.status,
                            "detail": item.detail,
                            "created_at": _iso(item.created_at),
                        }
                        for item in page
                        if item.id is not None
                    ],
                }
        except Exception:
            logger.exception("MetadataStore.list_audit_logs failed")
            return {
                "database_enabled": True,
                "total": 0,
                "limit": limit,
                "offset": offset,
                "items": [],
            }

    def list_group_scans(
        self,
        *,
        phone: str | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        if not settings.database_enabled:
            return {"database_enabled": False, "total": 0, "limit": limit, "items": []}

        phone = (phone or "").strip() or None
        limit = max(1, min(limit, 100))

        try:
            with self._session() as session:
                statement = select(GroupScan)
                if phone:
                    statement = statement.where(GroupScan.phone == phone)
                statement = statement.order_by(GroupScan.scanned_at.desc())

                rows = session.exec(statement).all()
                total = len(rows)
                page = rows[:limit]

                return {
                    "database_enabled": True,
                    "total": total,
                    "limit": limit,
                    "items": [
                        {
                            "id": item.id,
                            "phone": item.phone,
                            "total": item.total,
                            "group_count": item.group_count,
                            "channel_count": item.channel_count,
                            "scanned_at": _iso(item.scanned_at),
                        }
                        for item in page
                        if item.id is not None
                    ],
                }
        except Exception:
            logger.exception("MetadataStore.list_group_scans failed")
            return {"database_enabled": True, "total": 0, "limit": limit, "items": []}

    def list_session_meta_overview(self) -> dict[str, Any]:
        if not settings.database_enabled:
            return {"database_enabled": False, "total": 0, "items": []}

        try:
            with self._session() as session:
                metas = session.exec(
                    select(SessionMeta).order_by(SessionMeta.phone.asc())
                ).all()
                items: list[dict[str, Any]] = []
                for meta in metas:
                    last_scan = session.exec(
                        select(GroupScan)
                        .where(GroupScan.phone == meta.phone)
                        .order_by(GroupScan.scanned_at.desc())
                        .limit(1)
                    ).first()
                    items.append(
                        {
                            "phone": meta.phone,
                            "username": meta.username,
                            "display_name": meta.display_name,
                            "status": meta.status,
                            "source": meta.source,
                            "last_synced_at": _iso(meta.last_synced_at),
                            "last_group_scan": (
                                {
                                    "total": last_scan.total,
                                    "group_count": last_scan.group_count,
                                    "channel_count": last_scan.channel_count,
                                    "scanned_at": _iso(last_scan.scanned_at),
                                }
                                if last_scan
                                else None
                            ),
                        }
                    )
                return {
                    "database_enabled": True,
                    "total": len(items),
                    "items": items,
                }
        except Exception:
            logger.exception("MetadataStore.list_session_meta_overview failed")
            return {"database_enabled": True, "total": 0, "items": []}

    def get_overview(self) -> dict[str, Any]:
        if not settings.database_enabled:
            return {
                "database_enabled": False,
                "session_meta_count": 0,
                "audit_log_count": 0,
                "group_scan_count": 0,
                "recent_audit": [],
            }

        try:
            with self._session() as session:
                session_meta_count = len(session.exec(select(SessionMeta)).all())
                audit_log_count = len(session.exec(select(AuditLog)).all())
                group_scan_count = len(session.exec(select(GroupScan)).all())
                recent = session.exec(
                    select(AuditLog).order_by(AuditLog.created_at.desc()).limit(10)
                ).all()
                return {
                    "database_enabled": True,
                    "session_meta_count": session_meta_count,
                    "audit_log_count": audit_log_count,
                    "group_scan_count": group_scan_count,
                    "recent_audit": [
                        {
                            "id": item.id,
                            "phone": item.phone,
                            "action": item.action,
                            "resource": item.resource,
                            "status": item.status,
                            "detail": item.detail,
                            "created_at": _iso(item.created_at),
                        }
                        for item in recent
                        if item.id is not None
                    ],
                }
        except Exception:
            logger.exception("MetadataStore.get_overview failed")
            return {
                "database_enabled": True,
                "session_meta_count": 0,
                "audit_log_count": 0,
                "group_scan_count": 0,
                "recent_audit": [],
            }

    def get_session_snapshot(self, phone: str) -> dict[str, Any] | None:
        if not settings.database_enabled:
            return None

        phone = phone.strip()
        if not phone:
            return None

        try:
            with self._session() as session:
                meta = session.get(SessionMeta, phone)
                if meta is None:
                    return None

                last_scan = session.exec(
                    select(GroupScan)
                    .where(GroupScan.phone == phone)
                    .order_by(GroupScan.scanned_at.desc())
                    .limit(1)
                ).first()

                recent_audit = session.exec(
                    select(AuditLog)
                    .where(AuditLog.phone == phone)
                    .order_by(AuditLog.created_at.desc())
                    .limit(5)
                ).all()

                return {
                    "telegram_user_id": meta.telegram_user_id,
                    "username": meta.username,
                    "display_name": meta.display_name,
                    "source": meta.source,
                    "status": meta.status,
                    "imported_at": _iso(meta.imported_at),
                    "last_synced_at": _iso(meta.last_synced_at),
                    "last_error": meta.last_error,
                    "has_avatar": meta.has_avatar,
                    "avatar_path": meta.avatar_path,
                    "avatar_updated_at": _iso(meta.avatar_updated_at),
                    "last_group_scan": (
                        {
                            "total": last_scan.total,
                            "group_count": last_scan.group_count,
                            "channel_count": last_scan.channel_count,
                            "scanned_at": _iso(last_scan.scanned_at),
                        }
                        if last_scan
                        else None
                    ),
                    "recent_audit": [
                        {
                            "action": item.action,
                            "resource": item.resource,
                            "status": item.status,
                            "created_at": _iso(item.created_at),
                        }
                        for item in recent_audit
                    ],
                }
        except Exception:
            logger.exception("MetadataStore.get_session_snapshot failed")
            return None

    @staticmethod
    def _append_audit(
        db: Session,
        *,
        phone: str,
        action: str,
        status: str,
        resource: str | None = None,
        detail: dict[str, Any] | str | None = None,
    ) -> None:
        detail_text: str | None
        if detail is None:
            detail_text = None
        elif isinstance(detail, str):
            detail_text = detail[:2000]
        else:
            detail_text = json.dumps(detail, ensure_ascii=False)[:2000]

        db.add(
            AuditLog(
                phone=phone,
                action=action,
                resource=resource,
                status=status,
                detail=detail_text,
                created_at=utc_now(),
            )
        )


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


metadata_store = MetadataStore()