import { useState, type FormEvent } from 'react'
import { ApiError, NetworkError } from '../api/client'
import type { Conflict, RecordValues } from '../db/db'
import { formatDate, formatNumber } from '../lib/format'
import { validateRecord, type RecordForm } from '../lib/validation'
import NumberField from './NumberField'

export type Resolution = 'KEEP_SERVER' | 'TAKE_DEVICE' | 'MERGED'

const FIELDS: { key: keyof RecordValues; label: string }[] = [
  { key: 'eggs_good', label: 'Telur bagus' },
  { key: 'eggs_cracked', label: 'Telur retak' },
  { key: 'eggs_rejected', label: 'Telur afkir' },
  { key: 'eggs_dirty', label: 'Telur kotor' },
  { key: 'feed_kg', label: 'Pakan (kg)' },
  { key: 'water_liters', label: 'Air (liter)' },
  { key: 'dead', label: 'Ayam mati' },
  { key: 'culled', label: 'Ayam afkir' },
  { key: 'notes', label: 'Catatan' },
]

const MERGE_FIELDS = [
  'eggs_good',
  'eggs_cracked',
  'eggs_rejected',
  'eggs_dirty',
  'feed_kg',
  'water_liters',
  'dead',
  'culled',
] as const

const REASON = {
  VERSION: 'Data ini diubah di dua HP.',
  DUPLICATE_DAY: 'Dua pekerja mengisi kandang ini untuk tanggal yang sama.',
}

function show(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '–'
  const n = Number(value)
  // Numbers (and numeric strings such as "550.00" from the API) use Indonesian format.
  return Number.isNaN(n) ? String(value) : formatNumber(n, n % 1 ? 2 : 0)
}

function toForm(values: RecordValues): RecordForm {
  const text = (v: number | null) => (v === null ? '' : String(v).replace('.', ','))
  return {
    eggs_good: String(values.eggs_good),
    eggs_cracked: String(values.eggs_cracked),
    eggs_rejected: String(values.eggs_rejected),
    eggs_dirty: String(values.eggs_dirty ?? 0),
    feed_kg: text(Number(values.feed_kg)),
    water_liters: text(values.water_liters === null ? null : Number(values.water_liters)),
    dead: String(values.dead),
    culled: String(values.culled),
    notes: values.notes ?? '',
  }
}

interface Props {
  conflict: Conflict
  /** Live birds at the start of the day; null if unknown (the server still checks). */
  liveBirds: number | null
  deviceLabel: string // column header, e.g. "Data saya"
  takeLabel: string // button that keeps the device copy, e.g. "Pakai data saya"
  lockedMessage: string
  onResolve: (resolution: Resolution, values?: RecordValues) => Promise<void>
}

/** Side-by-side comparison of the server copy and the device copy, with the three choices. */
export default function ConflictCard({
  conflict,
  liveBirds,
  deviceLabel,
  takeLabel,
  lockedMessage,
  onResolve,
}: Props) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [merging, setMerging] = useState(false)
  const [form, setForm] = useState<RecordForm>(() => toForm(conflict.device_payload))

  // The date window is not checked here: who may resolve, and when, is decided by the
  // server (can_resolve).
  const check = validateRecord(
    form,
    liveBirds ?? Number.MAX_SAFE_INTEGER,
    conflict.record_date,
    conflict.record_date,
  )

  async function run(resolution: Resolution, values?: RecordValues) {
    setError('')
    setBusy(true)
    try {
      await onResolve(resolution, values)
    } catch (err) {
      if (err instanceof NetworkError) setError('Butuh internet untuk menyelesaikan konflik.')
      else if (err instanceof ApiError) setError(err.message)
      else setError('Terjadi kesalahan. Coba lagi.')
    } finally {
      setBusy(false)
    }
  }

  function submitMerge(event: FormEvent) {
    event.preventDefault()
    if (check.values) run('MERGED', check.values)
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
              <th className="num">{deviceLabel}</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map(({ key, label }) => {
              const server = show(conflict.server_record[key])
              const device = show(conflict.device_payload[key])
              const differs = server !== device
              return (
                <tr key={key}>
                  <td>{label}</td>
                  <td className={`num ${differs ? 'diff' : ''}`}>{server}</td>
                  <td className={`num ${differs ? 'diff' : ''}`}>{device}</td>
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
        <div className="alert warning">{lockedMessage}</div>
      ) : merging ? (
        <form className="stack" onSubmit={submitMerge} noValidate>
          <h3>Gabungkan: isi angka yang benar</h3>
          {MERGE_FIELDS.map((key) => (
            <NumberField
              key={key}
              id={`${conflict.id}-${key}`}
              label={FIELDS.find((f) => f.key === key)!.label}
              decimal={key === 'feed_kg' || key === 'water_liters'}
              optional={key === 'water_liters'}
              value={form[key]}
              onChange={(value) => setForm((f) => ({ ...f, [key]: value }))}
              error={check.errors[key]}
            />
          ))}
          <div className="row">
            <button type="submit" disabled={busy || !check.values}>
              Simpan gabungan
            </button>
            <button type="button" className="secondary" onClick={() => setMerging(false)}>
              Batal
            </button>
          </div>
        </form>
      ) : (
        <div className="stack">
          <button disabled={busy} onClick={() => run('KEEP_SERVER')}>
            Pakai data di server
          </button>
          <button className="secondary" disabled={busy} onClick={() => run('TAKE_DEVICE')}>
            {takeLabel}
          </button>
          <button className="secondary" disabled={busy} onClick={() => setMerging(true)}>
            Gabungkan…
          </button>
        </div>
      )}
    </section>
  )
}
