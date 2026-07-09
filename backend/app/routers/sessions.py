from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from ..schemas.common import ApiEnvelope
from ..schemas.sessions import (
    CheckSessionsData,
    CheckSessionsRequest,
    DeleteSessionData,
    RevokeAuthorizationData,
    SessionAuthorizationsData,
    SessionDetailData,
    SessionMeData,
    SessionsData,
    UpdateSessionAvatarData,
    UpdateSessionProfileData,
    UpdateSessionProfileRequest,
)
from ..services.telegram import telegram_session_service
from ..utils.responses import success_response


router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("", response_model=ApiEnvelope[SessionsData])
async def list_sessions() -> dict:
    result = telegram_session_service.list_sessions()
    data = SessionsData(**result)
    return success_response(data.model_dump())


@router.post("/check", response_model=ApiEnvelope[CheckSessionsData])
async def check_sessions(payload: CheckSessionsRequest | None = None) -> dict:
    phones = payload.phones if payload else None
    result = await telegram_session_service.check_sessions(phones)
    data = CheckSessionsData(**result)
    return success_response(data.model_dump())


@router.get("/{phone}", response_model=ApiEnvelope[SessionDetailData])
async def get_session(phone: str) -> dict:
    result = telegram_session_service.get_session(phone)
    data = SessionDetailData(**result)
    return success_response(data.model_dump())


@router.delete("/{phone}", response_model=ApiEnvelope[DeleteSessionData])
async def delete_session(phone: str) -> dict:
    result = await telegram_session_service.delete_session(phone)
    data = DeleteSessionData(**result)
    return success_response(data.model_dump())


@router.get("/{phone}/avatar")
async def get_session_avatar(phone: str) -> Response:
    result = telegram_session_service.get_avatar_bytes(phone)
    if isinstance(result, dict):
        raise HTTPException(status_code=404, detail=result.get("message", "Not found"))
    content, mime_type = result
    return Response(content=content, media_type=mime_type)


@router.get("/{phone}/me", response_model=ApiEnvelope[SessionMeData])
async def get_session_me(phone: str) -> dict:
    result = await telegram_session_service.get_me(phone)
    data = SessionMeData(**result)
    return success_response(data.model_dump())


@router.patch("/{phone}/profile", response_model=ApiEnvelope[UpdateSessionProfileData])
async def update_session_profile(
    phone: str,
    payload: UpdateSessionProfileRequest,
) -> dict:
    result = await telegram_session_service.update_profile(
        phone,
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        username=payload.username.strip().lstrip("@"),
        about=payload.about.strip(),
    )
    data = UpdateSessionProfileData(**result)
    return success_response(data.model_dump())


@router.post("/{phone}/avatar", response_model=ApiEnvelope[UpdateSessionAvatarData])
async def upload_session_avatar(
    phone: str,
    file: UploadFile = File(..., description="Anh JPG/PNG lam avatar Telegram"),
) -> dict:
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in {"image/jpeg", "image/jpg", "image/png", "image/webp"}:
        data = UpdateSessionAvatarData(
            status="error",
            phone=phone,
            message="Chi ho tro anh JPG, PNG hoac WebP",
        )
        return success_response(data.model_dump())

    file_bytes = await file.read()
    if not file_bytes:
        data = UpdateSessionAvatarData(
            status="error",
            phone=phone,
            message="File anh trong",
        )
        return success_response(data.model_dump())
    if len(file_bytes) > 10 * 1024 * 1024:
        data = UpdateSessionAvatarData(
            status="error",
            phone=phone,
            message="Anh toi da 10MB",
        )
        return success_response(data.model_dump())

    result = await telegram_session_service.upload_avatar(phone, file_bytes)
    data = UpdateSessionAvatarData(**result)
    return success_response(data.model_dump())


@router.delete("/{phone}/avatar", response_model=ApiEnvelope[UpdateSessionAvatarData])
async def delete_session_avatar(phone: str) -> dict:
    result = await telegram_session_service.delete_avatar(phone)
    data = UpdateSessionAvatarData(**result)
    return success_response(data.model_dump())


@router.get("/{phone}/authorizations", response_model=ApiEnvelope[SessionAuthorizationsData])
async def list_session_authorizations(phone: str) -> dict:
    result = await telegram_session_service.list_authorizations(phone)
    data = SessionAuthorizationsData(**result)
    return success_response(data.model_dump())


@router.delete(
    "/{phone}/authorizations/{auth_hash}",
    response_model=ApiEnvelope[RevokeAuthorizationData],
)
async def revoke_session_authorization(phone: str, auth_hash: str) -> dict:
    result = await telegram_session_service.revoke_authorization(phone, auth_hash)
    data = RevokeAuthorizationData(**result)
    return success_response(data.model_dump())