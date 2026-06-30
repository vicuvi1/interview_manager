"""Timezone helpers.

Convention: every datetime is stored in the database as *naive UTC* (no
tzinfo, wall-clock equals UTC). Conversions to/from aware datetimes and to a
candidate's local zone happen at the edges (request parsing and serialization).
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def utcnow() -> datetime:
    """Timezone-aware current time in UTC."""
    return datetime.now(timezone.utc)


def naive_utcnow() -> datetime:
    """Naive UTC current time, for storing in the database."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def is_valid_timezone(name: str) -> bool:
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError, ModuleNotFoundError):
        return False


def to_naive_utc(dt: datetime | None) -> datetime | None:
    """Normalize an incoming datetime to naive UTC for storage.

    Aware datetimes are converted to UTC; naive datetimes are assumed UTC.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def as_utc(dt: datetime | None) -> datetime | None:
    """Reattach UTC tzinfo to a naive datetime read back from the database."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def to_local(dt: datetime | None, tz_name: str) -> datetime | None:
    """Convert a stored (naive UTC) datetime into the given IANA zone."""
    dt = as_utc(dt)
    if dt is None:
        return None
    try:
        return dt.astimezone(ZoneInfo(tz_name))
    except (ZoneInfoNotFoundError, ValueError, ModuleNotFoundError):
        return dt


def isoformat(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt is not None else None
