"""Egg stock, computed from its history (ADR 0003).

    stock = production (daily records) - sales - disposals + adjustments

Eggs from a house in a withdrawal period count as WITHHELD instead of their grade.
Nothing is stored as a running total, so every number can be explained.
"""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    DailyRecord,
    EggDisposal,
    EggGrade,
    EggSale,
    FeedPurchase,
    StockAdjustment,
    StockItem,
)
from app.withdrawal import is_withheld, withheld_days

GRADE_ITEMS = {
    EggGrade.GOOD: StockItem.EGG_GOOD,
    EggGrade.CRACKED: StockItem.EGG_CRACKED,
    EggGrade.DIRTY: StockItem.EGG_DIRTY,
    EggGrade.WITHHELD: StockItem.EGG_WITHHELD,
}
SELLABLE = (EggGrade.GOOD, EggGrade.CRACKED, EggGrade.DIRTY)


def egg_production(db: Session) -> dict[EggGrade, int]:
    ranges = withheld_days(db)
    totals: dict[EggGrade, int] = defaultdict(int)
    rows = db.execute(
        select(
            DailyRecord.house_id,
            DailyRecord.record_date,
            DailyRecord.eggs_good,
            DailyRecord.eggs_cracked,
            DailyRecord.eggs_dirty,
        ).where(DailyRecord.deleted_at.is_(None))
    )
    for house_id, day, good, cracked, dirty in rows:
        if is_withheld(ranges, house_id, day):
            totals[EggGrade.WITHHELD] += good + cracked + dirty
        else:
            totals[EggGrade.GOOD] += good
            totals[EggGrade.CRACKED] += cracked
            totals[EggGrade.DIRTY] += dirty
    return totals


def eggs_out(db: Session) -> dict[EggGrade, int]:
    """Eggs that left the stock: sales and disposals."""
    out: dict[EggGrade, int] = defaultdict(int)
    for grade, quantity in db.execute(
        select(EggDisposal.grade, func.sum(EggDisposal.quantity)).group_by(EggDisposal.grade)
    ):
        out[grade] += int(quantity)
    for grade, quantity in sold_by_grade(db).items():
        out[grade] += quantity
    return out


def sold_by_grade(db: Session) -> dict[EggGrade, int]:
    rows = db.execute(select(EggSale.grade, func.sum(EggSale.quantity)).group_by(EggSale.grade))
    return {grade: int(quantity) for grade, quantity in rows}


def adjustments(db: Session, item: StockItem) -> Decimal:
    total = db.scalar(
        select(func.coalesce(func.sum(StockAdjustment.delta), 0)).where(
            StockAdjustment.item == item
        )
    )
    return Decimal(total)


def egg_stock(db: Session) -> dict[EggGrade, int]:
    produced = egg_production(db)
    out = eggs_out(db)
    return {
        grade: produced[grade] - out[grade] + int(adjustments(db, GRADE_ITEMS[grade]))
        for grade in EggGrade
    }


# ---------- feed ----------

FEED_RATE_DAYS = 7  # the recent rate is the average of the last 7 days


def feed_stock_kg(db: Session) -> Decimal:
    bought = db.scalar(select(func.coalesce(func.sum(FeedPurchase.quantity_kg), 0)))
    used = db.scalar(
        select(func.coalesce(func.sum(DailyRecord.feed_kg), 0)).where(
            DailyRecord.deleted_at.is_(None)
        )
    )
    return Decimal(bought) - Decimal(used) + adjustments(db, StockItem.FEED)


def recent_feed_per_day(db: Session, today: date) -> Decimal:
    first = today - timedelta(days=FEED_RATE_DAYS - 1)
    used = db.scalar(
        select(func.coalesce(func.sum(DailyRecord.feed_kg), 0)).where(
            DailyRecord.deleted_at.is_(None),
            DailyRecord.record_date >= first,
            DailyRecord.record_date <= today,
        )
    )
    return Decimal(used) / FEED_RATE_DAYS
