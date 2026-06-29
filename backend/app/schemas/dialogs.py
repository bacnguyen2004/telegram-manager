from typing import Literal

from pydantic import BaseModel, Field


class DialogCounts(BaseModel):
    private: int = 0
    bot: int = 0
    group: int = 0
    channel: int = 0


class DialogItem(BaseModel):
    id: str
    entity_id: str
    title: str
    username: str
    kind: str
    is_private: bool
    is_group: bool
    is_channel: bool
    is_bot: bool
    link: str
    unread_count: int
    pinned: bool
    muted: bool
    date: str
    last_message_id: str | int
    last_message: str


class DialogsData(BaseModel):
    status: Literal["success", "error"]
    phone: str
    total: int
    counts: DialogCounts
    dialogs: list[DialogItem]
    message: str = ""


class DialogMessageItem(BaseModel):
    id: int
    date: str
    sender_id: str | int
    sender_name: str
    outgoing: bool
    content_type: str
    has_media: bool
    text: str


class DialogMessagesData(BaseModel):
    status: Literal["success", "error"]
    phone: str
    peer_id: str
    title: str
    total: int
    messages: list[DialogMessageItem]
    message: str = ""