import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { House } from '../../api/types'
import { getDb, type FarmDb } from '../../db/db'
import { WorkerProvider } from '../../sync/WorkerContext'
import HealthForm from './HealthForm'

vi.mock('../../lib/image', () => ({
  compressPhoto: vi.fn(async () => ({
    blob: 'full-image' as unknown as Blob,
    thumb: 'thumbnail' as unknown as Blob,
    width: 1280,
    height: 960,
  })),
}))
URL.createObjectURL = vi.fn(() => 'blob:thumb')
URL.revokeObjectURL = vi.fn()

const USER = { id: 'u1', username: 'pekerja1', full_name: 'Pekerja Satu', role: 'WORKER' as const, is_active: true }
const HOUSE: House = {
  id: 'h1', name: 'Kandang 1', capacity: 5000, is_active: true,
  active_flock: {
    id: 'f1', house_id: 'h1', breed: 'Isa Brown', placement_date: '2026-03-01',
    initial_bird_count: 5000, is_active: true, live_birds: 4990,
  },
}

let db: FarmDb
let n = 0

function renderForm() {
  return render(
    <WorkerProvider user={USER} db={db} run={vi.fn().mockResolvedValue(undefined)}>
      <MemoryRouter initialEntries={['/kesehatan/baru']}>
        <Routes>
          <Route path="/kesehatan/baru" element={<HealthForm />} />
          <Route path="/kesehatan" element={<p>Daftar laporan</p>} />
        </Routes>
      </MemoryRouter>
    </WorkerProvider>,
  )
}

beforeEach(async () => {
  db = getDb(`health-form-${++n}`)
  await db.houses.put(HOUSE)
})

describe('HealthForm', () => {
  it('asks for a house, a symptom and a photo', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('button', { name: 'Simpan laporan' }))
    expect(screen.getByText('Pilih kandang.')).toBeInTheDocument()
    expect(screen.getByText('Pilih minimal satu gejala atau tulis gejala lain.')).toBeInTheDocument()
    expect(screen.getByText('Ambil minimal 1 foto.')).toBeInTheDocument()
    expect(await db.observations.count()).toBe(0)
  })

  it('limits affected birds to live birds', async () => {
    const user = userEvent.setup()
    renderForm()
    await screen.findByRole('option', { name: 'Kandang 1' }) // houses load from IndexedDB
    await user.selectOptions(screen.getByLabelText('Kandang'), 'h1')
    await user.type(screen.getByRole('textbox', { name: /^Perkiraan ayam/ }), '5000')
    await user.click(screen.getByRole('button', { name: 'Simpan laporan' }))
    expect(
      screen.getByText('Jumlah ayam terkena (5.000) tidak boleh lebih dari jumlah ayam hidup (4.990).'),
    ).toBeInTheDocument()
  })

  it('saves the report and up to 3 photos on the phone', async () => {
    const user = userEvent.setup()
    renderForm()
    await screen.findByRole('option', { name: 'Kandang 1' }) // houses load from IndexedDB
    await user.selectOptions(screen.getByLabelText('Kandang'), 'h1')
    await user.click(screen.getByLabelText('Lesu'))
    await user.click(screen.getByLabelText('Ngorok atau sesak napas'))
    await user.type(screen.getByRole('textbox', { name: /^Perkiraan ayam/ }), '15')
    const file = new File(['jpeg'], 'ayam.jpg', { type: 'image/jpeg' })
    for (let i = 0; i < 3; i++) {
      // The button reads "Memproses foto…" for a moment after each photo.
      await user.upload(await screen.findByLabelText('Ambil foto ayam'), file)
    }
    await waitFor(() => expect(screen.getAllByText('Belum disimpan')).toHaveLength(3))
    // After 3 photos the camera button disappears.
    expect(screen.queryByLabelText('Ambil foto ayam')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Simpan laporan' }))
    expect(await screen.findByText('Daftar laporan')).toBeInTheDocument()

    const [saved] = await db.observations.toArray()
    expect(saved).toMatchObject({
      house_id: 'h1',
      symptoms: ['LETHARGIC', 'RESPIRATORY'],
      affected_count: 15,
      sync_status: 'pending',
    })
    expect(await db.photos.where('observation_id').equals(saved.id).count()).toBe(3)
  })
})
