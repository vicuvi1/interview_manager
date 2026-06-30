"""Lightweight settings — no third-party dependencies.

Everything can be overridden with environment variables, but the defaults are
chosen so the app "just works" with no configuration: a single per-user SQLite
file that every launch on this machine shares (so the candidate view and the
admin view see the same data).
"""

import os
from pathlib import Path


def user_data_dir() -> Path:
    """A stable, user-writable directory for the database."""
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.join(
            os.path.expanduser("~"), ".local", "share"
        )
    return Path(base) / "InterviewManager"


def default_database_url() -> str:
    override = os.environ.get("IM_DATABASE_URL")
    if override:
        return override
    data_dir = user_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{(data_dir / 'interview_manager.db').as_posix()}"


class Settings:
    def __init__(self) -> None:
        self.app_name = os.environ.get("IM_APP_NAME", "Interview Manager")
        self.database_url = default_database_url()
        # Password the operator types to enter Admin mode (local only).
        self.admin_password = os.environ.get("IM_ADMIN_PASSWORD", "admin")
        self.default_timezone = os.environ.get("IM_DEFAULT_TIMEZONE", "UTC")


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
