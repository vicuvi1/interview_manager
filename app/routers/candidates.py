"""Candidate registration and lookup."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin
from ..models import Candidate
from ..schemas import CandidateCreate
from ..serializers import serialize_candidate

router = APIRouter(prefix="/api/candidates", tags=["candidates"])


@router.post("", status_code=201)
def register_candidate(payload: CandidateCreate, db: Session = Depends(get_db)) -> dict:
    """Register a candidate, or return the existing one for that email.

    Acts as a lightweight "sign in by email" for the candidate portal.
    """
    existing = db.scalar(select(Candidate).where(Candidate.email == payload.email))
    if existing is not None:
        return serialize_candidate(existing)

    candidate = Candidate(**payload.model_dump())
    db.add(candidate)
    db.commit()
    db.refresh(candidate)
    return serialize_candidate(candidate)


@router.get("/by-email")
def get_candidate_by_email(email: str, db: Session = Depends(get_db)) -> dict:
    candidate = db.scalar(
        select(Candidate).where(Candidate.email == email.strip().lower())
    )
    if candidate is None:
        raise HTTPException(status_code=404, detail="No candidate with that email.")
    return serialize_candidate(candidate)


@router.get("/{candidate_id}")
def get_candidate(candidate_id: int, db: Session = Depends(get_db)) -> dict:
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found.")
    return serialize_candidate(candidate)


@router.get("", dependencies=[Depends(require_admin)])
def list_candidates(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Candidate).order_by(Candidate.created_at.desc())).all()
    return [serialize_candidate(c) for c in rows]
