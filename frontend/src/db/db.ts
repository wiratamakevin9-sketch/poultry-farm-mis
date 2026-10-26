import Dexie, { type EntityTable } from 'dexie'
import type { House } from '../api/types'

export type SyncStatus = 'pending' | 'synced' | 'conflict' | 'rejected'

/** The values a worker types in. */
export interface RecordValues {
  eggs_good: number
  eggs_cracked: number
  eggs_rejected: number
  feed_kg: number
  water_liters: number | null
  dead: number
  culled: number
  notes: string
}

export interface LocalRecord extends RecordValues {
  id: string // UUID made on the phone
  house_id: string
  flock_id: string
  record_date: string // YYYY-MM-DD, farm time
  base_version: number // server version this copy is based on; 0 = never synced
  updated_at: string // when it was saved on this phone (ISO)
  sync_status: SyncStatus
  errors?: Record<string, string> // why the server rejected it
  created_by?: string
}

/** One entry per create or edit; the sync engine sends the latest copy of each record. */
export interface OutboxEntry {
  seq?: number
  record_id: string
  queued_at: string
}

export interface ServerRecord extends RecordValues {
  id: string
  house_id: string
  flock_id: string
  record_date: string
  version: number
  change_seq: number
  created_by: string
  updated_by: string
  client_updated_at: string
  server_updated_at: string
  deleted: boolean
}

export interface Conflict {
  id: string
  record_id: string
  device_record_id: string
  house_id: string
  house_name: string
  record_date: string
  reason: 'VERSION' | 'DUPLICATE_DAY'
  status: 'OPEN' | 'RESOLVED'
  device_payload: RecordValues & { id: string }
  server_record: ServerRecord
  submitted_by: string
  submitted_by_name: string
  created_at: string
  can_resolve: boolean
}

interface Meta {
  key: string
  value: unknown
}

export type FarmDb = Dexie & {
  records: EntityTable<LocalRecord, 'id'>
  outbox: EntityTable<OutboxEntry, 'seq'>
  houses: EntityTable<House, 'id'>
  conflicts: EntityTable<Conflict, 'id'>
  meta: EntityTable<Meta, 'key'>
}

function createDb(name: string): FarmDb {
  const db = new Dexie(name) as FarmDb
  db.version(1).stores({
    records: 'id, [house_id+record_date], sync_status',
    outbox: '++seq, record_id',
    houses: 'id',
    conflicts: 'id, device_record_id',
    meta: 'key',
  })
  return db
}

// One database per user, so workers sharing a phone never mix their offline data.
let current: { userId: string; db: FarmDb } | null = null

export function getDb(userId: string): FarmDb {
  if (current?.userId !== userId) {
    current?.db.close()
    current = { userId, db: createDb(`poultry-farm-${userId}`) }
  }
  return current.db
}

export async function getMeta<T>(db: FarmDb, key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export async function setMeta(db: FarmDb, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}
