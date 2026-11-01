from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from ..config import Settings, get_settings
from ..db import get_db
from ..models import Session, User
from ..schemas import GoogleLogin, LoginOut, UserOut
from ..security import (
    GoogleIdentity,
    current_session,
    hash_token,
    new_token,
    verify_google_credential,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/google", response_model=LoginOut)
def sign_in_with_google(
    body: GoogleLogin,
    verify: Annotated[Callable[[str], GoogleIdentity], Depends(verify_google_credential)],
    db: Annotated[DbSession, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> LoginOut:
    """Sign in, creating the account on first sign-in."""
    identity = verify(body.credential)
    now = datetime.now(timezone.utc)

    user = db.scalar(select(User).where(User.google_sub == identity.sub))
    if user is None:
        user = User(google_sub=identity.sub, created_at=now)
        db.add(user)
    # Refresh the profile every time: the user may have changed it at Google.
    user.email = identity.email
    user.name = identity.name
    user.picture_url = identity.picture
    user.last_login_at = now

    # Opportunistic sweep, so expired sessions never need a cron job.
    db.execute(delete(Session).where(Session.expires_at < now))

    token = new_token()
    expires_at = now + timedelta(days=settings.session_ttl_days)
    db.add(Session(user=user, token_hash=hash_token(token), created_at=now, expires_at=expires_at))
    db.commit()

    return LoginOut(token=token, expires_at=expires_at, user=UserOut.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    session: Annotated[Session, Depends(current_session)],
    db: Annotated[DbSession, Depends(get_db)],
) -> Response:
    db.delete(session)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
