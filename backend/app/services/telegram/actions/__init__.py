from ....config import settings
from .base import MessageActionBase
from .forwarding import ForwardingService
from .media import MediaActionService
from .polls import PollActionService
from .reactions import ReactionActionService
from .groups import TelegramGroupService, telegram_group_service
from .text import TextActionService


class TelegramMessageService(
    TextActionService,
    MediaActionService,
    ForwardingService,
    ReactionActionService,
    PollActionService,
):
    """Facade combining message action domains (text/media/forward/react/poll)."""


telegram_message_service = TelegramMessageService(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)

__all__ = [
    "TelegramGroupService",
    "telegram_group_service",
    "ForwardingService",
    "MediaActionService",
    "MessageActionBase",
    "PollActionService",
    "ReactionActionService",
    "TelegramMessageService",
    "TextActionService",
    "telegram_message_service",
]
