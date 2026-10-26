import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { saveSession, type SessionUser } from '../auth/storage'

interface Props {
  user: SessionUser
  links: { to: string; label: string }[]
  status?: ReactNode
  children: ReactNode
}

export default function Layout({ user, links, status, children }: Props) {
  function logout() {
    if (window.confirm('Keluar dari aplikasi?')) saveSession(null)
  }

  return (
    <>
      <header className="app-header">
        <div className="app-header__row">
          <span className="app-header__title">Peternakan Beneng Bahagia</span>
          <button className="small secondary" onClick={logout}>
            Keluar
          </button>
        </div>
        <div className="app-header__row">
          <span className="muted" style={{ color: '#dcfce7' }}>
            {user.full_name}
          </span>
          {status}
        </div>
        {links.length > 1 && (
          <nav className="app-nav" aria-label="Menu utama">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to}>
                {link.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="page">{children}</main>
    </>
  )
}
