"""Top 24h gainers/losers from Binance public spot ticker (no API key)."""

from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from typing import Any

logger = logging.getLogger(__name__)

BINANCE_24HR_URL = "https://api.binance.com/api/v3/ticker/24hr"

# Exclude leveraged / weird pairs
_SKIP_BASE = re.compile(
    r"(UP|DOWN|BULL|BEAR|3L|3S|2L|2S)$",
    re.IGNORECASE,
)
_STABLES = {
    "USDC",
    "FDUSD",
    "TUSD",
    "BUSD",
    "DAI",
    "USDP",
    "USDE",
    "EUR",
    "AEUR",
    "USDT",
}

# Min 24h quote volume in USDT
_MIN_QUOTE_VOL = 2_000_000.0


@dataclass
class MoverQuote:
    symbol: str
    usd: float
    usd_24h_change: float
    quote_volume: float = 0.0
    pair: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _base_from_usdt_pair(symbol: str) -> str | None:
    if not symbol.endswith("USDT"):
        return None
    base = symbol[: -len("USDT")]
    if not base or len(base) > 12:
        return None
    if base.upper() in _STABLES:
        return None
    if _SKIP_BASE.search(base):
        return None
    return base.upper()


def rank_movers_from_tickers(
    rows: list[dict[str, Any]],
    *,
    top_n: int = 5,
    min_quote_vol: float = _MIN_QUOTE_VOL,
) -> tuple[list[MoverQuote], list[MoverQuote]]:
    """Pure ranking helper (testable)."""
    parsed: list[MoverQuote] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        pair = str(row.get("symbol") or "")
        base = _base_from_usdt_pair(pair)
        if not base:
            continue
        try:
            last = float(row.get("lastPrice") or 0)
            chg = float(row.get("priceChangePercent") or 0)
            qvol = float(row.get("quoteVolume") or 0)
        except (TypeError, ValueError):
            continue
        if last <= 0 or qvol < min_quote_vol:
            continue
        parsed.append(
            MoverQuote(
                symbol=base,
                usd=last,
                usd_24h_change=chg,
                quote_volume=qvol,
                pair=pair,
            )
        )

    by_gain = sorted(parsed, key=lambda m: m.usd_24h_change, reverse=True)
    by_loss = sorted(parsed, key=lambda m: m.usd_24h_change)

    def _dedupe_top(items: list[MoverQuote], n: int) -> list[MoverQuote]:
        seen: set[str] = set()
        out: list[MoverQuote] = []
        for m in items:
            if m.symbol in seen:
                continue
            seen.add(m.symbol)
            out.append(m)
            if len(out) >= n:
                break
        return out

    return _dedupe_top(by_gain, top_n), _dedupe_top(by_loss, top_n)


def fetch_binance_movers_sync(
    *,
    top_n: int = 5,
    min_quote_vol: float = _MIN_QUOTE_VOL,
) -> tuple[list[MoverQuote], list[MoverQuote], str]:
    """
    Returns (gainers, losers, source_note).
    Raises ValueError on network/parse failure.
    """
    req = urllib.request.Request(
        BINANCE_24HR_URL,
        headers={
            "User-Agent": "TelegramManagerCampaign/1.0",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=18) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raise ValueError(f"Binance ticker HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise ValueError(f"Binance ticker network: {exc.reason}") from exc

    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError("Binance ticker payload not a list")

    gainers, losers = rank_movers_from_tickers(
        data, top_n=top_n, min_quote_vol=min_quote_vol
    )
    if not gainers and not losers:
        raise ValueError("Binance movers empty after filters")
    return gainers, losers, "binance_ticker_24hr"


def movers_to_brief(
    gainers: list[MoverQuote],
    losers: list[MoverQuote],
    *,
    source: str = "binance_ticker_24hr",
) -> str:
    lines = [
        f"TOP 24h MOVERS (source={source}) — gossip fuel only:",
        "You may mention 1–3 of these across the FULL campaign (not every batch).",
        "OK: 'not touching that', 'lol that pump', 'got rekt on …'.",
        "FORBIDDEN: shill buy-now, contracts, links, dumping 5 alts in a row.",
        "",
        "GAINERS:",
    ]
    if gainers:
        for i, m in enumerate(gainers, 1):
            lines.append(
                f"{i}. {m.symbol} ~${m.usd:g} ({m.usd_24h_change:+.1f}% 24h)"
            )
    else:
        lines.append("(none)")
    lines.append("LOSERS:")
    if losers:
        for i, m in enumerate(losers, 1):
            lines.append(
                f"{i}. {m.symbol} ~${m.usd:g} ({m.usd_24h_change:+.1f}% 24h)"
            )
    else:
        lines.append("(none)")
    return "\n".join(lines)
