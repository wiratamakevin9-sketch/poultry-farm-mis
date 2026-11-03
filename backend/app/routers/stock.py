"""Egg stock for the owner (ADR 0003). Feed stock is added later."""

from datetime import timedelta
from decimal import Decimal

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.config import settings
from app.deps import DbSession, OwnerUser
from app.farm_time import farm_today
from app.models import EggDisposal, EggGrade, StockAdjustment, User
from app.schemas import (
    EggCountIn,
    EggDisposalIn,
    EggStockLine,
    EggStockOut,
    StockMovement,
)
from app.stock import GRADE_ITEMS, SELLABLE, egg_stock

router = APIRouter(prefix="/api/stock", tags=["stock"])

GRADE_NAMES = {
    EggGrade.GOOD: "telur bagus",
    EggGrade.CRACKED: "telur retak",
    EggGrade.DIRTY: "telur kotor",
    EggGrade.WITHHELD: "telur ditahan",
}


def kg(eggs: int) -> float:
    return round(eggs * settings.egg_weight_g / 1000, 1)


@router.get("/eggs")
def get_egg_stock(db: DbSession, _: OwnerUser) -> EggStockOut:
    stock = egg_stock(db)
    return EggStockOut(
        lines=[
            EggStockLine(grade=g, eggs=stock[g], kg=kg(stock[g]), sellable=g in SELLABLE)
            for g in EggGrade
        ],
        egg_weight_g=settings.egg_weight_g,
    )


@router.post("/eggs/disposals", status_code=status.HTTP_201_CREATED)
def dispose_eggs(body: EggDisposalIn, db: DbSession, owner: OwnerUser) -> EggStockOut:
    if body.disposal_date > farm_today():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Tanggal tidak boleh di masa depan."
        )
    available = egg_stock(db)[body.grade]
    if body.quantity > available:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Stok {GRADE_NAMES[body.grade]} hanya {available} butir.",
        )
    db.add(
        EggDisposal(
            disposal_date=body.disposal_date,
            grade=body.grade,
            quantity=body.quantity,
            reason=body.reason.strip(),
            created_by=owner.id,
        )
    )
    db.commit()
    return get_egg_stock(db, owner)


@router.post("/eggs/count", status_code=status.HTTP_201_CREATED)
def count_eggs(body: EggCountIn, db: DbSession, owner: OwnerUser) -> EggStockOut:
    """Record a physical count; the stock becomes exactly what was counted."""
    delta = body.counted - egg_stock(db)[body.grade]
    if delta != 0:
        db.add(
            StockAdjustment(
                adjust_date=farm_today(),
                item=GRADE_ITEMS[body.grade],
                delta=Decimal(delta),
                counted=Decimal(body.counted),
                reason=body.reason.strip(),
                created_by=owner.id,
            )
        )
        db.commit()
    return get_egg_stock(db, owner)


@router.get("/movements")
def movements(db: DbSession, _: OwnerUser, days: int = 30) -> list[StockMovement]:
    """Disposals and counts of the last `days` days (production and sales are elsewhere)."""
    since = farm_today() - timedelta(days=days)
    names = {u.id: u.full_name for u in db.scalars(select(User))}
    items = [
        StockMovement(
            date=d.disposal_date,
            kind="DISPOSAL",
            item=GRADE_ITEMS[d.grade].value,
            quantity=Decimal(-d.quantity),
            note=d.reason,
            by=names.get(d.created_by, ""),
        )
        for d in db.scalars(select(EggDisposal).where(EggDisposal.disposal_date >= since))
    ] + [
        StockMovement(
            date=a.adjust_date,
            kind="COUNT",
            item=a.item.value,
            quantity=a.delta,
            note=a.reason,
            by=names.get(a.created_by, ""),
        )
        for a in db.scalars(select(StockAdjustment).where(StockAdjustment.adjust_date >= since))
    ]
    return sorted(items, key=lambda m: m.date, reverse=True)
