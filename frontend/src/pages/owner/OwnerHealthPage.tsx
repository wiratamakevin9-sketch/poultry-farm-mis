import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { OwnerObservation } from '../../api/types'
import { formatDateTime, formatNumber } from '../../lib/format'
import { STATUS_LABELS, symptomText } from '../../lib/symptoms'

const BADGE = { NEW: 'warn', SEEN: '', FORWARDED: 'ok', CLOSED: 'ok' } as const

export default function OwnerHealthPage() {
  const [observations, setObservations] = useState<OwnerObservation[] | null>(null)
  const [error, setError] = useState('')
  const [showClosed, setShowClosed] = useState(false)

  useEffect(() => {
    api<OwnerObservation[]>('/health-observations').then(setObservations, (err) =>
      setError((err as Error).message),
    )
  }, [])

  const visible = observations?.filter((o) => showClosed || o.status !== 'CLOSED') ?? []
  // New ones first, then the most recent.
  const sorted = [...visible].sort(
    (a, b) =>
      Number(b.status === 'NEW') - Number(a.status === 'NEW') ||
      b.observed_at.localeCompare(a.observed_at),
  )

  return (
    <>
      <h1>Kesehatan ayam</h1>
      <p className="muted">
        Laporan dari pekerja. Buka laporan untuk meneruskannya ke dokter hewan sebagai PDF.
      </p>
      {error && <div className="alert">{error}</div>}
      <label className="check" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
        <span>Tampilkan yang sudah selesai</span>
      </label>

      {observations === null ? (
        <p className="muted">Memuat…</p>
      ) : sorted.length === 0 ? (
        <div className="alert success">Tidak ada laporan yang perlu ditindaklanjuti.</div>
      ) : (
        sorted.map((o) => (
          <Link key={o.id} to={`/pemilik/kesehatan/${o.id}`} className="house-button">
            <span>
              <span className="house-button__name">{o.house_name}</span>
              <br />
              <span className="muted">
                {formatDateTime(o.observed_at)} · {o.created_by_name}
                {o.affected_count !== null && ` · ±${formatNumber(o.affected_count)} ekor`}
              </span>
              <br />
              <span>{symptomText(o.symptoms, o.other_symptoms)}</span>
            </span>
            <span className={`badge ${BADGE[o.status]}`}>
              {o.status === 'NEW' ? 'Baru' : STATUS_LABELS[o.status]}
            </span>
          </Link>
        ))
      )}
    </>
  )
}
