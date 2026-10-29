// @vitest-environment node
// IndexedDB returns Node Blobs, which jsdom's FormData rejects; Node has both natively.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NetworkError } from '../api/client'
import { getDb, type FarmDb } from '../db/db'
import { removeObservation, saveObservation } from '../db/observations'
import { pull, pushObservations, uploadPhotos } from './engine'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: apiMock,
}))

const PHOTO = {
  blob: new Blob(['full'], { type: 'image/jpeg' }),
  thumb: new Blob(['thumb'], { type: 'image/jpeg' }),
  width: 1280,
  height: 960,
}

let db: FarmDb
let n = 0

function report() {
  return saveObservation(
    db,
    { house_id: 'h1', symptoms: ['LETHARGIC'], other_symptoms: '', affected_count: 10, notes: '' },
    [PHOTO, PHOTO],
  )
}

function accepted(id: string) {
  return { results: [{ id, status: 'accepted', version: null, conflict_id: null, errors: {} }] }
}

beforeEach(() => {
  apiMock.mockReset()
  db = getDb(`obs-${++n}`)
})

describe('health observations on the phone', () => {
  it('saves the observation and its photos together', async () => {
    const o = await report()
    expect(o.sync_status).toBe('pending')
    expect(await db.photos.where('observation_id').equals(o.id).count()).toBe(2)
  })

  it('sends only the fields the server needs and marks it synced', async () => {
    const o = await report()
    apiMock.mockResolvedValueOnce(accepted(o.id))
    await pushObservations(db)
    const [path, init] = apiMock.mock.calls[0]
    expect(path).toBe('/sync/observations')
    expect(Object.keys(JSON.parse(init.body).observations[0]).sort()).toEqual(
      ['affected_count', 'house_id', 'id', 'notes', 'observed_at', 'other_symptoms', 'symptoms'],
    )
    expect((await db.observations.get(o.id))?.sync_status).toBe('synced')
  })

  it('keeps it when the network fails', async () => {
    const o = await report()
    apiMock.mockRejectedValueOnce(new NetworkError())
    await expect(pushObservations(db)).rejects.toBeInstanceOf(NetworkError)
    expect((await db.observations.get(o.id))?.sync_status).toBe('pending')
  })

  it('keeps a rejected observation with the reason', async () => {
    const o = await report()
    apiMock.mockResolvedValueOnce({
      results: [{ id: o.id, status: 'rejected', errors: { symptoms: 'Ada gejala yang tidak dikenal.' } }],
    })
    await pushObservations(db)
    expect(await db.observations.get(o.id)).toMatchObject({
      sync_status: 'rejected',
      errors: { symptoms: 'Ada gejala yang tidak dikenal.' },
    })
  })

  it('uploads its photos only after the observation is on the server', async () => {
    const o = await report()
    await uploadPhotos(db)
    expect(apiMock).not.toHaveBeenCalled()

    apiMock.mockResolvedValueOnce(accepted(o.id))
    await pushObservations(db)
    apiMock.mockResolvedValue({})
    await uploadPhotos(db)
    const forms = apiMock.mock.calls.slice(1).map(([, init]) => init.body as FormData)
    expect(forms).toHaveLength(2)
    expect(forms.every((f) => f.get('kind') === 'HEALTH' && f.get('observation_id') === o.id)).toBe(true)
  })

  it('shows the owner status and vet advice after a pull', async () => {
    const o = await report()
    apiMock.mockResolvedValueOnce(accepted(o.id))
    await pushObservations(db)
    apiMock.mockResolvedValueOnce({
      records: [], cursor: 0, has_more: false, houses: [], conflicts: [],
      server_today: '2026-10-29', eggs_per_tray: 30,
      observations: [{ ...o, status: 'FORWARDED', vet_advice: 'Pisahkan ayam yang lemas.' }],
    })
    await pull(db)
    expect(await db.observations.get(o.id)).toMatchObject({
      status: 'FORWARDED',
      vet_advice: 'Pisahkan ayam yang lemas.',
    })
  })

  it('can be removed, with its photos, only before it is sent', async () => {
    const first = await report()
    expect(await removeObservation(db, first.id)).toBe(true)
    expect(await db.photos.count()).toBe(0)

    const second = await report()
    apiMock.mockResolvedValueOnce(accepted(second.id))
    await pushObservations(db)
    expect(await removeObservation(db, second.id)).toBe(false)
  })
})
