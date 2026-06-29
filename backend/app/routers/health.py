from pathlib import Path

from fastapi import APIRouter

from ..config import settings
from ..schemas.common import ApiEnvelope
from ..schemas.health import HealthData
from ..utils.responses import success_response


router = APIRouter(tags=["health"])


def _is_writable(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        test_file = path / ".health_write_test"
        test_file.write_text("", encoding="utf-8")
        test_file.unlink(missing_ok=True)
        return True
    except OSError:
        return False


def get_health_status() -> dict:
    session_dir = settings.session_dir
    session_dir_exists = session_dir.exists()
    session_dir_writable = _is_writable(session_dir) if session_dir_exists else _is_writable(session_dir)

    telegram_configured = bool(settings.telegram_api_id and settings.telegram_api_hash)

    session_count = 0
    if session_dir_exists:
        session_count = len(list(session_dir.glob("*.session")))

    issues: list[str] = []
    if not telegram_configured:
        issues.append("Thieu TELEGRAM_API_ID hoac TELEGRAM_API_HASH")
    if not session_dir_writable:
        issues.append("Khong ghi duoc vao thu muc session")

    status = "ok" if not issues else "degraded"
    message = "OK" if not issues else "; ".join(issues)

    return {
        "status": status,
        "app": settings.app_name,
        "telegram_configured": telegram_configured,
        "session_dir": str(session_dir),
        "session_dir_exists": session_dir_exists,
        "session_dir_writable": session_dir_writable,
        "session_count": session_count,
        "message": message,
    }


@router.get("/health", response_model=ApiEnvelope[HealthData])
async def health() -> dict:
    result = get_health_status()
    data = HealthData(**result)
    return success_response(data.model_dump())