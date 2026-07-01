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
    read_inbox_max_id: int = 0
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


class DialogReactionsPolicy(BaseModel):
    enabled: bool = True
    mode: Literal["all", "some", "none"] = "all"
    allowed_emojis: list[str] = Field(default_factory=list)
    has_custom: bool = False


class DialogMessageReactionItem(BaseModel):
    emoji: str
    count: int = 0
    chosen: bool = False


class DialogMessageItem(BaseModel):
    id: int
    date: str
    sender_id: str | int
    sender_name: str
    outgoing: bool
    content_type: str
    has_media: bool
    has_photo: bool = False
    text: str
    reactions: list[DialogMessageReactionItem] = []


class DialogMessagesData(BaseModel):
    status: Literal["success", "error"]
    phone: str
    peer_id: str
    title: str
    total: int
    messages: list[DialogMessageItem]
    has_more_older: bool = False
    reactions_policy: DialogReactionsPolicy = Field(
        default_factory=DialogReactionsPolicy
    )
    message: str = ""


class MarkDialogReadRequest(BaseModel):
    peer_id: str = Field(..., description="Dialog id hoac username")
    max_id: int = Field(default=0, ge=0, description="Tin nhan cuoi da doc; 0 = doc het")


class MarkDialogReadData(BaseModel):
    status: Literal["success", "error"]
    phone: str
    peer_id: str
    read_inbox_max_id: int = 0
    unread_count: int = 0
    message: str = ""