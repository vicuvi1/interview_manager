from conftest import ADMIN_HEADERS


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_register_normalizes_email(client):
    r = client.post(
        "/api/candidates",
        json={"name": "Grace", "email": "  GRACE@Example.COM ", "timezone": "UTC"},
    )
    assert r.status_code == 201
    assert r.json()["email"] == "grace@example.com"


def test_register_is_idempotent_by_email(client):
    body = {"name": "Ada", "email": "ada@example.com", "timezone": "UTC"}
    first = client.post("/api/candidates", json=body).json()
    second = client.post("/api/candidates", json=body).json()
    assert first["id"] == second["id"]


def test_invalid_timezone_rejected(client):
    r = client.post(
        "/api/candidates",
        json={"name": "X", "email": "x@example.com", "timezone": "Mars/Phobos"},
    )
    assert r.status_code == 422


def test_invalid_email_rejected(client):
    r = client.post(
        "/api/candidates",
        json={"name": "X", "email": "not-an-email", "timezone": "UTC"},
    )
    assert r.status_code == 422


def test_lookup_by_email(client, candidate):
    r = client.get("/api/candidates/by-email", params={"email": "ada@example.com"})
    assert r.status_code == 200
    assert r.json()["id"] == candidate["id"]


def test_list_candidates_requires_admin(client, candidate):
    assert client.get("/api/candidates").status_code == 401
    r = client.get("/api/candidates", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    assert len(r.json()) == 1
