"""OpenAI GPT chat model catalog + reference pricing for campaign UI.

Prices are USD per 1M tokens (standard short-context), sourced from OpenAI
API pricing docs (2026). Always verify https://developers.openai.com/api/docs/pricing
— rates change. Cached input omitted in the simple table.
"""

from __future__ import annotations

from typing import Any

# id -> (input_per_1m, output_per_1m, tier_label, note)
# Prefer official short-context standard rates when available.
_GPT_PRICING: dict[str, tuple[float, float, str, str]] = {
    # GPT-5.6 family
    "gpt-5.6-sol": (5.0, 30.0, "flagship", "Alias gpt-5.6"),
    "gpt-5.6": (5.0, 30.0, "flagship", "Alias of gpt-5.6-sol"),
    "gpt-5.6-terra": (2.5, 15.0, "balanced", "Balance quality / cost"),
    "gpt-5.6-luna": (1.0, 6.0, "budget", "High volume"),
    # GPT-5.5
    "gpt-5.5": (5.0, 30.0, "flagship", ""),
    "gpt-5.5-pro": (30.0, 180.0, "pro", "Max capability"),
    # GPT-5.4
    "gpt-5.4": (2.5, 15.0, "balanced", ""),
    "gpt-5.4-mini": (0.75, 4.5, "budget", "Good default for campaigns"),
    "gpt-5.4-nano": (0.2, 1.25, "cheap", "Cheapest 5.4"),
    "gpt-5.4-pro": (30.0, 180.0, "pro", ""),
    # GPT-5 (older)
    "gpt-5": (2.5, 15.0, "balanced", "Legacy 5.x family rates may vary"),
    "gpt-5-mini": (0.75, 4.5, "budget", ""),
    "gpt-5-nano": (0.2, 1.25, "cheap", ""),
    # GPT-4.1
    "gpt-4.1": (2.0, 8.0, "balanced", "Strong instruction following"),
    "gpt-4.1-mini": (0.4, 1.6, "budget", "Common campaign default"),
    "gpt-4.1-nano": (0.1, 0.4, "cheap", ""),
    # GPT-4o
    "gpt-4o": (2.5, 10.0, "balanced", ""),
    "gpt-4o-mini": (0.15, 0.6, "cheap", "Very cheap"),
    # o-series (reasoning — slower/pricier for long scripts)
    "o4-mini": (0.55, 2.2, "reasoning", "Reasoning mini"),
    "o3": (2.0, 8.0, "reasoning", ""),
    "o3-mini": (1.1, 4.4, "reasoning", ""),
    "o3-pro": (20.0, 80.0, "pro", ""),
}

# Full selectable list for campaign UI when OPENAI_MODELS empty
DEFAULT_GPT_CHAT_MODELS: list[str] = [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.5-pro",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.4-pro",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4o",
    "gpt-4o-mini",
    "o4-mini",
    "o3-mini",
    "o3",
]


_TIER_VI = {
    "cheap": "Rẻ nhất",
    "budget": "Rẻ / ổn",
    "balanced": "Vừa",
    "flagship": "Đắt / mạnh",
    "reasoning": "Reasoning (chậm/đắt hơn)",
    "pro": "Rất đắt",
    "unknown": "Chưa có giá",
}


def _blend_cost(inp: float, out: float) -> float:
    """Heuristic cost index: campaigns use more output tokens than input."""
    return inp * 0.35 + out * 0.65


def pricing_row(model_id: str) -> dict[str, Any]:
    mid = (model_id or "").strip()
    row = _GPT_PRICING.get(mid)
    if row:
        inp, out, tier, note = row
        blend = _blend_cost(inp, out)
        return {
            "id": mid,
            "input_per_1m": inp,
            "output_per_1m": out,
            "tier": tier,
            "tier_label": _TIER_VI.get(tier, tier),
            "note": note,
            "known": True,
            "cost_index": round(blend, 4),
        }
    return {
        "id": mid,
        "input_per_1m": None,
        "output_per_1m": None,
        "tier": "unknown",
        "tier_label": _TIER_VI["unknown"],
        "note": "Giá chưa có trong catalog — xem OpenAI pricing",
        "known": False,
        "cost_index": None,
    }


def model_catalog(model_ids: list[str] | None = None) -> list[dict[str, Any]]:
    ids = model_ids if model_ids is not None else list(DEFAULT_GPT_CHAT_MODELS)
    # de-dupe preserve order
    seen: set[str] = set()
    ordered: list[str] = []
    for m in ids:
        m = (m or "").strip()
        if m and m not in seen:
            seen.add(m)
            ordered.append(m)
    rows = [pricing_row(m) for m in ordered]
    # Sort: known cheapest first, then unknown
    rows.sort(
        key=lambda r: (
            0 if r.get("known") else 1,
            float(r["cost_index"]) if r.get("cost_index") is not None else 9999.0,
            str(r.get("id") or ""),
        )
    )
    # Rank label for UI
    known = [r for r in rows if r.get("known")]
    for i, r in enumerate(known):
        if i == 0:
            r["price_badge"] = "Rẻ nhất"
        elif i <= max(1, len(known) // 4):
            r["price_badge"] = "Rẻ"
        elif i >= len(known) - max(1, len(known) // 5):
            r["price_badge"] = "Đắt"
        else:
            r["price_badge"] = "Vừa"
    for r in rows:
        if not r.get("known"):
            r["price_badge"] = "?"
    return rows


def estimate_plan_cost_usd(
    model_id: str,
    *,
    target_lines: int = 150,
    batches: int | None = None,
) -> dict[str, Any]:
    """Rough campaign plan cost (not billing-accurate)."""
    row = pricing_row(model_id)
    if not row["known"]:
        return {
            "model": model_id,
            "estimate_usd": None,
            "note": "Unknown pricing",
        }
    # Heuristic: ~2.5k input + ~3.5k output tokens per 25-line batch (prompt+JSON)
    b = batches
    if b is None:
        # match planner chunk_size_for_target roughly
        if target_lines >= 120:
            size = 25
        elif target_lines >= 80:
            size = 30
        elif target_lines >= 50:
            size = 35
        else:
            size = 40
        b = max(1, (target_lines + size - 1) // size)
        # retries ~+20%
        b = int(round(b * 1.2))
    inp_tok = b * 2500
    out_tok = b * 3500
    cost = (inp_tok / 1_000_000) * float(row["input_per_1m"]) + (
        out_tok / 1_000_000
    ) * float(row["output_per_1m"])
    return {
        "model": model_id,
        "batches_assumed": b,
        "input_tokens_assumed": inp_tok,
        "output_tokens_assumed": out_tok,
        "estimate_usd": round(cost, 4),
        "note": f"Ước lượng plan ~{target_lines} dòng (có retry). Không phải bill OpenAI.",
    }


async def fetch_openai_gpt_model_ids() -> list[str] | None:
    """Live list from OpenAI API (gpt* + o-series chat-ish). None if unavailable."""
    from ...config import settings

    if not settings.openai_api_key:
        return None
    try:
        from openai import AsyncOpenAI
    except ImportError:
        return None
    try:
        client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=20)
        page = await client.models.list()
        ids: list[str] = []
        for m in page.data:
            mid = getattr(m, "id", "") or ""
            low = mid.lower()
            if low.startswith("gpt") or low.startswith("o1") or low.startswith("o3") or low.startswith(
                "o4"
            ):
                # skip embeddings / audio / image heavy ids for campaign picker
                if any(
                    x in low
                    for x in (
                        "embed",
                        "tts",
                        "transcribe",
                        "whisper",
                        "audio",
                        "realtime",
                        "image",
                        "moderation",
                        "search",
                        "codex",
                        "computer",
                        "deep-research",
                    )
                ):
                    continue
                ids.append(mid)
        ids = sorted(set(ids))
        return ids or None
    except Exception:
        return None
