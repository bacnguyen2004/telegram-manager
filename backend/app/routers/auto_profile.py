from fastapi import APIRouter

from ..schemas.auto_profile import (
    AutoProfileApplyData,
    AutoProfileApplyRequest,
    AutoProfilePreviewData,
    AutoProfilePreviewRequest,
    AutoProfileRow,
)
from ..schemas.common import ApiEnvelope
from ..services.auto_profile import ProfileRatios, apply_profile_row, generate_preview
from ..utils.responses import success_response

router = APIRouter(prefix="/auto-profile", tags=["auto-profile"])


def _ratios_from_payload(payload: AutoProfilePreviewRequest) -> ProfileRatios | None:
    if payload.ratios is None:
        return None
    r = payload.ratios
    return ProfileRatios(
        bio_empty=r.bio_empty,
        bio_short=r.bio_short,
        bio_template=r.bio_template,
        avatar_keep=r.avatar_keep,
        avatar_dicebear=r.avatar_dicebear,
        avatar_picsum=r.avatar_picsum,
        avatar_ui=r.avatar_ui,
        mix_global=r.mix_global,
        mix_vietnam=r.mix_vietnam,
    )


@router.post("/preview", response_model=ApiEnvelope[AutoProfilePreviewData])
async def preview_auto_profiles(payload: AutoProfilePreviewRequest) -> dict:
    rows = generate_preview(
        payload.phones,
        region=payload.region,
        delete_old_avatar=payload.delete_old_avatar,
        ratios=_ratios_from_payload(payload),
    )
    items = [AutoProfileRow(**row.to_dict()) for row in rows]
    data = AutoProfilePreviewData(total=len(items), items=items)
    return success_response(data.model_dump())


@router.post("/apply", response_model=ApiEnvelope[AutoProfileApplyData])
async def apply_auto_profile(payload: AutoProfileApplyRequest) -> dict:
    result = await apply_profile_row(payload.model_dump())
    data = AutoProfileApplyData(
        status=str(result.get("status") or "error"),
        phone=str(result.get("phone") or payload.phone),
        message=str(result.get("message") or ""),
        applied_username=result.get("applied_username"),
        profile=result.get("profile"),
        avatar=result.get("avatar"),
    )
    return success_response(data.model_dump())
