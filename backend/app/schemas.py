import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import Base64Bytes, BaseModel, ConfigDict, Field, field_validator, model_validator


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


# The most block types one scan can hold; the frontend's MAX_BLOCK_TYPES.
MAX_BLOCK_TYPES = 6
BlockIndex = Annotated[int, Field(ge=0, lt=MAX_BLOCK_TYPES)]


class BlockCount(BaseModel):
    """One block of a multi-block scan: what it was and how many there were."""

    block_type: str = Field(min_length=1, max_length=255)
    count: int = Field(ge=0, le=2**62)
    truncated: bool


class ScanIn(BaseModel):
    # The first block scanned for; `blocks` lists them all when there are more.
    block_type: str = Field(min_length=1, max_length=255)
    dimension: Literal["overworld", "nether", "end"]
    source_kind: Literal["zip", "folder"]
    source_name: str = Field(max_length=255)
    scanned_at: datetime
    count: int = Field(ge=0, le=2**62)
    truncated: bool
    blocks: list[BlockCount] | None = Field(default=None, min_length=2, max_length=MAX_BLOCK_TYPES)
    preview: list[
        tuple[WorldCoord, WorldCoord] | tuple[WorldCoord, WorldCoord, BlockIndex]
    ] = Field(max_length=64)
    # Packed and compressed in the browser; base64 so the whole save is one
    # JSON request. Opaque here: only its size is checked.
    coords: Base64Bytes

    @model_validator(mode="after")
    def _blocks_agree(self) -> "ScanIn":
        # The row's own columns stay a true summary of the blocks, so a reader
        # that knows nothing of `blocks` still sees the right first block and
        # the right total.
        if self.blocks is not None:
            names = [b.block_type for b in self.blocks]
            if len(set(names)) != len(names):
                raise ValueError("blocks must be distinct")
            if names[0] != self.block_type:
                raise ValueError("block_type must be the first of blocks")
            if sum(b.count for b in self.blocks) != self.count:
                raise ValueError("count must be the sum of the blocks' counts")
            if any(b.truncated for b in self.blocks) != self.truncated:
                raise ValueError("truncated must say whether any block was")
        layers = len(self.blocks) if self.blocks else 1
        if any(len(p) == 3 and p[2] >= layers for p in self.preview):
            raise ValueError("preview names a block the scan doesn't have")
        return self


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
    blocks: list[BlockCount] | None
    preview: list[tuple[int, int] | tuple[int, int, int]]

    @field_validator("scanned_at")
    @classmethod
    def _assume_utc(cls, value: datetime) -> datetime:
        # SQLite drops the offset; stored values are UTC.
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
