import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NetworkError } from '../api/client'
import { getDb, type FarmDb, type LocalVaccination } from '../db/db'
import { pull, pushVaccinations } from './engine'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: apiMock,
}))

const ITEM: LocalVaccination = {
  id: 'v1', house_id: 'h1', house_name: 'Kandang 1', scheduled_date: '2026-11-02',
  vaccine_name: 'ND-IB', method: 'DRINKING_WATER', notes: '', status: 'SCHEDULED',
  done_by_name: null,
}

function pullWith(vaccinations: object[]) {
  return {
    records: [], cursor: 0, has_more: false, houses: [], conflicts: [], observations: [],
    server_today: '2026-11-02', eggs_per_tray: 30, vaccinations,
  }
}

let db: FarmDb
let n = 0

beforeEach(async () => {
  apiMock.mockReset()
  db = getDb(`vacc-${++n}`)
  await db.vaccinations.put(ITEM)
})

async function confirmLocally() {
  await db.vaccinations.update('v1', {
    confirm_status: 'pending',
    confirmed_at: '2026-11-02T01:00:00Z',
    confirm_note: 'Semua minum',
  })
}

describe('vaccination confirmations', () => {
  it('sends a confirmation made offline', async () => {
    await confirmLocally()
    apiMock.mockResolvedValueOnce({ results: [{ id: 'v1', status: 'accepted', errors: {} }] })
    await pushVaccinations(db)
    expect(JSON.parse(apiMock.mock.calls[0][1].body)).toEqual({
      confirmations: [{ schedule_id: 'v1', confirmed_at: '2026-11-02T01:00:00Z', note: 'Semua minum' }],
    })
    expect((await db.vaccinations.get('v1'))?.confirm_status).toBe('synced')
  })

  it('keeps it when the network fails', async () => {
    await confirmLocally()
    apiMock.mockRejectedValueOnce(new NetworkError())
    await expect(pushVaccinations(db)).rejects.toBeInstanceOf(NetworkError)
    expect((await db.vaccinations.get('v1'))?.confirm_status).toBe('pending')
  })

  it('a pull does not drop a confirmation that was not sent yet', async () => {
    await confirmLocally()
    apiMock.mockResolvedValueOnce(pullWith([ITEM]))
    await pull(db)
    expect(await db.vaccinations.get('v1')).toMatchObject({
      confirm_status: 'pending',
      confirm_note: 'Semua minum',
    })
  })

  it('a pull shows schedules done or removed by others', async () => {
    apiMock.mockResolvedValueOnce(
      pullWith([{ ...ITEM, status: 'DONE', done_by_name: 'Pekerja Dua' }]),
    )
    await pull(db)
    expect(await db.vaccinations.get('v1')).toMatchObject({ status: 'DONE', done_by_name: 'Pekerja Dua' })

    apiMock.mockResolvedValueOnce(pullWith([]))
    await pull(db)
    expect(await db.vaccinations.count()).toBe(0)
  })
})
