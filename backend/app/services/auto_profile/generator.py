"""Pure auto-profile row generation (no Telegram / network I/O)."""

from __future__ import annotations

import random
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from urllib.parse import quote

from .pools import (
    BIO_ACTIVITIES,
    BIO_CITIES,
    BIO_MOODS,
    BIO_OBJECTS,
    BIO_SHORT,
    BIO_TEMPLATES,
    COMMON_WORDS,
    DICEBEAR_STYLES,
    GLOBAL_FIRST,
    GLOBAL_LAST,
    NAME_TOKENS,
    VN_DEM,
    VN_HO,
    VN_TEN,
)

Region = Literal["global", "vietnam", "mix"]
AvatarMode = Literal["keep", "delete", "url"]


@dataclass(frozen=True)
class ProfileRatios:
    bio_empty: float = 25
    bio_short: float = 45
    bio_template: float = 30
    avatar_keep: float = 35
    avatar_dicebear: float = 35
    avatar_picsum: float = 15
    avatar_ui: float = 15
    mix_global: float = 50
    mix_vietnam: float = 50


@dataclass(frozen=True)
class ProfileRow:
    phone: str
    region: str
    first_name: str
    last_name: str
    username: str
    about: str
    avatar_mode: AvatarMode
    avatar_url: str = ""
    avatar_label: str = ""

    def to_dict(self) -> dict:
        return {
            "phone": self.phone,
            "region": self.region,
            "first_name": self.first_name,
            "last_name": self.last_name,
            "username": self.username,
            "about": self.about,
            "avatar_mode": self.avatar_mode,
            "avatar_url": self.avatar_url,
            "avatar_label": self.avatar_label,
        }


def _weighted_choice(items: list[tuple[str, float]]) -> str:
    cleaned = [(key, max(float(weight), 0.0)) for key, weight in items]
    total = sum(w for _, w in cleaned)
    if total <= 0:
        return cleaned[-1][0]
    point = random.uniform(0, total)
    upto = 0.0
    for key, weight in cleaned:
        upto += weight
        if point <= upto:
            return key
    return cleaned[-1][0]


def _slug(value: str, max_len: int = 18) -> str:
    normalized = unicodedata.normalize("NFD", str(value or ""))
    plain = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    plain = re.sub(r"[^a-zA-Z0-9]+", "", plain.lower())
    return plain[:max_len]


def _pick_region(region: Region, ratios: ProfileRatios) -> str:
    if region == "mix":
        return _weighted_choice(
            [("global", ratios.mix_global), ("vietnam", ratios.mix_vietnam)]
        )
    return "vietnam" if region == "vietnam" else "global"


def _global_name() -> str:
    mode = _weighted_choice(
        [
            ("first_last", 40),
            ("token_two", 25),
            ("single", 20),
            ("nickname", 15),
        ]
    )
    if mode == "first_last":
        return f"{random.choice(GLOBAL_FIRST)} {random.choice(GLOBAL_LAST)}"
    if mode == "token_two":
        a = random.choice(NAME_TOKENS).capitalize()
        b = random.choice(NAME_TOKENS).capitalize()
        return f"{a} {b}"
    if mode == "single":
        return random.choice(GLOBAL_FIRST)
    return random.choice(NAME_TOKENS)


def _vietnam_name() -> str:
    mode = _weighted_choice(
        [
            ("family_two", 30),
            ("family_three", 25),
            ("two_token", 25),
            ("one_token", 20),
        ]
    )
    if mode == "family_two":
        return f"{random.choice(VN_HO)} {random.choice(VN_TEN)}"
    if mode == "family_three":
        return f"{random.choice(VN_HO)} {random.choice(VN_DEM)} {random.choice(VN_TEN)}"
    if mode == "two_token":
        return f"{random.choice(VN_DEM)} {random.choice(VN_TEN)}"
    return random.choice(VN_TEN)


def _split_name(display_name: str) -> tuple[str, str]:
    parts = display_name.strip().split()
    if not parts:
        return "User", ""
    if len(parts) == 1 or random.random() < 0.35:
        return " ".join(parts), ""
    return " ".join(parts[:-1]), parts[-1]


def random_username(display_name: str = "") -> str:
    base = _slug(display_name, 16) or _slug(random.choice(COMMON_WORDS), 16)
    word = _slug(random.choice(COMMON_WORDS + NAME_TOKENS), 10)
    year = str(datetime.now().year)[2:]
    number = random.randint(10, 99999)
    candidates = [
        f"{base}{number}",
        f"{base}_{word}",
        f"{word}_{base}",
        f"{base}{word}",
        f"{base}_{random.randint(100, 999)}",
        f"{word}{random.randint(100, 99999)}",
        f"{base}{year}",
    ]
    username = re.sub(r"_+", "_", random.choice(candidates)).strip("_")[:32]
    if len(username) < 5:
        username = f"{username}{random.randint(1000, 9999)}"
    return username.lower()


def _random_bio(ratios: ProfileRatios) -> str:
    mode = _weighted_choice(
        [
            ("empty", ratios.bio_empty),
            ("short", ratios.bio_short),
            ("template", ratios.bio_template),
        ]
    )
    if mode == "empty":
        return ""
    if mode == "short":
        return random.choice(BIO_SHORT)
    return random.choice(BIO_TEMPLATES).format(
        object=random.choice(BIO_OBJECTS),
        mood=random.choice(BIO_MOODS),
        activity=random.choice(BIO_ACTIVITIES),
        city=random.choice(BIO_CITIES),
    )


def _random_avatar(
    *,
    region: str,
    phone: str,
    username: str,
    first_name: str,
    delete_old_avatar: bool,
    ratios: ProfileRatios,
) -> tuple[AvatarMode, str, str]:
    mode = _weighted_choice(
        [
            ("keep", ratios.avatar_keep),
            ("dicebear", ratios.avatar_dicebear),
            ("picsum", ratios.avatar_picsum),
            ("ui", ratios.avatar_ui),
        ]
    )
    if mode == "keep":
        if delete_old_avatar:
            return "delete", "", "Xóa avatar"
        return "keep", "", "Giữ nguyên"

    seed = f"{region}_{username}_{phone}_{random.randint(1, 999999)}"
    if mode == "dicebear":
        style = random.choice(DICEBEAR_STYLES)
        url = f"https://api.dicebear.com/9.x/{style}/png?seed={quote(seed)}&size=512"
        return "url", url, f"DiceBear {style}"
    if mode == "picsum":
        url = f"https://picsum.photos/seed/{quote(seed)}/512/512"
        return "url", url, "Picsum"
    name = quote(first_name or username or "User")
    url = f"https://ui-avatars.com/api/?name={name}&size=512&background=random"
    return "url", url, "UI Avatars"


def generate_profile_row(
    phone: str,
    *,
    region: Region = "global",
    delete_old_avatar: bool = False,
    ratios: ProfileRatios | None = None,
) -> ProfileRow:
    ratios = ratios or ProfileRatios()
    phone = str(phone or "").strip()
    picked = _pick_region(region, ratios)
    display = _vietnam_name() if picked == "vietnam" else _global_name()
    first_name, last_name = _split_name(display)
    if not first_name:
        first_name = "User"
    username = random_username(display)
    about = _random_bio(ratios)
    avatar_mode, avatar_url, avatar_label = _random_avatar(
        region=picked,
        phone=phone,
        username=username,
        first_name=first_name,
        delete_old_avatar=delete_old_avatar,
        ratios=ratios,
    )
    return ProfileRow(
        phone=phone,
        region=picked,
        first_name=first_name[:64],
        last_name=last_name[:64],
        username=username[:32],
        about=about[:70],
        avatar_mode=avatar_mode,
        avatar_url=avatar_url,
        avatar_label=avatar_label,
    )


def generate_preview(
    phones: list[str],
    *,
    region: Region = "global",
    delete_old_avatar: bool = False,
    ratios: ProfileRatios | None = None,
) -> list[ProfileRow]:
    rows: list[ProfileRow] = []
    seen: set[str] = set()
    for raw in phones:
        phone = str(raw or "").strip()
        if not phone or phone in seen:
            continue
        seen.add(phone)
        rows.append(
            generate_profile_row(
                phone,
                region=region,
                delete_old_avatar=delete_old_avatar,
                ratios=ratios,
            )
        )
    return rows
