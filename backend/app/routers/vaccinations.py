"""Vaccination schedules (ADR 0003): planned by the owner, confirmed by a worker."""

import uuid
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import DbSession, OwnerUser, WorkerUser
from app.farm_time import farm_today
from app.models import ChickenHouse, User, VaccinationSchedule
from app.schemas import (
    PushResponse,
    PushResult,
    VaccinationConfirmation,
    VaccinationConfirmPush,
    VaccinationCreate,
    VaccinationOut,
    VaccinationUpdate,
)

router = APIRouter(tags=["vaccinations"])


def vaccination_status(item: VaccinationSchedule, today: date) -> str:
    if item.done_at is not None:
        return "DONE"
    return "OVERDUE" if item.scheduled_date < today else "SCHEDULED"


def vaccination_out(db: Session, item: VaccinationSchedule) -> VaccinationOut:
    done_by = db.get(User, item.done_by) if item.done_by else None
    return VaccinationOut(
        id=item.id,
        house_id=item.house_id,
        house_name=db.get(ChickenHouse, item.house_id).name,
        scheduled_date=item.scheduled_date,
        vaccine_name=item.vaccine_name,
        method=item.method,
        notes=item.notes,
        status=vaccination_status(item, farm_today()),
        done_at=item.done_at,
        done_by_name=done_by.full_name if done_by else None,
        done_note=item.done_note,
    )


def _get(db: Session, vaccination_id: uuid.UUID) -> VaccinationSchedule:
    item = db.get(VaccinationSchedule, vaccination_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Jadwal vaksinasi tidak ditemukan.")
    return item


@router.get("/api/vaccinations")
def list_vaccinations(
    db: DbSession,
    _: OwnerUser,
    date_from: date | None = None,
    date_to: date | None = None,
    house_id: uuid.UUID | None = None,
) -> list[VaccinationOut]:
    query = select(VaccinationSchedule).order_by(
        VaccinationSchedule.scheduled_date, VaccinationSchedule.created_at
    )
    if date_from is not None:
        query = query.where(VaccinationSchedule.scheduled_date >= date_from)
    if date_to is not None:
        query = query.where(VaccinationSchedule.scheduled_date <= date_to)
    if house_id is not None:
        query = query.where(VaccinationSchedule.house_id == house_id)
    return [vaccination_out(db, item) for item in db.scalars(query)]


@router.post("/api/vaccinations", status_code=status.HTTP_201_CREATED)
def create_vaccination(body: VaccinationCreate, db: DbSession, owner: OwnerUser) -> VaccinationOut:
    house = db.get(ChickenHouse, body.house_id)
    if house is None or not house.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kandang tidak ditemukan atau nonaktif.")
    item = VaccinationSchedule(
        house_id=body.house_id,
        scheduled_date=body.scheduled_date,
        vaccine_name=body.vaccine_name.strip(),
        method=body.method,
        notes=body.notes.strip(),
        created_by=owner.id,
    )
    db.add(item)
    db.commit()
    return vaccination_out(db, item)


@router.patch("/api/vaccinations/{vaccination_id}")
def update_vaccination(
    vaccination_id: uuid.UUID, body: VaccinationUpdate, db: DbSession, _: OwnerUser
) -> VaccinationOut:
    item = _get(db, vaccination_id)
    changes = body.model_dump(exclude_unset=True)
    if item.done_at is not None and {"scheduled_date", "vaccine_name", "method"} & set(changes):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Vaksinasi yang sudah dilakukan tidak bisa diubah."
        )
    for field, value in changes.items():
        setattr(item, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    return vaccination_out(db, item)


@router.delete("/api/vaccinations/{vaccination_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vaccination(vaccination_id: uuid.UUID, db: DbSession, _: OwnerUser) -> None:
    item = _get(db, vaccination_id)
    if item.done_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Vaksinasi yang sudah dilakukan tidak bisa dihapus."
        )
    db.delete(item)
    db.commit()


# ---------- workers ----------


def worker_vaccinations(db: Session) -> list[VaccinationOut]:
    """From a week ago (to catch missed ones) until tomorrow, for the phone."""
    today = farm_today()
    items = db.scalars(
        select(VaccinationSchedule)
        .where(
            VaccinationSchedule.scheduled_date >= today - timedelta(days=7),
            VaccinationSchedule.scheduled_date <= today + timedelta(days=1),
        )
        .order_by(VaccinationSchedule.scheduled_date)
    )
    return [vaccination_out(db, item) for item in items]


def _confirm_one(db: Session, raw: dict, user) -> PushResult:
    raw_id = str(raw.get("schedule_id", ""))
    try:
        confirmation = VaccinationConfirmation.model_validate(raw)
    except ValidationError:
        return PushResult(id=raw_id, status="rejected", errors={"_": "Data tidak valid."})
    item = db.get(VaccinationSchedule, confirmation.schedule_id)
    if item is None:
        return PushResult(
            id=raw_id, status="rejected", errors={"_": "Jadwal ini sudah dihapus pemilik."}
        )
    if item.done_at is not None:
        # Already confirmed (this phone sent it twice, or another worker did it first).
        return PushResult(id=raw_id, status="accepted")
    if confirmation.confirmed_at > datetime.now(UTC) + timedelta(minutes=5):
        return PushResult(
            id=raw_id,
            status="rejected",
            errors={"_": "Waktu konfirmasi tidak boleh di masa depan."},
        )
    item.done_at = confirmation.confirmed_at
    item.done_by = user.id
    item.done_note = confirmation.note.strip()
    return PushResult(id=raw_id, status="accepted")


@router.post("/api/sync/vaccinations")
def push_confirmations(
    body: VaccinationConfirmPush, db: DbSession, user: WorkerUser
) -> PushResponse:
    results = [_confirm_one(db, raw, user) for raw in body.confirmations]
    db.commit()
    return PushResponse(results=results)
