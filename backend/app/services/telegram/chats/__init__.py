from ....config import settings
from .dialogs import DialogService
from .media_reader import MediaReaderService
from .messages_reader import MessagesReaderService
from .serializer import ChatSerializer


class TelegramDialogService(
    MessagesReaderService,
    MediaReaderService,
    DialogService,
):
    """Facade for dialog list, message read, and media download."""


telegram_dialog_service = TelegramDialogService(
    settings.telegram_api_id,
    settings.telegram_api_hash,
    settings.session_dir,
)

__all__ = [
    "ChatSerializer",
    "DialogService",
    "MediaReaderService",
    "MessagesReaderService",
    "TelegramDialogService",
    "telegram_dialog_service",
]
