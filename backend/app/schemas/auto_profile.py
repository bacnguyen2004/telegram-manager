from typing import Literal

from pydantic import BaseModel, Field


class AutoProfileRatios(BaseModel):
    bio_empty: float = Field(default=25, ge=0, le=100)
    bio_short: float = Field(default=45, ge=0, le=100)
    bio_template: float = Field(default=30, ge=0, le=100)
    avatar_keep: float = Field(default=35, ge=0, le=100)
    avatar_dicebear: float = Field(default=35, ge=0, le=100)
    avatar_picsum: float = Field(default=15, ge=0, le=100)
    avatar_ui: float = Field(default=15, ge=0, le=100)
    mix_global: float = Field(default=50, ge=0, le=100)
    mix_vietnam: float = Field(default=50, ge=0, le=100)


class AutoProfilePreviewRequest(BaseModel):
    phones: list[str] = Field(..., min_length=1, max_length=200)
    region: Literal["global", "vietnam", "mix"] = "global"
    delete_old_avatar: bool = False
    ratios: AutoProfileRatios | None = None


class AutoProfileRow(BaseModel):
    phone: str = Field(..., min_length=1, max_length=32)
    region: str = Field(default="global", max_length=16)
    first_name: str = Field(..., min_length=1, max_length=64)
    last_name: str = Field(default="", max_length=64)
    username: str = Field(default="", max_length=32)
    about: str = Field(default="", max_length=70)
    avatar_mode: Literal["keep", "delete", "url"] = "keep"
    avatar_url: str = Field(default="", max_length=1024)
    avatar_label: str = Field(default="", max_length=64)


class AutoProfilePreviewData(BaseModel):
    total: int
    items: list[AutoProfileRow]


class AutoProfileApplyRequest(BaseModel):
    phone: str = Field(..., min_length=1, max_length=32)
    first_name: str = Field(..., min_length=1, max_length=64)
    last_name: str = Field(default="", max_length=64)
    username: str = Field(default="", max_length=32)
    about: str = Field(default="", max_length=70)
    avatar_mode: Literal["keep", "delete", "url"] = "keep"
    avatar_url: str = Field(default="", max_length=1024)
    region: str = Field(default="global", max_length=16)
    avatar_label: str = Field(default="", max_length=64)


class AutoProfileApplyData(BaseModel):
    status: str
    phone: str
    message: str
    applied_username: str | None = None
    profile: dict | None = None
    avatar: dict | None = None
