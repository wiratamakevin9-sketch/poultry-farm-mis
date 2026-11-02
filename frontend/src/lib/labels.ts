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
