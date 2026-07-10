"""Deterministic goal text from wizard fields (no LLM required)."""

from __future__ import annotations

from ...schemas.campaign import CampaignGoalDraftRequest

_TOPIC_EN = {
    "btc_eth": "Main topic: today's BTC and ETH price action and group sentiment.",
    "alts": "Main topic: BTC/ETH first, with light alt mentions only if natural. No shilling.",
    "macro": "Main topic: today's market through a macro, rates, and risk-on/risk-off lens.",
    "mix": "Main topic: today's prices mixed with selected news as casual gossip.",
}

_TONE_EN = {
    "casual": "Friends texting on phones, casual and natural.",
    "debate": "Light friendly debate; people can disagree without insults.",
    "hype": "Mild excitement, but no spammy hype and no shilling.",
    "skeptical": "Mostly cautious takes, but not pure FUD.",
}

_CONFLICT_EN = {
    "none": "Everyone is roughly aligned; no forced argument.",
    "low": "One account is a little more cautious than the rest.",
    "medium": "Clear bull vs cautious/bear sides, with other accounts reacting naturally.",
}

_LENGTH_EN = {
    "short": (
        "Telegram phone bubbles with mixed length — many are only 1–2 words. "
        "Rough mix: 10–15% 1–2 words (Yep, Same, Pain, Hard pass, Good call), "
        "35–40% 3–5 words, 30–35% 6–8 words, 15–20% 9–12 words, almost never >12. "
        "Do not pad every message. Short–long rhythm is natural. "
        "Start each message with a capital letter."
    ),
    "medium": (
        "Mostly short phone messages with the same 1–2 word reactions mixed in. "
        "Occasional slightly longer takes, never newsletter paragraphs."
    ),
}

_TOPIC_VI = {
    "btc_eth": "Chủ đề chính: giá BTC/ETH hôm nay và cảm giác của nhóm.",
    "alts": "Chủ đề chính vẫn là BTC/ETH; alt chỉ nhắc nhẹ nếu tự nhiên, không shill.",
    "macro": "Nhìn market hôm nay theo góc macro, lãi suất, risk-on/risk-off.",
    "mix": "Xen giá hôm nay với tin đã chọn như bạn bè bàn tán.",
}

_TONE_VI = {
    "casual": "Bạn bè chat điện thoại, tự nhiên, đời thường.",
    "debate": "Tranh luận nhẹ, bất đồng được nhưng không công kích.",
    "hype": "Hơi hào hứng nhưng không spam hype, không shill.",
    "skeptical": "Thiên về thận trọng, nhưng không FUD quá đà.",
}

_CONFLICT_VI = {
    "none": "Mọi người gần như cùng quan điểm, không ép cãi.",
    "low": "Một account hơi thận trọng hơn phần còn lại.",
    "medium": "Có phe bull và phe thận trọng/bear, người khác phản ứng tự nhiên.",
}

_LENGTH_VI = {
    "short": (
        "Tin Telegram kiểu điện thoại, độ dài xen kẽ — nhiều tin chỉ 1–2 từ. "
        "Gợi ý: 10–15% 1–2 từ (Chuẩn, Đau, Ok, Khỏi, Hard pass…), "
        "phần lớn 3–8 từ, gần như không >12 từ. "
        "Không nhồi đủ từ. Viết hoa chữ cái đầu."
    ),
    "medium": (
        "Chủ yếu tin ngắn + vài tin 1–2 từ xen kẽ. "
        "Thỉnh thoảng câu dài hơn một chút, không viết đoạn phân tích."
    ),
}


def _is_vi(language: str) -> bool:
    return language in ("vi", "vietnamese", "vn")


def _selected_news_bits(
    *,
    must: list[str],
    optional: list[str],
    use_vi: bool,
) -> list[str]:
    if use_vi:
        if not must and not optional:
            return [
                "Không có tin cụ thể được chọn; chỉ nói về giá, sentiment, và không bịa breaking news."
            ]
        parts: list[str] = []
        if must:
            parts.append(
                "Bắt buộc bàn tán tự nhiên, diễn lại bằng lời riêng, ít nhất một lần mỗi tin: "
                + "; ".join(must[:6])
                + "."
            )
        if optional:
            parts.append(
                "Tin tùy chọn, chỉ chọn vài tin nếu hợp mạch chat: "
                + "; ".join(optional[:8])
                + "."
            )
        return parts

    if not must and not optional:
        return [
            "No specific headlines selected; talk about price action and sentiment only. Do not invent breaking news."
        ]
    parts = []
    if must:
        parts.append(
            "Must casually paraphrase each of these news angles at least once, never paste titles or links: "
            + "; ".join(must[:6])
            + "."
        )
    if optional:
        parts.append(
            "Optional news gossip, pick only what fits the flow: "
            + "; ".join(optional[:8])
            + "."
        )
    return parts


def build_goal_draft(req: CampaignGoalDraftRequest) -> str:
    lang = (req.language or "auto").strip().lower()
    use_vi = _is_vi(lang)

    must = [t.strip() for t in (req.must_discuss_news or []) if t and str(t).strip()]
    selected = [t.strip() for t in (req.selected_news or []) if t and str(t).strip()]
    optional = [t for t in selected if t not in must]

    if use_vi:
        bits = [
            _TONE_VI.get(req.tone, _TONE_VI["casual"]),
            _TOPIC_VI.get(req.topic, _TOPIC_VI["btc_eth"]),
            _CONFLICT_VI.get(req.conflict, _CONFLICT_VI["low"]),
            _LENGTH_VI.get(req.message_length, _LENGTH_VI["short"]),
            (
                "Toàn bộ chat bằng tiếng Việt tự nhiên, có dấu đúng. "
                "Ticker BTC/ETH/SOL được giữ nguyên. Không xen câu tiếng Anh."
            ),
            (
                "Giá live chỉ nhắc kiểu khoảng/gần/tầm. "
                "Không dán link, không shill, không giọng MC/chuyên gia."
            ),
            *_selected_news_bits(must=must, optional=optional, use_vi=True),
            (
                "Mạch chat phải mượt: người sau phản ứng ý người trước, không strict round-robin, "
                "không spam tin một chữ, không tổng kết trang trọng."
            ),
        ]
        return " ".join(bits)

    bits = [
        _TONE_EN.get(req.tone, _TONE_EN["casual"]),
        _TOPIC_EN.get(req.topic, _TOPIC_EN["btc_eth"]),
        _CONFLICT_EN.get(req.conflict, _CONFLICT_EN["low"]),
        _LENGTH_EN.get(req.message_length, _LENGTH_EN["short"]),
        (
            "All chat in English only unless the campaign language is changed to Vietnamese. "
            "Use one language only."
        ),
        (
            "Use live prices approximately with around/near/roughly. "
            "No links, no shilling, no analyst/newsletter tone."
        ),
        *_selected_news_bits(must=must, optional=optional, use_vi=False),
        (
            "Conversation must flow naturally: people react to previous ideas, not strict round-robin, "
            "include 10–15% one-or-two-word reacts (Yep/Same/Pain), "
            "never spam 'Fair, but…', allow lol/idk/wtf/nvm, "
            "do not re-chew the same BTC/ETH level constantly, "
            "no formal summary."
        ),
    ]
    return " ".join(bits)
