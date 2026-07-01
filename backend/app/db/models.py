from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class SessionMeta(SQLModel, table=True):
    """Business metadata for a Telethon session file (phone = natural key)."""

    __tablename__ = "session_meta"

    phone: str = Field(primary_key=True, max_length=32)
    telegram_user_id: int | None = Field(default=None, index=True)
    username: str | None = Field(default=None, max_length=64)
    display_name: str | None = Field(default=None, max_length=128)
    source: str = Field(default="imported", max_length=16)       # imported | otp_login
    status: str = Field(default="unknown", max_length=16)          # active | unauthorized | error | unknown
    imported_at: datetime = Field(default_factory=utc_now)
    last_synced_at: datetime | None = Field(default=None)
    last_error: str | None = Field(default=None, max_length=500)

    has_avatar: bool = Field(default=False)
    avatar_path: str | None = Field(default=None, max_length=256)
    avatar_updated_at: datetime | None = Field(default=None)


class GroupScan(SQLModel, table=True):
    """Snapshot after listing groups/channels from Telegram."""

    __tablename__ = "group_scans"

    id: int | None = Field(default=None, primary_key=True)
    phone: str = Field(max_length=32, index=True)
    total: int = Field(ge=0)
    group_count: int = Field(ge=0)
    channel_count: int = Field(ge=0)
    scanned_at: datetime = Field(default_factory=utc_now, index=True)


class AuditLog(SQLModel, table=True):
    """Append-only audit trail for sensitive API actions."""

    __tablename__ = "audit_logs"

    id: int | None = Field(default=None, primary_key=True)
    phone: str = Field(max_length=32, index=True)
    action: str = Field(max_length=64, index=True)
    resource: str | None = Field(default=None, max_length=256)
    status: str = Field(max_length=32)
    detail: str | None = Field(default=None, max_length=2000)
    created_at: datetime = Field(default_factory=utc_now, index=True)