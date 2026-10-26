import type { Role, SessionUser } from '../auth/storage'

export type User = SessionUser

export interface Flock {
  id: string
  house_id: string
  breed: string
  placement_date: string
  initial_bird_count: number
  is_active: boolean
  live_birds: number
}

export interface House {
  id: string
  name: string
  capacity: number
  is_active: boolean
  active_flock: Flock | null
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Pemilik',
  WORKER: 'Pekerja',
}

/** Daily record as the owner sees it (GET /api/records). */
export interface OwnerRecord {
  id: string
  house_id: string
  house_name: string
  record_date: string
  eggs_good: number
  eggs_cracked: number
  eggs_rejected: number
  feed_kg: string // decimal as text
  water_liters: string | null
  dead: number
  culled: number
  notes: string
  version: number
  created_by_name: string
  updated_by_name: string
  server_updated_at: string
  live_birds: number
  hdp: number
  feed_per_bird_g: number
}
