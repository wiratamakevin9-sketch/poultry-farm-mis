import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import NumberField from '../../components/NumberField'
import { getMeta, type LocalRecord, type RecordValues, type TrayCategory } from '../../db/db'
import { addPhoto, removePhoto, trayPhotos } from '../../db/photos'
import { findRecord, liveBirdsAtStart, saveRecord } from '../../db/records'
import { farmDate } from '../../lib/farmDate'
import { formatDate, formatNumber } from '../../lib/format'
import { feedPerBirdGrams, hdp } from '../../lib/indicators'
import { parseDecimal, validateRecord, type RecordForm as Form } from '../../lib/validation'
import { useWorker } from '../../sync/WorkerContext'
import TrayPhotos, { type NewTrayPhoto } from './TrayPhotos'

const EMPTY: Form = {
  eggs_good: '',
  eggs_cracked: '',
  eggs_rejected: '',
  eggs_dirty: '',
  feed_kg: '',
  water_liters: '',
  dead: '',
  culled: '',
  notes: '',
}

function toForm(record: LocalRecord): Form {
  const decimal = (n: number) => String(n).replace('.', ',')
  return {
    eggs_good: String(record.eggs_good),
    eggs_cracked: String(record.eggs_cracked),
    eggs_rejected: String(record.eggs_rejected),
    eggs_dirty: String(record.eggs_dirty ?? 0),
    feed_kg: decimal(record.feed_kg),
    water_liters: record.water_liters === null ? '' : decimal(record.water_liters),
    dead: String(record.dead),
    culled: String(record.culled),
    notes: record.notes,
  }
}

function count(text: string): number {
  return /^\d+$/.test(text.trim()) ? Number(text) : 0
}

/** Eggs on a tray photo as counted by the worker: the training label for Iteration 3. */
function trayLabel(category: TrayCategory, values: RecordValues, remainder: number | null) {
  if (category === 'CRACKED') return values.eggs_cracked
  if (category === 'DIRTY') return values.eggs_dirty
  return remainder // only known when the tray helper was used
}

export default function RecordForm() {
  const { houseId = '', date = '' } = useParams()
  const { db, user, sync } = useWorker()
  const navigate = useNavigate()

  const house = useLiveQuery(() => db.houses.get(houseId), [db, houseId])
  // undefined = still loading, null = no record yet for this house and day
  const existing = useLiveQuery(
    async () => (await findRecord(db, houseId, date)) ?? null,
    [db, houseId, date],
  )
  const flock = house?.active_flock ?? null
  const liveBirds = useLiveQuery(
    () => (flock ? liveBirdsAtStart(db, flock.id, flock.initial_bird_count, date) : 0),
    [db, flock?.id, date],
  )

  const [form, setForm] = useState<Form>(EMPTY)
  const [loadedId, setLoadedId] = useState<string | null | undefined>(undefined)
  const [touched, setTouched] = useState<Partial<Record<keyof Form, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  // Tray helper: good eggs = full trays x eggs per tray + remainder (ADR 0002).
  const [trays, setTrays] = useState('')
  const [remainder, setRemainder] = useState('')
  const [newPhotos, setNewPhotos] = useState<NewTrayPhoto[]>([])
  const eggsPerTray = useLiveQuery(() => getMeta(db, 'eggs_per_tray', 30), [db], 30)
  const savedPhotos = useLiveQuery(() => trayPhotos(db, houseId, date), [db, houseId, date], [])

  // Fill the form once with the saved record (if any). A record pulled from the server
  // for this day is edited instead of creating a second one.
  useEffect(() => {
    if (existing === undefined || loadedId !== undefined) return
    setLoadedId(existing?.id ?? null)
    if (existing) setForm(toForm(existing))
  }, [existing, loadedId])

  if (house === undefined || existing === undefined || liveBirds === undefined) {
    return <p className="muted">Memuat…</p>
  }
  if (!house || !flock) {
    return (
      <div className="alert">
        Kandang tidak ditemukan atau belum punya flock aktif. <Link className="tap-link" to="/">
          Kembali
        </Link>
      </div>
    )
  }

  const today = farmDate()
  const { errors, values } = validateRecord(form, liveBirds, date, today)
  const show = (field: keyof Form) => (submitted || touched[field] ? errors[field] : undefined)
  const totalEggs =
    count(form.eggs_good) +
    count(form.eggs_cracked) +
    count(form.eggs_rejected) +
    count(form.eggs_dirty)
  const feed = parseDecimal(form.feed_kg) ?? 0
  const inConflict = existing?.sync_status === 'conflict'

  function update(field: keyof Form) {
    return (value: string) => setForm((f) => ({ ...f, [field]: value }))
  }

  function blur(field: keyof Form) {
    return () => setTouched((t) => ({ ...t, [field]: true }))
  }

  const usingTrays = trays.trim() !== '' || remainder.trim() !== ''
  const remainderError =
    count(remainder) >= eggsPerTray ? `Sisa harus kurang dari ${eggsPerTray} butir.` : undefined

  function updateTrays(nextTrays: string, nextRemainder: string) {
    setTrays(nextTrays)
    setRemainder(nextRemainder)
    if (nextTrays.trim() === '' && nextRemainder.trim() === '') return
    const good = count(nextTrays) * eggsPerTray + count(nextRemainder)
    setForm((f) => ({ ...f, eggs_good: String(good) }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitted(true)
    if (!values || !house || !flock || remainderError) return
    setSaving(true)
    const remainderLabel = usingTrays ? count(remainder) : null
    try {
      await db.transaction('rw', db.records, db.outbox, db.photos, async () => {
        await saveRecord(db, {
          id: existing?.id,
          house_id: house.id,
          flock_id: flock.id,
          record_date: date,
          values,
          user_id: user.id,
        })
        for (const { category, photo } of newPhotos) {
          await addPhoto(db, {
            kind: 'TRAY',
            house_id: house.id,
            record_date: date,
            tray_category: category,
            label_count: trayLabel(category, values, remainderLabel),
            ...photo,
          })
        }
        // Photos not sent yet get the counts as they are now.
        for (const photo of savedPhotos) {
          if (photo.status !== 'pending' || !photo.tray_category) continue
          const label = trayLabel(photo.tray_category, values, remainderLabel)
          if (label !== null) await db.photos.update(photo.id, { label_count: label })
        }
      })
      sync.sync() // send right away if there is signal; otherwise it waits in the queue
      navigate(date === today ? '/' : '/?tanggal=kemarin', { state: { saved: house.name } })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div>
        <Link className="tap-link" to={date === today ? '/' : '/?tanggal=kemarin'}>
          ← Kembali
        </Link>
        <h1 style={{ marginTop: 8 }}>{house.name}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {formatDate(date)} · {existing ? 'Ubah data' : 'Data baru'} · Ayam hidup awal hari:{' '}
          <strong>{formatNumber(liveBirds)} ekor</strong>
        </p>
      </div>

      {errors.record_date && <div className="alert">{errors.record_date}</div>}
      {inConflict && (
        <div className="alert warning">
          Data ini bentrok dengan data pekerja lain. <Link className="tap-link" to="/konflik">
            Selesaikan dulu
          </Link>{' '}
          sebelum mengubahnya.
        </div>
      )}
      {existing?.sync_status === 'rejected' && existing.errors && (
        <div className="alert" role="alert">
          Server menolak data ini: {Object.values(existing.errors).join(' ')} Perbaiki lalu
          simpan lagi.
        </div>
      )}

      <section className="card stack">
        <h2>Telur (butir)</h2>
        <div className="grid-2">
          <NumberField id="trays" label="Tray penuh" value={trays} optional
            onChange={(v) => updateTrays(v, remainder)} />
          <NumberField id="remainder" label="Sisa butir" value={remainder} optional
            onChange={(v) => updateTrays(trays, v)} error={remainderError} />
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Isi tray penuh dan sisa untuk menghitung telur bagus otomatis ({eggsPerTray} butir per
          tray), atau ketik langsung di bawah.
        </p>
        <NumberField id="eggs_good" label="Telur bagus" value={form.eggs_good}
          onChange={update('eggs_good')} onBlur={blur('eggs_good')} error={show('eggs_good')} />
        <div className="grid-2">
          <NumberField id="eggs_cracked" label="Telur retak" value={form.eggs_cracked}
            onChange={update('eggs_cracked')} onBlur={blur('eggs_cracked')}
            error={show('eggs_cracked')} />
          <NumberField id="eggs_dirty" label="Telur kotor" value={form.eggs_dirty}
            onChange={update('eggs_dirty')} onBlur={blur('eggs_dirty')}
            error={show('eggs_dirty')} />
          <NumberField id="eggs_rejected" label="Telur afkir" value={form.eggs_rejected}
            onChange={update('eggs_rejected')} onBlur={blur('eggs_rejected')}
            error={show('eggs_rejected')} />
        </div>
      </section>

      <section className="card stack">
        <h2>Pakan &amp; air</h2>
        <NumberField id="feed_kg" label="Pakan" unit="kg" decimal value={form.feed_kg}
          onChange={update('feed_kg')} onBlur={blur('feed_kg')} error={show('feed_kg')} />
        <NumberField id="water_liters" label="Air minum" unit="liter" decimal optional
          value={form.water_liters} onChange={update('water_liters')}
          onBlur={blur('water_liters')} error={show('water_liters')} />
      </section>

      <section className="card stack">
        <h2>Ayam (ekor)</h2>
        <div className="grid-2">
          <NumberField id="dead" label="Ayam mati" value={form.dead} onChange={update('dead')}
            onBlur={blur('dead')} error={show('dead')} />
          <NumberField id="culled" label="Ayam afkir" value={form.culled}
            onChange={update('culled')} onBlur={blur('culled')} error={show('culled')} />
        </div>
        <label htmlFor="notes">
          <span>
            Catatan <span className="muted">– opsional</span>
          </span>
          <textarea id="notes" rows={2} maxLength={500} value={form.notes}
            onChange={(e) => update('notes')(e.target.value)} />
        </label>
      </section>

      <TrayPhotos
        saved={savedPhotos}
        added={newPhotos}
        onAdd={(category, photo) =>
          setNewPhotos((list) => [...list, { key: crypto.randomUUID(), category, photo }])
        }
        onRemoveAdded={(key) => setNewPhotos((list) => list.filter((p) => p.key !== key))}
        onRemoveSaved={(id) => removePhoto(db, id)}
        disabled={inConflict || !!errors.record_date}
      />

      <section className="card" aria-label="Pratinjau">
        <div className="preview">
          <div>
            <span className="muted">HDP</span>
            <strong data-testid="preview-hdp">
              {formatNumber(hdp(totalEggs, liveBirds), 1)}%
            </strong>
          </div>
          <div>
            <span className="muted">Pakan/ekor</span>
            <strong data-testid="preview-feed">
              {formatNumber(feedPerBirdGrams(feed, liveBirds), 1)} g
            </strong>
          </div>
          <div>
            <span className="muted">Total telur</span>
            <strong>{formatNumber(totalEggs)}</strong>
          </div>
        </div>
      </section>

      {submitted && !values && (
        <div className="alert" role="alert">
          Ada isian yang perlu diperbaiki. Periksa tulisan merah di atas.
        </div>
      )}
      <div className="sticky-actions">
        <button type="submit" disabled={saving || inConflict || !!errors.record_date}>
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </form>
  )
}
