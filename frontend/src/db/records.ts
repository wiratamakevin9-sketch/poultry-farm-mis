import type { FarmDb, LocalRecord, RecordValues } from './db'

export interface SaveInput {
  id?: string // omit for a new record
  house_id: string
  flock_id: string
  record_date: string
  values: RecordValues
  user_id: string
}

/** Save a record on the phone and queue it for sync. Works with no internet. */
export async function saveRecord(db: FarmDb, input: SaveInput): Promise<LocalRecord> {
  return db.transaction('rw', db.records, db.outbox, async () => {
    const existing = input.id ? await db.records.get(input.id) : undefined
    const now = new Date().toISOString()
    const record: LocalRecord = {
      ...input.values,
      id: existing?.id ?? input.id ?? crypto.randomUUID(),
      house_id: input.house_id,
      flock_id: existing?.flock_id ?? input.flock_id,
      record_date: input.record_date,
      base_version: existing?.base_version ?? 0,
      updated_at: now,
      sync_status: 'pending',
      created_by: existing?.created_by ?? input.user_id,
    }
    await db.records.put(record)
    await db.outbox.add({ record_id: record.id, queued_at: now })
    return record
  })
}

/** Number of records waiting to be sent. */
export async function countPending(db: FarmDb): Promise<number> {
  const ids = await db.outbox.orderBy('record_id').uniqueKeys()
  return ids.length
}

export async function findRecord(
  db: FarmDb,
  houseId: string,
  recordDate: string,
): Promise<LocalRecord | undefined> {
  return db.records.where('[house_id+record_date]').equals([houseId, recordDate]).first()
}
