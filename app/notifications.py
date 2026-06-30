"""Notification service.

For this scaffold notifications are persisted in-app (a feed the candidate and
admin can read). Swapping in email/SMS later means changing only this module.
"""

from sqlalchemy.orm import Session

from .models import Notification


def notify(
    db: Session,
    *,
    subject: str,
    body: str,
    candidate_id: int | None = None,
    audience: str = "candidate",
) -> Notification:
    note = Notification(
        candidate_id=candidate_id,
        audience=audience,
        subject=subject,
        body=body,
    )
    db.add(note)
    db.flush()
    return note
