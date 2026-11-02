from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.farm_time import farm_today
from app.models import User, VaccinationSchedule
from tests.test_sync import house_id

TODAY = farm_today()


def schedule(client: TestClient, headers: dict, **changes) -> dict:
    body = {
        "house_id": house_id(client, headers),
        "scheduled_date": TODAY.isoformat(),
        "vaccine_name": "ND-IB",
        "method": "DRINKING_WATER",
        "notes": "Pagi hari sebelum pakan",
    } | changes
    response = client.post("/api/vaccinations", headers=headers, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def mark_done(db: Session, vaccination_id: str) -> None:
    item = db.scalar(select(VaccinationSchedule).where(VaccinationSchedule.id == vaccination_id))
    item.done_at = datetime.now(UTC)
    item.done_by = db.scalar(select(User.id).where(User.username == "pekerja1"))
    db.commit()


def test_owner_schedules_a_vaccination(client: TestClient, owner_headers: dict) -> None:
    item = schedule(client, owner_headers)
    assert item["status"] == "SCHEDULED"
    assert item["house_name"] == "Kandang 1"
    assert item["vaccine_name"] == "ND-IB"


def test_status_overdue_and_done(client: TestClient, owner_headers: dict, db: Session) -> None:
    past = schedule(client, owner_headers, scheduled_date=(TODAY - timedelta(days=2)).isoformat())
    assert past["status"] == "OVERDUE"
    mark_done(db, past["id"])
    [listed] = client.get("/api/vaccinations", headers=owner_headers).json()
    assert listed["status"] == "DONE"
    assert listed["done_by_name"] == "Pekerja Satu"


def test_list_filters_by_date(client: TestClient, owner_headers: dict) -> None:
    schedule(client, owner_headers)
    schedule(client, owner_headers, scheduled_date=(TODAY + timedelta(days=10)).isoformat())
    week = (TODAY + timedelta(days=7)).isoformat()
    items = client.get(
        f"/api/vaccinations?date_from={TODAY.isoformat()}&date_to={week}", headers=owner_headers
    ).json()
    assert len(items) == 1


def test_edit_and_delete_before_it_is_done(client: TestClient, owner_headers: dict) -> None:
    item = schedule(client, owner_headers)
    changed = client.patch(
        f"/api/vaccinations/{item['id']}", headers=owner_headers, json={"method": "EYE_DROP"}
    )
    assert changed.json()["method"] == "EYE_DROP"
    assert (
        client.delete(f"/api/vaccinations/{item['id']}", headers=owner_headers).status_code == 204
    )


def test_done_vaccination_cannot_be_moved_or_deleted(
    client: TestClient, owner_headers: dict, db: Session
) -> None:
    item = schedule(client, owner_headers)
    mark_done(db, item["id"])
    url = f"/api/vaccinations/{item['id']}"
    moved = client.patch(url, headers=owner_headers, json={"scheduled_date": "2026-12-01"})
    assert moved.status_code == 409
    assert client.delete(url, headers=owner_headers).status_code == 409
    # Notes can still be added afterwards.
    assert client.patch(url, headers=owner_headers, json={"notes": "OK"}).status_code == 200


def test_name_is_required(client: TestClient, owner_headers: dict) -> None:
    response = client.post(
        "/api/vaccinations",
        headers=owner_headers,
        json={
            "house_id": house_id(client, owner_headers),
            "scheduled_date": TODAY.isoformat(),
            "vaccine_name": "",
            "method": "SPRAY",
        },
    )
    assert response.status_code == 422


def test_workers_cannot_manage_schedules(client: TestClient, worker_headers: dict) -> None:
    assert client.get("/api/vaccinations", headers=worker_headers).status_code == 403
    response = client.post(
        "/api/vaccinations",
        headers=worker_headers,
        json={
            "house_id": house_id(client, worker_headers),
            "scheduled_date": TODAY.isoformat(),
            "vaccine_name": "ND",
            "method": "SPRAY",
        },
    )
    assert response.status_code == 403
