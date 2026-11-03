import csv
import io
from datetime import date, timedelta

from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.farm_time import farm_today
from app.reports import week_start
from tests.test_stock import record

TODAY = farm_today()
YESTERDAY = TODAY - timedelta(days=1)


def weekly(client: TestClient, headers: dict, weeks: int = 4) -> dict:
    response = client.get(f"/api/reports/weekly?weeks={weeks}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_week_starts_on_monday() -> None:
    assert week_start(date(2026, 11, 5)) == date(2026, 11, 2)  # Thursday -> Monday
    assert week_start(date(2026, 11, 2)) == date(2026, 11, 2)


def test_weekly_hdp_fcr_and_mortality(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    # Kandang 1, 5000 birds: one day, 4000 eggs in total, 248 kg feed, 10 dead.
    record(
        client, worker_headers, 0,
        eggs_good=3950, eggs_cracked=30, eggs_dirty=10, eggs_rejected=10,
        feed_kg=248, dead=10, culled=0,
    )  # fmt: skip
    [row] = weekly(client, owner_headers)["rows"]
    assert row["house_name"] == "Kandang 1"
    assert row["week_start"] == week_start(TODAY).isoformat()
    assert row["eggs"] == 4000
    assert row["hdp"] == 80.0  # 4000 / 5000
    assert row["fcr"] == 1.0  # 248 kg / (4000 x 62 g = 248 kg)
    assert row["mortality_pct"] == 0.2  # 10 / 5000
    assert row["feed_per_bird_g"] == 49.6


def test_hen_days_follow_live_birds(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    if week_start(YESTERDAY) != week_start(TODAY):
        return  # needs two days in the same week (not on a Monday)
    record(
        client,
        worker_headers,
        0,
        record_date=YESTERDAY.isoformat(),
        eggs_good=4000,
        eggs_cracked=0,
        eggs_dirty=0,
        eggs_rejected=0,
        dead=100,
        culled=0,
    )
    record(
        client,
        worker_headers,
        0,
        eggs_good=3920,
        eggs_cracked=0,
        eggs_dirty=0,
        eggs_rejected=0,
        dead=0,
        culled=0,
    )
    [row] = weekly(client, owner_headers)["rows"]
    assert row["hen_days"] == 5000 + 4900
    assert row["hdp"] == round(7920 / 9900 * 100, 1)
    assert row["birds_start"] == 5000
    assert row["mortality_pct"] == 2.0  # 100 / 5000


def test_farm_row_adds_up_the_houses(
    client: TestClient, owner_headers: dict, worker_headers: dict
) -> None:
    record(
        client,
        worker_headers,
        0,
        eggs_good=4000,
        eggs_cracked=0,
        eggs_dirty=0,
        eggs_rejected=0,
        dead=5,
        culled=0,
    )
    record(
        client,
        worker_headers,
        1,
        eggs_good=3000,
        eggs_cracked=0,
        eggs_dirty=0,
        eggs_rejected=0,
        dead=15,
        culled=0,
    )
    report = weekly(client, owner_headers)
    assert len(report["rows"]) == 2
    [farm] = report["farm"]
    assert farm["house_name"] == "Semua kandang"
    assert farm["eggs"] == 7000
    assert farm["hdp"] == 70.0  # 7000 / 10000
    assert farm["mortality_pct"] == 0.2  # 20 / 10000
    assert len(report["weeks"]) == 4


def test_csv_export(client: TestClient, owner_headers: dict, worker_headers: dict) -> None:
    record(client, worker_headers, 0)
    response = client.get("/api/reports/weekly.csv?weeks=4", headers=owner_headers)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    rows = list(csv.reader(io.StringIO(response.text.lstrip("﻿"))))
    assert rows[0][:5] == ["Minggu mulai", "Kandang", "Hari tercatat", "Telur (butir)", "HDP (%)"]
    assert [r[1] for r in rows[1:]] == ["Kandang 1", "Semua kandang"]


def test_pdf_export(client: TestClient, owner_headers: dict, worker_headers: dict) -> None:
    record(client, worker_headers, 0)
    response = client.get("/api/reports/weekly.pdf?weeks=4", headers=owner_headers)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    text = " ".join(p.extract_text() for p in PdfReader(io.BytesIO(response.content)).pages)
    for expected in [
        "Laporan Produksi Mingguan",
        "Seluruh peternakan",
        "Kandang 1",
        "HDP (%)",
        "FCR",
    ]:
        assert expected in text, expected


def test_alerts(client: TestClient, owner_headers: dict, worker_headers: dict) -> None:
    house = client.get("/api/houses", headers=owner_headers).json()[0]["id"]
    client.post("/api/vaccinations", headers=owner_headers, json={
        "house_id": house, "scheduled_date": YESTERDAY.isoformat(),
        "vaccine_name": "ND", "method": "SPRAY"})  # fmt: skip
    client.post("/api/vaccinations", headers=owner_headers, json={
        "house_id": house, "scheduled_date": TODAY.isoformat(),
        "vaccine_name": "IB", "method": "SPRAY"})  # fmt: skip
    record(client, worker_headers, 0, feed_kg=700)  # no feed bought: stock is low
    body = client.get("/api/reports/alerts", headers=owner_headers).json()
    assert body["overdue_vaccinations"] == 1
    assert body["vaccinations_today"] == 1
    assert body["feed_low"] is True
    assert body["withheld_eggs"] == 0
    assert body["new_health_reports"] == 0
    assert body["open_conflicts"] == 0


def test_workers_cannot_see_reports(client: TestClient, worker_headers: dict) -> None:
    for path in ("/api/reports/weekly", "/api/reports/weekly.csv", "/api/reports/alerts"):
        assert client.get(path, headers=worker_headers).status_code == 403
