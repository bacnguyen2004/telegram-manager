"""Shared input normalization / validation for services."""
from __future__ import annotations

import re

_PHONE_SAFE_RE = re.compile(r"[^0-9A-Za-z_+-]+")


def normalize_phone(phone: str | None) -> str:
    return (phone or "").strip()


def safe_phone_key(phone: str) -> str:
    return _PHONE_SAFE_RE.sub("_", phone.strip()) or "unknown"


def clamp_limit(value: int | None, *, default: int, minimum: int = 1, maximum: int = 500) -> int:
    try:
        n = int(value if value is not None else default)
    except (TypeError, ValueError):
        n = default
    return max(minimum, min(n, maximum))


def validate_text(text: str | None, *, max_len: int = 4096, field: str = "text") -> str | None:
    """Return error message or None if ok. Empty string is an error."""
    value = (text or "").strip()
    if not value:
        return f"Thieu {field}"
    if len(value) > max_len:
        return f"{field} qua dai"
    return None


def normalize_peer_ref(peer_ref: str) -> str:
    normalized = peer_ref.strip().rstrip("/")
    if "t.me/" in normalized:
        normalized = normalized.split("/")[-1]
    return normalized
