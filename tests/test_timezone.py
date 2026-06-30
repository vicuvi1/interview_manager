from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.timezone import as_utc, parse_local_to_utc, to_local, to_naive_utc


def test_to_naive_utc_converts_offset():
    aware = datetime(2026, 7, 15, 14, 0, tzinfo=ZoneInfo("America/New_York"))
    naive = to_naive_utc(aware)
    assert naive.tzinfo is None
    # 14:00 EDT (UTC-4) -> 18:00 UTC
    assert (naive.hour, naive.minute) == (18, 0)


def test_round_trip_local():
    stored = to_naive_utc(datetime(2026, 7, 15, 18, 0, tzinfo=ZoneInfo("UTC")))
    local = to_local(stored, "America/New_York")
    assert local.hour == 14  # back to EDT
    assert as_utc(stored).hour == 18


def test_parse_local_to_utc():
    # 14:00 in New York -> 18:00 UTC, returned as naive
    naive = parse_local_to_utc("2026-07-15 14:00", "America/New_York")
    assert naive.tzinfo is None
    assert (naive.hour, naive.minute) == (18, 0)


def test_parse_local_to_utc_bad_format_raises():
    with pytest.raises(ValueError):
        parse_local_to_utc("not a time", "UTC")
