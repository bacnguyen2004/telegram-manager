from fastapi import APIRouter, Query

from ..db import metadata_store
from ..schemas.common import ApiEnvelope
from ..schemas.metadata import (
    AuditLogsData,
    GroupScansData,
    MetadataOverviewData,
    SessionMetaOverviewData,
)
from ..utils.responses import success_response


router = APIRouter(prefix="/metadata", tags=["metadata"])


@router.get("/overview", response_model=ApiEnvelope[MetadataOverviewData])
async def metadata_overview() -> dict:
    data = MetadataOverviewData(**metadata_store.get_overview())
    return success_response(data.model_dump())


@router.get("/audit", response_model=ApiEnvelope[AuditLogsData])
async def list_audit_logs(
    phone: str | None = Query(default=None, description="Loc theo so dien thoai"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict:
    data = AuditLogsData(**metadata_store.list_audit_logs(phone=phone, limit=limit, offset=offset))
    return success_response(data.model_dump())


@router.get("/group-scans", response_model=ApiEnvelope[GroupScansData])
async def list_group_scans(
    phone: str | None = Query(default=None, description="Loc theo so dien thoai"),
    limit: int = Query(default=20, ge=1, le=100),
) -> dict:
    data = GroupScansData(**metadata_store.list_group_scans(phone=phone, limit=limit))
    return success_response(data.model_dump())


@router.get("/sessions", response_model=ApiEnvelope[SessionMetaOverviewData])
async def list_session_meta_overview() -> dict:
    data = SessionMetaOverviewData(**metadata_store.list_session_meta_overview())
    return success_response(data.model_dump())