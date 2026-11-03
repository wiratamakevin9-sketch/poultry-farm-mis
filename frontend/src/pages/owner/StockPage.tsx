import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { EggStock, StockMovement } from '../../api/types'
import NumberField from '../../components/NumberField'
import { farmDate } from '../../lib/farmDate'
import { formatDate, formatNumber } from '../../lib/format'
import { EGG_GRADES, STOCK_ITEMS, type EggGrade } from '../../lib/labels'

const KIND = { DISPOSAL: 'Dibuang', COUNT: 'Hitung fisik', PURCHASE: 'Pembelian' } as const

export default function StockPage() {
  const [stock, setStock] = useState<EggStock | null>(null)
  const [moves, setMoves] = useState<StockMovement[]>([])
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [dispose, setDispose] = useState({ grade: 'WITHHELD' as EggGrade, quantity: '', reason: '' })
  const [count, setCount] = useState({ grade: 'GOOD' as EggGrade, counted: '', reason: '' })

  const load = useCallback(async () => {
    try {
      setStock(await api<EggStock>('/stock/eggs'))
      setMoves(await api<StockMovement[]>('/stock/movements'))
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
      await api(path, { method: 'POST', body: JSON.stringify(body) })
      setMessage({ kind: 'success', text: success })
      await load()
      return true
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
      return false
    }
  }

  async function submitDisposal(event: FormEvent) {
    event.preventDefault()
    const ok = await post(
      '/stock/eggs/disposals',
      { disposal_date: farmDate(), grade: dispose.grade, quantity: Number(dispose.quantity), reason: dispose.reason },
      'Pembuangan telur dicatat.',
    )
    if (ok) setDispose({ ...dispose, quantity: '', reason: '' })
  }

  async function submitCount(event: FormEvent) {
    event.preventDefault()
    const ok = await post(
      '/stock/eggs/count',
      { grade: count.grade, counted: Number(count.counted), reason: count.reason },
      'Hasil hitung fisik disimpan. Stok disesuaikan.',
    )
    if (ok) setCount({ ...count, counted: '', reason: '' })
  }

  return (
    <>
      <h1>Stok telur</h1>
      <p className="muted">
        Dihitung dari catatan harian, penjualan, pembuangan dan hitung fisik. Berat diperkirakan{' '}
        {stock?.egg_weight_g ?? 62} g per butir.
      </p>
      {message && (
        <div className={`alert ${message.kind === 'success' ? 'success' : ''}`} role="status"
          style={{ marginBottom: 12 }}>
          {message.text}
        </div>
      )}

      <div className="stock-grid">
        {stock?.lines.map((line) => (
          <section key={line.grade} className={`card stock-card ${line.sellable ? '' : 'stock-card--held'}`}>
            <span className="muted">{EGG_GRADES[line.grade]}</span>
            <strong data-testid={`stock-${line.grade}`}>{formatNumber(line.eggs)} butir</strong>
            <span className="muted">± {formatNumber(line.kg, 1)} kg</span>
            {!line.sellable && <span className="badge bad">Tidak boleh dijual</span>}
            {line.eggs < 0 && (
              <span className="field-error">Minus: periksa catatan atau lakukan hitung fisik.</span>
            )}
          </section>
        ))}
      </div>

      <form className="card stack" onSubmit={submitDisposal}>
        <h2>Catat pembuangan telur</h2>
        <label>
          Jenis telur
          <select value={dispose.grade}
            onChange={(e) => setDispose({ ...dispose, grade: e.target.value as EggGrade })}>
            {Object.entries(EGG_GRADES).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <NumberField id="dispose-qty" label="Jumlah" unit="butir" value={dispose.quantity}
          onChange={(v) => setDispose({ ...dispose, quantity: v })} />
        <label>
          <span>
            Alasan <span className="muted">– opsional</span>
          </span>
          <input value={dispose.reason} maxLength={500} placeholder="Contoh: masa henti obat"
            onChange={(e) => setDispose({ ...dispose, reason: e.target.value })} />
        </label>
        <button type="submit" disabled={!/^\d+$/.test(dispose.quantity) || dispose.quantity === '0'}>
          Catat pembuangan
        </button>
      </form>

      <form className="card stack" onSubmit={submitCount}>
        <h2>Hitung fisik (stok opname)</h2>
        <p className="muted" style={{ margin: 0 }}>
          Isi jumlah yang benar-benar ada di gudang. Selisihnya dicatat sebagai penyesuaian.
        </p>
        <label>
          Jenis telur
          <select value={count.grade}
            onChange={(e) => setCount({ ...count, grade: e.target.value as EggGrade })}>
            {Object.entries(EGG_GRADES).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <NumberField id="count-qty" label="Jumlah sebenarnya" unit="butir" value={count.counted}
          onChange={(v) => setCount({ ...count, counted: v })} />
        <label>
          <span>
            Catatan <span className="muted">– opsional</span>
          </span>
          <input value={count.reason} maxLength={500}
            onChange={(e) => setCount({ ...count, reason: e.target.value })} />
        </label>
        <button type="submit" disabled={!/^\d+$/.test(count.counted)}>Simpan hitung fisik</button>
      </form>

      <section className="card">
        <h2>Riwayat 30 hari</h2>
        {moves.length === 0 ? (
          <p className="muted">Belum ada pembuangan atau hitung fisik.</p>
        ) : (
          <ul className="item-list">
            {moves.map((m, i) => (
              <li key={i}>
                <strong>{formatDate(m.date)}</strong> · {KIND[m.kind]} · {STOCK_ITEMS[m.item]}{' '}
                <strong>{Number(m.quantity) > 0 ? '+' : ''}{formatNumber(Number(m.quantity))}</strong>
                <div className="muted">
                  {m.by}
                  {m.note && ` · ${m.note}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
