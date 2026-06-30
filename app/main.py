"""FastAPI application entrypoint."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .database import Base, engine
from .routers import candidates, interviews, notifications, payments

settings = get_settings()

# Create tables on startup. For real deployments, switch to Alembic migrations.
Base.metadata.create_all(bind=engine)

app = FastAPI(title=settings.app_name, version="0.1.0")

app.include_router(candidates.router)
app.include_router(interviews.router)
app.include_router(payments.router)
app.include_router(notifications.router)


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok", "app": settings.app_name}


# Serve the candidate portal (index.html) and admin dashboard (admin.html).
# Mounted last so it only catches paths not handled by the API routers above.
_STATIC_DIR = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="static")
