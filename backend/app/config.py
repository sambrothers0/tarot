from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from typing import Annotated


class Settings(BaseSettings):
    """Read from the environment (or a local `.env`). Nothing here is a secret
    except `database_url`: the Google client ID is public by design."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    google_client_id: str
    # Comma-separated in the environment, e.g.
    # ALLOWED_ORIGINS=https://you.github.io,http://localhost:5173
    allowed_origins: Annotated[list[str], NoDecode] = []
    session_ttl_days: int = 30
    # Signing in again adds a session; past this many, the oldest go. Bounds
    # the rows one Google account can create by replaying sign-ins.
    max_sessions_per_user: int = 10

    @field_validator("database_url")
    @classmethod
    def _use_psycopg3(cls, url: str) -> str:
        # Neon hands out `postgresql://` (or `postgres://`) URLs, which
        # SQLAlchemy maps to psycopg2. Pin the driver to psycopg 3.
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [o.strip().rstrip("/") for o in value.split(",") if o.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
