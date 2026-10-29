"""UC14: health observations with photos. Workers report; the owner forwards to the vet."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.birds import live_birds
from app.deps import DbSession, OwnerUser, WorkerUser
from app.models import (
    ChickenHouse,
    HealthObservation,
    ObservationStatus,
    Photo,
    User,
)
from app.routers.houses import active_flock
from app.schemas import (
    ForwardRequest,
    ObservationIn,
    ObservationOut,
    ObservationPush,
    ObservationSummary,
    ObservationUpdate,
    OwnerObservationOut,
    PushResponse,
    PushResult,
)
from app.validation import validate_observation

router = APIRouter(tags=["health"])

# How far back a phone keeps the worker's own observations (to show their status).
WORKER_HISTORY_DAYS = 60


def worker_observations(db: Session, user: User) -> list[ObservationOut]:
    since = datetime.now(UTC) - timedelta(days=WORKER_HISTORY_DAYS)
    rows = db.scalars(
        select(HealthObservation)
        .where(HealthObservation.created_by == user.id, HealthObservation.observed_at >= since)
        .order_by(HealthObservation.observed_at.desc())
    )
    return [ObservationOut.model_validate(o) for o in rows]


def _push_one(db: Session, raw: dict, user: User) -> PushResult:
    raw_id = str(raw.get("id", ""))
    try:
        incoming = ObservationIn.model_validate(raw)
    except ValidationError as exc:
        fields = {str(err["loc"][0]) for err in exc.errors() if err["loc"]}
        return PushResult(
            id=raw_id,
            status="rejected",
            errors={field: "Isian tidak valid." for field in fields} or {"_": "Data tidak valid."},
        )

    existing = db.get(HealthObservation, incoming.id)
    if existing is not None:
        # Observations cannot be edited, so the same id means the phone sent it again.
        if existing.created_by != user.id:
            return PushResult(
                id=raw_id, status="rejected", errors={"_": "ID laporan sudah dipakai."}
            )
        return PushResult(id=raw_id, status="accepted")

    house = db.get(ChickenHouse, incoming.house_id)
    if house is None:
        return PushResult(
            id=raw_id, status="rejected", errors={"house_id": "Kandang tidak ditemukan."}
        )
    flock = active_flock(db, house.id)
    errors = validate_observation(
        incoming, live_birds(db, flock) if flock else None, datetime.now(UTC)
    )
    if errors:
        return PushResult(id=raw_id, status="rejected", errors=errors)

    db.add(
        HealthObservation(
            id=incoming.id,
            house_id=incoming.house_id,
            observed_at=incoming.observed_at,
            symptoms=incoming.symptoms,
            other_symptoms=incoming.other_symptoms.strip(),
            affected_count=incoming.affected_count,
            notes=incoming.notes.strip(),
            created_by=user.id,
        )
    )
    db.flush()
    return PushResult(id=raw_id, status="accepted")


@router.post("/api/sync/observations")
def push_observations(body: ObservationPush, db: DbSession, user: WorkerUser) -> PushResponse:
    results = []
    for raw in body.observations:
        with db.begin_nested() as savepoint:
            result = _push_one(db, raw, user)
            if result.status == "rejected":
                savepoint.rollback()
        results.append(result)
    db.commit()
    return PushResponse(results=results)


# ---------- owner ----------


def owner_out(db: Session, observation: HealthObservation) -> OwnerObservationOut:
    photo_ids = db.scalars(
        select(Photo.id).where(Photo.observation_id == observation.id).order_by(Photo.taken_at)
    )
    return OwnerObservationOut(
        **ObservationOut.model_validate(observation).model_dump(),
        house_name=db.get(ChickenHouse, observation.house_id).name,
        created_by_name=db.get(User, observation.created_by).full_name,
        photo_ids=list(photo_ids),
    )


def _get(db: Session, observation_id: uuid.UUID) -> HealthObservation:
    observation = db.get(HealthObservation, observation_id)
    if observation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Laporan tidak ditemukan.")
    return observation


@router.get("/api/health-observations")
def list_observations(
    db: DbSession,
    _: OwnerUser,
    status_filter: Annotated[ObservationStatus | None, Query(alias="status")] = None,
) -> list[OwnerObservationOut]:
    query = select(HealthObservation).order_by(HealthObservation.observed_at.desc())
    if status_filter is not None:
        query = query.where(HealthObservation.status == status_filter)
    return [owner_out(db, o) for o in db.scalars(query)]


@router.get("/api/health-observations/summary")
def summary(db: DbSession, _: OwnerUser) -> ObservationSummary:
    new_count = db.scalar(
        select(func.count())
        .select_from(HealthObservation)
        .where(HealthObservation.status == ObservationStatus.NEW)
    )
    return ObservationSummary(new_count=new_count)


@router.get("/api/health-observations/{observation_id}")
def get_observation(observation_id: uuid.UUID, db: DbSession, _: OwnerUser) -> OwnerObservationOut:
    observation = _get(db, observation_id)
    if observation.status == ObservationStatus.NEW:
        # Opening it is what "seen" means; the worker's phone shows this.
        observation.status = ObservationStatus.SEEN
        observation.seen_at = datetime.now(UTC)
        db.commit()
    return owner_out(db, observation)


@router.patch("/api/health-observations/{observation_id}")
def update_observation(
    observation_id: uuid.UUID, body: ObservationUpdate, db: DbSession, _: OwnerUser
) -> OwnerObservationOut:
    observation = _get(db, observation_id)
    if body.vet_advice is not None:
        observation.vet_advice = body.vet_advice.strip()
    if body.status == ObservationStatus.CLOSED:
        observation.status = ObservationStatus.CLOSED
        observation.closed_at = datetime.now(UTC)
    elif body.status == ObservationStatus.SEEN:  # reopen
        observation.status = (
            ObservationStatus.FORWARDED if observation.forwarded_at else ObservationStatus.SEEN
        )
        observation.closed_at = None
    db.commit()
    return owner_out(db, observation)


@router.post("/api/health-observations/{observation_id}/forward")
def mark_forwarded(
    observation_id: uuid.UUID, body: ForwardRequest, db: DbSession, _: OwnerUser
) -> OwnerObservationOut:
    """Record that the owner sent the PDF to the veterinarian."""
    observation = _get(db, observation_id)
    observation.forwarded_via = body.via
    observation.forwarded_at = datetime.now(UTC)
    observation.seen_at = observation.seen_at or observation.forwarded_at
    if observation.status != ObservationStatus.CLOSED:
        observation.status = ObservationStatus.FORWARDED
    db.commit()
    return owner_out(db, observation)
