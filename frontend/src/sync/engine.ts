import { ApiError, api } from '../api/client'
import type { House } from '../api/types'
import {
  getMeta,
  setMeta,
  type Conflict,
  type FarmDb,
  type LocalObservation,
  type LocalPhoto,
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
  eggs_per_tray: number
  observations: ServerObservation[]
}

interface ServerObservation {
  id: string
  house_id: string
  observed_at: string
  symptoms: string[]
  other_symptoms: string
  affected_count: number | null
  notes: string
  status: LocalObservation['status']
  vet_advice: string
}

function toPayload(record: LocalRecord) {
  return {
    id: record.id,
    house_id: record.house_id,
    record_date: record.record_date,
    eggs_good: record.eggs_good,
    eggs_cracked: record.eggs_cracked,
    eggs_rejected: record.eggs_rejected,
    eggs_dirty: record.eggs_dirty ?? 0, // records saved before this field existed
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
      eggs_dirty: server.eggs_dirty ?? 0,
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

/** Send health observations made on this phone. They cannot be edited, only sent. */
export async function pushObservations(db: FarmDb): Promise<void> {
  const pending = await db.observations.where('sync_status').equals('pending').toArray()
  if (pending.length === 0) return
  const { results } = await api<{ results: PushResult[] }>('/sync/observations', {
    method: 'POST',
    body: JSON.stringify({
      observations: pending.map((o) => ({
        id: o.id,
        house_id: o.house_id,
        observed_at: o.observed_at,
        symptoms: o.symptoms,
        other_symptoms: o.other_symptoms,
        affected_count: o.affected_count,
        notes: o.notes,
      })),
    }),
  })
  for (const result of results) {
    await db.observations.update(result.id, {
      sync_status: result.status === 'accepted' ? 'synced' : 'rejected',
      errors: result.status === 'rejected' ? result.errors : undefined,
    })
  }
}

async function mergeObservations(db: FarmDb, observations: ServerObservation[]) {
  for (const server of observations) {
    await db.observations.put({
      id: server.id,
      house_id: server.house_id,
      observed_at: server.observed_at,
      symptoms: server.symptoms,
      other_symptoms: server.other_symptoms,
      affected_count: server.affected_count,
      notes: server.notes,
      sync_status: 'synced',
      status: server.status,
      vet_advice: server.vet_advice,
    })
  }
}

/** Get everything that changed on the server since the last pull. */
export async function pull(db: FarmDb): Promise<void> {
  let cursor = await getMeta(db, 'cursor', 0)
  for (;;) {
    const page = await api<PullResponse>(`/sync/pull?since=${cursor}`)
    const tables = [db.records, db.outbox, db.houses, db.conflicts, db.meta, db.observations]
    await db.transaction('rw', tables, async () => {
      await mergeRecords(db, page.records)
      await mergeObservations(db, page.observations ?? [])
      await db.houses.clear()
      await db.houses.bulkPut(page.houses)
      await applyConflicts(db, page.conflicts)
      await setMeta(db, 'cursor', page.cursor)
      await setMeta(db, 'server_today', page.server_today)
      await setMeta(db, 'eggs_per_tray', page.eggs_per_tray)
    })
    cursor = page.cursor
    if (!page.has_more) break
  }
  await setMeta(db, 'last_sync_at', new Date().toISOString())
}

/** Is the record or observation this photo belongs to already on the server? */
async function parentSynced(db: FarmDb, photo: LocalPhoto): Promise<boolean> {
  if (photo.kind === 'TRAY') {
    const record = await db.records
      .where('[house_id+record_date]')
      .equals([photo.house_id, photo.record_date!])
      .first()
    return record?.sync_status === 'synced'
  }
  const observation = await db.observations.get(photo.observation_id!)
  return observation?.sync_status === 'synced'
}

function photoForm(photo: LocalPhoto): FormData {
  const form = new FormData()
  form.set('kind', photo.kind)
  form.set('house_id', photo.house_id)
  form.set('taken_at', photo.taken_at)
  if (photo.record_date) form.set('record_date', photo.record_date)
  if (photo.tray_category) form.set('tray_category', photo.tray_category)
  if (photo.label_count != null) form.set('label_count', String(photo.label_count))
  if (photo.observation_id) form.set('observation_id', photo.observation_id)
  form.set('file', photo.blob!, `${photo.id}.jpg`)
  return form
}

/**
 * Upload waiting photos one by one, after their record is on the server, so a photo
 * never blocks or delays the daily records. A network error stops the round; the
 * photos stay queued.
 */
export async function uploadPhotos(db: FarmDb): Promise<void> {
  const waiting = await db.photos.where('status').equals('pending').sortBy('taken_at')
  for (const photo of waiting) {
    if (!photo.blob || !(await parentSynced(db, photo))) continue
    try {
      await api(`/photos/${photo.id}`, { method: 'PUT', body: photoForm(photo) })
      // The server has it: drop the full image to save space, keep the thumbnail.
      await db.photos.update(photo.id, { status: 'uploaded', blob: undefined, error: undefined })
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      if (err.status === 409 || err.status === 401) continue // record not there yet / login
      // Invalid or too large: retrying will not help; the worker sees the message.
      await db.photos.update(photo.id, { status: 'failed', error: err.message })
    }
  }
}

const running = new WeakMap<FarmDb, Promise<void>>()

/** Push then pull. Calls made while a sync is running share it. */
export function syncNow(db: FarmDb): Promise<void> {
  let task = running.get(db)
  if (!task) {
    task = (async () => {
      await pushOutbox(db)
      await pushObservations(db)
      await pull(db)
      await uploadPhotos(db) // after pull, so records just accepted count as synced
    })().finally(() => running.delete(db))
    running.set(db, task)
  }
  return task
}
