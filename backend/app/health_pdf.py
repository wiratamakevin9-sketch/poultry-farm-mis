"""PDF of a health observation, for the owner to send to the veterinarian (UC14)."""

from datetime import UTC, datetime

from fpdf import FPDF
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.birds import live_birds
from app.farm_time import FARM_TZ
from app.models import ChickenHouse, Flock, HealthObservation, Photo, User
from app.photo_files import full_path
from app.symptoms import SYMPTOMS

FARM_NAME = "Peternakan Beneng Bahagia"
FARM_PLACE = "Getakan, Klungkung, Bali"
DISCLAIMER = (
    "Laporan ini berisi pengamatan pekerja kandang, bukan diagnosis. "
    "Mohon pemeriksaan dan saran dokter hewan."
)
MONTHS = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
]  # fmt: skip


def wita(moment: datetime) -> str:
    """'29 Oktober 2026, 14.05 WITA'"""
    local = moment.astimezone(FARM_TZ)
    return f"{local.day} {MONTHS[local.month - 1]} {local.year}, {local:%H.%M} WITA"


def latin(text: str) -> str:
    """The built-in PDF fonts only know Latin-1; replace anything else (e.g. emoji)."""
    replacements = {"–": "-", "—": "-", "‘": "'", "’": "'",
                    "“": '"', "”": '"', "×": "x"}  # fmt: skip
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text.encode("latin-1", "replace").decode("latin-1")


def _fmt(number: int) -> str:
    return f"{number:,}".replace(",", ".")


class _Pdf(FPDF):
    def footer(self) -> None:
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(100)
        self.cell(0, 10, f"{FARM_NAME} - halaman {self.page_no()}", align="C")


def build_pdf(db: Session, observation: HealthObservation) -> bytes:
    house = db.get(ChickenHouse, observation.house_id)
    reporter = db.get(User, observation.created_by)
    flock = db.scalar(select(Flock).where(Flock.house_id == house.id, Flock.is_active))
    photos = list(
        db.scalars(
            select(Photo).where(Photo.observation_id == observation.id).order_by(Photo.taken_at)
        )
    )

    pdf = _Pdf(format="A4")
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()
    width = pdf.epw

    pdf.set_font("Helvetica", "B", 16)
    pdf.multi_cell(width, 8, "Laporan Pengamatan Kesehatan Ayam", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(80)
    pdf.multi_cell(width, 5, f"{FARM_NAME}, {FARM_PLACE}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    pdf.set_text_color(0)
    rows = [
        ("Kandang", house.name),
        ("Waktu pengamatan", wita(observation.observed_at)),
        ("Dilaporkan oleh", reporter.full_name),
    ]
    if flock is not None:
        rows.append(("Ayam di kandang", f"{_fmt(live_birds(db, flock))} ekor ({flock.breed})"))
    if observation.affected_count is not None:
        rows.append(("Perkiraan ayam terkena", f"{_fmt(observation.affected_count)} ekor"))
    for label, value in rows:
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(55, 7, latin(label))
        pdf.set_font("Helvetica", "", 11)
        pdf.multi_cell(width - 55, 7, latin(value), new_x="LMARGIN", new_y="NEXT")

    def section(title: str, body: str) -> None:
        pdf.ln(3)
        pdf.set_font("Helvetica", "B", 12)
        pdf.multi_cell(width, 7, latin(title), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 11)
        pdf.multi_cell(width, 6, latin(body), new_x="LMARGIN", new_y="NEXT")

    symptoms = [f"- {SYMPTOMS.get(code, code)}" for code in observation.symptoms]
    if observation.other_symptoms:
        symptoms.append(f"- Lainnya: {observation.other_symptoms}")
    section("Gejala yang terlihat", "\n".join(symptoms))
    if observation.notes:
        section("Catatan pekerja", observation.notes)
    if observation.vet_advice:
        section("Saran dokter hewan", observation.vet_advice)

    pdf.ln(4)
    pdf.set_fill_color(255, 251, 235)
    pdf.set_font("Helvetica", "I", 10)
    pdf.multi_cell(
        width, 6, DISCLAIMER, border=1, fill=True, padding=2, new_x="LMARGIN", new_y="NEXT"
    )

    for number, photo in enumerate(photos, start=1):
        path = full_path(photo.file_path)
        if not path.exists():
            continue
        # Fit each photo to the page width, at most half a page high.
        height = min(width * photo.height / photo.width, pdf.eph / 2)
        if pdf.get_y() + height + 12 > pdf.page_break_trigger:
            pdf.add_page()
        pdf.ln(4)
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(width, 7, f"Foto {number} - {wita(photo.taken_at)}", new_x="LMARGIN", new_y="NEXT")
        pdf.image(str(path), h=height, keep_aspect_ratio=True, w=width)

    pdf.ln(4)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(100)
    pdf.multi_cell(width, 5, f"Dibuat {wita(datetime.now(UTC))}", new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def pdf_filename(db: Session, observation: HealthObservation) -> str:
    house = db.get(ChickenHouse, observation.house_id).name.replace(" ", "-").lower()
    day = observation.observed_at.astimezone(FARM_TZ).date().isoformat()
    return f"laporan-kesehatan-{house}-{day}.pdf"
