import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { House, Treatment } from '../../api/types'
import NumberField from '../../components/NumberField'
import { addDays } from '../../lib/farmDate'
import { formatDate } from '../../lib/format'

const PHASE = {
  PLANNED: { text: 'Akan datang', badge: '' },
  GIVING: { text: 'Sedang diberikan', badge: 'warn' },
  WITHDRAWAL: { text: 'Masa henti obat', badge: 'bad' },
  FINISHED: { text: 'Selesai', badge: 'ok' },
} as const

const EMPTY = {
  house_id: '',
  medicine_name: '',
  dose: '',
  start_date: '',
  end_date: '',
  withdrawal_days: '',
  notes: '',
}

/** Treatments and their egg withdrawal periods (ADR 0003). Recorded by the owner. */
export default function TreatmentsSection({ houses }: { houses: House[] }) {
  const [items, setItems] = useState<Treatment[] | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setItems(await api<Treatment[]>('/treatments'))
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const days = /^\d+$/.test(form.withdrawal_days) ? Number(form.withdrawal_days) : null
  const preview =
    form.end_date && days !== null ? formatDate(addDays(form.end_date, days + 1)) : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    setMessage(null)
    try {
      await api('/treatments', {
        method: 'POST',
        body: JSON.stringify({ ...form, withdrawal_days: days ?? -1 }),
      })
      setForm(EMPTY)
      setMessage({ kind: 'success', text: 'Pengobatan dicatat.' })
      await load()
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    }
  }

  async function remove(item: Treatment) {
    if (!window.confirm(`Hapus catatan ${item.medicine_name} di ${item.house_name}?`)) return
    try {
      await api(`/treatments/${item.id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    }
  }

  return (
    <>
      <h1 style={{ marginTop: 24 }}>Pengobatan</h1>
      <p className="muted">
        Telur dari kandang yang sedang diobati dan dalam masa henti obat tidak boleh dijual.
      </p>
      {message && (
        <div className={`alert ${message.kind === 'success' ? 'success' : ''}`} role="status"
          style={{ marginBottom: 12 }}>
          {message.text}
        </div>
      )}

      <section className="card">
        {items === null ? (
          <p className="muted">Memuat…</p>
        ) : items.length === 0 ? (
          <p className="muted">Tidak ada pengobatan dalam 60 hari terakhir.</p>
        ) : (
          <ul className="item-list">
            {items.map((t) => (
              <li key={t.id} className="stack">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>
                    {t.house_name} · {t.medicine_name}
                  </strong>
                  <span className={`badge ${PHASE[t.phase].badge}`}>{PHASE[t.phase].text}</span>
                </div>
                <span className="muted">
                  {formatDate(t.start_date)} – {formatDate(t.end_date)} · masa henti{' '}
                  {t.withdrawal_days} hari{t.dose && ` · ${t.dose}`}
                </span>
                <span>
                  Telur boleh dijual lagi mulai <strong>{formatDate(t.sellable_from)}</strong>
                </span>
                <button className="small danger" style={{ alignSelf: 'flex-start' }}
                  onClick={() => remove(t)}>
                  Hapus
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="card stack" onSubmit={submit}>
        <h2>Catat pengobatan</h2>
        <label>
          Kandang
          <select value={form.house_id} required
            onChange={(e) => setForm({ ...form, house_id: e.target.value })}>
            <option value="">Pilih kandang…</option>
            {houses.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </label>
        <label>
          Nama obat
          <input value={form.medicine_name} maxLength={100} required
            onChange={(e) => setForm({ ...form, medicine_name: e.target.value })} />
        </label>
        <label>
          <span>
            Dosis / cara pemberian <span className="muted">– opsional</span>
          </span>
          <input value={form.dose} maxLength={500} placeholder="Contoh: 1 g per liter air minum"
            onChange={(e) => setForm({ ...form, dose: e.target.value })} />
        </label>
        <div className="grid-2">
          <label>
            Mulai
            <input type="date" value={form.start_date} required
              onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </label>
          <label>
            Selesai
            <input type="date" value={form.end_date} min={form.start_date} required
              onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </label>
        </div>
        <NumberField id="withdrawal" label="Masa henti obat" unit="hari"
          value={form.withdrawal_days}
          onChange={(value) => setForm({ ...form, withdrawal_days: value })} />
        {preview && (
          <p className="muted" style={{ margin: 0 }}>
            Telur boleh dijual lagi mulai <strong>{preview}</strong>.
          </p>
        )}
        <button type="submit">Simpan pengobatan</button>
      </form>
    </>
  )
}
