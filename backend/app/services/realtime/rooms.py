import asyncio
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket


PollPayload = dict[str, Any]


@dataclass
class WsSubscriber:
    websocket: WebSocket
    subscriber_id: str
    min_id: int
    last_seen_id: int


@dataclass
class MessageStreamRoom:
    phone: str
    peer_id: str
    cursor: int
    subscribers: dict[str, WsSubscriber] = field(default_factory=dict)
    poll_task: asyncio.Task[None] | None = None
    ping_task: asyncio.Task[None] | None = None
    seen_message_ids: set[int] = field(default_factory=set)
