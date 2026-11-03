import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, apiBlob } from '../../api/client'
import type { DashboardAlerts, House, WeeklyReport, WeeklyRow } from '../../api/types'
import { formatDate, formatNumber } from '../../lib/format'
import { downloadBlob } from '../../lib/share'
import TrendChart, { type TrendPoint } from './TrendChart'

type Measure = 'hdp' | 'fcr' | 'mortality_pct'

function shortDate(iso: string): string {
  return formatDate(iso).replace(/ \d{4}$/, '') // "2 Nov 2026" -> "2 Nov"
}

/** One row per week, one column per house: what a line chart per house needs. */
function series(report: WeeklyReport, measure: Measure): TrendPoint[] {
  return report.weeks.map((week) => {
    const point: TrendPoint = { week: shortDate(week) }
    for (const row of report.rows.filter((r) => r.week_start === week)) {
      point[row.house_name] = row[measure]
    }
    return point
  })
}

function perDay(row: WeeklyRow | undefined): number | null {
  return row && row.days > 0 ? Math.round(row.eggs / row.days) : null
}

function Tile({ label, value, previous, unit, digits, lowerIsBetter = false }: {
  label: string
  value: number | null | undefined
  previous: number | null | undefined
  unit: string
  digits: number
  lowerIsBetter?: boolean
}) {
  const change = value != null && previous != null ? value - previous : null
  const better = change === null || change === 0 ? null : (change < 0) === lowerIsBetter
  return (
    <div className="kpi">
      <span className="muted">{label}</span>
      <strong>{value != null ? `${formatNumber(value, digits)}${unit}` : '–'}</strong>
      {change !== null && (
        <span className="kpi__change">
          {change > 0 ? '▲' : change < 0 ? '▼' : '='} {formatNumber(Math.abs(change), digits)}
          {unit} dari minggu lalu{better === null ? '' : better ? ' (lebih baik)' : ' (lebih buruk)'}
        </span>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const [weeks, setWeeks] = useState(12)
  const [report, setReport] = useState<WeeklyReport | null>(null)
  const [alerts, setAlerts] = useState<DashboardAlerts | null>(null)
  const [houses, setHouses] = useState<string[]>([])
  const [showTable, setShowTable] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [r, a, h] = await Promise.all([
        api<WeeklyReport>(`/reports/weekly?weeks=${weeks}`),
        api<DashboardAlerts>('/reports/alerts'),
        api<House[]>('/houses'),
      ])
      setReport(r)
      setAlerts(a)
      // Every house in name order, so a house keeps its colour whatever is shown.
      setHouses(h.map((x) => x.name).sort((a, b) => a.localeCompare(b, 'id', { numeric: true })))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [weeks])

  useEffect(() => {
    load()
  }, [load])

  async function download(kind: 'csv' | 'pdf') {
    try {
      const blob = await apiBlob(`/reports/weekly.${kind}?weeks=${weeks}`)
      downloadBlob(blob, `laporan-mingguan.${kind}`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const thisWeek = report?.farm.find((r) => r.week_start === report.weeks.at(-1))
  const lastWeek = report?.farm.find((r) => r.week_start === report.weeks.at(-2))
  const alertItems = alerts
    ? [
        alerts.feed_low && {
          to: '/pemilik/stok',
          text: `Stok pakan menipis${alerts.feed_days_left !== null ? ` (± ${formatNumber(Math.max(0, alerts.feed_days_left), 1)} hari)` : ''}`,
        },
        alerts.overdue_vaccinations > 0 && { to: '/pemilik/jadwal', text: `${alerts.overdue_vaccinations} vaksinasi terlewat` },
        alerts.vaccinations_today > 0 && { to: '/pemilik/jadwal', text: `${alerts.vaccinations_today} vaksinasi hari ini` },
        alerts.new_health_reports > 0 && { to: '/pemilik/kesehatan', text: `${alerts.new_health_reports} laporan kesehatan baru` },
        alerts.withheld_eggs > 0 && { to: '/pemilik/stok', text: `${formatNumber(alerts.withheld_eggs)} telur ditahan (masa henti obat)` },
        alerts.open_conflicts > 0 && { to: '/pemilik/konflik', text: `${alerts.open_conflicts} data bentrok` },
      ].filter((x): x is { to: string; text: string } => Boolean(x))
    : []

  return (
    <>
      <h1>Dashboard</h1>
      {error && <div className="alert" style={{ marginBottom: 12 }}>{error}</div>}

      {alertItems.length > 0 && (
        <section className="card stack" aria-label="Perlu perhatian">
          <h2 style={{ margin: 0 }}>Perlu perhatian</h2>
          <ul className="item-list">
            {alertItems.map((item) => (
              <li key={item.text}>
                <Link className="tap-link" to={item.to}>⚠ {item.text}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-label="Minggu ini">
        <h2 style={{ marginBottom: 4 }}>Minggu ini · semua kandang</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {thisWeek ? `${thisWeek.days} hari tercatat sejak ${formatDate(thisWeek.week_start)}` : 'Belum ada catatan minggu ini.'}
        </p>
        <div className="kpi-grid">
          <Tile label="HDP" value={thisWeek?.hdp} previous={lastWeek?.hdp} unit="%" digits={1} />
          <Tile label="FCR" value={thisWeek?.fcr} previous={lastWeek?.fcr} unit="" digits={2} lowerIsBetter />
          <Tile label="Kematian" value={thisWeek?.mortality_pct} previous={lastWeek?.mortality_pct} unit="%" digits={2} lowerIsBetter />
          {/* Per day, so a week that has only just started compares fairly. */}
          <Tile label="Telur per hari" value={perDay(thisWeek)} previous={perDay(lastWeek)} unit="" digits={0} />
        </div>
      </section>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <label className="inline-label">
          Periode
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            <option value={4}>4 minggu</option>
            <option value={12}>12 minggu</option>
            <option value={26}>26 minggu</option>
          </select>
        </label>
        <div className="row">
          <button className="small secondary" onClick={() => download('csv')}>Ekspor CSV</button>
          <button className="small secondary" onClick={() => download('pdf')}>Ekspor PDF</button>
        </div>
      </div>

      {report && (
        <>
          <TrendChart title="HDP per kandang (%)" unit="%" digits={1} houses={houses} data={series(report, 'hdp')} />
          <TrendChart title="FCR per kandang" unit="" digits={2} houses={houses} data={series(report, 'fcr')} />
          <TrendChart title="Kematian per kandang (%)" unit="%" digits={2} houses={houses} data={series(report, 'mortality_pct')} />
          <p className="muted">
            FCR = kg pakan ÷ kg telur (berat telur {report.egg_weight_g} g). Kematian = ayam mati ÷
            ayam di awal minggu.
          </p>

          <button className="secondary" onClick={() => setShowTable((v) => !v)} style={{ marginBottom: 12 }}>
            {showTable ? 'Sembunyikan tabel' : 'Lihat tabel angka'}
          </button>
          {showTable && <ReportTable rows={[...report.farm, ...report.rows]} />}
        </>
      )}
    </>
  )
}

function ReportTable({ rows }: { rows: WeeklyRow[] }) {
  const show = (v: number | null, digits: number) => (v === null ? '–' : formatNumber(v, digits))
  return (
    <section className="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>Minggu</th>
            <th>Kandang</th>
            <th className="num">Telur</th>
            <th className="num">HDP %</th>
            <th className="num">FCR</th>
            <th className="num">Mati</th>
            <th className="num">Kematian %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.house_name}-${r.week_start}`}>
              <td>{shortDate(r.week_start)}</td>
              <td>{r.house_id ? r.house_name : <strong>{r.house_name}</strong>}</td>
              <td className="num">{formatNumber(r.eggs)}</td>
              <td className="num">{show(r.hdp, 1)}</td>
              <td className="num">{show(r.fcr, 2)}</td>
              <td className="num">{formatNumber(r.dead)}</td>
              <td className="num">{show(r.mortality_pct, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
