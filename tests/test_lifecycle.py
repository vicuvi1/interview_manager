from conftest import ADMIN_HEADERS


def _request_interview(client, candidate, role="Backend Engineer"):
    r = client.post(
        "/api/interviews",
        json={"candidate_id": candidate["id"], "role": role, "duration_minutes": 45},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_request_creates_admin_notification(client, candidate):
    iv = _request_interview(client, candidate)
    assert iv["status"] == "requested"
    notes = client.get("/api/admin/notifications", headers=ADMIN_HEADERS).json()
    assert any("requested an interview" in n["body"] for n in notes)


def test_full_happy_path(client, candidate):
    iv = _request_interview(client, candidate)
    iid = iv["id"]

    assert client.post(f"/api/interviews/{iid}/approve", headers=ADMIN_HEADERS).json()["status"] == "approved"

    sched = client.post(
        f"/api/interviews/{iid}/schedule",
        headers=ADMIN_HEADERS,
        json={"scheduled_start": "2026-07-15T18:00:00+00:00", "meeting_link": "https://meet.example/x"},
    ).json()
    assert sched["status"] == "scheduled"
    assert sched["scheduled_start_utc"].startswith("2026-07-15T18:00")

    assert client.post(f"/api/interviews/{iid}/start", headers=ADMIN_HEADERS).json()["status"] == "in_progress"

    done = client.post(
        f"/api/interviews/{iid}/complete",
        headers=ADMIN_HEADERS,
        json={"outcome": "Strong hire", "rating": 5},
    ).json()
    assert done["status"] == "completed"
    assert done["rating"] == 5

    # Candidate received scheduled + completed notifications.
    feed = client.get(f"/api/candidates/{candidate['id']}/notifications").json()
    subjects = {n["subject"] for n in feed}
    assert "Interview scheduled" in subjects
    assert "Interview completed" in subjects


def test_invalid_transition_blocked(client, candidate):
    iv = _request_interview(client, candidate)
    iid = iv["id"]
    # Cannot start an interview straight from "requested".
    r = client.post(f"/api/interviews/{iid}/start", headers=ADMIN_HEADERS)
    assert r.status_code == 409
    assert "Cannot move" in r.json()["detail"]


def test_reject_path(client, candidate):
    iv = _request_interview(client, candidate)
    r = client.post(
        f"/api/interviews/{iv['id']}/reject",
        headers=ADMIN_HEADERS,
        json={"reason": "Position filled"},
    )
    assert r.json()["status"] == "rejected"
    feed = client.get(f"/api/candidates/{candidate['id']}/notifications").json()
    assert any("Position filled" in n["body"] for n in feed)


def test_admin_actions_require_key(client, candidate):
    iv = _request_interview(client, candidate)
    assert client.post(f"/api/interviews/{iv['id']}/approve").status_code == 401


def test_list_by_candidate_is_public(client, candidate):
    _request_interview(client, candidate, role="Role A")
    _request_interview(client, candidate, role="Role B")
    rows = client.get(f"/api/interviews/by-candidate/{candidate['id']}").json()
    assert len(rows) == 2
