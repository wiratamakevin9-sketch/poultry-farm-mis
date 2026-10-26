import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.deps import CurrentUser, DbSession, OwnerUser
from app.models import ChickenHouse, Flock
from app.routers.houses import flock_with_birds
from app.schemas import FlockCreate, FlockUpdate, FlockWithBirds

router = APIRouter(prefix="/api/flocks", tags=["flocks"])


def _commit_one_active(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Kandang ini sudah memiliki flock aktif."
        ) from None


@router.get("")
def list_flocks(
    db: DbSession, _: CurrentUser, house_id: uuid.UUID | None = None
) -> list[FlockWithBirds]:
    query = select(Flock).order_by(Flock.placement_date.desc())
    if house_id is not None:
        query = query.where(Flock.house_id == house_id)
    return [flock_with_birds(db, f) for f in db.scalars(query)]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_flock(body: FlockCreate, db: DbSession, _: OwnerUser) -> FlockWithBirds:
    house = db.get(ChickenHouse, body.house_id)
    if house is None or not house.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kandang tidak ditemukan atau nonaktif.")
    flock = Flock(**body.model_dump())
    flock.breed = flock.breed.strip()
    db.add(flock)
    _commit_one_active(db)
    return flock_with_birds(db, flock)


@router.patch("/{flock_id}")
def update_flock(
    flock_id: uuid.UUID, body: FlockUpdate, db: DbSession, _: OwnerUser
) -> FlockWithBirds:
    flock = db.get(Flock, flock_id)
    if flock is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flock tidak ditemukan.")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(flock, field, value.strip() if isinstance(value, str) else value)
    _commit_one_active(db)
    return flock_with_birds(db, flock)
