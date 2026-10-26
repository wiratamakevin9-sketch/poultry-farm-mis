import { useSyncExternalStore } from 'react'
import { loadSession, readRawSession, type Session } from './storage'

// Re-parse only when the stored value changes, so React gets a stable object.
let lastRaw: string | null = null
let cached: Session | null = null

function getSnapshot(): Session | null {
  const raw = readRawSession()
  if (raw !== lastRaw) {
    lastRaw = raw
    cached = loadSession()
  }
  return cached
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('session-changed', onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener('session-changed', onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, getSnapshot)
}
