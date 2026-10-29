"""Business rules for daily records.

The phone checks the same rules (frontend/src/lib/validation.ts) so the worker sees
errors while typing. The server checks again because it is the source of truth.
All messages are shown to the worker, so they are in Bahasa Indonesia.
"""

from datetime import date, timedelta
from decimal import Decimal

from app.schemas import RecordIn

MAX_FEED_KG_PER_BIRD = Decimal("0.2")

COUNT_LABELS = {
    "eggs_good": "Telur bagus",
    "eggs_cracked": "Telur retak",
    "eggs_rejected": "Telur afkir",
    "eggs_dirty": "Telur kotor",
    "dead": "Ayam mati",
    "culled": "Ayam afkir",
}


def fmt(value: Decimal | int) -> str:
    """Indonesian number format: 1.234,5"""
    text = f"{value:,}" if isinstance(value, int) else f"{value.normalize():,f}"
    return text.replace(",", "_").replace(".", ",").replace("_", ".")


def validate_record(
    record: RecordIn,
    live_birds: int,
    today: date,
    edited_on: date,
    check_window: bool = True,
) -> dict[str, str]:
    """Return {field: message} for every broken rule; empty means valid.

    live_birds: live birds at the start of the record's day.
    today: today's date at the farm, from the server clock.
    edited_on: farm date when the worker saved the record on the device.
    check_window: False only when the owner resolves an old conflict.
    """
    errors: dict[str, str] = {}

    for field, label in COUNT_LABELS.items():
        if getattr(record, field) < 0:
            errors[field] = f"{label} tidak boleh negatif."

    total_eggs = record.eggs_good + record.eggs_cracked + record.eggs_rejected + record.eggs_dirty
    if "eggs_good" not in errors and total_eggs > live_birds:
        errors["eggs_good"] = (
            f"Total telur ({fmt(total_eggs)}) tidak boleh lebih dari "
            f"jumlah ayam hidup ({fmt(live_birds)})."
        )

    if "dead" not in errors and "culled" not in errors and record.dead + record.culled > live_birds:
        errors["dead"] = (
            f"Ayam mati + afkir ({fmt(record.dead + record.culled)}) tidak boleh lebih dari "
            f"jumlah ayam hidup ({fmt(live_birds)})."
        )

    max_feed = MAX_FEED_KG_PER_BIRD * live_birds
    if record.feed_kg <= 0:
        errors["feed_kg"] = "Pakan harus lebih dari 0 kg."
    elif record.feed_kg > max_feed:
        errors["feed_kg"] = f"Pakan maksimal {fmt(max_feed)} kg (0,2 kg × {fmt(live_birds)} ekor)."

    if record.water_liters is not None and record.water_liters < 0:
        errors["water_liters"] = "Air minum tidak boleh negatif."

    if record.record_date > today:
        errors["record_date"] = "Tanggal tidak boleh di masa depan."
    elif check_window and record.record_date < edited_on - timedelta(days=1):
        # Judged by when the worker saved it, so an edit made offline yesterday is
        # still accepted when the phone only syncs today.
        errors["record_date"] = "Catatan hanya bisa diisi atau diubah untuk hari ini atau kemarin."

    return errors
