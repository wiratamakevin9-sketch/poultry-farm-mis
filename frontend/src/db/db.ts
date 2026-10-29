import Dexie, { type EntityTable } from 'dexie'
import type { House } from '../api/types'
import type { ObservationStatus } from '../lib/symptoms'

export type SyncStatus = 'pending' | 'synced' | 'conflict' | 'rejected'

/** The values a worker types in. */
export interface RecordValues {
  eggs_good: number
  eggs_cracked: number
  eggs_rejected: number
  eggs_dirty: number
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

export type PhotoKind = 'TRAY' | 'HEALTH'
export type TrayCategory = 'GOOD_REMAINDER' | 'CRACKED' | 'DIRTY'
export type PhotoStatus = 'pending' | 'uploaded' | 'failed'

/** A photo taken on this phone. The full image is dropped after upload; the thumbnail stays. */
export interface LocalPhoto {
  id: string // UUID made on the phone
  kind: PhotoKind
  house_id: string
  record_date?: string // TRAY: the daily record's day
  tray_category?: TrayCategory
  label_count?: number | null // eggs on the tray as counted by the worker
  observation_id?: string // HEALTH: the observation it belongs to
  blob?: Blob
  thumb: Blob
  width: number
  height: number
  taken_at: string
  status: PhotoStatus
  error?: string
}

/** UC14: a health observation made on this phone (or pulled back to show its status). */
export interface LocalObservation {
  id: string // UUID made on the phone
  house_id: string
  observed_at: string
  symptoms: string[]
  other_symptoms: string
  affected_count: number | null
  notes: string
  sync_status: 'pending' | 'synced' | 'rejected'
  errors?: Record<string, string>
  // From the server once the owner has acted on it.
  status?: ObservationStatus
  vet_advice?: string
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
  photos: EntityTable<LocalPhoto, 'id'>
  observations: EntityTable<LocalObservation, 'id'>
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
  // Version 2: photos (UC13 egg trays, UC14 health observations).
  db.version(2).stores({
    photos: 'id, status, [house_id+record_date], observation_id',
  })
  // Version 3: health observations (UC14).
  db.version(3).stores({
    observations: 'id, sync_status, observed_at',
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
