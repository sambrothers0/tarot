import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .config import Settings, get_settings
from .db import get_db
from .models import Session, User

# One shared transport so the HTTP connection to Google's cert endpoint is
# reused across sign-ins.
_google_transport = google_requests.Request()


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    name: str | None
    picture: str | None


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def verify_google_credential(
    settings: Annotated[Settings, Depends(get_settings)],
):
    """Dependency returning a verifier, so tests can swap it out via
    `app.dependency_overrides` without patching Google's library."""

    def verify(credential: str) -> GoogleIdentity:
        try:
            # A little skew allowance: a just-issued token otherwise fails as
            # "used too early" if this host's clock trails Google's.
            claims = id_token.verify_oauth2_token(
                credential,
                _google_transport,
                settings.google_client_id,
                clock_skew_in_seconds=10,
            )
        except ValueError as exc:  # bad signature, wrong audience, expired, …
            raise _unauthorized("Invalid Google credential") from exc
        if not claims.get("email_verified"):
            raise _unauthorized("Google account email is not verified")
        return GoogleIdentity(
            sub=claims["sub"],
            email=claims["email"],
            name=claims.get("name"),
            picture=claims.get("picture"),
        )

    return verify


_bearer = HTTPBearer(auto_error=False)


def current_session(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[DbSession, Depends(get_db)],
) -> Session:
    if creds is None:
        raise _unauthorized("Not signed in")
    session = db.scalar(
        select(Session).where(Session.token_hash == hash_token(creds.credentials))
    )
    if session is None:
        raise _unauthorized("Session not found")
    expires_at = session.expires_at
    if expires_at.tzinfo is None:  # SQLite drops the offset; values are UTC
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        db.delete(session)
        db.commit()
        raise _unauthorized("Session expired")
    return session


def current_user(session: Annotated[Session, Depends(current_session)]) -> User:
    return session.user
