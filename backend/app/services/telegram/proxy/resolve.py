"""Resolve phone → Telethon client proxy / connection kwargs."""
from __future__ import annotations

from typing import Any

from ....db.models import Proxy
from ....db.proxy_store import proxy_store


def telethon_proxy_dict(row: Proxy) -> dict[str, Any] | None:
    """Build Telethon-compatible proxy dict for SOCKS5/HTTP only.

    MTProto uses a different Telethon shape (connection class + tuple);
    use ``telethon_client_kwargs_from_row`` for full client kwargs.
    """
    ptype = (row.proxy_type or "").strip().lower()
    if ptype not in {"socks5", "http"}:
        return None

    return {
        "proxy_type": ptype,
        "addr": row.host.strip(),
        "port": int(row.port),
        "username": row.username or None,
        "password": row.password or None,
        "rdns": True,
    }


def telethon_client_kwargs_from_row(row: Proxy) -> dict[str, Any]:
    """Return kwargs for ``TelegramClient(..., **kwargs)`` from a proxy row."""
    ptype = (row.proxy_type or "").strip().lower()
    if ptype in {"socks5", "http"}:
        proxy = telethon_proxy_dict(row)
        if proxy is None:
            return {}
        return {"proxy": proxy}

    if ptype == "mtproto":
        secret = (row.secret or "").strip()
        host = (row.host or "").strip()
        if not secret or not host:
            return {}
        from telethon.network.connection import (
            ConnectionTcpMTProxyRandomizedIntermediate,
        )

        return {
            "connection": ConnectionTcpMTProxyRandomizedIntermediate,
            "proxy": (host, int(row.port), secret),
        }

    return {}


def telethon_client_kwargs_for_phone(phone: str) -> dict[str, Any]:
    row = proxy_store.get_proxy_row_for_phone(phone)
    if row is None:
        return {}
    return telethon_client_kwargs_from_row(row)


def telethon_proxy_for_phone(phone: str) -> dict[str, Any] | None:
    """Legacy SOCKS5/HTTP dict for a phone. Prefer ``telethon_client_kwargs_for_phone``."""
    row = proxy_store.get_proxy_row_for_phone(phone)
    if row is None:
        return None
    return telethon_proxy_dict(row)
