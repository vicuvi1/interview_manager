"""Business operations, callable directly from the GUI (no HTTP layer).

Every function opens its own short transaction via `session_scope()` and returns
plain dicts (built by `serializers`), so the UI never holds live ORM objects.
Validation / illegal-operation problems are raised as `ServiceError`, whose
message is safe to show to the user.
"""

import re

from sqlalchemy import select

from .config import get_settings
from .database import session_scope
from .lifecycle import InvalidTransition, ensure_transition
from .models import Candidate, Interview, InterviewStatus, Payment, PaymentStatus
from .notifications import notify
from .serializers import (
    serialize_candidate,
    serialize_interview,
    serialize_notification,
    serialize_payment,
)
from .timezone import naive_utcnow, parse_local_to_utc, to_local

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ServiceError(Exception):
    """User-facing error (bad input or an illegal operation)."""


# --------------------------------------------------------------------------- #
# Internal helpers
# --------------------------------------------------------------------------- #
def _get_candidate(db, candidate_id: int) -> Candidate:
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise ServiceError("Candidate not found.")
    return candidate


def _get_interview(db, interview_id: int) -> Interview:
    interview = db.get(Interview, interview_id)
    if interview is None:
        raise ServiceError("Interview not found.")
    return interview


def _transition(interview: Interview, target: InterviewStatus) -> None:
    try:
        ensure_transition(interview.status, target)
    except InvalidTransition as exc:
        raise ServiceError(str(exc)) from exc
    interview.status = target


# --------------------------------------------------------------------------- #
# Admin auth (local)
# --------------------------------------------------------------------------- #
def verify_admin(password: str) -> bool:
    return (password or "") == get_settings().admin_password


# --------------------------------------------------------------------------- #
# Candidates
# --------------------------------------------------------------------------- #
def register_candidate(
    name: str, email: str, timezone: str = "UTC", phone: str | None = None
) -> dict:
    """Register, or sign in an existing candidate by email (updating details)."""
    name = (name or "").strip()
    email = (email or "").strip().lower()
    timezone = (timezone or "UTC").strip() or "UTC"
    if not name:
        raise ServiceError("Name is required.")
    if not _EMAIL_RE.match(email):
        raise ServiceError("Please enter a valid email address.")
    from .timezone import is_valid_timezone

    if not is_valid_timezone(timezone):
        raise ServiceError(f"Unknown timezone: {timezone!r}")

    with session_scope() as db:
        existing = db.scalar(select(Candidate).where(Candidate.email == email))
        if existing is not None:
            existing.name = name
            existing.timezone = timezone
            if phone is not None:
                existing.phone = phone
            db.flush()
            return serialize_candidate(existing)
        candidate = Candidate(name=name, email=email, timezone=timezone, phone=phone)
        db.add(candidate)
        db.flush()
        return serialize_candidate(candidate)


def list_candidates() -> list[dict]:
    with session_scope() as db:
        rows = db.scalars(select(Candidate).order_by(Candidate.name)).all()
        return [serialize_candidate(c) for c in rows]


def get_candidate_by_email(email: str) -> dict | None:
    email = (email or "").strip().lower()
    with session_scope() as db:
        c = db.scalar(select(Candidate).where(Candidate.email == email))
        return serialize_candidate(c) if c else None


# --------------------------------------------------------------------------- #
# Interviews — candidate side
# --------------------------------------------------------------------------- #
def request_interview(
    candidate_id: int,
    role: str,
    preferred_local: str | None = None,
    duration_minutes: int = 30,
    notes: str | None = None,
) -> dict:
    role = (role or "").strip()
    if not role:
        raise ServiceError("Role / topic is required.")
    if not 5 <= int(duration_minutes) <= 480:
        raise ServiceError("Duration must be between 5 and 480 minutes.")

    with session_scope() as db:
        candidate = _get_candidate(db, candidate_id)
        preferred = None
        if preferred_local and preferred_local.strip():
            try:
                preferred = parse_local_to_utc(preferred_local, candidate.timezone)
            except ValueError:
                raise ServiceError("Preferred time must look like YYYY-MM-DD HH:MM.")
        interview = Interview(
            candidate_id=candidate.id,
            role=role,
            notes=(notes or None),
            duration_minutes=int(duration_minutes),
            preferred_start=preferred,
            status=InterviewStatus.REQUESTED,
        )
        db.add(interview)
        db.flush()
        notify(
            db,
            audience="admin",
            subject="New interview request",
            body=f"{candidate.name} requested an interview for '{role}'.",
        )
        return serialize_interview(interview)


def list_candidate_interviews(candidate_id: int) -> list[dict]:
    with session_scope() as db:
        rows = db.scalars(
            select(Interview)
            .where(Interview.candidate_id == candidate_id)
            .order_by(Interview.created_at.desc())
        ).all()
        return [serialize_interview(i) for i in rows]


# --------------------------------------------------------------------------- #
# Interviews — admin side
# --------------------------------------------------------------------------- #
def list_interviews(status: str | None = None) -> list[dict]:
    with session_scope() as db:
        stmt = select(Interview).order_by(Interview.created_at.desc())
        if status:
            stmt = stmt.where(Interview.status == InterviewStatus(status))
        return [serialize_interview(i) for i in db.scalars(stmt).all()]


def approve(interview_id: int) -> dict:
    with session_scope() as db:
        interview = _get_interview(db, interview_id)
        _transition(interview, InterviewStatus.APPROVED)
        notify(
            db,
            candidate_id=interview.candidate_id,
            subject="Interview approved",
            body=f"Your request for '{interview.role}' was approved. "
            "A scheduled time is coming shortly.",
        )
        return serialize_interview(interview)


def reject(interview_id: int, reason: str | None = None) -> dict:
    with session_scope() as db:
        interview = _get_interview(db, interview_id)
        _transition(interview, InterviewStatus.REJECTED)
        notify(
            db,
            candidate_id=interview.candidate_id,
            subject="Interview not approved",
            body=f"Your request for '{interview.role}' was not approved. "
            f"{(reason or 'No reason provided.')}",
        )
        return serialize_interview(interview)


def schedule(
    interview_id: int,
    scheduled_local: str,
    meeting_link: str | None = None,
    duration_minutes: int | None = None,
) -> dict:
    with session_scope() as db:
        interview = _get_interview(db, interview_id)
        try:
            when = parse_local_to_utc(scheduled_local, interview.candidate.timezone)
        except ValueError:
            raise ServiceError("Time must look like YYYY-MM-DD HH:MM.")
        _transition(interview, InterviewStatus.SCHEDULED)
        interview.scheduled_start = when
        if duration_minutes:
            interview.duration_minutes = int(duration_minutes)
        if meeting_link is not None:
            interview.meeting_link = meeting_link or None
        local = to_local(when, interview.candidate.timezone)
        notify(
            db,
            candidate_id=interview.candidate_id,
            subject="Interview scheduled",
            body=f"Your interview for '{interview.role}' is scheduled for "
            f"{local:%Y-%m-%d %H:%M %Z}.",
        )
        return serialize_interview(interview)


def start_call(interview_id: int) -> dict:
    with session_scope() as db:
        interview = _get_interview(db, interview_id)
        _transition(interview, InterviewStatus.IN_PROGRESS)
        return serialize_interview(interview)


def complete(
    interview_id: int, outcome: str | None = None, rating: int | None = None
) -> dict:
    if rating is not None and not 1 <= int(rating) <= 5:
        raise ServiceError("Rating must be between 1 and 5.")
    with session_scope() as db:
        interview = _get_interview(db, interview_id)
        _transition(interview, InterviewStatus.COMPLETED)
        if outcome is not None:
            interview.outcome = outcome or None
        if rating is not None:
            interview.rating = int(rating)
        notify(
            db,
            candidate_id=interview.candidate_id,
            subject="Interview completed",
            body=f"Your interview for '{interview.role}' is complete. Thank you!",
        )
        return serialize_interview(interview)


def cancel(interview_id: int, reason: str | None = None) -> dict:
    with session_scope() as db:
        interview = _get_interview(db, interview_id)
        _transition(interview, InterviewStatus.CANCELLED)
        notify(
            db,
            candidate_id=interview.candidate_id,
            subject="Interview cancelled",
            body=f"Your interview for '{interview.role}' was cancelled. "
            f"{(reason or '')}".strip(),
        )
        return serialize_interview(interview)


def set_admin_notes(interview_id: int, admin_notes: str | None) -> dict:
    with session_scope() as db:
        interview = _get_interview(db, interview_id)
        interview.admin_notes = admin_notes or None
        return serialize_interview(interview)


# --------------------------------------------------------------------------- #
# Payments (mock provider)
# --------------------------------------------------------------------------- #
def create_payment(
    interview_id: int, amount_cents: int, currency: str = "USD"
) -> dict:
    if int(amount_cents) <= 0:
        raise ServiceError("Amount must be greater than zero.")
    currency = (currency or "USD").upper()
    if len(currency) != 3:
        raise ServiceError("Currency must be a 3-letter code, e.g. USD.")
    with session_scope() as db:
        interview = _get_interview(db, interview_id)
        if interview.payment is not None:
            raise ServiceError("A payment already exists for this interview.")
        payment = Payment(
            interview_id=interview.id,
            amount_cents=int(amount_cents),
            currency=currency,
        )
        db.add(payment)
        db.flush()
        notify(
            db,
            candidate_id=interview.candidate_id,
            subject="Payment requested",
            body=f"A payment of {int(amount_cents) / 100:.2f} {currency} is due "
            f"for your '{interview.role}' interview.",
        )
        return serialize_payment(payment)


def pay(payment_id: int) -> dict:
    with session_scope() as db:
        payment = db.get(Payment, payment_id)
        if payment is None:
            raise ServiceError("Payment not found.")
        if payment.status == PaymentStatus.PAID:
            return serialize_payment(payment)
        if payment.status == PaymentStatus.REFUNDED:
            raise ServiceError("This payment was refunded.")
        payment.status = PaymentStatus.PAID
        payment.paid_at = naive_utcnow()
        payment.provider_ref = f"mock_{payment.id}"
        notify(
            db,
            audience="admin",
            subject="Payment received",
            body=f"Payment #{payment.id} for interview "
            f"#{payment.interview_id} was paid.",
        )
        return serialize_payment(payment)


def refund(payment_id: int) -> dict:
    with session_scope() as db:
        payment = db.get(Payment, payment_id)
        if payment is None:
            raise ServiceError("Payment not found.")
        payment.status = PaymentStatus.REFUNDED
        return serialize_payment(payment)


def list_payments() -> list[dict]:
    with session_scope() as db:
        rows = db.scalars(select(Payment).order_by(Payment.created_at.desc())).all()
        return [serialize_payment(p) for p in rows]


# --------------------------------------------------------------------------- #
# Notifications
# --------------------------------------------------------------------------- #
def candidate_notifications(candidate_id: int) -> list[dict]:
    from .models import Notification

    with session_scope() as db:
        rows = db.scalars(
            select(Notification)
            .where(Notification.candidate_id == candidate_id)
            .order_by(Notification.created_at.desc())
        ).all()
        return [serialize_notification(n) for n in rows]


def admin_notifications() -> list[dict]:
    from .models import Notification

    with session_scope() as db:
        rows = db.scalars(
            select(Notification)
            .where(Notification.audience == "admin")
            .order_by(Notification.created_at.desc())
        ).all()
        return [serialize_notification(n) for n in rows]


def mark_notification_read(notification_id: int) -> dict:
    from .models import Notification

    with session_scope() as db:
        note = db.get(Notification, notification_id)
        if note is None:
            raise ServiceError("Notification not found.")
        note.read = True
        return serialize_notification(note)
