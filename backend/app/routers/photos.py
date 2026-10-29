import uuid
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.config import settings
from app.deps import CurrentUser, DbSession, OwnerUser, WorkerUser
from app.models import ChickenHouse, Photo, PhotoKind, Role, TrayCategory
from app.photo_files import InvalidImage, clean_image, full_path, remove, store
from app.records import active_record_for
from app.schemas import PhotoOut

router = APIRouter(prefix="/api/photos", tags=["photos"])


def parent_ready(
    db: DbSession,
    kind: PhotoKind,
    house_id: uuid.UUID,
    record_date: date | None,
    observation_id: uuid.UUID | None,
) -> bool:
    """A photo is accepted only after the record it belongs to has reached the server."""
    if kind == PhotoKind.TRAY:
        return record_date is not None and active_record_for(db, house_id, record_date) is not None
    return False  # health observations (UC14) are not on the server yet


@router.put("/{photo_id}")
async def upload_photo(
    photo_id: uuid.UUID,
    db: DbSession,
    user: WorkerUser,
    response: Response,
    file: Annotated[UploadFile, File()],
    kind: Annotated[PhotoKind, Form()],
    house_id: Annotated[uuid.UUID, Form()],
    taken_at: Annotated[datetime, Form()],
    record_date: Annotated[date | None, Form()] = None,
    tray_category: Annotated[TrayCategory | None, Form()] = None,
    label_count: Annotated[int | None, Form(ge=0)] = None,
    observation_id: Annotated[uuid.UUID | None, Form()] = None,
) -> PhotoOut:
    """Upload a photo by its phone-made id. Sending it again is harmless."""
    existing = db.get(Photo, photo_id)
    if existing is not None:
        if existing.uploaded_by != user.id:
            raise HTTPException(status.HTTP_409_CONFLICT, "ID foto sudah dipakai.")
        response.status_code = status.HTTP_200_OK
        return PhotoOut.model_validate(existing)

    if kind == PhotoKind.TRAY and (record_date is None or tray_category is None):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Foto tray butuh tanggal dan jenis tray."
        )
    if kind == PhotoKind.HEALTH and observation_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Foto kesehatan butuh laporan.")
    if db.get(ChickenHouse, house_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kandang tidak ditemukan.")
    if not parent_ready(db, kind, house_id, record_date, observation_id):
        # The phone sends records before photos; this only happens if the record was
        # rejected or is still waiting. The phone keeps the photo and tries again later.
        raise HTTPException(status.HTTP_409_CONFLICT, "Catatan untuk foto ini belum ada di server.")

    data = await file.read(settings.max_photo_bytes + 1)
    if len(data) > settings.max_photo_bytes:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"Foto terlalu besar (maksimal {settings.max_photo_bytes // (1024 * 1024)} MB).",
        )
    try:
        jpeg, width, height = clean_image(data)
    except InvalidImage as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None

    relative = store(photo_id, jpeg)
    photo = Photo(
        id=photo_id,
        kind=kind,
        house_id=house_id,
        record_date=record_date if kind == PhotoKind.TRAY else None,
        tray_category=tray_category if kind == PhotoKind.TRAY else None,
        label_count=label_count if kind == PhotoKind.TRAY else None,
        observation_id=observation_id if kind == PhotoKind.HEALTH else None,
        file_path=relative,
        size_bytes=len(jpeg),
        width=width,
        height=height,
        taken_at=taken_at,
        uploaded_by=user.id,
    )
    db.add(photo)
    try:
        db.commit()
    except Exception:
        db.rollback()
        remove(relative)  # never leave a file without its database row
        raise
    response.status_code = status.HTTP_201_CREATED
    return PhotoOut.model_validate(photo)


@router.get("")
def list_photos(
    db: DbSession,
    _: OwnerUser,
    house_id: uuid.UUID | None = None,
    record_date: date | None = None,
    observation_id: uuid.UUID | None = None,
) -> list[PhotoOut]:
    query = select(Photo).order_by(Photo.taken_at)
    if house_id is not None:
        query = query.where(Photo.house_id == house_id)
    if record_date is not None:
        query = query.where(Photo.record_date == record_date)
    if observation_id is not None:
        query = query.where(Photo.observation_id == observation_id)
    return [PhotoOut.model_validate(p) for p in db.scalars(query)]


@router.get("/{photo_id}/file")
def photo_file(photo_id: uuid.UUID, db: DbSession, user: CurrentUser) -> FileResponse:
    photo = db.get(Photo, photo_id)
    if photo is None or (user.role != Role.OWNER and photo.uploaded_by != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Foto tidak ditemukan.")
    path = full_path(photo.file_path)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File foto hilang dari server.")
    return FileResponse(
        path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"}
    )
