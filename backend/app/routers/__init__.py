from fastapi import APIRouter

from . import (
    auth,
    auto_profile,
    campaign,
    dialogs,
    groups,
    health,
    messages,
    metadata,
    proxies,
    roster,
    sessions,
)


api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(sessions.router)
api_router.include_router(groups.router)
api_router.include_router(dialogs.router)
api_router.include_router(messages.router)
api_router.include_router(metadata.router)
api_router.include_router(roster.router)
api_router.include_router(proxies.router)
api_router.include_router(auto_profile.router)
api_router.include_router(campaign.router)