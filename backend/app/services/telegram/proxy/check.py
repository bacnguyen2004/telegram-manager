"""Proxy connectivity checks (TCP + optional deep)."""
from __future__ import annotations

import asyncio
import socket


async def check_proxy_tcp(host: str, port: int, *, timeout: float = 8.0) -> tuple[str, str]:
    """Return (status, message) where status is ok|fail."""
    host = host.strip()
    if not host:
        return "fail", "Thieu host"
    try:
        port_n = int(port)
    except (TypeError, ValueError):
        return "fail", "Port khong hop le"

    loop = asyncio.get_running_loop()

    def _connect() -> None:
        with socket.create_connection((host, port_n), timeout=timeout):
            return None

    try:
        await loop.run_in_executor(None, _connect)
        return "ok", f"TCP connect {host}:{port_n} OK"
    except OSError as exc:
        return "fail", f"TCP fail: {exc}"
    except Exception as exc:
        return "fail", str(exc)
