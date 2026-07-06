import os
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def resolve_project_path(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = BASE_DIR / path
    return path.resolve()


class Settings:
    app_name: str = "Telegram Manager"
    api_prefix: str = "/api"

    telegram_api_id: int = int(os.getenv("TELEGRAM_API_ID", "0") or 0)
    telegram_api_hash: str = os.getenv("TELEGRAM_API_HASH", "")

    session_dir: Path = resolve_project_path(
        os.getenv("SESSION_FOLDER")
        or os.getenv("SESSION_DIR", "runtime/sessions")
    )
    session_lock_dir: Path = resolve_project_path(
        os.getenv("SESSION_LOCK_DIR", "runtime/locks")
    )
    session_lock_timeout: float = float(os.getenv("TG_SESSION_LOCK_TIMEOUT", "120") or 120)
    session_lock_stale_seconds: float = float(
        os.getenv("TG_SESSION_LOCK_STALE_SECONDS", "300") or 300
    )

    database_url: str = os.getenv(
        "DATABASE_URL",
        f"sqlite:///{(BASE_DIR / 'runtime' / 'telegram_manager.db').as_posix()}",
    )
    database_enabled: bool = os.getenv("DATABASE_ENABLED", "true").lower() not in {
        "0",
        "false",
        "no",
    }

    def validate_telegram_config(self) -> None:
        if not self.telegram_api_id or not self.telegram_api_hash:
            raise ValueError("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in .env")

    avatar_dir: Path = resolve_project_path(
        os.getenv("AVATAR_DIR", "runtime/avatars")
    )

    telegram_listener_enabled: bool = os.getenv(
        "TELEGRAM_LISTENER_ENABLED", "true"
    ).lower() not in {"0", "false", "no"}
    telegram_realtime_mode: str = os.getenv("TELEGRAM_REALTIME_MODE", "").strip().lower()
    telegram_listener_idle_seconds: float = float(
        os.getenv("TELEGRAM_LISTENER_IDLE_SECONDS", "300") or 300
    )
    telegram_listener_reconnect_seconds: float = float(
        os.getenv("TELEGRAM_LISTENER_RECONNECT_SECONDS", "15") or 15
    )

    @property
    def realtime_mode(self) -> str:
        from .services.realtime.events import normalize_realtime_mode

        return normalize_realtime_mode(
            self.telegram_realtime_mode,
            listener_enabled_legacy=self.telegram_listener_enabled,
        )

    @property
    def realtime_use_listener(self) -> bool:
        from .services.realtime.events import (
            REALTIME_MODE_EVENT,
            REALTIME_MODE_HYBRID,
        )

        return self.realtime_mode in {REALTIME_MODE_EVENT, REALTIME_MODE_HYBRID}

    @property
    def realtime_use_polling(self) -> bool:
        from .services.realtime.events import (
            REALTIME_MODE_HYBRID,
            REALTIME_MODE_POLLING,
        )

        return self.realtime_mode in {REALTIME_MODE_POLLING, REALTIME_MODE_HYBRID}

    def ensure_runtime_dirs(self) -> None:
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self.session_lock_dir.mkdir(parents=True, exist_ok=True)
        self.avatar_dir.mkdir(parents=True, exist_ok=True)
        (BASE_DIR / "runtime").mkdir(parents=True, exist_ok=True)


settings = Settings()

from .utils.session_lock import SessionLock  # noqa: E402

session_lock = SessionLock(
    settings.session_lock_dir,
    timeout=settings.session_lock_timeout,
    stale_seconds=settings.session_lock_stale_seconds,
)

# Re-export for services that need project root.
__all__ = ["BASE_DIR", "session_lock", "settings"]