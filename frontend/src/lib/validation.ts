import type { RecordValues } from '../db/db'
import { addDays } from './farmDate'
import { formatNumber } from './format'

/** What the worker typed; every field is text until it is checked. */
export interface RecordForm {
  eggs_good: string
  eggs_cracked: string
  eggs_rejected: string
  feed_kg: string
  water_liters: string
  dead: string
  culled: string
  notes: string
}

export type FieldErrors = Partial<Record<keyof RecordForm | 'record_date', string>>

export const MAX_FEED_KG_PER_BIRD = 0.2

const COUNT_LABELS = {
  eggs_good: 'Telur bagus',
  eggs_cracked: 'Telur retak',
  eggs_rejected: 'Telur afkir',
  dead: 'Ayam mati',
  culled: 'Ayam afkir',
} as const

type CountField = keyof typeof COUNT_LABELS

/** Accepts "1,5" as well as "1.5", since Indonesian phones type a comma. */
export function parseDecimal(text: string): number | null {
  const cleaned = text.trim().replace(',', '.')
  if (cleaned === '' || !/^\d+(\.\d+)?$/.test(cleaned)) return null
  return Number(cleaned)
}

function parseCount(text: string): number | null {
  const cleaned = text.trim()
  return /^\d+$/.test(cleaned) ? Number(cleaned) : null
}

/**
 * Same rules as the server (backend/app/validation.py), with the same messages.
 * Returns the parsed values when there are no errors.
 */
export function validateRecord(
  form: RecordForm,
  liveBirds: number,
  recordDate: string,
  today: string,
): { errors: FieldErrors; values: RecordValues | null } {
  const errors: FieldErrors = {}
  const counts = {} as Record<CountField, number>

  for (const [field, label] of Object.entries(COUNT_LABELS) as [CountField, string][]) {
    const text = form[field].trim()
    const value = parseCount(text)
    if (text === '') errors[field] = `${label} wajib diisi (isi 0 jika tidak ada).`
    else if (value === null) errors[field] = `${label} harus bilangan bulat 0 atau lebih.`
    else counts[field] = value
  }

  const eggFields: CountField[] = ['eggs_good', 'eggs_cracked', 'eggs_rejected']
  if (eggFields.every((f) => f in counts)) {
    const total = counts.eggs_good + counts.eggs_cracked + counts.eggs_rejected
    if (total > liveBirds) {
      errors.eggs_good =
        `Total telur (${formatNumber(total)}) tidak boleh lebih dari ` +
        `jumlah ayam hidup (${formatNumber(liveBirds)}).`
    }
  }

  if ('dead' in counts && 'culled' in counts && counts.dead + counts.culled > liveBirds) {
    errors.dead =
      `Ayam mati + afkir (${formatNumber(counts.dead + counts.culled)}) tidak boleh lebih dari ` +
      `jumlah ayam hidup (${formatNumber(liveBirds)}).`
  }

  const feed = parseDecimal(form.feed_kg)
  const maxFeed = Math.round(MAX_FEED_KG_PER_BIRD * liveBirds * 100) / 100
  if (form.feed_kg.trim() === '') errors.feed_kg = 'Pakan wajib diisi.'
  else if (feed === null) errors.feed_kg = 'Pakan harus berupa angka, contoh 550 atau 550,5.'
  else if (feed <= 0) errors.feed_kg = 'Pakan harus lebih dari 0 kg.'
  else if (feed > maxFeed) {
    errors.feed_kg =
      `Pakan maksimal ${formatNumber(maxFeed, maxFeed % 1 ? 1 : 0)} kg ` +
      `(0,2 kg × ${formatNumber(liveBirds)} ekor).`
  }

  let water: number | null = null
  if (form.water_liters.trim() !== '') {
    water = parseDecimal(form.water_liters)
    if (water === null) errors.water_liters = 'Air minum harus berupa angka 0 atau lebih.'
  }

  if (form.notes.length > 500) errors.notes = 'Catatan maksimal 500 karakter.'

  if (recordDate > today) errors.record_date = 'Tanggal tidak boleh di masa depan.'
  else if (recordDate < addDays(today, -1)) {
    errors.record_date = 'Catatan hanya bisa diisi atau diubah untuk hari ini atau kemarin.'
  }

  if (Object.keys(errors).length > 0) return { errors, values: null }
  return {
    errors,
    values: {
      ...counts,
      feed_kg: feed!,
      water_liters: water,
      notes: form.notes.trim(),
    },
  }
}
