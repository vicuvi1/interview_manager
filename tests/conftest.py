"""Test setup.

IM_DATABASE_URL / IM_ADMIN_PASSWORD are set before importing the app, because
the engine and settings are built at import time. Every test gets a clean
schema via the autouse fixture.
"""

import os
import tempfile

_DB_FILE = os.path.join(tempfile.gettempdir(), "interview_manager_test.db")
os.environ["IM_DATABASE_URL"] = "sqlite:///" + _DB_FILE.replace("\\", "/")
os.environ["IM_ADMIN_PASSWORD"] = "test-pass"

import pytest  # noqa: E402

from app.database import Base, engine, init_db  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(bind=engine)
    init_db()
    yield
