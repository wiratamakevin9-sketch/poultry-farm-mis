import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, NetworkError, api } from '../../api/client'
import NumberField from '../../components/NumberField'
import type { Conflict, FarmDb, RecordValues } from '../../db/db'
import { liveBirdsAtStart } from '../../db/records'
import { farmDate } from '../../lib/farmDate'
import { formatDate, formatNumber } from '../../lib/format'
import { validateRecord, type RecordForm } from '../../lib/validation'
import { useWorker } from '../../sync/WorkerContext'

const FIELDS: { key: keyof RecordValues; label: string }[] = [
  { key: 'eggs_good', label: 'Telur bagus' },
  { key: 'eggs_cracked', label: 'Telur retak' },
  { key: 'eggs_rejected', label: 'Telur afkir' },
  { key: 'feed_kg', label: 'Pakan (kg)' },
  { key: 'water_liters', label: 'Air (liter)' },
  { key: 'dead', label: 'Ayam mati' },
  { key: 'culled', label: 'Ayam afkir' },
  { key: 'notes', label: 'Catatan' },
]

const REASON = {
  VERSION: 'Data ini juga diubah di HP lain.',
  DUPLICATE_DAY: 'Pekerja lain sudah mengisi kandang ini untuk tanggal yang sama.',
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '–'
  const n = Number(value)
  return typeof value !== 'boolean' && !Number.isNaN(n) && value !== ''
    ? formatNumber(n, n % 1 ? 2 : 0)
    : String(value)
}

function toForm(values: RecordValues): RecordForm {
  const text = (v: number | null) => (v === null ? '' : String(v).replace('.', ','))
  return {
    eggs_good: String(values.eggs_good),
    eggs_cracked: String(values.eggs_cracked),
    eggs_rejected: String(values.eggs_rejected),
    feed_kg: text(Number(values.feed_kg)),
    water_liters: text(values.water_liters === null ? null : Number(values.water_liters)),
    dead: String(values.dead),
    culled: String(values.culled),
    notes: values.notes ?? '',
  }
}

async function resolve(
  db: FarmDb,
  conflict: Conflict,
  resolution: 'KEEP_SERVER' | 'TAKE_DEVICE' | 'MERGED',
  values?: RecordValues,
): Promise<void> {
  await api(`/conflicts/${conflict.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({
      resolution,
      server_version: conflict.server_record.version,
      values,
    }),
  })
  await db.conflicts.delete(conflict.id)
}

function ConflictCard({ conflict }: { conflict: Conflict }) {
  const { db, sync } = useWorker()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [merging, setMerging] = useState(false)
  const [form, setForm] = useState<RecordForm>(() => toForm(conflict.device_payload))
  const alive = useLiveQuery(async () => {
    const flock = (await db.houses.get(conflict.house_id))?.active_flock
    if (!flock || flock.id !== conflict.server_record.flock_id) return null
    return liveBirdsAtStart(db, flock.id, flock.initial_bird_count, conflict.record_date)
  }, [db, conflict.id])

  async function run(action: () => Promise<void>) {
    setError('')
    setBusy(true)
    try {
      await action()
      await sync.sync()
    } catch (err) {
      if (err instanceof NetworkError) setError('Butuh internet untuk menyelesaikan konflik.')
      else if (err instanceof ApiError) setError(err.message)
      else setError('Terjadi kesalahan. Coba lagi.')
    } finally {
      setBusy(false)
    }
  }

  // The date window is not checked here: who may resolve, and when, is decided by the
  // server (can_resolve). If the flock is unknown on this phone, the server checks the
  // bird limits alone.
  const check =
    alive === undefined
      ? null
      : validateRecord(
          form,
          alive ?? Number.MAX_SAFE_INTEGER,
          conflict.record_date,
          conflict.record_date,
        )

  function submitMerge(event: FormEvent) {
    event.preventDefault()
    if (!check?.values) return
    run(() => resolve(db, conflict, 'MERGED', check.values!))
  }

  return (
    <section className="card stack">
      <div>
        <h2 style={{ marginBottom: 0 }}>
          {conflict.house_name} · {formatDate(conflict.record_date)}
        </h2>
        <span className="muted">{REASON[conflict.reason]}</span>
      </div>

      <div className="table-wrap">
        <table className="compare">
          <thead>
            <tr>
              <th>Isian</th>
              <th className="num">Di server</th>
              <th className="num">Data saya</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map(({ key, label }) => {
              const server = conflict.server_record[key]
              const mine = conflict.device_payload[key]
              const differs = show(server) !== show(mine)
              return (
                <tr key={key}>
                  <td>{label}</td>
                  <td className={`num ${differs ? 'diff' : ''}`}>{show(server)}</td>
                  <td className={`num ${differs ? 'diff' : ''}`}>{show(mine)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}

      {!conflict.can_resolve ? (
        <div className="alert warning">
          Batas waktu sudah lewat. Konflik ini akan diselesaikan oleh pemilik.
        </div>
      ) : merging ? (
        <form className="stack" onSubmit={submitMerge} noValidate>
          <h3>Gabungkan: isi angka yang benar</h3>
          {(['eggs_good', 'eggs_cracked', 'eggs_rejected', 'feed_kg', 'water_liters', 'dead', 'culled'] as const).map(
            (key) => (
              <NumberField
                key={key}
                id={`${conflict.id}-${key}`}
                label={FIELDS.find((f) => f.key === key)!.label}
                decimal={key === 'feed_kg' || key === 'water_liters'}
                optional={key === 'water_liters'}
                value={form[key]}
                onChange={(value) => setForm((f) => ({ ...f, [key]: value }))}
                error={check?.errors[key]}
              />
            ),
          )}
          <div className="row">
            <button type="submit" disabled={busy || !check?.values}>
              Simpan gabungan
            </button>
            <button type="button" className="secondary" onClick={() => setMerging(false)}>
              Batal
            </button>
          </div>
        </form>
      ) : (
        <div className="stack">
          <button disabled={busy} onClick={() => run(() => resolve(db, conflict, 'KEEP_SERVER'))}>
            Pakai data di server
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => run(() => resolve(db, conflict, 'TAKE_DEVICE'))}
          >
            Pakai data saya
          </button>
          <button className="secondary" disabled={busy} onClick={() => setMerging(true)}>
            Gabungkan…
          </button>
        </div>
      )}
    </section>
  )
}

export default function ConflictsPage() {
  const { db } = useWorker()
  const conflicts = useLiveQuery(() => db.conflicts.orderBy('device_record_id').toArray(), [db])

  return (
    <>
      <Link to="/">← Kembali</Link>
      <h1 style={{ marginTop: 8 }}>Data bentrok</h1>
      <p className="muted">
        Bandingkan data Anda dengan data di server, lalu pilih yang benar. Data yang tidak
        dipilih tetap disimpan di server. Hari ini: {formatDate(farmDate())}.
      </p>
      {conflicts?.length === 0 && <div className="alert success">Tidak ada data bentrok.</div>}
      {conflicts?.map((conflict) => (
        <ConflictCard key={conflict.id} conflict={conflict} />
      ))}
    </>
  )
}
