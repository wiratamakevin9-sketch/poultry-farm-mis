export const FARM_TIME_ZONE = 'Asia/Makassar' // WITA, UTC+8

/** Calendar date (YYYY-MM-DD) at the farm for a moment in time. */
export function farmDate(moment: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: FARM_TIME_ZONE }).format(moment)
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
