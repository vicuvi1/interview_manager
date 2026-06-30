"""Application settings, loaded from environment / .env file."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "Interview Manager"

    # Secret the single admin ("caller") sends in the X-Admin-Key header.
    admin_api_key: str = "change-me-admin-key"

    # SQLAlchemy database URL.
    database_url: str = "sqlite:///./interview_manager.db"

    # Fallback IANA timezone when a candidate hasn't supplied one.
    default_timezone: str = "UTC"


@lru_cache
def get_settings() -> Settings:
    return Settings()
