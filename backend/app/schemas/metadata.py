from pydantic import BaseModel, Field

from .sessions import SessionAuditItem, SessionGroupScanSummary


class AuditLogItem(BaseModel):
    id: int
    phone: str
    action: str
    resource: str | None = None
    status: str
    detail: str | None = None
    created_at: str


class AuditLogsData(BaseModel):
    database_enabled: bool
    total: int
    limit: int
    offset: int
    items: list[AuditLogItem]


class GroupScanItem(BaseModel):
    id: int
    phone: str
    total: int
    group_count: int
    channel_count: int
    scanned_at: str


class GroupScansData(BaseModel):
    database_enabled: bool
    total: int
    limit: int
    items: list[GroupScanItem]


class SessionMetaOverviewItem(BaseModel):
    phone: str
    username: str | None = None
    display_name: str | None = None
    status: str
    source: str
    last_synced_at: str | None = None
    last_group_scan: SessionGroupScanSummary | None = None


class SessionMetaOverviewData(BaseModel):
    database_enabled: bool
    total: int
    items: list[SessionMetaOverviewItem]


class MetadataOverviewData(BaseModel):
    database_enabled: bool
    session_meta_count: int = 0
    audit_log_count: int = 0
    group_scan_count: int = 0
    recent_audit: list[AuditLogItem] = Field(default_factory=list)


class SessionRecentAuditData(BaseModel):
    database_enabled: bool
    phone: str
    items: list[SessionAuditItem] = Field(default_factory=list)