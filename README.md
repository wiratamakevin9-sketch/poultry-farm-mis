# Poultry Farm MIS (offline-capable)

Final Year Project (BIT304). A web-based management information system for
Beneng Bahagia Poultry Farm (Getakan, Klungkung, Bali): about 20,000 laying hens in
4 chicken houses, where the signal at the houses is weak or absent.

Iteration 1 (FP 1) delivers the **offline core**: a farm worker logs in once, records
daily data for a chicken house on a phone with no internet, and the records sync to the
server automatically when a connection returns, with no lost or duplicated records.
The owner manages users, houses and flocks, sees the synced records and handles
sync conflicts the workers did not resolve in time.

Iteration 2, part 1 adds two use cases (ADR 0002):

- **UC13 Egg tray photos:** the worker counts good eggs as full trays × 30 + remainder
  and photographs the remainder tray and the sorted cracked and dirty trays. Photos are
  taken offline and stored with the counts (training data for automatic counting in
  Iteration 3). Dirty eggs have their own count.
- **UC14 Health observations:** the worker reports symptoms, estimated affected birds,
  notes and 1–3 photos, offline. The owner sees a "Baru" badge, opens the report,
  shares it with the veterinarian as a PDF (WhatsApp or email), records the vet's
  advice and closes it; the worker sees the status and the advice.

Reports: [`docs/iteration-1-report.md`](docs/iteration-1-report.md) and
[`docs/iteration-2-part-1-report.md`](docs/iteration-2-part-1-report.md).

## Tech stack

| Part | Technology |
|---|---|
| Frontend | React + TypeScript + Vite, installable PWA (vite-plugin-pwa / Workbox), React Router, Dexie.js (IndexedDB) |
| Backend | Python 3.13, FastAPI, SQLAlchemy 2, Alembic, Pydantic v2, JWT, argon2 password hashing |
| Database | PostgreSQL 16 |
| Tests | Pytest, Vitest + React Testing Library, Playwright |

## Run with Docker Compose

Requirements: Docker with the Compose plugin.

```bash
docker compose up --build
```

| What | URL |
|---|---|
| App (PWA) | http://localhost:5173 |
| API | http://localhost:8000/api/health |
| API docs (Swagger) | http://localhost:8000/docs |

On start, the backend applies the database migrations and, because
`SEED_DEV_DATA=1` is set in `docker-compose.yml`, creates the test accounts and four
example chicken houses (5,000 Isa Brown hens each; development data only).

The `frontend` container serves a **production build** so the service worker and
offline mode behave as they would on a phone. After changing frontend code, rebuild
with `docker compose up --build frontend`, or use the local setup below for hot reload.

Photos are stored in the `photo-data` volume. Stop with `docker compose down` (add `-v`
to also delete the database and photo volumes).

### Test accounts

| Role | Username | Password |
|---|---|---|
| Owner (Pemilik) | `pemilik` | `pemilik123` |
| Worker (Pekerja) | `pekerja1` | `pekerja123` |
| Worker (Pekerja) | `pekerja2` | `pekerja123` |

These are for development only. Change or deactivate them before real use.

## Local development (hot reload)

Requirements: [uv](https://docs.astral.sh/uv/), Node.js 22, Docker (for PostgreSQL).

```bash
# 1. Database
docker compose up -d db

# 2. Backend (http://localhost:8000)
cd backend
uv sync
uv run alembic upgrade head
uv run python -m app.seed          # test accounts and example houses
uv run uvicorn app.main:app --reload

# 3. Frontend (http://localhost:5173), in another terminal
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` to the backend. The service worker is only
generated in a production build (`npm run build && npx vite preview`), so test offline
mode with Docker Compose or the preview build, not with `npm run dev`.

Backend settings come from environment variables (or `backend/.env`):
`DATABASE_URL`, `JWT_SECRET` (set a long random value outside development),
`ACCESS_TOKEN_MINUTES` (default 30), `REFRESH_TOKEN_DAYS` (default 30),
`FARM_TIMEZONE` (default `Asia/Makassar`), `PHOTO_DIR` (default `data/photos`),
`MAX_PHOTO_BYTES` (default 3 MB), `EGGS_PER_TRAY` (default 30).

## Run the tests

All test suites need PostgreSQL running (`docker compose up -d db`). They use their own
databases (`poultry_test`, `poultry_e2e`), which are created automatically; your
development data is never touched.

```bash
# Backend: auth, roles, validation, idempotent sync, conflicts (Pytest)
cd backend && uv run pytest

# Frontend: validation, HDP, outbox and sync engine, form, conflict card (Vitest)
cd frontend && npm test

# End-to-end, including offline mode (Playwright)
cd frontend && npm run test:e2e
```

The Playwright run starts its own API on port 8001 (after resetting `poultry_e2e`) and a
production build on port 4174. If Playwright has no browser yet, run
`npx playwright install chromium` once.

## How to test offline mode in Chrome DevTools

1. Start the app (`docker compose up --build`) and open http://localhost:5173 in Chrome.
2. Open DevTools (F12) and click the **device toolbar** icon (Ctrl+Shift+M). Choose a
   phone size, or type 360 as the width.
3. Log in as `pekerja1` / `pekerja123` **while online**. Wait until the house list
   appears; the status bar says **Online** and **Semua data terkirim**.
4. In DevTools, open **Application → Service workers** and check that `sw.js` is
   *activated and running*.
5. Go offline: in the **Network** tab, set the throttling menu to **Offline** (or tick
   *Offline* under Application → Service workers).
6. Reload the page. The app still opens, and the status bar says **Offline**.
7. Tap **Kandang 1**, fill in the form and press **Simpan**. Do the same for
   **Kandang 2**. The status bar shows **2 data menunggu dikirim**, and the houses
   show **Menunggu dikirim**.
   - Optional: in **Application → IndexedDB → poultry-farm-&lt;user id&gt;**, the
     `records` and `outbox` stores now hold the two records.
8. Go back online (Network throttling → **No throttling**). Within a few seconds the
   status bar says **Semua data terkirim** and the houses show **Sudah terkirim**.
9. Log in as `pemilik` / `pemilik123` in another browser profile (or after logging out):
   **Catatan** lists both records once each, with HDP and feed per bird.

To see a **sync conflict**: log in as `pekerja2` in a second browser profile, go offline,
enter a record for a house and day that `pekerja1` already saved, then go online.
`pekerja2` gets **Data bentrok** with a side-by-side comparison and three choices.

### Egg tray photos (UC13)

On a computer the photo buttons open a file picker instead of the camera; any JPEG
works. Log in as `pekerja1`, open a house, fill **Tray penuh** and **Sisa butir** (good
eggs are filled in for you), add photos under **Foto tray**, and save. The status bar
shows the photos waiting; they upload after the record has synced. As `pemilik`, the
**Foto** column in **Catatan** opens them with their counts.

### Health observations (UC14)

As `pekerja2`, tap **Kesehatan ayam → Laporkan kesehatan ayam**, choose a house, tick
symptoms, add 1–3 photos and save (works offline). As `pemilik`, the **Kesehatan** menu
shows **Baru 1**. Open the report and press **Bagikan PDF**: on an Android phone this
opens the share sheet (WhatsApp, Gmail); on a computer it downloads the PDF, and the
WhatsApp Web / email links help you send it. Then mark how it was sent, write the
vet's advice and press **Tandai selesai**. The worker's list shows the status and advice.

To install the app, open the Chrome menu → **Install app** (desktop) or **Add to Home
screen** (Android). Installing on a real phone needs the app to be served over HTTPS,
which is planned for deployment in a later iteration.

## Repository layout

```
backend/    FastAPI app (app/), Alembic migrations (alembic/), tests (tests/)
frontend/   React PWA (src/), unit tests next to the code, e2e tests (e2e/)
docs/       Decisions (decisions/), iteration reports
docker-compose.yml
```

Key places in the code:

| Topic | Where |
|---|---|
| Validation rules (same rules on both sides) | `backend/app/validation.py`, `frontend/src/lib/validation.ts` |
| Sync API (push, pull) | `backend/app/routers/sync.py` |
| Conflict handling | `backend/app/routers/conflicts.py`, `docs/decisions/0001-sync-conflict-resolution.md` |
| Offline storage and outbox | `frontend/src/db/` |
| Sync engine and triggers | `frontend/src/sync/` |

## Indicators

- **HDP** (hen-day production) = eggs ÷ live birds that day × 100
- **Feed per bird** = feed kg × 1000 ÷ live birds (grams)
- **Live birds** = flock's initial count − all dead and culled birds before that day

FCR and mortality rate are defined in `CLAUDE.md` and come with the dashboard in a later
iteration.
