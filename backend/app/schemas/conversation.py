from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ConversationSpeakerInput(BaseModel):
    id: str = Field(..., min_length=1, max_length=32, examples=["a"])
    label: str = Field(..., min_length=1, max_length=80, examples=["An"])
    phone: str = Field(..., examples=["+84901234567"])


class ConversationTimingInput(BaseModel):
    delay_min_sec: int = Field(default=4, ge=0, le=600)
    delay_max_sec: int = Field(default=12, ge=0, le=600)
    speaker_change_delay_min_sec: int = Field(default=8, ge=0, le=900)
    speaker_change_delay_max_sec: int = Field(default=20, ge=0, le=900)
    typing_min_sec: int = Field(default=2, ge=0, le=120)
    typing_max_sec: int = Field(default=6, ge=0, le=120)


class ConversationLineInput(BaseModel):
    id: int = Field(..., ge=1, description="Thu tu thuc thi 1..n")
    script_ref: int = Field(
        ...,
        ge=1,
        description="So dong goc trong kich ban GPT (#10, #12...)",
    )
    speaker_id: str = Field(..., min_length=1, max_length=32)
    text: str = Field(..., min_length=1, max_length=4096)
    reply_to: int | None = Field(
        default=None,
        ge=1,
        description="Tham chieu id dong dich trong cung script",
    )

    @model_validator(mode="before")
    @classmethod
    def _default_script_ref(cls, data: object) -> object:
        if isinstance(data, dict) and "script_ref" not in data and "id" in data:
            data = {**data, "script_ref": data["id"]}
        return data


class ConversationScriptInput(BaseModel):
    version: int = Field(default=1, ge=1)
    group_link: str = Field(default="", max_length=512)
    peer_id: str | None = Field(
        default=None,
        description="Mac dinh dung group_link neu bo trong",
    )
    speakers: list[ConversationSpeakerInput] = Field(..., min_length=1, max_length=10)
    lines: list[ConversationLineInput] = Field(default_factory=list, max_length=500)
    timing: ConversationTimingInput = Field(default_factory=ConversationTimingInput)
    reply_on_speaker_change: bool = Field(
        default=True,
        description="Khi doi vai, reply tin cuoi cua vai truoc (neu khong co reply_to)",
    )
    continue_on_error: bool = Field(
        default=False,
        description="Loi mot cau thi dung job (mac dinh)",
    )


class ConversationParseRequest(BaseModel):
    script_text: str = Field(..., min_length=1)
    group_link: str = Field(default="", max_length=512)
    peer_id: str | None = Field(default=None, max_length=512)
    speakers: list[ConversationSpeakerInput] = Field(..., min_length=1, max_length=10)
    timing: ConversationTimingInput = Field(default_factory=ConversationTimingInput)
    reply_on_speaker_change: bool = True
    continue_on_error: bool = False


class ConversationValidationIssue(BaseModel):
    level: Literal["error", "warning"]
    code: str
    message: str
    line_id: int | None = None


class ConversationValidateData(BaseModel):
    valid: bool
    line_count: int
    issues: list[ConversationValidationIssue]
    script: ConversationScriptInput | None = None


class ConversationLineResult(BaseModel):
    line_id: int
    speaker_id: str
    phone: str
    status: Literal["pending", "running", "success", "error", "skipped"]
    message_id: int | None = None
    reply_to_msg_id: int | None = None
    detail: str = ""


class ConversationJobData(BaseModel):
    id: int
    status: Literal["pending", "running", "done", "stopped", "error"]
    total_lines: int
    completed_lines: int
    success_lines: int
    error_lines: int
    group_link: str
    stop_requested: bool
    line_results: list[ConversationLineResult]
    script: ConversationScriptInput | None = None
    created_at: str
    updated_at: str
    error_message: str | None = None


class ConversationJobCreateData(BaseModel):
    job_id: int
    status: str
    total_lines: int


class ConversationJobCreateRequest(BaseModel):
    script: ConversationScriptInput
    start_line_id: int | None = Field(
        default=None,
        ge=1,
        description="Chi chay tu dong co id >= start_line_id",
    )
    carried_line_results: list[ConversationLineResult] = Field(
        default_factory=list,
        description="Giu ket qua da gui tu job truoc khi chay tu start_line_id",
    )


class ConversationJobSummary(BaseModel):
    id: int
    status: str
    total_lines: int
    completed_lines: int
    success_lines: int
    error_lines: int
    group_link: str
    created_at: str
    updated_at: str


class ConversationJobListData(BaseModel):
    items: list[ConversationJobSummary]
    total: int
    limit: int
    offset: int