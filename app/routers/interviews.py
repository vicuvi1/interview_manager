"""Interview request + the admin lifecycle actions (the heart of the app)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_interview_or_404, require_admin
from ..lifecycle import InvalidTransition, ensure_transition
from ..models import Candidate, Interview, InterviewStatus
from ..notifications import notify
from ..schemas import (
    AdminNotesIn,
    CompleteIn,
    InterviewCreate,
    ReasonIn,
    ScheduleIn,
)
from ..serializers import serialize_interview
from ..timezone import to_local, to_naive_utc

router = APIRouter(prefix="/api/interviews", tags=["interviews"])


def _apply_transition(interview: Interview, target: InterviewStatus) -> None:
    try:
        ensure_transition(interview.status, target)
    except InvalidTransition as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    interview.status = target


# --------------------------------------------------------------------------- #
# Candidate-facing
# --------------------------------------------------------------------------- #
@router.post("", status_code=201)
def request_interview(payload: InterviewCreate, db: Session = Depends(get_db)) -> dict:
    candidate = db.get(Candidate, payload.candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    interview = Interview(
        candidate_id=candidate.id,
        role=payload.role,
        notes=payload.notes,
        duration_minutes=payload.duration_minutes,
        preferred_start=to_naive_utc(payload.preferred_start),
        status=InterviewStatus.REQUESTED,
    )
    db.add(interview)
    db.flush()
    notify(
        db,
        audience="admin",
        subject="New interview request",
        body=f"{candidate.name} requested an interview for '{payload.role}'.",
    )
    db.commit()
    db.refresh(interview)
    return serialize_interview(interview)


@router.get("/by-candidate/{candidate_id}")
def list_candidate_interviews(
    candidate_id: int, db: Session = Depends(get_db)
) -> list[dict]:
    rows = db.scalars(
        select(Interview)
        .where(Interview.candidate_id == candidate_id)
        .order_by(Interview.created_at.desc())
    ).all()
    return [serialize_interview(i) for i in rows]


@router.get("/{interview_id}")
def get_interview(
    interview: Interview = Depends(get_interview_or_404),
) -> dict:
    return serialize_interview(interview)


# --------------------------------------------------------------------------- #
# Admin ("caller") lifecycle
# --------------------------------------------------------------------------- #
@router.get("", dependencies=[Depends(require_admin)])
def list_interviews(
    status: InterviewStatus | None = None, db: Session = Depends(get_db)
) -> list[dict]:
    stmt = select(Interview).order_by(Interview.created_at.desc())
    if status is not None:
        stmt = stmt.where(Interview.status == status)
    return [serialize_interview(i) for i in db.scalars(stmt).all()]


@router.post("/{interview_id}/approve", dependencies=[Depends(require_admin)])
def approve(
    interview: Interview = Depends(get_interview_or_404),
    db: Session = Depends(get_db),
) -> dict:
    _apply_transition(interview, InterviewStatus.APPROVED)
    notify(
        db,
        candidate_id=interview.candidate_id,
        subject="Interview approved",
        body=f"Your request for '{interview.role}' was approved. "
        "We'll send a scheduled time shortly.",
    )
    db.commit()
    db.refresh(interview)
    return serialize_interview(interview)


@router.post("/{interview_id}/reject", dependencies=[Depends(require_admin)])
def reject(
    payload: ReasonIn | None = None,
    interview: Interview = Depends(get_interview_or_404),
    db: Session = Depends(get_db),
) -> dict:
    _apply_transition(interview, InterviewStatus.REJECTED)
    reason = (payload.reason if payload else None) or "No reason provided."
    notify(
        db,
        candidate_id=interview.candidate_id,
        subject="Interview not approved",
        body=f"Your request for '{interview.role}' was not approved. {reason}",
    )
    db.commit()
    db.refresh(interview)
    return serialize_interview(interview)


@router.post("/{interview_id}/schedule", dependencies=[Depends(require_admin)])
def schedule(
    payload: ScheduleIn,
    interview: Interview = Depends(get_interview_or_404),
    db: Session = Depends(get_db),
) -> dict:
    _apply_transition(interview, InterviewStatus.SCHEDULED)
    interview.scheduled_start = to_naive_utc(payload.scheduled_start)
    if payload.duration_minutes is not None:
        interview.duration_minutes = payload.duration_minutes
    if payload.meeting_link is not None:
        interview.meeting_link = payload.meeting_link

    local = to_local(interview.scheduled_start, interview.candidate.timezone)
    when = local.strftime("%Y-%m-%d %H:%M %Z") if local else "the scheduled time"
    notify(
        db,
        candidate_id=interview.candidate_id,
        subject="Interview scheduled",
        body=f"Your interview for '{interview.role}' is scheduled for {when}.",
    )
    db.commit()
    db.refresh(interview)
    return serialize_interview(interview)


@router.post("/{interview_id}/start", dependencies=[Depends(require_admin)])
def start_call(
    interview: Interview = Depends(get_interview_or_404),
    db: Session = Depends(get_db),
) -> dict:
    _apply_transition(interview, InterviewStatus.IN_PROGRESS)
    db.commit()
    db.refresh(interview)
    return serialize_interview(interview)


@router.post("/{interview_id}/complete", dependencies=[Depends(require_admin)])
def complete(
    payload: CompleteIn,
    interview: Interview = Depends(get_interview_or_404),
    db: Session = Depends(get_db),
) -> dict:
    _apply_transition(interview, InterviewStatus.COMPLETED)
    if payload.outcome is not None:
        interview.outcome = payload.outcome
    if payload.rating is not None:
        interview.rating = payload.rating
    notify(
        db,
        candidate_id=interview.candidate_id,
        subject="Interview completed",
        body=f"Your interview for '{interview.role}' is complete. Thank you!",
    )
    db.commit()
    db.refresh(interview)
    return serialize_interview(interview)


@router.post("/{interview_id}/cancel", dependencies=[Depends(require_admin)])
def cancel(
    payload: ReasonIn | None = None,
    interview: Interview = Depends(get_interview_or_404),
    db: Session = Depends(get_db),
) -> dict:
    _apply_transition(interview, InterviewStatus.CANCELLED)
    reason = (payload.reason if payload else None) or ""
    notify(
        db,
        candidate_id=interview.candidate_id,
        subject="Interview cancelled",
        body=f"Your interview for '{interview.role}' was cancelled. {reason}".strip(),
    )
    db.commit()
    db.refresh(interview)
    return serialize_interview(interview)


@router.patch("/{interview_id}/admin-notes", dependencies=[Depends(require_admin)])
def set_admin_notes(
    payload: AdminNotesIn,
    interview: Interview = Depends(get_interview_or_404),
    db: Session = Depends(get_db),
) -> dict:
    interview.admin_notes = payload.admin_notes
    db.commit()
    db.refresh(interview)
    return serialize_interview(interview)
