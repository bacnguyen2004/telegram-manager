from fastapi import APIRouter, File, Form, Query, UploadFile

from ..schemas.common import ApiEnvelope
from ..schemas.messages import (
    AddPollOptionData,
    AddPollOptionRequest,
    CancelPollVoteData,
    CancelPollVoteRequest,
    DeleteMessagesData,
    DeleteMessagesRequest,
    EditMessageRequest,
    ForwardMessageData,
    ForwardMessageRequest,
    ForwardMessagesData,
    ForwardMessagesRequest,
    PinMessageData,
    PinMessageRequest,
    PollInfoData,
    ReactMessageData,
    ReactMessageRequest,
    ReplyMessageRequest,
    SendMessageData,
    SendMessageRequest,
    VotePollData,
    VotePollRequest,
)
from ..services.telegram import telegram_message_service
from ..utils.responses import success_response


router = APIRouter(prefix="/messages", tags=["messages"])

ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}
ALLOWED_VIDEO_TYPES = {
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/x-msvideo",
}
ALLOWED_DOCUMENT_TYPES = {
    "application/pdf",
    "application/zip",
    "application/x-zip-compressed",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_VIDEO_BYTES = 50 * 1024 * 1024
MAX_DOCUMENT_BYTES = 20 * 1024 * 1024


def _media_kind_for_type(content_type: str) -> str | None:
    if content_type in ALLOWED_IMAGE_TYPES:
        return "image"
    if content_type in ALLOWED_VIDEO_TYPES:
        return "video"
    if content_type in ALLOWED_DOCUMENT_TYPES:
        return "document"
    return None


def _max_bytes_for_kind(media_kind: str) -> int:
    if media_kind == "video":
        return MAX_VIDEO_BYTES
    if media_kind == "document":
        return MAX_DOCUMENT_BYTES
    return MAX_IMAGE_BYTES


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
    file: UploadFile = File(..., description="Anh, video hoac file dinh kem"),
    caption: str = Form("", max_length=1024),
    reply_to_msg_id: int | None = Form(None, ge=1),
) -> dict:
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    media_kind = _media_kind_for_type(content_type)
    if media_kind is None:
        result = telegram_message_service._error(
            phone,
            peer_id,
            "Chi ho tro anh, video (MP4/WebM) hoac file PDF/ZIP/DOC",
        )
        data = SendMessageData(**result)
        return success_response(data.model_dump())

    file_bytes = await file.read()
    max_bytes = _max_bytes_for_kind(media_kind)
    if len(file_bytes) > max_bytes:
        labels = {
            "image": "Anh toi da 10MB",
            "video": "Video toi da 50MB",
            "document": "File toi da 20MB",
        }
        result = telegram_message_service._error(phone, peer_id, labels[media_kind])
        data = SendMessageData(**result)
        return success_response(data.model_dump())

    default_names = {
        "image": "image.jpg",
        "video": "video.mp4",
        "document": "file.bin",
    }
    result = await telegram_message_service.send_media(
        phone,
        peer_id,
        file_bytes,
        file.filename or default_names[media_kind],
        caption=caption,
        reply_to_msg_id=reply_to_msg_id,
        media_kind=media_kind,
    )
    data = SendMessageData(**result)
    return success_response(data.model_dump())


@router.post("/forward", response_model=ApiEnvelope[ForwardMessageData])
async def forward_message(payload: ForwardMessageRequest) -> dict:
    result = await telegram_message_service.forward_message(
        payload.phone,
        payload.from_peer_id,
        payload.to_peer_id,
        payload.message_id,
    )
    data = ForwardMessageData(**result)
    return success_response(data.model_dump())


@router.post("/forward-bulk", response_model=ApiEnvelope[ForwardMessagesData])
async def forward_messages(payload: ForwardMessagesRequest) -> dict:
    result = await telegram_message_service.forward_messages(
        payload.phone,
        payload.from_peer_id,
        payload.to_peer_id,
        payload.message_ids,
    )
    data = ForwardMessagesData(**result)
    return success_response(data.model_dump())


@router.post("/edit", response_model=ApiEnvelope[SendMessageData])
async def edit_message(payload: EditMessageRequest) -> dict:
    result = await telegram_message_service.edit_message(
        payload.phone,
        payload.peer_id,
        payload.message_id,
        payload.text,
    )
    data = SendMessageData(**result)
    return success_response(data.model_dump())


@router.post("/delete-bulk", response_model=ApiEnvelope[DeleteMessagesData])
async def delete_messages(payload: DeleteMessagesRequest) -> dict:
    result = await telegram_message_service.delete_messages(
        payload.phone,
        payload.peer_id,
        payload.message_ids,
    )
    data = DeleteMessagesData(**result)
    return success_response(data.model_dump())


@router.post("/pin", response_model=ApiEnvelope[PinMessageData])
async def pin_message(payload: PinMessageRequest) -> dict:
    result = await telegram_message_service.pin_message(
        payload.phone,
        payload.peer_id,
        payload.message_id,
        unpin=payload.unpin,
    )
    data = PinMessageData(**result)
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


@router.get("/poll", response_model=ApiEnvelope[PollInfoData])
async def get_poll_info(
    phone: str = Query(..., description="So dien thoai session"),
    peer_id: str = Query(..., description="Dialog id hoac username"),
    message_id: int = Query(..., ge=1, description="ID tin nhan chua poll"),
    link: str | None = Query(None, description="Link day du t.me/... de fetch poll"),
) -> dict:
    result = await telegram_message_service.get_poll_info(
        phone,
        peer_id,
        message_id,
        link=link,
    )
    data = PollInfoData(**result)
    return success_response(data.model_dump())


@router.post("/poll/add-option", response_model=ApiEnvelope[AddPollOptionData])
async def add_poll_option(payload: AddPollOptionRequest) -> dict:
    result = await telegram_message_service.add_poll_option(
        payload.phone,
        payload.peer_id,
        payload.message_id,
        payload.label,
        link=payload.link,
        vote_after=payload.vote_after,
    )
    data = AddPollOptionData(**result)
    return success_response(data.model_dump())


@router.post("/vote/cancel", response_model=ApiEnvelope[CancelPollVoteData])
async def cancel_poll_vote(payload: CancelPollVoteRequest) -> dict:
    result = await telegram_message_service.cancel_poll_vote(
        payload.phone,
        payload.peer_id,
        payload.message_id,
        link=payload.link,
        options=payload.options,
    )
    data = CancelPollVoteData(**result)
    return success_response(data.model_dump())


@router.post("/vote", response_model=ApiEnvelope[VotePollData])
async def vote_poll(payload: VotePollRequest) -> dict:
    result = await telegram_message_service.vote_poll(
        payload.phone,
        payload.peer_id,
        payload.message_id,
        payload.option,
        options=payload.options,
        link=payload.link,
    )
    data = VotePollData(**result)
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