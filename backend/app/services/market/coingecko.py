"""Live crypto prices (CoinGecko) + 24h news (RSS) for campaign grounding."""

from __future__ import annotations

import asyncio
import json
import logging
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

from .binance_movers import MoverQuote, fetch_binance_movers_sync, movers_to_brief
from .news import NewsItem, fetch_news_24h_sync, news_to_dicts

logger = logging.getLogger(__name__)

# Majors + alts often named in crypto news (grounding so chat doesn't invent prices).
COINGECKO_COIN_IDS: list[tuple[str, str]] = [
    ("bitcoin", "BTC"),
    ("ethereum", "ETH"),
    ("solana", "SOL"),
    ("binancecoin", "BNB"),
    ("ripple", "XRP"),
    ("dogecoin", "DOGE"),
    ("cardano", "ADA"),
    ("avalanche-2", "AVAX"),
    ("chainlink", "LINK"),
    ("polkadot", "DOT"),
    ("the-open-network", "TON"),
    ("tron", "TRX"),
    ("polygon-ecosystem-token", "POL"),
    ("near", "NEAR"),
    ("aptos", "APT"),
    ("sui", "SUI"),
    ("arbitrum", "ARB"),
    ("optimism", "OP"),
    ("pepe", "PEPE"),
    ("shiba-inu", "SHIB"),
    ("uniswap", "UNI"),
    ("litecoin", "LTC"),
    ("bitcoin-cash", "BCH"),
]

_COINGECKO_IDS = ",".join(cid for cid, _ in COINGECKO_COIN_IDS)
COINGECKO_SIMPLE_URL = (
    "https://api.coingecko.com/api/v3/simple/price"
    f"?ids={_COINGECKO_IDS}&vs_currencies=usd&include_24hr_change=true"
)

_CACHE_TTL_SEC = 90.0
_cache: dict[str, Any] = {"ts": 0.0, "snapshot": None}


def clear_market_cache() -> None:
    """Force next fetch to hit network (used by refresh UI)."""
    global _cache
    _cache = {"ts": 0.0, "snapshot": None}


@dataclass
class CoinQuote:
    id: str
    symbol: str
    usd: float
    usd_24h_change: float | None = None


@dataclass
class MarketSnapshot:
    fetched_at: str
    source: str
    coins: list[CoinQuote]
    notes: list[str]
    news: list[NewsItem]
    news_source: str = ""
    news_error: str | None = None
    gainers: list[MoverQuote] | None = None
    losers: list[MoverQuote] | None = None
    movers_source: str = ""
    movers_error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "fetched_at": self.fetched_at,
            "source": self.source,
            "coins": [asdict(c) for c in self.coins],
            "notes": list(self.notes),
            "news": news_to_dicts(self.news),
            "news_source": self.news_source,
            "news_error": self.news_error,
            "gainers": [asdict(m) for m in (self.gainers or [])],
            "losers": [asdict(m) for m in (self.losers or [])],
            "movers_source": self.movers_source,
            "movers_error": self.movers_error,
        }


def _fetch_prices_sync() -> list[CoinQuote]:
    req = urllib.request.Request(
        COINGECKO_SIMPLE_URL,
        headers={"User-Agent": "TelegramManagerCampaign/1.0", "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raise ValueError(f"CoinGecko HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise ValueError(f"CoinGecko network error: {exc.reason}") from exc

    data = json.loads(raw)
    coins: list[CoinQuote] = []
    for coin_id, symbol in COINGECKO_COIN_IDS:
        row = data.get(coin_id) or {}
        usd = row.get("usd")
        if usd is None:
            continue
        change = row.get("usd_24h_change")
        coins.append(
            CoinQuote(
                id=coin_id,
                symbol=symbol,
                usd=float(usd),
                usd_24h_change=float(change) if change is not None else None,
            )
        )
    if not coins:
        raise ValueError("CoinGecko tra ve rong")
    return coins


def _fetch_sync(
    *,
    q: str | None = None,
    tags: list[str] | None = None,
    max_news: int = 20,
) -> MarketSnapshot:
    coins = _fetch_prices_sync()
    news: list[NewsItem] = []
    news_error: str | None = None
    news_source = "rss:coindesk+cointelegraph+decrypt"
    try:
        news = fetch_news_24h_sync(max_items=max_news, q=q, tags=tags)
        if not news:
            news_error = "RSS khong tra tin (mang/chan domain hoac loc qua chat)"
    except Exception as exc:
        news_error = str(exc)
        logger.warning("Fetch news 24h failed: %s", exc)

    gainers: list[MoverQuote] = []
    losers: list[MoverQuote] = []
    movers_source = ""
    movers_error: str | None = None
    try:
        gainers, losers, movers_source = fetch_binance_movers_sync(top_n=8)
    except Exception as exc:
        movers_error = str(exc)
        logger.warning("Binance movers failed: %s", exc)

    now = datetime.now(timezone.utc).isoformat()
    notes = [
        "Gia tham khao luc snapshot; co the lech so voi san.",
        "Majors + alts thuong gap trong news (BNB/XRP/DOGE/AVAX/LINK/…); dung so trong PRICES.",
        "Neu news nhac coin co trong list — paraphrase + gia xap xi tu PRICES, khong bia so.",
        "Trong chat chi noi xap xi (around / near), khong can moi cau lap day du so.",
        "News la tieu de public RSS 24h — paraphrase, khong copy nguyen van.",
        "Top gainer/loser tu Binance 24h ticker (free) — chi gossip, khong shill.",
    ]
    if news_error:
        notes.append(f"News warning: {news_error}")
    if movers_error:
        notes.append(f"Movers warning: {movers_error}")

    return MarketSnapshot(
        fetched_at=now,
        source="coingecko_simple_price+binance_movers",
        coins=coins,
        notes=notes,
        news=news,
        news_source=news_source,
        news_error=news_error,
        gainers=gainers,
        losers=losers,
        movers_source=movers_source,
        movers_error=movers_error,
    )


async def fetch_crypto_snapshot(
    *,
    use_cache: bool = True,
    q: str | None = None,
    tags: list[str] | None = None,
    max_news: int = 20,
) -> MarketSnapshot:
    global _cache
    now = time.time()
    # Only use global cache for unfiltered full snapshot
    use_global_cache = use_cache and not q and not tags
    if (
        use_global_cache
        and _cache["snapshot"] is not None
        and now - float(_cache["ts"]) < _CACHE_TTL_SEC
    ):
        cached: MarketSnapshot = _cache["snapshot"]  # type: ignore[assignment]
        if cached.news:
            return cached
        if now - float(_cache["ts"]) < 20:
            return cached

    snapshot = await asyncio.to_thread(_fetch_sync, q=q, tags=tags, max_news=max_news)
    if use_global_cache:
        _cache = {"ts": now, "snapshot": snapshot}
    return snapshot


def format_price(usd: float) -> str:
    if usd >= 1000:
        return f"${usd:,.0f}"
    if usd >= 1:
        return f"${usd:,.2f}"
    return f"${usd:.4f}"


def format_change(change: float | None) -> str:
    if change is None:
        return "n/a"
    sign = "+" if change >= 0 else ""
    return f"{sign}{change:.2f}%"


def format_market_brief(
    snapshot: MarketSnapshot,
    *,
    selected_news: list[str] | None = None,
    must_discuss_news: list[str] | None = None,
    news_keywords: list[str] | None = None,
) -> str:
    """Human-readable block injected into the campaign LLM prompt.

    selected_news: optional list of headline titles the user ticked in the UI.
    If provided (even empty list meaning "no news topics"), only those titles
    are allowed as talking points. If None, fall back to all snapshot.news.

    must_discuss_news: headlines that MUST appear (paraphrased) at least once.
    news_keywords: user bias keywords (ETF, SEC…) for tone, not inventing facts.
    """
    lines = [
        f"TODAY'S MARKET SNAPSHOT (prices={snapshot.source}, utc={snapshot.fetched_at})",
        "This is the market day the group is chatting about.",
        "Use ONLY these price figures. Do not invent other exact prices or % moves.",
        "In dialogue, approximate only: BTC around… / ETH near… (or VI: khoảng / gần / tầm).",
        "PRICE DISCIPLINE: each major level (e.g. BTC ~X) at most 2–3 times in the FULL plan.",
        "Alts: only cite a listed alt when news/chat naturally hits it — do not tour every coin.",
        "Most messages should have NO exact price — react, disagree, life, meme, trade talk instead.",
        "",
        "PRICES (majors + alts for news grounding):",
    ]
    majors = {"BTC", "ETH", "SOL"}
    major_rows = [c for c in snapshot.coins if c.symbol in majors]
    alt_rows = [c for c in snapshot.coins if c.symbol not in majors]
    for coin in major_rows:
        lines.append(
            f"- {coin.symbol}: {format_price(coin.usd)} "
            f"(24h {format_change(coin.usd_24h_change)})"
        )
    if alt_rows:
        lines.append("ALTS (use if news mentions them; optional otherwise):")
        for coin in alt_rows:
            lines.append(
                f"- {coin.symbol}: {format_price(coin.usd)} "
                f"(24h {format_change(coin.usd_24h_change)})"
            )

    gainers = list(snapshot.gainers or [])
    losers = list(snapshot.losers or [])
    if gainers or losers:
        lines.append("")
        lines.append(
            movers_to_brief(
                gainers,
                losers,
                source=snapshot.movers_source or "binance_ticker_24hr",
            )
        )
    elif snapshot.movers_error:
        lines.append("")
        lines.append(f"TOP MOVERS unavailable ({snapshot.movers_error}). Do not invent alt pumps.")

    must = [t.strip() for t in (must_discuss_news or []) if t and str(t).strip()]
    keywords = [t.strip() for t in (news_keywords or []) if t and str(t).strip()]

    lines.append("")
    if must:
        lines.append(f"MUST-DISCUSS NEWS (count={len(must)}) — REQUIRED:")
        lines.append(
            "Each of these MUST be paraphrased at least once in the full plan "
            "(casual group gossip). Never paste titles verbatim. No links. "
            "Spread mentions; do not dump all in the first 3 lines."
        )
        for i, title in enumerate(must[:12], start=1):
            lines.append(f"{i}. {title[:220]}")
        lines.append("")

    if selected_news is not None:
        chosen = [t.strip() for t in selected_news if t and str(t).strip()]
        # Must items are also selectable topics
        optional = [t for t in chosen if t not in must]
        if chosen or must:
            lines.append(
                f"USER-SELECTED NEWS TOPICS (optional count={len(optional)}, "
                f"must={len(must)}):"
            )
            lines.append(
                "Weave selected topics into chat casually as group gossip "
                "(paraphrase only, never paste titles verbatim, no links). "
                "Do NOT introduce other headlines beyond selected + must lists. "
                "LONG PLANS (80–200 lines): each news theme at most 1–2 times total; "
                "most lines stay price/vibe banter — do not recycle the same news every batch."
            )
            for i, title in enumerate(optional[:20], start=1):
                lines.append(f"{i}. {title[:220]}")
            if not optional and not must:
                pass
        else:
            lines.append("USER-SELECTED NEWS TOPICS: none.")
            lines.append(
                "Do not invent news headlines. Chat about price action / sentiment only "
                "plus the goal instructions."
            )
    elif snapshot.news:
        lines.append(
            f"NEWS LAST 24H (source={snapshot.news_source or 'rss'}, count={len(snapshot.news)}):"
        )
        lines.append(
            "You may casually reference 2-4 of these as group chat rumors/headlines "
            "(paraphrase only, never paste titles verbatim, no links)."
        )
        for i, item in enumerate(snapshot.news[:12], start=1):
            tag_s = ",".join(item.tags) if item.tags else "other"
            lines.append(f"{i}. [{item.source}|{tag_s}] {item.title}")
    else:
        lines.append("NEWS LAST 24H: none available.")
        if snapshot.news_error:
            lines.append(f"(reason: {snapshot.news_error})")
        lines.append("Do not invent breaking news or fake headlines.")

    if keywords:
        lines.append("")
        lines.append(
            "USER KEYWORD BIAS (prefer angles related to these words when natural; "
            "do not invent facts): " + ", ".join(keywords[:12])
        )

    if snapshot.notes:
        lines.append("")
        lines.append("Notes:")
        for note in snapshot.notes:
            lines.append(f"- {note}")
    return "\n".join(lines)
