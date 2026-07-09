"""Download avatar image bytes from a public URL."""

from __future__ import annotations

import asyncio
import urllib.error
import urllib.request

MAX_AVATAR_BYTES = 5 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 20
_USER_AGENT = "TelegramManagerAutoProfile/1.0"


def _download_sync(url: str, *, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> bytes:
    if not url.startswith(("http://", "https://")):
        raise ValueError("Avatar URL phai la http/https")

    request = urllib.request.Request(
        url,
        headers={"User-Agent": _USER_AGENT},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            content_type = (response.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if content_type and not content_type.startswith("image/"):
                # Some CDNs omit type; only reject explicit non-image.
                if content_type.startswith(("text/", "application/json")):
                    raise ValueError(f"URL khong tra ve anh ({content_type})")
            data = response.read(MAX_AVATAR_BYTES + 1)
    except urllib.error.HTTPError as exc:
        raise ValueError(f"Tai avatar HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise ValueError(f"Tai avatar that bai: {exc.reason}") from exc
    except TimeoutError as exc:
        raise ValueError("Tai avatar timeout") from exc

    if not data:
        raise ValueError("Avatar rong")
    if len(data) > MAX_AVATAR_BYTES:
        raise ValueError("Avatar vuot 5MB")
    return data


async def fetch_avatar_bytes(
    url: str,
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> bytes:
    return await asyncio.to_thread(_download_sync, url, timeout=timeout)
