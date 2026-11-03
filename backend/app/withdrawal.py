"""Egg withdrawal periods after a treatment (ADR 0003)."""

import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Treatment


def withheld_until(treatment: Treatment) -> date:
    """Last day whose eggs are withheld."""
    return treatment.end_date + timedelta(days=treatment.withdrawal_days)


def sellable_from(treatment: Treatment) -> date:
    return withheld_until(treatment) + timedelta(days=1)


def withdrawal_until(db: Session, house_id: uuid.UUID, day: date) -> date | None:
    """If eggs laid in this house on this day are withheld, until when; else None."""
    treatments = db.scalars(
        select(Treatment).where(Treatment.house_id == house_id, Treatment.start_date <= day)
    )
    ends = [withheld_until(t) for t in treatments if withheld_until(t) >= day]
    return max(ends, default=None)


def withheld_days(db: Session) -> dict[uuid.UUID, list[tuple[date, date]]]:
    """Per house, the (first, last) day ranges whose eggs are withheld."""
    ranges: dict[uuid.UUID, list[tuple[date, date]]] = {}
    for t in db.scalars(select(Treatment)):
        ranges.setdefault(t.house_id, []).append((t.start_date, withheld_until(t)))
    return ranges


def is_withheld(ranges: dict[uuid.UUID, list[tuple[date, date]]], house_id, day: date) -> bool:
    return any(first <= day <= last for first, last in ranges.get(house_id, []))
