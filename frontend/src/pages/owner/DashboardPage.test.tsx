import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from './DashboardPage'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: apiMock,
}))

function row(week: string, house: string | null, extra: object) {
  return {
    house_id: house ? `id-${house}` : null, house_name: house ?? 'Semua kandang', week_start: week,
    days: 7, eggs: 28000, hen_days: 35000, feed_kg: 3800, dead: 7, culled: 0, birds_start: 5000,
    hdp: 80, fcr: 2.19, mortality_pct: 0.14, feed_per_bird_g: 108.6, ...extra,
  }
}

const REPORT = {
  weeks: ['2026-10-26', '2026-11-02'],
  egg_weight_g: 62,
  rows: [row('2026-10-26', 'Kandang 1', {}), row('2026-11-02', 'Kandang 1', { days: 2, eggs: 7800, hdp: 78 })],
  farm: [
    row('2026-10-26', null, {}),
    row('2026-11-02', null, { days: 2, eggs: 7800, hdp: 78, fcr: 2.25, mortality_pct: 0.1 }),
  ],
}

beforeAll(() => {
  // Recharts measures its container; jsdom has no layout.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/reports/weekly')) return REPORT
    if (path === '/houses') return [{ id: 'id-Kandang 1', name: 'Kandang 1' }]
    if (path === '/reports/alerts') {
      return {
        feed_low: true, feed_days_left: 3.2, withheld_eggs: 7800, overdue_vaccinations: 1,
        vaccinations_today: 0, new_health_reports: 2, open_conflicts: 0,
      }
    }
    return []
  })
})

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )
}

describe('DashboardPage', () => {
  it('lists what needs attention, with links', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: /Stok pakan menipis \(± 3,2 hari\)/ })).toHaveAttribute('href', '/pemilik/stok')
    expect(screen.getByRole('link', { name: /1 vaksinasi terlewat/ })).toHaveAttribute('href', '/pemilik/jadwal')
    expect(screen.getByRole('link', { name: /2 laporan kesehatan baru/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /7.800 telur ditahan/ })).toBeInTheDocument()
    expect(screen.queryByText(/data bentrok/)).not.toBeInTheDocument()
  })

  it('compares this week with last week fairly', async () => {
    renderPage()
    expect(await screen.findByText('78,0%')).toBeInTheDocument()
    expect(screen.getByText(/▼ 2,0% dari minggu lalu \(lebih buruk\)/)).toBeInTheDocument()
    // FCR: lower is better, so a rise is worse.
    expect(screen.getByText(/▲ 0,06 dari minggu lalu \(lebih buruk\)/)).toBeInTheDocument()
    // Eggs per day: 7800 / 2 days against 28000 / 7 days.
    expect(screen.getByText('3.900')).toBeInTheDocument()
  })

  it('draws one chart per measure', async () => {
    renderPage()
    expect(await screen.findByRole('region', { name: 'HDP per kandang (%)' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'FCR per kandang' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Kematian per kandang (%)' })).toBeInTheDocument()
  })
})
