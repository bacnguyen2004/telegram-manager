"""App settings from backend/.env — single source for Telegram, DB, AI, realtime."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
_ENV_FILE = BASE_DIR / ".env"


def _load_env(*, override: bool = True) -> None:
    load_dotenv(_ENV_FILE, override=override)


_load_env(override=True)


def _env_bool(name: str, default: str = "false") -> bool:
    raw = (os.getenv(name, default) or default).strip().strip("\"'").lower()
    return raw in {"1", "true", "yes", "on"}


def _env_str(name: str, default: str = "") -> str:
    return (os.getenv(name, default) or default).strip().strip("\"'")


def _env_float(name: str, default: str) -> float:
    return float(_env_str(name, default) or default)


def _env_int(name: str, default: str) -> int:
    return int(_env_str(name, default) or default)


def resolve_project_path(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = BASE_DIR / path
    return path.resolve()


class Settings:
    """Runtime config. Call reload_ai_env() after editing AI keys in .env."""

    app_name: str = "Telegram Manager"
    api_prefix: str = "/api"

    def __init__(self) -> None:
        self.refresh()

    def refresh(self) -> None:
        """Reload all settings from env (Telegram + DB + realtime + AI)."""
        _load_env(override=True)

        self.telegram_api_id = _env_int("TELEGRAM_API_ID", "0")
        self.telegram_api_hash = _env_str("TELEGRAM_API_HASH", "")

        session_raw = (
            os.getenv("SESSION_FOLDER")
            or os.getenv("SESSION_DIR")
            or "runtime/sessions"
        )
        self.session_dir = resolve_project_path(session_raw)
        self.session_lock_dir = resolve_project_path(
            os.getenv("SESSION_LOCK_DIR", "runtime/locks")
        )
        self.session_lock_timeout = _env_float("TG_SESSION_LOCK_TIMEOUT", "120")
        self.session_lock_stale_seconds = _env_float(
            "TG_SESSION_LOCK_STALE_SECONDS", "300"
        )

        self.database_url = _env_str(
            "DATABASE_URL",
            f"sqlite:///{(BASE_DIR / 'runtime' / 'telegram_manager.db').as_posix()}",
        )
        self.database_enabled = _env_bool("DATABASE_ENABLED", "true")

        self.avatar_dir = resolve_project_path(os.getenv("AVATAR_DIR", "runtime/avatars"))

        self.telegram_listener_enabled = _env_bool("TELEGRAM_LISTENER_ENABLED", "true")
        self.telegram_realtime_mode = _env_str("TELEGRAM_REALTIME_MODE", "").lower()
        self.telegram_listener_idle_seconds = _env_float(
            "TELEGRAM_LISTENER_IDLE_SECONDS", "300"
        )
        self.telegram_listener_reconnect_seconds = _env_float(
            "TELEGRAM_LISTENER_RECONNECT_SECONDS", "15"
        )
        self.telegram_client_idle_seconds = _env_float(
            "TELEGRAM_CLIENT_IDLE_SECONDS", "120"
        )

        self._load_ai()

    def reload_ai_env(self) -> None:
        """Re-read AI-related keys only (after editing .env without restart)."""
        _load_env(override=True)
        self._load_ai()

    def _load_ai(self) -> None:
        self.ai_enabled = _env_bool("AI_ENABLED", "false")
        self.openai_api_key = _env_str("OPENAI_API_KEY", "")
        self.openai_model = _env_str("OPENAI_MODEL", "gpt-4.1-mini") or "gpt-4.1-mini"
        raw_models = _env_str("OPENAI_MODELS", "")
        listed = [m.strip() for m in raw_models.split(",") if m.strip()] if raw_models else []
        models: list[str] = []
        for m in [self.openai_model, *listed]:
            if m and m not in models:
                models.append(m)
        self.openai_models = models
        self.openai_temperature = _env_float("OPENAI_TEMPERATURE", "0.9")
        self.openai_max_output_tokens = _env_int("OPENAI_MAX_OUTPUT_TOKENS", "4000")
        self.openai_timeout_seconds = _env_float("OPENAI_TIMEOUT_SECONDS", "120")

    @property
    def ai_configured(self) -> bool:
        return bool(self.ai_enabled and self.openai_api_key)

    def validate_telegram_config(self) -> None:
        if not self.telegram_api_id or not self.telegram_api_hash:
            raise ValueError("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in .env")

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

__all__ = ["BASE_DIR", "session_lock", "settings"]
