"""Campaign product schemas: AI plan, market, executable script, job results."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Plan speakers (cast for AI)
# ---------------------------------------------------------------------------


class CampaignSpeakerInput(BaseModel):
    """Cast member. ``phone`` is for executor only — stripped before LLM prompts."""

    id: str = Field(..., min_length=1, max_length=32)
    label: str = Field(default="", max_length=80)
    phone: str = Field(..., min_length=3, max_length=32)
    role: str = Field(default="member", max_length=32)
    # Rich persona from UI (optional; soft priors for planner)
    activity: str | None = Field(default=None, max_length=16)
    message_style: str | None = Field(default=None, max_length=16)
    sentiment: str | None = Field(default=None, max_length=16)
    knowledge_level: str | None = Field(default=None, max_length=16)
    preferred_assets: list[str] = Field(default_factory=list, max_length=8)
    can_open: bool | None = None
    emoji_habit: str | None = Field(default=None, max_length=40)


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
    reply_rate: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Target share of reply lines; converted to min/max count for planner",
    )
    timing_pattern: Literal["even", "natural_bursts", "slow_group", "fast_chat"] | None = Field(
        default=None,
        description="Deprecated — ignored. AI owns at_sec from the plan prompt.",
    )
    market_intensity: Literal["low", "medium", "high"] = Field(
        default="medium",
        description="How heavily market facts should appear in chat",
    )
    numeric_detail: Literal["none", "approx", "exact"] = Field(
        default="approx",
        description="Prefer no numbers / approximate / exact snapshot figures",
    )
    max_news_topics: int = Field(default=2, ge=0, le=12)
    message_length_preset: Literal["mostly_short", "mixed", "detailed"] = Field(
        default="mostly_short",
        description="Target length mix: mostly_short 70/25/5, mixed 50/40/10, detailed 30/50/20",
    )
    message_length_short_pct: int | None = Field(
        default=None,
        ge=0,
        le=100,
        description="Optional override short % (with medium/long)",
    )
    message_length_medium_pct: int | None = Field(default=None, ge=0, le=100)
    message_length_long_pct: int | None = Field(default=None, ge=0, le=100)
    speaker_order: Literal["natural", "rotate", "messy", "lead_heavy"] = Field(
        default="natural",
        description="Speaker sequence: natural allows a b b c d d d a; rotate is strict A-B-C-D",
    )
    max_consecutive_same_speaker: int = Field(
        default=3,
        ge=1,
        le=5,
        description="Max back-to-back lines from one speaker (ignored when speaker_order=rotate → 1)",
    )
    chat_style: Literal["clean", "casual", "messy", "degen"] = Field(
        default="messy",
        description="Speech naturalness: clean vs casual phone chat",
    )
    allow_typos: bool = Field(
        default=False,
        description="Allow light typos (optional; not the main naturalness lever)",
    )
    allow_acks: bool = Field(
        default=True,
        description="Allow pure ack bubbles: ok, yeah, true, lmao",
    )
    allow_filler: bool = Field(
        default=False,
        description="Allow sparse playful filler (optional)",
    )
    split_bubbles: Literal["off", "sometimes", "often"] = Field(
        default="often",
        description=(
            "Legacy enum for multi-bubble intensity. Prefer split_continue_pct when set."
        ),
    )
    split_continue_pct: int | None = Field(
        default=None,
        ge=0,
        le=100,
        description=(
            "Share of adjacent same-speaker continues (0=no split, ~65=often Telegram habit). "
            "When set, planner prefs use this instead of split_bubbles enum."
        ),
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


class CampaignAiStatusData(BaseModel):
    ai_enabled: bool
    configured: bool
    model: str
    models: list[str] = Field(
        default_factory=list,
        description="Default OPENAI_MODEL + optional OPENAI_MODELS suggestions",
    )
    pricing_url: str = Field(
        default="https://platform.openai.com/docs/pricing",
        description="Official OpenAI pricing docs — UI links here; no hardcoded rates",
    )
    message: str
