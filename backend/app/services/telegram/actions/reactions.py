from telethon.tl.functions.messages import SendReactionRequest
from telethon.tl.types import ReactionEmoji, ReactionEmpty

from ...common.errors import MISSING_PEER_MESSAGE, MISSING_PHONE_MESSAGE
from ...common.validation import normalize_phone
from ..client import run_with_authorized_client
from ..reactions import (
    fetch_peer_reactions_policy,
    format_reaction_error,
    is_emoji_allowed,
    reaction_not_allowed_message,
)
from .base import MessageActionBase


class ReactionActionService(MessageActionBase):
    async def send_reaction(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
        emoji: str,
    ) -> dict:
        emoji = (emoji or "").strip()
        if not emoji:
            return self._react_error(phone, peer_id, "Thieu emoji", message_id=message_id)

        phone = normalize_phone(phone)
        peer_ref = str(peer_id or "").strip()
        if not phone:
            return self._react_error(phone, peer_ref, MISSING_PHONE_MESSAGE, message_id=message_id)
        if not peer_ref:
            return self._react_error(phone, peer_ref, MISSING_PEER_MESSAGE, message_id=message_id)
        if message_id < 1:
            return self._react_error(
                phone, peer_ref, "message_id khong hop le", message_id=message_id
            )

        async def operation(client):
            entity = await self._resolve_peer(client, peer_ref)
            message = await client.get_messages(entity, ids=message_id)
            if not message:
                return self._react_error(
                    phone,
                    peer_ref,
                    "Khong tim thay tin nhan",
                    message_id=message_id,
                )

            current = self._user_chosen_emoji(message)
            reactions_policy = await fetch_peer_reactions_policy(client, entity)

            if current == emoji:
                await client(
                    SendReactionRequest(
                        peer=entity,
                        msg_id=message_id,
                        reaction=[ReactionEmpty()],
                    )
                )
                return {
                    "status": "success",
                    "phone": phone,
                    "peer_id": peer_ref,
                    "message_id": message_id,
                    "reply_to_msg_id": None,
                    "emoji": None,
                    "message": "Da bo reaction",
                }

            if not is_emoji_allowed(reactions_policy, emoji):
                return self._react_error(
                    phone,
                    peer_ref,
                    reaction_not_allowed_message(reactions_policy, emoji),
                    message_id=message_id,
                )

            if current:
                await client(
                    SendReactionRequest(
                        peer=entity,
                        msg_id=message_id,
                        reaction=[ReactionEmpty()],
                    )
                )

            await client(
                SendReactionRequest(
                    peer=entity,
                    msg_id=message_id,
                    reaction=[ReactionEmoji(emoticon=emoji)],
                    add_to_recent=True,
                )
            )

            success_message = "Da doi reaction" if current else "Da them reaction"
            return {
                "status": "success",
                "phone": phone,
                "peer_id": peer_ref,
                "message_id": message_id,
                "reply_to_msg_id": None,
                "emoji": emoji,
                "message": success_message,
            }

        return await run_with_authorized_client(
            phone,
            api_id=self.api_id,
            api_hash=self.api_hash,
            session_dir=self.session_dir,
            on_error=lambda msg: self._react_error(
                phone, peer_ref, msg, message_id=message_id
            ),
            operation=operation,
            map_exception=format_reaction_error,
        )

    async def remove_reaction(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
    ) -> dict:
        return await self._react(
            phone,
            peer_id,
            message_id,
            reaction=[ReactionEmpty()],
            emoji=None,
            success_message="Da xoa reaction",
        )

    async def _react(
        self,
        phone: str,
        peer_id: str,
        message_id: int,
        *,
        reaction: list,
        emoji: str | None,
        success_message: str,
    ) -> dict:
        phone = normalize_phone(phone)
        peer_ref = str(peer_id or "").strip()

        if not phone:
            return self._react_error(phone, peer_ref, MISSING_PHONE_MESSAGE, message_id=message_id)
        if not peer_ref:
            return self._react_error(phone, peer_ref, MISSING_PEER_MESSAGE, message_id=message_id)
        if message_id < 1:
            return self._react_error(
                phone, peer_ref, "message_id khong hop le", message_id=message_id
            )

        async def operation(client):
            entity = await self._resolve_peer(client, peer_ref)
            await client(
                SendReactionRequest(
                    peer=entity,
                    msg_id=message_id,
                    reaction=reaction,
                    add_to_recent=True,
                )
            )
            return {
                "status": "success",
                "phone": phone,
                "peer_id": peer_ref,
                "message_id": message_id,
                "reply_to_msg_id": None,
                "emoji": emoji,
                "message": success_message,
            }

        return await run_with_authorized_client(
            phone,
            api_id=self.api_id,
            api_hash=self.api_hash,
            session_dir=self.session_dir,
            on_error=lambda msg: self._react_error(
                phone, peer_ref, msg, message_id=message_id
            ),
            operation=operation,
            map_exception=format_reaction_error,
        )

    @staticmethod
    def _user_chosen_emoji(message) -> str | None:
        reactions_obj = getattr(message, "reactions", None)
        if not reactions_obj:
            return None
        for item in getattr(reactions_obj, "results", None) or []:
            if getattr(item, "chosen_order", None) is None:
                continue
            reaction = getattr(item, "reaction", None)
            if reaction is not None and hasattr(reaction, "emoticon"):
                return reaction.emoticon or None
        return None
