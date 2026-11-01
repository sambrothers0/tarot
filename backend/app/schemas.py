import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class GoogleLogin(BaseModel):
    # The ID token (JWT) Google Identity Services hands the page.
    credential: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str | None
    picture_url: str | None
    created_at: datetime


class LoginOut(BaseModel):
    token: str
    expires_at: datetime
    user: UserOut
