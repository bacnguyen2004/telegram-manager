import os
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
_ENV_FILE = BASE_DIR / ".env"


def _load_env(*, override: bool = False) -> None:
    """Load backend/.env. override=True so file wins over stale empty shell vars."""
    load_dotenv(_ENV_FILE, override=override)


# Initial load (override so local .env is source of truth for AI keys etc.)
_load_env(override=True)


def _env_bool(name: str, default: str = "false") -> bool:
    raw = (os.getenv(name, default) or default).strip().strip("\"'").lower()
    return raw in {"1", "true", "yes", "on"}


def _env_str(name: str, default: str = "") -> str:
    return (os.getenv(name, default) or default).strip().strip("\"'")


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
    # Keep Telethon TCP sessions warm between campaign typing/sends (reduces
    # connect thrash + Windows "Connection._recv_loop GeneratorExit" noise).
    telegram_client_idle_seconds: float = float(
        os.getenv("TELEGRAM_CLIENT_IDLE_SECONDS", "120") or 120
    )

    def reload_ai_env(self) -> None:
        """Re-read backend/.env for AI settings (uvicorn does not reload on .env change)."""
        _load_env(override=True)

    @property
    def ai_enabled(self) -> bool:
        self.reload_ai_env()
        return _env_bool("AI_ENABLED", "false")

    @property
    def openai_api_key(self) -> str:
        self.reload_ai_env()
        return _env_str("OPENAI_API_KEY", "")

    @property
    def openai_model(self) -> str:
        self.reload_ai_env()
        return _env_str("OPENAI_MODEL", "gpt-4.1-mini") or "gpt-4.1-mini"

    @property
    def openai_models(self) -> list[str]:
        """Selectable models for campaign UI (OPENAI_MODELS=comma list)."""
        self.reload_ai_env()
        default = self.openai_model
        raw = _env_str("OPENAI_MODELS", "")
        if raw:
            listed = [m.strip() for m in raw.split(",") if m.strip()]
        else:
            # Full default GPT chat catalog (see services.ai.model_catalog)
            from .services.ai.model_catalog import DEFAULT_GPT_CHAT_MODELS

            listed = list(DEFAULT_GPT_CHAT_MODELS)
        out: list[str] = []
        for m in [default, *listed]:
            if m and m not in out:
                out.append(m)
        return out

    @property
    def openai_temperature(self) -> float:
        self.reload_ai_env()
        return float(_env_str("OPENAI_TEMPERATURE", "0.9") or 0.9)

    @property
    def openai_max_output_tokens(self) -> int:
        self.reload_ai_env()
        return int(_env_str("OPENAI_MAX_OUTPUT_TOKENS", "4000") or 4000)

    @property
    def openai_timeout_seconds(self) -> float:
        self.reload_ai_env()
        return float(_env_str("OPENAI_TIMEOUT_SECONDS", "120") or 120)

    @property
    def ai_configured(self) -> bool:
        # Single reload for both flags
        self.reload_ai_env()
        enabled = _env_bool("AI_ENABLED", "false")
        key = _env_str("OPENAI_API_KEY", "")
        return bool(enabled and key)

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