import uuid
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Role, User
from app.security import decode_token

_bearer = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sesi berakhir. Silakan login kembali.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def user_from_token(db: Session, token: str, kind: str) -> User:
    try:
        payload = decode_token(token, kind)
        user_id = uuid.UUID(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        raise _unauthorized() from None
    user = db.get(User, user_id)
    if user is None or not user.is_active or user.token_version != payload.get("tv"):
        raise _unauthorized()
    return user


def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if credentials is None:
        raise _unauthorized()
    return user_from_token(db, credentials.credentials, "access")


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(*roles: Role):
    def checker(user: CurrentUser) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Anda tidak memiliki akses ke fitur ini.",
            )
        return user

    return checker


OwnerUser = Annotated[User, Depends(require_role(Role.OWNER))]
WorkerUser = Annotated[User, Depends(require_role(Role.WORKER))]
