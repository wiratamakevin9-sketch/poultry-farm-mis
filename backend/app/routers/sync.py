from fastapi import APIRouter, Query
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import CurrentUser, DbSession, WorkerUser
from app.farm_time import farm_date, farm_today
from app.models import (
    ChickenHouse,
    ConflictReason,
    ConflictStatus,
    DailyRecord,
    SyncConflict,
    User,
)
from app.records import (
    active_record_for,
    apply_values,
    live_birds_on,
    lock_record_writes,
    next_change_seq,
    record_out,
    same_values,
    values_of,
)
from app.routers.conflicts import open_conflicts
from app.routers.houses import active_flock, house_out
from app.schemas import PullResponse, PushRequest, PushResponse, PushResult, RecordIn
from app.validation import validate_record

router = APIRouter(prefix="/api/sync", tags=["sync"])

PULL_PAGE_SIZE = 500


def _record_conflict(
    db: Session,
    incoming: RecordIn,
    server_record: DailyRecord,
    reason: ConflictReason,
    user: User,
) -> PushResult:
    """Keep the server copy and store the device copy for the worker to resolve."""
    payload = incoming.model_dump(mode="json")
    # Sending the same batch twice must not create a second conflict.
    conflict = db.scalar(
        select(SyncConflict).where(
            SyncConflict.device_record_id == incoming.id,
            SyncConflict.submitted_by == user.id,
            SyncConflict.status == ConflictStatus.OPEN,
        )
    )
    if conflict is None:
        conflict = SyncConflict(
            record_id=server_record.id,
            device_record_id=incoming.id,
            house_id=server_record.house_id,
            record_date=server_record.record_date,
            reason=reason,
            submitted_by=user.id,
        )
        db.add(conflict)
    conflict.device_payload = payload
    conflict.server_version = server_record.version
    db.flush()
    return PushResult(id=str(incoming.id), status="conflict", conflict_id=conflict.id)


def _push_one(db: Session, raw: dict, user: User) -> PushResult:
    raw_id = str(raw.get("id", ""))
    try:
        incoming = RecordIn.model_validate(raw)
    except ValidationError as exc:
        fields = {str(err["loc"][0]) for err in exc.errors() if err["loc"]}
        return PushResult(
            id=raw_id,
            status="rejected",
            errors={field: "Isian tidak valid." for field in fields} or {"_": "Data tidak valid."},
        )

    existing = db.get(DailyRecord, incoming.id)
    edited_on = farm_date(incoming.client_updated_at)

    if existing is not None:
        if existing.deleted_at is not None:
            return PushResult(
                id=raw_id,
                status="rejected",
                errors={"_": "Catatan ini sudah dihapus oleh pemilik."},
            )
        if same_values(existing, incoming):
            # Already applied (e.g. the response was lost and the phone sent it again).
            return PushResult(id=raw_id, status="accepted", version=existing.version)
        if incoming.base_version < existing.version:
            return _record_conflict(db, incoming, existing, ConflictReason.VERSION, user)
        if incoming.house_id != existing.house_id or incoming.record_date != existing.record_date:
            return PushResult(
                id=raw_id,
                status="rejected",
                errors={"_": "Kandang dan tanggal catatan tidak bisa diubah."},
            )
        errors = validate_record(
            incoming,
            live_birds_on(db, existing.flock_id, existing.record_date),
            today=farm_today(),
            edited_on=edited_on,
        )
        if errors:
            return PushResult(id=raw_id, status="rejected", errors=errors)
        apply_values(db, existing, incoming, user.id, incoming.client_updated_at)
        return PushResult(id=raw_id, status="accepted", version=existing.version)

    other = active_record_for(db, incoming.house_id, incoming.record_date)
    if other is not None:
        return _record_conflict(db, incoming, other, ConflictReason.DUPLICATE_DAY, user)

    house = db.get(ChickenHouse, incoming.house_id)
    flock = active_flock(db, incoming.house_id) if house and house.is_active else None
    if flock is None:
        return PushResult(
            id=raw_id,
            status="rejected",
            errors={"house_id": "Kandang ini tidak aktif atau belum punya flock aktif."},
        )
    errors = validate_record(
        incoming,
        live_birds_on(db, flock.id, incoming.record_date),
        today=farm_today(),
        edited_on=edited_on,
    )
    if errors:
        return PushResult(id=raw_id, status="rejected", errors=errors)

    record = DailyRecord(
        id=incoming.id,
        house_id=incoming.house_id,
        flock_id=flock.id,
        record_date=incoming.record_date,
        version=1,
        change_seq=next_change_seq(db),
        created_by=user.id,
        updated_by=user.id,
        client_updated_at=incoming.client_updated_at,
        **values_of(incoming),
    )
    db.add(record)
    db.flush()
    return PushResult(id=raw_id, status="accepted", version=1)


@router.post("/push")
def push(body: PushRequest, db: DbSession, user: WorkerUser) -> PushResponse:
    lock_record_writes(db)
    results = []
    for raw in body.records:
        # A savepoint per record: one failure never undoes the others.
        with db.begin_nested() as savepoint:
            result = _push_one(db, raw, user)
            if result.status == "rejected":
                savepoint.rollback()
        results.append(result)
    db.commit()
    return PushResponse(results=results)


@router.get("/pull")
def pull(db: DbSession, user: CurrentUser, since: int = Query(default=0, ge=0)) -> PullResponse:
    records = list(
        db.scalars(
            select(DailyRecord)
            .where(DailyRecord.change_seq > since)
            .order_by(DailyRecord.change_seq)
            .limit(PULL_PAGE_SIZE + 1)
        )
    )
    has_more = len(records) > PULL_PAGE_SIZE
    records = records[:PULL_PAGE_SIZE]
    houses = db.scalars(
        select(ChickenHouse).where(ChickenHouse.is_active).order_by(ChickenHouse.name)
    )
    return PullResponse(
        records=[record_out(r) for r in records],
        cursor=records[-1].change_seq if records else since,
        has_more=has_more,
        houses=[house_out(db, h) for h in houses],
        conflicts=open_conflicts(db, user),
        server_today=farm_today(),
    )
