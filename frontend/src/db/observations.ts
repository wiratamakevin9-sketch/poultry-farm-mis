import type { CompressedPhoto } from '../lib/image'
import type { FarmDb, LocalObservation } from './db'
import { addPhoto } from './photos'

export interface ObservationInput {
  house_id: string
  symptoms: string[]
  other_symptoms: string
  affected_count: number | null
  notes: string
}

/** Save a health observation and its photos on the phone. Works offline. */
export async function saveObservation(
  db: FarmDb,
  input: ObservationInput,
  photos: CompressedPhoto[],
): Promise<LocalObservation> {
  return db.transaction('rw', db.observations, db.photos, async () => {
    const observation: LocalObservation = {
      ...input,
      id: crypto.randomUUID(),
      observed_at: new Date().toISOString(),
      sync_status: 'pending',
    }
    await db.observations.add(observation)
    for (const photo of photos) {
      await addPhoto(db, { kind: 'HEALTH', house_id: input.house_id, observation_id: observation.id, ...photo })
    }
    return observation
  })
}

/** An observation can be removed only before it reaches the server. */
export async function removeObservation(db: FarmDb, id: string): Promise<boolean> {
  return db.transaction('rw', db.observations, db.photos, async () => {
    const observation = await db.observations.get(id)
    if (!observation || observation.sync_status === 'synced') return false
    await db.photos.where('observation_id').equals(id).delete()
    await db.observations.delete(id)
    return true
  })
}
