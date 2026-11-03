import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SalesPage from './SalesPage'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: apiMock,
}))

const STOCK = {
  egg_weight_g: 62,
  lines: [
    { grade: 'GOOD', eggs: 1000, kg: 62, sellable: true },
    { grade: 'CRACKED', eggs: 30, kg: 1.9, sellable: true },
    { grade: 'DIRTY', eggs: 12, kg: 0.7, sellable: true },
    { grade: 'WITHHELD', eggs: 500, kg: 31, sellable: false },
  ],
}

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/buyers') return [{ id: 'b1', name: 'Toko Sari', phone: '', notes: '', is_active: true }]
    if (path === '/stock/eggs') return STOCK
    return []
  })
})

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText('Pembeli'), 'b1')
  await user.type(screen.getByRole('textbox', { name: /^Berat/ }), '31')
  await user.type(screen.getByRole('textbox', { name: /^Harga per kg/ }), '27500')
}

describe('SalesPage', () => {
  it('offers only sellable grades, with their stock', async () => {
    render(<SalesPage />)
    const options = await screen.findAllByRole('option', { name: /stok/ })
    expect(options.map((o) => o.textContent)).toEqual([
      'Telur bagus (stok 1.000 butir)',
      'Telur retak (stok 30 butir)',
      'Telur kotor (stok 12 butir)',
    ])
  })

  it('estimates eggs from the weight and shows the total', async () => {
    const user = userEvent.setup()
    render(<SalesPage />)
    await fill(user)
    expect(screen.getByText('Perkiraan 500 butir (62 g per butir).')).toBeInTheDocument()
    expect(screen.getByTestId('sale-total')).toHaveTextContent('852.500')
  })

  it('blocks selling more than the stock', async () => {
    const user = userEvent.setup()
    render(<SalesPage />)
    await fill(user)
    await user.selectOptions(screen.getByLabelText('Jenis telur'), 'CRACKED')
    expect(screen.getByText('Stok telur retak hanya 30 butir.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Simpan penjualan' })).toBeDisabled()
  })

  it('sends the sale', async () => {
    const user = userEvent.setup()
    render(<SalesPage />)
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Simpan penjualan' }))
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/sales', expect.objectContaining({ method: 'POST' })),
    )
    const post = apiMock.mock.calls.find(([path, init]) => path === '/sales' && init?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toMatchObject({
      buyer_id: 'b1',
      grade: 'GOOD',
      weight_kg: 31,
      price_per_kg: 27500,
      quantity: null,
    })
  })
})
