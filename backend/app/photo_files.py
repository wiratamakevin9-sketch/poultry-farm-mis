"""Checking, cleaning and storing uploaded photos."""

import io
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import settings

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}

# Large phone photos are fine; this only stops decompression bombs.
Image.MAX_IMAGE_PIXELS = 50_000_000


class InvalidImage(ValueError):
    pass


def clean_image(data: bytes) -> tuple[bytes, int, int]:
    """Return (jpeg bytes, width, height).

    The photo is turned upright, scaled down to settings.max_photo_side and saved as a
    new JPEG. Re-encoding drops all metadata, including the GPS location (EXIF).
    """
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format not in ALLOWED_FORMATS:
                raise InvalidImage("Foto harus berformat JPEG, PNG atau WebP.")
            image = ImageOps.exif_transpose(image)
            image = image.convert("RGB")
            image.thumbnail((settings.max_photo_side, settings.max_photo_side))
            out = io.BytesIO()
            image.save(out, format="JPEG", quality=85, optimize=True)
            return out.getvalue(), image.width, image.height
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise InvalidImage("File ini bukan foto yang valid.") from None


def photo_root() -> Path:
    return Path(settings.photo_dir)


def store(photo_id: uuid.UUID, jpeg: bytes) -> str:
    """Write the file and return its path relative to the photo folder."""
    now = datetime.now(UTC)
    relative = Path(f"{now:%Y}") / f"{now:%m}" / f"{photo_id}.jpg"
    target = photo_root() / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(".tmp")
    temp.write_bytes(jpeg)
    os.replace(temp, target)  # atomic: a half-written file is never visible
    return relative.as_posix()


def full_path(relative: str) -> Path:
    return photo_root() / relative


def remove(relative: str) -> None:
    full_path(relative).unlink(missing_ok=True)
