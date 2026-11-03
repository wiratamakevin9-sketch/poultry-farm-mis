from datetime import timedelta

from fastapi.testclient import TestClient

from app.farm_time import farm_today
from tests.test_stock import record

TODAY = farm_today()


def feed(client: TestClient, headers: dict) -> dict:
    response = client.get("/api/stock/feed", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def buy(client: TestClient, headers: dict, kg: str, **changes):
    body = {"purchase_date": TODAY.isoformat(), "quantity_kg": kg, "supplier": "Poultry Shop"}
    return client.post("/api/stock/feed/purchases", headers=headers, json=body | changes)


def test_purchases_in_daily_feed_out(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    assert buy(client, owner_headers, "5000").status_code == 201
    record(client, worker_headers, 0, feed_kg=550)
    record(client, worker_headers, 1, feed_kg=560.5)
    assert float(feed(client, owner_headers)["stock_kg"]) == 5000 - 550 - 560.5


def test_days_left_uses_the_last_7_days(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    buy(client, owner_headers, "1000")
    record(client, worker_headers, 0, feed_kg=700)  # today
    record(
        client, worker_headers, 1, feed_kg=700, record_date=(TODAY - timedelta(days=1)).isoformat()
    )
    body = feed(client, owner_headers)
    # 1400 kg over 7 days = 200 kg/day; 1000 - 1400 = -400 kg left
    assert float(body["per_day_kg"]) == 200
    assert body["days_left"] == -2.0
    assert body["low"] is True


def test_low_warning_under_7_days(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    buy(client, owner_headers, "2000")
    record(client, worker_headers, 0, feed_kg=700)  # 100 kg/day over 7 days
    body = feed(client, owner_headers)
    assert body["days_left"] == 13.0  # 1300 kg / 100 kg
    assert body["low"] is False

    record(client, worker_headers, 1, feed_kg=700)  # now 200 kg/day, 600 kg left
    body = feed(client, owner_headers)
    assert body["days_left"] == 3.0
    assert body["low"] is True


def test_no_recent_use_means_no_estimate(client: TestClient, owner_headers: dict) -> None:
    buy(client, owner_headers, "500")
    body = feed(client, owner_headers)
    assert body["days_left"] is None
    assert body["low"] is False


def test_count_corrects_the_feed_stock(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    buy(client, owner_headers, "5000")
    record(client, worker_headers, 0, feed_kg=550)
    response = client.post(
        "/api/stock/feed/count",
        headers=owner_headers,
        json={"counted_kg": "4400", "reason": "Timbang ulang"},
    )
    assert response.status_code == 201
    assert float(feed(client, owner_headers)["stock_kg"]) == 4400
    kinds = {m["kind"] for m in client.get("/api/stock/movements", headers=owner_headers).json()}
    assert kinds == {"PURCHASE", "COUNT"}


def test_purchase_rules(client: TestClient, owner_headers: dict, worker_headers: dict) -> None:
    assert buy(client, owner_headers, "0").status_code == 422
    tomorrow = (TODAY + timedelta(days=1)).isoformat()
    assert buy(client, owner_headers, "10", purchase_date=tomorrow).status_code == 422
    assert buy(client, worker_headers, "10").status_code == 403
