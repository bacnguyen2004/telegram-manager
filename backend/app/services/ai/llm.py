"""Shared OpenAI chat helper (campaign planner, future chatbot/agent)."""

from __future__ import annotations

import re
from typing import Any

from ...config import settings

_MODEL_RE = re.compile(r"^[a-zA-Z0-9._:-]{2,80}$")

# Official docs — UI links here; we do not ship price tables.
OPENAI_PRICING_URL = "https://platform.openai.com/docs/pricing"


def is_ai_configured() -> bool:
    settings.reload_ai_env()
    return settings.ai_configured


def resolve_openai_model(model: str | None = None) -> str:
    """Pick model: explicit override (allowlisted or safe id) else default env model."""
    settings.reload_ai_env()
    default = settings.openai_model
    allowed = settings.openai_models
    raw = (model or "").strip()
    if not raw:
        return default
    if raw in allowed:
        return raw
    # Allow safe custom ids (new OpenAI models) without env update
    if _MODEL_RE.fullmatch(raw):
        return raw
    raise ValueError(
        f"Model khong hop le: {raw!r}. "
        f"Dung id hop le (vd gpt-4.1-mini) hoac chon: {', '.join(allowed)}"
    )


def ai_status_payload() -> dict[str, Any]:
    """Minimal AI status for campaign UI — no price catalog."""
    settings.reload_ai_env()
    configured = settings.ai_configured
    default = settings.openai_model
    return {
        "ai_enabled": settings.ai_enabled,
        "configured": configured,
        "model": default,
        "models": settings.openai_models,
        "pricing_url": OPENAI_PRICING_URL,
        "message": (
            "AI san sang"
            if configured
            else (
                "Bat AI_ENABLED=true va dien OPENAI_API_KEY trong backend/.env"
                if not settings.openai_api_key
                else "Dat AI_ENABLED=true de bat AI"
            )
        ),
    }


async def ai_status_payload_async() -> dict[str, Any]:
    """Same as sync status (async for FastAPI router)."""
    return ai_status_payload()


async def generate_chat_text(
    *,
    system_prompt: str,
    user_prompt: str,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
    timeout_seconds: float | None = None,
    model: str | None = None,
) -> str:
    settings.reload_ai_env()
    if not settings.ai_configured:
        raise ValueError(
            "AI chua cau hinh — dat AI_ENABLED=true va OPENAI_API_KEY trong backend/.env"
        )

    try:
        from openai import AsyncOpenAI
    except ImportError as exc:
        raise ValueError("Thieu package openai — pip install openai") from exc

    use_model = resolve_openai_model(model)

    client = AsyncOpenAI(
        api_key=settings.openai_api_key,
        timeout=timeout_seconds or settings.openai_timeout_seconds,
    )
    response = await client.chat.completions.create(
        model=use_model,
        temperature=settings.openai_temperature if temperature is None else temperature,
        max_tokens=max_output_tokens or settings.openai_max_output_tokens,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    choice = response.choices[0] if response.choices else None
    content = (choice.message.content if choice and choice.message else None) or ""
    text = content.strip()
    if not text:
        raise ValueError("Model tra ve rong")
    return text
