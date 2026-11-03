import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Iteration 2 farm modules end to end (ADR 0003). This file runs first (alphabetical
// order, one worker), and it only uses Kandang 3 (yesterday) and Kandang 4 (today) so
// the other specs keep their houses free. Stock checks compare before and after.

const API_URL = 'http://localhost:8001'

function farmDay(offset = 0): string {
  const now = new Date(Date.now() + offset * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(now)
}

async function token(request: APIRequestContext, username: string, password: string) {
  const response = await request.post(`${API_URL}/api/auth/login`, { data: { username, password } })
  return { Authorization: `Bearer ${(await response.json()).access_token}` }
}

async function login(page: Page, username: string, password: string) {
  await page.goto('/')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Masuk' }).click()
}

async function houseId(request: APIRequestContext, headers: object, name: string) {
  const houses = await (await request.get(`${API_URL}/api/houses`, { headers })).json()
  return houses.find((h: { name: string }) => h.name === name).id as string
}

async function eggStock(request: APIRequestContext, headers: object) {
  const body = await (await request.get(`${API_URL}/api/stock/eggs`, { headers })).json()
  return Object.fromEntries(body.lines.map((l: { grade: string; eggs: number }) => [l.grade, l.eggs]))
}

test('a vaccination confirmed offline reaches the owner', async ({ page, request }) => {
  const owner = await token(request, 'pemilik', 'pemilik123')
  await request.post(`${API_URL}/api/vaccinations`, {
    headers: owner,
    data: {
      house_id: await houseId(request, owner, 'Kandang 4'),
      scheduled_date: farmDay(),
      vaccine_name: 'ND-IB',
      method: 'DRINKING_WATER',
    },
  })

  await login(page, 'pekerja1', 'pekerja123')
  await expect(page.getByRole('heading', { name: 'Hari ini' })).toBeVisible()
  await page.context().setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await page.getByRole('button', { name: 'Konfirmasi' }).click()
  await page.getByRole('textbox', { name: /Catatan/ }).fill('Semua ayam minum')
  await page.getByRole('button', { name: 'Ya, sudah divaksin' }).click()
  await expect(page.getByText('Dikonfirmasi, menunggu dikirim')).toBeVisible()

  await page.context().setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('Sudah dilakukan')).toBeVisible({ timeout: 15_000 })

  const [item] = await (await request.get(`${API_URL}/api/vaccinations`, { headers: owner })).json()
  expect(item).toMatchObject({ status: 'DONE', done_by_name: 'Pekerja Satu', done_note: 'Semua ayam minum' })
})

test('withheld eggs cannot be sold; sales and feed update the stock', async ({ page, request }) => {
  const owner = await token(request, 'pemilik', 'pemilik123')
  const worker = await token(request, 'pekerja2', 'pekerja123')
  const k3 = await houseId(request, owner, 'Kandang 3')
  const k4 = await houseId(request, owner, 'Kandang 4')

  // Kandang 4 is treated today; Kandang 3 is not.
  await request.post(`${API_URL}/api/treatments`, {
    headers: owner,
    data: { house_id: k4, medicine_name: 'Antibiotik X', start_date: farmDay(), end_date: farmDay(), withdrawal_days: 3 },
  })
  const before = await eggStock(request, owner)
  const record = (house: string, day: string, good: number) => ({
    id: crypto.randomUUID(), house_id: house, record_date: day, eggs_good: good, eggs_cracked: 20,
    eggs_rejected: 5, eggs_dirty: 10, feed_kg: 550, water_liters: null, dead: 1, culled: 0, notes: '',
    base_version: 0, client_updated_at: new Date().toISOString(),
  })
  const pushed = await request.post(`${API_URL}/api/sync/push`, {
    headers: worker,
    data: { records: [record(k4, farmDay(), 4000), record(k3, farmDay(-1), 3000)] },
  })
  expect((await pushed.json()).results.map((r: { status: string }) => r.status)).toEqual(['accepted', 'accepted'])
  const after = await eggStock(request, owner)
  expect(after.WITHHELD - before.WITHHELD).toBe(4030) // Kandang 4: good + cracked + dirty
  expect(after.GOOD - before.GOOD).toBe(3000) // only Kandang 3

  // Owner sells good eggs: 31 kg is about 500 eggs at 62 g.
  await login(page, 'pemilik', 'pemilik123')
  await page.getByRole('link', { name: 'Penjualan' }).click()
  const buyerForm = page.locator('form', { hasText: 'Nama pembeli baru' })
  await buyerForm.getByLabel('Nama pembeli baru').fill('Toko Sari')
  await buyerForm.getByRole('button', { name: 'Tambah pembeli' }).click()
  await expect(page.getByText('Pembeli Toko Sari ditambahkan.')).toBeVisible()

  const sale = page.locator('form', { hasText: 'Catat penjualan' })
  // Withheld eggs are not even offered.
  await expect(sale.getByRole('option', { name: /ditahan/i })).toHaveCount(0)
  await sale.getByLabel('Pembeli').selectOption({ label: 'Toko Sari' })
  await sale.getByRole('textbox', { name: /^Berat/ }).fill('31')
  await sale.getByRole('textbox', { name: /^Harga per kg/ }).fill('27500')
  await expect(page.getByTestId('sale-total')).toHaveText(/852\.500/)
  await sale.getByRole('button', { name: 'Simpan penjualan' }).click()
  await expect(page.getByText('Penjualan dicatat. Stok telur sudah dikurangi.')).toBeVisible()
  expect((await eggStock(request, owner)).GOOD).toBe(after.GOOD - 500)

  // The server refuses withheld eggs even when asked directly.
  const buyers = await (await request.get(`${API_URL}/api/buyers`, { headers: owner })).json()
  const direct = await request.post(`${API_URL}/api/sales`, {
    headers: owner,
    data: { sale_date: farmDay(), buyer_id: buyers[0].id, grade: 'WITHHELD', weight_kg: 1, price_per_kg: 1 },
  })
  expect(direct.status()).toBe(422)

  // Dispose the withheld eggs, buy feed.
  await page.getByRole('link', { name: 'Stok' }).click()
  const dispose = page.locator('form', { hasText: 'Catat pembuangan telur' })
  await dispose.getByRole('textbox', { name: /^Jumlah/ }).fill(String(after.WITHHELD))
  await dispose.getByRole('button', { name: 'Catat pembuangan' }).click()
  await expect(page.getByText('Pembuangan telur dicatat.')).toBeVisible()
  await expect(page.getByTestId('stock-WITHHELD')).toHaveText('0 butir')

  const feedBefore = Number((await (await request.get(`${API_URL}/api/stock/feed`, { headers: owner })).json()).stock_kg)
  const purchase = page.locator('form', { hasText: 'Catat pembelian pakan' })
  await purchase.getByRole('textbox', { name: /^Jumlah/ }).fill('2000')
  await purchase.getByRole('button', { name: 'Simpan pembelian' }).click()
  await expect(page.getByText('Pembelian 2.000,0 kg pakan dicatat.')).toBeVisible()
  const feedAfter = Number((await (await request.get(`${API_URL}/api/stock/feed`, { headers: owner })).json()).stock_kg)
  expect(feedAfter - feedBefore).toBe(2000)

  // The worker's phone shows the withdrawal period.
  await page.evaluate(() => localStorage.clear())
  await login(page, 'pekerja2', 'pekerja123')
  await expect(page.getByRole('button', { name: /Kandang 4/ })).toContainText('Masa henti obat s/d')
})

test('the dashboard shows weekly indicators and exports them', async ({ page }) => {
  await login(page, 'pemilik', 'pemilik123')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'HDP per kandang (%)' })).toBeVisible()
  await expect(page.locator('.recharts-line-curve').first()).toBeAttached({ timeout: 15_000 })
  await expect(page.locator('.kpi').first()).toContainText('HDP')

  await page.getByRole('button', { name: 'Lihat tabel angka' }).click()
  await expect(page.getByRole('cell', { name: 'Semua kandang' }).first()).toBeVisible()

  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Ekspor CSV' }).click(),
  ])
  const text = readFileSync(await csv.path(), 'utf8')
  expect(text).toContain('Minggu mulai,Kandang')
  expect(text).toContain('Semua kandang')
})
