from datetime import timedelta

from fastapi.testclient import TestClient

from app.farm_time import farm_today
from tests.test_sync import house_id

TODAY = farm_today()


def day(offset: int) -> str:
    return (TODAY + timedelta(days=offset)).isoformat()


def treat(client: TestClient, headers: dict, **changes):
    body = {
        "house_id": house_id(client, headers),
        "medicine_name": "Antibiotik X",
        "dose": "1 g per liter air minum",
        "start_date": day(-2),
        "end_date": day(2),
        "withdrawal_days": 7,
    } | changes
    return client.post("/api/treatments", headers=headers, json=body)


def test_owner_records_a_treatment(client: TestClient, owner_headers: dict) -> None:
    response = treat(client, owner_headers)
    assert response.status_code == 201, response.text
    body = response.json()
    # Eggs sellable again from end date + withdrawal days + 1.
    assert body["sellable_from"] == day(2 + 7 + 1)
    assert body["phase"] == "GIVING"
    assert body["house_name"] == "Kandang 1"


def test_phases(client: TestClient, owner_headers: dict) -> None:
    planned = treat(client, owner_headers, start_date=day(3), end_date=day(5)).json()
    withdrawal = treat(client, owner_headers, start_date=day(-5), end_date=day(-1)).json()
    finished = treat(
        client, owner_headers, start_date=day(-20), end_date=day(-15), withdrawal_days=3
    ).json()
    assert planned["phase"] == "PLANNED"
    assert withdrawal["phase"] == "WITHDRAWAL"
    assert finished["phase"] == "FINISHED"


def test_houses_show_withdrawal_until(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    treat(client, owner_headers, start_date=day(-5), end_date=day(-1), withdrawal_days=4)
    houses = client.get("/api/houses", headers=worker_headers).json()
    assert houses[0]["withdrawal_until"] == day(3)
    assert houses[1]["withdrawal_until"] is None
    # The phone gets the same through the pull.
    pulled = client.get("/api/sync/pull", headers=worker_headers).json()["houses"]
    assert pulled[0]["withdrawal_until"] == day(3)


def test_longest_overlapping_treatment_wins(client: TestClient, owner_headers: dict) -> None:
    treat(client, owner_headers, start_date=day(-3), end_date=day(0), withdrawal_days=2)
    treat(client, owner_headers, start_date=day(-1), end_date=day(1), withdrawal_days=5)
    houses = client.get("/api/houses", headers=owner_headers).json()
    assert houses[0]["withdrawal_until"] == day(6)


def test_no_withdrawal_after_it_ends(client: TestClient, owner_headers: dict) -> None:
    treat(client, owner_headers, start_date=day(-10), end_date=day(-5), withdrawal_days=2)
    assert client.get("/api/houses", headers=owner_headers).json()[0]["withdrawal_until"] is None


def test_end_before_start_rejected(client: TestClient, owner_headers: dict) -> None:
    response = treat(client, owner_headers, start_date=day(2), end_date=day(1))
    assert response.status_code == 422
    assert response.json()["detail"] == "Tanggal selesai tidak boleh sebelum tanggal mulai."


def test_negative_withdrawal_rejected(client: TestClient, owner_headers: dict) -> None:
    assert treat(client, owner_headers, withdrawal_days=-1).status_code == 422


def test_edit_and_delete(client: TestClient, owner_headers: dict) -> None:
    item = treat(client, owner_headers).json()
    url = f"/api/treatments/{item['id']}"
    edited = client.patch(url, headers=owner_headers, json={"withdrawal_days": 3}).json()
    assert edited["sellable_from"] == day(2 + 3 + 1)
    bad = client.patch(url, headers=owner_headers, json={"end_date": day(-10)})
    assert bad.status_code == 422
    assert client.delete(url, headers=owner_headers).status_code == 204
    assert client.get("/api/treatments", headers=owner_headers).json() == []


def test_list_hides_long_finished_treatments(client: TestClient, owner_headers: dict) -> None:
    treat(client, owner_headers, start_date=day(-200), end_date=day(-190), withdrawal_days=5)
    treat(client, owner_headers)
    assert len(client.get("/api/treatments", headers=owner_headers).json()) == 1


def test_workers_cannot_manage_treatments(client: TestClient, worker_headers: dict) -> None:
    assert client.get("/api/treatments", headers=worker_headers).status_code == 403
    assert treat(client, worker_headers).status_code == 403
