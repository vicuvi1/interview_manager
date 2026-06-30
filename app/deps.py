"""Shared FastAPI dependencies: admin auth and common 404 lookups."""

import secrets

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_db
from .models import Candidate, Interview


def require_admin(x_admin_key: str | None = Header(default=None)) -> None:
    """Guard for the single admin ("caller"). Send key in `X-Admin-Key`."""
    expected = get_settings().admin_api_key
    if not x_admin_key or not secrets.compare_digest(x_admin_key, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing admin key.",
        )


def get_candidate_or_404(candidate_id: int, db: Session = Depends(get_db)) -> Candidate:
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found.")
    return candidate


def get_interview_or_404(interview_id: int, db: Session = Depends(get_db)) -> Interview:
    interview = db.get(Interview, interview_id)
    if interview is None:
        raise HTTPException(status_code=404, detail="Interview not found.")
    return interview
