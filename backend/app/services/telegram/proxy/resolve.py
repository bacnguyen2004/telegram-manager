"""Resolve phone → Telethon proxy argument."""
from __future__ import annotations

from typing import Any

from ....db.models import Proxy
from ....db.proxy_store import proxy_store


def telethon_proxy_dict(row: Proxy) -> dict[str, Any] | None:
    """Build Telethon-compatible proxy dict for SOCKS5/HTTP. MTProto returns None here."""
    ptype = (row.proxy_type or "").strip().lower()
    if ptype not in {"socks5", "http"}:
        return None

    # Telethon accepts string proxy_type with PySocks installed
    return {
        "proxy_type": ptype,
        "addr": row.host.strip(),
        "port": int(row.port),
        "username": row.username or None,
        "password": row.password or None,
        "rdns": True,
    }


def telethon_proxy_for_phone(phone: str) -> dict[str, Any] | None:
    row = proxy_store.get_proxy_row_for_phone(phone)
    if row is None:
        return None
    return telethon_proxy_dict(row)
