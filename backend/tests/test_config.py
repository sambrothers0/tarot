import pytest

from app.config import Settings


def make(**env: str) -> Settings:
    return Settings(_env_file=None, google_client_id="cid", **env)  # type: ignore[call-arg]


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("postgresql://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        ("postgres://u:p@host/db?sslmode=require", "postgresql+psycopg://u:p@host/db?sslmode=require"),
        ("postgresql+psycopg://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        ("sqlite://", "sqlite://"),
    ],
)
def test_database_url_is_pinned_to_psycopg3(given: str, expected: str) -> None:
    assert make(database_url=given).database_url == expected


def test_allowed_origins_from_a_comma_separated_env_var(monkeypatch) -> None:
    monkeypatch.setenv(
        "ALLOWED_ORIGINS", " https://you.github.io/ , http://localhost:5173,, "
    )
    settings = make(database_url="sqlite://")
    assert settings.allowed_origins == ["https://you.github.io", "http://localhost:5173"]


def test_defaults(monkeypatch) -> None:
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    settings = make(database_url="sqlite://")
    assert settings.allowed_origins == []
    assert settings.session_ttl_days == 30
    assert settings.max_sessions_per_user == 10
