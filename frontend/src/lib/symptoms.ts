/** Same codes as backend/app/symptoms.py. These describe what was seen, never a diagnosis. */
export const SYMPTOMS: Record<string, string> = {
  LETHARGIC: 'Lesu',
  APPETITE_DOWN: 'Nafsu makan turun',
  DRINKING_DOWN: 'Minum berkurang',
  ABNORMAL_DROPPINGS: 'Diare atau kotoran tidak normal',
  RESPIRATORY: 'Ngorok atau sesak napas',
  PALE_COMB: 'Jengger/pial pucat atau kebiruan',
  SWELLING: 'Bengkak di kepala atau mata',
  PRODUCTION_DROP: 'Produksi telur turun mendadak',
  SUDDEN_DEATH: 'Kematian mendadak',
}

export type ObservationStatus = 'NEW' | 'SEEN' | 'FORWARDED' | 'CLOSED'

export const STATUS_LABELS: Record<ObservationStatus, string> = {
  NEW: 'Baru',
  SEEN: 'Sudah dilihat pemilik',
  FORWARDED: 'Diteruskan ke dokter hewan',
  CLOSED: 'Selesai',
}

export function symptomText(codes: string[], other: string): string {
  const parts = codes.map((code) => SYMPTOMS[code] ?? code)
  if (other.trim()) parts.push(other.trim())
  return parts.join(', ')
}
