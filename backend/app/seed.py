"""Development seed data. Run with: python -m app.seed"""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import ChickenHouse, Flock, Role, User
from app.security import hash_password

DEV_USERS = [
    ("pemilik", "Pemilik Peternakan", "pemilik123", Role.OWNER),
    ("pekerja1", "Pekerja Satu", "pekerja123", Role.WORKER),
    ("pekerja2", "Pekerja Dua", "pekerja123", Role.WORKER),
]

# Example houses for development only; the real numbers come from the farm.
DEV_HOUSES = [("Kandang 1", 5000), ("Kandang 2", 5000), ("Kandang 3", 5000), ("Kandang 4", 5000)]


def seed(session: Session) -> None:
    for username, full_name, password, role in DEV_USERS:
        if session.scalar(select(User).where(User.username == username)) is None:
            session.add(
                User(
                    username=username,
                    full_name=full_name,
                    password_hash=hash_password(password),
                    role=role,
                )
            )

    for name, capacity in DEV_HOUSES:
        if session.scalar(select(ChickenHouse).where(ChickenHouse.name == name)) is None:
            house = ChickenHouse(name=name, capacity=capacity)
            session.add(house)
            session.flush()
            session.add(
                Flock(
                    house_id=house.id,
                    breed="Isa Brown",
                    placement_date=date(2026, 3, 1),
                    initial_bird_count=capacity,
                )
            )
    session.commit()


if __name__ == "__main__":
    with SessionLocal() as db:
        seed(db)
    print("Seed data ready.")
