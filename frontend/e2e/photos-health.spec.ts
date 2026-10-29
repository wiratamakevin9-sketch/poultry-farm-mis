import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// UC13 (egg tray photos) and UC14 (health observations) end to end, offline first.

const API_URL = 'http://localhost:8001'
const PHOTO = path.join(import.meta.dirname, 'fixtures', 'tray.jpg')

function farmToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date())
}

async function login(page: Page, username: string, password: string) {
  await page.goto('/')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Masuk' }).click()
}

async function ownerToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_URL}/api/auth/login`, {
    data: { username: 'pemilik', password: 'pemilik123' },
  })
  return (await response.json()).access_token
}

async function goOffline(page: Page) {
  await page.context().setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
}

async function goOnline(page: Page) {
  await page.context().setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
}

const syncStatus = (page: Page) => page.locator('.sync-status')

test('tray photos taken offline reach the server once, with their counts', async ({
  page,
  request,
}) => {
  await login(page, 'pekerja1', 'pekerja123')
  await expect(page.getByRole('button', { name: /Kandang 3/ })).toBeVisible()
  await goOffline(page)

  await page.getByRole('button', { name: /Kandang 3/ }).click()
  const field = (label: string) => page.getByRole('textbox', { name: new RegExp(`^${label}`) })
  await field('Tray penuh').fill('132')
  await field('Sisa butir').fill('21')
  await expect(field('Telur bagus')).toHaveValue('3981')
  for (const [label, value] of [
    ['Telur retak', '18'],
    ['Telur kotor', '9'],
    ['Telur afkir', '3'],
    ['Pakan', '545'],
    ['Ayam mati', '0'],
    ['Ayam afkir', '0'],
  ]) {
    await field(label).fill(value)
  }
  await page.getByLabel('Foto sisa tray telur bagus').setInputFiles(PHOTO)
  await page.getByLabel('Foto tray telur retak').setInputFiles(PHOTO)
  await expect(page.locator('.photo-thumb img')).toHaveCount(2)
  await page.getByRole('button', { name: 'Simpan' }).click()

  await expect(syncStatus(page)).toContainText('1 data menunggu dikirim')
  await expect(syncStatus(page)).toContainText('2 foto menunggu')

  await goOnline(page)
  await expect(syncStatus(page)).toContainText('Semua data terkirim', { timeout: 20_000 })
  await expect(syncStatus(page)).not.toContainText('foto menunggu', { timeout: 20_000 })
  // Syncing again must not upload the photos a second time.
  await page.getByRole('button', { name: 'Sinkronkan' }).click()
  await expect(page.getByRole('button', { name: 'Sinkronkan' })).toBeEnabled()

  const headers = { Authorization: `Bearer ${await ownerToken(request)}` }
  const houses = await (await request.get(`${API_URL}/api/houses`, { headers })).json()
  const house = houses.find((h: { name: string }) => h.name === 'Kandang 3')
  const photos = await (
    await request.get(
      `${API_URL}/api/photos?house_id=${house.id}&record_date=${farmToday()}`,
      { headers },
    )
  ).json()
  const labels = Object.fromEntries(
    photos.map((p: { tray_category: string; label_count: number }) => [p.tray_category, p.label_count]),
  )
  expect(labels).toEqual({ GOOD_REMAINDER: 21, CRACKED: 18 })
  // Shrunk on the phone to at most 1280 px.
  expect(Math.max(photos[0].width, photos[0].height)).toBeLessThanOrEqual(1280)

  const [record] = await (
    await request.get(
      `${API_URL}/api/records?house_id=${house.id}&date_from=${farmToday()}&date_to=${farmToday()}`,
      { headers },
    )
  ).json()
  expect(record).toMatchObject({ eggs_good: 3981, eggs_dirty: 9, photo_count: 2 })
})

test('a health report made offline reaches the owner, who shares it as a PDF', async ({
  page,
  request,
}) => {
  // Worker reports offline.
  await login(page, 'pekerja2', 'pekerja123')
  await expect(page.getByRole('button', { name: /Kandang 1/ })).toBeVisible()
  await goOffline(page)
  await page.getByRole('link', { name: /Kesehatan ayam/ }).click()
  await page.getByRole('link', { name: 'Laporkan kesehatan ayam' }).click()
  await page.getByLabel('Kandang').selectOption({ label: 'Kandang 4' })
  await page.getByLabel('Lesu').check()
  await page.getByLabel('Ngorok atau sesak napas').check()
  await page.getByRole('textbox', { name: /^Perkiraan ayam/ }).fill('12')
  await page.getByLabel('Ambil foto ayam').setInputFiles(PHOTO)
  await expect(page.locator('.photo-thumb img')).toHaveCount(1)
  await page.getByRole('button', { name: 'Simpan laporan' }).click()
  await expect(page.getByText('Menunggu dikirim', { exact: true })).toBeVisible()

  await goOnline(page)
  await expect(page.getByText('Terkirim, belum dilihat')).toBeVisible({ timeout: 20_000 })
  await expect(syncStatus(page)).not.toContainText('foto menunggu', { timeout: 20_000 })

  // Owner: badge, open the report, download the PDF, mark it forwarded.
  await page.evaluate(() => localStorage.clear())
  await login(page, 'pemilik', 'pemilik123')
  await expect(page.locator('.nav-badge')).toHaveText('Baru 1')
  await page.getByRole('link', { name: /Kesehatan/ }).click()
  await page.getByRole('link', { name: /Kandang 4/ }).click()
  await expect(page.getByText('Ngorok atau sesak napas')).toBeVisible()
  await expect(page.locator('.photo-full')).toHaveCount(1)
  await expect(page.locator('.nav-badge')).toHaveCount(0) // opened = seen

  // On a computer the share button downloads the PDF.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Bagikan PDF/ }).click(),
  ])
  expect(download.suggestedFilename()).toBe('laporan-kesehatan-kandang-4.pdf')
  const pdf = readFileSync(await download.path())
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF')

  await page.getByRole('button', { name: 'WhatsApp', exact: true }).click()
  await expect(page.getByText(/Dikirim .* lewat WhatsApp/)).toBeVisible()
  await page.getByLabel('Saran dokter hewan').fill('Pisahkan ayam yang sakit.')
  await page.getByRole('button', { name: 'Tandai selesai' }).click()
  await expect(page.getByText('Laporan ditandai selesai.')).toBeVisible()

  // Exactly one observation with one photo on the server.
  const headers = { Authorization: `Bearer ${await ownerToken(request)}` }
  const all = await (await request.get(`${API_URL}/api/health-observations`, { headers })).json()
  expect(all).toHaveLength(1)
  expect(all[0]).toMatchObject({
    status: 'CLOSED',
    forwarded_via: 'WHATSAPP',
    affected_count: 12,
    symptoms: ['LETHARGIC', 'RESPIRATORY'],
  })
  expect(all[0].photo_ids).toHaveLength(1)

  // The worker sees the vet's advice.
  await page.evaluate(() => localStorage.clear())
  await login(page, 'pekerja2', 'pekerja123')
  await page.getByRole('link', { name: /Kesehatan ayam/ }).click()
  await expect(page.getByText('Pisahkan ayam yang sakit.')).toBeVisible()
  await expect(page.getByText('Selesai', { exact: true })).toBeVisible()
})
