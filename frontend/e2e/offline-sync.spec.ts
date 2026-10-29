import { expect, test, type Page } from '@playwright/test'

const API_URL = 'http://localhost:8001'

function farmToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date())
}

async function login(page: Page, username: string, password: string) {
  await page.goto('/')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Masuk' }).click()
}

async function fillRecord(page: Page, house: string, values: Record<string, string>) {
  await page.getByRole('button', { name: new RegExp(house) }).click()
  await expect(page.getByRole('heading', { name: house })).toBeVisible()
  for (const [label, value] of Object.entries(values)) {
    await page.getByRole('textbox', { name: new RegExp(`^${label}`) }).fill(value)
  }
  await page.getByRole('button', { name: 'Simpan' }).click()
  await expect(page.getByText(`Data ${house} tersimpan di HP.`)).toBeVisible()
}

test('records entered offline reach the server exactly once', async ({ page, context, request }) => {
  // 1. First visit online: log in, download houses, install the service worker.
  await login(page, 'pekerja1', 'pekerja123')
  await expect(page.getByRole('button', { name: /Kandang 1/ })).toBeVisible()
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready
    return navigator.serviceWorker.controller !== null
  })

  // 2. Go offline. The app must still open from the cache.
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('status').getByText('Offline')).toBeVisible()
  await expect(page.getByRole('button', { name: /Kandang 1/ })).toBeVisible()

  // 3. Enter two records with no internet.
  const values = {
    'Telur bagus': '4000',
    'Telur retak': '20',
    'Telur afkir': '8',
    'Telur kotor': '12',
    Pakan: '550,5',
    'Ayam mati': '2',
    'Ayam afkir': '1',
  }
  await fillRecord(page, 'Kandang 1', values)
  await fillRecord(page, 'Kandang 2', { ...values, 'Telur bagus': '3900' })
  await expect(page.getByText('2 data menunggu dikirim')).toBeVisible()

  // The records are on the phone and nowhere else yet.
  const localIds = await page.evaluate(async () => {
    const session = JSON.parse(localStorage.getItem('poultry.session')!)
    return new Promise<string[]>((resolve, reject) => {
      const open = indexedDB.open(`poultry-farm-${session.user.id}`)
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const all = open.result.transaction('records').objectStore('records').getAll()
        all.onsuccess = () => resolve(all.result.map((r: { id: string }) => r.id))
      }
    })
  })
  expect(localIds).toHaveLength(2)

  // 4. Back online: the queue empties by itself.
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('Semua data terkirim')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: /Kandang 1/ })).toContainText('Sudah terkirim')

  // 5. Press "Sinkronkan" again: sending twice must not create duplicates.
  await page.getByRole('button', { name: 'Sinkronkan' }).click()
  await expect(page.getByRole('button', { name: 'Sinkronkan' })).toBeEnabled()

  // 6. Check on the server, as the owner: both records, exactly once each.
  const loginResponse = await request.post(`${API_URL}/api/auth/login`, {
    data: { username: 'pemilik', password: 'pemilik123' },
  })
  const { access_token } = await loginResponse.json()
  const today = farmToday()
  const recordsResponse = await request.get(
    `${API_URL}/api/records?date_from=${today}&date_to=${today}`,
    { headers: { Authorization: `Bearer ${access_token}` } },
  )
  const records: { id: string; house_name: string; eggs_good: number; feed_kg: string }[] =
    await recordsResponse.json()

  expect(records.map((r) => r.id).sort()).toEqual([...localIds].sort())
  const byHouse = Object.fromEntries(records.map((r) => [r.house_name, r]))
  expect(Object.keys(byHouse).sort()).toEqual(['Kandang 1', 'Kandang 2'])
  expect(byHouse['Kandang 1'].eggs_good).toBe(4000)
  expect(byHouse['Kandang 2'].eggs_good).toBe(3900)
  expect(Number(byHouse['Kandang 1'].feed_kg)).toBe(550.5)
})

test('the app shell is installable', async ({ page }) => {
  await page.goto('/')
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestHref).toBeTruthy()
  const manifest = await (await page.request.get(manifestHref!)).json()
  expect(manifest).toMatchObject({
    name: 'Peternakan Beneng Bahagia',
    display: 'standalone',
    start_url: '/',
    lang: 'id',
  })
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  )
})

test('main page opens within 3 seconds on a slow phone after the first visit', async ({
  page,
  context,
}) => {
  await login(page, 'pekerja2', 'pekerja123')
  await expect(page.getByRole('button', { name: /Kandang 1/ })).toBeVisible()
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready
    return navigator.serviceWorker.controller !== null
  })

  // Approximate a mid-range Android phone: 4x slower CPU and a slow 3G-like network.
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
  })

  const started = Date.now()
  await page.reload()
  await expect(page.getByRole('button', { name: /Kandang 1/ })).toBeVisible()
  const elapsed = Date.now() - started
  console.log(`Main page ready in ${elapsed} ms (4x CPU slowdown, slow network)`)
  expect(elapsed).toBeLessThan(3000)
})

test('worker screens fit 360 px and every touch target is at least 44 px', async ({ page }) => {
  async function check(screen: string) {
    const problems = await page.evaluate(() => {
      const found: string[] = []
      if (document.documentElement.scrollWidth > window.innerWidth) found.push('horizontal scroll')
      for (const control of document.querySelectorAll<HTMLElement>('button, a, input, select, textarea')) {
        // Hidden camera inputs and checkboxes are tapped through their label.
        const viaLabel = control.matches('.visually-hidden, [type=checkbox]')
        const el = viaLabel ? (control.closest('label') ?? document.querySelector<HTMLElement>(`label[for="${control.id}"]`)) : control
        if (!el) continue
        const box = el.getBoundingClientRect()
        if (box.width === 0) continue // hidden
        if (box.height < 44) found.push(`${el.tagName} "${el.textContent?.trim()}" is ${box.height}px`)
      }
      return found
    })
    expect(problems, screen).toEqual([])
  }

  await login(page, 'pekerja1', 'pekerja123')
  await expect(page.getByRole('button', { name: /Kandang 3/ })).toBeVisible()
  await check('home')
  await page.getByRole('button', { name: /Kandang 3/ }).click()
  await expect(page.getByRole('heading', { name: 'Kandang 3' })).toBeVisible()
  await check('record form')
  await page.getByRole('link', { name: '← Kembali' }).click()
  await page.getByRole('link', { name: /Kesehatan ayam/ }).click()
  await check('health reports')
  await page.getByRole('link', { name: 'Laporkan kesehatan ayam' }).click()
  await check('health form')
})
