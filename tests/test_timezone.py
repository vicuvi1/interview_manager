from datetime import datetime
from zoneinfo import ZoneInfo

from conftest import ADMIN_HEADERS

from app.timezone import as_utc, to_local, to_naive_utc


def test_to_naive_utc_converts_offset():
    aware = datetime(2026, 7, 15, 14, 0, tzinfo=ZoneInfo("America/New_York"))
    naive = to_naive_utc(aware)
    assert naive.tzinfo is None
    # 14:00 EDT (UTC-4) -> 18:00 UTC
    assert (naive.hour, naive.minute) == (18, 0)


def test_round_trip_local():
    stored = to_naive_utc(datetime(2026, 7, 15, 18, 0, tzinfo=ZoneInfo("UTC")))
    local = to_local(stored, "America/New_York")
    assert local.hour == 14  # back to EDT
    assert as_utc(stored).hour == 18


def test_schedule_localized_for_candidate(client):
    cand = client.post(
        "/api/candidates",
        json={"name": "Tokyo Dev", "email": "tk@example.com", "timezone": "Asia/Tokyo"},
    ).json()
    iv = client.post(
        "/api/interviews", json={"candidate_id": cand["id"], "role": "SRE"}
    ).json()
    client.post(f"/api/interviews/{iv['id']}/approve", headers=ADMIN_HEADERS)
    sched = client.post(
        f"/api/interviews/{iv['id']}/schedule",
        headers=ADMIN_HEADERS,
        json={"scheduled_start": "2026-07-15T00:00:00+00:00"},
    ).json()
    # 00:00 UTC -> 09:00 the same day in Tokyo (UTC+9).
    assert sched["scheduled_start_local"].startswith("2026-07-15T09:00")
    assert sched["timezone"] == "Asia/Tokyo"
