from typing import Literal

from pydantic import BaseModel, Field


class SendCodeRequest(BaseModel):
    phone: str = Field(..., examples=["+84901234567"])


class SendCodeData(BaseModel):
    status: Literal["success", "info", "error"]
    message: str
    phone: str


class LoginRequest(BaseModel):
    phone: str = Field(..., examples=["+84901234567"])
    code: str = Field(..., examples=["12345"])
    password: str | None = Field(
        default=None,
        description="Mat khau 2FA neu tai khoan bat xac thuc 2 buoc",
    )


class LoginData(BaseModel):
    status: Literal["success", "need_2fa", "need_signup", "error"]
    message: str
    phone: str
    first_name: str = ""
    last_name: str = ""
    username: str = ""
    session_file: str = ""


class MeData(BaseModel):
    status: Literal["success", "error"]
    message: str
    phone: str
    first_name: str = ""
    last_name: str = ""
    username: str = ""
    phone_number: str = ""
    avatar_url: str = ""


class RegisterRequest(BaseModel):
    phone: str = Field(..., examples=["+84901234567"])
    code: str = Field(..., examples=["12345"])
    first_name: str = Field(..., examples=["Nguyen"])
    last_name: str = Field(default="", examples=["Van A"])


class RegisterData(BaseModel):
    status: Literal["success", "error"]
    message: str
    phone: str
    first_name: str = ""
    last_name: str = ""
    username: str = ""
    session_file: str = ""


class Update2faRequest(BaseModel):
    phone: str = Field(..., examples=["+84901234567"])
    new_password: str = Field(..., min_length=1)
    current_password: str | None = Field(
        default=None,
        description="Bat buoc neu tai khoan da co mat khau 2FA",
    )
    hint: str = ""


class Update2faData(BaseModel):
    status: Literal["success", "error"]
    message: str
    phone: str


class UpdatePrivacyRequest(BaseModel):
    phone: str = Field(..., examples=["+84901234567"])
    rule_type: Literal["all", "contacts", "nobody"] = Field(
        default="all",
        description="Ai duoc moi ban vao group: all | contacts | nobody",
    )


class UpdatePrivacyData(BaseModel):
    status: Literal["success", "error"]
    message: str
    phone: str
    rule_type: str = ""
