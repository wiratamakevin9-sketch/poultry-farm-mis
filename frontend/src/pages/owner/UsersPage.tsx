import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import { ROLE_LABELS, type User } from '../../api/types'
import type { Role } from '../../auth/storage'
import { useSession } from '../../auth/useSession'

const EMPTY = { username: '', full_name: '', password: '', role: 'WORKER' as Role }

export default function UsersPage() {
  const me = useSession()?.user
  const [users, setUsers] = useState<User[]>([])
  const [form, setForm] = useState(EMPTY)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [resetFor, setResetFor] = useState<User | null>(null)
  const [newPassword, setNewPassword] = useState('')

  const load = useCallback(async () => {
    try {
      setUsers(await api<User[]>('/users'))
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function run(action: () => Promise<unknown>, success: string) {
    setMessage(null)
    try {
      await action()
      setMessage({ kind: 'success', text: success })
      await load()
      return true
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
      return false
    }
  }

  async function createUser(event: FormEvent) {
    event.preventDefault()
    const ok = await run(
      () => api('/users', { method: 'POST', body: JSON.stringify(form) }),
      `Pengguna ${form.username} berhasil dibuat.`,
    )
    if (ok) setForm(EMPTY)
  }

  function toggleActive(user: User) {
    const text = user.is_active ? 'dinonaktifkan' : 'diaktifkan'
    run(
      () =>
        api(`/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ is_active: !user.is_active }),
        }),
      `Pengguna ${user.username} ${text}.`,
    )
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault()
    if (!resetFor) return
    const ok = await run(
      () =>
        api(`/users/${resetFor.id}/reset-password`, {
          method: 'POST',
          body: JSON.stringify({ new_password: newPassword }),
        }),
      `Password ${resetFor.username} sudah diganti.`,
    )
    if (ok) {
      setResetFor(null)
      setNewPassword('')
    }
  }

  return (
    <>
      <h1>Pengguna</h1>
      {message && (
        <div className={`alert ${message.kind === 'success' ? 'success' : ''}`} role="status">
          {message.text}
        </div>
      )}

      <section className="card">
        <h2>Daftar pengguna</h2>
        <ul className="item-list">
          {users.map((user) => (
            <li key={user.id} className="stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>{user.full_name}</strong>
                  <div className="muted">
                    {user.username} · {ROLE_LABELS[user.role]}
                  </div>
                </div>
                <span className={`badge ${user.is_active ? 'ok' : 'bad'}`}>
                  {user.is_active ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>
              <div className="row">
                <button className="small secondary" onClick={() => setResetFor(user)}>
                  Ganti password
                </button>
                {user.id !== me?.id && (
                  <button
                    className={`small ${user.is_active ? 'danger' : 'secondary'}`}
                    onClick={() => toggleActive(user)}
                  >
                    {user.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {resetFor && (
        <form className="card stack" onSubmit={resetPassword}>
          <h2>Ganti password: {resetFor.full_name}</h2>
          <label>
            Password baru (minimal 6 karakter)
            <input
              type="password"
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          <div className="row">
            <button type="submit">Simpan password</button>
            <button type="button" className="secondary" onClick={() => setResetFor(null)}>
              Batal
            </button>
          </div>
        </form>
      )}

      <form className="card stack" onSubmit={createUser}>
        <h2>Tambah pengguna</h2>
        <label>
          Nama lengkap
          <input
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            required
          />
        </label>
        <label>
          Username (huruf, angka, titik atau garis bawah)
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            pattern="[a-zA-Z0-9._]{3,50}"
            autoCapitalize="none"
            required
          />
        </label>
        <label>
          Password (minimal 6 karakter)
          <input
            type="password"
            minLength={6}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="new-password"
            required
          />
        </label>
        <label>
          Peran
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          >
            <option value="WORKER">Pekerja</option>
            <option value="OWNER">Pemilik</option>
          </select>
        </label>
        <button type="submit">Tambah pengguna</button>
      </form>
    </>
  )
}
