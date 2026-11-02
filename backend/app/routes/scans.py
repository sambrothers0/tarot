import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session as DbSession

from ..config import Settings, get_settings
from ..db import get_db
from ..models import SavedScan, User
from ..schemas import ScanIn, ScanOut, ScanRename
from ..security import current_user

router = APIRouter(prefix="/scans", tags=["scans"])


@router.get("", response_model=list[ScanOut])
def list_scans(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> list[SavedScan]:
    """Every saved scan, newest scan first. Metadata and preview only: the
    coordinates column is deferred and never loaded here."""
    return list(
        db.scalars(
            select(SavedScan)
            .where(SavedScan.user_id == user.id)
            .order_by(SavedScan.scanned_at.desc(), SavedScan.created_at.desc())
        )
    )


@router.post("", response_model=ScanOut, status_code=status.HTTP_201_CREATED)
def save_scan(
    body: ScanIn,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[DbSession, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SavedScan:
    size = len(body.coords)
    if size > settings.max_scan_bytes:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE, "This reading is too large to keep."
        )

    # Quotas, from the small size column rather than the blobs themselves.
    scans, used = db.execute(
        select(func.count(), func.coalesce(func.sum(SavedScan.coords_bytes), 0)).where(
            SavedScan.user_id == user.id
        )
    ).one()
    if scans >= settings.max_scans_per_user:
        raise HTTPException(
            status.HTTP_507_INSUFFICIENT_STORAGE,
            f"You can keep up to {settings.max_scans_per_user} readings. Delete one to keep another.",
        )
    if used + size > settings.max_scan_bytes_per_user:
        raise HTTPException(
            status.HTTP_507_INSUFFICIENT_STORAGE,
            "Your readings are at their storage limit. Delete one to keep another.",
        )
    total = db.scalar(select(func.coalesce(func.sum(SavedScan.coords_bytes), 0)))
    if total + size > settings.max_scan_bytes_total:
        raise HTTPException(
            status.HTTP_507_INSUFFICIENT_STORAGE,
            "Readings are full right now. Try again later.",
        )

    scan = SavedScan(
        user_id=user.id,
        block_type=body.block_type,
        dimension=body.dimension,
        source_kind=body.source_kind,
        source_name=body.source_name,
        scanned_at=body.scanned_at,
        count=body.count,
        truncated=body.truncated,
        preview=[list(p) for p in body.preview],
        coords=body.coords,
        coords_bytes=size,
    )
    db.add(scan)
    db.commit()
    return scan


@router.get("/{scan_id}/coords")
def read_coords(
    scan_id: uuid.UUID,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> Response:
    """The packed coordinates, exactly as the browser sent them."""
    coords = db.scalar(
        select(SavedScan.coords).where(SavedScan.id == scan_id, SavedScan.user_id == user.id)
    )
    if coords is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reading not found")
    # A saved scan never changes, so the browser may keep it: reopening a map
    # costs no egress (Cloud Run's free tier allows 1 GB a month).
    return Response(
        content=coords,
        media_type="application/octet-stream",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.patch("/{scan_id}", response_model=ScanOut)
def rename_scan(
    scan_id: uuid.UUID,
    body: ScanRename,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> SavedScan:
    scan = db.scalar(
        select(SavedScan).where(SavedScan.id == scan_id, SavedScan.user_id == user.id)
    )
    if scan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reading not found")
    scan.name = (body.name or "").strip() or None
    db.commit()
    return scan


@router.delete("/{scan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_scan(
    scan_id: uuid.UUID,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> Response:
    # A bulk delete, so the blob is never loaded just to be thrown away.
    result = db.execute(
        delete(SavedScan).where(SavedScan.id == scan_id, SavedScan.user_id == user.id)
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reading not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
