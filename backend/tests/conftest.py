import os

# Tests use their own database so they never touch development data.
os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg://poultry:poultry@localhost:5432/poultry_test"
)

from collections.abc import Iterator

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from alembic import command
from app.db import SessionLocal, engine
from app.main import app
from app.seed import seed

TABLES = "sync_conflicts, daily_records, flocks, chicken_houses, users"


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    config = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    config.set_main_option(
        "script_location", os.path.join(os.path.dirname(__file__), "..", "alembic")
    )
    command.upgrade(config, "head")


@pytest.fixture(autouse=True)
def clean_database(migrated_database: None) -> Iterator[None]:
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {TABLES} CASCADE"))
    with SessionLocal() as session:
        seed(session)
    yield


@pytest.fixture
def db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def login(client: TestClient, username: str, password: str | None = None) -> dict:
    password = password or ("pemilik123" if username == "pemilik" else "pekerja123")
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()


def auth_headers(client: TestClient, username: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {login(client, username)['access_token']}"}


@pytest.fixture
def owner_headers(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "pemilik")


@pytest.fixture
def worker_headers(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "pekerja1")
