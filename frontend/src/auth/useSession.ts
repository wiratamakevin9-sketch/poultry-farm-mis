import { useSyncExternalStore } from 'react'
import { loadSession, type Session } from './storage'

let cached: Session | null = loadSession()

function subscribe(onChange: () => void): () => void {
  const handler = () => {
    cached = loadSession()
    onChange()
  }
  window.addEventListener('session-changed', handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener('session-changed', handler)
    window.removeEventListener('storage', handler)
  }
}

export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, () => cached)
}
