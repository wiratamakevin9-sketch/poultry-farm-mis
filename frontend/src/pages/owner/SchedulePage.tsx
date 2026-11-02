import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { House, Vaccination } from '../../api/types'
import { addDays, farmDate } from '../../lib/farmDate'
import { formatDate, formatDateTime } from '../../lib/format'
import { VACCINE_METHODS, type VaccineMethod } from '../../lib/labels'

const STATUS = {
  OVERDUE: { text: 'Terlewat', badge: 'bad' },
  SCHEDULED: { text: 'Dijadwalkan', badge: '' },
  DONE: { text: 'Sudah dilakukan', badge: 'ok' },
} as const

const EMPTY = { house_id: '', scheduled_date: '', vaccine_name: '', method: 'DRINKING_WATER' as VaccineMethod, notes: '' }

export default function SchedulePage() {
  const today = farmDate()
  const [houses, setHouses] = useState<House[]>([])
  const [items, setItems] = useState<Vaccination[] | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    // Last 7 days (to see what was missed or done) and the next 30 days.
    const params = new URLSearchParams({ date_from: addDays(today, -7), date_to: addDays(today, 30) })
    try {
      setItems(await api<Vaccination[]>(`/vaccinations?${params}`))
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    }
  }, [today])

  useEffect(() => {
    api<House[]>('/houses').then((list) => setHouses(list.filter((h) => h.is_active)), () => {})
    load()
  }, [load])

  async function run(action: () => Promise<unknown>, success: string) {
    setMessage(null)
    try {
      await action()
      setMessage({ kind: 'success', text: success })
      await load()
      return true
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
      return false
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const body = JSON.stringify(editingId ? { ...form, house_id: undefined } : form)
    const ok = await run(
      () =>
        editingId
          ? api(`/vaccinations/${editingId}`, { method: 'PATCH', body })
          : api('/vaccinations', { method: 'POST', body }),
      editingId ? 'Jadwal vaksinasi diperbarui.' : 'Jadwal vaksinasi ditambahkan.',
    )
    if (ok) {
      setForm(EMPTY)
      setEditingId(null)
    }
  }

  function edit(item: Vaccination) {
    setEditingId(item.id)
    setForm({
      house_id: item.house_id,
      scheduled_date: item.scheduled_date,
      vaccine_name: item.vaccine_name,
      method: item.method,
      notes: item.notes,
    })
  }

  function remove(item: Vaccination) {
    if (!window.confirm(`Hapus jadwal ${item.vaccine_name} di ${item.house_name}?`)) return
    run(() => api(`/vaccinations/${item.id}`, { method: 'DELETE' }), 'Jadwal dihapus.')
  }

  // Missed ones first, then by date.
  const sorted = [...(items ?? [])].sort(
    (a, b) =>
      Number(b.status === 'OVERDUE') - Number(a.status === 'OVERDUE') ||
      a.scheduled_date.localeCompare(b.scheduled_date),
  )

  return (
    <>
      <h1>Jadwal vaksinasi</h1>
      <p className="muted">
        Pekerja melihat vaksinasi di HP pada harinya dan menekan Konfirmasi setelah selesai.
      </p>
      {message && (
        <div className={`alert ${message.kind === 'success' ? 'success' : ''}`} role="status"
          style={{ marginBottom: 12 }}>
          {message.text}
        </div>
      )}

      <section className="card">
        <h2>7 hari terakhir dan 30 hari ke depan</h2>
        {items === null ? (
          <p className="muted">Memuat…</p>
        ) : sorted.length === 0 ? (
          <p className="muted">Belum ada jadwal.</p>
        ) : (
          <ul className="item-list">
            {sorted.map((item) => (
              <li key={item.id} className="stack">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>
                    {formatDate(item.scheduled_date)} · {item.house_name}
                  </strong>
                  <span className={`badge ${STATUS[item.status].badge}`}>
                    {item.scheduled_date === today && item.status === 'SCHEDULED'
                      ? 'Hari ini'
                      : STATUS[item.status].text}
                  </span>
                </div>
                <span>
                  {item.vaccine_name} · {VACCINE_METHODS[item.method]}
                  {item.notes && <span className="muted"> · {item.notes}</span>}
                </span>
                {item.status === 'DONE' && item.done_at && (
                  <span className="muted">
                    Dikonfirmasi {item.done_by_name} {formatDateTime(item.done_at)}
                    {item.done_note && ` · ${item.done_note}`}
                  </span>
                )}
                {item.status !== 'DONE' && (
                  <div className="row">
                    <button className="small secondary" onClick={() => edit(item)}>Ubah</button>
                    <button className="small danger" onClick={() => remove(item)}>Hapus</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="card stack" onSubmit={submit}>
        <h2>{editingId ? 'Ubah jadwal vaksinasi' : 'Tambah jadwal vaksinasi'}</h2>
        <label>
          Kandang
          <select value={form.house_id} disabled={!!editingId} required
            onChange={(e) => setForm({ ...form, house_id: e.target.value })}>
            <option value="">Pilih kandang…</option>
            {houses.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </label>
        <label>
          Tanggal
          <input type="date" value={form.scheduled_date} required
            onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })} />
        </label>
        <label>
          Nama vaksin
          <input value={form.vaccine_name} maxLength={100} required placeholder="Contoh: ND-IB"
            onChange={(e) => setForm({ ...form, vaccine_name: e.target.value })} />
        </label>
        <label>
          Cara pemberian
          <select value={form.method}
            onChange={(e) => setForm({ ...form, method: e.target.value as VaccineMethod })}>
            {Object.entries(VACCINE_METHODS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>
            Catatan <span className="muted">– opsional</span>
          </span>
          <input value={form.notes} maxLength={500}
            onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        <div className="row">
          <button type="submit">{editingId ? 'Simpan perubahan' : 'Tambah jadwal'}</button>
          {editingId && (
            <button type="button" className="secondary"
              onClick={() => { setEditingId(null); setForm(EMPTY) }}>
              Batal
            </button>
          )}
        </div>
      </form>
    </>
  )
}
