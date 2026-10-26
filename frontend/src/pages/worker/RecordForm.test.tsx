import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { House } from '../../api/types'
import { getDb, type FarmDb } from '../../db/db'
import { farmDate } from '../../lib/farmDate'
import { WorkerProvider } from '../../sync/WorkerContext'
import RecordForm from './RecordForm'

const USER = { id: 'u1', username: 'pekerja1', full_name: 'Pekerja Satu', role: 'WORKER' as const, is_active: true }
const HOUSE: House = {
  id: 'h1',
  name: 'Kandang 1',
  capacity: 5000,
  is_active: true,
  active_flock: {
    id: 'f1', house_id: 'h1', breed: 'Isa Brown', placement_date: '2026-03-01',
    initial_bird_count: 5000, is_active: true, live_birds: 5000,
  },
}

let db: FarmDb
let n = 0
const run = vi.fn().mockResolvedValue(undefined)

function renderForm(date = farmDate()) {
  return render(
    <WorkerProvider user={USER} db={db} run={run}>
      <MemoryRouter initialEntries={[`/catat/h1/${date}`]}>
        <Routes>
          <Route path="/catat/:houseId/:date" element={<RecordForm />} />
          <Route path="/" element={<p>Beranda</p>} />
        </Routes>
      </MemoryRouter>
    </WorkerProvider>,
  )
}

async function fill(user: ReturnType<typeof userEvent.setup>, values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) {
    const input = screen.getByRole('textbox', { name: new RegExp(`^${label}`) })
    await user.clear(input)
    await user.type(input, value)
  }
}

const VALID = {
  'Telur bagus': '4000',
  'Telur retak': '10',
  'Telur afkir': '5',
  Pakan: '550',
  'Ayam mati': '2',
  'Ayam afkir': '0',
}

beforeEach(async () => {
  db = getDb(`form-${++n}`)
  await db.houses.put(HOUSE)
  run.mockClear()
})

describe('RecordForm', () => {
  it('shows HDP and feed per bird while typing', async () => {
    const user = userEvent.setup()
    renderForm()
    await screen.findByText('Kandang 1')
    await fill(user, { 'Telur bagus': '3990', 'Telur retak': '6', 'Telur afkir': '4' })
    expect(screen.getByTestId('preview-hdp')).toHaveTextContent('80,0%')
    await fill(user, { Pakan: '550,5' })
    expect(screen.getByTestId('preview-feed')).toHaveTextContent('110,1 g')
  })

  it('shows Indonesian errors and does not save invalid data', async () => {
    const user = userEvent.setup()
    renderForm()
    await screen.findByText('Kandang 1')
    await fill(user, { ...VALID, 'Telur bagus': '6000', Pakan: '0' })
    await user.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(
      await screen.findByText('Total telur (6.015) tidak boleh lebih dari jumlah ayam hidup (5.000).'),
    ).toBeInTheDocument()
    expect(screen.getByText('Pakan harus lebih dari 0 kg.')).toBeInTheDocument()
    expect(await db.records.count()).toBe(0)
  })

  it('saves to the phone, queues it and starts a sync', async () => {
    const user = userEvent.setup()
    renderForm()
    await screen.findByText('Kandang 1')
    await fill(user, VALID)
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByText('Beranda')).toBeInTheDocument()
    const [record] = await db.records.toArray()
    expect(record).toMatchObject({ house_id: 'h1', eggs_good: 4000, feed_kg: 550, sync_status: 'pending' })
    expect(await db.outbox.count()).toBe(1)
    await waitFor(() => expect(run).toHaveBeenCalled())
  })

  it('opens the existing record for the day instead of creating a second one', async () => {
    const date = farmDate()
    await db.records.put({
      id: 'r1', house_id: 'h1', flock_id: 'f1', record_date: date, eggs_good: 3800,
      eggs_cracked: 1, eggs_rejected: 1, feed_kg: 500, water_liters: null, dead: 0,
      culled: 0, notes: '', base_version: 1, updated_at: new Date().toISOString(),
      sync_status: 'synced',
    })
    renderForm(date)
    expect(await screen.findByText(/Ubah data/)).toBeInTheDocument()
    expect(await screen.findByDisplayValue('3800')).toHaveAttribute('id', 'eggs_good')
    expect(screen.getByRole('textbox', { name: /^Pakan/ })).toHaveValue('500')
  })

  it('refuses dates older than yesterday', async () => {
    renderForm('2020-01-01')
    expect(
      await screen.findByText('Catatan hanya bisa diisi atau diubah untuk hari ini atau kemarin.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled()
  })
})
