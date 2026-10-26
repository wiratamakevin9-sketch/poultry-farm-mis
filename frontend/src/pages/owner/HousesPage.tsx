import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { House } from '../../api/types'
import { formatDate, formatNumber } from '../../lib/format'

const EMPTY_FLOCK = { breed: '', placement_date: '', initial_bird_count: '' }

export default function HousesPage() {
  const [houses, setHouses] = useState<House[]>([])
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [newHouse, setNewHouse] = useState({ name: '', capacity: '' })
  const [editing, setEditing] = useState<{ id: string; name: string; capacity: string } | null>(
    null,
  )
  const [flockFor, setFlockFor] = useState<House | null>(null)
  const [flockForm, setFlockForm] = useState(EMPTY_FLOCK)

  const load = useCallback(async () => {
    try {
      setHouses(await api<House[]>('/houses'))
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    }
  }, [])

  useEffect(() => {
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

  async function createHouse(event: FormEvent) {
    event.preventDefault()
    const ok = await run(
      () =>
        api('/houses', {
          method: 'POST',
          body: JSON.stringify({ name: newHouse.name, capacity: Number(newHouse.capacity) }),
        }),
      `${newHouse.name} berhasil ditambahkan.`,
    )
    if (ok) setNewHouse({ name: '', capacity: '' })
  }

  async function saveHouse(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    const ok = await run(
      () =>
        api(`/houses/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: editing.name, capacity: Number(editing.capacity) }),
        }),
      'Kandang berhasil diperbarui.',
    )
    if (ok) setEditing(null)
  }

  function toggleHouse(house: House) {
    run(
      () =>
        api(`/houses/${house.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ is_active: !house.is_active }),
        }),
      `${house.name} ${house.is_active ? 'dinonaktifkan' : 'diaktifkan'}.`,
    )
  }

  function endFlock(house: House) {
    if (!house.active_flock) return
    if (!window.confirm(`Akhiri flock aktif di ${house.name}? Data lama tetap tersimpan.`)) return
    run(
      () =>
        api(`/flocks/${house.active_flock!.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ is_active: false }),
        }),
      `Flock di ${house.name} sudah diakhiri.`,
    )
  }

  async function createFlock(event: FormEvent) {
    event.preventDefault()
    if (!flockFor) return
    const ok = await run(
      () =>
        api('/flocks', {
          method: 'POST',
          body: JSON.stringify({
            house_id: flockFor.id,
            breed: flockForm.breed,
            placement_date: flockForm.placement_date,
            initial_bird_count: Number(flockForm.initial_bird_count),
          }),
        }),
      `Flock baru di ${flockFor.name} berhasil dibuat.`,
    )
    if (ok) {
      setFlockFor(null)
      setFlockForm(EMPTY_FLOCK)
    }
  }

  return (
    <>
      <h1>Kandang &amp; Flock</h1>
      {message && (
        <div className={`alert ${message.kind === 'success' ? 'success' : ''}`} role="status">
          {message.text}
        </div>
      )}

      {houses.map((house) => (
        <section className="card stack" key={house.id}>
          {editing?.id === house.id ? (
            <form className="stack" onSubmit={saveHouse}>
              <label>
                Nama kandang
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  required
                />
              </label>
              <label>
                Kapasitas (ekor)
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={editing.capacity}
                  onChange={(e) => setEditing({ ...editing, capacity: e.target.value })}
                  required
                />
              </label>
              <div className="row">
                <button type="submit">Simpan</button>
                <button type="button" className="secondary" onClick={() => setEditing(null)}>
                  Batal
                </button>
              </div>
            </form>
          ) : (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ marginBottom: 0 }}>{house.name}</h2>
                <span className="muted">Kapasitas {formatNumber(house.capacity)} ekor</span>
              </div>
              <span className={`badge ${house.is_active ? 'ok' : 'bad'}`}>
                {house.is_active ? 'Aktif' : 'Nonaktif'}
              </span>
            </div>
          )}

          {house.active_flock ? (
            <div className="muted">
              Flock aktif: <strong>{house.active_flock.breed}</strong>, masuk{' '}
              {formatDate(house.active_flock.placement_date)}, awal{' '}
              {formatNumber(house.active_flock.initial_bird_count)} ekor, hidup sekarang{' '}
              <strong>{formatNumber(house.active_flock.live_birds)} ekor</strong>
            </div>
          ) : (
            <div className="alert warning">Belum ada flock aktif. Pekerja belum bisa mencatat.</div>
          )}

          <div className="row">
            <button
              className="small secondary"
              onClick={() =>
                setEditing({ id: house.id, name: house.name, capacity: String(house.capacity) })
              }
            >
              Ubah kandang
            </button>
            {house.active_flock ? (
              <button className="small secondary" onClick={() => endFlock(house)}>
                Akhiri flock
              </button>
            ) : (
              house.is_active && (
                <button className="small" onClick={() => setFlockFor(house)}>
                  Tambah flock
                </button>
              )
            )}
            <button
              className={`small ${house.is_active ? 'danger' : 'secondary'}`}
              onClick={() => toggleHouse(house)}
            >
              {house.is_active ? 'Nonaktifkan' : 'Aktifkan'}
            </button>
          </div>

          {flockFor?.id === house.id && (
            <form className="stack" onSubmit={createFlock}>
              <h3>Flock baru untuk {house.name}</h3>
              <label>
                Strain / jenis ayam
                <input
                  value={flockForm.breed}
                  onChange={(e) => setFlockForm({ ...flockForm, breed: e.target.value })}
                  required
                />
              </label>
              <label>
                Tanggal masuk kandang
                <input
                  type="date"
                  value={flockForm.placement_date}
                  onChange={(e) => setFlockForm({ ...flockForm, placement_date: e.target.value })}
                  required
                />
              </label>
              <label>
                Jumlah ayam awal (ekor)
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={flockForm.initial_bird_count}
                  onChange={(e) =>
                    setFlockForm({ ...flockForm, initial_bird_count: e.target.value })
                  }
                  required
                />
              </label>
              <div className="row">
                <button type="submit">Simpan flock</button>
                <button type="button" className="secondary" onClick={() => setFlockFor(null)}>
                  Batal
                </button>
              </div>
            </form>
          )}
        </section>
      ))}

      <form className="card stack" onSubmit={createHouse}>
        <h2>Tambah kandang</h2>
        <label>
          Nama kandang
          <input
            value={newHouse.name}
            onChange={(e) => setNewHouse({ ...newHouse, name: e.target.value })}
            required
          />
        </label>
        <label>
          Kapasitas (ekor)
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={newHouse.capacity}
            onChange={(e) => setNewHouse({ ...newHouse, capacity: e.target.value })}
            required
          />
        </label>
        <button type="submit">Tambah kandang</button>
      </form>
    </>
  )
}
