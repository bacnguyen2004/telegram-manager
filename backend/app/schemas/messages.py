from typing import Literal

from pydantic import BaseModel, Field


class SendMessageRequest(BaseModel):
    phone: str = Field(..., examples=["+84901234567"])
    peer_id: str = Field(
        ...,
        description="Dialog id, username hoac link t.me",
        examples=["123456789", "@username"],
    )
    text: str = Field(..., min_length=1, max_length=4096)


class ReplyMessageRequest(BaseModel):
    phone: str = Field(..., examples=["+84901234567"])
    peer_id: str = Field(
        ...,
        description="Dialog id, username hoac link t.me",
        examples=["123456789", "@username"],
    )
    reply_to_msg_id: int = Field(..., ge=1, description="ID tin nhan can tra loi")
    text: str = Field(..., min_length=1, max_length=4096)


class MessageActionData(BaseModel):
    status: Literal["success", "error"]
    phone: str
    peer_id: str
    message_id: int | None = None
    reply_to_msg_id: int | None = None
    message: str


class SendMessageData(MessageActionData):
    pass


class ReactMessageRequest(BaseModel):
    phone: str = Field(..., examples=["+84901234567"])
    peer_id: str = Field(
        ...,
        description="Dialog id, username hoac link t.me",
        examples=["123456789", "@username"],
    )
    message_id: int = Field(..., ge=1, description="ID tin nhan can react")
    emoji: str = Field(
        ...,
        min_length=1,
        max_length=16,
        description="Emoji reaction, vi du: thumbs up",
        examples=["👍", "❤️", "🔥"],
    )


class ReactMessageData(MessageActionData):
    emoji: str | None = None