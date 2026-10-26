from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from app.config import settings

FARM_TZ = ZoneInfo(settings.farm_timezone)


def farm_date(moment: datetime) -> date:
    """The calendar date at the farm (WITA) for a moment in time."""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(FARM_TZ).date()


def farm_today() -> date:
    return farm_date(datetime.now(UTC))
