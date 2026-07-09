from app.db.proxy_store import proxy_store
from app.services.telegram.proxy.resolve import telethon_proxy_dict
from app.db.models import Proxy


def test_list_proxies_without_db(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "database_enabled", False)
    payload = proxy_store.list_proxies()
    assert payload["database_enabled"] is False
    assert payload["total"] == 0


def test_proxy_crud_and_assign(client, test_paths):
    create = client.post(
        "/api/proxies",
        json={
            "name": "SG-1",
            "proxy_type": "socks5",
            "host": "127.0.0.1",
            "port": 1080,
            "username": "u1",
            "password": "secret",
        },
    )
    assert create.status_code == 200
    body = create.json()
    assert body["success"] is True
    proxy_id = body["data"]["id"]
    assert body["data"]["password_set"] is True
    assert "password" not in body["data"] or body["data"].get("password") is None

    listed = client.get("/api/proxies")
    assert listed.status_code == 200
    assert listed.json()["data"]["total"] >= 1

    assign = client.put(
        f"/api/proxies/assignments/%2B84901234567",
        json={"proxy_id": proxy_id},
    )
    assert assign.status_code == 200
    assert assign.json()["data"]["proxy_id"] == proxy_id

    assignments = client.get("/api/proxies/assignments")
    assert assignments.status_code == 200
    phones = {item["phone"] for item in assignments.json()["data"]["assignments"]}
    assert "+84901234567" in phones

    check = client.post(f"/api/proxies/{proxy_id}/check")
    assert check.status_code == 200
    assert check.json()["data"]["status"] in {"ok", "fail"}

    unassign = client.put(
        f"/api/proxies/assignments/%2B84901234567",
        json={"proxy_id": None},
    )
    assert unassign.status_code == 200
    assert unassign.json()["data"]["proxy_id"] is None

    deleted = client.delete(f"/api/proxies/{proxy_id}")
    assert deleted.status_code == 200


def test_telethon_proxy_dict_socks5():
    row = Proxy(
        id=1,
        name="t",
        proxy_type="socks5",
        host="10.0.0.1",
        port=1080,
        username="u",
        password="p",
        enabled=True,
    )
    proxy = telethon_proxy_dict(row)
    assert proxy is not None
    assert proxy["proxy_type"] == "socks5"
    assert proxy["addr"] == "10.0.0.1"
    assert proxy["port"] == 1080
    assert proxy["username"] == "u"
    assert proxy["password"] == "p"


def test_create_proxy_invalid_type(client, test_paths):
    res = client.post(
        "/api/proxies",
        json={
            "name": "bad",
            "proxy_type": "ftp",
            "host": "1.1.1.1",
            "port": 1080,
        },
    )
    assert res.status_code == 400
