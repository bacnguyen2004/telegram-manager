from fastapi import APIRouter, File, Form, Query, UploadFile

from ..schemas.common import ApiEnvelope
from ..schemas.messages import (
    ReactMessageData,
    ReactMessageRequest,
    ReplyMessageRequest,
    SendMessageData,
    SendMessageRequest,
)
from ..services.telegram.messages import telegram_message_service
from ..utils.responses import success_response


router = APIRouter(prefix="/messages", tags=["messages"])

ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}
MAX_IMAGE_BYTES = 10 * 1024 * 1024


@router.post("/send", response_model=ApiEnvelope[SendMessageData])
async def send_message(payload: SendMessageRequest) -> dict:
    result = await telegram_message_service.send_message(
        payload.phone,
        payload.peer_id,
        payload.text,
    )
    data = SendMessageData(**result)
    return success_response(data.model_dump())


@router.post("/reply", response_model=ApiEnvelope[SendMessageData])
async def reply_message(payload: ReplyMessageRequest) -> dict:
    result = await telegram_message_service.reply_message(
        payload.phone,
        payload.peer_id,
        payload.text,
        payload.reply_to_msg_id,
    )
    data = SendMessageData(**result)
    return success_response(data.model_dump())


@router.post("/send-media", response_model=ApiEnvelope[SendMessageData])
async def send_media(
    phone: str = Form(..., description="So dien thoai session"),
    peer_id: str = Form(..., description="Dialog id hoac username"),
    file: UploadFile = File(..., description="Anh (JPEG, PNG, WebP, GIF)"),
    caption: str = Form("", max_length=1024),
    reply_to_msg_id: int | None = Form(None, ge=1),
) -> dict:
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_IMAGE_TYPES:
        result = telegram_message_service._error(
            phone,
            peer_id,
            "Chi ho tro anh JPEG, PNG, WebP hoac GIF",
        )
        data = SendMessageData(**result)
        return success_response(data.model_dump())

    file_bytes = await file.read()
    if len(file_bytes) > MAX_IMAGE_BYTES:
        result = telegram_message_service._error(
            phone,
            peer_id,
            "Anh toi da 10MB",
        )
        data = SendMessageData(**result)
        return success_response(data.model_dump())

    result = await telegram_message_service.send_media(
        phone,
        peer_id,
        file_bytes,
        file.filename or "image.jpg",
        caption=caption,
        reply_to_msg_id=reply_to_msg_id,
    )
    data = SendMessageData(**result)
    return success_response(data.model_dump())


@router.post("/react", response_model=ApiEnvelope[ReactMessageData])
async def send_reaction(payload: ReactMessageRequest) -> dict:
    result = await telegram_message_service.send_reaction(
        payload.phone,
        payload.peer_id,
        payload.message_id,
        payload.emoji,
    )
    data = ReactMessageData(**result)
    return success_response(data.model_dump())


@router.delete("/react", response_model=ApiEnvelope[ReactMessageData])
async def remove_reaction(
    phone: str = Query(..., description="So dien thoai session"),
    peer_id: str = Query(..., description="Dialog id hoac username"),
    message_id: int = Query(..., ge=1, description="ID tin nhan"),
) -> dict:
    result = await telegram_message_service.remove_reaction(phone, peer_id, message_id)
    data = ReactMessageData(**result)
    return success_response(data.model_dump())


@router.delete("/{message_id}", response_model=ApiEnvelope[SendMessageData])
async def delete_message(
    message_id: int,
    phone: str = Query(..., description="So dien thoai session"),
    peer_id: str = Query(..., description="Dialog id hoac username"),
) -> dict:
    result = await telegram_message_service.delete_message(phone, peer_id, message_id)
    data = SendMessageData(**result)
    return success_response(data.model_dump())