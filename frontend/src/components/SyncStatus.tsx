import { useWorker } from '../sync/WorkerContext'

function timeAgo(iso: string | null): string {
  if (!iso) return 'belum pernah'
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'baru saja'
  if (minutes < 60) return `${minutes} menit lalu`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`
  return `${Math.round(hours / 24)} hari lalu`
}

/** Always visible: connection, records waiting to sync, and the manual sync button. */
export default function SyncStatus() {
  const { sync } = useWorker()
  return (
    <div className="sync-status" role="status" aria-live="polite">
      <div className="sync-status__info">
        <span className={`dot ${sync.online ? 'dot--online' : 'dot--offline'}`} aria-hidden />
        <strong>{sync.online ? 'Online' : 'Offline'}</strong>
        <span>
          {sync.pending > 0 ? `${sync.pending} data menunggu dikirim` : 'Semua data terkirim'}
        </span>
        <span className="sync-status__time">Sinkron: {timeAgo(sync.lastSyncAt)}</span>
      </div>
      <button className="small secondary" onClick={() => sync.sync()} disabled={sync.syncing}>
        {sync.syncing ? 'Menyinkronkan…' : 'Sinkronkan'}
      </button>
    </div>
  )
}
