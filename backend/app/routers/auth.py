from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.deps import CurrentUser, DbSession, user_from_token
from app.models import User
from app.schemas import LoginRequest, RefreshRequest, TokenPair, UserOut
from app.security import create_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def token_pair(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_token(user.id, user.role, user.token_version, "access"),
        refresh_token=create_token(user.id, user.role, user.token_version, "refresh"),
        user=UserOut.model_validate(user),
    )


@router.post("/login")
def login(body: LoginRequest, db: DbSession) -> TokenPair:
    user = db.scalar(select(User).where(User.username == body.username.strip().lower()))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Username atau password salah.")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Akun Anda sudah dinonaktifkan.")
    return token_pair(user)


@router.post("/refresh")
def refresh(body: RefreshRequest, db: DbSession) -> TokenPair:
    # A new refresh token is issued every time, so an active worker stays logged in.
    user = user_from_token(db, body.refresh_token, "refresh")
    return token_pair(user)


@router.get("/me")
def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)
