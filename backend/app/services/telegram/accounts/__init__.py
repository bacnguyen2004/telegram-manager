from ....config import settings
from .auth import TelegramAuthService
from .privacy import PrivacyService
from .profile import ProfileService
from .sessions import SessionService


class TelegramAuthServiceFacade(PrivacyService, TelegramAuthService):
    """Auth + privacy (2FA / invite privacy)."""


class TelegramSessionService(ProfileService, SessionService):
    """Session CRUD + profile/avatar/authorizations."""


telegram_auth_service = TelegramAuthServiceFacade(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)

telegram_session_service = TelegramSessionService(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)

__all__ = [
    "PrivacyService",
    "ProfileService",
    "SessionService",
    "TelegramAuthService",
    "TelegramAuthServiceFacade",
    "TelegramSessionService",
    "telegram_auth_service",
    "telegram_session_service",
]
