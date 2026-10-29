import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, apiBlob } from '../../api/client'
import type { OwnerObservation } from '../../api/types'
import AuthImage from '../../components/AuthImage'
import { formatDate, formatDateTime, formatNumber } from '../../lib/format'
import { downloadBlob, emailLink, sharePdf, whatsappLink } from '../../lib/share'
import { STATUS_LABELS, SYMPTOMS } from '../../lib/symptoms'
import { HEALTH_COUNT_CHANGED } from './useNewHealthCount'

const CHANNELS = { WHATSAPP: 'WhatsApp', EMAIL: 'Email', OTHER: 'Lainnya' } as const

export default function OwnerHealthDetail() {
  const { id = '' } = useParams()
  const [observation, setObservation] = useState<OwnerObservation | null>(null)
  const [advice, setAdvice] = useState('')
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Opening the report marks it as seen on the server.
    api<OwnerObservation>(`/health-observations/${id}`).then(
      (o) => {
        setObservation(o)
        setAdvice(o.vet_advice)
        window.dispatchEvent(new Event(HEALTH_COUNT_CHANGED))
      },
      (err) => setMessage({ kind: 'error', text: (err as Error).message }),
    )
  }, [id])

  if (!observation) {
    return message ? <div className="alert">{message.text}</div> : <p className="muted">Memuat…</p>
  }
  const o = observation
  const day = formatDate(o.observed_at.slice(0, 10))
  const filename = `laporan-kesehatan-${o.house_name.replace(/\s+/g, '-').toLowerCase()}.pdf`
  const summary =
    `Laporan kesehatan ayam ${o.house_name}, ${formatDateTime(o.observed_at)} WITA. ` +
    'Mohon saran dokter hewan. PDF terlampir.'

  async function run(action: () => Promise<void>, success: string) {
    setMessage(null)
    setBusy(true)
    try {
      await action()
      setMessage({ kind: 'success', text: success })
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function share() {
    setMessage(null)
    setBusy(true)
    try {
      const result = await sharePdf(await apiBlob(`/health-observations/${o.id}/pdf`), filename, summary)
      if (result === 'shared') {
        setMessage({ kind: 'success', text: 'PDF dibagikan. Tandai lewat apa PDF dikirim di bawah.' })
      } else if (result === 'downloaded') {
        setMessage({
          kind: 'success',
          text: 'PDF diunduh. Kirim lewat WhatsApp Web atau email, lalu lampirkan file PDF-nya.',
        })
      }
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const update = (body: object, success: string) =>
    run(async () => {
      const next = await api<OwnerObservation>(`/health-observations/${o.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      setObservation(next)
    }, success)

  const forwarded = (via: keyof typeof CHANNELS) =>
    run(async () => {
      const next = await api<OwnerObservation>(`/health-observations/${o.id}/forward`, {
        method: 'POST',
        body: JSON.stringify({ via }),
      })
      setObservation(next)
    }, `Ditandai sudah dikirim ke dokter hewan lewat ${CHANNELS[via]}.`)

  return (
    <div className="stack">
      <div>
        <Link className="tap-link" to="/pemilik/kesehatan">
          ← Kembali
        </Link>
        <h1 style={{ marginTop: 8, marginBottom: 4 }}>
          {o.house_name} · {day}
        </h1>
        <span className="badge">{STATUS_LABELS[o.status]}</span>
      </div>

      {message && (
        <div className={`alert ${message.kind === 'success' ? 'success' : ''}`} role="status">
          {message.text}
        </div>
      )}

      <section className="card stack">
        <div className="muted">
          {formatDateTime(o.observed_at)} WITA · dilaporkan oleh {o.created_by_name}
          {o.affected_count !== null && ` · perkiraan ${formatNumber(o.affected_count)} ekor terkena`}
        </div>
        <div>
          <strong>Gejala yang terlihat</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {o.symptoms.map((code) => (
              <li key={code}>{SYMPTOMS[code] ?? code}</li>
            ))}
            {o.other_symptoms && <li>Lainnya: {o.other_symptoms}</li>}
          </ul>
        </div>
        {o.notes && (
          <div>
            <strong>Catatan pekerja</strong>
            <p style={{ margin: '4px 0 0' }}>{o.notes}</p>
          </div>
        )}
        <div className="alert warning">
          Ini pengamatan pekerja, bukan diagnosis. Keputusan ada pada dokter hewan.
        </div>
      </section>

      {o.photo_ids.length > 0 ? (
        <section className="card photo-grid" aria-label="Foto">
          {o.photo_ids.map((photoId, i) => (
            <AuthImage key={photoId} photoId={photoId} alt={`Foto ${i + 1} ${o.house_name}`} />
          ))}
        </section>
      ) : (
        <p className="muted">Foto belum terkirim dari HP pekerja.</p>
      )}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Teruskan ke dokter hewan</h2>
        <button disabled={busy} onClick={share}>
          Bagikan PDF (WhatsApp / Email)
        </button>
        <button className="secondary" disabled={busy}
          onClick={() =>
            run(async () => downloadBlob(await apiBlob(`/health-observations/${o.id}/pdf`), filename), 'PDF diunduh.')
          }>
          Unduh PDF
        </button>
        <div className="row">
          <a className="button secondary" href={whatsappLink(summary)} target="_blank" rel="noreferrer">
            Buka WhatsApp Web
          </a>
          <a className="button secondary" href={emailLink(`Laporan kesehatan ayam ${o.house_name}`, summary)}>
            Tulis email
          </a>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Di HP, “Bagikan PDF” langsung membuka WhatsApp atau email dengan PDF terlampir. Di
          komputer, unduh PDF lalu lampirkan di WhatsApp Web atau email.
        </p>
        <div>
          <strong>Sudah dikirim lewat:</strong>
          <div className="row" style={{ marginTop: 6 }}>
            {(Object.keys(CHANNELS) as (keyof typeof CHANNELS)[]).map((via) => (
              <button key={via} className="small secondary" disabled={busy} onClick={() => forwarded(via)}>
                {CHANNELS[via]}
              </button>
            ))}
          </div>
          {o.forwarded_at && (
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Dikirim {formatDateTime(o.forwarded_at)} lewat {CHANNELS[o.forwarded_via ?? 'OTHER']}.
            </p>
          )}
        </div>
      </section>

      <section className="card stack">
        <label htmlFor="advice">
          Saran dokter hewan
          <textarea id="advice" rows={3} maxLength={2000} value={advice}
            onChange={(e) => setAdvice(e.target.value)}
            placeholder="Tulis saran dokter hewan agar pekerja bisa membacanya" />
        </label>
        <button className="secondary" disabled={busy}
          onClick={() => update({ vet_advice: advice }, 'Saran dokter hewan disimpan.')}>
          Simpan saran
        </button>
        {o.status === 'CLOSED' ? (
          <button className="secondary" disabled={busy}
            onClick={() => update({ status: 'SEEN' }, 'Laporan dibuka lagi.')}>
            Buka lagi
          </button>
        ) : (
          <button disabled={busy}
            onClick={() => update({ status: 'CLOSED', vet_advice: advice }, 'Laporan ditandai selesai.')}>
            Tandai selesai
          </button>
        )}
      </section>
    </div>
  )
}
