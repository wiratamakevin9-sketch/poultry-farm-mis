import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import type { LocalVaccination } from '../../db/db'
import { addDays, farmDate } from '../../lib/farmDate'
import { formatDate } from '../../lib/format'
import { VACCINE_METHODS, type VaccineMethod } from '../../lib/labels'
import { useWorker } from '../../sync/WorkerContext'

function VaccinationItem({ item }: { item: LocalVaccination }) {
  const { db, sync } = useWorker()
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')
  const today = farmDate()

  async function confirm() {
    await db.vaccinations.update(item.id, {
      confirm_status: 'pending',
      confirmed_at: new Date().toISOString(),
      confirm_note: note.trim(),
      errors: undefined,
    })
    setConfirming(false)
    sync.sync() // sends now if there is signal, otherwise waits in the queue
  }

  const method = VACCINE_METHODS[item.method as VaccineMethod] ?? item.method
  return (
    <li className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>
          {item.house_name} · {item.vaccine_name}
        </strong>
        {item.status === 'DONE' ? (
          <span className="badge ok">Sudah dilakukan</span>
        ) : item.confirm_status === 'pending' ? (
          <span className="badge warn">Dikonfirmasi, menunggu dikirim</span>
        ) : item.scheduled_date < today ? (
          <span className="badge bad">Terlewat {formatDate(item.scheduled_date)}</span>
        ) : null}
      </div>
      <span className="muted">
        {method}
        {item.notes && ` · ${item.notes}`}
        {item.status === 'DONE' && item.done_by_name && ` · oleh ${item.done_by_name}`}
      </span>
      {item.confirm_status === 'rejected' && item.errors && (
        <span className="field-error">{Object.values(item.errors).join(' ')}</span>
      )}
      {item.status !== 'DONE' && item.confirm_status !== 'pending' && (
        confirming ? (
          <div className="stack">
            <label>
              <span>
                Catatan <span className="muted">– opsional</span>
              </span>
              <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="row">
              <button onClick={confirm}>Ya, sudah divaksin</button>
              <button className="secondary" onClick={() => setConfirming(false)}>Batal</button>
            </div>
          </div>
        ) : (
          <button style={{ alignSelf: 'flex-start' }} onClick={() => setConfirming(true)}>
            Konfirmasi
          </button>
        )
      )}
    </li>
  )
}

/** "Hari ini": vaccinations due today or missed, and tomorrow's for planning. */
export default function TodayPanel() {
  const { db } = useWorker()
  const today = farmDate()
  const tomorrow = addDays(today, 1)
  const items = useLiveQuery(() => db.vaccinations.orderBy('scheduled_date').toArray(), [db], [])

  const due = items.filter(
    (v) => (v.scheduled_date <= today && v.status !== 'DONE') || (v.scheduled_date === today && v.status === 'DONE'),
  )
  const upcoming = items.filter((v) => v.scheduled_date === tomorrow)
  if (due.length === 0 && upcoming.length === 0) return null

  return (
    <section className="card stack" aria-labelledby="today-title">
      <h2 id="today-title" style={{ margin: 0 }}>
        Hari ini
      </h2>
      {due.length > 0 && (
        <>
          <strong>Vaksinasi</strong>
          <ul className="item-list">
            {due.map((item) => (
              <VaccinationItem key={item.id} item={item} />
            ))}
          </ul>
        </>
      )}
      {upcoming.length > 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Besok: {upcoming.map((v) => `${v.vaccine_name} (${v.house_name})`).join(', ')}
        </p>
      )}
    </section>
  )
}
