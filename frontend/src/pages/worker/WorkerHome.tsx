import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { LocalRecord } from '../../db/db'
import { addDays, farmDate } from '../../lib/farmDate'
import { formatDate, formatNumber } from '../../lib/format'
import { useWorker } from '../../sync/WorkerContext'

const STATUS: Record<LocalRecord['sync_status'], { text: string; badge: string }> = {
  pending: { text: 'Menunggu dikirim', badge: 'warn' },
  synced: { text: 'Sudah terkirim', badge: 'ok' },
  rejected: { text: 'Ditolak, perlu diperbaiki', badge: 'bad' },
  conflict: { text: 'Konflik', badge: 'bad' },
}

export default function WorkerHome() {
  const { db, sync } = useWorker()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const today = farmDate()
  const yesterday = addDays(today, -1)
  const day = params.get('tanggal') === 'kemarin' ? yesterday : today
  const saved = (location.state as { saved?: string } | null)?.saved

  const houses = useLiveQuery(
    async () => (await db.houses.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'id')),
    [db],
  )
  const records = useLiveQuery(
    () => db.records.filter((r) => r.record_date === day).toArray(),
    [db, day],
  )
  const byHouse = new Map((records ?? []).map((r) => [r.house_id, r]))

  return (
    <>
      {saved && (
        <div className="alert success" role="status" style={{ marginBottom: 12 }}>
          Data {saved} tersimpan di HP.{' '}
          {sync.online ? 'Sedang dikirim ke server.' : 'Akan dikirim otomatis saat ada sinyal.'}
        </div>
      )}
      {sync.error && (
        <div className="alert" role="alert" style={{ marginBottom: 12 }}>
          {sync.error}
        </div>
      )}
      {sync.conflicts > 0 && (
        <div className="alert warning" style={{ marginBottom: 12 }}>
          Ada {sync.conflicts} data yang bentrok dengan data pekerja lain.{' '}
          <Link className="tap-link" to="/konflik">
            Selesaikan sekarang
          </Link>
        </div>
      )}

      <h1>Catat data harian</h1>
      <div className="segmented" role="group" aria-label="Pilih tanggal">
        <button aria-pressed={day === today} onClick={() => setParams({})}>
          Hari ini
          <br />
          <small>{formatDate(today)}</small>
        </button>
        <button
          aria-pressed={day === yesterday}
          onClick={() => setParams({ tanggal: 'kemarin' })}
        >
          Kemarin
          <br />
          <small>{formatDate(yesterday)}</small>
        </button>
      </div>

      <Link className="button secondary" to="/kesehatan"
        style={{ display: 'flex', marginBottom: 16 }}>
        Kesehatan ayam: lapor &amp; lihat laporan
      </Link>

      {houses && houses.length === 0 && (
        <div className="alert warning">
          Data kandang belum ada di HP ini. Sambungkan ke internet sekali, lalu tekan
          “Sinkronkan”.
        </div>
      )}

      {houses?.map((house) => {
        const record = byHouse.get(house.id)
        const status = record ? STATUS[record.sync_status] : null
        const flock = house.active_flock
        return (
          <button
            key={house.id}
            className="house-button"
            disabled={!flock}
            onClick={() => navigate(`/catat/${house.id}/${day}`)}
          >
            <span>
              <span className="house-button__name">{house.name}</span>
              <br />
              <span className="muted">
                {flock
                  ? `${formatNumber(flock.live_birds)} ekor hidup`
                  : 'Belum ada flock aktif'}
              </span>
            </span>
            {status ? (
              <span className={`badge ${status.badge}`}>{status.text}</span>
            ) : (
              flock && <span className="badge">Belum diisi</span>
            )}
          </button>
        )
      })}
    </>
  )
}
