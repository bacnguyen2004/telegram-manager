from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.services.auto_profile.applier import apply_profile_row
from app.services.auto_profile.generator import (
    ProfileRatios,
    generate_preview,
    generate_profile_row,
    random_username,
)


def test_generate_preview_unique_phones_and_fields():
    rows = generate_preview(
        ["+111", "+111", "+222", ""],
        region="global",
        delete_old_avatar=False,
    )
    assert len(rows) == 2
    phones = {row.phone for row in rows}
    assert phones == {"+111", "+222"}
    for row in rows:
        assert row.first_name
        assert 5 <= len(row.username) <= 32
        assert row.username.replace("_", "").isalnum()
        assert row.avatar_mode in {"keep", "delete", "url"}
        if row.avatar_mode == "url":
            assert row.avatar_url.startswith("http")


def test_generate_vietnam_region():
    row = generate_profile_row("+84901", region="vietnam")
    assert row.region == "vietnam"
    assert row.first_name


def test_delete_old_avatar_when_keep_mode_selected_via_ratio():
    ratios = ProfileRatios(
        avatar_keep=100,
        avatar_dicebear=0,
        avatar_picsum=0,
        avatar_ui=0,
    )
    row = generate_profile_row(
        "+84902",
        region="global",
        delete_old_avatar=True,
        ratios=ratios,
    )
    assert row.avatar_mode == "delete"
    assert row.avatar_url == ""


def test_random_username_length():
    for _ in range(20):
        name = random_username("Nguyen Van A")
        assert 5 <= len(name) <= 32


@pytest.mark.asyncio
async def test_apply_profile_row_success_keep_avatar():
    service = SimpleNamespace(
        update_profile=AsyncMock(
            return_value={"status": "success", "phone": "+1", "message": "ok"}
        ),
        delete_avatar=AsyncMock(),
        upload_avatar=AsyncMock(),
    )
    with patch("app.services.auto_profile.applier.metadata_store") as store:
        store.record_audit = lambda *args, **kwargs: None
        result = await apply_profile_row(
            {
                "phone": "+1",
                "first_name": "Alex",
                "last_name": "Doe",
                "username": "alexdoe12",
                "about": "hi",
                "avatar_mode": "keep",
                "avatar_url": "",
            },
            session_service=service,
        )
    assert result["status"] == "success"
    service.update_profile.assert_awaited_once()
    service.upload_avatar.assert_not_awaited()
    service.delete_avatar.assert_not_awaited()


@pytest.mark.asyncio
async def test_apply_profile_row_retries_username_then_uploads():
    service = SimpleNamespace(
        update_profile=AsyncMock(
            side_effect=[
                {"status": "error", "message": "Username da duoc su dung"},
                {"status": "success", "phone": "+1", "message": "ok"},
            ]
        ),
        delete_avatar=AsyncMock(),
        upload_avatar=AsyncMock(
            return_value={"status": "success", "phone": "+1", "message": "ok"}
        ),
    )
    with (
        patch("app.services.auto_profile.applier.metadata_store") as store,
        patch(
            "app.services.auto_profile.applier.fetch_avatar_bytes",
            new=AsyncMock(return_value=b"fake-image"),
        ),
        patch(
            "app.services.auto_profile.applier.random_username",
            return_value="freshuser99",
        ),
    ):
        store.record_audit = lambda *args, **kwargs: None
        result = await apply_profile_row(
            {
                "phone": "+1",
                "first_name": "Alex",
                "last_name": "",
                "username": "taken",
                "about": "",
                "avatar_mode": "url",
                "avatar_url": "https://example.com/a.png",
            },
            session_service=service,
            username_retries=3,
        )
    assert result["status"] == "success"
    assert result["applied_username"] == "freshuser99"
    assert service.update_profile.await_count == 2
    service.upload_avatar.assert_awaited_once()


def test_preview_endpoint(client):
    res = client.post(
        "/api/auto-profile/preview",
        json={
            "phones": ["+84111", "+84222"],
            "region": "mix",
            "delete_old_avatar": False,
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["data"]["total"] == 2
    assert len(body["data"]["items"]) == 2
