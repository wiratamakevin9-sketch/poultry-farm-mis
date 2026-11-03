from datetime import timedelta

from fastapi.testclient import TestClient

from app.farm_time import farm_today
from tests.test_stock import record, stock
from tests.test_sync import house_id

TODAY = farm_today()


def buyer(client: TestClient, headers: dict, name: str = "Toko Sari") -> dict:
    response = client.post(
        "/api/buyers", headers=headers, json={"name": name, "phone": "0812 3456 789"}
    )
    assert response.status_code == 201, response.text
    return response.json()


def sell(client: TestClient, headers: dict, buyer_id: str, **changes):
    body = {
        "sale_date": TODAY.isoformat(),
        "buyer_id": buyer_id,
        "grade": "GOOD",
        "weight_kg": "62.00",
        "price_per_kg": "27500",
        "quantity": 1000,
    } | changes
    return client.post("/api/sales", headers=headers, json=body)


def test_sale_in_kg_takes_eggs_out_of_stock(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    record(client, worker_headers)  # 4000 good eggs
    response = sell(client, owner_headers, buyer(client, owner_headers)["id"])
    assert response.status_code == 201, response.text
    sale = response.json()
    assert float(sale["total"]) == 62 * 27500
    assert sale["buyer_name"] == "Toko Sari"
    assert stock(client, owner_headers)["GOOD"] == 3000


def test_quantity_is_estimated_from_weight_when_missing(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    record(client, worker_headers)
    sale = sell(
        client, owner_headers, buyer(client, owner_headers)["id"], quantity=None, weight_kg="31"
    ).json()
    assert sale["quantity"] == 500  # 31 kg / 62 g
    assert sale["quantity_estimated"] is True


def test_cannot_sell_more_than_in_stock(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    record(client, worker_headers)  # 30 cracked
    response = sell(
        client, owner_headers, buyer(client, owner_headers)["id"], grade="CRACKED", quantity=31,
        weight_kg="2",
    )  # fmt: skip
    assert response.status_code == 409
    assert response.json()["detail"] == "Stok telur retak hanya 30 butir."


def test_withheld_eggs_cannot_be_sold(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    client.post(
        "/api/treatments",
        headers=owner_headers,
        json={"house_id": house_id(client, owner_headers), "medicine_name": "Obat X",
              "start_date": TODAY.isoformat(), "end_date": TODAY.isoformat(),
              "withdrawal_days": 5},
    )  # fmt: skip
    record(client, worker_headers, 0)  # all eggs withheld
    customer = buyer(client, owner_headers)["id"]
    # Not as WITHHELD...
    assert sell(client, owner_headers, customer, grade="WITHHELD").status_code == 422
    # ...and not as GOOD either: there are no sellable good eggs.
    response = sell(client, owner_headers, customer, quantity=1, weight_kg="0.06")
    assert response.status_code == 409
    assert response.json()["detail"] == "Stok telur bagus hanya 0 butir."


def test_deleting_a_sale_returns_the_eggs(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    record(client, worker_headers)
    sale = sell(client, owner_headers, buyer(client, owner_headers)["id"]).json()
    assert client.delete(f"/api/sales/{sale['id']}", headers=owner_headers).status_code == 204
    assert stock(client, owner_headers)["GOOD"] == 4000


def test_list_sales_by_date_and_buyer(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    record(client, worker_headers)
    a = buyer(client, owner_headers, "Toko Sari")["id"]
    b = buyer(client, owner_headers, "Warung Made")["id"]
    sell(client, owner_headers, a)
    sell(client, owner_headers, b, sale_date=(TODAY - timedelta(days=1)).isoformat())
    today_only = client.get(
        f"/api/sales?date_from={TODAY.isoformat()}", headers=owner_headers
    ).json()
    assert [s["buyer_name"] for s in today_only] == ["Toko Sari"]
    by_buyer = client.get(f"/api/sales?buyer_id={b}", headers=owner_headers).json()
    assert [s["buyer_name"] for s in by_buyer] == ["Warung Made"]


def test_future_date_and_unknown_buyer_rejected(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    record(client, worker_headers)
    customer = buyer(client, owner_headers)["id"]
    tomorrow = (TODAY + timedelta(days=1)).isoformat()
    assert sell(client, owner_headers, customer, sale_date=tomorrow).status_code == 422
    unknown = "00000000-0000-0000-0000-000000000000"
    assert sell(client, owner_headers, unknown).status_code == 404


def test_buyers(client: TestClient, owner_headers: dict) -> None:
    created = buyer(client, owner_headers)
    duplicate = client.post("/api/buyers", headers=owner_headers, json={"name": "Toko Sari"})
    assert duplicate.status_code == 409
    changed = client.patch(
        f"/api/buyers/{created['id']}", headers=owner_headers, json={"is_active": False}
    ).json()
    assert changed["is_active"] is False


def test_inactive_buyer_cannot_buy(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    record(client, worker_headers)
    customer = buyer(client, owner_headers)
    client.patch(f"/api/buyers/{customer['id']}", headers=owner_headers, json={"is_active": False})
    assert sell(client, owner_headers, customer["id"]).status_code == 404


def test_workers_cannot_sell(client: TestClient, worker_headers: dict) -> None:
    assert client.get("/api/sales", headers=worker_headers).status_code == 403
    assert client.get("/api/buyers", headers=worker_headers).status_code == 403
