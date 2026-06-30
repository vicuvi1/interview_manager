import pytest

from app import service
from app.service import ServiceError


def _candidate(email="ada@example.com", tz="America/New_York"):
    return service.register_candidate("Ada Lovelace", email, tz)


# ----- candidates -----
def test_register_is_idempotent_and_updates():
    a = _candidate()
    b = service.register_candidate("Ada L.", "ada@example.com", "UTC")
    assert a["id"] == b["id"]
    assert b["timezone"] == "UTC"  # details updated on re-sign-in


def test_invalid_email_rejected():
    with pytest.raises(ServiceError):
        service.register_candidate("X", "not-an-email", "UTC")


def test_invalid_timezone_rejected():
    with pytest.raises(ServiceError):
        service.register_candidate("X", "x@example.com", "Mars/Phobos")


# ----- lifecycle -----
def test_request_creates_admin_notification():
    c = _candidate()
    iv = service.request_interview(c["id"], "Backend Engineer", duration_minutes=45)
    assert iv["status"] == "requested"
    assert any("requested an interview" in n["body"] for n in service.admin_notifications())


def test_full_happy_path():
    c = _candidate()
    iid = service.request_interview(c["id"], "Backend Engineer")["id"]

    assert service.approve(iid)["status"] == "approved"

    sched = service.schedule(iid, "2026-07-15 14:00", meeting_link="https://meet/x")
    assert sched["status"] == "scheduled"
    assert sched["scheduled_start_utc"].startswith("2026-07-15T18:00")  # 14:00 EDT -> 18:00Z
    assert sched["scheduled_start_local"].startswith("2026-07-15T14:00")

    assert service.start_call(iid)["status"] == "in_progress"

    done = service.complete(iid, outcome="Strong hire", rating=5)
    assert done["status"] == "completed"
    assert done["rating"] == 5

    subjects = {n["subject"] for n in service.candidate_notifications(c["id"])}
    assert {"Interview approved", "Interview scheduled", "Interview completed"} <= subjects


def test_invalid_transition_blocked():
    c = _candidate()
    iid = service.request_interview(c["id"], "X")["id"]
    with pytest.raises(ServiceError):
        service.start_call(iid)  # can't start straight from "requested"


def test_reject_with_reason():
    c = _candidate()
    iid = service.request_interview(c["id"], "X")["id"]
    assert service.reject(iid, "Position filled")["status"] == "rejected"
    assert any(
        "Position filled" in n["body"] for n in service.candidate_notifications(c["id"])
    )


def test_bad_schedule_time_message():
    c = _candidate()
    iid = service.request_interview(c["id"], "X")["id"]
    service.approve(iid)
    with pytest.raises(ServiceError):
        service.schedule(iid, "not a time")


# ----- payments -----
def test_payment_flow():
    c = _candidate()
    iid = service.request_interview(c["id"], "X")["id"]
    pay = service.create_payment(iid, 15000, "usd")
    assert pay["status"] == "pending"
    assert pay["currency"] == "USD"
    assert pay["amount_display"] == "150.00 USD"

    paid = service.pay(pay["id"])
    assert paid["status"] == "paid"
    assert paid["paid_at"] is not None
    assert paid["provider_ref"] == f"mock_{pay['id']}"

    # idempotent
    assert service.pay(pay["id"])["paid_at"] == paid["paid_at"]
    # one payment per interview
    with pytest.raises(ServiceError):
        service.create_payment(iid, 100)
    assert any(n["subject"] == "Payment received" for n in service.admin_notifications())


def test_refund_blocks_payment():
    c = _candidate()
    iid = service.request_interview(c["id"], "X")["id"]
    pay = service.create_payment(iid, 100)
    assert service.refund(pay["id"])["status"] == "refunded"
    with pytest.raises(ServiceError):
        service.pay(pay["id"])


# ----- admin auth + filtering -----
def test_admin_password():
    assert service.verify_admin("test-pass") is True
    assert service.verify_admin("wrong") is False


def test_list_interviews_filter_by_status():
    c = _candidate()
    a = service.request_interview(c["id"], "A")["id"]
    service.request_interview(c["id"], "B")
    service.approve(a)
    assert len(service.list_interviews()) == 2
    assert len(service.list_interviews("approved")) == 1
    assert len(service.list_interviews("requested")) == 1


# ----- timezone localization through the service -----
def test_schedule_localized_for_tokyo_candidate():
    c = service.register_candidate("Tok", "tk@example.com", "Asia/Tokyo")
    iid = service.request_interview(c["id"], "SRE")["id"]
    service.approve(iid)
    sched = service.schedule(iid, "2026-07-15 09:00")  # 09:00 Tokyo
    assert sched["scheduled_start_utc"].startswith("2026-07-15T00:00")  # -> 00:00Z
    assert sched["timezone"] == "Asia/Tokyo"
