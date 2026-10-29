import io
import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from pypdf import PdfReader
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import HealthObservation
from tests.conftest import auth_headers
from tests.test_photos import upload
from tests.test_sync import house_id


def observation(house: str, **changes) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "house_id": house,
        "observed_at": datetime.now(UTC).isoformat(),
        "symptoms": ["LETHARGIC", "RESPIRATORY"],
        "other_symptoms": "",
        "affected_count": 15,
        "notes": "Beberapa ayam di sudut utara terlihat lemas.",
    } | changes


def push(client: TestClient, headers: dict, *observations: dict) -> list[dict]:
    response = client.post(
        "/api/sync/observations", headers=headers, json={"observations": list(observations)}
    )
    assert response.status_code == 200, response.text
    return response.json()["results"]


def test_worker_reports_an_observation(
    client: TestClient, worker_headers: dict, db: Session
) -> None:
    item = observation(house_id(client, worker_headers))
    [result] = push(client, worker_headers, item)
    assert result["status"] == "accepted"
    saved = db.get(HealthObservation, uuid.UUID(item["id"]))
    assert saved.status == "NEW"
    assert saved.symptoms == ["LETHARGIC", "RESPIRATORY"]


def test_sending_twice_stores_once(client: TestClient, worker_headers: dict, db: Session) -> None:
    item = observation(house_id(client, worker_headers))
    push(client, worker_headers, item)
    [again] = push(client, worker_headers, item)
    assert again["status"] == "accepted"
    assert db.scalar(select(func.count()).select_from(HealthObservation)) == 1


def test_needs_a_symptom_or_a_description(client: TestClient, worker_headers: dict) -> None:
    house = house_id(client, worker_headers)
    [empty] = push(client, worker_headers, observation(house, symptoms=[]))
    assert empty["errors"]["symptoms"] == "Pilih minimal satu gejala atau tulis gejala lain."
    [described] = push(
        client, worker_headers, observation(house, symptoms=[], other_symptoms="Bulu rontok")
    )
    assert described["status"] == "accepted"


def test_unknown_symptom_rejected(client: TestClient, worker_headers: dict) -> None:
    house = house_id(client, worker_headers)
    [result] = push(client, worker_headers, observation(house, symptoms=["FLU_BURUNG"]))
    assert result["errors"]["symptoms"] == "Ada gejala yang tidak dikenal."


def test_affected_birds_cannot_exceed_live_birds(client: TestClient, worker_headers: dict) -> None:
    house = house_id(client, worker_headers)
    [result] = push(client, worker_headers, observation(house, affected_count=5001))
    assert result["errors"]["affected_count"] == (
        "Jumlah ayam terkena (5.001) tidak boleh lebih dari jumlah ayam hidup (5.000)."
    )


def test_future_time_rejected(client: TestClient, worker_headers: dict) -> None:
    house = house_id(client, worker_headers)
    later = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
    [result] = push(client, worker_headers, observation(house, observed_at=later))
    assert result["errors"]["observed_at"] == "Waktu observasi tidak boleh di masa depan."


def test_owner_cannot_push(client: TestClient, owner_headers: dict) -> None:
    house = house_id(client, owner_headers)
    response = client.post(
        "/api/sync/observations", headers=owner_headers, json={"observations": [observation(house)]}
    )
    assert response.status_code == 403


def test_status_flow_new_seen_forwarded_closed(
    client: TestClient, worker_headers: dict, owner_headers: dict
) -> None:
    item = observation(house_id(client, worker_headers))
    push(client, worker_headers, item)
    base = f"/api/health-observations/{item['id']}"

    assert client.get("/api/health-observations/summary", headers=owner_headers).json() == {
        "new_count": 1
    }
    [listed] = client.get("/api/health-observations?status=NEW", headers=owner_headers).json()
    assert listed["created_by_name"] == "Pekerja Satu"
    assert listed["house_name"] == "Kandang 1"

    opened = client.get(base, headers=owner_headers).json()
    assert opened["status"] == "SEEN"
    assert client.get("/api/health-observations/summary", headers=owner_headers).json() == {
        "new_count": 0
    }

    forwarded = client.post(f"{base}/forward", headers=owner_headers, json={"via": "WHATSAPP"})
    assert forwarded.json()["status"] == "FORWARDED"
    assert forwarded.json()["forwarded_via"] == "WHATSAPP"

    advice = "Pisahkan ayam yang lemas, dokter datang besok pagi."
    closed = client.patch(
        base, headers=owner_headers, json={"vet_advice": advice, "status": "CLOSED"}
    ).json()
    assert closed["status"] == "CLOSED"
    assert closed["vet_advice"] == advice

    reopened = client.patch(base, headers=owner_headers, json={"status": "SEEN"}).json()
    assert reopened["status"] == "FORWARDED"  # it was already sent to the vet


def test_worker_sees_own_observations_and_status_in_pull(
    client: TestClient, worker_headers: dict, owner_headers: dict
) -> None:
    house = house_id(client, worker_headers)
    mine = observation(house)
    push(client, worker_headers, mine)
    push(client, auth_headers(client, "pekerja2"), observation(house))
    client.get(f"/api/health-observations/{mine['id']}", headers=owner_headers)

    pulled = client.get("/api/sync/pull", headers=worker_headers).json()["observations"]
    assert [(o["id"], o["status"]) for o in pulled] == [(mine["id"], "SEEN")]


def test_worker_cannot_use_owner_endpoints(client: TestClient, worker_headers: dict) -> None:
    assert client.get("/api/health-observations", headers=worker_headers).status_code == 403
    assert client.get("/api/health-observations/summary", headers=worker_headers).status_code == 403


def test_health_photo_needs_own_observation(
    client: TestClient, worker_headers: dict, owner_headers: dict
) -> None:
    house = house_id(client, worker_headers)
    item = observation(house)
    health = {"kind": "HEALTH", "record_date": None, "tray_category": None, "label_count": None}

    early = upload(client, worker_headers, house, observation_id=item["id"], **health)
    assert early.status_code == 409  # observation not on the server yet

    push(client, worker_headers, item)
    other = upload(
        client, auth_headers(client, "pekerja2"), house, observation_id=item["id"], **health
    )
    assert other.status_code == 409  # not their observation

    ok = upload(client, worker_headers, house, observation_id=item["id"], **health)
    assert ok.status_code == 201
    detail = client.get(f"/api/health-observations/{item['id']}", headers=owner_headers).json()
    assert detail["photo_ids"] == [ok.json()["id"]]


def test_pdf_for_the_veterinarian(
    client: TestClient, worker_headers: dict, owner_headers: dict
) -> None:
    house = house_id(client, worker_headers)
    item = observation(
        house,
        other_symptoms="Bulu kusam – sejak 2 hari 😟",  # non-Latin-1 text must not break the PDF
        notes="Beberapa ayam di sudut utara terlihat lemas.",
    )
    push(client, worker_headers, item)
    health = {"kind": "HEALTH", "record_date": None, "tray_category": None, "label_count": None}
    upload(client, worker_headers, house, observation_id=item["id"], **health)
    client.patch(
        f"/api/health-observations/{item['id']}",
        headers=owner_headers,
        json={"vet_advice": "Pisahkan ayam yang lemas."},
    )

    response = client.get(f"/api/health-observations/{item['id']}/pdf", headers=owner_headers)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert "laporan-kesehatan-kandang-1-" in response.headers["content-disposition"]

    reader = PdfReader(io.BytesIO(response.content))
    text = " ".join(page.extract_text() for page in reader.pages)
    for expected in [
        "Laporan Pengamatan Kesehatan Ayam",
        "Kandang 1",
        "Pekerja Satu",
        "Lesu",
        "Ngorok atau sesak napas",
        "Bulu kusam - sejak 2 hari",
        "15 ekor",
        "Pisahkan ayam yang lemas.",
        "bukan diagnosis",
        "Foto 1",
    ]:
        assert expected in text, expected
    assert sum(len(page.images) for page in reader.pages) == 1


def test_worker_cannot_download_pdf(client: TestClient, worker_headers: dict) -> None:
    item = observation(house_id(client, worker_headers))
    push(client, worker_headers, item)
    response = client.get(f"/api/health-observations/{item['id']}/pdf", headers=worker_headers)
    assert response.status_code == 403
