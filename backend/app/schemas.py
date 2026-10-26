import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models import ConflictReason, ConflictResolution, ConflictStatus, Role


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


# ---------- daily records ----------


class RecordIn(BaseModel):
    """A daily record as sent by a device. Business rules live in app.validation."""

    id: uuid.UUID
    house_id: uuid.UUID
    record_date: date
    eggs_good: int
    eggs_cracked: int
    eggs_rejected: int
    feed_kg: Decimal
    water_liters: Decimal | None = None
    dead: int
    culled: int
    notes: str = Field(default="", max_length=500)
    # Server version the device last saw; 0 for a record created on the device.
    base_version: int = Field(default=0, ge=0)
    # When the worker saved it on the device.
    client_updated_at: datetime


class RecordOut(ORMModel):
    id: uuid.UUID
    house_id: uuid.UUID
    flock_id: uuid.UUID
    record_date: date
    eggs_good: int
    eggs_cracked: int
    eggs_rejected: int
    feed_kg: Decimal
    water_liters: Decimal | None
    dead: int
    culled: int
    notes: str
    version: int
    change_seq: int
    created_by: uuid.UUID
    updated_by: uuid.UUID
    client_updated_at: datetime
    server_updated_at: datetime
    deleted: bool = False


class OwnerRecordOut(RecordOut):
    house_name: str
    created_by_name: str
    updated_by_name: str
    live_birds: int  # at the start of the day
    hdp: float  # hen-day production, %
    feed_per_bird_g: float


# ---------- sync ----------


class PushRequest(BaseModel):
    # Raw dicts so one bad record is rejected on its own instead of failing the batch.
    records: list[dict] = Field(max_length=500)


class PushResult(BaseModel):
    id: str
    status: str  # accepted | conflict | rejected
    version: int | None = None
    conflict_id: uuid.UUID | None = None
    errors: dict[str, str] = {}


class PushResponse(BaseModel):
    results: list[PushResult]


class ConflictOut(ORMModel):
    id: uuid.UUID
    record_id: uuid.UUID
    device_record_id: uuid.UUID
    house_id: uuid.UUID
    house_name: str
    record_date: date
    reason: ConflictReason
    status: ConflictStatus
    resolution: ConflictResolution | None
    device_payload: dict
    server_record: RecordOut
    submitted_by: uuid.UUID
    submitted_by_name: str
    created_at: datetime
    # True when the person asking may resolve it now (worker: own conflict within the
    # edit window; owner: after the edit window).
    can_resolve: bool


class PullResponse(BaseModel):
    records: list[RecordOut]
    cursor: int
    has_more: bool
    houses: list[HouseOut]
    conflicts: list[ConflictOut]
    server_today: date


class RecordValues(BaseModel):
    eggs_good: int
    eggs_cracked: int
    eggs_rejected: int
    feed_kg: Decimal
    water_liters: Decimal | None = None
    dead: int
    culled: int
    notes: str = Field(default="", max_length=500)


class ResolveRequest(BaseModel):
    resolution: ConflictResolution
    # The server version shown on screen; refused if the record changed since.
    server_version: int
    # Required for MERGED.
    values: RecordValues | None = None
