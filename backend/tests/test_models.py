import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import ChickenHouse, DailyRecord, Flock, User


def _house_and_flock(db: Session) -> tuple[ChickenHouse, Flock]:
    house = db.scalar(select(ChickenHouse).where(ChickenHouse.name == "Kandang 1"))
    flock = db.scalar(select(Flock).where(Flock.house_id == house.id))
    return house, flock


def _record(db: Session, record_date: date) -> DailyRecord:
    house, flock = _house_and_flock(db)
    worker = db.scalar(select(User).where(User.username == "pekerja1"))
    return DailyRecord(
        id=uuid.uuid4(),
        house_id=house.id,
        flock_id=flock.id,
        record_date=record_date,
        eggs_good=4000,
        eggs_cracked=10,
        eggs_rejected=5,
        feed_kg=550,
        dead=1,
        culled=0,
        created_by=worker.id,
        updated_by=worker.id,
        client_updated_at=datetime.now(UTC),
    )


def test_only_one_active_flock_per_house(db: Session) -> None:
    house, _ = _house_and_flock(db)
    db.add(Flock(house_id=house.id, breed="Lohmann", placement_date=date(2026, 5, 1),
                 initial_bird_count=100))
    with pytest.raises(IntegrityError):
        db.commit()


def test_one_record_per_house_per_day_except_deleted(db: Session) -> None:
    first = _record(db, date(2026, 10, 1))
    db.add(first)
    db.commit()

    db.add(_record(db, date(2026, 10, 1)))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()

    first.deleted_at = datetime.now(UTC)
    db.commit()
    db.add(_record(db, date(2026, 10, 1)))
    db.commit()


def test_change_seq_increases(db: Session) -> None:
    a = _record(db, date(2026, 10, 1))
    b = _record(db, date(2026, 10, 2))
    db.add(a)
    db.commit()
    db.add(b)
    db.commit()
    assert b.change_seq > a.change_seq
