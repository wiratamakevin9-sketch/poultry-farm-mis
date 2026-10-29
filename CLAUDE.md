# Project: Offline-Capable Web-Based Poultry Farm Management Information System

Final Year Project (BIT304), two students. Partner farm: Beneng Bahagia Poultry Farm,
Getakan, Klungkung, Bali. About 20,000 laying hens in 4 chicken houses. Signal at the
chicken houses is weak or absent, so data entry MUST work offline.

## Users and roles
- Owner: full access (users, houses, flocks, schedules, sales, dashboard, reports, AI).
- Farm Worker: daily data entry only, on a low-cost Android phone, often offline.
- Veterinarian: NOT a system user. Domain expert only. Receives health observations from
  the owner as a PDF (WhatsApp or email).

## Added use cases (see docs/decisions/0002-photos-and-health-observations.md)
- UC13 Capture Egg Tray Photo (Farm Worker): eggs are already sorted at the farm. The
  worker photographs the remainder tray of good eggs and the cracked and dirty trays.
  Iteration 2: photos are captured offline, synced and stored with the counts the worker
  entered (training labels). Iteration 3: an on-device model suggests the counts; the
  worker always confirms or corrects them.
- UC14 Record Health Observation with Photo (Farm Worker): symptoms checklist, notes,
  estimated affected birds and 1-3 photos, offline. The owner sees it (status New ->
  Seen -> Forwarded -> Closed), shares it with the veterinarian as a PDF via WhatsApp or
  email, and records the vet's advice. Owner alert: a "Baru" badge in the app; push
  notifications come later.
- Daily records have a separate "dirty eggs" count (eggs_dirty) next to good, cracked
  and rejected.

## Tech stack (do not change without asking)
- Frontend: React + TypeScript + Vite, installable PWA (vite-plugin-pwa / Workbox),
  React Router, Dexie.js on IndexedDB for offline storage.
- Backend: Python, FastAPI, SQLAlchemy 2.x + Alembic, Pydantic v2, JWT auth,
  passwords hashed with bcrypt or argon2.
- Database: PostgreSQL. Docker Compose for local development.
- Tests: Pytest (backend), Vitest + React Testing Library (frontend),
  Playwright (end-to-end, including offline mode).
- Use current stable versions. Check official docs before using an API you are unsure about.

## Repository layout
- /frontend  React PWA
- /backend   FastAPI app, Alembic migrations, tests
- /docs      decisions (ADR), API notes, test reports
- docker-compose.yml, README.md

## Rules
- UI text in Bahasa Indonesia. Code, comments, commits and docs in English.
- Mobile-first: usable on a 360 px wide screen, large touch targets (min 44 px),
  numeric keyboard for number fields.
- Every record created on a device has a client-generated UUID, so syncing twice never
  creates duplicates (idempotent sync).
- Never lose a record: if sync fails, it stays in the queue and retries.
- Key indicators:
  - HDP (hen-day production) = eggs / live birds that day x 100
  - FCR = kg feed / kg eggs (default average egg weight 62 g, configurable)
  - Mortality rate = dead birds / bird count at start of period x 100
- Business dates use the farm time zone Asia/Makassar (WITA, UTC+8): "today", the
  no-future-date rule and the "edit today or yesterday" rule are all based on WITA.
- Workers may only enter or edit the record for today or yesterday, judged by when the
  record was saved on the phone (so a late sync does not reject it).
- Sync conflicts (one record edited on two devices, or two records for the same house and
  day) are resolved first by the worker on their own phone. Only conflicts still open
  after the edit window (today/yesterday) go to the owner. The losing copy is always kept.
  See docs/decisions/0001-sync-conflict-resolution.md.
- AI features must never present a disease diagnosis. Health concerns are referred
  to the veterinarian.
- Keep it simple: this is a 2-person student project. Prefer clear code over clever code.
- Before large changes: show a short plan and wait for approval.
- After each task: run the tests and report what passed, what failed and what is untested.
- Do not invent requirements. If something is unclear, ask.
