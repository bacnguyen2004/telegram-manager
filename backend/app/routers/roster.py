from fastapi import APIRouter, HTTPException

from ..db.roster_store import roster_store
from ..schemas.common import ApiEnvelope
from ..schemas.roster import (
    CreateRosterColumnRequest,
    RenameRosterColumnRequest,
    PatchRosterRowRequest,
    RosterColumnItem,
    RosterData,
    RosterImportRequest,
    RosterImportResult,
    RosterRowItem,
)
from ..services.telegram import telegram_session_service
from ..utils.responses import success_response


router = APIRouter(prefix="/roster", tags=["roster"])


def _require_database() -> None:
    sheet = roster_store.get_sheet([])
    if not sheet.get("database_enabled"):
        raise HTTPException(
            status_code=503,
            detail="Database chua bat — cau hinh DATABASE_URL trong backend/.env",
        )


@router.get("", response_model=ApiEnvelope[RosterData])
async def get_roster() -> dict:
    sessions = telegram_session_service.list_sessions()
    phones = sessions.get("sessions", [])
    payload = roster_store.get_sheet(phones)
    data = RosterData(
        database_enabled=bool(payload.get("database_enabled")),
        columns=[RosterColumnItem(**item) for item in payload.get("columns", [])],
        rows=[RosterRowItem(**item) for item in payload.get("rows", [])],
    )
    return success_response(data.model_dump())


@router.patch("/{phone}", response_model=ApiEnvelope[RosterRowItem])
async def patch_roster_row(phone: str, payload: PatchRosterRowRequest) -> dict:
    _require_database()
    phone = phone.strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Thieu phone")

    sessions = telegram_session_service.list_sessions()
    known_phones = set(sessions.get("sessions", []))
    if phone not in known_phones:
        raise HTTPException(status_code=404, detail="Khong tim thay session")

    updated_fields = roster_store.patch_row(phone, payload.fields)
    if updated_fields is None:
        raise HTTPException(status_code=500, detail="Khong cap nhat duoc roster")

    sheet = roster_store.get_sheet([phone])
    row_payload = sheet.get("rows", [{}])[0]
    data = RosterRowItem(**row_payload)
    return success_response(data.model_dump())


@router.post("/columns", response_model=ApiEnvelope[RosterColumnItem])
async def create_roster_column(payload: CreateRosterColumnRequest) -> dict:
    _require_database()
    created = roster_store.add_column(payload.label)
    if created is None:
        raise HTTPException(status_code=500, detail="Khong tao duoc cot")
    data = RosterColumnItem(**created)
    return success_response(data.model_dump())


@router.patch("/columns/{column_key}", response_model=ApiEnvelope[RosterColumnItem])
async def rename_roster_column(column_key: str, payload: RenameRosterColumnRequest) -> dict:
    _require_database()
    renamed = roster_store.rename_column(column_key, payload.label)
    if renamed is None:
        raise HTTPException(
            status_code=400,
            detail="Khong doi ten cot — kiem tra ten trung hoac cot khong ton tai",
        )
    data = RosterColumnItem(**renamed)
    return success_response(data.model_dump())


@router.delete("/columns/{column_key}", response_model=ApiEnvelope[dict])
async def delete_roster_column(column_key: str) -> dict:
    _require_database()
    deleted = roster_store.remove_column(column_key)
    if not deleted:
        raise HTTPException(status_code=404, detail="Khong tim thay cot")
    return success_response({"column_key": column_key.strip()})


@router.post("/import", response_model=ApiEnvelope[RosterImportResult])
async def import_roster(payload: RosterImportRequest) -> dict:
    _require_database()
    sessions = telegram_session_service.list_sessions()
    known_phones = set(sessions.get("sessions", []))
    result = roster_store.import_rows(
        known_phones,
        new_column_labels=payload.new_column_labels,
        rows=[item.model_dump() for item in payload.rows],
    )
    data = RosterImportResult(**result)
    return success_response(data.model_dump())