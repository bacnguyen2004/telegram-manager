"""Shared OpenAI chat helper (campaign planner, future chatbot/agent)."""

from __future__ import annotations

import re
from typing import Any

from ...config import settings

_MODEL_RE = re.compile(r"^[a-zA-Z0-9._:-]{2,80}$")


def is_ai_configured() -> bool:
    return settings.ai_configured


def resolve_openai_model(model: str | None = None) -> str:
    """Pick model: explicit override (allowlisted or safe id) else default env model."""
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
        f"Chon trong: {', '.join(allowed)} (hoac id hop le)"
    )


def ai_status_payload() -> dict[str, Any]:
    from .model_catalog import DEFAULT_GPT_CHAT_MODELS, model_catalog

    configured = settings.ai_configured
    default = settings.openai_model if configured else ""
    models = settings.openai_models if configured else list(DEFAULT_GPT_CHAT_MODELS)
    catalog = model_catalog(models if models else list(DEFAULT_GPT_CHAT_MODELS))
    return {
        "ai_enabled": settings.ai_enabled,
        "configured": configured,
        "model": default,
        "models": models,
        "model_catalog": catalog,
        "pricing_unit": "USD per 1M tokens (standard short context)",
        "pricing_source": "https://developers.openai.com/api/docs/pricing",
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
    """Status + try live OpenAI model list for full GPT catalog."""
    from .model_catalog import (
        DEFAULT_GPT_CHAT_MODELS,
        estimate_plan_cost_usd,
        fetch_openai_gpt_model_ids,
        model_catalog,
    )

    base = ai_status_payload()
    live = await fetch_openai_gpt_model_ids() if settings.ai_configured else None
    if live:
        # Prefer live GPT ids; keep env default first
        default = base.get("model") or settings.openai_model
        merged: list[str] = []
        for m in [default, *live, *DEFAULT_GPT_CHAT_MODELS]:
            if m and m not in merged:
                merged.append(m)
        base["models"] = merged
        base["models_source"] = "openai_api+catalog"
    else:
        base["models_source"] = "env_or_catalog"
    base["model_catalog"] = model_catalog(base["models"])
    # Attach rough cost for default + selected-friendly models
    estimates = []
    for mid in (base["models"] or [])[:24]:
        estimates.append(estimate_plan_cost_usd(mid, target_lines=150))
    base["plan_cost_estimates_150"] = estimates
    return base


async def generate_chat_text(
    *,
    system_prompt: str,
    user_prompt: str,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
    timeout_seconds: float | None = None,
    model: str | None = None,
) -> str:
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
