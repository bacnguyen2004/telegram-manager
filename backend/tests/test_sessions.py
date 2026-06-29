def test_list_sessions_empty(client, test_paths):
    response = client.get("/api/sessions")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["total"] == 0
    assert body["data"]["sessions"] == []


def test_list_sessions_with_files(client, test_paths):
    session_dir = test_paths["session_dir"]
    (session_dir / "+84901234567.session").write_bytes(b"fake-session")
    (session_dir / "+84334668651.session").write_bytes(b"fake-session")

    response = client.get("/api/sessions")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["total"] == 2
    assert "+84334668651" in data["sessions"]
    assert "+84901234567" in data["sessions"]


def test_get_session_not_found(client):
    response = client.get("/api/sessions/%2B84909999999")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "not_found"
    assert data["exists"] is False