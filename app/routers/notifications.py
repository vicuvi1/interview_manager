"""In-app notification feeds for candidates and the admin."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin
from ..models import Notification
from ..serializers import serialize_notification

router = APIRouter(prefix="/api", tags=["notifications"])


@router.get("/candidates/{candidate_id}/notifications")
def candidate_feed(candidate_id: int, db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(
        select(Notification)
        .where(Notification.candidate_id == candidate_id)
        .order_by(Notification.created_at.desc())
    ).all()
    return [serialize_notification(n) for n in rows]


@router.get("/admin/notifications", dependencies=[Depends(require_admin)])
def admin_feed(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(
        select(Notification)
        .where(Notification.audience == "admin")
        .order_by(Notification.created_at.desc())
    ).all()
    return [serialize_notification(n) for n in rows]


@router.post("/notifications/{notification_id}/read")
def mark_read(notification_id: int, db: Session = Depends(get_db)) -> dict:
    note = db.get(Notification, notification_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Notification not found.")
    note.read = True
    db.commit()
    db.refresh(note)
    return serialize_notification(note)
