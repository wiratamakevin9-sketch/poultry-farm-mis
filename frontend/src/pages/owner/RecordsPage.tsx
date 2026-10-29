import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { House, OwnerRecord, ServerPhoto } from '../../api/types'
import AuthImage from '../../components/AuthImage'
import { addDays, farmDate } from '../../lib/farmDate'
import { formatDate, formatDateTime, formatNumber } from '../../lib/format'
import { TRAY_LABELS } from '../../lib/labels'

export default function RecordsPage() {
  const today = farmDate()
  const [houses, setHouses] = useState<House[]>([])
  const [houseId, setHouseId] = useState('')
  const [dateFrom, setDateFrom] = useState(addDays(today, -13))
  const [dateTo, setDateTo] = useState(today)
  const [records, setRecords] = useState<OwnerRecord[] | null>(null)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [viewing, setViewing] = useState<{ record: OwnerRecord; photos: ServerPhoto[] } | null>(
    null,
  )

  async function showPhotos(record: OwnerRecord) {
    const params = new URLSearchParams({
      house_id: record.house_id,
      record_date: record.record_date,
    })
    try {
      setViewing({ record, photos: await api<ServerPhoto[]>(`/photos?${params}`) })
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    }
  }

  const load = useCallback(async () => {
    const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo })
    if (houseId) params.set('house_id', houseId)
    try {
      setRecords(await api<OwnerRecord[]>(`/records?${params}`))
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    }
  }, [houseId, dateFrom, dateTo])

  useEffect(() => {
    api<House[]>('/houses').then(setHouses, () => {})
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function remove(record: OwnerRecord) {
    const label = `${record.house_name}, ${formatDate(record.record_date)}`
    if (!window.confirm(`Hapus catatan ${label}? Data tetap tersimpan sebagai arsip.`)) return
    setMessage(null)
    try {
      await api(`/records/${record.id}`, { method: 'DELETE' })
      await load()
      setMessage({ kind: 'success', text: `Catatan ${label} dihapus.` })
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    }
  }

  return (
    <>
      <h1>Catatan harian</h1>
      <section className="card stack">
        <label>
          Kandang
          <select value={houseId} onChange={(e) => setHouseId(e.target.value)}>
            <option value="">Semua kandang</option>
            {houses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid-2">
          <label>
            Dari
            <input type="date" value={dateFrom} max={dateTo}
              onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label>
            Sampai
            <input type="date" value={dateTo} min={dateFrom} max={today}
              onChange={(e) => setDateTo(e.target.value)} />
          </label>
        </div>
      </section>

      {message && (
        <div className={`alert ${message.kind === 'success' ? 'success' : ''}`} role="status"
          style={{ marginBottom: 12 }}>
          {message.text}
        </div>
      )}

      {viewing && (
        <section className="card stack" aria-label="Foto tray">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>
              Foto tray · {viewing.record.house_name}, {formatDate(viewing.record.record_date)}
            </h2>
            <button className="small secondary" onClick={() => setViewing(null)}>
              Tutup
            </button>
          </div>
          <div className="photo-grid">
            {viewing.photos.map((photo) => {
              const label = photo.tray_category ? TRAY_LABELS[photo.tray_category] : 'Foto'
              return (
                <figure key={photo.id}>
                  <AuthImage photoId={photo.id} alt={label} />
                  <figcaption className="muted">
                    {label}
                    {photo.label_count !== null && ` · ${formatNumber(photo.label_count)} butir`}
                  </figcaption>
                </figure>
              )
            })}
          </div>
        </section>
      )}

      <section className="card">
        {records === null ? (
          <p className="muted">Memuat…</p>
        ) : records.length === 0 ? (
          <p className="muted">Belum ada catatan pada periode ini.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Kandang</th>
                  <th className="num">Telur</th>
                  <th className="num">HDP</th>
                  <th className="num">Pakan/ekor</th>
                  <th className="num">Mati</th>
                  <th className="num">Afkir</th>
                  <th>Diisi oleh</th>
                  <th>Sinkron</th>
                  <th>Foto</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.record_date)}</td>
                    <td>{r.house_name}</td>
                    <td className="num">
                      {formatNumber(r.eggs_good + r.eggs_cracked + r.eggs_rejected + r.eggs_dirty)}
                    </td>
                    <td className="num">{formatNumber(r.hdp, 1)}%</td>
                    <td className="num">{formatNumber(r.feed_per_bird_g, 1)} g</td>
                    <td className="num">{formatNumber(r.dead)}</td>
                    <td className="num">{formatNumber(r.culled)}</td>
                    <td>{r.updated_by_name}</td>
                    <td>{formatDateTime(r.server_updated_at)}</td>
                    <td>
                      {r.photo_count > 0 ? (
                        <button className="small secondary" onClick={() => showPhotos(r)}>
                          Lihat ({r.photo_count})
                        </button>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td>
                      <button className="small danger" onClick={() => remove(r)}
                        aria-label={`Hapus catatan ${r.house_name} ${formatDate(r.record_date)}`}>
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
