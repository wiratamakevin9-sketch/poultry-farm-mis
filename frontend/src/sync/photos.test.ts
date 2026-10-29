// @vitest-environment node
// IndexedDB returns Node Blobs, which jsdom's FormData rejects; Node has both natively.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError } from '../api/client'
import { getDb, type FarmDb } from '../db/db'
import { addPhoto, countPendingPhotos, removePhoto } from '../db/photos'
import { uploadPhotos } from './engine'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: apiMock,
}))

let db: FarmDb
let n = 0

async function addRecord(status: 'pending' | 'synced') {
  await db.records.put({
    id: 'r1', house_id: 'h1', flock_id: 'f1', record_date: '2026-10-29', eggs_good: 4000,
    eggs_cracked: 25, eggs_rejected: 5, eggs_dirty: 12, feed_kg: 550, water_liters: null,
    dead: 0, culled: 0, notes: '', base_version: status === 'synced' ? 1 : 0,
    updated_at: new Date().toISOString(), sync_status: status,
  })
}

function trayPhoto() {
  return addPhoto(db, {
    kind: 'TRAY',
    house_id: 'h1',
    record_date: '2026-10-29',
    tray_category: 'CRACKED',
    label_count: 25,
    blob: new Blob(['full'], { type: 'image/jpeg' }),
    thumb: new Blob(['thumb'], { type: 'image/jpeg' }),
    width: 1280,
    height: 960,
  })
}

beforeEach(() => {
  apiMock.mockReset()
  db = getDb(`photos-${++n}`)
})

describe('photo queue', () => {
  it('waits until the daily record is on the server', async () => {
    await addRecord('pending')
    await trayPhoto()
    await uploadPhotos(db)
    expect(apiMock).not.toHaveBeenCalled()
    expect(await countPendingPhotos(db)).toBe(1)
  })

  it('uploads with its details, then drops the full image but keeps the thumbnail', async () => {
    await addRecord('synced')
    const photo = await trayPhoto()
    apiMock.mockResolvedValueOnce({})
    await uploadPhotos(db)

    const [path, init] = apiMock.mock.calls[0]
    expect(path).toBe(`/photos/${photo.id}`)
    expect(init.method).toBe('PUT')
    const form = init.body as FormData
    expect(form.get('tray_category')).toBe('CRACKED')
    expect(form.get('label_count')).toBe('25')
    expect(form.get('record_date')).toBe('2026-10-29')
    expect(form.get('file')).toBeInstanceOf(Blob)

    const saved = await db.photos.get(photo.id)
    expect(saved?.status).toBe('uploaded')
    expect(saved?.blob).toBeUndefined()
    expect(saved?.thumb).toBeDefined()
    expect(await countPendingPhotos(db)).toBe(0)
  })

  it('keeps the photo when the network fails', async () => {
    await addRecord('synced')
    await trayPhoto()
    apiMock.mockRejectedValueOnce(new NetworkError())
    await expect(uploadPhotos(db)).rejects.toBeInstanceOf(NetworkError)
    expect(await countPendingPhotos(db)).toBe(1)
  })

  it('tries again later when the server does not have the record yet', async () => {
    await addRecord('synced')
    await trayPhoto()
    apiMock.mockRejectedValueOnce(new ApiError(409, 'Catatan untuk foto ini belum ada di server.'))
    await uploadPhotos(db)
    expect(await countPendingPhotos(db)).toBe(1)
  })

  it('marks a photo the server refuses as failed, with the reason', async () => {
    await addRecord('synced')
    const photo = await trayPhoto()
    apiMock.mockRejectedValueOnce(new ApiError(422, 'File ini bukan foto yang valid.'))
    await uploadPhotos(db)
    expect(await db.photos.get(photo.id)).toMatchObject({
      status: 'failed',
      error: 'File ini bukan foto yang valid.',
    })
  })

  it('can remove a photo only before it is uploaded', async () => {
    await addRecord('synced')
    const first = await trayPhoto()
    expect(await removePhoto(db, first.id)).toBe(true)
    const second = await trayPhoto()
    apiMock.mockResolvedValueOnce({})
    await uploadPhotos(db)
    expect(await removePhoto(db, second.id)).toBe(false)
  })
})
