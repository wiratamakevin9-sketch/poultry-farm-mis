import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb, type FarmDb } from '../../db/db'
import { addDays, farmDate } from '../../lib/farmDate'
import { WorkerProvider } from '../../sync/WorkerContext'
import TodayPanel from './TodayPanel'

const USER = { id: 'u1', username: 'pekerja1', full_name: 'Pekerja Satu', role: 'WORKER' as const, is_active: true }
let db: FarmDb
let n = 0
const run = vi.fn().mockResolvedValue(undefined)

function item(id: string, days: number, extra = {}) {
  return {
    id, house_id: 'h1', house_name: 'Kandang 1', scheduled_date: addDays(farmDate(), days),
    vaccine_name: `Vaksin ${id}`, method: 'EYE_DROP', notes: '', status: 'SCHEDULED' as const,
    done_by_name: null, ...extra,
  }
}

function renderPanel() {
  return render(
    <WorkerProvider user={USER} db={db} run={run}>
      <TodayPanel />
    </WorkerProvider>,
  )
}

beforeEach(() => {
  db = getDb(`today-${++n}`)
  run.mockClear()
})

describe('TodayPanel', () => {
  it('shows today, missed and tomorrow, but not older done ones', async () => {
    await db.vaccinations.bulkPut([
      item('a', 0),
      item('b', -2, { status: 'OVERDUE' }),
      item('c', 1),
      item('d', -3, { status: 'DONE' }),
    ])
    renderPanel()
    expect(await screen.findByText('Kandang 1 · Vaksin a')).toBeInTheDocument()
    expect(screen.getByText(/Terlewat/)).toBeInTheDocument()
    expect(screen.getByText('Besok: Vaksin c (Kandang 1)')).toBeInTheDocument()
    expect(screen.queryByText(/Vaksin d/)).not.toBeInTheDocument()
  })

  it('confirms on the phone and starts a sync', async () => {
    const user = userEvent.setup()
    await db.vaccinations.put(item('a', 0))
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Konfirmasi' }))
    await user.type(screen.getByRole('textbox', { name: /Catatan/ }), 'Semua ayam')
    await user.click(screen.getByRole('button', { name: 'Ya, sudah divaksin' }))

    expect(await screen.findByText('Dikonfirmasi, menunggu dikirim')).toBeInTheDocument()
    expect(await db.vaccinations.get('a')).toMatchObject({
      confirm_status: 'pending',
      confirm_note: 'Semua ayam',
    })
    await waitFor(() => expect(run).toHaveBeenCalled())
  })

  it('shows nothing when there is nothing to do', () => {
    const { container } = renderPanel()
    expect(container).toBeEmptyDOMElement()
  })
})
