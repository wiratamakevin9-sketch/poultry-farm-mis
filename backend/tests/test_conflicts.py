import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import DailyRecord, SyncConflict
from tests.conftest import auth_headers
from tests.test_sync import TODAY, house_id, new_record, push


def make_conflict(client: TestClient, days_ago: int = 0) -> tuple[dict, dict, dict]:
    """pekerja1 saves a record; pekerja2 sends a different one for the same house and day.

    With days_ago, both phones saved the record that day while offline and sync only now.

    Returns (conflict as seen by pekerja2, pekerja1 headers, pekerja2 headers).
    """
    first_headers = auth_headers(client, "pekerja1")
    second_headers = auth_headers(client, "pekerja2")
    house = house_id(client, first_headers)
    day = (TODAY - timedelta(days=days_ago)).isoformat()
    saved_at = (datetime.now(UTC) - timedelta(days=days_ago)).isoformat()
    for headers, eggs in ((first_headers, 4000), (second_headers, 4100)):
        record = new_record(house, record_date=day, eggs_good=eggs, client_updated_at=saved_at)
        [result] = push(client, headers, record)
        assert result["status"] in ("accepted", "conflict"), result
    [conflict] = client.get("/api/conflicts", headers=second_headers).json()
    return conflict, first_headers, second_headers


def resolve(client: TestClient, headers: dict, conflict: dict, resolution: str, **extra):
    body = {"resolution": resolution, "server_version": conflict["server_record"]["version"]}
    return client.post(
        f"/api/conflicts/{conflict['id']}/resolve", headers=headers, json=body | extra
    )


def test_worker_keeps_server_copy(client: TestClient, db: Session) -> None:
    conflict, _, mine = make_conflict(client)
    response = resolve(client, mine, conflict, "KEEP_SERVER")
    assert response.status_code == 200
    assert response.json()["status"] == "RESOLVED"
    record = db.get(DailyRecord, uuid.UUID(conflict["record_id"]))
    assert record.eggs_good == 4000
    assert client.get("/api/conflicts", headers=mine).json() == []


def test_worker_takes_device_copy(client: TestClient, db: Session) -> None:
    conflict, _, mine = make_conflict(client)
    response = resolve(client, mine, conflict, "TAKE_DEVICE")
    assert response.status_code == 200
    record = db.get(DailyRecord, uuid.UUID(conflict["record_id"]))
    assert record.eggs_good == 4100
    assert record.version == 2


def test_worker_merges_values(client: TestClient, db: Session) -> None:
    conflict, _, mine = make_conflict(client)
    values = {
        k: conflict["device_payload"][k]
        for k in ("eggs_good", "eggs_cracked", "eggs_rejected", "feed_kg", "dead", "culled")
    }
    response = resolve(client, mine, conflict, "MERGED", values=values | {"eggs_good": 4050})
    assert response.status_code == 200
    assert db.get(DailyRecord, uuid.UUID(conflict["record_id"])).eggs_good == 4050


def test_merged_values_are_validated(client: TestClient) -> None:
    conflict, _, mine = make_conflict(client)
    values = {
        k: conflict["device_payload"][k]
        for k in ("eggs_good", "eggs_cracked", "eggs_rejected", "feed_kg", "dead", "culled")
    }
    response = resolve(client, mine, conflict, "MERGED", values=values | {"feed_kg": 9999})
    assert response.status_code == 422
    assert "Pakan maksimal" in response.json()["detail"]


def test_device_copy_is_kept_after_resolution(client: TestClient, db: Session) -> None:
    conflict, _, mine = make_conflict(client)
    resolve(client, mine, conflict, "KEEP_SERVER")
    stored = db.get(SyncConflict, uuid.UUID(conflict["id"]))
    assert stored.device_payload["eggs_good"] == 4100
    assert stored.resolution == "KEEP_SERVER"


def test_other_worker_cannot_resolve(client: TestClient) -> None:
    conflict, other, _ = make_conflict(client)
    assert resolve(client, other, conflict, "KEEP_SERVER").status_code == 403


def test_owner_cannot_resolve_inside_edit_window(client: TestClient, owner_headers: dict) -> None:
    conflict, _, _ = make_conflict(client)
    assert resolve(client, owner_headers, conflict, "KEEP_SERVER").status_code == 403


def test_owner_resolves_after_edit_window(client: TestClient, owner_headers: dict) -> None:
    conflict, _, mine = make_conflict(client, days_ago=3)
    assert conflict["can_resolve"] is False  # too late for the worker
    assert resolve(client, mine, conflict, "TAKE_DEVICE").status_code == 403

    [seen_by_owner] = client.get("/api/conflicts", headers=owner_headers).json()
    assert seen_by_owner["can_resolve"] is True
    assert resolve(client, owner_headers, seen_by_owner, "TAKE_DEVICE").status_code == 200


def test_stale_server_version_is_refused(client: TestClient) -> None:
    conflict, first, mine = make_conflict(client)
    # pekerja1 edits the server record after the conflict was shown.
    record = client.get("/api/sync/pull", headers=first).json()["records"][0]
    edited = new_record(record["house_id"], id=record["id"], eggs_good=3990, base_version=1)
    push(client, first, edited)
    response = resolve(client, mine, conflict, "KEEP_SERVER")
    assert response.status_code == 409
