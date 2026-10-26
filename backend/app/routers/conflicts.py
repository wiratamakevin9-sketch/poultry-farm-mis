import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import CurrentUser, DbSession
from app.farm_time import farm_today
from app.models import (
    ChickenHouse,
    ConflictResolution,
    ConflictStatus,
    DailyRecord,
    Role,
    SyncConflict,
    User,
)
from app.records import (
    apply_values,
    live_birds_on,
    lock_record_writes,
    record_out,
    touch,
)
from app.schemas import ConflictOut, RecordIn, RecordValues, ResolveRequest
from app.validation import validate_record

router = APIRouter(prefix="/api/conflicts", tags=["conflicts"])


def can_resolve(conflict: SyncConflict, user: User) -> bool:
    """Workers resolve their own conflicts inside the edit window; the owner after it."""
    if conflict.status != ConflictStatus.OPEN:
        return False
    window_open = conflict.record_date >= farm_today() - timedelta(days=1)
    if user.role == Role.OWNER:
        return not window_open
    return window_open and conflict.submitted_by == user.id


def conflict_out(db: Session, conflict: SyncConflict, viewer: User) -> ConflictOut:
    record = db.get(DailyRecord, conflict.record_id)
    return ConflictOut(
        id=conflict.id,
        record_id=conflict.record_id,
        device_record_id=conflict.device_record_id,
        house_id=conflict.house_id,
        house_name=db.get(ChickenHouse, conflict.house_id).name,
        record_date=conflict.record_date,
        reason=conflict.reason,
        status=conflict.status,
        resolution=conflict.resolution,
        device_payload=conflict.device_payload,
        server_record=record_out(record),
        submitted_by=conflict.submitted_by,
        submitted_by_name=db.get(User, conflict.submitted_by).full_name,
        created_at=conflict.created_at,
        can_resolve=can_resolve(conflict, viewer),
    )


def open_conflicts(db: Session, user: User) -> list[ConflictOut]:
    query = select(SyncConflict).where(SyncConflict.status == ConflictStatus.OPEN)
    if user.role == Role.WORKER:
        query = query.where(SyncConflict.submitted_by == user.id)
    conflicts = db.scalars(query.order_by(SyncConflict.record_date, SyncConflict.created_at))
    return [conflict_out(db, c, user) for c in conflicts]


@router.get("")
def list_conflicts(db: DbSession, user: CurrentUser) -> list[ConflictOut]:
    return open_conflicts(db, user)


@router.post("/{conflict_id}/resolve")
def resolve_conflict(
    conflict_id: uuid.UUID, body: ResolveRequest, db: DbSession, user: CurrentUser
) -> ConflictOut:
    lock_record_writes(db)
    conflict = db.get(SyncConflict, conflict_id)
    if conflict is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Konflik tidak ditemukan.")
    if not can_resolve(conflict, user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Anda tidak bisa menyelesaikan konflik ini sekarang."
        )
    record = db.get(DailyRecord, conflict.record_id)
    if record.version != body.server_version or record.deleted_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Data di server sudah berubah. Muat ulang lalu bandingkan lagi.",
        )

    if body.resolution == ConflictResolution.KEEP_SERVER:
        touch(db, record)  # devices pull the server copy again
    else:
        if body.resolution == ConflictResolution.TAKE_DEVICE:
            values = RecordValues.model_validate(conflict.device_payload)
        elif body.values is not None:
            values = body.values
        else:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Isi data gabungan.")
        candidate = RecordIn(
            id=record.id,
            house_id=record.house_id,
            record_date=record.record_date,
            client_updated_at=datetime.now(UTC),
            **values.model_dump(),
        )
        errors = validate_record(
            candidate,
            live_birds_on(db, record.flock_id, record.record_date),
            today=farm_today(),
            edited_on=farm_today(),
            check_window=False,  # who may resolve, and when, is checked by can_resolve
        )
        if errors:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, " ".join(errors.values()))
        apply_values(db, record, values, user.id)

    conflict.status = ConflictStatus.RESOLVED
    conflict.resolution = body.resolution
    conflict.resolved_by = user.id
    conflict.resolved_at = datetime.now(UTC)
    db.commit()
    return conflict_out(db, conflict, user)
