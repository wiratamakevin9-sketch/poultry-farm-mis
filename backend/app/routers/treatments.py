"""Treatments and egg withdrawal periods, recorded by the owner (ADR 0003)."""

import uuid
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import DbSession, OwnerUser
from app.farm_time import farm_today
from app.models import ChickenHouse, Treatment
from app.schemas import TreatmentCreate, TreatmentOut, TreatmentUpdate
from app.withdrawal import sellable_from, withheld_until

router = APIRouter(prefix="/api/treatments", tags=["treatments"])


def phase(treatment: Treatment, today: date) -> str:
    if today < treatment.start_date:
        return "PLANNED"
    if today <= treatment.end_date:
        return "GIVING"
    if today <= withheld_until(treatment):
        return "WITHDRAWAL"
    return "FINISHED"


def treatment_out(db: Session, treatment: Treatment) -> TreatmentOut:
    return TreatmentOut(
        id=treatment.id,
        house_id=treatment.house_id,
        house_name=db.get(ChickenHouse, treatment.house_id).name,
        medicine_name=treatment.medicine_name,
        dose=treatment.dose,
        start_date=treatment.start_date,
        end_date=treatment.end_date,
        withdrawal_days=treatment.withdrawal_days,
        notes=treatment.notes,
        sellable_from=sellable_from(treatment),
        phase=phase(treatment, farm_today()),
    )


def _check_dates(start: date, end: date) -> None:
    if end < start:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Tanggal selesai tidak boleh sebelum tanggal mulai.",
        )


def _get(db: Session, treatment_id: uuid.UUID) -> Treatment:
    treatment = db.get(Treatment, treatment_id)
    if treatment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pengobatan tidak ditemukan.")
    return treatment


@router.get("")
def list_treatments(
    db: DbSession, _: OwnerUser, house_id: uuid.UUID | None = None, recent_days: int = 60
) -> list[TreatmentOut]:
    """Treatments that are planned, ongoing, or ended in the last `recent_days` days."""
    since = farm_today() - timedelta(days=recent_days)
    query = select(Treatment).order_by(Treatment.start_date.desc())
    if house_id is not None:
        query = query.where(Treatment.house_id == house_id)
    items = [t for t in db.scalars(query) if withheld_until(t) >= since]
    return [treatment_out(db, t) for t in items]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_treatment(body: TreatmentCreate, db: DbSession, owner: OwnerUser) -> TreatmentOut:
    if db.get(ChickenHouse, body.house_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kandang tidak ditemukan.")
    _check_dates(body.start_date, body.end_date)
    treatment = Treatment(
        **body.model_dump(exclude={"medicine_name", "dose", "notes"}),
        medicine_name=body.medicine_name.strip(),
        dose=body.dose.strip(),
        notes=body.notes.strip(),
        created_by=owner.id,
    )
    db.add(treatment)
    db.commit()
    return treatment_out(db, treatment)


@router.patch("/{treatment_id}")
def update_treatment(
    treatment_id: uuid.UUID, body: TreatmentUpdate, db: DbSession, _: OwnerUser
) -> TreatmentOut:
    treatment = _get(db, treatment_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(treatment, field, value.strip() if isinstance(value, str) else value)
    _check_dates(treatment.start_date, treatment.end_date)
    db.commit()
    return treatment_out(db, treatment)


@router.delete("/{treatment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_treatment(treatment_id: uuid.UUID, db: DbSession, _: OwnerUser) -> None:
    db.delete(_get(db, treatment_id))
    db.commit()
