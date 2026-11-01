from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session as DbSession

from ..db import get_db
from ..models import User
from ..schemas import UserOut
from ..security import current_user

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserOut)
def read_me(user: Annotated[User, Depends(current_user)]) -> User:
    return user


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> Response:
    """Delete the account. Sessions (and anything else the user owns) go with
    it through ON DELETE CASCADE."""
    db.delete(user)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
