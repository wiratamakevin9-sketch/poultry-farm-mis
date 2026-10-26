import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from app.farm_time import farm_date
from app.schemas import RecordIn
from app.validation import validate_record

TODAY = date(2026, 10, 26)


def make(**changes) -> RecordIn:
    values = {
        "id": uuid.uuid4(),
        "house_id": uuid.uuid4(),
        "record_date": TODAY,
        "eggs_good": 4000,
        "eggs_cracked": 20,
        "eggs_rejected": 10,
        "feed_kg": Decimal(550),
        "dead": 2,
        "culled": 1,
        "client_updated_at": datetime(2026, 10, 26, 2, 0, tzinfo=UTC),
    }
    return RecordIn(**(values | changes))


def check(
    record: RecordIn, live_birds: int = 5000, edited_on: date = TODAY, is_edit: bool = False
) -> dict[str, str]:
    return validate_record(record, live_birds, TODAY, edited_on, is_edit)


def test_valid_record_has_no_errors() -> None:
    assert check(make()) == {}


def test_negative_counts_rejected() -> None:
    errors = check(make(eggs_cracked=-1, dead=-2))
    assert errors["eggs_cracked"] == "Telur retak tidak boleh negatif."
    assert errors["dead"] == "Ayam mati tidak boleh negatif."


def test_total_eggs_cannot_exceed_live_birds() -> None:
    errors = check(make(eggs_good=4990, eggs_cracked=10, eggs_rejected=1))
    assert errors["eggs_good"] == (
        "Total telur (5.001) tidak boleh lebih dari jumlah ayam hidup (5.000)."
    )
    assert check(make(eggs_good=4980, eggs_cracked=10, eggs_rejected=10)) == {}


def test_dead_plus_culled_cannot_exceed_live_birds() -> None:
    errors = check(
        make(eggs_good=0, eggs_cracked=0, eggs_rejected=0, dead=60, culled=41),
        live_birds=100,
    )
    assert "dead" in errors
    record = make(
        eggs_good=0, eggs_cracked=0, eggs_rejected=0, dead=60, culled=40, feed_kg=Decimal(10)
    )
    assert check(record, live_birds=100) == {}


def test_feed_must_be_positive() -> None:
    assert check(make(feed_kg=Decimal(0)))["feed_kg"] == "Pakan harus lebih dari 0 kg."


def test_feed_limit_is_200_grams_per_bird() -> None:
    assert check(make(feed_kg=Decimal(1000))) == {}
    errors = check(make(feed_kg=Decimal("1000.01")))
    assert errors["feed_kg"] == "Pakan maksimal 1.000 kg (0,2 kg × 5.000 ekor)."


def test_water_is_optional_but_not_negative() -> None:
    assert check(make(water_liters=None)) == {}
    assert "water_liters" in check(make(water_liters=Decimal(-1)))


def test_future_date_rejected() -> None:
    errors = check(make(record_date=date(2026, 10, 27)))
    assert errors["record_date"] == "Tanggal tidak boleh di masa depan."


def test_edit_allowed_for_today_and_yesterday_only() -> None:
    assert check(make(record_date=date(2026, 10, 25)), is_edit=True) == {}
    errors = check(make(record_date=date(2026, 10, 24)), is_edit=True)
    assert errors["record_date"] == "Catatan hanya bisa diubah untuk hari ini atau kemarin."


def test_edit_made_offline_yesterday_is_accepted_today() -> None:
    # Worker edited the 24th on the 25th while offline; the phone syncs on the 26th.
    record = make(record_date=date(2026, 10, 24))
    assert check(record, edited_on=date(2026, 10, 25), is_edit=True) == {}


def test_new_record_for_older_date_is_allowed() -> None:
    assert check(make(record_date=date(2026, 10, 20)), is_edit=False) == {}


def test_farm_date_uses_wita() -> None:
    # 16:30 UTC is already 00:30 the next day in Bali (UTC+8).
    assert farm_date(datetime(2026, 10, 25, 16, 30, tzinfo=UTC)) == date(2026, 10, 26)
    assert farm_date(datetime(2026, 10, 25, 15, 59, tzinfo=UTC)) == date(2026, 10, 25)
