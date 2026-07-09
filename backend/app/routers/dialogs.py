import json

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket
from fastapi.responses import Response, StreamingResponse

from ..schemas.common import ApiEnvelope
from ..schemas.dialogs import (
    DialogMessagesData,
    DialogPinnedMessagesData,
    DialogsData,
    MarkDialogReadData,
    MarkDialogReadRequest,
)
from ..services.realtime import iter_dialog_message_poll, message_ws_manager
from ..services.telegram import telegram_dialog_service
from ..utils.responses import success_response


router = APIRouter(prefix="/dialogs", tags=["dialogs"])


@router.get("/{phone}/messages/{message_id}/photo")
async def get_message_photo(
    phone: str,
    message_id: int,
    peer_id: str = Query(..., description="Dialog id hoac username"),
) -> Response:
    result = await telegram_dialog_service.get_message_photo(
        phone,
        peer_id,
        message_id,
    )
    if isinstance(result, dict):
        raise HTTPException(status_code=404, detail=result.get("message", "Not found"))
    content, mime_type = result
    return Response(content=content, media_type=mime_type)


@router.get("/{phone}/messages/{message_id}/media")
async def get_message_media(
    phone: str,
    message_id: int,
    peer_id: str = Query(..., description="Dialog id hoac username"),
) -> Response:
    result = await telegram_dialog_service.get_message_media(
        phone,
        peer_id,
        message_id,
    )
    if isinstance(result, dict):
        raise HTTPException(status_code=404, detail=result.get("message", "Not found"))
    content, mime_type, filename = result
    headers = {
        "Content-Disposition": f'inline; filename="{filename}"',
    }
    return Response(content=content, media_type=mime_type, headers=headers)


@router.get("/{phone}/messages/search", response_model=ApiEnvelope[DialogMessagesData])
async def search_dialog_messages(
    phone: str,
    peer_id: str = Query(..., description="Dialog id hoac username"),
    q: str = Query(..., min_length=2, description="Tu khoa tim trong chat"),
    limit: int = Query(default=50, ge=1, le=100),
) -> dict:
    result = await telegram_dialog_service.search_messages(
        phone,
        peer_id,
        q,
        limit,
    )
    data = DialogMessagesData(**result)
    return success_response(data.model_dump())


def _sse_event(event_name: str, payload: dict | None = None) -> str:
    data = json.dumps(payload or {}, ensure_ascii=False)
    return f"event: {event_name}\ndata: {data}\n\n"


@router.get("/{phone}/messages/stream")
async def stream_dialog_messages(
    request: Request,
    phone: str,
    peer_id: str = Query(..., description="Dialog id hoac username"),
    min_id: int = Query(..., ge=1, description="Lay tin co id lon hon min_id"),
) -> StreamingResponse:
    async def event_stream():
        async for payload in iter_dialog_message_poll(
            phone,
            peer_id,
            min_id,
            is_cancelled=request.is_disconnected,
        ):
            event_type = payload.get("type")
            if event_type == "messages":
                yield _sse_event(
                    "messages",
                    {
                        "messages": payload.get("messages") or [],
                        "dialog_preview": payload.get("dialog_preview"),
                    },
                )
            elif event_type == "heartbeat":
                yield _sse_event("heartbeat")
            elif event_type == "error":
                yield _sse_event(
                    "error",
                    {"message": payload.get("message", "Khong lay duoc tin moi")},
                )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.websocket("/{phone}/messages/ws")
async def ws_dialog_messages(
    websocket: WebSocket,
    phone: str,
    peer_id: str = Query(..., description="Dialog id hoac username"),
    min_id: int = Query(..., ge=1, description="Lay tin co id lon hon min_id"),
    last_seen_id: int = Query(
        default=0,
        ge=0,
        description="ID tin cuoi client da co (uu tien khi reconnect)",
    ),
) -> None:
    await message_ws_manager.handle_connection(
        websocket,
        phone,
        peer_id,
        min_id,
        last_seen_id=last_seen_id,
    )


@router.get("/{phone}/messages/new", response_model=ApiEnvelope[DialogMessagesData])
async def get_new_dialog_messages(
    phone: str,
    peer_id: str = Query(..., description="Dialog id hoac username"),
    min_id: int = Query(..., ge=1, description="Lay tin co id lon hon min_id"),
    limit: int = Query(default=50, ge=1, le=100),
) -> dict:
    result = await telegram_dialog_service.get_new_messages(
        phone,
        peer_id,
        min_id,
        limit,
    )
    data = DialogMessagesData(**result)
    return success_response(data.model_dump())


@router.get("/{phone}/pinned", response_model=ApiEnvelope[DialogPinnedMessagesData])
async def get_pinned_messages(
    phone: str,
    peer_id: str = Query(..., description="Dialog id hoac username"),
    limit: int = Query(default=30, ge=1, le=100),
    skip: int = Query(default=0, ge=0),
) -> dict:
    result = await telegram_dialog_service.get_pinned_messages(
        phone,
        peer_id,
        limit,
        skip,
    )
    data = DialogPinnedMessagesData(**result)
    return success_response(data.model_dump())


@router.get("/{phone}/messages", response_model=ApiEnvelope[DialogMessagesData])
async def get_dialog_messages(
    phone: str,
    peer_id: str = Query(..., description="Dialog id hoac username"),
    limit: int = Query(default=40, ge=1, le=100),
    offset_id: int = Query(
        default=0,
        ge=0,
        description="Lay tin cu hon message id nay (0 = moi nhat)",
    ),
    around_id: int = Query(
        default=0,
        ge=0,
        description="Lay tin quanh message id nay (uu tien hon offset_id)",
    ),
    offset_date: str = Query(
        default="",
        description="Lay tin tu ngay nay tro ve truoc (DD/MM/YYYY hoac YYYY-MM-DD)",
    ),
) -> dict:
    result = await telegram_dialog_service.get_messages(
        phone,
        peer_id,
        limit,
        offset_id,
        around_id,
        offset_date,
    )
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


@router.post("/{phone}/read", response_model=ApiEnvelope[MarkDialogReadData])
async def mark_dialog_read(phone: str, payload: MarkDialogReadRequest) -> dict:
    result = await telegram_dialog_service.mark_dialog_read(
        phone,
        payload.peer_id,
        payload.max_id,
    )
    data = MarkDialogReadData(**result)
    return success_response(data.model_dump())