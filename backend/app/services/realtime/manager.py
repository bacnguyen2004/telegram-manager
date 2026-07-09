import asyncio
import json
import uuid

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from ...config import settings
from ..telegram.chats import telegram_dialog_service
from .events import (
    STREAM_EVENT_CONNECTED,
    STREAM_EVENT_ERROR,
    STREAM_EVENT_HEARTBEAT,
    STREAM_EVENT_MESSAGES,
    STREAM_EVENT_RESYNC_REQUIRED,
    filter_new_messages,
)
from .poller import iter_dialog_message_poll
from .rooms import MessageStreamRoom, PollPayload, WsSubscriber

DEFAULT_MAX_CONNECTIONS_PER_PHONE = 10
DEFAULT_PING_INTERVAL_SECONDS = 30.0


class MessageWsManager:
    def __init__(
        self,
        *,
        max_connections_per_phone: int = DEFAULT_MAX_CONNECTIONS_PER_PHONE,
        ping_interval: float = DEFAULT_PING_INTERVAL_SECONDS,
    ) -> None:
        self._rooms: dict[str, MessageStreamRoom] = {}
        self._subscriber_index: dict[str, str] = {}
        self._phone_counts: dict[str, int] = {}
        self._lock = asyncio.Lock()
        self.max_connections_per_phone = max_connections_per_phone
        self.ping_interval = ping_interval

    @staticmethod
    def room_key(phone: str, peer_id: str) -> str:
        return f"{phone.strip()}:{str(peer_id).strip()}"

    async def handle_connection(
        self,
        websocket: WebSocket,
        phone: str,
        peer_id: str,
        min_id: int,
        last_seen_id: int = 0,
    ) -> None:
        phone = phone.strip()
        peer_id = str(peer_id).strip()
        min_id = max(1, int(min_id))
        last_seen_id = max(0, int(last_seen_id or 0))
        resume_from = max(min_id, last_seen_id) if last_seen_id > 0 else min_id

        async with self._lock:
            if self._phone_counts.get(phone, 0) >= self.max_connections_per_phone:
                await websocket.accept()
                await websocket.send_json(
                    {
                        "type": STREAM_EVENT_ERROR,
                        "message": "Vuot gioi han ket noi realtime cho account nay",
                    }
                )
                await websocket.close(code=1008)
                return

        await websocket.accept()
        subscriber_id = uuid.uuid4().hex
        room_key = self.room_key(phone, peer_id)

        async with self._lock:
            room = self._rooms.get(room_key)
            if room is None:
                room = MessageStreamRoom(phone=phone, peer_id=peer_id, cursor=resume_from)
                self._rooms[room_key] = room
            elif resume_from > room.cursor:
                room.cursor = resume_from

            room.subscribers[subscriber_id] = WsSubscriber(
                websocket=websocket,
                subscriber_id=subscriber_id,
                min_id=min_id,
                last_seen_id=resume_from,
            )
            self._subscriber_index[subscriber_id] = room_key
            self._phone_counts[phone] = self._phone_counts.get(phone, 0) + 1
            self._ensure_room_tasks(room, room_key, phone)

        subscriber = room.subscribers[subscriber_id]

        if resume_from < room.cursor:
            await self._send(
                subscriber,
                {
                    "type": STREAM_EVENT_RESYNC_REQUIRED,
                    "cursor": room.cursor,
                    "message": "Can tai lai tin nhan",
                },
            )
        else:
            await self._send_gap_fill(subscriber, room, resume_from)

        await self._send(
            subscriber,
            {
                "type": STREAM_EVENT_CONNECTED,
                "cursor": room.cursor,
                "mode": settings.realtime_mode,
            },
        )

        try:
            while True:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                await self._handle_client_message(subscriber_id, room_key, message)
        except WebSocketDisconnect:
            pass
        finally:
            await self._unsubscribe(subscriber_id)

    async def _handle_client_message(
        self,
        subscriber_id: str,
        room_key: str,
        message: dict,
    ) -> None:
        if message.get("type") != "websocket.receive":
            return

        text = message.get("text")
        if not text:
            return

        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return

        if payload.get("type") != "resume":
            return

        last_seen_id = int(payload.get("last_seen_id") or 0)
        if last_seen_id < 1:
            return

        async with self._lock:
            room = self._rooms.get(room_key)
            subscriber = (
                room.subscribers.get(subscriber_id)
                if room is not None
                else None
            )
        if room is None or subscriber is None:
            return

        subscriber.last_seen_id = max(subscriber.last_seen_id, last_seen_id)
        if last_seen_id < room.cursor:
            await self._send(
                subscriber,
                {
                    "type": STREAM_EVENT_RESYNC_REQUIRED,
                    "cursor": room.cursor,
                    "message": "Can tai lai tin nhan",
                },
            )
            return

        await self._send_gap_fill(subscriber, room, last_seen_id)

    async def _send_gap_fill(
        self,
        subscriber: WsSubscriber,
        room: MessageStreamRoom,
        last_seen_id: int,
    ) -> None:
        result = await telegram_dialog_service.get_new_messages(
            room.phone,
            room.peer_id,
            last_seen_id,
            50,
        )
        if result.get("status") != "success":
            return

        messages = result.get("messages") or []
        if not messages:
            return

        fresh = filter_new_messages(room.seen_message_ids, messages)
        if not fresh:
            return

        room.cursor = max(room.cursor, max(int(item["id"]) for item in fresh))
        latest = fresh[-1]
        preview = telegram_dialog_service.dialog_preview_from_row(latest)
        preview["peer_id"] = room.peer_id

        await self._send(
            subscriber,
            {
                "type": STREAM_EVENT_MESSAGES,
                "messages": fresh,
                "dialog_preview": preview,
                "gap_fill": True,
            },
        )

    def _ensure_room_tasks(
        self,
        room: MessageStreamRoom,
        room_key: str,
        phone: str,
    ) -> None:
        if settings.realtime_use_listener:
            asyncio.create_task(self._ensure_listener(room, room_key, phone))
        elif room.poll_task is None or room.poll_task.done():
            room.poll_task = asyncio.create_task(self._poll_room(room_key))

        if room.ping_task is None or room.ping_task.done():
            room.ping_task = asyncio.create_task(self._ping_room(room_key))

    async def _ensure_listener(
        self,
        room: MessageStreamRoom,
        room_key: str,
        phone: str,
    ) -> None:
        from ..telegram.listener import telegram_listener

        started = await telegram_listener.ensure_listening(phone)
        if settings.realtime_mode == "hybrid":
            if room.poll_task is None or room.poll_task.done():
                room.poll_task = asyncio.create_task(self._poll_room(room_key))
            return

        if not started and (
            room.poll_task is None or room.poll_task.done()
        ):
            room.poll_task = asyncio.create_task(self._poll_room(room_key))

    async def _unsubscribe(self, subscriber_id: str) -> None:
        async with self._lock:
            room_key = self._subscriber_index.pop(subscriber_id, None)
            if not room_key:
                return

            room = self._rooms.get(room_key)
            if not room:
                return

            subscriber = room.subscribers.pop(subscriber_id, None)
            if subscriber is None:
                return

            phone = room.phone
            self._phone_counts[phone] = max(0, self._phone_counts.get(phone, 1) - 1)
            phone_has_connections = self._phone_counts.get(phone, 0) > 0
            if not phone_has_connections:
                self._phone_counts.pop(phone, None)

            if room.subscribers:
                return

            if room.poll_task and not room.poll_task.done():
                room.poll_task.cancel()
            if room.ping_task and not room.ping_task.done():
                room.ping_task.cancel()
            self._rooms.pop(room_key, None)

            if settings.realtime_use_listener and not phone_has_connections:
                from ..telegram.listener import telegram_listener

                asyncio.create_task(telegram_listener.schedule_stop(phone))

    async def publish_incoming_message(
        self,
        phone: str,
        peer_id: str,
        messages: list[dict],
        preview: dict | None,
    ) -> None:
        if not messages:
            return

        room_key = self.room_key(phone, peer_id)
        room = self._rooms.get(room_key)
        if not room:
            return

        fresh = filter_new_messages(room.seen_message_ids, messages)
        if not fresh:
            return

        room.cursor = max(
            room.cursor,
            max(int(item["id"]) for item in fresh),
        )
        await self._broadcast_room(
            room_key,
            {
                "type": STREAM_EVENT_MESSAGES,
                "messages": fresh,
                "dialog_preview": preview,
            },
        )

    async def publish_room_event(self, phone: str, peer_id: str, payload: PollPayload) -> None:
        room_key = self.room_key(phone, peer_id)
        if room_key not in self._rooms:
            return
        await self._broadcast_room(room_key, payload)

    async def publish_edited(
        self,
        phone: str,
        peer_id: str,
        message: dict,
    ) -> None:
        await self.publish_room_event(
            phone,
            peer_id,
            {"type": "edited", "message": message},
        )

    async def publish_deleted(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
    ) -> None:
        await self.publish_room_event(
            phone,
            peer_id,
            {"type": "deleted", "message_id": int(message_id)},
        )

    async def publish_reaction(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
        reactions: list[dict],
    ) -> None:
        await self.publish_room_event(
            phone,
            peer_id,
            {
                "type": "reaction",
                "message_id": int(message_id),
                "reactions": reactions,
            },
        )

    async def publish_read(
        self,
        phone: str,
        peer_id: str,
        *,
        max_id: int,
        unread_count: int = 0,
    ) -> None:
        await self.publish_room_event(
            phone,
            peer_id,
            {
                "type": "read",
                "max_id": int(max_id),
                "unread_count": max(0, int(unread_count)),
            },
        )

    def _room_has_subscribers(self, room_key: str) -> bool:
        room = self._rooms.get(room_key)
        return bool(room and room.subscribers)

    async def _poll_room(self, room_key: str) -> None:
        try:
            room = self._rooms.get(room_key)
            if not room:
                return

            async for payload in iter_dialog_message_poll(
                room.phone,
                room.peer_id,
                room.cursor,
                is_cancelled=lambda: not self._room_has_subscribers(room_key),
            ):
                event_type = payload.get("type")
                if event_type == STREAM_EVENT_CONNECTED:
                    continue

                current_room = self._rooms.get(room_key)
                if not current_room:
                    break

                if event_type == STREAM_EVENT_MESSAGES:
                    messages = payload.get("messages") or []
                    fresh = filter_new_messages(current_room.seen_message_ids, messages)
                    if not fresh:
                        continue
                    payload = {
                        **payload,
                        "messages": fresh,
                    }
                    current_room.cursor = max(
                        current_room.cursor,
                        max(int(item["id"]) for item in fresh),
                    )

                await self._broadcast_room(room_key, payload)
        except asyncio.CancelledError:
            return

    async def _ping_room(self, room_key: str) -> None:
        try:
            while self._room_has_subscribers(room_key):
                await asyncio.sleep(self.ping_interval)
                if not self._room_has_subscribers(room_key):
                    break
                await self._broadcast_room(room_key, {"type": STREAM_EVENT_HEARTBEAT})
        except asyncio.CancelledError:
            return

    async def _broadcast_room(self, room_key: str, payload: PollPayload) -> None:
        room = self._rooms.get(room_key)
        if not room:
            return

        dead: list[str] = []
        for subscriber_id, subscriber in list(room.subscribers.items()):
            if not await self._send(subscriber, payload):
                dead.append(subscriber_id)

        for subscriber_id in dead:
            await self._unsubscribe(subscriber_id)

    async def _send(self, subscriber: WsSubscriber, payload: PollPayload) -> bool:
        if subscriber.websocket.client_state != WebSocketState.CONNECTED:
            return False
        try:
            await subscriber.websocket.send_json(payload)
            if payload.get("type") == STREAM_EVENT_MESSAGES:
                for item in payload.get("messages") or []:
                    message_id = int(item.get("id") or 0)
                    if message_id > 0:
                        subscriber.last_seen_id = max(
                            subscriber.last_seen_id,
                            message_id,
                        )
            return True
        except Exception:
            return False


message_ws_manager = MessageWsManager()
