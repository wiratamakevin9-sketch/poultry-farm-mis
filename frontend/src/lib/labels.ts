import type { TrayCategory } from '../db/db'

export const TRAY_LABELS: Record<TrayCategory, string> = {
  GOOD_REMAINDER: 'Sisa tray telur bagus',
  CRACKED: 'Tray telur retak',
  DIRTY: 'Tray telur kotor',
}

export type VaccineMethod = 'DRINKING_WATER' | 'EYE_DROP' | 'INJECTION' | 'SPRAY' | 'OTHER'

export const VACCINE_METHODS: Record<VaccineMethod, string> = {
  DRINKING_WATER: 'Air minum',
  EYE_DROP: 'Tetes mata',
  INJECTION: 'Suntik',
  SPRAY: 'Semprot',
  OTHER: 'Lainnya',
}

export type EggGrade = 'GOOD' | 'CRACKED' | 'DIRTY' | 'WITHHELD'

export const EGG_GRADES: Record<EggGrade, string> = {
  GOOD: 'Telur bagus',
  CRACKED: 'Telur retak',
  DIRTY: 'Telur kotor',
  WITHHELD: 'Telur ditahan (masa henti obat)',
}

/** Stock items as the server names them (eggs per grade, feed in kg). */
export const STOCK_ITEMS: Record<string, string> = {
  EGG_GOOD: 'Telur bagus',
  EGG_CRACKED: 'Telur retak',
  EGG_DIRTY: 'Telur kotor',
  EGG_WITHHELD: 'Telur ditahan',
  FEED: 'Pakan',
}
