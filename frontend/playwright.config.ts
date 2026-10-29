import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run against a real API and a production build (with the service
// worker). They need PostgreSQL running: `docker compose up -d db` from the repo root.
const E2E_DB = 'postgresql+psycopg://poultry:poultry@localhost:5432/poultry_e2e'
const API_URL = 'http://localhost:8001'
const APP_URL = 'http://localhost:4174'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: APP_URL,
    trace: 'retain-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 760 } },
    },
  ],
  webServer: [
    {
      // Fresh database for every run, then the API.
      command:
        'cd ../backend && uv run python -m app.reset_db && ' +
        'uv run uvicorn app.main:app --port 8001',
      url: `${API_URL}/api/health`,
      env: { DATABASE_URL: E2E_DB, PHOTO_DIR: 'data/e2e-photos' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run build && npx vite preview --port 4174 --strictPort',
      url: APP_URL,
      env: { VITE_API_PROXY: API_URL },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
