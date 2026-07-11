"""Campaign product schemas: AI plan, market, executable script, job results."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Plan speakers (cast for AI)
# ---------------------------------------------------------------------------


class CampaignSpeakerInput(BaseModel):
    id: str = Field(..., min_length=1, max_length=32)
    label: str = Field(default="", max_length=80)
    phone: str = Field(..., min_length=3, max_length=32)
    role: str = Field(default="member", max_length=32)


# Keep in sync with frontend campaignTiming.MAX_TARGET_LINES
MAX_CAMPAIGN_LINES = 200
MAX_CAMPAIGN_DURATION_MIN = 240


class CampaignPlanRequest(BaseModel):
    goal: str = Field(..., min_length=8, max_length=2000)
    duration_min: int = Field(default=20, ge=5, le=MAX_CAMPAIGN_DURATION_MIN)
    target_lines: int | None = Field(
        default=None,
        ge=4,
        le=MAX_CAMPAIGN_LINES,
        description="So luot tin muc tieu; AI nen sinh gan dung so dong nay",
    )
    density: Literal["light", "normal", "dense"] = Field(
        default="normal",
        description="Mat do chat: light/normal/dense",
    )
    language: str = Field(default="auto", max_length=32)
    group_link: str = Field(default="", max_length=512)
    peer_id: str | None = Field(default=None, max_length=512)
    topic_bullets: list[str] = Field(default_factory=list, max_length=20)
    selected_news: list[str] = Field(
        default_factory=list,
        max_length=20,
        description="Tieu de tin user chon de dua vao chat (paraphrase)",
    )
    must_discuss_news: list[str] = Field(
        default_factory=list,
        max_length=12,
        description="Tin bat buoc paraphrase it nhat 1 lan trong plan",
    )
    news_keywords: list[str] = Field(
        default_factory=list,
        max_length=12,
        description="Keyword bias (ETF, SEC...) — khong biu them fact",
    )
    speakers: list[CampaignSpeakerInput] = Field(..., min_length=2, max_length=8)
    use_market_context: bool = Field(
        default=True,
        description="Lay gia BTC/ETH/SOL thuc (CoinGecko) de ground prompt AI",
    )
    model: str | None = Field(
        default=None,
        max_length=80,
        description="OpenAI model override (empty = OPENAI_MODEL default)",
    )


class CampaignPlanLine(BaseModel):
    at_sec: int = Field(default=0, ge=0, le=20_000)
    speaker_id: str = Field(..., min_length=1, max_length=32)
    action: Literal["send", "reply"] = "send"
    text: str = Field(..., min_length=1, max_length=4096)
    reply_to_line: int | None = Field(default=None, ge=1)


class CampaignPlan(BaseModel):
    title: str = Field(default="Campaign", max_length=120)
    duration_min: int = Field(default=20, ge=5, le=MAX_CAMPAIGN_DURATION_MIN)
    lines: list[CampaignPlanLine] = Field(..., min_length=1, max_length=MAX_CAMPAIGN_LINES)


# ---------------------------------------------------------------------------
# Market / news
# ---------------------------------------------------------------------------


class MarketCoinQuote(BaseModel):
    id: str = ""
    symbol: str
    usd: float
    usd_24h_change: float | None = None
    quote_volume: float | None = None
    pair: str = ""


class MarketNewsItem(BaseModel):
    title: str = ""
    source: str = ""
    published_at: str = ""
    url: str = ""
    tags: list[str] = Field(default_factory=list)


class CampaignMarketContext(BaseModel):
    fetched_at: str = ""
    source: str = ""
    coins: list[MarketCoinQuote] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    news: list[MarketNewsItem] = Field(default_factory=list)
    news_source: str = ""
    news_error: str | None = None
    gainers: list[MarketCoinQuote] = Field(default_factory=list)
    losers: list[MarketCoinQuote] = Field(default_factory=list)
    movers_source: str = ""
    movers_error: str | None = None
    brief: str = ""
    ok: bool = True
    error: str | None = None
    filter_q: str = ""
    filter_tags: list[str] = Field(default_factory=list)


class CampaignGoalDraftRequest(BaseModel):
    topic: Literal["btc_eth", "alts", "macro", "mix"] = "btc_eth"
    tone: Literal["casual", "debate", "hype", "skeptical"] = "casual"
    conflict: Literal["none", "low", "medium"] = "low"
    language: str = Field(default="auto", max_length=32)
    message_length: Literal["short", "medium"] = "short"
    selected_news: list[str] = Field(default_factory=list, max_length=12)
    must_discuss_news: list[str] = Field(default_factory=list, max_length=8)


class CampaignGoalDraftData(BaseModel):
    goal: str
    source: str = "template"


class CampaignInjectRequest(BaseModel):
    angle: str = Field(default="", max_length=500)
    selected_news: list[str] = Field(default_factory=list, max_length=8)
    line_count: int = Field(default=3, ge=2, le=5)
    use_live_price: bool = True
    model: str | None = Field(
        default=None,
        max_length=80,
        description="OpenAI model override for inject burst",
    )


class CampaignInjectData(BaseModel):
    job_id: int
    injected_count: int
    new_total_lines: int
    lines: list[CampaignPlanLine] = Field(default_factory=list)
    status: str = ""


# ---------------------------------------------------------------------------
# Executable script (runtime contract: plan → runner)
# ---------------------------------------------------------------------------


class CampaignSpeakerRuntimeInput(BaseModel):
    """Speaker binding on the executable script (id/label/phone)."""

    id: str = Field(..., min_length=1, max_length=32, examples=["a"])
    label: str = Field(..., min_length=1, max_length=80, examples=["An"])
    phone: str = Field(..., examples=["+84901234567"])


class CampaignTimingInput(BaseModel):
    delay_min_sec: int = Field(default=4, ge=0, le=600)
    delay_max_sec: int = Field(default=12, ge=0, le=600)
    speaker_change_delay_min_sec: int = Field(default=8, ge=0, le=900)
    speaker_change_delay_max_sec: int = Field(default=20, ge=0, le=900)
    typing_min_sec: int = Field(default=2, ge=0, le=120)
    typing_max_sec: int = Field(default=6, ge=0, le=120)


class CampaignScriptLine(BaseModel):
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
    at_sec: int | None = Field(
        default=None,
        ge=0,
        description=(
            "Lich tuyet doi (giay tu luc start job). "
            "Khi co at_sec, typing duoc cong don trong cua so cho den moc nay."
        ),
    )

    @model_validator(mode="before")
    @classmethod
    def _default_script_ref(cls, data: object) -> object:
        if isinstance(data, dict) and "script_ref" not in data and "id" in data:
            data = {**data, "script_ref": data["id"]}
        return data


class CampaignScript(BaseModel):
    version: int = Field(default=1, ge=1)
    group_link: str = Field(default="", max_length=512)
    peer_id: str | None = Field(
        default=None,
        description="Mac dinh dung group_link neu bo trong",
    )
    speakers: list[CampaignSpeakerRuntimeInput] = Field(
        ..., min_length=1, max_length=10
    )
    lines: list[CampaignScriptLine] = Field(default_factory=list, max_length=500)
    timing: CampaignTimingInput = Field(default_factory=CampaignTimingInput)
    reply_on_speaker_change: bool = Field(
        default=True,
        description="Khi doi vai, reply tin cuoi cua vai truoc (neu khong co reply_to)",
    )
    continue_on_error: bool = Field(
        default=False,
        description="Loi mot cau thi dung job (mac dinh)",
    )
    schedule_mode: bool = Field(
        default=False,
        description=(
            "True (campaign): dung at_sec tuyet doi, typing nam trong gap kich ban. "
            "False: delay ngau nhien + typing cong them (legacy)."
        ),
    )


class CampaignValidationIssue(BaseModel):
    level: Literal["error", "warning"]
    code: str
    message: str
    line_id: int | None = None


class CampaignValidationData(BaseModel):
    valid: bool
    line_count: int
    issues: list[CampaignValidationIssue]
    script: CampaignScript | None = None


class CampaignLineResult(BaseModel):
    line_id: int
    speaker_id: str
    phone: str
    status: Literal["pending", "running", "success", "error", "skipped"]
    message_id: int | None = None
    reply_to_msg_id: int | None = None
    detail: str = ""


class CampaignJobData(BaseModel):
    """Job monitor payload for running campaign execution."""

    id: int
    status: Literal["pending", "running", "done", "stopped", "error"]
    total_lines: int
    completed_lines: int
    success_lines: int
    error_lines: int
    group_link: str
    stop_requested: bool
    line_results: list[CampaignLineResult]
    script: CampaignScript | None = None
    created_at: str
    updated_at: str
    error_message: str | None = None


class CampaignJobSummary(BaseModel):
    id: int
    status: str
    total_lines: int
    completed_lines: int
    success_lines: int
    error_lines: int
    group_link: str
    created_at: str
    updated_at: str


class CampaignPlanData(BaseModel):
    plan: CampaignPlan
    script: CampaignScript
    validation: CampaignValidationData
    market: CampaignMarketContext | None = None


class CampaignJobCreateRequest(BaseModel):
    plan: CampaignPlan
    speakers: list[CampaignSpeakerInput] = Field(..., min_length=2, max_length=8)
    group_link: str = Field(..., min_length=1, max_length=512)
    peer_id: str | None = Field(default=None, max_length=512)


class CampaignJobCreateData(BaseModel):
    job_id: int
    status: str
    total_lines: int
    title: str = ""


class CampaignModelPriceRow(BaseModel):
    id: str
    input_per_1m: float | None = None
    output_per_1m: float | None = None
    tier: str = "unknown"
    tier_label: str = ""
    note: str = ""
    known: bool = False
    cost_index: float | None = None
    price_badge: str = ""


class CampaignPlanCostEstimate(BaseModel):
    model: str
    batches_assumed: int | None = None
    input_tokens_assumed: int | None = None
    output_tokens_assumed: int | None = None
    estimate_usd: float | None = None
    note: str = ""


class CampaignAiStatusData(BaseModel):
    ai_enabled: bool
    configured: bool
    model: str
    models: list[str] = Field(default_factory=list)
    model_catalog: list[CampaignModelPriceRow] = Field(default_factory=list)
    plan_cost_estimates_150: list[CampaignPlanCostEstimate] = Field(
        default_factory=list
    )
    pricing_unit: str = "USD per 1M tokens (standard short context)"
    pricing_source: str = "https://developers.openai.com/api/docs/pricing"
    models_source: str = "env_or_catalog"
    message: str
