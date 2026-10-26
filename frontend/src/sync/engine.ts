import { api } from '../api/client'
import type { House } from '../api/types'
import {
  getMeta,
  setMeta,
  type Conflict,
  type FarmDb,
  type LocalRecord,
  type ServerRecord,
} from '../db/db'

const PUSH_BATCH = 100

interface PushResult {
  id: string
  status: 'accepted' | 'conflict' | 'rejected'
  version: number | null
  conflict_id: string | null
  errors: Record<string, string>
}

interface PullResponse {
  records: ServerRecord[]
  cursor: number
  has_more: boolean
  houses: House[]
  conflicts: Conflict[]
  server_today: string
}

function toPayload(record: LocalRecord) {
  return {
    id: record.id,
    house_id: record.house_id,
    record_date: record.record_date,
    eggs_good: record.eggs_good,
    eggs_cracked: record.eggs_cracked,
    eggs_rejected: record.eggs_rejected,
    feed_kg: record.feed_kg,
    water_liters: record.water_liters,
    dead: record.dead,
    culled: record.culled,
    notes: record.notes,
    base_version: record.base_version,
    client_updated_at: record.updated_at,
  }
}

/** Send queued records. Entries are only removed after the server answered. */
export async function pushOutbox(db: FarmDb): Promise<void> {
  for (;;) {
    const entries = await db.outbox.orderBy('seq').limit(PUSH_BATCH * 5).toArray()
    if (entries.length === 0) return
    const maxSeq = entries[entries.length - 1].seq!
    const ids = [...new Set(entries.map((e) => e.record_id))].slice(0, PUSH_BATCH)
    const records = (await db.records.bulkGet(ids)).filter((r): r is LocalRecord => !!r)

    // Records deleted locally (e.g. a resolved duplicate) have nothing to send.
    const missing = ids.filter((id) => !records.some((r) => r.id === id))
    if (missing.length) await db.outbox.where('record_id').anyOf(missing).delete()
    if (records.length === 0) continue

    const { results } = await api<{ results: PushResult[] }>('/sync/push', {
      method: 'POST',
      body: JSON.stringify({ records: records.map(toPayload) }),
    })

    await db.transaction('rw', db.records, db.outbox, async () => {
      for (const result of results) {
        // Only the entries that were sent are cleared; an edit made while the request was
        // in flight has a higher seq and stays queued.
        await db.outbox
          .where('record_id')
          .equals(result.id)
          .filter((e) => e.seq! <= maxSeq)
          .delete()
        const stillQueued = (await db.outbox.where('record_id').equals(result.id).count()) > 0
        const record = await db.records.get(result.id)
        if (!record) continue

        if (result.status === 'accepted') {
          record.base_version = result.version!
          record.errors = undefined
          if (!stillQueued) record.sync_status = 'synced'
        } else if (!stillQueued) {
          record.sync_status = result.status
          record.errors = result.status === 'rejected' ? result.errors : undefined
        }
        await db.records.put(record)
      }
    })

    // Safety net: if the server answered without clearing anything, stop instead of
    // looping forever. The entries stay queued for the next sync.
    const remaining = await db.outbox.where('seq').belowOrEqual(maxSeq).count()
    if (remaining === entries.length) return
  }
}

async function mergeRecords(db: FarmDb, serverRecords: ServerRecord[]): Promise<void> {
  for (const server of serverRecords) {
    const queued = (await db.outbox.where('record_id').equals(server.id).count()) > 0
    if (queued) continue // local edits win until they are pushed
    if (server.deleted) {
      await db.records.delete(server.id)
      continue
    }
    await db.records.put({
      id: server.id,
      house_id: server.house_id,
      flock_id: server.flock_id,
      record_date: server.record_date,
      eggs_good: server.eggs_good,
      eggs_cracked: server.eggs_cracked,
      eggs_rejected: server.eggs_rejected,
      feed_kg: Number(server.feed_kg),
      water_liters: server.water_liters === null ? null : Number(server.water_liters),
      dead: server.dead,
      culled: server.culled,
      notes: server.notes,
      base_version: server.version,
      updated_at: server.client_updated_at,
      sync_status: 'synced',
      created_by: server.created_by,
    })
  }
}

async function applyConflicts(db: FarmDb, conflicts: Conflict[]): Promise<void> {
  await db.conflicts.clear()
  await db.conflicts.bulkPut(conflicts)
  const open = new Set(conflicts.map((c) => c.device_record_id))

  for (const id of open) {
    const record = await db.records.get(id)
    if (record && record.sync_status !== 'pending') {
      await db.records.put({ ...record, sync_status: 'conflict' })
    }
  }

  // Conflicts resolved elsewhere (or on this phone): clean up the local copy.
  const stale = await db.records.where('sync_status').equals('conflict').toArray()
  for (const record of stale) {
    if (open.has(record.id)) continue
    if (record.base_version === 0) {
      // A duplicate for the same day that never reached the server: the server record
      // for that day has been pulled, so this copy is no longer needed.
      await db.records.delete(record.id)
    } else {
      await db.records.put({ ...record, sync_status: 'synced' })
    }
  }
}

/** Get everything that changed on the server since the last pull. */
export async function pull(db: FarmDb): Promise<void> {
  let cursor = await getMeta(db, 'cursor', 0)
  for (;;) {
    const page = await api<PullResponse>(`/sync/pull?since=${cursor}`)
    await db.transaction('rw', [db.records, db.outbox, db.houses, db.conflicts, db.meta], async () => {
      await mergeRecords(db, page.records)
      await db.houses.clear()
      await db.houses.bulkPut(page.houses)
      await applyConflicts(db, page.conflicts)
      await setMeta(db, 'cursor', page.cursor)
      await setMeta(db, 'server_today', page.server_today)
    })
    cursor = page.cursor
    if (!page.has_more) break
  }
  await setMeta(db, 'last_sync_at', new Date().toISOString())
}

const running = new WeakMap<FarmDb, Promise<void>>()

/** Push then pull. Calls made while a sync is running share it. */
export function syncNow(db: FarmDb): Promise<void> {
  let task = running.get(db)
  if (!task) {
    task = (async () => {
      await pushOutbox(db)
      await pull(db)
    })().finally(() => running.delete(db))
    running.set(db, task)
  }
  return task
}
