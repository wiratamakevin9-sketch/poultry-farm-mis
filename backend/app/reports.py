"""Weekly production indicators per house and for the whole farm (CLAUDE.md):

- HDP = eggs / live birds that day x 100, summed over the week's hen-days
- FCR = kg feed / kg eggs, with the average egg weight (settings.egg_weight_g)
- Mortality = dead birds / birds at the start of the week x 100

Weeks start on Monday (farm time). Only weeks with records appear.
"""

import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.birds import start_of_day_birds
from app.config import settings
from app.models import ChickenHouse, DailyRecord


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


@dataclass
class WeekTotals:
    days: set[date] = field(default_factory=set)
    eggs: int = 0
    hen_days: int = 0
    feed_kg: float = 0.0
    dead: int = 0
    culled: int = 0
    birds_start: int = 0
    first_day: date | None = None

    def add(self, day: date, eggs: int, birds: int, feed_kg: float, dead: int, culled: int):
        self.days.add(day)
        self.eggs += eggs
        self.hen_days += birds
        self.feed_kg += feed_kg
        self.dead += dead
        self.culled += culled
        if self.first_day is None or day < self.first_day:
            self.first_day = day
            self.birds_start = birds

    def metrics(self) -> dict:
        egg_kg = self.eggs * settings.egg_weight_g / 1000
        return {
            "days": len(self.days),
            "eggs": self.eggs,
            "hen_days": self.hen_days,
            "feed_kg": round(self.feed_kg, 1),
            "dead": self.dead,
            "culled": self.culled,
            "birds_start": self.birds_start,
            "hdp": round(self.eggs / self.hen_days * 100, 1) if self.hen_days else None,
            "fcr": round(self.feed_kg / egg_kg, 2) if egg_kg else None,
            "mortality_pct": (
                round(self.dead / self.birds_start * 100, 2) if self.birds_start else None
            ),
            "feed_per_bird_g": (
                round(self.feed_kg * 1000 / self.hen_days, 1) if self.hen_days else None
            ),
        }


def weekly_report(db: Session, today: date, weeks: int, house_id: uuid.UUID | None = None) -> dict:
    first = week_start(today) - timedelta(weeks=weeks - 1)
    query = select(DailyRecord).where(
        DailyRecord.deleted_at.is_(None),
        DailyRecord.record_date >= first,
        DailyRecord.record_date <= today,
    )
    if house_id is not None:
        query = query.where(DailyRecord.house_id == house_id)
    records = list(db.scalars(query))
    birds = start_of_day_birds(db, {r.flock_id for r in records})
    houses = {h.id: h.name for h in db.scalars(select(ChickenHouse))}

    per_house: dict[tuple[uuid.UUID, date], WeekTotals] = {}
    for r in records:
        key = (r.house_id, week_start(r.record_date))
        eggs = r.eggs_good + r.eggs_cracked + r.eggs_dirty + r.eggs_rejected
        per_house.setdefault(key, WeekTotals()).add(
            r.record_date, eggs, birds[r.id], float(r.feed_kg), r.dead, r.culled
        )

    # The farm is the sum of its houses; birds at the start of the week add up too.
    farm: dict[date, WeekTotals] = {}
    for (_, week), totals in per_house.items():
        f = farm.setdefault(week, WeekTotals())
        f.days |= totals.days
        f.eggs += totals.eggs
        f.hen_days += totals.hen_days
        f.feed_kg += totals.feed_kg
        f.dead += totals.dead
        f.culled += totals.culled
        f.birds_start += totals.birds_start

    rows = [
        {"house_id": h, "house_name": houses[h], "week_start": week, **t.metrics()}
        for (h, week), t in sorted(per_house.items(), key=lambda kv: (houses[kv[0][0]], kv[0][1]))
    ]
    farm_rows = [
        {"house_id": None, "house_name": "Semua kandang", "week_start": week, **t.metrics()}
        for week, t in sorted(farm.items())
    ]
    return {
        "weeks": [first + timedelta(weeks=i) for i in range(weeks)],
        "rows": rows,
        "farm": farm_rows,
        "egg_weight_g": settings.egg_weight_g,
    }
