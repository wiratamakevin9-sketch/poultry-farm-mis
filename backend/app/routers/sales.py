"""Buyers and egg sales (ADR 0003): in kg at a price per kg, never more than in stock."""

import uuid
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.deps import DbSession, OwnerUser
from app.farm_time import farm_today
from app.models import Buyer, EggSale
from app.routers.stock import GRADE_NAMES
from app.schemas import BuyerIn, BuyerOut, BuyerUpdate, SaleIn, SaleOut
from app.stock import egg_stock

router = APIRouter(tags=["sales"])


# ---------- buyers ----------


def _commit_unique_name(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Nama pembeli sudah ada.") from None


@router.get("/api/buyers")
def list_buyers(db: DbSession, _: OwnerUser) -> list[BuyerOut]:
    return [BuyerOut.model_validate(b) for b in db.scalars(select(Buyer).order_by(Buyer.name))]


@router.post("/api/buyers", status_code=status.HTTP_201_CREATED)
def create_buyer(body: BuyerIn, db: DbSession, _: OwnerUser) -> BuyerOut:
    buyer = Buyer(name=body.name.strip(), phone=body.phone.strip(), notes=body.notes.strip())
    db.add(buyer)
    _commit_unique_name(db)
    return BuyerOut.model_validate(buyer)


@router.patch("/api/buyers/{buyer_id}")
def update_buyer(buyer_id: uuid.UUID, body: BuyerUpdate, db: DbSession, _: OwnerUser) -> BuyerOut:
    buyer = db.get(Buyer, buyer_id)
    if buyer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pembeli tidak ditemukan.")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(buyer, field, value.strip() if isinstance(value, str) else value)
    _commit_unique_name(db)
    return BuyerOut.model_validate(buyer)


# ---------- sales ----------


def sale_out(db: Session, sale: EggSale) -> SaleOut:
    return SaleOut(
        id=sale.id,
        sale_date=sale.sale_date,
        buyer_id=sale.buyer_id,
        buyer_name=db.get(Buyer, sale.buyer_id).name,
        grade=sale.grade,
        quantity=sale.quantity,
        quantity_estimated=sale.quantity_estimated,
        weight_kg=sale.weight_kg,
        price_per_kg=sale.price_per_kg,
        total=sale.total,
        notes=sale.notes,
    )


@router.get("/api/sales")
def list_sales(
    db: DbSession,
    _: OwnerUser,
    date_from: date | None = None,
    date_to: date | None = None,
    buyer_id: uuid.UUID | None = None,
) -> list[SaleOut]:
    query = select(EggSale).order_by(EggSale.sale_date.desc(), EggSale.created_at.desc())
    if date_from is not None:
        query = query.where(EggSale.sale_date >= date_from)
    if date_to is not None:
        query = query.where(EggSale.sale_date <= date_to)
    if buyer_id is not None:
        query = query.where(EggSale.buyer_id == buyer_id)
    return [sale_out(db, s) for s in db.scalars(query)]


@router.post("/api/sales", status_code=status.HTTP_201_CREATED)
def create_sale(body: SaleIn, db: DbSession, owner: OwnerUser) -> SaleOut:
    if body.sale_date > farm_today():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Tanggal tidak boleh di masa depan."
        )
    buyer = db.get(Buyer, body.buyer_id)
    if buyer is None or not buyer.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pembeli tidak ditemukan atau nonaktif.")

    estimated = body.quantity is None
    quantity = body.quantity or max(1, round(body.weight_kg * 1000 / settings.egg_weight_g))
    available = egg_stock(db)[body.grade]
    if quantity > available:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Stok {GRADE_NAMES[body.grade]} hanya {available} butir.",
        )
    sale = EggSale(
        sale_date=body.sale_date,
        buyer_id=buyer.id,
        grade=body.grade,
        quantity=quantity,
        quantity_estimated=estimated,
        weight_kg=body.weight_kg,
        price_per_kg=body.price_per_kg,
        total=(body.weight_kg * body.price_per_kg).quantize(Decimal(1), ROUND_HALF_UP),
        notes=body.notes.strip(),
        created_by=owner.id,
    )
    db.add(sale)
    db.commit()
    return sale_out(db, sale)


@router.delete("/api/sales/{sale_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sale(sale_id: uuid.UUID, db: DbSession, _: OwnerUser) -> None:
    """For correcting a mistake; the eggs go back into the stock."""
    sale = db.get(EggSale, sale_id)
    if sale is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Penjualan tidak ditemukan.")
    db.delete(sale)
    db.commit()
