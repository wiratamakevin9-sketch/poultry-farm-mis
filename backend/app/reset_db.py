"""Rebuild a test database from scratch: python -m app.reset_db

Used before end-to-end tests. Refuses to run unless the database name ends in
_test or _e2e, so it can never wipe real data.
"""

import sys
from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from alembic import command
from app.config import settings

BACKEND_DIR = Path(__file__).resolve().parent.parent


def main() -> None:
    url = make_url(settings.database_url)
    if not url.database or not url.database.endswith(("_test", "_e2e")):
        sys.exit(f"Refusing to reset database {url.database!r}: name must end in _test or _e2e.")

    # Create the database if it does not exist yet.
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.scalar(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": url.database}
        )
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    admin.dispose()

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.downgrade(config, "base")
    command.upgrade(config, "head")

    from app.db import SessionLocal
    from app.seed import seed

    with SessionLocal() as session:
        seed(session)
    print(f"Database {url.database} reset and seeded.")


if __name__ == "__main__":
    main()
