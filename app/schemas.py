"""Pydantic request models (validation at the API boundary).

Responses are built by app.serializers as plain dicts, because they include
timezone-localized fields that depend on the related candidate.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from .timezone import is_valid_timezone

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class CandidateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(max_length=255)
    timezone: str = Field(default="UTC", max_length=64)
    phone: Optional[str] = Field(default=None, max_length=40)
    notes: Optional[str] = None

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError("Invalid email address.")
        return v

    @field_validator("timezone")
    @classmethod
    def _check_timezone(cls, v: str) -> str:
        if not is_valid_timezone(v):
            raise ValueError(f"Unknown timezone: {v!r}")
        return v


class InterviewCreate(BaseModel):
    candidate_id: int
    role: str = Field(min_length=1, max_length=160)
    preferred_start: Optional[datetime] = None
    duration_minutes: int = Field(default=30, ge=5, le=480)
    notes: Optional[str] = None


class ScheduleIn(BaseModel):
    scheduled_start: datetime
    duration_minutes: Optional[int] = Field(default=None, ge=5, le=480)
    meeting_link: Optional[str] = Field(default=None, max_length=500)


class CompleteIn(BaseModel):
    outcome: Optional[str] = None
    rating: Optional[int] = Field(default=None, ge=1, le=5)


class ReasonIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


class AdminNotesIn(BaseModel):
    admin_notes: Optional[str] = None


class PaymentCreate(BaseModel):
    amount_cents: int = Field(gt=0, le=100_000_00)  # up to 100k of currency
    currency: str = Field(default="USD", min_length=3, max_length=3)

    @field_validator("currency")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper()
