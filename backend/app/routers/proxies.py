from fastapi import APIRouter, HTTPException, Query

from ..db import metadata_store
from ..db.proxy_store import PROXY_TYPES, proxy_store
from ..schemas.common import ApiEnvelope
from ..schemas.proxy import (
    ProxyAssignRequest,
    ProxyAssignmentItem,
    ProxyAssignmentsData,
    ProxyBulkAssignRequest,
    ProxyCheckData,
    ProxyCreateRequest,
    ProxyItem,
    ProxyListData,
    ProxyUpdateRequest,
)
from ..services.telegram.proxy import check_proxy_tcp
from ..utils.responses import success_response

router = APIRouter(prefix="/proxies", tags=["proxies"])


def _require_database() -> None:
    if not proxy_store.database_enabled:
        raise HTTPException(
            status_code=503,
            detail="Database chua bat — cau hinh DATABASE_URL trong backend/.env",
        )


def _validate_type(proxy_type: str) -> str:
    value = proxy_type.strip().lower()
    if value not in PROXY_TYPES:
        raise HTTPException(
            status_code=400,
            detail="proxy_type khong hop le. Dung: socks5 | http | mtproto",
        )
    return value


async def _drop_pool_clients(phones: list[str]) -> None:
    if not phones:
        return
    try:
        from ..services.telegram.client.pool import telethon_client_pool

        for phone in phones:
            await telethon_client_pool.drop_client(phone)
    except Exception:
        pass


@router.get("", response_model=ApiEnvelope[ProxyListData])
async def list_proxies() -> dict:
    payload = proxy_store.list_proxies()
    data = ProxyListData(
        database_enabled=bool(payload.get("database_enabled")),
        total=int(payload.get("total") or 0),
        proxies=[ProxyItem(**item) for item in payload.get("proxies", [])],
    )
    return success_response(data.model_dump())


@router.post("", response_model=ApiEnvelope[ProxyItem])
async def create_proxy(payload: ProxyCreateRequest) -> dict:
    _require_database()
    proxy_type = _validate_type(payload.proxy_type)
    if not payload.name.strip() or not payload.host.strip():
        raise HTTPException(status_code=400, detail="Thieu name hoac host")

    created = proxy_store.create_proxy(
        {
            "name": payload.name,
            "proxy_type": proxy_type,
            "host": payload.host,
            "port": payload.port,
            "username": payload.username,
            "password": payload.password,
            "secret": payload.secret,
            "enabled": payload.enabled,
        }
    )
    if created is None:
        raise HTTPException(status_code=500, detail="Khong tao duoc proxy")

    metadata_store.record_audit(
        phone="system",
        action="proxy.create",
        resource=str(created.get("id")),
        status="success",
        detail=f"{created.get('proxy_type')} {created.get('host')}:{created.get('port')}",
    )
    return success_response(ProxyItem(**created).model_dump())


@router.get("/assignments", response_model=ApiEnvelope[ProxyAssignmentsData])
async def list_assignments() -> dict:
    payload = proxy_store.list_assignments()
    data = ProxyAssignmentsData(
        database_enabled=bool(payload.get("database_enabled")),
        assignments=[ProxyAssignmentItem(**item) for item in payload.get("assignments", [])],
    )
    return success_response(data.model_dump())


@router.put("/assignments/{phone}", response_model=ApiEnvelope[dict])
async def assign_proxy(phone: str, payload: ProxyAssignRequest) -> dict:
    _require_database()
    phone = phone.strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Thieu phone")

    result = proxy_store.assign_phone(phone, payload.proxy_id)
    if result is None:
        raise HTTPException(status_code=500, detail="Khong gan duoc proxy")
    if result.get("status") == "error":
        raise HTTPException(status_code=404, detail=result.get("message") or "Loi")

    await _drop_pool_clients([phone])
    metadata_store.record_audit(
        phone=phone,
        action="proxy.assign",
        resource=str(payload.proxy_id) if payload.proxy_id is not None else "none",
        status="success",
        detail=None,
    )
    return success_response(result)


@router.post("/assignments/bulk", response_model=ApiEnvelope[dict])
async def assign_proxy_bulk(payload: ProxyBulkAssignRequest) -> dict:
    _require_database()
    mode = (payload.mode or "same").strip().lower()
    result = proxy_store.assign_bulk(
        payload.phones,
        payload.proxy_id,
        mode=mode,
        proxy_ids=payload.proxy_ids,
    )
    if result is None:
        raise HTTPException(status_code=500, detail="Khong gan duoc proxy")
    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("message") or "Loi")

    phones = result.get("phones") or []
    await _drop_pool_clients(list(phones))
    resource = "round_robin" if mode == "round_robin" else (
        str(payload.proxy_id) if payload.proxy_id is not None else "none"
    )
    metadata_store.record_audit(
        phone="system",
        action="proxy.assign_bulk",
        resource=resource,
        status="success",
        detail=f"mode={mode} updated={result.get('updated')}",
    )
    return success_response(result)


@router.get("/{proxy_id}", response_model=ApiEnvelope[ProxyItem])
async def get_proxy(
    proxy_id: int,
    reveal: bool = Query(default=False),
) -> dict:
    _require_database()
    item = proxy_store.get_proxy(proxy_id, reveal_secret=reveal)
    if item is None:
        raise HTTPException(status_code=404, detail="Khong tim thay proxy")
    return success_response(ProxyItem(**item).model_dump())


@router.patch("/{proxy_id}", response_model=ApiEnvelope[ProxyItem])
async def update_proxy(proxy_id: int, payload: ProxyUpdateRequest) -> dict:
    _require_database()
    body = payload.model_dump(exclude_unset=True)
    if "proxy_type" in body and body["proxy_type"] is not None:
        body["proxy_type"] = _validate_type(str(body["proxy_type"]))

    updated = proxy_store.update_proxy(proxy_id, body)
    if updated is None:
        raise HTTPException(status_code=404, detail="Khong tim thay proxy")

    phones = proxy_store.phones_using_proxy(proxy_id)
    await _drop_pool_clients(phones)
    metadata_store.record_audit(
        phone="system",
        action="proxy.update",
        resource=str(proxy_id),
        status="success",
        detail=None,
    )
    return success_response(ProxyItem(**updated).model_dump())


@router.delete("/{proxy_id}", response_model=ApiEnvelope[dict])
async def delete_proxy(proxy_id: int) -> dict:
    _require_database()
    phones = proxy_store.phones_using_proxy(proxy_id)
    deleted = proxy_store.delete_proxy(proxy_id)
    if deleted is None:
        raise HTTPException(status_code=404, detail="Khong tim thay proxy")

    await _drop_pool_clients(phones)
    metadata_store.record_audit(
        phone="system",
        action="proxy.delete",
        resource=str(proxy_id),
        status="success",
        detail=f"cleared={len(deleted.get('cleared_phones') or [])}",
    )
    return success_response(deleted)


@router.post("/{proxy_id}/check", response_model=ApiEnvelope[ProxyCheckData])
async def check_proxy(proxy_id: int) -> dict:
    _require_database()
    item = proxy_store.get_proxy(proxy_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Khong tim thay proxy")

    status, message = await check_proxy_tcp(item["host"], item["port"])
    updated = proxy_store.set_check_result(proxy_id, status=status, message=message)
    metadata_store.record_audit(
        phone="system",
        action="proxy.check",
        resource=str(proxy_id),
        status=status,
        detail=message,
    )
    data = ProxyCheckData(
        id=proxy_id,
        status=status,
        message=message,
        last_check_at=(updated or {}).get("last_check_at"),
    )
    return success_response(data.model_dump())
