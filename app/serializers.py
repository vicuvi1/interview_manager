"""Plain-dict serializers.

Interview output includes both the canonical UTC time and the same instant
rendered in the candidate's own timezone, so clients never have to guess.
"""

from .models import Candidate, Interview, Notification, Payment
from .timezone import as_utc, isoformat, to_local


def serialize_candidate(c: Candidate) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "email": c.email,
        "timezone": c.timezone,
        "phone": c.phone,
        "notes": c.notes,
        "created_at": isoformat(as_utc(c.created_at)),
    }


def serialize_payment(p: Payment | None) -> dict | None:
    if p is None:
        return None
    return {
        "id": p.id,
        "interview_id": p.interview_id,
        "amount_cents": p.amount_cents,
        "amount_display": f"{p.amount_cents / 100:.2f} {p.currency}",
        "currency": p.currency,
        "status": p.status.value,
        "provider_ref": p.provider_ref,
        "created_at": isoformat(as_utc(p.created_at)),
        "paid_at": isoformat(as_utc(p.paid_at)),
    }


def serialize_interview(i: Interview) -> dict:
    tz = i.candidate.timezone if i.candidate else "UTC"
    return {
        "id": i.id,
        "candidate": serialize_candidate(i.candidate) if i.candidate else None,
        "role": i.role,
        "status": i.status.value,
        "preferred_start_utc": isoformat(as_utc(i.preferred_start)),
        "preferred_start_local": isoformat(to_local(i.preferred_start, tz)),
        "scheduled_start_utc": isoformat(as_utc(i.scheduled_start)),
        "scheduled_start_local": isoformat(to_local(i.scheduled_start, tz)),
        "timezone": tz,
        "duration_minutes": i.duration_minutes,
        "meeting_link": i.meeting_link,
        "notes": i.notes,
        "admin_notes": i.admin_notes,
        "outcome": i.outcome,
        "rating": i.rating,
        "payment": serialize_payment(i.payment),
        "created_at": isoformat(as_utc(i.created_at)),
        "updated_at": isoformat(as_utc(i.updated_at)),
    }


def serialize_notification(n: Notification) -> dict:
    return {
        "id": n.id,
        "candidate_id": n.candidate_id,
        "audience": n.audience,
        "subject": n.subject,
        "body": n.body,
        "read": n.read,
        "created_at": isoformat(as_utc(n.created_at)),
    }
