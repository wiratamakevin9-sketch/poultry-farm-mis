import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TreatmentsSection from './TreatmentsSection'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: apiMock,
}))

const HOUSES = [{ id: 'h1', name: 'Kandang 1', capacity: 5000, is_active: true, active_flock: null }]

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockResolvedValue([])
})

describe('TreatmentsSection', () => {
  it('shows when eggs may be sold again and sends the treatment', async () => {
    const user = userEvent.setup()
    render(<TreatmentsSection houses={HOUSES} />)
    await user.selectOptions(screen.getByLabelText('Kandang'), 'h1')
    await user.type(screen.getByLabelText('Nama obat'), 'Antibiotik X')
    await user.type(screen.getByLabelText('Mulai'), '2026-11-01')
    await user.type(screen.getByLabelText('Selesai'), '2026-11-05')
    await user.type(screen.getByRole('textbox', { name: /^Masa henti obat/ }), '7')
    // 5 Nov + 7 days withdrawal + 1 = 13 Nov
    expect(screen.getByText('13 Nov 2026')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Simpan pengobatan' }))
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/treatments', expect.objectContaining({ method: 'POST' })),
    )
    const post = apiMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toMatchObject({
      house_id: 'h1',
      medicine_name: 'Antibiotik X',
      end_date: '2026-11-05',
      withdrawal_days: 7,
    })
  })

  it('lists treatments with their phase', async () => {
    apiMock.mockResolvedValueOnce([
      {
        id: 't1', house_id: 'h1', house_name: 'Kandang 1', medicine_name: 'Antibiotik X',
        dose: '', start_date: '2026-10-25', end_date: '2026-10-30', withdrawal_days: 7,
        notes: '', sellable_from: '2026-11-07', phase: 'WITHDRAWAL',
      },
    ])
    render(<TreatmentsSection houses={HOUSES} />)
    expect(await screen.findByText('Masa henti obat')).toBeInTheDocument()
    expect(screen.getByText('7 Nov 2026')).toBeInTheDocument()
  })
})
