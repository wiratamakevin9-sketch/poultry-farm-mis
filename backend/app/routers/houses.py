import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.birds import live_birds
from app.deps import CurrentUser, DbSession, OwnerUser
from app.models import ChickenHouse, Flock
from app.schemas import FlockWithBirds, HouseCreate, HouseOut, HouseUpdate

router = APIRouter(prefix="/api/houses", tags=["houses"])


def active_flock(db: Session, house_id: uuid.UUID) -> Flock | None:
    return db.scalar(select(Flock).where(Flock.house_id == house_id, Flock.is_active))


def flock_with_birds(db: Session, flock: Flock) -> FlockWithBirds:
    return FlockWithBirds(
        id=flock.id,
        house_id=flock.house_id,
        breed=flock.breed,
        placement_date=flock.placement_date,
        initial_bird_count=flock.initial_bird_count,
        is_active=flock.is_active,
        live_birds=live_birds(db, flock),
    )


def house_out(db: Session, house: ChickenHouse) -> HouseOut:
    out = HouseOut.model_validate(house)
    flock = active_flock(db, house.id)
    if flock is not None:
        out.active_flock = flock_with_birds(db, flock)
    return out


def _get_house(db: Session, house_id: uuid.UUID) -> ChickenHouse:
    house = db.get(ChickenHouse, house_id)
    if house is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kandang tidak ditemukan.")
    return house


def _commit_unique_name(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Nama kandang sudah dipakai.") from None


@router.get("")
def list_houses(db: DbSession, _: CurrentUser) -> list[HouseOut]:
    houses = db.scalars(select(ChickenHouse).order_by(ChickenHouse.name))
    return [house_out(db, h) for h in houses]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_house(body: HouseCreate, db: DbSession, _: OwnerUser) -> HouseOut:
    house = ChickenHouse(name=body.name.strip(), capacity=body.capacity)
    db.add(house)
    _commit_unique_name(db)
    return house_out(db, house)


@router.patch("/{house_id}")
def update_house(house_id: uuid.UUID, body: HouseUpdate, db: DbSession, _: OwnerUser) -> HouseOut:
    house = _get_house(db, house_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("is_active") is False and active_flock(db, house.id) is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Nonaktifkan flock di kandang ini terlebih dahulu.",
        )
    for field, value in changes.items():
        setattr(house, field, value.strip() if isinstance(value, str) else value)
    _commit_unique_name(db)
    return house_out(db, house)
