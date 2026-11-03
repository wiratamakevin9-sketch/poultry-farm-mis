import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { Buyer, EggStock, Sale } from '../../api/types'
import NumberField from '../../components/NumberField'
import { addDays, farmDate } from '../../lib/farmDate'
import { formatDate, formatNumber, formatRupiah } from '../../lib/format'
import { EGG_GRADES } from '../../lib/labels'
import { parseDecimal } from '../../lib/validation'

type SaleGrade = Sale['grade']
const SELLABLE: SaleGrade[] = ['GOOD', 'CRACKED', 'DIRTY']

export default function SalesPage() {
  const today = farmDate()
  const [buyers, setBuyers] = useState<Buyer[]>([])
  const [sales, setSales] = useState<Sale[] | null>(null)
  const [stock, setStock] = useState<EggStock | null>(null)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [form, setForm] = useState({
    sale_date: today,
    buyer_id: '',
    grade: 'GOOD' as SaleGrade,
    weight_kg: '',
    price_per_kg: '',
    quantity: '',
    notes: '',
  })
  const [newBuyer, setNewBuyer] = useState({ name: '', phone: '' })

  const load = useCallback(async () => {
    const params = new URLSearchParams({ date_from: addDays(today, -29), date_to: today })
    try {
      const [b, s, st] = await Promise.all([
        api<Buyer[]>('/buyers'),
        api<Sale[]>(`/sales?${params}`),
        api<EggStock>('/stock/eggs'),
      ])
      setBuyers(b)
      setSales(s)
      setStock(st)
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    }
  }, [today])

  useEffect(() => {
    load()
  }, [load])

  const available = (grade: string) => stock?.lines.find((l) => l.grade === grade)?.eggs ?? 0
  const kg = parseDecimal(form.weight_kg)
  const price = parseDecimal(form.price_per_kg)
  const eggWeight = stock?.egg_weight_g ?? 62
  const estimate = kg !== null ? Math.max(1, Math.round((kg * 1000) / eggWeight)) : null
  const quantity = form.quantity.trim() === '' ? estimate : Number(form.quantity)
  const total = kg !== null && price !== null ? Math.round(kg * price) : null
  const tooMany = quantity !== null && quantity > available(form.grade)
  const valid = form.buyer_id && kg !== null && kg > 0 && price !== null && !tooMany

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

  async function submitSale(event: FormEvent) {
    event.preventDefault()
    const ok = await run(
      () =>
        api('/sales', {
          method: 'POST',
          body: JSON.stringify({
            sale_date: form.sale_date,
            buyer_id: form.buyer_id,
            grade: form.grade,
            weight_kg: kg,
            price_per_kg: price,
            quantity: form.quantity.trim() === '' ? null : Number(form.quantity),
            notes: form.notes,
          }),
        }),
      'Penjualan dicatat. Stok telur sudah dikurangi.',
    )
    if (ok) setForm({ ...form, weight_kg: '', quantity: '', notes: '' })
  }

  async function addBuyer(event: FormEvent) {
    event.preventDefault()
    const ok = await run(
      () => api('/buyers', { method: 'POST', body: JSON.stringify(newBuyer) }),
      `Pembeli ${newBuyer.name} ditambahkan.`,
    )
    if (ok) setNewBuyer({ name: '', phone: '' })
  }

  function removeSale(sale: Sale) {
    if (!window.confirm(`Hapus penjualan ke ${sale.buyer_name}? Telurnya kembali ke stok.`)) return
    run(() => api(`/sales/${sale.id}`, { method: 'DELETE' }), 'Penjualan dihapus.')
  }

  const monthTotal = (sales ?? []).reduce((sum, s) => sum + Number(s.total), 0)
  const monthKg = (sales ?? []).reduce((sum, s) => sum + Number(s.weight_kg), 0)

  return (
    <>
      <h1>Penjualan telur</h1>
      {message && (
        <div className={`alert ${message.kind === 'success' ? 'success' : ''}`} role="status"
          style={{ marginBottom: 12 }}>
          {message.text}
        </div>
      )}

      <form className="card stack" onSubmit={submitSale}>
        <h2>Catat penjualan</h2>
        <label>
          Tanggal
          <input type="date" value={form.sale_date} max={today} required
            onChange={(e) => setForm({ ...form, sale_date: e.target.value })} />
        </label>
        <label>
          Pembeli
          <select value={form.buyer_id} required
            onChange={(e) => setForm({ ...form, buyer_id: e.target.value })}>
            <option value="">Pilih pembeli…</option>
            {buyers.filter((b) => b.is_active).map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
        <label>
          Jenis telur
          <select value={form.grade}
            onChange={(e) => setForm({ ...form, grade: e.target.value as SaleGrade })}>
            {SELLABLE.map((grade) => (
              <option key={grade} value={grade}>
                {EGG_GRADES[grade]} (stok {formatNumber(available(grade))} butir)
              </option>
            ))}
          </select>
        </label>
        <p className="muted" style={{ margin: 0 }}>
          Telur dari kandang dalam masa henti obat tidak bisa dijual.
        </p>
        <div className="grid-2">
          <NumberField id="sale-kg" label="Berat" unit="kg" decimal value={form.weight_kg}
            onChange={(v) => setForm({ ...form, weight_kg: v })} />
          <NumberField id="sale-price" label="Harga per kg" unit="Rp" decimal
            value={form.price_per_kg} onChange={(v) => setForm({ ...form, price_per_kg: v })} />
        </div>
        <NumberField id="sale-qty" label="Jumlah butir" optional value={form.quantity}
          onChange={(v) => setForm({ ...form, quantity: v })}
          error={tooMany ? `Stok ${EGG_GRADES[form.grade].toLowerCase()} hanya ${formatNumber(available(form.grade))} butir.` : undefined} />
        {form.quantity.trim() === '' && estimate !== null && (
          <p className="muted" style={{ margin: 0 }}>
            Perkiraan {formatNumber(estimate)} butir ({eggWeight} g per butir).
          </p>
        )}
        <label>
          <span>
            Catatan <span className="muted">– opsional</span>
          </span>
          <input value={form.notes} maxLength={500}
            onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        <div className="preview" style={{ gridTemplateColumns: '1fr' }}>
          <div>
            <span className="muted">Total</span>
            <strong data-testid="sale-total">{total !== null ? formatRupiah(total) : '–'}</strong>
          </div>
        </div>
        <button type="submit" disabled={!valid}>Simpan penjualan</button>
      </form>

      <section className="card">
        <h2>30 hari terakhir</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {formatNumber(monthKg, 1)} kg · <strong>{formatRupiah(monthTotal)}</strong>
        </p>
        {sales?.length === 0 && <p className="muted">Belum ada penjualan.</p>}
        <ul className="item-list">
          {sales?.map((s) => (
            <li key={s.id} className="stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{formatDate(s.sale_date)} · {s.buyer_name}</strong>
                <strong>{formatRupiah(Number(s.total))}</strong>
              </div>
              <span className="muted">
                {EGG_GRADES[s.grade]} · {formatNumber(Number(s.weight_kg), 1)} kg ·{' '}
                {s.quantity_estimated ? '±' : ''}{formatNumber(s.quantity)} butir ·{' '}
                {formatRupiah(Number(s.price_per_kg))}/kg
                {s.notes && ` · ${s.notes}`}
              </span>
              <button className="small danger" style={{ alignSelf: 'flex-start' }}
                onClick={() => removeSale(s)}>
                Hapus
              </button>
            </li>
          ))}
        </ul>
      </section>

      <form className="card stack" onSubmit={addBuyer}>
        <h2>Pembeli</h2>
        {buyers.length > 0 && (
          <ul className="item-list">
            {buyers.map((b) => (
              <li key={b.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span>
                  <strong>{b.name}</strong>
                  {b.phone && <span className="muted"> · {b.phone}</span>}
                </span>
                <button type="button" className={`small ${b.is_active ? 'danger' : 'secondary'}`}
                  onClick={() =>
                    run(
                      () => api(`/buyers/${b.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !b.is_active }) }),
                      `${b.name} ${b.is_active ? 'dinonaktifkan' : 'diaktifkan'}.`,
                    )
                  }>
                  {b.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                </button>
              </li>
            ))}
          </ul>
        )}
        <label>
          Nama pembeli baru
          <input value={newBuyer.name} maxLength={100} required
            onChange={(e) => setNewBuyer({ ...newBuyer, name: e.target.value })} />
        </label>
        <label>
          <span>
            No. HP <span className="muted">– opsional</span>
          </span>
          <input type="tel" inputMode="tel" value={newBuyer.phone} maxLength={30}
            onChange={(e) => setNewBuyer({ ...newBuyer, phone: e.target.value })} />
        </label>
        <button type="submit" className="secondary">Tambah pembeli</button>
      </form>
    </>
  )
}
