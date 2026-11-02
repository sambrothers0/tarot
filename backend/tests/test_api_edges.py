"""Edge cases around the auth routes that test_auth.py's happy paths skip."""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.models import Session, User
from tests.test_auth import auth, count, sign_in


def test_raw_tokens_are_never_stored(client: TestClient, db_factory) -> None:
    token = sign_in(client)["token"]
    with db_factory() as db:
        stored = db.scalars(select(Session.token_hash)).all()
    assert token not in stored
    assert len(stored) == 1 and len(stored[0]) == 64


def test_profile_is_refreshed_on_every_sign_in(client: TestClient, db_factory) -> None:
    sign_in(client)
    with db_factory() as db:
        db.execute(update(User).values(email="old@example.com", name="Old"))
        db.commit()
    body = sign_in(client)
    assert body["user"]["email"] == "alice@example.com"
    assert body["user"]["name"] == "Alice"


def test_sign_in_sweeps_everyone_s_expired_sessions(client: TestClient, db_factory) -> None:
    sign_in(client, "bob")
    with db_factory() as db:
        db.execute(
            update(Session).values(expires_at=datetime.now(timezone.utc) - timedelta(days=1))
        )
        db.commit()
    sign_in(client, "alice")
    assert count(db_factory, Session) == 1


def test_session_expiry_is_ttl_days_out(client: TestClient) -> None:
    body = sign_in(client)
    expires = datetime.fromisoformat(body["expires_at"].replace("Z", "+00:00"))
    delta = expires - datetime.now(timezone.utc)
    assert timedelta(days=29, hours=23) < delta <= timedelta(days=30)


def test_malformed_requests(client: TestClient) -> None:
    assert client.post("/auth/google", json={}).status_code == 422
    assert client.post("/auth/google", content="not json").status_code == 422
    assert client.post("/auth/logout").status_code == 401
    assert client.get("/me", headers={"Authorization": "Basic abc"}).status_code == 401
    assert client.get("/me", headers={"Authorization": "Bearer"}).status_code == 401
    assert client.delete("/me").status_code == 401


def test_401s_ask_for_a_bearer_token(client: TestClient) -> None:
    res = client.get("/me", headers=auth("nope"))
    assert res.status_code == 401
    assert res.headers["www-authenticate"] == "Bearer"
    assert res.json() == {"detail": "Session not found"}


def test_user_payload_exposes_no_internal_fields(client: TestClient) -> None:
    body = sign_in(client)
    assert set(body["user"]) == {"id", "email", "name", "picture_url", "created_at"}
    me = client.get("/me", headers=auth(body["token"])).json()
    assert "google_sub" not in me


def test_cors_ignores_unknown_origins(client: TestClient) -> None:
    res = client.get("/health", headers={"Origin": "https://evil.example"})
    assert res.status_code == 200
    assert "access-control-allow-origin" not in res.headers

    preflight = client.options(
        "/me",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "DELETE",
        },
    )
    assert "access-control-allow-origin" not in preflight.headers


def test_cors_never_allows_credentials(client: TestClient) -> None:
    res = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert res.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "access-control-allow-credentials" not in res.headers


def test_cors_rejects_unlisted_methods(client: TestClient) -> None:
    res = client.options(
        "/me",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "PUT",
        },
    )
    assert res.status_code == 400
