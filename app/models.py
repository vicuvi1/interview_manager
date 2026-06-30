"""SQLAlchemy ORM models for the interview manager."""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .timezone import naive_utcnow


def _enum_values(enum_cls) -> list[str]:
    """Persist the lowercase `.value` of each enum member, not its name."""
    return [member.value for member in enum_cls]


class InterviewStatus(str, enum.Enum):
    REQUESTED = "requested"
    APPROVED = "approved"
    REJECTED = "rejected"
    SCHEDULED = "scheduled"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class PaymentStatus(str, enum.Enum):
    PENDING = "pending"
    PAID = "paid"
    REFUNDED = "refunded"
    FAILED = "failed"


class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=naive_utcnow)

    interviews: Mapped[list[Interview]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )
    notifications: Mapped[list[Notification]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )


class Interview(Base):
    __tablename__ = "interviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(160))
    status: Mapped[InterviewStatus] = mapped_column(
        SAEnum(InterviewStatus, values_callable=_enum_values),
        default=InterviewStatus.REQUESTED,
        index=True,
    )

    # All datetimes stored as naive UTC (see app.timezone).
    preferred_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    scheduled_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30)

    meeting_link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)  # candidate's request
    admin_notes: Mapped[str | None] = mapped_column(Text, nullable=True)  # caller's private
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1..5

    created_at: Mapped[datetime] = mapped_column(DateTime, default=naive_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=naive_utcnow, onupdate=naive_utcnow
    )

    candidate: Mapped[Candidate] = relationship(back_populates="interviews")
    payment: Mapped[Payment | None] = relationship(
        back_populates="interview", uselist=False, cascade="all, delete-orphan"
    )


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    interview_id: Mapped[int] = mapped_column(
        ForeignKey("interviews.id", ondelete="CASCADE"), unique=True, index=True
    )
    amount_cents: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    status: Mapped[PaymentStatus] = mapped_column(
        SAEnum(PaymentStatus, values_callable=_enum_values),
        default=PaymentStatus.PENDING,
        index=True,
    )
    provider_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=naive_utcnow)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    interview: Mapped[Interview] = relationship(back_populates="payment")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int | None] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), nullable=True, index=True
    )
    audience: Mapped[str] = mapped_column(String(20), default="candidate")  # candidate|admin
    subject: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=naive_utcnow)

    candidate: Mapped[Candidate | None] = relationship(back_populates="notifications")
