import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, deferred, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # Google's stable account ID. Email can change; `sub` cannot.
    google_sub: Mapped[str] = mapped_column(String(255), unique=True)
    email: Mapped[str] = mapped_column(String(320))
    name: Mapped[str | None] = mapped_column(String(255))
    picture_url: Mapped[str | None] = mapped_column(String(2048))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    # passive_deletes: let the database's ON DELETE CASCADE do the work rather
    # than SQLAlchemy loading every child row first.
    sessions: Mapped[list["Session"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    scans: Mapped[list["SavedScan"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # SHA-256 hex of the bearer token. The token itself is never stored, so a
    # leaked database does not leak live sessions.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="sessions")


class SavedScan(Base):
    """A scan the user chose to keep: what was searched for, where, and the
    coordinates found. The coordinates arrive already packed and compressed by
    the browser (see frontend `lib/coordsCodec.ts`) and are stored as an opaque
    blob; the server never decodes them."""

    __tablename__ = "saved_scans"
    __table_args__ = (Index("ix_saved_scans_user_scanned", "user_id", "scanned_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # The person's own label; unset, the UI titles a scan by its block.
    name: Mapped[str | None] = mapped_column(String(100))
    block_type: Mapped[str] = mapped_column(String(255))
    dimension: Mapped[str] = mapped_column(String(16))
    source_kind: Mapped[str] = mapped_column(String(16))
    source_name: Mapped[str] = mapped_column(String(255))
    scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # The world's true total across every block scanned for; the blob holds
    # at most the frontend's MAX_MATCHES per block.
    count: Mapped[int] = mapped_column(BigInteger)
    truncated: Mapped[bool] = mapped_column(Boolean)
    # A scan of several blocks at once: [{block_type, count, truncated}] per
    # block, in the order they were scanned, `block_type` above being the
    # first. Null for a scan of one block, which `block_type`, `count` and
    # `truncated` already describe — and for every scan kept before this.
    blocks: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    # A few dozen [x, z] pairs, so the list can draw thumbnails without blobs;
    # [x, z, block] when the scan holds several blocks.
    preview: Mapped[list[list[int]]] = mapped_column(JSON)
    # Deferred: listing scans must never pull every blob off the database.
    coords: Mapped[bytes] = deferred(mapped_column(LargeBinary, nullable=False))
    # len(coords), kept alongside so quotas are a SUM over a small column.
    coords_bytes: Mapped[int] = mapped_column(Integer)

    user: Mapped[User] = relationship(back_populates="scans")
