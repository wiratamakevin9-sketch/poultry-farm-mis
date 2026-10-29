import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { saveSession, type SessionUser } from '../auth/storage'

interface Props {
  user: SessionUser
  links: { to: string; label: ReactNode }[]
  status?: ReactNode
  logoutWarning?: string
  children: ReactNode
}

export default function Layout({ user, links, status, logoutWarning, children }: Props) {
  function logout() {
    const message = logoutWarning ? `${logoutWarning}\n\nKeluar dari aplikasi?` : 'Keluar dari aplikasi?'
    if (window.confirm(message)) saveSession(null)
  }

  return (
    <>
      <header className="app-header">
        <div className="app-header__row">
          <span>
            <span className="app-header__title">Beneng Bahagia</span>
            <span className="app-header__user"> · {user.full_name}</span>
          </span>
          <button className="small secondary" onClick={logout}>
            Keluar
          </button>
        </div>
        {status && <div className="app-header__row">{status}</div>}
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
