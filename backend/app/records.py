"""Shared helpers for writing daily records (sync push, conflicts, owner delete)."""

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.birds import live_birds
from app.models import DailyRecord, Flock, change_seq
from app.schemas import RecordIn, RecordOut, RecordValues

VALUE_FIELDS = (
    "eggs_good",
    "eggs_cracked",
    "eggs_rejected",
    "eggs_dirty",
    "feed_kg",
    "water_liters",
    "dead",
    "culled",
    "notes",
)

# Any fixed number works; it only has to be the same everywhere records are written.
_RECORD_WRITE_LOCK = 4201


def lock_record_writes(db: Session) -> None:
    """Serialise record writes until the transaction ends.

    Pull uses change_seq as a cursor. If two transactions could commit out of order, a
    device could skip a record, so all record writes take this lock. Traffic is tiny
    (a few workers), so waiting is not a problem.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _RECORD_WRITE_LOCK})


def next_change_seq(db: Session) -> int:
    return db.scalar(change_seq.next_value())


def values_of(source: RecordIn | RecordValues | DailyRecord) -> dict:
    return {field: getattr(source, field) for field in VALUE_FIELDS}


def same_values(record: DailyRecord, incoming: RecordIn | RecordValues) -> bool:
    return values_of(record) == values_of(incoming)


def apply_values(
    db: Session,
    record: DailyRecord,
    values: RecordIn | RecordValues,
    user_id: uuid.UUID,
    client_updated_at: datetime | None = None,
) -> None:
    for field, value in values_of(values).items():
        setattr(record, field, value)
    record.version += 1
    record.change_seq = next_change_seq(db)
    record.updated_by = user_id
    record.client_updated_at = client_updated_at or datetime.now(UTC)
    record.server_updated_at = datetime.now(UTC)


def touch(db: Session, record: DailyRecord) -> None:
    """Give a record a new change_seq so devices pull it again."""
    record.change_seq = next_change_seq(db)
    record.server_updated_at = datetime.now(UTC)


def live_birds_on(db: Session, flock_id: uuid.UUID, day: date) -> int:
    flock = db.get(Flock, flock_id)
    return live_birds(db, flock, before=day)


def active_record_for(db: Session, house_id: uuid.UUID, day: date) -> DailyRecord | None:
    return db.scalar(
        select(DailyRecord).where(
            DailyRecord.house_id == house_id,
            DailyRecord.record_date == day,
            DailyRecord.deleted_at.is_(None),
        )
    )


def record_out(record: DailyRecord) -> RecordOut:
    out = RecordOut.model_validate(record)
    out.deleted = record.deleted_at is not None
    return out
