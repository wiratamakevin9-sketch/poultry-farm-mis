import uuid
from collections import defaultdict
from datetime import UTC, date, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.deps import DbSession, OwnerUser
from app.models import ChickenHouse, DailyRecord, Flock, User
from app.records import lock_record_writes, next_change_seq, record_out
from app.schemas import OwnerRecordOut

router = APIRouter(prefix="/api/records", tags=["records"])


def _start_of_day_birds(db: DbSession, flock_ids: set[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Live birds at the start of each record's day, keyed by record id."""
    result: dict[uuid.UUID, int] = {}
    for flock_id in flock_ids:
        flock = db.get(Flock, flock_id)
        alive = flock.initial_bird_count
        records = db.scalars(
            select(DailyRecord)
            .where(DailyRecord.flock_id == flock_id, DailyRecord.deleted_at.is_(None))
            .order_by(DailyRecord.record_date)
        )
        for record in records:
            result[record.id] = alive
            alive -= record.dead + record.culled
    return result


@router.get("")
def list_records(
    db: DbSession,
    _: OwnerUser,
    house_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[OwnerRecordOut]:
    query = select(DailyRecord).where(DailyRecord.deleted_at.is_(None))
    if house_id is not None:
        query = query.where(DailyRecord.house_id == house_id)
    if date_from is not None:
        query = query.where(DailyRecord.record_date >= date_from)
    if date_to is not None:
        query = query.where(DailyRecord.record_date <= date_to)
    records = list(db.scalars(query.order_by(DailyRecord.record_date.desc())))

    birds = _start_of_day_birds(db, {r.flock_id for r in records})
    names: dict[uuid.UUID, str] = defaultdict(str)
    names.update({u.id: u.full_name for u in db.scalars(select(User))})
    houses = {h.id: h.name for h in db.scalars(select(ChickenHouse))}

    out = []
    for record in records:
        alive = birds[record.id]
        eggs = record.eggs_good + record.eggs_cracked + record.eggs_rejected + record.eggs_dirty
        out.append(
            OwnerRecordOut(
                **record_out(record).model_dump(),
                house_name=houses[record.house_id],
                created_by_name=names[record.created_by],
                updated_by_name=names[record.updated_by],
                live_birds=alive,
                hdp=round(eggs / alive * 100, 2) if alive else 0.0,
                feed_per_bird_g=round(float(record.feed_kg) * 1000 / alive, 1) if alive else 0.0,
            )
        )
    return out


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_record(record_id: uuid.UUID, db: DbSession, _: OwnerUser) -> None:
    lock_record_writes(db)
    record = db.get(DailyRecord, record_id)
    if record is None or record.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Catatan tidak ditemukan.")
    # Soft delete: the row stays for audit; devices learn about it through pull.
    record.deleted_at = datetime.now(UTC)
    record.version += 1
    record.change_seq = next_change_seq(db)
    record.server_updated_at = datetime.now(UTC)
    db.commit()
