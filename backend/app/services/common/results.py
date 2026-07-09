"""Shared response-shaped helpers used by services.

Routers still use app.utils.responses for HTTP envelopes.
Domain services often return status/message payloads — keep small builders here.
"""
from __future__ import annotations

from typing import Any


def status_result(status: str, message: str, **extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"status": status, "message": message}
    payload.update(extra)
    return payload


def error_status(message: str, **extra: Any) -> dict[str, Any]:
    return status_result("error", message, **extra)


def success_status(message: str, **extra: Any) -> dict[str, Any]:
    return status_result("success", message, **extra)
