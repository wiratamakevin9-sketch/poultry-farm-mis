import { useState, type FormEvent } from 'react'
import { ApiError, NetworkError, login } from '../api/client'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(username.trim(), password)
    } catch (err) {
      if (err instanceof NetworkError) {
        setError('Login pertama kali membutuhkan internet. Coba lagi saat ada sinyal.')
      } else if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Terjadi kesalahan. Coba lagi.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page" style={{ maxWidth: 420, paddingTop: 48 }}>
      <h1>Peternakan Beneng Bahagia</h1>
      <p className="muted">Masuk untuk mencatat data harian kandang.</p>
      <form className="card stack" onSubmit={submit}>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <button type="submit" disabled={busy}>
          {busy ? 'Memproses…' : 'Masuk'}
        </button>
      </form>
    </main>
  )
}
