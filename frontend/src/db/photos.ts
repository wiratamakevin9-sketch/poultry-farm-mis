import type { FarmDb, LocalPhoto, PhotoKind, TrayCategory } from './db'

export interface NewPhoto {
  kind: PhotoKind
  house_id: string
  record_date?: string
  tray_category?: TrayCategory
  label_count?: number | null
  observation_id?: string
  blob: Blob
  thumb: Blob
  width: number
  height: number
}

/** Keep a photo on the phone until the sync engine uploads it. Works offline. */
export async function addPhoto(db: FarmDb, photo: NewPhoto): Promise<LocalPhoto> {
  const local: LocalPhoto = {
    ...photo,
    id: crypto.randomUUID(),
    taken_at: new Date().toISOString(),
    status: 'pending',
  }
  await db.photos.add(local)
  return local
}

/** Only photos that never reached the server can be removed. */
export async function removePhoto(db: FarmDb, id: string): Promise<boolean> {
  const photo = await db.photos.get(id)
  if (!photo || photo.status === 'uploaded') return false
  await db.photos.delete(id)
  return true
}

export function trayPhotos(db: FarmDb, houseId: string, recordDate: string) {
  return db.photos.where('[house_id+record_date]').equals([houseId, recordDate]).toArray()
}

/** Photos waiting to be uploaded. */
export function countPendingPhotos(db: FarmDb): Promise<number> {
  return db.photos.where('status').equals('pending').count()
}
