import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useLocation } from 'react-router-dom'
import type { LocalObservation } from '../../db/db'
import { removeObservation } from '../../db/observations'
import { formatDateTime } from '../../lib/format'
import { STATUS_LABELS, symptomText } from '../../lib/symptoms'
import { useWorker } from '../../sync/WorkerContext'

function statusOf(o: LocalObservation): { text: string; badge: string } {
  if (o.sync_status === 'pending') return { text: 'Menunggu dikirim', badge: 'warn' }
  if (o.sync_status === 'rejected') return { text: 'Ditolak', badge: 'bad' }
  const status = o.status ?? 'NEW'
  if (status === 'NEW') return { text: 'Terkirim, belum dilihat', badge: '' }
  return { text: STATUS_LABELS[status], badge: 'ok' }
}

export default function HealthList() {
  const { db, sync } = useWorker()
  const location = useLocation()
  const saved = (location.state as { saved?: boolean } | null)?.saved
  const houses = useLiveQuery(() => db.houses.toArray(), [db], [])
  const observations = useLiveQuery(
    () => db.observations.orderBy('observed_at').reverse().toArray(),
    [db],
  )
  const houseName = (id: string) => houses.find((h) => h.id === id)?.name ?? 'Kandang'

  return (
    <>
      <Link className="tap-link" to="/">
        ← Kembali
      </Link>
      <h1 style={{ marginTop: 8 }}>Laporan kesehatan</h1>
      {saved && (
        <div className="alert success" role="status" style={{ marginBottom: 12 }}>
          Laporan tersimpan di HP.{' '}
          {sync.online ? 'Sedang dikirim ke pemilik.' : 'Akan dikirim otomatis saat ada sinyal.'}
        </div>
      )}
      <Link className="button" to="/kesehatan/baru" style={{ marginBottom: 16, display: 'flex' }}>
        Laporkan kesehatan ayam
      </Link>

      {observations?.length === 0 && <p className="muted">Belum ada laporan.</p>}
      {observations && observations.length > 0 && (
        <section className="card">
          <ul className="item-list">
            {observations.map((o) => {
              const status = statusOf(o)
              return (
                <li key={o.id} className="stack">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong>{houseName(o.house_id)}</strong>
                    <span className={`badge ${status.badge}`}>{status.text}</span>
                  </div>
                  <span className="muted">{formatDateTime(o.observed_at)}</span>
                  <span>{symptomText(o.symptoms, o.other_symptoms)}</span>
                  {o.errors && (
                    <span className="field-error">{Object.values(o.errors).join(' ')}</span>
                  )}
                  {o.vet_advice && (
                    <div className="alert success">
                      <strong>Saran dokter hewan:</strong> {o.vet_advice}
                    </div>
                  )}
                  {o.sync_status !== 'synced' && (
                    <button className="small danger" style={{ alignSelf: 'flex-start' }}
                      onClick={() => {
                        if (window.confirm('Hapus laporan ini dari HP?')) removeObservation(db, o.id)
                      }}>
                      Hapus laporan
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </>
  )
}
