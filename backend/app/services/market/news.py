"""Free crypto news via public RSS — no API key.

Strategy:
1) Prefer items in the last 24h
2) If none, fall back to 48h
3) If still none (bad clocks / odd pubDate), take newest raw items
4) Tag titles with rule-based keywords (btc/eth/sol/macro/etf/regulation/other)
"""

from __future__ import annotations

import asyncio
import email.utils
import logging
import re
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

RSS_FEEDS = [
    ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
    ("Cointelegraph", "https://cointelegraph.com/rss"),
    ("Decrypt", "https://decrypt.co/feed"),
]

_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_MAX_ITEMS = 20

NEWS_TAG_KEYWORDS: dict[str, tuple[str, ...]] = {
    "btc": ("bitcoin", "btc", "satoshi", "ordinals", "lightning network"),
    "eth": ("ethereum", "eth ", " ether", "vitalik", "eip-", "layer-2", "l2 ", "rollup"),
    "sol": ("solana", "sol ", "phantom wallet"),
    "etf": ("etf", "exchange-traded", "spot etf", "blackrock", "ishares"),
    "regulation": (
        "sec ",
        "cftc",
        "regulation",
        "regulatory",
        "lawsuit",
        "enforcement",
        "ban ",
        "legal",
        "congress",
        "white house",
    ),
    "macro": (
        "fed ",
        "fomc",
        "interest rate",
        "inflation",
        "cpi ",
        "jobs report",
        "treasury",
        "dollar ",
        "recession",
        "macro",
    ),
}

VALID_NEWS_TAGS = frozenset({*NEWS_TAG_KEYWORDS.keys(), "other"})


@dataclass
class NewsItem:
    title: str
    source: str
    published_at: str
    url: str = ""
    tags: list[str] = field(default_factory=list)


def tag_news_title(title: str) -> list[str]:
    """Rule-based tags from headline text."""
    text = f" {title.lower()} "
    found: list[str] = []
    for tag, keys in NEWS_TAG_KEYWORDS.items():
        if any(k in text for k in keys):
            found.append(tag)
    if not found:
        found.append("other")
    return found


def filter_news_items(
    items: list[NewsItem],
    *,
    q: str | None = None,
    tags: list[str] | None = None,
) -> list[NewsItem]:
    """Filter by free-text query and/or tag list (OR within tags)."""
    query = (q or "").strip().lower()
    wanted = {t.strip().lower() for t in (tags or []) if t and str(t).strip()}
    wanted &= VALID_NEWS_TAGS

    out: list[NewsItem] = []
    for item in items:
        item_tags = item.tags or tag_news_title(item.title)
        if wanted and not (wanted & set(item_tags)):
            continue
        if query:
            hay = f"{item.title} {item.source}".lower()
            # multi-token: all tokens must appear
            tokens = [t for t in re.split(r"\s+", query) if t]
            if tokens and not all(t in hay for t in tokens):
                continue
        if item.tags != item_tags:
            item = NewsItem(
                title=item.title,
                source=item.source,
                published_at=item.published_at,
                url=item.url,
                tags=item_tags,
            )
        out.append(item)
    return out


def _parse_rss_date(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    try:
        dt = email.utils.parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (TypeError, ValueError, IndexError, OverflowError):
        pass
    try:
        iso = value.replace("Z", "+00:00")
        iso = re.sub(r"\s+", "T", iso, count=1) if " " in iso and "T" not in iso else iso
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def _local_tag(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1]
    return tag


def _text(el: ET.Element | None) -> str:
    if el is None:
        return ""
    parts = [t.strip() for t in el.itertext() if t and t.strip()]
    if parts:
        return re.sub(r"\s+", " ", " ".join(parts)).strip()
    return ""


def _parse_rss_items(xml_bytes: bytes, source: str) -> list[tuple[datetime | None, NewsItem]]:
    """Return (published_dt|None, item). dt may be None if unparseable."""
    text = xml_bytes.decode("utf-8", errors="replace")
    text = re.sub(r'\sxmlns="[^"]+"', "", text, count=1)
    root = ET.fromstring(text.encode("utf-8"))
    items: list[tuple[datetime | None, NewsItem]] = []

    for node in root.iter():
        tag = _local_tag(node.tag).lower()
        if tag not in {"item", "entry"}:
            continue
        title = ""
        link = ""
        pub = ""
        for child in list(node):
            name = _local_tag(child.tag).lower()
            if name == "title":
                title = _text(child)
            elif name == "link":
                href = child.attrib.get("href") or child.attrib.get("HREF")
                link = (href or _text(child) or link).strip()
            elif name in {"pubdate", "published", "updated", "date", "dc:date"} or name.endswith(
                "date"
            ):
                pub = _text(child) or pub
        if not title:
            continue
        dt = _parse_rss_date(pub)
        tags = tag_news_title(title)
        items.append(
            (
                dt,
                NewsItem(
                    title=title[:220],
                    source=source,
                    published_at=(dt.isoformat() if dt else ""),
                    url=(link or "")[:500],
                    tags=tags,
                ),
            )
        )
    return items


def _fetch_feed_sync(source: str, url: str) -> list[tuple[datetime | None, NewsItem]]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": _USER_AGENT,
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
            "Accept-Language": "en-US,en;q=0.9",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        logger.warning("RSS %s HTTP %s", source, exc.code)
        return []
    except urllib.error.URLError as exc:
        logger.warning("RSS %s network: %s", source, exc.reason)
        return []
    try:
        return _parse_rss_items(raw, source)
    except ET.ParseError as exc:
        logger.warning("RSS %s parse error: %s", source, exc)
        return []


def _dedupe_sorted(
    rows: list[tuple[datetime | None, NewsItem]],
    *,
    max_items: int,
) -> list[NewsItem]:
    def sort_key(row: tuple[datetime | None, NewsItem]) -> datetime:
        dt, _ = row
        return dt or datetime.min.replace(tzinfo=timezone.utc)

    seen: set[str] = set()
    out: list[NewsItem] = []
    for dt, item in sorted(rows, key=sort_key, reverse=True):
        key = re.sub(r"[^a-z0-9]+", "", item.title.lower())[:80]
        if not key or key in seen:
            continue
        seen.add(key)
        tags = item.tags or tag_news_title(item.title)
        if not item.published_at and dt is not None:
            item = NewsItem(
                title=item.title,
                source=item.source,
                published_at=dt.isoformat(),
                url=item.url,
                tags=tags,
            )
        elif item.tags != tags:
            item = NewsItem(
                title=item.title,
                source=item.source,
                published_at=item.published_at,
                url=item.url,
                tags=tags,
            )
        out.append(item)
        if len(out) >= max_items:
            break
    return out


def fetch_news_24h_sync(
    *,
    max_items: int = _MAX_ITEMS,
    q: str | None = None,
    tags: list[str] | None = None,
) -> list[NewsItem]:
    """
    Fetch crypto headlines.

    Prefer last 24h; if empty use 48h; if still empty return newest items.
    Optional q/tags filter applied after pool selection (may return fewer than max_items).
    """
    pool_cap = max(max_items * 3, max_items)
    pooled: list[tuple[datetime | None, NewsItem]] = []
    for source, url in RSS_FEEDS:
        pooled.extend(_fetch_feed_sync(source, url))

    if not pooled:
        logger.warning("RSS: no items from any feed")
        return []

    now = datetime.now(timezone.utc)
    picked: list[NewsItem] = []
    for hours, label in ((24, "24h"), (48, "48h"), (168, "7d")):
        cutoff = now - timedelta(hours=hours)
        windowed = [
            (dt, item) for dt, item in pooled if dt is not None and dt >= cutoff
        ]
        picked = _dedupe_sorted(windowed, max_items=pool_cap)
        if picked:
            if hours > 24:
                logger.info("RSS: using %s window (%s items)", label, len(picked))
            break

    if not picked:
        logger.warning(
            "RSS: date filter empty (now=%s, raw=%s) — returning newest unfiltered",
            now.isoformat(),
            len(pooled),
        )
        picked = _dedupe_sorted(pooled, max_items=pool_cap)

    filtered = filter_news_items(picked, q=q, tags=tags)
    return filtered[:max_items]


async def fetch_news_24h(
    *,
    max_items: int = _MAX_ITEMS,
    q: str | None = None,
    tags: list[str] | None = None,
) -> list[NewsItem]:
    return await asyncio.to_thread(
        fetch_news_24h_sync, max_items=max_items, q=q, tags=tags
    )


def news_to_dicts(items: list[NewsItem]) -> list[dict[str, Any]]:
    return [asdict(item) for item in items]
