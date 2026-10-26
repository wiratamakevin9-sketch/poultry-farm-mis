import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import DailyRecord, Flock


def live_birds(
    db: Session,
    flock: Flock,
    before: date | None = None,
    exclude_record_id: uuid.UUID | None = None,
) -> int:
    """Initial bird count minus all dead and culled birds.

    With `before`, only records before that date count, which gives the number of
    live birds at the start of that day.
    """
    query = select(func.coalesce(func.sum(DailyRecord.dead + DailyRecord.culled), 0)).where(
        DailyRecord.flock_id == flock.id, DailyRecord.deleted_at.is_(None)
    )
    if before is not None:
        query = query.where(DailyRecord.record_date < before)
    if exclude_record_id is not None:
        query = query.where(DailyRecord.id != exclude_record_id)
    return flock.initial_bird_count - int(db.scalar(query))
