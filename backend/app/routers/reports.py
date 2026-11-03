"""Owner dashboard: weekly HDP, FCR and mortality, alerts, and CSV/PDF exports."""

import csv
import io
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Query, Response
from fpdf import FPDF
from sqlalchemy import func, select

from app.deps import DbSession, OwnerUser
from app.farm_time import farm_today
from app.health_pdf import FARM_NAME, latin, wita
from app.models import (
    ConflictStatus,
    EggGrade,
    HealthObservation,
    ObservationStatus,
    SyncConflict,
    VaccinationSchedule,
)
from app.reports import weekly_report
from app.routers.stock import get_feed_stock
from app.schemas import DashboardAlerts, WeeklyReport
from app.stock import egg_stock

router = APIRouter(prefix="/api/reports", tags=["reports"])

Weeks = Query(default=12, ge=1, le=104)

COLUMNS = [
    ("week_start", "Minggu mulai"),
    ("house_name", "Kandang"),
    ("days", "Hari tercatat"),
    ("eggs", "Telur (butir)"),
    ("hdp", "HDP (%)"),
    ("feed_kg", "Pakan (kg)"),
    ("fcr", "FCR"),
    ("feed_per_bird_g", "Pakan/ekor/hari (g)"),
    ("birds_start", "Ayam awal minggu"),
    ("dead", "Mati"),
    ("culled", "Afkir"),
    ("mortality_pct", "Kematian (%)"),
]


@router.get("/weekly")
def weekly(
    db: DbSession, _: OwnerUser, weeks: int = Weeks, house_id: uuid.UUID | None = None
) -> WeeklyReport:
    return WeeklyReport(**weekly_report(db, farm_today(), weeks, house_id))


@router.get("/alerts")
def alerts(db: DbSession, owner: OwnerUser) -> DashboardAlerts:
    today = farm_today()
    feed = get_feed_stock(db, owner)
    vaccinations = select(func.count()).select_from(VaccinationSchedule)
    not_done = VaccinationSchedule.done_at.is_(None)
    return DashboardAlerts(
        feed_low=feed.low,
        feed_days_left=feed.days_left,
        withheld_eggs=egg_stock(db)[EggGrade.WITHHELD],
        overdue_vaccinations=db.scalar(
            vaccinations.where(not_done, VaccinationSchedule.scheduled_date < today)
        ),
        vaccinations_today=db.scalar(
            vaccinations.where(not_done, VaccinationSchedule.scheduled_date == today)
        ),
        new_health_reports=db.scalar(
            select(func.count())
            .select_from(HealthObservation)
            .where(HealthObservation.status == ObservationStatus.NEW)
        ),
        open_conflicts=db.scalar(
            select(func.count())
            .select_from(SyncConflict)
            .where(SyncConflict.status == ConflictStatus.OPEN)
        ),
    )


def _all_rows(report: dict) -> list[dict]:
    return report["rows"] + report["farm"]


def _cell(value) -> str:
    return "" if value is None else str(value)


@router.get("/weekly.csv")
def weekly_csv(db: DbSession, _: OwnerUser, weeks: int = Weeks) -> Response:
    report = weekly_report(db, farm_today(), weeks)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([title for _, title in COLUMNS])
    for row in _all_rows(report):
        writer.writerow([_cell(row[key]) for key, _ in COLUMNS])
    # The BOM lets Excel open the file as UTF-8.
    return Response(
        "﻿" + out.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="laporan-mingguan-{farm_today()}.csv"'
        },
    )


@router.get("/weekly.pdf")
def weekly_pdf(db: DbSession, _: OwnerUser, weeks: int = Weeks) -> Response:
    report = weekly_report(db, farm_today(), weeks)
    pdf = FPDF(orientation="landscape", format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 15)
    pdf.cell(0, 8, f"Laporan Produksi Mingguan - {FARM_NAME}", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(
        0,
        6,
        f"{weeks} minggu terakhir · dibuat {wita(datetime.now(UTC))} · "
        f"FCR dengan berat telur {report['egg_weight_g']} g · HDP dan FCR memakai semua telur",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(2)

    def table(title: str, rows: list[dict]) -> None:
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 7, latin(title), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 8)
        with pdf.table(
            col_widths=(20, 22, 12, 18, 13, 16, 12, 18, 18, 10, 10, 15),
            text_align="RIGHT",
            line_height=5,
        ) as t:
            t.row([latin(title) for _, title in COLUMNS])
            for row in rows:
                t.row([latin(_cell(row[key])) for key, _ in COLUMNS])
        pdf.ln(3)

    table("Seluruh peternakan", report["farm"])
    for house in sorted({r["house_name"] for r in report["rows"]}):
        table(house, [r for r in report["rows"] if r["house_name"] == house])

    return Response(
        bytes(pdf.output()),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="laporan-mingguan-{farm_today()}.pdf"'
        },
    )
