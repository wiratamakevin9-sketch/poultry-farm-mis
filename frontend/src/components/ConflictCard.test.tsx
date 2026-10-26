import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Conflict } from '../db/db'
import ConflictCard from './ConflictCard'

const VALUES = {
  eggs_good: 4000, eggs_cracked: 5, eggs_rejected: 2, feed_kg: 540,
  water_liters: null, dead: 1, culled: 0, notes: '',
}

function conflict(canResolve = true): Conflict {
  return {
    id: 'c1', record_id: 'r1', device_record_id: 'd1', house_id: 'h1', house_name: 'Kandang 4',
    record_date: '2026-10-26', reason: 'DUPLICATE_DAY', status: 'OPEN',
    device_payload: { ...VALUES, id: 'd1', eggs_good: 4050 },
    server_record: {
      ...VALUES, id: 'r1', house_id: 'h1', flock_id: 'f1', record_date: '2026-10-26',
      version: 1, change_seq: 1, created_by: 'u1', updated_by: 'u1',
      client_updated_at: '', server_updated_at: '', deleted: false,
    },
    submitted_by: 'u2', submitted_by_name: 'Pekerja Dua', created_at: '', can_resolve: canResolve,
  }
}

function renderCard(onResolve = vi.fn().mockResolvedValue(undefined), canResolve = true) {
  render(
    <ConflictCard conflict={conflict(canResolve)} liveBirds={5000} deviceLabel="Data saya"
      takeLabel="Pakai data saya" lockedMessage="Akan diselesaikan pemilik." onResolve={onResolve} />,
  )
  return onResolve
}

describe('ConflictCard', () => {
  it('highlights the fields that differ', () => {
    renderCard()
    const row = screen.getByText('Telur bagus').closest('tr')!
    expect(row.querySelectorAll('td.diff')).toHaveLength(2)
    expect(screen.getByText('Telur retak').closest('tr')!.querySelectorAll('td.diff')).toHaveLength(0)
  })

  it('keeps the device copy when asked', async () => {
    const onResolve = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Pakai data saya' }))
    expect(onResolve).toHaveBeenCalledWith('TAKE_DEVICE', undefined)
  })

  it('sends merged values after validation', async () => {
    const user = userEvent.setup()
    const onResolve = renderCard()
    await user.click(screen.getByRole('button', { name: 'Gabungkan…' }))
    const eggs = screen.getByRole('textbox', { name: 'Telur bagus' })
    await user.clear(eggs)
    await user.type(eggs, '4020')
    await user.click(screen.getByRole('button', { name: 'Simpan gabungan' }))
    expect(onResolve).toHaveBeenCalledWith('MERGED', expect.objectContaining({ eggs_good: 4020 }))
  })

  it('shows the server error message', async () => {
    const { ApiError } = await import('../api/client')
    renderCard(vi.fn().mockRejectedValue(new ApiError(409, 'Data di server sudah berubah.')))
    await userEvent.click(screen.getByRole('button', { name: 'Pakai data di server' }))
    expect(await screen.findByText('Data di server sudah berubah.')).toBeInTheDocument()
  })

  it('shows no buttons when this person may not resolve it', () => {
    renderCard(undefined, false)
    expect(screen.getByText('Akan diselesaikan pemilik.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
