"""The real Google verifier, with only Google's library call stubbed: the
route tests swap the whole verifier out, so this is where its own rules are
checked."""

import pytest
from fastapi import HTTPException

from app import security
from app.config import Settings
from app.security import hash_token, new_token, verify_google_credential


@pytest.fixture
def verify(monkeypatch):
    calls: list[tuple] = []
    claims: dict = {}

    def fake_verify(credential, transport, audience, clock_skew_in_seconds=0):
        calls.append((credential, audience, clock_skew_in_seconds))
        if credential == "bad":
            raise ValueError("Token expired")
        return dict(claims)

    monkeypatch.setattr(security.id_token, "verify_oauth2_token", fake_verify)
    settings = Settings(_env_file=None, database_url="sqlite://", google_client_id="my-client")  # type: ignore[call-arg]
    fn = verify_google_credential(settings)
    fn.claims = claims  # type: ignore[attr-defined]
    fn.calls = calls  # type: ignore[attr-defined]
    return fn


def test_accepts_a_verified_account(verify) -> None:
    verify.claims.update(
        sub="123", email="a@example.com", email_verified=True, name="A", picture="https://p"
    )
    identity = verify("good")
    assert identity == security.GoogleIdentity(
        sub="123", email="a@example.com", name="A", picture="https://p"
    )
    # Checked against *our* client ID, with a little clock-skew allowance.
    assert verify.calls == [("good", "my-client", 10)]


def test_name_and_picture_are_optional(verify) -> None:
    verify.claims.update(sub="1", email="a@example.com", email_verified=True)
    identity = verify("good")
    assert identity.name is None and identity.picture is None


def test_rejects_an_invalid_token_as_401(verify) -> None:
    with pytest.raises(HTTPException) as err:
        verify("bad")
    assert err.value.status_code == 401
    assert err.value.headers == {"WWW-Authenticate": "Bearer"}


@pytest.mark.parametrize("verified", [False, None])
def test_rejects_an_unverified_email(verify, verified) -> None:
    verify.claims.update(sub="1", email="a@example.com")
    if verified is not None:
        verify.claims["email_verified"] = verified
    with pytest.raises(HTTPException) as err:
        verify("good")
    assert err.value.status_code == 401
    assert "not verified" in err.value.detail


def test_tokens_are_random_and_hashed() -> None:
    a, b = new_token(), new_token()
    assert a != b and len(a) >= 40
    assert hash_token(a) == hash_token(a)
    assert hash_token(a) != hash_token(b)
    assert len(hash_token(a)) == 64 and a not in hash_token(a)
