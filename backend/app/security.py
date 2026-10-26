import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError

from app.config import settings

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerificationError:
        return False


def create_token(user_id: uuid.UUID, role: str, token_version: int, kind: str) -> str:
    if kind == "access":
        lifetime = timedelta(minutes=settings.access_token_minutes)
    else:
        lifetime = timedelta(days=settings.refresh_token_days)
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "role": role,
        "tv": token_version,
        "type": kind,
        "iat": now,
        "exp": now + lifetime,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str, kind: str) -> dict:
    """Return the token payload, or raise jwt.InvalidTokenError."""
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    if payload.get("type") != kind:
        raise jwt.InvalidTokenError("wrong token type")
    return payload
