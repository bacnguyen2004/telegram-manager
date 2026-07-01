from collections.abc import Generator
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from sqlmodel import Session, create_engine

from ..config import BASE_DIR, settings

_engine = None


def _engine_kwargs(url: str) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"echo": False}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    return kwargs


def get_engine():
    global _engine
    if _engine is None:
        _engine = create_engine(
            settings.database_url,
            **_engine_kwargs(settings.database_url),
        )
    return _engine


def reset_engine() -> None:
    global _engine
    if _engine is not None:
        _engine.dispose()
        _engine = None


def run_migrations() -> None:
    """Apply Alembic migrations up to head."""
    if not settings.database_enabled:
        return
    alembic_ini = Path(BASE_DIR) / "alembic.ini"
    if not alembic_ini.exists():
        return
    cfg = Config(str(alembic_ini))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(cfg, "head")


def init_db() -> None:
    run_migrations()


def get_session() -> Generator[Session, None, None]:
    with Session(get_engine()) as session:
        yield session


def ping_database() -> tuple[bool, str]:
    if not settings.database_enabled:
        return False, "Database disabled (DATABASE_ENABLED=false)"

    try:
        with Session(get_engine()) as session:
            session.connection().exec_driver_sql("SELECT 1")
        return True, "OK"
    except Exception as exc:
        return False, str(exc)