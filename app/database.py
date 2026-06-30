"""Database engine, session factory, and helpers.

`session_scope()` gives callers a transactional unit of work; service functions
use it so the GUI never has to touch SQLAlchemy directly.
"""

from contextlib import contextmanager
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

settings = get_settings()

connect_args = (
    {"check_same_thread": False}
    if settings.database_url.startswith("sqlite")
    else {}
)

engine = create_engine(settings.database_url, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    future=True,
    # Keep attributes available after commit so serializers can read them.
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    """Create all tables (idempotent). Call once at startup."""
    from . import models  # noqa: F401  (register mappers)

    Base.metadata.create_all(bind=engine)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Provide a transactional scope: commit on success, roll back on error."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
