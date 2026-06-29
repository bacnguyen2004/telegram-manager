from typing import Literal

from pydantic import BaseModel, Field


class JoinGroupRequest(BaseModel):
    phone: str = Field(..., examples=["+84901234567"])
    group_link: str = Field(
        ...,
        examples=["https://t.me/example_group", "https://t.me/+invite_hash"],
    )
    captcha_enabled: bool = False
    captcha_timeout: int = Field(default=60, ge=0, le=300)


class LeaveGroupRequest(BaseModel):
    phone: str = Field(..., examples=["+84901234567"])
    group_link: str = Field(
        ...,
        description="Link t.me, username, hoac ID nhóm",
        examples=["https://t.me/example_group"],
    )


class LeaveAllGroupsRequest(BaseModel):
    phone: str = Field(..., examples=["+84901234567"])


class LeaveAllGroupsData(BaseModel):
    status: Literal["success", "error"]
    phone: str
    left_count: int
    message: str


class GroupActionData(BaseModel):
    status: Literal["success", "info", "error"]
    phone: str
    group_link: str
    message: str


class GroupItem(BaseModel):
    id: int
    title: str
    username: str
    link: str
    members_count: int
    is_channel: bool
    type: str


class GroupsData(BaseModel):
    status: Literal["success", "error"]
    phone: str
    total: int
    groups: list[GroupItem]
    message: str = ""