import type { TrayCategory } from '../db/db'

export const TRAY_LABELS: Record<TrayCategory, string> = {
  GOOD_REMAINDER: 'Sisa tray telur bagus',
  CRACKED: 'Tray telur retak',
  DIRTY: 'Tray telur kotor',
}
