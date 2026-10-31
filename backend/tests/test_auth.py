from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session as DbSession, sessionmaker

from app.models import Session, User


def sign_in(client: TestClient, sub: str = "alice") -> dict:
    res = client.post("/auth/google", json={"credential": f"good:{sub}"})
    assert res.status_code == 200, res.text
    return res.json()


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def count(factory: sessionmaker[DbSession], model) -> int:
    with factory() as db:
        return db.scalar(select(func.count()).select_from(model))


def test_healthz(client: TestClient) -> None:
    assert client.get("/healthz").json() == {"status": "ok"}


def test_first_sign_in_creates_account(client: TestClient, db_factory) -> None:
    body = sign_in(client)
    assert body["user"]["email"] == "alice@example.com"
    assert body["token"]
    assert count(db_factory, User) == 1

    me = client.get("/me", headers=auth(body["token"]))
    assert me.status_code == 200
    assert me.json()["id"] == body["user"]["id"]


def test_second_sign_in_reuses_account(client: TestClient, db_factory) -> None:
    first = sign_in(client)
    with db_factory() as db:
        before = db.scalar(select(User.last_login_at))
    second = sign_in(client)

    assert second["user"]["id"] == first["user"]["id"]
    assert second["token"] != first["token"]
    assert count(db_factory, User) == 1
    assert count(db_factory, Session) == 2
    with db_factory() as db:
        assert db.scalar(select(User.last_login_at)) > before


def test_bad_credential_is_rejected(client: TestClient, db_factory) -> None:
    res = client.post("/auth/google", json={"credential": "forged"})
    assert res.status_code == 401
    assert count(db_factory, User) == 0


def test_me_requires_a_valid_token(client: TestClient) -> None:
    assert client.get("/me").status_code == 401
    assert client.get("/me", headers=auth("nope")).status_code == 401


def test_expired_session_is_rejected(client: TestClient, db_factory) -> None:
    token = sign_in(client)["token"]
    with db_factory() as db:
        db.execute(
            update(Session).values(
                expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)
            )
        )
        db.commit()
    assert client.get("/me", headers=auth(token)).status_code == 401
    assert count(db_factory, Session) == 0


def test_logout_revokes_only_that_session(client: TestClient) -> None:
    a = sign_in(client)["token"]
    b = sign_in(client)["token"]

    assert client.post("/auth/logout", headers=auth(a)).status_code == 204
    assert client.get("/me", headers=auth(a)).status_code == 401
    assert client.get("/me", headers=auth(b)).status_code == 200


def test_delete_account(client: TestClient, db_factory) -> None:
    token = sign_in(client)["token"]
    sign_in(client)  # a second session that must go too
    other = sign_in(client, "bob")["token"]

    assert client.delete("/me", headers=auth(token)).status_code == 204
    assert client.get("/me", headers=auth(token)).status_code == 401
    assert count(db_factory, User) == 1
    assert count(db_factory, Session) == 1
    assert client.get("/me", headers=auth(other)).status_code == 200

    # Signing in again afterwards starts a fresh account.
    again = sign_in(client)
    assert again["user"]["email"] == "alice@example.com"
    assert count(db_factory, User) == 2


def test_cors_allows_configured_origin(client: TestClient) -> None:
    res = client.options(
        "/me",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "DELETE",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == "http://localhost:5173"
