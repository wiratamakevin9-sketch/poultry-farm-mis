import pytest
from fastapi.testclient import TestClient

from tests.conftest import login

OWNER_ENDPOINTS = [
    ("get", "/api/users", None),
    (
        "post",
        "/api/users",
        {"username": "x1", "full_name": "X", "password": "rahasia1", "role": "WORKER"},
    ),
    ("post", "/api/houses", {"name": "Kandang 9", "capacity": 100}),
]


@pytest.mark.parametrize(("method", "url", "body"), OWNER_ENDPOINTS)
def test_worker_cannot_use_owner_endpoints(
    client: TestClient, worker_headers: dict, method: str, url: str, body: dict | None
) -> None:
    response = getattr(client, method)(
        url, headers=worker_headers, **({"json": body} if body else {})
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Anda tidak memiliki akses ke fitur ini."


@pytest.mark.parametrize(("method", "url", "body"), OWNER_ENDPOINTS)
def test_owner_endpoints_need_login(
    client: TestClient, method: str, url: str, body: dict | None
) -> None:
    response = getattr(client, method)(url, **({"json": body} if body else {}))
    assert response.status_code == 401


# ---------- users ----------


def _create_worker(client: TestClient, headers: dict, username: str = "budi") -> dict:
    response = client.post(
        "/api/users",
        headers=headers,
        json={"username": username, "full_name": "Budi", "password": "rahasia1", "role": "WORKER"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_owner_creates_user_who_can_login(client: TestClient, owner_headers: dict) -> None:
    user = _create_worker(client, owner_headers, "Budi")
    assert user["username"] == "budi"
    assert login(client, "budi", "rahasia1")["user"]["role"] == "WORKER"


def test_duplicate_username_rejected(client: TestClient, owner_headers: dict) -> None:
    _create_worker(client, owner_headers)
    response = client.post(
        "/api/users",
        headers=owner_headers,
        json={"username": "budi", "full_name": "B", "password": "rahasia1", "role": "WORKER"},
    )
    assert response.status_code == 409


def test_short_password_rejected(client: TestClient, owner_headers: dict) -> None:
    response = client.post(
        "/api/users",
        headers=owner_headers,
        json={"username": "budi", "full_name": "B", "password": "123", "role": "WORKER"},
    )
    assert response.status_code == 422


def test_deactivate_user_blocks_login(client: TestClient, owner_headers: dict) -> None:
    user = _create_worker(client, owner_headers)
    response = client.patch(
        f"/api/users/{user['id']}", headers=owner_headers, json={"is_active": False}
    )
    assert response.status_code == 200
    bad = client.post("/api/auth/login", json={"username": "budi", "password": "rahasia1"})
    assert bad.status_code == 403


def test_owner_cannot_deactivate_self(client: TestClient, owner_headers: dict) -> None:
    me = client.get("/api/auth/me", headers=owner_headers).json()
    response = client.patch(
        f"/api/users/{me['id']}", headers=owner_headers, json={"is_active": False}
    )
    assert response.status_code == 400


def test_reset_password_logs_out_old_tokens(client: TestClient, owner_headers: dict) -> None:
    user = _create_worker(client, owner_headers)
    old = login(client, "budi", "rahasia1")
    response = client.post(
        f"/api/users/{user['id']}/reset-password",
        headers=owner_headers,
        json={"new_password": "baru1234"},
    )
    assert response.status_code == 204
    old_headers = {"Authorization": f"Bearer {old['access_token']}"}
    assert client.get("/api/auth/me", headers=old_headers).status_code == 401
    assert login(client, "budi", "baru1234")["user"]["username"] == "budi"


# ---------- houses and flocks ----------


def test_list_houses_shows_active_flock_and_live_birds(
    client: TestClient, worker_headers: dict
) -> None:
    houses = client.get("/api/houses", headers=worker_headers).json()
    assert [h["name"] for h in houses] == ["Kandang 1", "Kandang 2", "Kandang 3", "Kandang 4"]
    assert houses[0]["active_flock"]["live_birds"] == 5000


def test_create_and_update_house(client: TestClient, owner_headers: dict) -> None:
    house = client.post(
        "/api/houses", headers=owner_headers, json={"name": "Kandang 5", "capacity": 3000}
    ).json()
    assert house["active_flock"] is None
    response = client.patch(
        f"/api/houses/{house['id']}", headers=owner_headers, json={"capacity": 3500}
    )
    assert response.json()["capacity"] == 3500


def test_duplicate_house_name_rejected(client: TestClient, owner_headers: dict) -> None:
    response = client.post(
        "/api/houses", headers=owner_headers, json={"name": "Kandang 1", "capacity": 100}
    )
    assert response.status_code == 409


def test_cannot_deactivate_house_with_active_flock(client: TestClient, owner_headers: dict) -> None:
    house = client.get("/api/houses", headers=owner_headers).json()[0]
    response = client.patch(
        f"/api/houses/{house['id']}", headers=owner_headers, json={"is_active": False}
    )
    assert response.status_code == 409


def test_one_active_flock_per_house_via_api(client: TestClient, owner_headers: dict) -> None:
    house = client.get("/api/houses", headers=owner_headers).json()[0]
    body = {
        "house_id": house["id"],
        "breed": "Lohmann",
        "placement_date": "2026-09-01",
        "initial_bird_count": 4800,
    }
    response = client.post("/api/flocks", headers=owner_headers, json=body)
    assert response.status_code == 409
    assert response.json()["detail"] == "Kandang ini sudah memiliki flock aktif."

    old = house["active_flock"]["id"]
    client.patch(f"/api/flocks/{old}", headers=owner_headers, json={"is_active": False})
    response = client.post("/api/flocks", headers=owner_headers, json=body)
    assert response.status_code == 201
    assert response.json()["live_birds"] == 4800
