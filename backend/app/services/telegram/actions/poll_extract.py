from telethon.tl.types import MessageMediaPoll, MessageMediaToDo, MessageMediaWebPage


class PollExtractMixin:
    @staticmethod
    def _poll_object_from_message(message):
        if not message:
            return None

        media = getattr(message, "media", None)
        if isinstance(media, MessageMediaPoll):
            return media.poll

        media_poll = getattr(media, "poll", None)
        if media_poll is not None:
            return media_poll

        message_poll = getattr(message, "poll", None)
        if isinstance(message_poll, MessageMediaPoll):
            return message_poll.poll

        nested_poll = getattr(message_poll, "poll", None)
        if nested_poll is not None:
            return nested_poll

        return message_poll

    @staticmethod
    def _todo_from_message(message):
        media = getattr(message, "media", None)
        if isinstance(media, MessageMediaToDo):
            return media.todo
        return None

    @classmethod
    def _extract_votable(cls, message) -> tuple | None:
        if not message:
            return None

        poll_message_id = getattr(message, "id", None)
        if not poll_message_id:
            return None

        todo = cls._todo_from_message(message)
        if todo is not None:
            items = list(getattr(todo, "list", None) or [])
            if items:
                return "todo", todo, items, poll_message_id

        poll = cls._poll_object_from_message(message)
        if poll is not None:
            answers = list(getattr(poll, "answers", None) or [])
            if answers:
                return "poll", poll, answers, poll_message_id

        return None

    @classmethod
    def _extract_poll(cls, message) -> tuple | None:
        extracted = cls._extract_votable(message)
        if not extracted or extracted[0] != "poll":
            return None
        _kind, poll, answers, poll_message_id = extracted
        return poll, answers, poll_message_id

    @classmethod
    def _poll_result(cls, message) -> tuple | None:
        extracted = cls._extract_votable(message)
        if not extracted:
            return None
        kind, source, options, poll_message_id = extracted
        return kind, source, options, poll_message_id, message

    @staticmethod
    async def _user_todo_completion_ids(client, message) -> list[int]:
        media = getattr(message, "media", None)
        if not isinstance(media, MessageMediaToDo):
            return []

        me = await client.get_me()
        my_id = getattr(me, "id", None)
        if my_id is None:
            return []

        item_ids: list[int] = []
        for completion in getattr(media, "completions", None) or []:
            completed_by = getattr(completion, "completed_by", None)
            user_id = getattr(completed_by, "user_id", None)
            if user_id == my_id:
                item_ids.append(completion.id)
        return item_ids
