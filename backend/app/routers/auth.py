from fastapi import APIRouter

from ..schemas.auth import (
    LoginCodeData,
    LoginData,
    LoginRequest,
    RegisterData,
    RegisterRequest,
    SendCodeData,
    SendCodeRequest,
    Update2faData,
    Update2faRequest,
    UpdatePrivacyData,
    UpdatePrivacyRequest,
)
from ..schemas.common import ApiEnvelope
from ..services.telegram import telegram_auth_service
from ..utils.responses import success_response


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/send-code", response_model=ApiEnvelope[SendCodeData])
async def send_code(payload: SendCodeRequest) -> dict:
    result = await telegram_auth_service.send_code(payload.phone)
    data = SendCodeData(**result)
    return success_response(data.model_dump())


@router.post("/login", response_model=ApiEnvelope[LoginData])
async def login(payload: LoginRequest) -> dict:
    result = await telegram_auth_service.login(
        payload.phone, payload.code, payload.password
    )
    data = LoginData(**result)
    return success_response(data.model_dump())


@router.post("/register", response_model=ApiEnvelope[RegisterData])
async def register(payload: RegisterRequest) -> dict:
    result = await telegram_auth_service.register(
        payload.phone,
        payload.code,
        payload.first_name,
        payload.last_name,
    )
    data = RegisterData(**result)
    return success_response(data.model_dump())


@router.get("/login-code/{phone}", response_model=ApiEnvelope[LoginCodeData])
async def get_login_code(phone: str) -> dict:
    result = await telegram_auth_service.get_login_code(phone)
    data = LoginCodeData(**result)
    return success_response(data.model_dump())


@router.put("/2fa", response_model=ApiEnvelope[Update2faData])
async def update_2fa(payload: Update2faRequest) -> dict:
    result = await telegram_auth_service.update_2fa(
        payload.phone,
        payload.new_password,
        payload.current_password,
        payload.hint,
    )
    data = Update2faData(**result)
    return success_response(data.model_dump())


@router.put("/privacy", response_model=ApiEnvelope[UpdatePrivacyData])
async def update_privacy(payload: UpdatePrivacyRequest) -> dict:
    result = await telegram_auth_service.update_privacy(payload.phone, payload.rule_type)
    data = UpdatePrivacyData(**result)
    return success_response(data.model_dump())