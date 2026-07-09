"""Apply one auto-profile row via existing ProfileService (unit of work)."""

from __future__ import annotations

from typing import Any

from ...db import metadata_store
from ..telegram import telegram_session_service
from .avatar_fetch import fetch_avatar_bytes
from .generator import random_username


USERNAME_OCCUPIED_MARKERS = (
    "da duoc su dung",
    "already taken",
    "username is occupied",
    "username occupied",
)


def _is_username_occupied(message: str) -> bool:
    text = (message or "").lower()
    return any(marker in text for marker in USERNAME_OCCUPIED_MARKERS)


async def apply_profile_row(
    row: dict[str, Any],
    *,
    username_retries: int = 3,
    session_service=telegram_session_service,
) -> dict[str, Any]:
    """
    Apply profile + avatar for a single phone.

    Designed as the only write unit so a future bulk job runner can call this
    in a loop without refactoring generators or HTTP handlers.
    """
    phone = str(row.get("phone") or "").strip()
    first_name = str(row.get("first_name") or "").strip()
    last_name = str(row.get("last_name") or "").strip()
    username = str(row.get("username") or "").strip().lstrip("@")
    about = str(row.get("about") or "").strip()
    avatar_mode = str(row.get("avatar_mode") or "keep").strip().lower()
    avatar_url = str(row.get("avatar_url") or "").strip()

    if not phone:
        return {
            "status": "error",
            "phone": phone,
            "message": "Thieu phone",
            "profile": None,
            "avatar": None,
        }
    if not first_name:
        return {
            "status": "error",
            "phone": phone,
            "message": "Ten khong duoc de trong",
            "profile": None,
            "avatar": None,
        }

    profile_result: dict[str, Any] | None = None
    attempt_username = username
    for attempt in range(max(username_retries, 1)):
        profile_result = await session_service.update_profile(
            phone,
            first_name=first_name,
            last_name=last_name,
            username=attempt_username,
            about=about,
        )
        if profile_result.get("status") == "success":
            username = attempt_username
            break
        message = str(profile_result.get("message") or "")
        if _is_username_occupied(message) and attempt < username_retries - 1:
            attempt_username = random_username(f"{first_name} {last_name}".strip())
            continue
        return {
            "status": "error",
            "phone": phone,
            "message": message or "Cap nhat profile that bai",
            "profile": profile_result,
            "avatar": None,
        }

    avatar_result: dict[str, Any] | None = None
    if avatar_mode == "delete":
        avatar_result = await session_service.delete_avatar(phone)
        if avatar_result.get("status") != "success":
            return {
                "status": "error",
                "phone": phone,
                "message": avatar_result.get("message") or "Xoa avatar that bai",
                "profile": profile_result,
                "avatar": avatar_result,
            }
    elif avatar_mode == "url":
        if not avatar_url:
            return {
                "status": "error",
                "phone": phone,
                "message": "Thieu avatar_url",
                "profile": profile_result,
                "avatar": None,
            }
        try:
            image_bytes = await fetch_avatar_bytes(avatar_url)
        except ValueError as exc:
            return {
                "status": "error",
                "phone": phone,
                "message": str(exc),
                "profile": profile_result,
                "avatar": None,
            }
        avatar_result = await session_service.upload_avatar(phone, image_bytes)
        if avatar_result.get("status") != "success":
            return {
                "status": "error",
                "phone": phone,
                "message": (
                    "Ho so da doi nhung avatar loi: "
                    f"{avatar_result.get('message') or 'Upload avatar that bai'}"
                ),
                "profile": profile_result,
                "avatar": avatar_result,
            }
    # keep → no avatar change

    metadata_store.record_audit(
        phone,
        action="auto_profile.apply",
        resource=phone,
        status="success",
        detail={
            "first_name": first_name,
            "last_name": last_name,
            "username": username,
            "about": about,
            "avatar_mode": avatar_mode,
            "avatar_url": avatar_url[:200] if avatar_url else "",
        },
    )

    if avatar_mode == "url":
        done_message = "Da cap nhat ho so + avatar"
    elif avatar_mode == "delete":
        done_message = "Da cap nhat ho so + xoa avatar"
    else:
        done_message = "Da cap nhat ho so (giu avatar)"

    return {
        "status": "success",
        "phone": phone,
        "message": done_message,
        "profile": profile_result,
        "avatar": avatar_result,
        "applied_username": username,
    }
