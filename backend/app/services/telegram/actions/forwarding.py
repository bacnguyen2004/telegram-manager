from ...common.errors import MISSING_PHONE_MESSAGE
from ...common.validation import normalize_phone
from ..client import run_with_authorized_client
from .base import MessageActionBase


class ForwardingService(MessageActionBase):
    async def forward_messages(
        self,
        phone: str,
        from_peer_id: str,
        to_peer_id: str,
        message_ids: list[int],
    ) -> dict:
        phone = normalize_phone(phone)
        from_ref = str(from_peer_id or "").strip()
        to_ref = str(to_peer_id or "").strip()
        ids = sorted({int(item) for item in message_ids if int(item) > 0})

        if not phone:
            return self._bulk_forward_error(phone, from_ref, to_ref, MISSING_PHONE_MESSAGE, ids)
        if not from_ref:
            return self._bulk_forward_error(phone, from_ref, to_ref, "Thieu from_peer_id", ids)
        if not to_ref:
            return self._bulk_forward_error(phone, from_ref, to_ref, "Thieu to_peer_id", ids)
        if not ids:
            return self._bulk_forward_error(phone, from_ref, to_ref, "Thieu message_ids", ids)
        if len(ids) > 50:
            return self._bulk_forward_error(phone, from_ref, to_ref, "Toi da 50 tin moi lan", ids)

        async def operation(client):
            from_entity = await self._resolve_peer(client, from_ref)
            to_entity = await self._resolve_peer(client, to_ref)
            source_messages = await client.get_messages(from_entity, ids=ids)
            if not isinstance(source_messages, list):
                source_messages = [source_messages]
            source_messages = [
                item for item in source_messages if item and getattr(item, "id", None)
            ]
            if not source_messages:
                return self._bulk_forward_error(
                    phone, from_ref, to_ref, "Khong tim thay tin nhan", ids
                )

            forwarded = await client.forward_messages(
                to_entity,
                source_messages,
                from_peer=from_entity,
            )
            forwarded_ids = [
                int(getattr(item, "id", 0) or 0)
                for item in (forwarded if isinstance(forwarded, list) else [forwarded])
                if getattr(item, "id", None)
            ]
            return {
                "status": "success",
                "phone": phone,
                "peer_id": to_ref,
                "from_peer_id": from_ref,
                "to_peer_id": to_ref,
                "message_id": forwarded_ids[-1] if forwarded_ids else None,
                "reply_to_msg_id": None,
                "forwarded_count": len(forwarded_ids),
                "message_ids": forwarded_ids,
                "message": f"Da forward {len(forwarded_ids)} tin nhan",
            }

        return await run_with_authorized_client(
            phone,
            api_id=self.api_id,
            api_hash=self.api_hash,
            session_dir=self.session_dir,
            on_error=lambda msg: self._bulk_forward_error(phone, from_ref, to_ref, msg, ids),
            operation=operation,
        )

    async def forward_message(
        self,
        phone: str,
        from_peer_id: str,
        to_peer_id: str,
        message_id: int,
    ) -> dict:
        phone = normalize_phone(phone)
        from_ref = str(from_peer_id or "").strip()
        to_ref = str(to_peer_id or "").strip()

        if not phone:
            return self._forward_error(phone, from_ref, to_ref, MISSING_PHONE_MESSAGE, message_id)
        if not from_ref:
            return self._forward_error(phone, from_ref, to_ref, "Thieu from_peer_id", message_id)
        if not to_ref:
            return self._forward_error(phone, from_ref, to_ref, "Thieu to_peer_id", message_id)
        if message_id < 1:
            return self._forward_error(
                phone, from_ref, to_ref, "message_id khong hop le", message_id
            )

        async def operation(client):
            from_entity = await self._resolve_peer(client, from_ref)
            to_entity = await self._resolve_peer(client, to_ref)
            message = await client.get_messages(from_entity, ids=message_id)
            if not message:
                return self._forward_error(
                    phone, from_ref, to_ref, "Khong tim thay tin nhan", message_id
                )

            forwarded = await client.forward_messages(
                to_entity,
                message,
                from_peer=from_entity,
            )
            forwarded_id = getattr(forwarded[0], "id", None) if forwarded else None
            return {
                "status": "success",
                "phone": phone,
                "peer_id": to_ref,
                "from_peer_id": from_ref,
                "to_peer_id": to_ref,
                "message_id": forwarded_id,
                "reply_to_msg_id": None,
                "message": "Da forward tin nhan",
            }

        return await run_with_authorized_client(
            phone,
            api_id=self.api_id,
            api_hash=self.api_hash,
            session_dir=self.session_dir,
            on_error=lambda msg: self._forward_error(phone, from_ref, to_ref, msg, message_id),
            operation=operation,
        )
