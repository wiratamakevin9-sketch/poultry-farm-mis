import { loadSession, saveSession, type Session } from '../auth/storage'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Thrown when the server cannot be reached (offline or weak signal). */
export class NetworkError extends Error {
  constructor() {
    super('Tidak ada koneksi ke server.')
  }
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  user: Session['user']
}

export function toSession(body: TokenResponse): Session {
  return { accessToken: body.access_token, refreshToken: body.refresh_token, user: body.user }
}

async function send(path: string, init: RequestInit, token?: string): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  try {
    return await fetch(`/api${path}`, { ...init, headers })
  } catch {
    throw new NetworkError()
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json()
    if (typeof body.detail === 'string') return body.detail
    // Pydantic field errors are in English; the forms check fields before sending,
    // so a generic Indonesian message is enough here.
    if (Array.isArray(body.detail)) return 'Data tidak valid. Periksa kembali isian Anda.'
  } catch {
    // fall through
  }
  return `Terjadi kesalahan (${response.status}).`
}

let refreshing: Promise<Session | null> | null = null

/** Get new tokens with the refresh token. Returns null if the session is no longer valid. */
export function refreshSession(): Promise<Session | null> {
  refreshing ??= (async () => {
    const session = loadSession()
    if (!session) return null
    const response = await send('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    })
    if (response.status === 401) {
      saveSession(null)
      return null
    }
    if (!response.ok) throw new ApiError(response.status, await errorMessage(response))
    const next = toSession(await response.json())
    saveSession(next)
    return next
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

/** Call the API with the stored access token, refreshing it once if it expired. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let session = loadSession()
  let response = await send(path, init, session?.accessToken)
  if (response.status === 401 && session) {
    session = await refreshSession()
    if (!session) throw new ApiError(401, 'Sesi berakhir. Silakan login kembali.')
    response = await send(path, init, session.accessToken)
  }
  if (!response.ok) throw new ApiError(response.status, await errorMessage(response))
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function login(username: string, password: string): Promise<Session> {
  const response = await send('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  if (!response.ok) throw new ApiError(response.status, await errorMessage(response))
  const session = toSession(await response.json())
  saveSession(session)
  return session
}
