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


class SendMessageData(BaseModel):
    status: Literal["success", "error"]
    phone: str
    peer_id: str
    message_id: int | None = None
    message: str