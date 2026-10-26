import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import ConflictCard, { type Resolution } from '../../components/ConflictCard'
import type { Conflict, RecordValues } from '../../db/db'
import { addDays } from '../../lib/farmDate'
import { formatDate } from '../../lib/format'

export default function OwnerConflictsPage() {
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setConflicts(await api<Conflict[]>('/conflicts'))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function resolver(conflict: Conflict) {
    return async (resolution: Resolution, values?: RecordValues) => {
      await api(`/conflicts/${conflict.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          resolution,
          server_version: conflict.server_record.version,
          values,
        }),
      })
      await load()
    }
  }

  const mine = conflicts?.filter((c) => c.can_resolve) ?? []
  const waiting = conflicts?.filter((c) => !c.can_resolve) ?? []

  return (
    <>
      <h1>Data bentrok</h1>
      <p className="muted">
        Pekerja menyelesaikan data bentrok di HP masing-masing sampai batas waktu (hari
        berikutnya). Setelah itu, konflik yang belum selesai muncul di sini untuk Anda.
      </p>
      {error && <div className="alert">{error}</div>}
      {conflicts?.length === 0 && <div className="alert success">Tidak ada data bentrok.</div>}

      {mine.map((conflict) => (
        <ConflictCard
          key={conflict.id}
          conflict={conflict}
          liveBirds={null}
          deviceLabel={`Data ${conflict.submitted_by_name}`}
          takeLabel={`Pakai data ${conflict.submitted_by_name}`}
          lockedMessage=""
          onResolve={resolver(conflict)}
        />
      ))}

      {waiting.length > 0 && (
        <section className="card">
          <h2>Menunggu pekerja</h2>
          <ul className="item-list">
            {waiting.map((c) => (
              <li key={c.id}>
                <strong>
                  {c.house_name} · {formatDate(c.record_date)}
                </strong>
                <div className="muted">
                  {c.submitted_by_name} bisa menyelesaikan sampai{' '}
                  {formatDate(addDays(c.record_date, 1))}.
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
