from datetime import datetime, timezone
from xml.etree.ElementTree import Element, SubElement, tostring

from app.services.campaign.goal_draft import build_goal_draft
from app.schemas.campaign import CampaignGoalDraftRequest
from app.services.market.binance_movers import (
    MoverQuote,
    movers_to_brief,
    rank_movers_from_tickers,
)
from app.services.market.coingecko import (
    CoinQuote,
    MarketSnapshot,
    format_market_brief,
    format_price,
)
from app.services.market.news import (
    NewsItem,
    _parse_rss_date,
    _parse_rss_items,
    fetch_news_24h_sync,
    filter_news_items,
    tag_news_title,
)


def test_format_price():
    assert format_price(62655) == "$62,655"
    assert format_price(1737.41) == "$1,737"
    assert format_price(77.59) == "$77.59"


def test_rank_movers_from_tickers():
    rows = [
        {
            "symbol": "PEPEUSDT",
            "lastPrice": "0.000012",
            "priceChangePercent": "22.5",
            "quoteVolume": "5000000",
        },
        {
            "symbol": "WIFUSDT",
            "lastPrice": "1.25",
            "priceChangePercent": "15.0",
            "quoteVolume": "3000000",
        },
        {
            "symbol": "ADAUSDT",
            "lastPrice": "0.45",
            "priceChangePercent": "-12.0",
            "quoteVolume": "8000000",
        },
        {
            "symbol": "DOGEUSDT",
            "lastPrice": "0.11",
            "priceChangePercent": "-8.0",
            "quoteVolume": "9000000",
        },
        {
            "symbol": "BTCUPUSDT",  # leveraged — skip
            "lastPrice": "10",
            "priceChangePercent": "50",
            "quoteVolume": "9000000",
        },
        {
            "symbol": "USDCUSDT",  # stable — skip
            "lastPrice": "1",
            "priceChangePercent": "0.01",
            "quoteVolume": "90000000",
        },
        {
            "symbol": "LOWVOLUSDT",  # below min volume
            "lastPrice": "2",
            "priceChangePercent": "99",
            "quoteVolume": "100",
        },
    ]
    gainers, losers = rank_movers_from_tickers(rows, top_n=2, min_quote_vol=2_000_000)
    assert [g.symbol for g in gainers] == ["PEPE", "WIF"]
    assert [l.symbol for l in losers] == ["ADA", "DOGE"]
    assert gainers[0].usd_24h_change == 22.5


def test_movers_to_brief_and_market_brief():
    gainers = [MoverQuote(symbol="PEPE", usd=0.000012, usd_24h_change=22.5, pair="PEPEUSDT")]
    losers = [MoverQuote(symbol="ADA", usd=0.45, usd_24h_change=-12.0, pair="ADAUSDT")]
    block = movers_to_brief(gainers, losers)
    assert "GAINERS" in block
    assert "PEPE" in block
    assert "LOSERS" in block
    assert "ADA" in block

    snap = MarketSnapshot(
        fetched_at="2026-07-10T00:00:00+00:00",
        source="test",
        coins=[
            CoinQuote(id="bitcoin", symbol="BTC", usd=62655.0, usd_24h_change=0.96),
            CoinQuote(id="ethereum", symbol="ETH", usd=1737.41, usd_24h_change=-0.2),
        ],
        notes=["test note"],
        news=[
            NewsItem(
                title="BTC holds key level as markets watch macro data",
                source="CoinDesk",
                published_at="2026-07-10T00:00:00+00:00",
            )
        ],
        news_source="rss:test",
        gainers=gainers,
        losers=losers,
        movers_source="binance_ticker_24hr",
    )
    brief = format_market_brief(snap)
    assert "BTC" in brief
    assert "ETH" in brief
    assert "62,655" in brief or "62655" in brief
    assert "MARKET SNAPSHOT" in brief
    assert "NEWS LAST 24H" in brief
    assert "BTC holds key level" in brief
    assert "TOP 24h MOVERS" in brief or "GAINERS" in brief
    assert "PEPE" in brief
    assert "PRICE DISCIPLINE" in brief

    selected = format_market_brief(
        snap,
        selected_news=["Only this headline about ETH staking"],
    )
    assert "USER-SELECTED NEWS TOPICS" in selected
    assert "Only this headline" in selected
    assert "BTC holds key level" not in selected

    none_news = format_market_brief(snap, selected_news=[])
    assert "USER-SELECTED NEWS TOPICS: none" in none_news

    must_brief = format_market_brief(
        snap,
        selected_news=["Optional ETH news"],
        must_discuss_news=["SEC files something important"],
        news_keywords=["ETF", "SEC"],
    )
    assert "MUST-DISCUSS NEWS" in must_brief
    assert "SEC files something" in must_brief
    assert "USER KEYWORD BIAS" in must_brief
    assert "ETF" in must_brief


def test_tag_and_filter_news():
    assert "btc" in tag_news_title("Bitcoin ETF inflows surge again")
    assert "etf" in tag_news_title("Bitcoin ETF inflows surge again")
    assert "eth" in tag_news_title("Ethereum upgrade discussion heats up")
    assert tag_news_title("Random lifestyle piece") == ["other"]

    items = [
        NewsItem(
            title="Bitcoin ETF inflows surge again",
            source="CoinDesk",
            published_at="",
            tags=tag_news_title("Bitcoin ETF inflows surge again"),
        ),
        NewsItem(
            title="Solana DEX volume cools",
            source="Decrypt",
            published_at="",
            tags=tag_news_title("Solana DEX volume cools"),
        ),
    ]
    only_etf = filter_news_items(items, tags=["etf"])
    assert len(only_etf) == 1
    assert "ETF" in only_etf[0].title or "etf" in only_etf[0].title.lower()

    q_hit = filter_news_items(items, q="solana")
    assert len(q_hit) == 1
    assert "Solana" in q_hit[0].title


def test_goal_draft_template():
    goal_vi = build_goal_draft(
        CampaignGoalDraftRequest(
            topic="btc_eth",
            tone="debate",
            conflict="medium",
            language="vi",
            message_length="short",
            selected_news=["Optional headline"],
            must_discuss_news=["Must headline ETF"],
        )
    )
    assert "tiếng Việt" in goal_vi or "Tiếng Việt" in goal_vi or "Việt" in goal_vi
    assert "Must headline ETF" in goal_vi
    assert "BTC" in goal_vi or "btc" in goal_vi.lower()

    goal_en = build_goal_draft(
        CampaignGoalDraftRequest(
            topic="btc_eth",
            tone="casual",
            conflict="low",
            language="en",
            message_length="short",
        )
    )
    assert "English" in goal_en or "english" in goal_en.lower() or "BTC" in goal_en
    assert "ừ" not in goal_en


def test_parse_rss_date_rfc2822():
    dt = _parse_rss_date("Thu, 10 Jul 2026 12:00:00 GMT")
    assert dt is not None
    assert dt.tzinfo is not None


def test_parse_rss_items_basic():
    from app.services.market.news import fetch_news_24h_sync

    rss = Element("rss")
    channel = SubElement(rss, "channel")
    item = SubElement(channel, "item")
    SubElement(item, "title").text = "Ethereum upgrade discussion heats up"
    SubElement(item, "link").text = "https://example.com/a"
    SubElement(item, "pubDate").text = datetime.now(timezone.utc).strftime(
        "%a, %d %b %Y %H:%M:%S GMT"
    )
    xml = tostring(rss, encoding="utf-8")
    parsed = _parse_rss_items(xml, "TestSource")
    assert len(parsed) == 1
    assert parsed[0][1].source == "TestSource"
    assert "Ethereum" in parsed[0][1].title


def test_fetch_news_24h_live_or_empty_list():
    # Network-dependent; must not crash. On CI may be empty.
    items = fetch_news_24h_sync(max_items=5)
    assert isinstance(items, list)
    for it in items:
        assert it.title
        assert it.source
