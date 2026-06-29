def test_health_returns_envelope(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["error"] is None

    data = body["data"]
    assert data["app"] == "Telegram Manager API"
    assert data["status"] in {"ok", "degraded"}
    assert data["telegram_configured"] is True
    assert data["session_dir_exists"] is True
    assert data["session_dir_writable"] is True
    assert isinstance(data["session_count"], int)