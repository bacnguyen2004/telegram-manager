from fastapi import APIRouter, Query

from ..schemas.common import ApiEnvelope
from ..schemas.dialogs import DialogMessagesData, DialogsData
from ..services.telegram.dialogs import telegram_dialog_service
from ..utils.responses import success_response


router = APIRouter(prefix="/dialogs", tags=["dialogs"])


@router.get("/{phone}/messages", response_model=ApiEnvelope[DialogMessagesData])
async def get_dialog_messages(
    phone: str,
    peer_id: str = Query(..., description="Dialog id hoac username"),
    limit: int = Query(default=40, ge=1, le=100),
) -> dict:
    result = await telegram_dialog_service.get_messages(phone, peer_id, limit)
    data = DialogMessagesData(**result)
    return success_response(data.model_dump())


@router.get("/{phone}", response_model=ApiEnvelope[DialogsData])
async def list_dialogs(
    phone: str,
    limit: int = Query(default=200, ge=1, le=500),
) -> dict:
    result = await telegram_dialog_service.list_dialogs(phone, limit)
    data = DialogsData(**result)
    return success_response(data.model_dump())