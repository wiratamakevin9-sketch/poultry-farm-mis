import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NetworkError } from '../api/client'
import { getDb, getMeta, type FarmDb, type RecordValues, type ServerRecord } from '../db/db'
import { countPending, saveRecord } from '../db/records'
import { pull, pushOutbox, syncNow } from './engine'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: apiMock,
}))

const VALUES: RecordValues = {
  eggs_good: 4200,
  eggs_cracked: 30,
  eggs_rejected: 10,
  eggs_dirty: 0,
  feed_kg: 560,
  water_liters: null,
  dead: 2,
  culled: 1,
  notes: '',
}

let db: FarmDb
let userCounter = 0

function save(id?: string, values: Partial<RecordValues> = {}, date = '2026-10-26') {
  return saveRecord(db, {
    id,
    house_id: 'h1',
    flock_id: 'f1',
    record_date: date,
    values: { ...VALUES, ...values },
    user_id: 'u1',
  })
}

function pushBody(callIndex: number) {
  return JSON.parse(apiMock.mock.calls[callIndex][1].body).records
}

function serverRecord(changes: Partial<ServerRecord>): ServerRecord {
  return {
    ...VALUES,
    id: 'r-server',
    house_id: 'h1',
    flock_id: 'f1',
    record_date: '2026-10-25',
    version: 1,
    change_seq: 1,
    created_by: 'u2',
    updated_by: 'u2',
    client_updated_at: '2026-10-25T01:00:00Z',
    server_updated_at: '2026-10-25T01:00:00Z',
    deleted: false,
    ...changes,
  }
}

function pullPage(records: ServerRecord[], extra: object = {}) {
  return { records, cursor: 10, has_more: false, houses: [], conflicts: [], server_today: '2026-10-26', eggs_per_tray: 30, ...extra }
}

beforeEach(() => {
  apiMock.mockReset()
  db = getDb(`test-${++userCounter}`) // fresh database per test
})

describe('outbox', () => {
  it('saving offline queues the record as pending', async () => {
    const record = await save()
    expect(record.sync_status).toBe('pending')
    expect(record.base_version).toBe(0)
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await countPending(db)).toBe(1)
  })

  it('counts a record edited twice as one waiting record', async () => {
    const record = await save()
    await save(record.id, { eggs_good: 4100 })
    expect(await countPending(db)).toBe(1)
    expect(await db.outbox.count()).toBe(2)
  })

  it('sends the latest copy once and marks it synced when accepted', async () => {
    const record = await save()
    await save(record.id, { eggs_good: 4100 })
    apiMock.mockResolvedValueOnce({
      results: [{ id: record.id, status: 'accepted', version: 1, conflict_id: null, errors: {} }],
    })

    await pushOutbox(db)

    const sent = pushBody(0)
    expect(sent).toHaveLength(1)
    expect(sent[0].eggs_good).toBe(4100)
    expect(await countPending(db)).toBe(0)
    const saved = await db.records.get(record.id)
    expect(saved?.sync_status).toBe('synced')
    expect(saved?.base_version).toBe(1)
  })

  it('sends 0 dirty eggs for records saved before the field existed', async () => {
    const record = await save()
    await db.records.update(record.id, { eggs_dirty: undefined as unknown as number })
    apiMock.mockResolvedValueOnce({
      results: [{ id: record.id, status: 'accepted', version: 1, conflict_id: null, errors: {} }],
    })
    await pushOutbox(db)
    expect(pushBody(0)[0].eggs_dirty).toBe(0)
  })

  it('keeps the queue when the network fails', async () => {
    await save()
    apiMock.mockRejectedValueOnce(new NetworkError())
    await expect(pushOutbox(db)).rejects.toBeInstanceOf(NetworkError)
    expect(await countPending(db)).toBe(1)
  })

  it('keeps an edit made while the push was in flight', async () => {
    const record = await save()
    apiMock.mockImplementationOnce(async () => {
      await save(record.id, { eggs_good: 3900 }) // worker edits during the request
      return {
        results: [{ id: record.id, status: 'accepted', version: 1, conflict_id: null, errors: {} }],
      }
    })
    apiMock.mockResolvedValueOnce({
      results: [{ id: record.id, status: 'accepted', version: 2, conflict_id: null, errors: {} }],
    })

    await pushOutbox(db)

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(pushBody(1)[0]).toMatchObject({ eggs_good: 3900, base_version: 1 })
    expect((await db.records.get(record.id))?.sync_status).toBe('synced')
  })

  it('marks conflicts and rejections without losing the record', async () => {
    const a = await save()
    const b = await save(undefined, {}, '2026-10-25')
    apiMock.mockResolvedValueOnce({
      results: [
        { id: a.id, status: 'conflict', version: null, conflict_id: 'c1', errors: {} },
        {
          id: b.id,
          status: 'rejected',
          version: null,
          conflict_id: null,
          errors: { feed_kg: 'Pakan harus lebih dari 0 kg.' },
        },
      ],
    })

    await pushOutbox(db)

    expect((await db.records.get(a.id))?.sync_status).toBe('conflict')
    const rejected = await db.records.get(b.id)
    expect(rejected?.sync_status).toBe('rejected')
    expect(rejected?.errors).toEqual({ feed_kg: 'Pakan harus lebih dari 0 kg.' })
    expect(await countPending(db)).toBe(0)
  })

  it('stops instead of looping when the server answers nothing', async () => {
    await save()
    apiMock.mockResolvedValueOnce({ results: [] })
    await pushOutbox(db)
    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(await countPending(db)).toBe(1)
  })
})

describe('pull', () => {
  it('stores server records, houses and the cursor', async () => {
    apiMock.mockResolvedValueOnce(pullPage([serverRecord({})]))
    await pull(db)
    expect(apiMock.mock.calls[0][0]).toBe('/sync/pull?since=0')
    expect((await db.records.get('r-server'))?.sync_status).toBe('synced')
    expect(await getMeta(db, 'cursor', 0)).toBe(10)
  })

  it('pages until has_more is false', async () => {
    apiMock.mockResolvedValueOnce(pullPage([serverRecord({})], { cursor: 5, has_more: true }))
    apiMock.mockResolvedValueOnce(pullPage([serverRecord({ id: 'r2' })], { cursor: 9 }))
    await pull(db)
    expect(apiMock.mock.calls[1][0]).toBe('/sync/pull?since=5')
    expect(await db.records.count()).toBe(2)
  })

  it('does not overwrite a record with unsent local edits', async () => {
    const local = await save(undefined, { eggs_good: 1234 })
    apiMock.mockResolvedValueOnce(pullPage([serverRecord({ id: local.id, eggs_good: 9 })]))
    await pull(db)
    expect((await db.records.get(local.id))?.eggs_good).toBe(1234)
  })

  it('removes records the owner deleted', async () => {
    apiMock.mockResolvedValueOnce(pullPage([serverRecord({})]))
    await pull(db)
    apiMock.mockResolvedValueOnce(pullPage([serverRecord({ deleted: true, version: 2 })]))
    await pull(db)
    expect(await db.records.get('r-server')).toBeUndefined()
  })

  it('drops a local duplicate once its conflict is resolved', async () => {
    const local = await save()
    apiMock.mockResolvedValueOnce({
      results: [{ id: local.id, status: 'conflict', version: null, conflict_id: 'c1', errors: {} }],
    })
    await pushOutbox(db)
    // Resolved: the conflict is gone and the server record for that day arrives.
    apiMock.mockResolvedValueOnce(pullPage([serverRecord({ record_date: '2026-10-26' })]))
    await pull(db)
    expect(await db.records.get(local.id)).toBeUndefined()
    expect(await db.records.get('r-server')).toBeDefined()
  })
})

describe('syncNow', () => {
  it('pushes then pulls, and shares a running sync', async () => {
    await save()
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/sync/push') {
        const [record] = JSON.parse(String(init?.body)).records
        return {
          results: [{ id: record.id, status: 'accepted', version: 1, conflict_id: null, errors: {} }],
        }
      }
      return pullPage([])
    })
    await Promise.all([syncNow(db), syncNow(db)])
    expect(apiMock.mock.calls.map((c) => c[0])).toEqual(['/sync/push', '/sync/pull?since=0'])
  })
})
