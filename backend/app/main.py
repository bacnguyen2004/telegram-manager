from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import settings
from .db import init_db
from .routers import api_router
from .services.conversation import conversation_job_store
from .utils.exceptions import register_exception_handlers


SETUP_STEPS = [
    "1. Dien TELEGRAM_API_ID + TELEGRAM_API_HASH trong .env (lay tu https://my.telegram.org)",
    "2. POST /api/auth/send-code — gui OTP ve Telegram app",
    "3. POST /api/auth/login — nhap ma OTP (va password 2FA neu co)",
    "4. GET /api/sessions — xac nhan da co file .session",
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_runtime_dirs()
    init_db()
    conversation_job_store.recover_orphaned_jobs()
    yield
    from .services.telegram.listener import telegram_listener
    from .services.telegram.pool import telethon_client_pool

    await telegram_listener.shutdown()
    await telethon_client_pool.shutdown()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
register_exception_handlers(app)
app.include_router(api_router, prefix=settings.api_prefix)


@app.get("/")
async def root() -> dict:
    return {
        "app": settings.app_name,
        "docs": "/docs",
        "api_prefix": settings.api_prefix,
        "note": (
            "Dang nhap Telegram tren dien thoai KHONG tu dong tao session cho API. "
            "Can buoc 2-3 ben duoi."
        ),
        "setup": SETUP_STEPS,
    }