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
  eggs_dirty: number
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
  photo_count: number
}

export interface ServerPhoto {
  id: string
  kind: 'TRAY' | 'HEALTH'
  house_id: string
  record_date: string | null
  tray_category: 'GOOD_REMAINDER' | 'CRACKED' | 'DIRTY' | null
  label_count: number | null
  observation_id: string | null
  taken_at: string
}

/** A health observation as the owner sees it (UC14). */
export interface OwnerObservation {
  id: string
  house_id: string
  house_name: string
  observed_at: string
  symptoms: string[]
  other_symptoms: string
  affected_count: number | null
  notes: string
  status: 'NEW' | 'SEEN' | 'FORWARDED' | 'CLOSED'
  forwarded_via: 'WHATSAPP' | 'EMAIL' | 'OTHER' | null
  vet_advice: string
  seen_at: string | null
  forwarded_at: string | null
  closed_at: string | null
  created_by_name: string
  photo_ids: string[]
}
