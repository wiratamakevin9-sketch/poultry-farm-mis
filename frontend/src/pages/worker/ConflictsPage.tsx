import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import ConflictCard, { type Resolution } from '../../components/ConflictCard'
import type { Conflict, RecordValues } from '../../db/db'
import { liveBirdsAtStart } from '../../db/records'
import { useWorker } from '../../sync/WorkerContext'

function WorkerConflict({ conflict }: { conflict: Conflict }) {
  const { db, sync } = useWorker()
  const liveBirds = useLiveQuery(async () => {
    const flock = (await db.houses.get(conflict.house_id))?.active_flock
    if (!flock || flock.id !== conflict.server_record.flock_id) return null
    return liveBirdsAtStart(db, flock.id, flock.initial_bird_count, conflict.record_date)
  }, [db, conflict.id])

  async function resolve(resolution: Resolution, values?: RecordValues) {
    await api(`/conflicts/${conflict.id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({
        resolution,
        server_version: conflict.server_record.version,
        values,
      }),
    })
    await db.conflicts.delete(conflict.id)
    await sync.sync() // pull the chosen copy and clean up the local duplicate
  }

  if (liveBirds === undefined) return null
  return (
    <ConflictCard
      conflict={conflict}
      liveBirds={liveBirds}
      deviceLabel="Data saya"
      takeLabel="Pakai data saya"
      lockedMessage="Batas waktu sudah lewat. Konflik ini akan diselesaikan oleh pemilik."
      onResolve={resolve}
    />
  )
}

export default function ConflictsPage() {
  const { db } = useWorker()
  const conflicts = useLiveQuery(() => db.conflicts.orderBy('device_record_id').toArray(), [db])

  return (
    <>
      <Link to="/">← Kembali</Link>
      <h1 style={{ marginTop: 8 }}>Data bentrok</h1>
      <p className="muted">
        Bandingkan data Anda dengan data di server, lalu pilih yang benar. Data yang tidak
        dipilih tetap disimpan di server.
      </p>
      {conflicts?.length === 0 && <div className="alert success">Tidak ada data bentrok.</div>}
      {conflicts?.map((conflict) => (
        <WorkerConflict key={conflict.id} conflict={conflict} />
      ))}
    </>
  )
}
