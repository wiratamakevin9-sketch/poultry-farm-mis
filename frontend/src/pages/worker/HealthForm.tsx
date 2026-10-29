import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import NumberField from '../../components/NumberField'
import PhotoPicker from '../../components/PhotoPicker'
import PhotoThumb from '../../components/PhotoThumb'
import { saveObservation } from '../../db/observations'
import type { CompressedPhoto } from '../../lib/image'
import { SYMPTOMS } from '../../lib/symptoms'
import { MAX_HEALTH_PHOTOS, validateObservation } from '../../lib/validation'
import { useWorker } from '../../sync/WorkerContext'

/** UC14: what the worker sees in a house, with photos. Works offline. */
export default function HealthForm() {
  const { db, sync } = useWorker()
  const navigate = useNavigate()
  const houses = useLiveQuery(
    async () =>
      (await db.houses.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'id')),
    [db],
  )
  const [houseId, setHouseId] = useState('')
  const [symptoms, setSymptoms] = useState<string[]>([])
  const [other, setOther] = useState('')
  const [affected, setAffected] = useState('')
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<{ key: string; photo: CompressedPhoto }[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  const house = houses?.find((h) => h.id === houseId)
  const errors = validateObservation(
    { symptoms, other_symptoms: other, affected_count: affected, notes, photoCount: photos.length },
    house?.active_flock?.live_birds ?? null,
  )
  const houseError = submitted && !houseId ? 'Pilih kandang.' : undefined
  const show = (field: keyof typeof errors) => (submitted ? errors[field] : undefined)

  function toggle(code: string) {
    setSymptoms((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitted(true)
    if (!houseId || Object.keys(errors).length > 0) return
    setSaving(true)
    try {
      await saveObservation(
        db,
        {
          house_id: houseId,
          symptoms,
          other_symptoms: other.trim(),
          affected_count: affected.trim() === '' ? null : Number(affected),
          notes: notes.trim(),
        },
        photos.map((p) => p.photo),
      )
      sync.sync()
      navigate('/kesehatan', { state: { saved: true } })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div>
        <Link className="tap-link" to="/kesehatan">
          ← Kembali
        </Link>
        <h1 style={{ marginTop: 8 }}>Laporkan kesehatan ayam</h1>
        <p className="muted" style={{ margin: 0 }}>
          Catat apa yang Anda lihat. Pemilik akan meneruskannya ke dokter hewan.
        </p>
      </div>

      <section className="card stack">
        <label htmlFor="house">
          Kandang
          <select id="house" value={houseId} onChange={(e) => setHouseId(e.target.value)}
            aria-invalid={houseError ? 'true' : 'false'}>
            <option value="">Pilih kandang…</option>
            {houses?.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        {houseError && <span className="field-error">{houseError}</span>}
      </section>

      <fieldset className="card stack">
        <legend>Gejala yang terlihat</legend>
        {Object.entries(SYMPTOMS).map(([code, label]) => (
          <label key={code} className="check">
            <input type="checkbox" checked={symptoms.includes(code)} onChange={() => toggle(code)} />
            <span>{label}</span>
          </label>
        ))}
        <label htmlFor="other">
          <span>
            Gejala lain <span className="muted">– opsional</span>
          </span>
          <input id="other" value={other} maxLength={500} onChange={(e) => setOther(e.target.value)} />
        </label>
        {show('symptoms') && <span className="field-error">{show('symptoms')}</span>}
      </fieldset>

      <section className="card stack">
        <NumberField id="affected" label="Perkiraan ayam yang terkena" unit="ekor" optional
          value={affected} onChange={setAffected} error={show('affected_count')} />
        <label htmlFor="health-notes">
          <span>
            Catatan <span className="muted">– opsional</span>
          </span>
          <textarea id="health-notes" rows={3} maxLength={1000} value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Contoh: sejak pagi, di sudut utara kandang" />
        </label>
      </section>

      <section className="card stack" aria-labelledby="health-photos">
        <h2 id="health-photos" style={{ margin: 0 }}>
          Foto ayam (1–{MAX_HEALTH_PHOTOS})
        </h2>
        {photos.map((p, i) => (
          <PhotoThumb
            key={p.key}
            photo={{ ...p.photo, id: p.key, kind: 'HEALTH', house_id: '', taken_at: '', status: 'pending' }}
            caption={`Foto ${i + 1}`}
            unsaved
            onRemove={() => setPhotos((list) => list.filter((x) => x.key !== p.key))}
          />
        ))}
        {photos.length < MAX_HEALTH_PHOTOS && (
          <PhotoPicker
            label="Ambil foto ayam"
            onPhoto={(photo) =>
              setPhotos((list) => [...list, { key: crypto.randomUUID(), photo }])
            }
          />
        )}
        {show('photos') && <span className="field-error">{show('photos')}</span>}
      </section>

      {submitted && (houseError || Object.keys(errors).length > 0) && (
        <div className="alert" role="alert">
          Ada isian yang perlu diperbaiki. Periksa tulisan merah di atas.
        </div>
      )}
      <div className="sticky-actions">
        <button type="submit" disabled={saving}>
          {saving ? 'Menyimpan…' : 'Simpan laporan'}
        </button>
      </div>
    </form>
  )
}
