import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Sequence,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Role(enum.StrEnum):
    OWNER = "OWNER"
    WORKER = "WORKER"


class ConflictReason(enum.StrEnum):
    VERSION = "VERSION"  # same record edited on two devices
    DUPLICATE_DAY = "DUPLICATE_DAY"  # two records for the same house and day


class ConflictStatus(enum.StrEnum):
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"


class PhotoKind(enum.StrEnum):
    TRAY = "TRAY"  # UC13 egg tray photo
    HEALTH = "HEALTH"  # UC14 health observation photo


class TrayCategory(enum.StrEnum):
    GOOD_REMAINDER = "GOOD_REMAINDER"  # the last, partly filled tray of good eggs
    CRACKED = "CRACKED"
    DIRTY = "DIRTY"


class ObservationStatus(enum.StrEnum):
    NEW = "NEW"  # not opened by the owner yet ("Baru")
    SEEN = "SEEN"
    FORWARDED = "FORWARDED"  # sent to the veterinarian
    CLOSED = "CLOSED"


class ForwardChannel(enum.StrEnum):
    WHATSAPP = "WHATSAPP"
    EMAIL = "EMAIL"
    OTHER = "OTHER"


class ConflictResolution(enum.StrEnum):
    KEEP_SERVER = "KEEP_SERVER"
    TAKE_DEVICE = "TAKE_DEVICE"
    MERGED = "MERGED"


def _enum(cls: type[enum.Enum], name: str) -> Enum:
    # Stored as VARCHAR + CHECK, which is easier to migrate than a native PG enum.
    return Enum(cls, name=name, native_enum=False, length=20)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    full_name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(_enum(Role, "user_role"))
    is_active: Mapped[bool] = mapped_column(default=True)
    # Increased on password reset or deactivation; old tokens stop working.
    token_version: Mapped[int] = mapped_column(Integer, default=0)


class ChickenHouse(TimestampMixin, Base):
    __tablename__ = "chicken_houses"
    __table_args__ = (CheckConstraint("capacity > 0", name="capacity_positive"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    capacity: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(default=True)


class Flock(TimestampMixin, Base):
    __tablename__ = "flocks"
    __table_args__ = (
        CheckConstraint("initial_bird_count > 0", name="initial_bird_count_positive"),
        # One active flock per house.
        Index(
            "uq_flocks_one_active_per_house",
            "house_id",
            unique=True,
            postgresql_where=text("is_active"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    house_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chicken_houses.id"))
    breed: Mapped[str] = mapped_column(String(100))
    placement_date: Mapped[date] = mapped_column(Date)
    initial_bird_count: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(default=True)


# Global, ever-increasing number stamped on every change to a daily record.
# The pull cursor is the highest change_seq a device has seen.
change_seq = Sequence("daily_record_change_seq")


class DailyRecord(Base):
    __tablename__ = "daily_records"
    __table_args__ = (
        CheckConstraint(
            "eggs_good >= 0 AND eggs_cracked >= 0 AND eggs_rejected >= 0 AND eggs_dirty >= 0"
            " AND dead >= 0 AND culled >= 0",
            name="counts_not_negative",
        ),
        CheckConstraint("feed_kg > 0", name="feed_positive"),
        CheckConstraint("water_liters IS NULL OR water_liters >= 0", name="water_not_negative"),
        # One record per house per day, ignoring soft-deleted records.
        Index(
            "uq_daily_records_house_date",
            "house_id",
            "record_date",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    # Generated on the device, so pushing the same record twice never duplicates it.
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    house_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chicken_houses.id"))
    flock_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("flocks.id"))
    record_date: Mapped[date] = mapped_column(Date)
    eggs_good: Mapped[int] = mapped_column(Integer)
    eggs_cracked: Mapped[int] = mapped_column(Integer)
    eggs_rejected: Mapped[int] = mapped_column(Integer)
    eggs_dirty: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    feed_kg: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    water_liters: Mapped[Decimal | None] = mapped_column(Numeric(8, 1))
    dead: Mapped[int] = mapped_column(Integer)
    culled: Mapped[int] = mapped_column(Integer)
    notes: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    change_seq: Mapped[int] = mapped_column(BigInteger, change_seq, index=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    client_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    server_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SyncConflict(Base):
    __tablename__ = "sync_conflicts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # The record kept on the server.
    record_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("daily_records.id"))
    # The record id the device sent (differs from record_id for DUPLICATE_DAY).
    device_record_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    house_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chicken_houses.id"))
    record_date: Mapped[date] = mapped_column(Date)
    reason: Mapped[ConflictReason] = mapped_column(_enum(ConflictReason, "conflict_reason"))
    # The device copy, kept even after the conflict is resolved.
    device_payload: Mapped[dict] = mapped_column(JSONB)
    server_version: Mapped[int] = mapped_column(Integer)
    submitted_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    status: Mapped[ConflictStatus] = mapped_column(
        _enum(ConflictStatus, "conflict_status"), default=ConflictStatus.OPEN
    )
    resolution: Mapped[ConflictResolution | None] = mapped_column(
        _enum(ConflictResolution, "conflict_resolution")
    )
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Photo(Base):
    """A photo taken on a phone (ADR 0002). The file lives in settings.photo_dir."""

    __tablename__ = "photos"
    __table_args__ = (
        CheckConstraint(
            "(kind = 'TRAY' AND record_date IS NOT NULL AND tray_category IS NOT NULL)"
            " OR (kind = 'HEALTH' AND observation_id IS NOT NULL)",
            name="photo_parent",
        ),
        Index("ix_photos_house_date", "house_id", "record_date"),
    )

    # Generated on the phone, so uploading the same photo twice stores it once.
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    kind: Mapped[PhotoKind] = mapped_column(_enum(PhotoKind, "photo_kind"))
    house_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chicken_houses.id"))
    # TRAY photos belong to the daily record of this house and day.
    record_date: Mapped[date | None] = mapped_column(Date)
    tray_category: Mapped[TrayCategory | None] = mapped_column(_enum(TrayCategory, "tray_category"))
    # Eggs on the tray as counted by the worker: the training label for Iteration 3.
    label_count: Mapped[int | None] = mapped_column(Integer)
    # HEALTH photos belong to a health observation.
    observation_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    file_path: Mapped[str] = mapped_column(String(255))  # relative to settings.photo_dir
    size_bytes: Mapped[int] = mapped_column(Integer)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    uploaded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class HealthObservation(Base):
    """UC14: what a worker saw in a house. Never a diagnosis (see CLAUDE.md)."""

    __tablename__ = "health_observations"
    __table_args__ = (
        CheckConstraint(
            "affected_count IS NULL OR affected_count >= 0", name="affected_not_negative"
        ),
        Index("ix_health_observations_status", "status"),
    )

    # Generated on the phone, so sending it twice stores it once.
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    house_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chicken_houses.id"))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Codes from app.symptoms.SYMPTOMS.
    symptoms: Mapped[list[str]] = mapped_column(JSONB, default=list)
    other_symptoms: Mapped[str] = mapped_column(Text, default="")
    affected_count: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[ObservationStatus] = mapped_column(
        _enum(ObservationStatus, "observation_status"), default=ObservationStatus.NEW
    )
    forwarded_via: Mapped[ForwardChannel | None] = mapped_column(
        _enum(ForwardChannel, "forward_channel")
    )
    vet_advice: Mapped[str] = mapped_column(Text, default="")
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    forwarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
