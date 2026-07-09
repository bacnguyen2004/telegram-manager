from telethon.tl.types import MessageMediaPoll, MessageMediaToDo, TextWithEntities


class PollSerializeMixin:
    @staticmethod
    def _text_with_entities(value: str) -> TextWithEntities:
        return TextWithEntities(text=value, entities=[])

    @staticmethod
    def _can_append_options(kind: str, source) -> bool:
        if kind == "todo":
            return bool(getattr(source, "others_can_append", False))
        return bool(getattr(source, "open_answers", False))

    @staticmethod
    def _next_todo_item_id(items: list) -> int:
        max_id = 0
        for item in items:
            item_id = getattr(item, "id", 0) or 0
            if item_id > max_id:
                max_id = item_id
        return max_id + 1

    @classmethod
    def _find_added_option(
        cls,
        kind: str,
        options: list,
        label: str,
    ) -> tuple[str | None, int | None] | None:
        target = label.casefold().strip()
        matches: list[tuple[str | None, int | None]] = []

        for item in options:
            item_label = cls._option_label(kind, item).casefold().strip()
            if item_label != target:
                continue
            if kind == "poll":
                option_bytes = getattr(item, "option", b"") or b""
                matches.append((option_bytes.hex(), None))
            else:
                matches.append((None, getattr(item, "id", None)))

        if not matches:
            return None
        return matches[-1]

    @classmethod
    def _votable_settings(cls, kind: str, source) -> dict:
        if kind == "todo":
            return {
                "kind": "todo",
                "multiple_choice": True,
                "open_answers": bool(getattr(source, "others_can_append", False)),
                "shuffle_answers": False,
                "revoting_allowed": bool(
                    getattr(source, "others_can_complete", True)
                ),
                "closed": False,
                "quiz": False,
                "public_voters": False,
                "close_date": None,
            }

        close_date = getattr(source, "close_date", None)
        close_date_value = None
        if close_date is not None and hasattr(close_date, "isoformat"):
            close_date_value = close_date.isoformat()

        return {
            "kind": "poll",
            "multiple_choice": bool(getattr(source, "multiple_choice", False)),
            "open_answers": bool(getattr(source, "open_answers", False)),
            "shuffle_answers": bool(getattr(source, "shuffle_answers", False)),
            "revoting_allowed": not bool(getattr(source, "revoting_disabled", False)),
            "closed": bool(getattr(source, "closed", False)),
            "quiz": bool(getattr(source, "quiz", False)),
            "public_voters": bool(getattr(source, "public_voters", False)),
            "close_date": close_date_value,
        }

    @classmethod
    def _serialize_poll_option(
        cls,
        kind: str,
        item,
        index: int,
        *,
        chosen: bool = False,
        voters: int | None = None,
    ) -> dict:
        label = cls._option_label(kind, item) or str(index + 1)
        if kind == "poll":
            option_bytes = getattr(item, "option", b"") or b""
            return {
                "index": index + 1,
                "label": label,
                "option_hex": option_bytes.hex(),
                "todo_item_id": None,
                "chosen": chosen,
                "voters": voters,
            }
        return {
            "index": index + 1,
            "label": label,
            "option_hex": "",
            "todo_item_id": getattr(item, "id", None),
            "chosen": chosen,
            "voters": voters,
        }

    @staticmethod
    def _peer_user_id(peer) -> int | None:
        if peer is None:
            return None
        user_id = getattr(peer, "user_id", None)
        if user_id is not None:
            return int(user_id)
        return None

    @classmethod
    def _poll_option_stats_key(cls, kind: str, item, index: int) -> str:
        if kind == "poll":
            option_bytes = getattr(item, "option", b"") or b""
            return option_bytes.hex()
        todo_item_id = getattr(item, "id", None)
        if todo_item_id is not None:
            return f"todo:{todo_item_id}"
        return f"todo-index:{index + 1}"

    @classmethod
    def _poll_vote_meta(cls, kind: str, poll_message, me_id: int) -> dict:
        option_stats: dict[str, dict] = {}
        total_voters: int | None = None
        can_view_stats = False

        if not poll_message:
            return {
                "option_stats": option_stats,
                "total_voters": total_voters,
                "can_view_stats": can_view_stats,
            }

        media = getattr(poll_message, "media", None)
        if kind == "poll" and isinstance(media, MessageMediaPoll):
            results = getattr(media, "results", None)
            if results is not None:
                total_voters = getattr(results, "total_voters", None)
                can_view_stats = bool(getattr(results, "can_view_stats", False))
                for item in getattr(results, "results", None) or []:
                    option_bytes = getattr(item, "option", b"") or b""
                    option_stats[option_bytes.hex()] = {
                        "chosen": bool(getattr(item, "chosen", False)),
                        "voters": getattr(item, "voters", None),
                    }
        elif kind == "todo" and isinstance(media, MessageMediaToDo):
            for completion in getattr(media, "completions", None) or []:
                if cls._peer_user_id(getattr(completion, "completed_by", None)) != me_id:
                    continue
                todo_item_id = getattr(completion, "id", None)
                if todo_item_id is None:
                    continue
                option_stats[f"todo:{todo_item_id}"] = {
                    "chosen": True,
                    "voters": None,
                }

        return {
            "option_stats": option_stats,
            "total_voters": total_voters,
            "can_view_stats": can_view_stats,
        }

    @classmethod
    def _suggest_option_index(
        cls,
        kind: str,
        options: list,
        option_bytes: bytes | None,
    ) -> int | None:
        if not option_bytes:
            return None
        if kind == "poll":
            for index, answer in enumerate(options):
                if answer.option == option_bytes:
                    return index + 1
            return None

        todo_id = cls._bytes_to_todo_id(option_bytes)
        if todo_id is None:
            return None
        for index, item in enumerate(options):
            if getattr(item, "id", None) == todo_id:
                return index + 1
        return None

    @staticmethod
    def _text_with_entities_label(value) -> str:
        if value is None:
            return ""
        if hasattr(value, "text"):
            return (value.text or "").strip()
        return str(value).strip()

    @classmethod
    def _votable_question_label(cls, kind: str, source) -> str:
        if kind == "poll":
            return cls._poll_question_label(source)
        return cls._text_with_entities_label(getattr(source, "title", None))

    @classmethod
    def _option_label(cls, kind: str, option) -> str:
        if kind == "poll":
            return cls._poll_answer_label(option)
        return cls._text_with_entities_label(getattr(option, "title", None))

    @staticmethod
    def _poll_question_label(poll) -> str:
        question = getattr(poll, "question", None)
        if question is None:
            return ""
        if hasattr(question, "text"):
            return (question.text or "").strip()
        return str(question).strip()

    @staticmethod
    def _poll_answer_label(answer) -> str:
        text = getattr(answer, "text", None)
        if text is None:
            return ""
        if hasattr(text, "text"):
            return (text.text or "").strip()
        return str(text).strip()
