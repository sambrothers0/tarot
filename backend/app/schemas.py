import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import Base64Bytes, BaseModel, ConfigDict, Field, field_validator


class GoogleLogin(BaseModel):
    # The ID token (JWT) Google Identity Services hands the page. Real ones
    # are ~1 KB; the cap keeps junk from reaching the verifier.
    credential: str = Field(min_length=1, max_length=4096)


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


# Minecraft's world border sits at ±30 million blocks.
WorldCoord = Annotated[int, Field(ge=-30_000_000, le=30_000_000)]


class ScanIn(BaseModel):
    block_type: str = Field(min_length=1, max_length=255)
    dimension: Literal["overworld", "nether", "end"]
    source_kind: Literal["zip", "folder"]
    source_name: str = Field(max_length=255)
    scanned_at: datetime
    count: int = Field(ge=0, le=2**62)
    truncated: bool
    preview: list[tuple[WorldCoord, WorldCoord]] = Field(max_length=64)
    # Packed and compressed in the browser; base64 so the whole save is one
    # JSON request. Opaque here: only its size is checked.
    coords: Base64Bytes


class ScanRename(BaseModel):
    # Blank clears it, falling back to the block's name.
    name: str | None = Field(default=None, max_length=100)


class ScanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str | None
    block_type: str
    dimension: str
    source_kind: str
    source_name: str
    scanned_at: datetime
    count: int
    truncated: bool
    preview: list[tuple[int, int]]

    @field_validator("scanned_at")
    @classmethod
    def _assume_utc(cls, value: datetime) -> datetime:
        # SQLite drops the offset; stored values are UTC.
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
