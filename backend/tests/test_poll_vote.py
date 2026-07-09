from types import SimpleNamespace

from telethon.tl.types import (
    MessageMediaPoll,
    MessageMediaToDo,
    MessageMediaWebPage,
    PeerUser,
    PollAnswerVoters,
    PollResults,
    TodoCompletion,
)

from app.routers import messages
from app.services.telegram.actions import TelegramMessageService


def _answer(label: str, option: bytes) -> SimpleNamespace:
    return SimpleNamespace(text=SimpleNamespace(text=label), option=option)


def test_poll_object_from_message_media_poll():
    poll = SimpleNamespace(
        question=SimpleNamespace(text="NOOOOOOOOOO"),
        answers=[_answer("hi", b"a"), _answer("b", b"b")],
    )
    message = SimpleNamespace(
        id=82839,
        media=MessageMediaPoll(poll=poll, results=None),
        poll=None,
    )
    extracted = TelegramMessageService._extract_poll(message)
    assert extracted is not None
    assert extracted[2] == 82839
    assert len(extracted[1]) == 2


def test_poll_object_from_message_poll_property():
    poll = SimpleNamespace(
        question=SimpleNamespace(text="Test"),
        answers=[_answer("yes", b"y")],
    )
    message = SimpleNamespace(id=12, media=None, poll=poll)
    extracted = TelegramMessageService._extract_poll(message)
    assert extracted is not None
    assert TelegramMessageService._poll_answer_label(extracted[1][0]) == "yes"


def test_webpage_target_link_extracts_tme_post():
    webpage = SimpleNamespace(
        url="https://t.me/Fomo_Gems_Chat/82839",
        display_url="",
    )
    message = SimpleNamespace(
        media=MessageMediaWebPage(webpage=webpage, force_large_media=False, manual=False, safe=True)
    )
    assert (
        TelegramMessageService._webpage_target_link(message)
        == "https://t.me/Fomo_Gems_Chat/82839"
    )


def test_resolve_poll_option_by_index():
    answers = [
        _answer("Co", b"a"),
        _answer("Khong", b"b"),
    ]
    resolved = TelegramMessageService._resolve_poll_option(answers, "2")
    assert resolved == (b"b", "Khong")


def test_extract_todo_from_message_media_todo():
    todo = SimpleNamespace(
        title=SimpleNamespace(text="Pick one"),
        list=[
            SimpleNamespace(id=1, title=SimpleNamespace(text="A")),
            SimpleNamespace(id=2, title=SimpleNamespace(text="B")),
        ],
    )
    message = SimpleNamespace(
        id=99,
        media=MessageMediaToDo(todo=todo, completions=None),
        poll=None,
    )
    extracted = TelegramMessageService._extract_votable(message)
    assert extracted is not None
    assert extracted[0] == "todo"
    assert extracted[2][1].id == 2
    assert TelegramMessageService._option_label("todo", extracted[2][1]) == "B"


def test_resolve_poll_option_by_hex():
    answers = [
        _answer("Co", b"\x32"),
        _answer("Khong", b"\x33"),
    ]
    resolved = TelegramMessageService._resolve_poll_option(answers, "32")
    assert resolved == (b"\x32", "Co")


def test_serialize_poll_option_includes_hex():
    answers = [_answer("Co", b"\x32"), _answer("Khong", b"\x33")]
    item = TelegramMessageService._serialize_poll_option("poll", answers[0], 0)
    assert item["option_hex"] == "32"
    assert item["todo_item_id"] is None


def test_poll_vote_meta_marks_chosen_poll_options():
    poll = SimpleNamespace(
        question=SimpleNamespace(text="Pick"),
        answers=[_answer("Co", b"a"), _answer("Khong", b"b")],
    )
    results = PollResults(
        total_voters=5,
        can_view_stats=True,
        results=[
            PollAnswerVoters(option=b"a", chosen=True, voters=3),
            PollAnswerVoters(option=b"b", chosen=False, voters=2),
        ],
    )
    message = SimpleNamespace(
        id=42,
        media=MessageMediaPoll(poll=poll, results=results),
        poll=None,
    )
    meta = TelegramMessageService._poll_vote_meta("poll", message, 1001)
    assert meta["total_voters"] == 5
    assert meta["can_view_stats"] is True
    assert meta["option_stats"]["61"]["chosen"] is True
    assert meta["option_stats"]["61"]["voters"] == 3


def test_poll_vote_meta_marks_todo_completions_for_me():
    todo = SimpleNamespace(
        title=SimpleNamespace(text="Tasks"),
        list=[
            SimpleNamespace(id=10, title=SimpleNamespace(text="A")),
            SimpleNamespace(id=11, title=SimpleNamespace(text="B")),
        ],
    )
    completions = [
        TodoCompletion(id=10, completed_by=PeerUser(user_id=7), date=None),
        TodoCompletion(id=11, completed_by=PeerUser(user_id=99), date=None),
    ]
    message = SimpleNamespace(
        id=55,
        media=MessageMediaToDo(todo=todo, completions=completions),
        poll=None,
    )
    meta = TelegramMessageService._poll_vote_meta("todo", message, 7)
    assert meta["option_stats"]["todo:10"]["chosen"] is True
    assert "todo:11" not in meta["option_stats"]


def test_votable_settings_maps_poll_flags():
    poll = SimpleNamespace(
        multiple_choice=True,
        open_answers=True,
        shuffle_answers=True,
        revoting_disabled=False,
        closed=False,
        quiz=False,
        public_voters=True,
        close_date=None,
    )
    settings = TelegramMessageService._votable_settings("poll", poll)
    assert settings["multiple_choice"] is True
    assert settings["open_answers"] is True
    assert settings["revoting_allowed"] is True


def test_normalize_vote_tokens_accepts_list_and_csv():
    assert TelegramMessageService._normalize_vote_tokens("", ["32", "33"]) == ["32", "33"]
    assert TelegramMessageService._normalize_vote_tokens("32,33", None) == ["32", "33"]


def test_resolve_poll_option_by_text():
    answers = [
        _answer("Yes", b"a"),
        _answer("No", b"b"),
    ]
    resolved = TelegramMessageService._resolve_poll_option(answers, "yes")
    assert resolved == (b"a", "Yes")


async def test_get_poll_info_success(client, monkeypatch):
    async def mock_get_poll_info(
        phone: str, peer_id: str, message_id: int, *, link: str | None = None
    ) -> dict:
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "question": "Ban co dong y khong?",
            "options": [
                {"index": 1, "label": "Co"},
                {"index": 2, "label": "Khong"},
            ],
            "message": "OK",
        }

    monkeypatch.setattr(
        messages.telegram_message_service,
        "get_poll_info",
        mock_get_poll_info,
    )

    response = client.get(
        "/api/messages/poll",
        params={
            "phone": "+84901234567",
            "peer_id": "123456789",
            "message_id": 42,
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "success"
    assert data["question"] == "Ban co dong y khong?"
    assert len(data["options"]) == 2
    assert data["options"][0]["label"] == "Co"


async def test_vote_poll_success(client, monkeypatch):
    async def mock_vote_poll(
        phone: str,
        peer_id: str,
        message_id: int,
        option: str = "",
        *,
        options: list[str] | None = None,
        link: str | None = None,
    ) -> dict:
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "option": "Co",
            "message": "Da vote: Co",
        }

    monkeypatch.setattr(
        messages.telegram_message_service,
        "vote_poll",
        mock_vote_poll,
    )

    response = client.post(
        "/api/messages/vote",
        json={
            "phone": "+84901234567",
            "peer_id": "123456789",
            "message_id": 42,
            "option": "1",
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "success"
    assert data["option"] == "Co"
    assert data["message_id"] == 42


async def test_vote_poll_invalid_option(client, monkeypatch):
    async def mock_vote_poll(
        phone: str,
        peer_id: str,
        message_id: int,
        option: str = "",
        *,
        options: list[str] | None = None,
        link: str | None = None,
    ) -> dict:
        return {
            "status": "error",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "option": None,
            "message": "Lua chon khong hop le. Co: 1. Co, 2. Khong",
        }

    monkeypatch.setattr(
        messages.telegram_message_service,
        "vote_poll",
        mock_vote_poll,
    )

    response = client.post(
        "/api/messages/vote",
        json={
            "phone": "+84901234567",
            "peer_id": "123456789",
            "message_id": 42,
            "option": "9",
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "error"
    assert "khong hop le" in data["message"].lower()


def test_can_append_options_for_poll_and_todo():
    poll = SimpleNamespace(open_answers=True)
    todo = SimpleNamespace(others_can_append=True)
    assert TelegramMessageService._can_append_options("poll", poll) is True
    assert TelegramMessageService._can_append_options("todo", todo) is True
    assert TelegramMessageService._can_append_options("poll", SimpleNamespace(open_answers=False)) is False


def test_find_added_option_returns_latest_match():
    answers = [
        _answer("Custom", b"\x01"),
        _answer("Custom", b"\x02"),
    ]
    found = TelegramMessageService._find_added_option("poll", answers, "Custom")
    assert found == ("02", None)


def test_next_todo_item_id():
    items = [SimpleNamespace(id=1), SimpleNamespace(id=5)]
    assert TelegramMessageService._next_todo_item_id(items) == 6


async def test_add_poll_option_success(client, monkeypatch):
    async def mock_add_poll_option(
        phone: str,
        peer_id: str,
        message_id: int,
        label: str,
        *,
        link: str | None = None,
        vote_after: bool = False,
    ) -> dict:
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "label": label,
            "option_hex": "ab",
            "todo_item_id": None,
            "voted": vote_after,
            "message": "Da them dap an: Custom",
        }

    monkeypatch.setattr(
        messages.telegram_message_service,
        "add_poll_option",
        mock_add_poll_option,
    )

    response = client.post(
        "/api/messages/poll/add-option",
        json={
            "phone": "+84901234567",
            "peer_id": "123456789",
            "message_id": 42,
            "label": "Custom",
            "vote_after": True,
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "success"
    assert data["option_hex"] == "ab"
    assert data["voted"] is True


async def test_cancel_poll_vote_success(client, monkeypatch):
    async def mock_cancel_poll_vote(
        phone: str,
        peer_id: str,
        message_id: int,
        *,
        link: str | None = None,
        options: list[str] | None = None,
    ) -> dict:
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "option": None,
            "message": "Da huy vote poll",
        }

    monkeypatch.setattr(
        messages.telegram_message_service,
        "cancel_poll_vote",
        mock_cancel_poll_vote,
    )

    response = client.post(
        "/api/messages/vote/cancel",
        json={
            "phone": "+84901234567",
            "peer_id": "123456789",
            "message_id": 42,
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "success"
    assert data["message"] == "Da huy vote poll"


async def test_vote_poll_accepts_options_list(client, monkeypatch):
    captured: dict = {}

    async def mock_vote_poll(
        phone: str,
        peer_id: str,
        message_id: int,
        option: str = "",
        *,
        options: list[str] | None = None,
        link: str | None = None,
    ) -> dict:
        captured["options"] = options
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "option": "A, B",
            "message": "Da vote: A, B",
        }

    monkeypatch.setattr(
        messages.telegram_message_service,
        "vote_poll",
        mock_vote_poll,
    )

    response = client.post(
        "/api/messages/vote",
        json={
            "phone": "+84901234567",
            "peer_id": "123456789",
            "message_id": 42,
            "option": "",
            "options": ["32", "33"],
        },
    )

    assert response.status_code == 200
    assert captured["options"] == ["32", "33"]


async def test_vote_poll_allows_option_from_link(client, monkeypatch):
    captured: dict = {}

    async def mock_vote_poll(
        phone: str,
        peer_id: str,
        message_id: int,
        option: str = "",
        *,
        options: list[str] | None = None,
        link: str | None = None,
    ) -> dict:
        captured["option"] = option
        captured["link"] = link
        return {
            "status": "success",
            "phone": phone,
            "peer_id": peer_id,
            "message_id": message_id,
            "reply_to_msg_id": None,
            "option": "option",
            "message": "Da vote: option",
        }

    monkeypatch.setattr(
        messages.telegram_message_service,
        "vote_poll",
        mock_vote_poll,
    )

    response = client.post(
        "/api/messages/vote",
        json={
            "phone": "+84901234567",
            "peer_id": "123456789",
            "message_id": 42,
            "link": "https://t.me/example/42?option=MQ",
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "success"
    assert captured["option"] == ""
    assert captured["link"] == "https://t.me/example/42?option=MQ"
