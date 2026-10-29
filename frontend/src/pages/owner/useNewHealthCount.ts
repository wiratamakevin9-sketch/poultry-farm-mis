import { useEffect, useState } from 'react'
import { api } from '../../api/client'

export const HEALTH_COUNT_CHANGED = 'health-count-changed'

/** Number of health observations the owner has not opened yet ("Baru"), refreshed every minute. */
export function useNewHealthCount(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      api<{ new_count: number }>('/health-observations/summary').then(
        (summary) => !cancelled && setCount(summary.new_count),
        () => {}, // offline or not allowed: keep the last number
      )
    load()
    const timer = window.setInterval(load, 60_000)
    window.addEventListener('focus', load)
    window.addEventListener(HEALTH_COUNT_CHANGED, load)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', load)
      window.removeEventListener(HEALTH_COUNT_CHANGED, load)
    }
  }, [])

  return count
}
