import uuid
from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from app.models import Role


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- auth ----------


class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(ORMModel):
    id: uuid.UUID
    username: str
    full_name: str
    role: Role
    is_active: bool


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- users ----------

Username = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9._]+$")
Password = Field(min_length=6, max_length=100)


class UserCreate(BaseModel):
    username: str = Username
    full_name: str = Field(min_length=1, max_length=100)
    password: str = Password
    role: Role


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=100)
    role: Role | None = None
    is_active: bool | None = None


class PasswordReset(BaseModel):
    new_password: str = Password


# ---------- houses and flocks ----------


class HouseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    capacity: int = Field(gt=0)


class HouseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    capacity: int | None = Field(default=None, gt=0)
    is_active: bool | None = None


class FlockOut(ORMModel):
    id: uuid.UUID
    house_id: uuid.UUID
    breed: str
    placement_date: date
    initial_bird_count: int
    is_active: bool


class FlockWithBirds(FlockOut):
    live_birds: int


class HouseOut(ORMModel):
    id: uuid.UUID
    name: str
    capacity: int
    is_active: bool
    active_flock: FlockWithBirds | None = None


class FlockCreate(BaseModel):
    house_id: uuid.UUID
    breed: str = Field(min_length=1, max_length=100)
    placement_date: date
    initial_bird_count: int = Field(gt=0)


class FlockUpdate(BaseModel):
    breed: str | None = Field(default=None, min_length=1, max_length=100)
    placement_date: date | None = None
    initial_bird_count: int | None = Field(default=None, gt=0)
    is_active: bool | None = None
