import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { saveSession } from './auth/storage'

function renderApp() {
  return render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  )
}

describe('App', () => {
  afterEach(() => saveSession(null))

  it('shows the login page without a session', () => {
    renderApp()
    expect(screen.getByRole('button', { name: 'Masuk' })).toBeInTheDocument()
  })
})

describe('App with a session', () => {
  afterEach(() => saveSession(null))

  it('shows owner menu for the owner', () => {
    saveSession({
      accessToken: 'a',
      refreshToken: 'r',
      user: { id: '1', username: 'pemilik', full_name: 'Pemilik', role: 'OWNER', is_active: true },
    })
    renderApp()
    expect(screen.getByRole('link', { name: 'Pengguna' })).toBeInTheDocument()
  })

  it('does not show owner menu to a worker', () => {
    saveSession({
      accessToken: 'a',
      refreshToken: 'r',
      user: { id: '2', username: 'pekerja1', full_name: 'Pekerja', role: 'WORKER', is_active: true },
    })
    renderApp()
    expect(screen.queryByRole('link', { name: 'Pengguna' })).not.toBeInTheDocument()
  })
})
