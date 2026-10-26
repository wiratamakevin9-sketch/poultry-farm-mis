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
