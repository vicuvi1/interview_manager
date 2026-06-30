"""Test fixtures.

The DATABASE_URL / ADMIN_API_KEY env vars are set *before* importing the app,
because app.database builds its engine from settings at import time. Each test
gets a clean schema via drop_all/create_all.
"""

import os
import tempfile

# Must be set before any `app.*` import.
_DB_PATH = os.path.join(tempfile.gettempdir(), "interview_manager_test.db")
os.environ["DATABASE_URL"] = f"sqlite:///{_DB_PATH}"
os.environ["ADMIN_API_KEY"] = "test-admin-key"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

ADMIN_KEY = "test-admin-key"
ADMIN_HEADERS = {"X-Admin-Key": ADMIN_KEY}


@pytest.fixture()
def client():
    from app.database import Base, engine
    from app.main import app

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def candidate(client):
    """A registered candidate in America/New_York."""
    resp = client.post(
        "/api/candidates",
        json={
            "name": "Ada Lovelace",
            "email": "ada@example.com",
            "timezone": "America/New_York",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()
