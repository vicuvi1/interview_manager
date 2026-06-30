"""Payments. A mock provider: the admin raises an invoice, the candidate pays.

No real gateway is wired in — `pay` simply marks the payment settled. Swap the
body of `pay` for a Stripe/PayPal call to go live.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_interview_or_404, require_admin
from ..models import Interview, Payment, PaymentStatus
from ..notifications import notify
from ..schemas import PaymentCreate
from ..serializers import serialize_payment
from ..timezone import naive_utcnow

router = APIRouter(prefix="/api", tags=["payments"])


@router.post(
    "/interviews/{interview_id}/payment",
    status_code=201,
    dependencies=[Depends(require_admin)],
)
def create_payment(
    payload: PaymentCreate,
    interview: Interview = Depends(get_interview_or_404),
    db: Session = Depends(get_db),
) -> dict:
    if interview.payment is not None:
        raise HTTPException(
            status_code=409, detail="A payment already exists for this interview."
        )
    payment = Payment(
        interview_id=interview.id,
        amount_cents=payload.amount_cents,
        currency=payload.currency,
    )
    db.add(payment)
    db.flush()
    notify(
        db,
        candidate_id=interview.candidate_id,
        subject="Payment requested",
        body=f"A payment of {payload.amount_cents / 100:.2f} {payload.currency} "
        f"is due for your '{interview.role}' interview.",
    )
    db.commit()
    db.refresh(payment)
    return serialize_payment(payment)


@router.get("/interviews/{interview_id}/payment")
def get_payment(
    interview: Interview = Depends(get_interview_or_404),
) -> dict:
    if interview.payment is None:
        raise HTTPException(status_code=404, detail="No payment for this interview.")
    return serialize_payment(interview.payment)


@router.post("/payments/{payment_id}/pay")
def pay(payment_id: int, db: Session = Depends(get_db)) -> dict:
    payment = db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment not found.")
    if payment.status == PaymentStatus.PAID:
        return serialize_payment(payment)
    if payment.status == PaymentStatus.REFUNDED:
        raise HTTPException(status_code=409, detail="Payment was refunded.")

    payment.status = PaymentStatus.PAID
    payment.paid_at = naive_utcnow()
    payment.provider_ref = f"mock_{payment.id}"
    notify(
        db,
        audience="admin",
        subject="Payment received",
        body=f"Payment #{payment.id} for interview #{payment.interview_id} was paid.",
    )
    db.commit()
    db.refresh(payment)
    return serialize_payment(payment)


@router.post("/payments/{payment_id}/refund", dependencies=[Depends(require_admin)])
def refund(payment_id: int, db: Session = Depends(get_db)) -> dict:
    payment = db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment not found.")
    payment.status = PaymentStatus.REFUNDED
    db.commit()
    db.refresh(payment)
    return serialize_payment(payment)


@router.get("/payments", dependencies=[Depends(require_admin)])
def list_payments(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Payment).order_by(Payment.created_at.desc())).all()
    return [serialize_payment(p) for p in rows]
