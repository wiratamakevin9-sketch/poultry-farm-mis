import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.deps import DbSession, OwnerUser
from app.models import User
from app.schemas import PasswordReset, UserCreate, UserOut, UserUpdate
from app.security import hash_password

router = APIRouter(prefix="/api/users", tags=["users"])


def _get_user(db: DbSession, user_id: uuid.UUID) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pengguna tidak ditemukan.")
    return user


@router.get("")
def list_users(db: DbSession, _: OwnerUser) -> list[UserOut]:
    users = db.scalars(select(User).order_by(User.role, User.username))
    return [UserOut.model_validate(u) for u in users]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, db: DbSession, _: OwnerUser) -> UserOut:
    user = User(
        username=body.username.lower(),
        full_name=body.full_name.strip(),
        password_hash=hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Username sudah dipakai.") from None
    return UserOut.model_validate(user)


@router.patch("/{user_id}")
def update_user(user_id: uuid.UUID, body: UserUpdate, db: DbSession, owner: OwnerUser) -> UserOut:
    user = _get_user(db, user_id)
    changes = body.model_dump(exclude_unset=True)
    if user.id == owner.id and (changes.get("is_active") is False or "role" in changes):
        # Prevents the owner from locking themselves out.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Anda tidak bisa menonaktifkan atau mengubah peran akun sendiri.",
        )
    if changes.get("is_active") is False and user.is_active:
        user.token_version += 1
    for field, value in changes.items():
        setattr(user, field, value)
    db.commit()
    return UserOut.model_validate(user)


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(user_id: uuid.UUID, body: PasswordReset, db: DbSession, _: OwnerUser) -> None:
    user = _get_user(db, user_id)
    user.password_hash = hash_password(body.new_password)
    user.token_version += 1  # logs the user out on all devices
    db.commit()
