export type Role = 'OWNER' | 'WORKER'

export interface SessionUser {
  id: string
  username: string
  full_name: string
  role: Role
  is_active: boolean
}

export interface Session {
  accessToken: string
  refreshToken: string
  user: SessionUser
}

const KEY = 'poultry.session'

// The session lives in localStorage so a worker can open the app offline after
// logging in once. Storage can be blocked (private mode), so every access is guarded.
export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function saveSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session))
    else localStorage.removeItem(KEY)
  } catch {
    // Ignore: the app still works for this page load.
  }
  window.dispatchEvent(new Event('session-changed'))
}
