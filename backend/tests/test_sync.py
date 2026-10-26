import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.farm_time import farm_today
from app.models import DailyRecord, SyncConflict
from tests.conftest import auth_headers

TODAY = farm_today()


def house_id(client: TestClient, headers: dict, index: int = 0) -> str:
    return client.get("/api/houses", headers=headers).json()[index]["id"]


def new_record(house: str, **changes) -> dict:
    record = {
        "id": str(uuid.uuid4()),
        "house_id": house,
        "record_date": TODAY.isoformat(),
        "eggs_good": 4200,
        "eggs_cracked": 30,
        "eggs_rejected": 12,
        "feed_kg": 560.5,
        "water_liters": None,
        "dead": 2,
        "culled": 1,
        "notes": "",
        "base_version": 0,
        "client_updated_at": datetime.now(UTC).isoformat(),
    }
    return record | changes


def push(client: TestClient, headers: dict, *records: dict) -> list[dict]:
    response = client.post("/api/sync/push", headers=headers, json={"records": list(records)})
    assert response.status_code == 200, response.text
    return response.json()["results"]


def count_records(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(DailyRecord))


# ---------- push ----------


def test_offline_create_is_accepted(client: TestClient, worker_headers: dict, db: Session) -> None:
    record = new_record(house_id(client, worker_headers))
    [result] = push(client, worker_headers, record)
    assert result == {
        "id": record["id"],
        "status": "accepted",
        "version": 1,
        "conflict_id": None,
        "errors": {},
    }
    assert count_records(db) == 1


def test_same_batch_twice_creates_no_duplicates(
    client: TestClient, worker_headers: dict, db: Session
) -> None:
    house = house_id(client, worker_headers)
    batch = [
        new_record(house),
        new_record(house, record_date=(TODAY - timedelta(days=1)).isoformat()),
    ]
    first = push(client, worker_headers, *batch)
    second = push(client, worker_headers, *batch)
    assert [r["status"] for r in first + second] == ["accepted"] * 4
    assert count_records(db) == 2


def test_sync_interrupted_halfway_then_retried(
    client: TestClient, worker_headers: dict, db: Session
) -> None:
    # The server saved the first record but the phone never got the answer,
    # so the phone sends the whole queue again.
    house = house_id(client, worker_headers)
    a = new_record(house)
    b = new_record(house, record_date=(TODAY - timedelta(days=1)).isoformat())
    push(client, worker_headers, a)
    results = push(client, worker_headers, a, b)
    assert [r["status"] for r in results] == ["accepted", "accepted"]
    assert count_records(db) == 2


def test_offline_edit_updates_and_bumps_version(
    client: TestClient, worker_headers: dict, db: Session
) -> None:
    record = new_record(house_id(client, worker_headers))
    push(client, worker_headers, record)
    edited = record | {"eggs_good": 4300, "base_version": 1}
    [result] = push(client, worker_headers, edited)
    assert result["status"] == "accepted"
    assert result["version"] == 2
    saved = db.get(DailyRecord, uuid.UUID(record["id"]))
    assert saved.eggs_good == 4300
    assert count_records(db) == 1


def test_same_record_edited_on_two_devices(
    client: TestClient, worker_headers: dict, db: Session
) -> None:
    other_headers = auth_headers(client, "pekerja2")
    record = new_record(house_id(client, worker_headers))
    push(client, worker_headers, record)  # both phones now have version 1

    [a] = push(client, worker_headers, record | {"eggs_good": 4100, "base_version": 1})
    assert a["status"] == "accepted"
    device_b = record | {"eggs_good": 4150, "base_version": 1}
    [b] = push(client, other_headers, device_b)
    assert b["status"] == "conflict"

    saved = db.get(DailyRecord, uuid.UUID(record["id"]))
    assert saved.eggs_good == 4100  # server copy was not overwritten
    conflict = db.get(SyncConflict, uuid.UUID(b["conflict_id"]))
    assert conflict.reason == "VERSION"
    assert conflict.device_payload["eggs_good"] == 4150  # device copy is kept

    # Phone B retries: still one conflict, not two.
    [again] = push(client, other_headers, device_b)
    assert again["conflict_id"] == b["conflict_id"]
    assert db.scalar(select(func.count()).select_from(SyncConflict)) == 1


def test_two_records_for_same_house_and_day(
    client: TestClient, worker_headers: dict, db: Session
) -> None:
    other_headers = auth_headers(client, "pekerja2")
    house = house_id(client, worker_headers)
    first = new_record(house)
    second = new_record(house, eggs_good=4000)
    push(client, worker_headers, first)
    [result] = push(client, other_headers, second)
    assert result["status"] == "conflict"
    conflict = db.get(SyncConflict, uuid.UUID(result["conflict_id"]))
    assert conflict.reason == "DUPLICATE_DAY"
    assert str(conflict.record_id) == first["id"]
    assert count_records(db) == 1


def test_invalid_record_is_rejected_without_blocking_others(
    client: TestClient, worker_headers: dict, db: Session
) -> None:
    house = house_id(client, worker_headers)
    bad = new_record(house, feed_kg=5000)
    good = new_record(house, record_date=(TODAY - timedelta(days=1)).isoformat())
    results = push(client, worker_headers, bad, good)
    assert results[0]["status"] == "rejected"
    assert results[0]["errors"]["feed_kg"] == "Pakan maksimal 1.000 kg (0,2 kg × 5.000 ekor)."
    assert results[1]["status"] == "accepted"
    assert count_records(db) == 1


def test_malformed_record_is_rejected(client: TestClient, worker_headers: dict) -> None:
    house = house_id(client, worker_headers)
    [result] = push(client, worker_headers, new_record(house, eggs_good="banyak"))
    assert result["status"] == "rejected"
    assert result["errors"] == {"eggs_good": "Isian tidak valid."}


def test_future_date_rejected(client: TestClient, worker_headers: dict) -> None:
    house = house_id(client, worker_headers)
    tomorrow = (TODAY + timedelta(days=1)).isoformat()
    [result] = push(client, worker_headers, new_record(house, record_date=tomorrow))
    assert result["errors"]["record_date"] == "Tanggal tidak boleh di masa depan."


def test_owner_cannot_push(client: TestClient, owner_headers: dict) -> None:
    house = house_id(client, owner_headers)
    response = client.post(
        "/api/sync/push", headers=owner_headers, json={"records": [new_record(house)]}
    )
    assert response.status_code == 403


def test_house_without_active_flock_rejected(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    house = client.post(
        "/api/houses", headers=owner_headers, json={"name": "Kandang 5", "capacity": 100}
    ).json()
    [result] = push(client, worker_headers, new_record(house["id"]))
    assert result["status"] == "rejected"
    assert "house_id" in result["errors"]


def test_live_birds_go_down_after_dead_and_culled(client: TestClient, worker_headers: dict) -> None:
    house = house_id(client, worker_headers)
    yesterday = (TODAY - timedelta(days=1)).isoformat()
    push(client, worker_headers, new_record(house, record_date=yesterday, dead=4, culled=1))
    houses = client.get("/api/houses", headers=worker_headers).json()
    assert houses[0]["active_flock"]["live_birds"] == 4995


# ---------- pull ----------


def test_pull_returns_changes_since_cursor(client: TestClient, worker_headers: dict) -> None:
    record = new_record(house_id(client, worker_headers))
    push(client, worker_headers, record)

    first = client.get("/api/sync/pull", headers=worker_headers).json()
    assert [r["id"] for r in first["records"]] == [record["id"]]
    assert len(first["houses"]) == 4
    assert first["server_today"] == TODAY.isoformat()

    cursor = first["cursor"]
    nothing = client.get(f"/api/sync/pull?since={cursor}", headers=worker_headers).json()
    assert nothing["records"] == []
    assert nothing["cursor"] == cursor

    push(client, worker_headers, record | {"eggs_good": 4000, "base_version": 1})
    changed = client.get(f"/api/sync/pull?since={cursor}", headers=worker_headers).json()
    assert [(r["id"], r["version"]) for r in changed["records"]] == [(record["id"], 2)]


def test_pull_shows_deleted_records_and_blocks_edits(
    client: TestClient, worker_headers: dict, owner_headers: dict
) -> None:
    record = new_record(house_id(client, worker_headers))
    push(client, worker_headers, record)
    assert client.delete(f"/api/records/{record['id']}", headers=owner_headers).status_code == 204

    pulled = client.get("/api/sync/pull", headers=worker_headers).json()
    assert pulled["records"][0]["deleted"] is True

    [result] = push(client, worker_headers, record | {"eggs_good": 1, "base_version": 1})
    assert result["status"] == "rejected"


def test_pull_includes_my_open_conflicts_only(client: TestClient, worker_headers: dict) -> None:
    other_headers = auth_headers(client, "pekerja2")
    house = house_id(client, worker_headers)
    push(client, worker_headers, new_record(house))
    push(client, other_headers, new_record(house))

    mine = client.get("/api/sync/pull", headers=worker_headers).json()["conflicts"]
    theirs = client.get("/api/sync/pull", headers=other_headers).json()["conflicts"]
    assert mine == []
    assert len(theirs) == 1
    assert theirs[0]["can_resolve"] is True


# ---------- owner records view ----------


def test_owner_records_have_hdp_and_feed_per_bird(
    client: TestClient, worker_headers: dict, owner_headers: dict
) -> None:
    house = house_id(client, worker_headers)
    yesterday = (TODAY - timedelta(days=1)).isoformat()
    push(
        client,
        worker_headers,
        new_record(
            house,
            record_date=yesterday,
            eggs_good=4000,
            eggs_cracked=0,
            eggs_rejected=0,
            feed_kg=550,
            dead=10,
            culled=0,
        ),
        new_record(house, eggs_good=3960, eggs_cracked=0, eggs_rejected=0, feed_kg=547.8),
    )
    rows = client.get("/api/records", headers=owner_headers).json()
    today_row, yesterday_row = rows
    assert yesterday_row["live_birds"] == 5000
    assert yesterday_row["hdp"] == 80.0
    assert yesterday_row["feed_per_bird_g"] == 110.0
    assert today_row["live_birds"] == 4990
    assert today_row["hdp"] == round(3960 / 4990 * 100, 2)
    assert today_row["created_by_name"] == "Pekerja Satu"


def test_worker_cannot_list_owner_records(client: TestClient, worker_headers: dict) -> None:
    assert client.get("/api/records", headers=worker_headers).status_code == 403


def test_new_record_older_than_yesterday_rejected(client: TestClient, worker_headers: dict) -> None:
    house = house_id(client, worker_headers)
    old = (TODAY - timedelta(days=2)).isoformat()
    [result] = push(client, worker_headers, new_record(house, record_date=old))
    assert result["status"] == "rejected"
    assert result["errors"]["record_date"] == (
        "Catatan hanya bisa diisi atau diubah untuk hari ini atau kemarin."
    )
