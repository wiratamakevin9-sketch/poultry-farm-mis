from datetime import UTC, datetime, timedelta

import jwt
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import User
from tests.conftest import login


def test_login_returns_tokens_and_user(client: TestClient) -> None:
    body = login(client, "pekerja1")
    assert body["user"]["role"] == "WORKER"
    assert body["access_token"] and body["refresh_token"]


def test_login_is_case_insensitive_for_username(client: TestClient) -> None:
    assert login(client, "Pekerja1")["user"]["username"] == "pekerja1"


def test_wrong_password_is_rejected(client: TestClient) -> None:
    response = client.post("/api/auth/login", json={"username": "pekerja1", "password": "x"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Username atau password salah."


def test_password_is_hashed(db: Session) -> None:
    user = db.scalar(select(User).where(User.username == "pekerja1"))
    assert user.password_hash.startswith("$argon2")
    assert "pekerja123" not in user.password_hash


def test_me_requires_token(client: TestClient) -> None:
    assert client.get("/api/auth/me").status_code == 401


def test_me_with_token(client: TestClient, worker_headers: dict) -> None:
    response = client.get("/api/auth/me", headers=worker_headers)
    assert response.status_code == 200
    assert response.json()["username"] == "pekerja1"


def test_refresh_returns_new_pair(client: TestClient) -> None:
    refresh_token = login(client, "pekerja1")["refresh_token"]
    response = client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert response.status_code == 200
    assert response.json()["user"]["username"] == "pekerja1"


def test_access_token_cannot_be_used_as_refresh(client: TestClient) -> None:
    access_token = login(client, "pekerja1")["access_token"]
    response = client.post("/api/auth/refresh", json={"refresh_token": access_token})
    assert response.status_code == 401


def test_expired_token_is_rejected(client: TestClient, db: Session) -> None:
    user = db.scalar(select(User).where(User.username == "pekerja1"))
    expired = jwt.encode(
        {"sub": str(user.id), "role": "WORKER", "tv": 0, "type": "access",
         "exp": datetime.now(UTC) - timedelta(minutes=1)},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"})
    assert response.status_code == 401


def test_deactivated_user_cannot_login_or_use_old_token(client: TestClient, db: Session) -> None:
    tokens = login(client, "pekerja1")
    user = db.scalar(select(User).where(User.username == "pekerja1"))
    user.is_active = False
    db.commit()

    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    response = client.post(
        "/api/auth/login", json={"username": "pekerja1", "password": "pekerja123"}
    )
    assert response.status_code == 403
