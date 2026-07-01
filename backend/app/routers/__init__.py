from fastapi import APIRouter

from . import auth, dialogs, groups, health, messages, metadata, sessions


api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(sessions.router)
api_router.include_router(groups.router)
api_router.include_router(dialogs.router)
api_router.include_router(messages.router)
api_router.include_router(metadata.router)