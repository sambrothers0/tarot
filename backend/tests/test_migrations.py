"""Alembic migrations: they apply cleanly, they reverse cleanly, and the schema
they build is exactly what the models describe. The container runs
`alembic upgrade head` on boot, so a migration that drifts from the models
is a production outage waiting for the next deploy.

Runs on SQLite always. In CI it also runs on Postgres (the production
engine), via TEST_DATABASE_URL.
"""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app import models  # noqa: F401  (registers the tables)
from app.config import get_settings
from app.db import Base

BACKEND = Path(__file__).resolve().parent.parent


def _urls() -> list[str]:
    urls = ["sqlite:///{tmp}/migrations.db"]
    if os.environ.get("TEST_DATABASE_URL"):
        urls.append(os.environ["TEST_DATABASE_URL"])
    return urls


@pytest.fixture(params=_urls(), ids=lambda u: u.split(":", 1)[0])
def database_url(request, tmp_path, monkeypatch) -> Iterator[str]:
    url = request.param.format(tmp=tmp_path)
    # env.py reads the URL through the cached settings object.
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    url = get_settings().database_url
    engine = create_engine(url)
    if engine.dialect.name == "postgresql":
        # Start from an empty schema, whatever a previous run left behind.
        with engine.begin() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE"))
            conn.execute(text("CREATE SCHEMA public"))
    engine.dispose()
    yield url
    get_settings.cache_clear()


def _config() -> Config:
    # No ini file: keeps env.py from reconfiguring pytest's logging.
    cfg = Config()
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    return cfg


def _tables(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        return set(inspect(engine).get_table_names()) - {"alembic_version"}
    finally:
        engine.dispose()


def test_upgrade_matches_the_models(database_url: str) -> None:
    command.upgrade(_config(), "head")
    engine = create_engine(database_url)
    try:
        with engine.connect() as conn:
            diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    finally:
        engine.dispose()
    assert diff == [], f"models and migrations disagree: {diff}"


def test_downgrade_to_base_and_back(database_url: str) -> None:
    cfg = _config()
    command.upgrade(cfg, "head")
    assert _tables(database_url) == set(Base.metadata.tables)
    command.downgrade(cfg, "base")
    assert _tables(database_url) == set()
    command.upgrade(cfg, "head")
    assert _tables(database_url) == set(Base.metadata.tables)


def test_history_is_linear() -> None:
    # Two heads means two branches would race at boot.
    script = ScriptDirectory.from_config(_config())
    assert len(script.get_heads()) == 1
