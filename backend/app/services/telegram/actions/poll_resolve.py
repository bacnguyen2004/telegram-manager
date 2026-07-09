import base64


class PollResolveMixin:
    @staticmethod
    def _decode_poll_option_param(value: str) -> bytes | None:
        token = (value or "").strip()
        if not token:
            return None
        padded = token + "=" * (-len(token) % 4)
        for decoder in (base64.urlsafe_b64decode, base64.b64decode):
            try:
                return decoder(padded)
            except Exception:
                continue
        return None

    @staticmethod
    def _normalize_vote_tokens(option_raw: str, options_list: list[str] | None) -> list[str]:
        if options_list:
            return [token.strip() for token in options_list if token.strip()]
        option_raw = (option_raw or "").strip()
        if not option_raw:
            return []
        if "," in option_raw:
            return [part.strip() for part in option_raw.split(",") if part.strip()]
        return [option_raw]

    @classmethod
    def _resolve_votable_token(
        cls,
        kind: str,
        options: list,
        token: str,
    ) -> tuple[str, bytes | int, str] | None:
        token = (token or "").strip()
        if not token:
            return None

        if kind == "poll":
            hex_bytes = cls._decode_option_hex(token)
            if hex_bytes is not None:
                resolved = cls._resolve_poll_option_bytes(options, hex_bytes)
                if resolved is not None:
                    vote_bytes, label = resolved
                    return "poll", vote_bytes, label

            resolved = cls._resolve_poll_option(options, token)
            if resolved is not None:
                vote_bytes, label = resolved
                return "poll", vote_bytes, label
            return None

        if token.isdigit():
            numeric = int(token)
            for item in options:
                if getattr(item, "id", None) == numeric:
                    label = cls._option_label("todo", item) or str(numeric)
                    return "todo", numeric, label
            index = numeric - 1
            if 0 <= index < len(options):
                item = options[index]
                label = cls._option_label("todo", item) or str(index + 1)
                return "todo", item.id, label

        target = token.casefold()
        for item in options:
            label = cls._option_label("todo", item)
            if label.casefold() == target:
                return "todo", item.id, label

        for item in options:
            label = cls._option_label("todo", item)
            if target in label.casefold():
                return "todo", item.id, label

        return None

    @staticmethod
    def _decode_option_hex(value: str) -> bytes | None:
        token = (value or "").strip()
        if not token or len(token) % 2 != 0:
            return None
        if not all(char in "0123456789abcdefABCDEF" for char in token):
            return None
        try:
            return bytes.fromhex(token)
        except ValueError:
            return None

    @staticmethod
    def _bytes_to_todo_id(option_bytes: bytes) -> int | None:
        if not option_bytes:
            return None
        if len(option_bytes) == 1:
            return option_bytes[0]
        try:
            return int(option_bytes.decode("ascii"))
        except (ValueError, UnicodeDecodeError):
            return None

    @classmethod
    def _resolve_poll_option_bytes(
        cls,
        answers: list,
        option_bytes: bytes,
    ) -> tuple[bytes, str] | None:
        for answer in answers:
            if answer.option == option_bytes:
                label = cls._poll_answer_label(answer) or ""
                return answer.option, label or "option"
        return None

    @classmethod
    def _resolve_todo_option_bytes(
        cls,
        items: list,
        option_bytes: bytes,
    ) -> tuple[int, str] | None:
        todo_id = cls._bytes_to_todo_id(option_bytes)
        if todo_id is None:
            return None
        for item in items:
            if getattr(item, "id", None) == todo_id:
                label = cls._option_label("todo", item) or str(todo_id)
                return item.id, label
        return None

    @classmethod
    def _resolve_votable_option_bytes(
        cls,
        kind: str,
        options: list,
        option_bytes: bytes,
    ) -> tuple[str, bytes | None, int | None, str] | None:
        if kind == "poll":
            resolved = cls._resolve_poll_option_bytes(options, option_bytes)
            if resolved is None:
                return None
            vote_bytes, label = resolved
            return "poll", vote_bytes, None, label

        resolved = cls._resolve_todo_option_bytes(options, option_bytes)
        if resolved is None:
            return None
        item_id, label = resolved
        return "todo", None, item_id, label

    @classmethod
    def _resolve_votable_option(
        cls,
        kind: str,
        options: list,
        option_raw: str,
    ) -> tuple[str, bytes | None, int | None, str] | None:
        if kind == "poll":
            resolved = cls._resolve_poll_option(options, option_raw)
            if resolved is None:
                return None
            vote_bytes, label = resolved
            return "poll", vote_bytes, None, label

        option_raw = option_raw.strip()
        if not option_raw:
            return None

        if option_raw.isdigit():
            index = int(option_raw) - 1
            if 0 <= index < len(options):
                item = options[index]
                label = cls._option_label("todo", item) or str(index + 1)
                return "todo", None, item.id, label
            return None

        target = option_raw.casefold()
        for item in options:
            label = cls._option_label("todo", item)
            if label.casefold() == target:
                return "todo", None, item.id, label

        for item in options:
            label = cls._option_label("todo", item)
            if target in label.casefold():
                return "todo", None, item.id, label

        return None

    @classmethod
    def _resolve_poll_option(
        cls,
        answers: list,
        option_raw: str,
    ) -> tuple[bytes, str] | None:
        option_raw = option_raw.strip()
        if not option_raw:
            return None

        hex_bytes = cls._decode_option_hex(option_raw)
        if hex_bytes is not None:
            resolved = cls._resolve_poll_option_bytes(answers, hex_bytes)
            if resolved is not None:
                return resolved

        if option_raw.isdigit():
            index = int(option_raw) - 1
            if 0 <= index < len(answers):
                answer = answers[index]
                return answer.option, cls._poll_answer_label(answer) or str(index + 1)
            return None

        target = option_raw.casefold()
        for answer in answers:
            label = cls._poll_answer_label(answer)
            if label.casefold() == target:
                return answer.option, label

        for answer in answers:
            label = cls._poll_answer_label(answer)
            if target in label.casefold():
                return answer.option, label

        return None
