import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { FeedStock } from '../../api/types'
import NumberField from '../../components/NumberField'
import { farmDate } from '../../lib/farmDate'
import { formatNumber } from '../../lib/format'
import { parseDecimal } from '../../lib/validation'

/** One feed stock: purchases in, daily records out (ADR 0003). */
export default function FeedSection({ onChange }: { onChange: () => void }) {
  const today = farmDate()
  const [feed, setFeed] = useState<FeedStock | null>(null)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [purchase, setPurchase] = useState({ purchase_date: today, quantity_kg: '', supplier: '', price_total: '' })
  const [counted, setCounted] = useState('')

  const load = useCallback(async () => {
    try {
      setFeed(await api<FeedStock>('/stock/feed'))
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function post(path: string, body: object, success: string) {
    setMessage(null)
    try {
      setFeed(await api<FeedStock>(path, { method: 'POST', body: JSON.stringify(body) }))
      setMessage({ kind: 'success', text: success })
      onChange() // refresh the history
      return true
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
      return false
    }
  }

  const kg = parseDecimal(purchase.quantity_kg)
  const price = purchase.price_total.trim() === '' ? null : parseDecimal(purchase.price_total)

  async function submitPurchase(event: FormEvent) {
    event.preventDefault()
    const ok = await post(
      '/stock/feed/purchases',
      { ...purchase, quantity_kg: kg, price_total: price },
      `Pembelian ${formatNumber(kg ?? 0, 1)} kg pakan dicatat.`,
    )
    if (ok) setPurchase({ ...purchase, quantity_kg: '', price_total: '' })
  }

  async function submitCount(event: FormEvent) {
    event.preventDefault()
    const ok = await post(
      '/stock/feed/count',
      { counted_kg: parseDecimal(counted) },
      'Hasil timbang pakan disimpan. Stok disesuaikan.',
    )
    if (ok) setCounted('')
  }

  return (
    <>
      <h1 style={{ marginTop: 24 }}>Stok pakan</h1>
      {message && (
        <div className={`alert ${message.kind === 'success' ? 'success' : ''}`} role="status"
          style={{ marginBottom: 12 }}>
          {message.text}
        </div>
      )}
      {feed && (
        <section className={`card stock-card ${feed.low ? 'stock-card--held' : ''}`}>
          <span className="muted">Sisa pakan</span>
          <strong data-testid="feed-stock">{formatNumber(Number(feed.stock_kg), 1)} kg</strong>
          <span className="muted">
            Pemakaian rata-rata 7 hari: {formatNumber(Number(feed.per_day_kg), 1)} kg/hari
          </span>
          {feed.days_left !== null && (
            <span>
              Cukup untuk sekitar <strong>{formatNumber(Math.max(0, feed.days_left), 1)} hari</strong>
            </span>
          )}
          {feed.low && (
            <div className="alert" role="alert">
              Stok pakan menipis (kurang dari 7 hari). Segera beli pakan.
            </div>
          )}
        </section>
      )}

      <form className="card stack" onSubmit={submitPurchase} style={{ marginTop: 16 }}>
        <h2>Catat pembelian pakan</h2>
        <label>
          Tanggal
          <input type="date" value={purchase.purchase_date} max={today} required
            onChange={(e) => setPurchase({ ...purchase, purchase_date: e.target.value })} />
        </label>
        <NumberField id="feed-kg" label="Jumlah" unit="kg" decimal value={purchase.quantity_kg}
          onChange={(v) => setPurchase({ ...purchase, quantity_kg: v })} />
        <label>
          <span>
            Pemasok <span className="muted">– opsional</span>
          </span>
          <input value={purchase.supplier} maxLength={100}
            onChange={(e) => setPurchase({ ...purchase, supplier: e.target.value })} />
        </label>
        <NumberField id="feed-price" label="Total harga" unit="Rp" decimal optional
          value={purchase.price_total}
          onChange={(v) => setPurchase({ ...purchase, price_total: v })} />
        <button type="submit" disabled={kg === null || kg <= 0}>Simpan pembelian</button>
      </form>

      <form className="card stack" onSubmit={submitCount}>
        <h2>Timbang pakan di gudang</h2>
        <NumberField id="feed-count" label="Pakan sebenarnya" unit="kg" decimal value={counted}
          onChange={setCounted} />
        <button type="submit" disabled={parseDecimal(counted) === null}>Simpan hasil timbang</button>
      </form>
    </>
  )
}
