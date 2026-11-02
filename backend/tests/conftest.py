import os
from collections.abc import Iterator

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

# Settings are read at import time by create_app(); give them something.
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test-client-id")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:5173")

from app.config import get_settings  # noqa: E402
from app.db import Base, get_db  # noqa: E402
from app.limits import Limits  # noqa: E402
from app.main import app  # noqa: E402
from app.security import GoogleIdentity, verify_google_credential  # noqa: E402

# Credentials the fake verifier accepts: "good:<sub>" signs in as <sub>.
def _fake_verify(credential: str) -> GoogleIdentity:
    kind, _, sub = credential.partition(":")
    if kind != "good" or not sub:
        raise HTTPException(status_code=401, detail="Invalid Google credential")
    return GoogleIdentity(
        sub=sub, email=f"{sub}@example.com", name=sub.title(), picture=None
    )


@pytest.fixture
def db_factory() -> Iterator[sessionmaker[Session]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # SQLite ignores foreign keys (and so ON DELETE CASCADE) unless asked.
    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _record):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, expire_on_commit=False)
    engine.dispose()


@pytest.fixture
def client(db_factory: sessionmaker[Session]) -> Iterator[TestClient]:
    def _get_db() -> Iterator[Session]:
        with db_factory() as db:
            yield db

    # Fresh counters per test: limits live in memory on the app.
    app.state.limits = Limits.from_settings(get_settings())
    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[verify_google_credential] = lambda: _fake_verify
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
