from fastapi import APIRouter, Query

from ..schemas.common import ApiEnvelope
from ..schemas.groups import (
    GroupActionData,
    GroupsData,
    JoinGroupRequest,
    LeaveGroupRequest,
)
from ..services.telegram.groups import telegram_group_service
from ..utils.responses import success_response


router = APIRouter(prefix="/groups", tags=["groups"])


@router.post("/join", response_model=ApiEnvelope[GroupActionData])
async def join_group(payload: JoinGroupRequest) -> dict:
    result = await telegram_group_service.join_group(
        payload.phone,
        payload.group_link,
        payload.captcha_enabled,
        payload.captcha_timeout,
    )
    data = GroupActionData(**result)
    return success_response(data.model_dump())


@router.post("/leave", response_model=ApiEnvelope[GroupActionData])
async def leave_group(payload: LeaveGroupRequest) -> dict:
    result = await telegram_group_service.leave_group(
        payload.phone,
        payload.group_link,
    )
    data = GroupActionData(**result)
    return success_response(data.model_dump())


@router.get("/{phone}", response_model=ApiEnvelope[GroupsData])
async def list_groups(
    phone: str,
    limit: int = Query(default=1000, ge=1, le=5000),
) -> dict:
    result = await telegram_group_service.list_groups(phone, limit)
    data = GroupsData(**result)
    return success_response(data.model_dump())