import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, NetworkError } from '../api/client'
import { getMeta, type FarmDb } from '../db/db'
import { countPending } from '../db/records'
import { syncNow } from './engine'

export const SYNC_INTERVAL_MS = 60_000

export interface SyncState {
  online: boolean
  syncing: boolean
  pending: number
  conflicts: number
  lastSyncAt: string | null
  error: string | null
  sync: () => Promise<void>
}

/**
 * Runs the sync engine on app start, when the browser comes back online, every
 * 60 seconds while online, and when the worker presses "Sinkronkan".
 */
export function useSync(db: FarmDb, run: (db: FarmDb) => Promise<void> = syncNow): SyncState {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useLiveQuery(() => countPending(db), [db], 0)
  const conflicts = useLiveQuery(() => db.conflicts.count(), [db], 0)
  const lastSyncAt = useLiveQuery(() => getMeta<string | null>(db, 'last_sync_at', null), [db], null)

  const sync = useCallback(async () => {
    setSyncing(true)
    try {
      await run(db)
      setOnline(true)
      setError(null)
    } catch (err) {
      if (err instanceof NetworkError) {
        setOnline(false)
        setError(null) // being offline is normal, not an error
      } else if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Sinkronisasi gagal. Data tetap aman di HP dan akan dicoba lagi.')
      }
    } finally {
      setSyncing(false)
    }
  }, [db, run])

  useEffect(() => {
    sync() // app start

    const goOnline = () => {
      setOnline(true)
      sync()
    }
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    const timer = window.setInterval(() => {
      if (navigator.onLine) sync()
    }, SYNC_INTERVAL_MS)

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      window.clearInterval(timer)
    }
  }, [sync])

  return { online, syncing, pending, conflicts, lastSyncAt, error, sync }
}
