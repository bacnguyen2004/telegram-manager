import asyncio
import logging
from typing import Any, Callable

from telethon import events

from ....config import settings
from ..chats import telegram_dialog_service
from ..client import telethon_client_pool

logger = logging.getLogger(__name__)

HandlerList = list[tuple[Any, Callable[..., Any]]]


class TelegramListenerService:
    def __init__(self) -> None:
        self._active_phones: set[str] = set()
        self._handlers: dict[str, HandlerList] = {}
        self._stop_tasks: dict[str, asyncio.Task[None]] = {}
        self._watch_tasks: dict[str, asyncio.Task[None]] = {}
        self._start_tasks: dict[str, asyncio.Task[bool]] = {}
        self._lock = asyncio.Lock()

    @property
    def enabled(self) -> bool:
        return settings.realtime_use_listener

    @property
    def idle_seconds(self) -> float:
        return settings.telegram_listener_idle_seconds

    @property
    def reconnect_seconds(self) -> float:
        return settings.telegram_listener_reconnect_seconds

    def is_listening(self, phone: str) -> bool:
        return phone.strip() in self._active_phones

    async def ensure_listening(self, phone: str) -> bool:
        if not self.enabled:
            return False

        phone = phone.strip()
        if not phone:
            return False

        async with self._lock:
            stop_task = self._stop_tasks.pop(phone, None)
            if stop_task and not stop_task.done():
                stop_task.cancel()

            if phone in self._active_phones:
                return True

            existing = self._start_tasks.get(phone)
            if existing is not None and not existing.done():
                start_task = existing
            else:
                start_task = asyncio.create_task(self._start_listener_safe(phone))
                self._start_tasks[phone] = start_task

        try:
            return await start_task
        finally:
            async with self._lock:
                current = self._start_tasks.get(phone)
                if current is start_task:
                    self._start_tasks.pop(phone, None)

    async def _start_listener_safe(self, phone: str) -> bool:
        try:
            await self._start_listener(phone)
            return True
        except Exception as exc:
            logger.warning("Khong khoi tao listener cho %s: %s", phone, exc)
            return False

    async def _start_listener(self, phone: str) -> None:
        client = await telethon_client_pool.acquire_listener(phone)
        handlers: HandlerList = []

        async def on_new_message(event: events.NewMessage.Event) -> None:
            try:
                await self._handle_new_message(phone, event)
            except Exception:
                logger.exception("Loi xu ly NewMessage cho %s", phone)

        async def on_message_edited(event: events.MessageEdited.Event) -> None:
            try:
                await self._handle_message_edited(phone, event)
            except Exception:
                logger.exception("Loi xu ly MessageEdited cho %s", phone)

        async def on_message_deleted(event: events.MessageDeleted.Event) -> None:
            try:
                await self._handle_message_deleted(phone, event)
            except Exception:
                logger.exception("Loi xu ly MessageDeleted cho %s", phone)

        async def on_message_read(event: events.MessageRead.Event) -> None:
            try:
                await self._handle_message_read(phone, event)
            except Exception:
                logger.exception("Loi xu ly MessageRead cho %s", phone)

        client.add_event_handler(on_new_message, events.NewMessage())
        client.add_event_handler(on_message_edited, events.MessageEdited())
        client.add_event_handler(on_message_deleted, events.MessageDeleted())
        client.add_event_handler(on_message_read, events.MessageRead())
        handlers.extend(
            [
                (events.NewMessage(), on_new_message),
                (events.MessageEdited(), on_message_edited),
                (events.MessageDeleted(), on_message_deleted),
                (events.MessageRead(), on_message_read),
            ]
        )

        async with self._lock:
            self._handlers[phone] = handlers
            self._active_phones.add(phone)
            if phone not in self._watch_tasks or self._watch_tasks[phone].done():
                self._watch_tasks[phone] = asyncio.create_task(self._watch_connection(phone))

    async def _watch_connection(self, phone: str) -> None:
        try:
            while phone in self._active_phones:
                await asyncio.sleep(self.reconnect_seconds)
                if phone not in self._active_phones:
                    break

                client = await telethon_client_pool.get_client_if_connected(phone)
                if client is not None and client.is_connected():
                    continue

                logger.warning("Telethon listener mat ket noi %s, dang reconnect", phone)
                await self._restart_listener(phone)
        except asyncio.CancelledError:
            return

    async def _restart_listener(self, phone: str) -> None:
        # Release the previous acquire so listener_refs does not climb forever.
        await self._teardown_handlers(phone, release_client=True)
        try:
            await self._start_listener(phone)
        except Exception:
            logger.exception("Reconnect listener that bai cho %s", phone)
            async with self._lock:
                self._active_phones.discard(phone)

    async def schedule_stop(self, phone: str) -> None:
        if not self.enabled:
            return

        phone = phone.strip()
        if not phone:
            return

        async with self._lock:
            existing = self._stop_tasks.get(phone)
            if existing and not existing.done():
                return
            self._stop_tasks[phone] = asyncio.create_task(self._stop_after_idle(phone))

    async def _stop_after_idle(self, phone: str) -> None:
        try:
            await asyncio.sleep(self.idle_seconds)
            await self.stop_listening(phone)
        except asyncio.CancelledError:
            return

    async def stop_listening(self, phone: str) -> None:
        phone = phone.strip()
        async with self._lock:
            self._stop_tasks.pop(phone, None)
            watch_task = self._watch_tasks.pop(phone, None)
            if watch_task and not watch_task.done():
                watch_task.cancel()
            start_task = self._start_tasks.pop(phone, None)
            if start_task and not start_task.done():
                start_task.cancel()

        await self._teardown_handlers(phone, release_client=True)

    async def _teardown_handlers(self, phone: str, *, release_client: bool) -> None:
        async with self._lock:
            if phone not in self._active_phones and phone not in self._handlers:
                return
            handlers = self._handlers.pop(phone, [])
            self._active_phones.discard(phone)

        client = await telethon_client_pool.get_client_if_connected(phone)
        if client is not None:
            for event_cls, handler in handlers:
                try:
                    client.remove_event_handler(handler, event_cls)
                except Exception:
                    logger.exception("Loi go listener handler cho %s", phone)

        if release_client:
            try:
                await telethon_client_pool.release_listener(phone)
            except Exception:
                logger.exception("Loi release listener client cho %s", phone)

    async def shutdown(self) -> None:
        async with self._lock:
            phones = list(self._active_phones)
            for task in self._stop_tasks.values():
                if not task.done():
                    task.cancel()
            for task in self._watch_tasks.values():
                if not task.done():
                    task.cancel()
            for task in self._start_tasks.values():
                if not task.done():
                    task.cancel()
            self._stop_tasks.clear()
            self._watch_tasks.clear()
            self._start_tasks.clear()

        for phone in phones:
            await self.stop_listening(phone)

    async def _build_message_row(self, phone: str, message) -> dict | None:
        if not message or not getattr(message, "id", None):
            return None

        async with telethon_client_pool.locked_client(phone) as client:
            me = await client.get_me()
            me_id = getattr(me, "id", None)
            sender_names = await telegram_dialog_service.resolve_sender_names(
                client,
                [message],
            )
            return telegram_dialog_service.build_message_row(
                message,
                me_id=me_id,
                sender_names=sender_names,
            )

    async def _handle_new_message(
        self,
        phone: str,
        event: events.NewMessage.Event,
    ) -> None:
        peer_id = self._peer_id_from_event(event)
        if not peer_id:
            return

        row = await self._build_message_row(phone, event.message)
        if row is None:
            return

        preview = telegram_dialog_service.dialog_preview_from_row(row)
        preview["peer_id"] = peer_id

        from ...realtime.manager import message_ws_manager

        await message_ws_manager.publish_incoming_message(
            phone,
            peer_id,
            [row],
            preview,
        )

    async def _handle_message_edited(
        self,
        phone: str,
        event: events.MessageEdited.Event,
    ) -> None:
        peer_id = self._peer_id_from_event(event)
        if not peer_id:
            return

        row = await self._build_message_row(phone, event.message)
        if row is None:
            return

        from ...realtime.manager import message_ws_manager

        await message_ws_manager.publish_edited(phone, peer_id, row)

        if row.get("reactions"):
            await message_ws_manager.publish_reaction(
                phone,
                peer_id,
                int(row["id"]),
                row.get("reactions") or [],
            )

    async def _handle_message_deleted(
        self,
        phone: str,
        event: events.MessageDeleted.Event,
    ) -> None:
        peer_id = str(getattr(event, "chat_id", "") or "")
        if not peer_id:
            return

        deleted_ids = getattr(event, "deleted_ids", None) or []
        if not deleted_ids:
            return

        from ...realtime.manager import message_ws_manager

        for message_id in deleted_ids:
            await message_ws_manager.publish_deleted(phone, peer_id, int(message_id))

    async def _handle_message_read(
        self,
        phone: str,
        event: events.MessageRead.Event,
    ) -> None:
        peer_id = str(getattr(event, "chat_id", "") or "")
        max_id = int(getattr(event, "max_id", 0) or 0)
        if not peer_id or max_id < 1:
            return

        from ...realtime.manager import message_ws_manager

        await message_ws_manager.publish_read(
            phone,
            peer_id,
            max_id=max_id,
            unread_count=0,
        )

    @staticmethod
    def _peer_id_from_event(event) -> str:
        chat_id = getattr(event, "chat_id", None)
        if chat_id is not None:
            return str(chat_id)

        message = getattr(event, "message", None)
        peer = getattr(message, "peer_id", None) if message is not None else None
        if peer is not None:
            from telethon.utils import get_peer_id

            return str(get_peer_id(peer))

        return ""


telegram_listener = TelegramListenerService()
