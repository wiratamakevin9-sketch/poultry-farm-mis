import io
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Photo
from tests.conftest import auth_headers
from tests.test_sync import TODAY, house_id, new_record, push


def jpeg_bytes(width: int = 800, height: int = 600, gps: bool = False) -> bytes:
    image = Image.new("RGB", (width, height), (230, 220, 200))
    out = io.BytesIO()
    if gps:
        exif = Image.Exif()
        exif[0x8825] = {1: "S", 2: (8.0, 32.0, 0.0), 3: "E", 4: (115.0, 24.0, 0.0)}  # GPS
        exif[0x010F] = "PhoneMaker"
        image.save(out, format="JPEG", exif=exif)
    else:
        image.save(out, format="JPEG")
    return out.getvalue()


def upload(
    client: TestClient,
    headers: dict,
    house: str,
    photo_id: str | None = None,
    data: bytes | None = None,
    **fields,
):
    form = {
        "kind": "TRAY",
        "house_id": house,
        "record_date": TODAY.isoformat(),
        "tray_category": "CRACKED",
        "label_count": "27",
        "taken_at": datetime.now(UTC).isoformat(),
    } | fields
    return client.put(
        f"/api/photos/{photo_id or uuid.uuid4()}",
        headers=headers,
        data={k: v for k, v in form.items() if v is not None},
        files={"file": ("tray.jpg", data if data is not None else jpeg_bytes(), "image/jpeg")},
    )


def house_with_record(client: TestClient, headers: dict) -> str:
    house = house_id(client, headers)
    push(client, headers, new_record(house))
    return house


def test_upload_tray_photo(client: TestClient, worker_headers: dict, db: Session) -> None:
    house = house_with_record(client, worker_headers)
    response = upload(client, worker_headers, house)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["tray_category"] == "CRACKED"
    assert body["label_count"] == 27
    photo = db.get(Photo, uuid.UUID(body["id"]))
    assert (Path(settings.photo_dir) / photo.file_path).exists()


def test_same_photo_twice_is_stored_once(
    client: TestClient, worker_headers: dict, db: Session
) -> None:
    house = house_with_record(client, worker_headers)
    photo_id = str(uuid.uuid4())
    assert upload(client, worker_headers, house, photo_id).status_code == 201
    assert upload(client, worker_headers, house, photo_id).status_code == 200
    assert db.scalar(select(func.count()).select_from(Photo)) == 1


def test_photo_id_of_another_worker_is_refused(client: TestClient, worker_headers: dict) -> None:
    house = house_with_record(client, worker_headers)
    photo_id = str(uuid.uuid4())
    upload(client, worker_headers, house, photo_id)
    other = auth_headers(client, "pekerja2")
    assert upload(client, other, house, photo_id).status_code == 409


def test_photo_waits_for_its_record(client: TestClient, worker_headers: dict) -> None:
    house = house_id(client, worker_headers)  # no daily record yet
    response = upload(client, worker_headers, house)
    assert response.status_code == 409
    assert response.json()["detail"] == "Catatan untuk foto ini belum ada di server."


def test_gps_location_is_removed(client: TestClient, worker_headers: dict, db: Session) -> None:
    house = house_with_record(client, worker_headers)
    original = Image.open(io.BytesIO(jpeg_bytes(gps=True)))
    assert 0x8825 in original.getexif()  # the test photo really has GPS data

    body = upload(client, worker_headers, house, data=jpeg_bytes(gps=True)).json()
    stored = Path(settings.photo_dir) / db.get(Photo, uuid.UUID(body["id"])).file_path
    exif = Image.open(stored).getexif()
    assert 0x8825 not in exif
    assert 0x010F not in exif


def test_large_photo_is_scaled_down(client: TestClient, worker_headers: dict) -> None:
    house = house_with_record(client, worker_headers)
    body = upload(client, worker_headers, house, data=jpeg_bytes(4000, 3000)).json()
    assert max(body["width"], body["height"]) == settings.max_photo_side


def test_too_large_file_is_refused(client: TestClient, worker_headers: dict, monkeypatch) -> None:
    house = house_with_record(client, worker_headers)
    monkeypatch.setattr(settings, "max_photo_bytes", 1000)
    assert upload(client, worker_headers, house).status_code == 413


def test_non_image_is_refused(client: TestClient, worker_headers: dict) -> None:
    house = house_with_record(client, worker_headers)
    response = upload(client, worker_headers, house, data=b"not a photo at all")
    assert response.status_code == 422
    assert response.json()["detail"] == "File ini bukan foto yang valid."


def test_tray_photo_needs_category(client: TestClient, worker_headers: dict) -> None:
    house = house_with_record(client, worker_headers)
    assert upload(client, worker_headers, house, tray_category=None).status_code == 422


def test_owner_cannot_upload(client: TestClient, worker_headers: dict, owner_headers: dict) -> None:
    house = house_with_record(client, worker_headers)
    assert upload(client, owner_headers, house).status_code == 403


def test_who_can_see_a_photo(client: TestClient, worker_headers: dict, owner_headers: dict) -> None:
    house = house_with_record(client, worker_headers)
    photo_id = upload(client, worker_headers, house).json()["id"]
    url = f"/api/photos/{photo_id}/file"

    owner_view = client.get(url, headers=owner_headers)
    assert owner_view.status_code == 200
    assert owner_view.headers["content-type"] == "image/jpeg"
    assert client.get(url, headers=worker_headers).status_code == 200
    assert client.get(url, headers=auth_headers(client, "pekerja2")).status_code == 404
    assert client.get(url).status_code == 401


def test_owner_lists_photos_of_a_record(
    client: TestClient, worker_headers: dict, owner_headers: dict
) -> None:
    house = house_with_record(client, worker_headers)
    upload(client, worker_headers, house, tray_category="CRACKED")
    upload(client, worker_headers, house, tray_category="DIRTY", label_count="12")
    photos = client.get(
        f"/api/photos?house_id={house}&record_date={TODAY.isoformat()}", headers=owner_headers
    ).json()
    assert sorted(p["tray_category"] for p in photos) == ["CRACKED", "DIRTY"]
    assert client.get("/api/photos", headers=worker_headers).status_code == 403
