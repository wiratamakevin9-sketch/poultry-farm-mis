import { createContext, useContext, type ReactNode } from 'react'
import type { SessionUser } from '../auth/storage'
import type { FarmDb } from '../db/db'
import { useSync, type SyncState } from './useSync'

interface WorkerContextValue {
  user: SessionUser
  db: FarmDb
  sync: SyncState
}

const WorkerContext = createContext<WorkerContextValue | null>(null)

export function WorkerProvider({
  user,
  db,
  run,
  children,
}: {
  user: SessionUser
  db: FarmDb
  run?: (db: FarmDb) => Promise<void> // tests pass a fake sync
  children: ReactNode
}) {
  const sync = useSync(db, run)
  return <WorkerContext.Provider value={{ user, db, sync }}>{children}</WorkerContext.Provider>
}

export function useWorker(): WorkerContextValue {
  const value = useContext(WorkerContext)
  if (!value) throw new Error('useWorker must be used inside WorkerProvider')
  return value
}
