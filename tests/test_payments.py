from conftest import ADMIN_HEADERS


def _interview(client, candidate):
    return client.post(
        "/api/interviews",
        json={"candidate_id": candidate["id"], "role": "Data Engineer"},
    ).json()


def test_payment_flow(client, candidate):
    iv = _interview(client, candidate)

    created = client.post(
        f"/api/interviews/{iv['id']}/payment",
        headers=ADMIN_HEADERS,
        json={"amount_cents": 15000, "currency": "usd"},
    )
    assert created.status_code == 201
    pay = created.json()
    assert pay["status"] == "pending"
    assert pay["currency"] == "USD"
    assert pay["amount_display"] == "150.00 USD"

    # Candidate pays (no admin key required for the mock pay action).
    paid = client.post(f"/api/payments/{pay['id']}/pay").json()
    assert paid["status"] == "paid"
    assert paid["paid_at"] is not None
    assert paid["provider_ref"] == f"mock_{pay['id']}"

    # Admin sees a "Payment received" notification.
    notes = client.get("/api/admin/notifications", headers=ADMIN_HEADERS).json()
    assert any(n["subject"] == "Payment received" for n in notes)


def test_one_payment_per_interview(client, candidate):
    iv = _interview(client, candidate)
    body = {"amount_cents": 1000}
    assert client.post(f"/api/interviews/{iv['id']}/payment", headers=ADMIN_HEADERS, json=body).status_code == 201
    dup = client.post(f"/api/interviews/{iv['id']}/payment", headers=ADMIN_HEADERS, json=body)
    assert dup.status_code == 409


def test_create_payment_requires_admin(client, candidate):
    iv = _interview(client, candidate)
    r = client.post(f"/api/interviews/{iv['id']}/payment", json={"amount_cents": 1000})
    assert r.status_code == 401


def test_pay_is_idempotent(client, candidate):
    iv = _interview(client, candidate)
    pay = client.post(
        f"/api/interviews/{iv['id']}/payment",
        headers=ADMIN_HEADERS,
        json={"amount_cents": 5000},
    ).json()
    first = client.post(f"/api/payments/{pay['id']}/pay").json()
    second = client.post(f"/api/payments/{pay['id']}/pay").json()
    assert first["status"] == second["status"] == "paid"
    assert first["paid_at"] == second["paid_at"]
