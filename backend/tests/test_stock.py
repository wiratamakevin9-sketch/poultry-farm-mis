from datetime import timedelta

from fastapi.testclient import TestClient

from app.farm_time import farm_today
from tests.test_sync import house_id, new_record, push

TODAY = farm_today()
YESTERDAY = TODAY - timedelta(days=1)


def stock(client: TestClient, headers: dict) -> dict[str, int]:
    response = client.get("/api/stock/eggs", headers=headers)
    assert response.status_code == 200, response.text
    return {line["grade"]: line["eggs"] for line in response.json()["lines"]}


def record(client: TestClient, headers: dict, index: int = 0, **values) -> None:
    house = client.get("/api/houses", headers=headers).json()[index]["id"]
    body = {"eggs_good": 4000, "eggs_cracked": 30, "eggs_rejected": 10, "eggs_dirty": 20} | values
    [result] = push(client, headers, new_record(house, **body))
    assert result["status"] == "accepted", result


def test_production_fills_the_stock_per_grade(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    record(client, worker_headers, 0)
    record(client, worker_headers, 1, record_date=YESTERDAY.isoformat())
    assert stock(client, owner_headers) == {
        "GOOD": 8000, "CRACKED": 60, "DIRTY": 40, "WITHHELD": 0,
    }  # fmt: skip


def test_rejected_eggs_never_enter_the_stock(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    record(client, worker_headers, eggs_rejected=500)
    assert sum(stock(client, owner_headers).values()) == 4000 + 30 + 20


def test_eggs_from_a_house_in_withdrawal_are_withheld(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    client.post(
        "/api/treatments",
        headers=owner_headers,
        json={"house_id": house_id(client, owner_headers), "medicine_name": "Obat X",
              "start_date": YESTERDAY.isoformat(), "end_date": TODAY.isoformat(),
              "withdrawal_days": 3},
    )  # fmt: skip
    record(client, worker_headers, 0)  # Kandang 1: under treatment
    record(client, worker_headers, 1)  # Kandang 2: normal
    assert stock(client, owner_headers) == {
        "GOOD": 4000, "CRACKED": 30, "DIRTY": 20, "WITHHELD": 4050,
    }  # fmt: skip


def test_withheld_eggs_can_be_disposed(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    client.post(
        "/api/treatments",
        headers=owner_headers,
        json={"house_id": house_id(client, owner_headers), "medicine_name": "Obat X",
              "start_date": TODAY.isoformat(), "end_date": TODAY.isoformat(),
              "withdrawal_days": 0},
    )  # fmt: skip
    record(client, worker_headers, 0)
    response = client.post(
        "/api/stock/eggs/disposals",
        headers=owner_headers,
        json={"disposal_date": TODAY.isoformat(), "grade": "WITHHELD", "quantity": 4050,
              "reason": "Masa henti obat"},
    )  # fmt: skip
    assert response.status_code == 201
    assert stock(client, owner_headers)["WITHHELD"] == 0


def test_cannot_dispose_more_than_in_stock(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    record(client, worker_headers)
    response = client.post(
        "/api/stock/eggs/disposals",
        headers=owner_headers,
        json={"disposal_date": TODAY.isoformat(), "grade": "CRACKED", "quantity": 31},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Stok telur retak hanya 30 butir."


def test_physical_count_corrects_the_stock(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    record(client, worker_headers)
    response = client.post(
        "/api/stock/eggs/count",
        headers=owner_headers,
        json={"grade": "GOOD", "counted": 3950, "reason": "Hitung fisik gudang"},
    )
    assert response.status_code == 201
    assert stock(client, owner_headers)["GOOD"] == 3950
    [movement] = client.get("/api/stock/movements", headers=owner_headers).json()
    assert movement["kind"] == "COUNT"
    assert float(movement["quantity"]) == -50
    assert movement["by"] == "Pemilik Peternakan"


def test_deleted_records_leave_the_stock(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    house = house_id(client, worker_headers)
    item = new_record(house)
    push(client, worker_headers, item)
    client.delete(f"/api/records/{item['id']}", headers=owner_headers)
    assert stock(client, owner_headers)["GOOD"] == 0


def test_kg_estimate_uses_egg_weight(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    record(client, worker_headers)
    body = client.get("/api/stock/eggs", headers=owner_headers).json()
    good = next(line for line in body["lines"] if line["grade"] == "GOOD")
    assert good["kg"] == 248.0  # 4000 x 62 g
    assert good["sellable"] is True
    assert body["egg_weight_g"] == 62


def test_workers_cannot_see_stock(client: TestClient, worker_headers: dict) -> None:
    assert client.get("/api/stock/eggs", headers=worker_headers).status_code == 403
