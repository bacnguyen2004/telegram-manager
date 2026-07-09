"""CRUD + assignment for Telethon proxies."""
from __future__ import annotations

import logging
from typing import Any

from sqlmodel import Session, col, func, select

from ..config import settings
from .engine import get_engine
from .models import Proxy, SessionMeta, utc_now

logger = logging.getLogger(__name__)

PROXY_TYPES = frozenset({"socks5", "http", "mtproto"})


def _iso(value) -> str | None:
    if value is None:
        return None
    return value.isoformat()


class ProxyStore:
    def _session(self) -> Session:
        return Session(get_engine())

    @property
    def database_enabled(self) -> bool:
        return bool(settings.database_enabled)

    def list_proxies(self) -> dict[str, Any]:
        if not self.database_enabled:
            return {"database_enabled": False, "total": 0, "proxies": []}

        with self._session() as db:
            rows = list(db.exec(select(Proxy).order_by(col(Proxy.id).desc())).all())
            counts: dict[int, int] = {}
            if rows:
                ids = [int(r.id) for r in rows if r.id is not None]
                if ids:
                    stmt = (
                        select(SessionMeta.proxy_id, func.count())
                        .where(col(SessionMeta.proxy_id).in_(ids))
                        .group_by(SessionMeta.proxy_id)
                    )
                    for proxy_id, count in db.exec(stmt).all():
                        if proxy_id is not None:
                            counts[int(proxy_id)] = int(count)

            return {
                "database_enabled": True,
                "total": len(rows),
                "proxies": [self._to_item(row, counts.get(int(row.id or 0), 0)) for row in rows],
            }

    def get_proxy(self, proxy_id: int, *, reveal_secret: bool = False) -> dict[str, Any] | None:
        if not self.database_enabled:
            return None
        with self._session() as db:
            row = db.get(Proxy, proxy_id)
            if row is None:
                return None
            assigned = self._assigned_count(db, proxy_id)
            item = self._to_item(row, assigned)
            if reveal_secret:
                item["password"] = row.password or ""
                item["secret"] = row.secret or ""
            return item

    def create_proxy(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        if not self.database_enabled:
            return None
        now = utc_now()
        row = Proxy(
            name=str(payload["name"]).strip(),
            proxy_type=str(payload["proxy_type"]).strip().lower(),
            host=str(payload["host"]).strip(),
            port=int(payload["port"]),
            username=(str(payload.get("username") or "").strip() or None),
            password=(str(payload.get("password") or "").strip() or None),
            secret=(str(payload.get("secret") or "").strip() or None),
            enabled=bool(payload.get("enabled", True)),
            created_at=now,
            updated_at=now,
        )
        with self._session() as db:
            db.add(row)
            db.commit()
            db.refresh(row)
            return self._to_item(row, 0)

    def update_proxy(self, proxy_id: int, payload: dict[str, Any]) -> dict[str, Any] | None:
        if not self.database_enabled:
            return None
        with self._session() as db:
            row = db.get(Proxy, proxy_id)
            if row is None:
                return None

            if "name" in payload and payload["name"] is not None:
                row.name = str(payload["name"]).strip()
            if "proxy_type" in payload and payload["proxy_type"] is not None:
                row.proxy_type = str(payload["proxy_type"]).strip().lower()
            if "host" in payload and payload["host"] is not None:
                row.host = str(payload["host"]).strip()
            if "port" in payload and payload["port"] is not None:
                row.port = int(payload["port"])
            if "username" in payload:
                raw = payload["username"]
                row.username = (str(raw).strip() or None) if raw is not None else None
            if "password" in payload and payload["password"] is not None:
                # empty string keeps existing password; non-empty replaces
                text = str(payload["password"])
                if text != "":
                    row.password = text.strip() or None
            if "secret" in payload and payload["secret"] is not None:
                text = str(payload["secret"])
                if text != "":
                    row.secret = text.strip() or None
            if "enabled" in payload and payload["enabled"] is not None:
                row.enabled = bool(payload["enabled"])

            row.updated_at = utc_now()
            db.add(row)
            db.commit()
            db.refresh(row)
            assigned = self._assigned_count(db, proxy_id)
            return self._to_item(row, assigned)

    def delete_proxy(self, proxy_id: int) -> dict[str, Any] | None:
        if not self.database_enabled:
            return None
        with self._session() as db:
            row = db.get(Proxy, proxy_id)
            if row is None:
                return None
            phones = list(
                db.exec(
                    select(SessionMeta.phone).where(SessionMeta.proxy_id == proxy_id)
                ).all()
            )
            for phone in phones:
                meta = db.get(SessionMeta, phone)
                if meta is not None:
                    meta.proxy_id = None
                    db.add(meta)
            db.delete(row)
            db.commit()
            return {"id": proxy_id, "cleared_phones": list(phones)}

    def set_check_result(
        self,
        proxy_id: int,
        *,
        status: str,
        message: str,
    ) -> dict[str, Any] | None:
        if not self.database_enabled:
            return None
        with self._session() as db:
            row = db.get(Proxy, proxy_id)
            if row is None:
                return None
            row.last_check_status = status
            row.last_check_message = (message or "")[:500]
            row.last_check_at = utc_now()
            row.updated_at = utc_now()
            db.add(row)
            db.commit()
            db.refresh(row)
            assigned = self._assigned_count(db, proxy_id)
            return self._to_item(row, assigned)

    def list_assignments(self) -> dict[str, Any]:
        if not self.database_enabled:
            return {"database_enabled": False, "assignments": []}
        with self._session() as db:
            metas = list(
                db.exec(
                    select(SessionMeta).where(col(SessionMeta.proxy_id).is_not(None))
                ).all()
            )
            proxy_ids = {int(m.proxy_id) for m in metas if m.proxy_id is not None}
            proxies: dict[int, Proxy] = {}
            if proxy_ids:
                for row in db.exec(select(Proxy).where(col(Proxy.id).in_(list(proxy_ids)))).all():
                    if row.id is not None:
                        proxies[int(row.id)] = row

            assignments = []
            for meta in metas:
                pid = int(meta.proxy_id) if meta.proxy_id is not None else None
                proxy = proxies.get(pid) if pid is not None else None
                assignments.append(
                    {
                        "phone": meta.phone,
                        "proxy_id": pid,
                        "proxy_name": proxy.name if proxy else None,
                        "proxy_type": proxy.proxy_type if proxy else None,
                        "proxy_host": proxy.host if proxy else None,
                        "proxy_port": proxy.port if proxy else None,
                    }
                )
            return {"database_enabled": True, "assignments": assignments}

    def assign_phone(self, phone: str, proxy_id: int | None) -> dict[str, Any] | None:
        if not self.database_enabled:
            return None
        phone = phone.strip()
        if not phone:
            return None

        with self._session() as db:
            if proxy_id is not None:
                proxy = db.get(Proxy, proxy_id)
                if proxy is None:
                    return {"status": "error", "message": "Proxy khong ton tai"}

            meta = db.get(SessionMeta, phone)
            if meta is None:
                meta = SessionMeta(phone=phone, source="imported", status="unknown")
            meta.proxy_id = proxy_id
            db.add(meta)
            db.commit()
            return {
                "status": "success",
                "phone": phone,
                "proxy_id": proxy_id,
            }

    def assign_bulk(
        self,
        phones: list[str],
        proxy_id: int | None,
        *,
        mode: str = "same",
        proxy_ids: list[int] | None = None,
    ) -> dict[str, Any] | None:
        if not self.database_enabled:
            return None
        cleaned = [p.strip() for p in phones if p and p.strip()]
        if not cleaned:
            return {"status": "error", "message": "Thieu phones", "updated": 0}

        mode_norm = (mode or "same").strip().lower()
        if mode_norm not in {"same", "round_robin"}:
            return {"status": "error", "message": "mode khong hop le", "updated": 0}

        with self._session() as db:
            if mode_norm == "round_robin":
                pool: list[Proxy] = []
                if proxy_ids:
                    for pid in proxy_ids:
                        row = db.get(Proxy, int(pid))
                        if row is None:
                            return {
                                "status": "error",
                                "message": f"Proxy {pid} khong ton tai",
                                "updated": 0,
                            }
                        if row.enabled:
                            pool.append(row)
                else:
                    # Prefer least-assigned enabled proxies for balance
                    rows = list(db.exec(select(Proxy).where(Proxy.enabled == True)).all())  # noqa: E712
                    rows.sort(
                        key=lambda r: (self._assigned_count(db, r.id), r.id),
                    )
                    pool = rows

                if not pool:
                    return {
                        "status": "error",
                        "message": "Khong co proxy enabled de chia",
                        "updated": 0,
                    }

                pairs: list[dict[str, Any]] = []
                updated = 0
                for index, phone in enumerate(cleaned):
                    target = pool[index % len(pool)]
                    meta = db.get(SessionMeta, phone)
                    if meta is None:
                        meta = SessionMeta(phone=phone, source="imported", status="unknown")
                    meta.proxy_id = target.id
                    db.add(meta)
                    updated += 1
                    pairs.append({"phone": phone, "proxy_id": target.id, "proxy_name": target.name})
                db.commit()
                return {
                    "status": "success",
                    "mode": "round_robin",
                    "proxy_id": None,
                    "proxy_count": len(pool),
                    "updated": updated,
                    "phones": cleaned,
                    "pairs": pairs,
                }

            if proxy_id is not None:
                proxy = db.get(Proxy, proxy_id)
                if proxy is None:
                    return {"status": "error", "message": "Proxy khong ton tai", "updated": 0}

            updated = 0
            for phone in cleaned:
                meta = db.get(SessionMeta, phone)
                if meta is None:
                    meta = SessionMeta(phone=phone, source="imported", status="unknown")
                meta.proxy_id = proxy_id
                db.add(meta)
                updated += 1
            db.commit()
            return {
                "status": "success",
                "mode": "same",
                "proxy_id": proxy_id,
                "updated": updated,
                "phones": cleaned,
            }

    def get_proxy_row_for_phone(self, phone: str) -> Proxy | None:
        """Return enabled Proxy for phone, or None (direct)."""
        if not self.database_enabled:
            return None
        phone = phone.strip()
        if not phone:
            return None
        with self._session() as db:
            meta = db.get(SessionMeta, phone)
            if meta is None or meta.proxy_id is None:
                return None
            row = db.get(Proxy, meta.proxy_id)
            if row is None or not row.enabled:
                return None
            # detach fields for use outside session
            return Proxy(
                id=row.id,
                name=row.name,
                proxy_type=row.proxy_type,
                host=row.host,
                port=row.port,
                username=row.username,
                password=row.password,
                secret=row.secret,
                enabled=row.enabled,
            )

    def phones_using_proxy(self, proxy_id: int) -> list[str]:
        if not self.database_enabled:
            return []
        with self._session() as db:
            return list(
                db.exec(
                    select(SessionMeta.phone).where(SessionMeta.proxy_id == proxy_id)
                ).all()
            )

    @staticmethod
    def _assigned_count(db: Session, proxy_id: int) -> int:
        value = db.exec(
            select(func.count()).select_from(SessionMeta).where(SessionMeta.proxy_id == proxy_id)
        ).one()
        return int(value or 0)

    @staticmethod
    def _to_item(row: Proxy, assigned_count: int) -> dict[str, Any]:
        return {
            "id": row.id,
            "name": row.name,
            "proxy_type": row.proxy_type,
            "host": row.host,
            "port": row.port,
            "username": row.username or "",
            "password_set": bool(row.password),
            "secret_set": bool(row.secret),
            "enabled": bool(row.enabled),
            "last_check_status": row.last_check_status,
            "last_check_at": _iso(row.last_check_at),
            "last_check_message": row.last_check_message or "",
            "assigned_count": assigned_count,
            "created_at": _iso(row.created_at),
            "updated_at": _iso(row.updated_at),
        }


proxy_store = ProxyStore()
