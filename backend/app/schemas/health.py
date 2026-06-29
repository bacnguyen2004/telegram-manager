from typing import Literal

from pydantic import BaseModel


class HealthData(BaseModel):
    status: Literal["ok", "degraded"]
    app: str
    telegram_configured: bool
    session_dir: str
    session_dir_exists: bool
    session_dir_writable: bool
    session_count: int
    message: str = ""