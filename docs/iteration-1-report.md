# Iteration 1 report: offline core (FP 1)

Date: 26 October 2026
Scope: Part B of the Claude Code prompts (offline core). AI features, sales, stock,
vaccination and reports are out of scope for this iteration.

## 1. Summary

A farm worker can log in once, then record daily data for a chicken house on a phone
with no internet. Records are stored on the phone (IndexedDB) and sync automatically
when a connection returns. The automated tests show no lost or duplicated records in all
five required sync scenarios. The owner manages users, chicken houses and flocks, sees
the synced records with HDP and feed per bird, and resolves conflicts that the workers
did not resolve in time.

| Suite | Tests | Result |
|---|---|---|
| Backend (Pytest) | 70 | 70 passed |
| Frontend (Vitest + React Testing Library) | 42 | 42 passed |
| End-to-end (Playwright, Chromium, 360 px) | 4 | 4 passed |
| Docker Compose (all three services) | manual smoke test | passed |

## 2. What was built

### 2.1 Authentication and roles
- Login with username and password; JWT access token (30 min) and refresh token
  (30 days). A new refresh token is issued on every refresh, so a worker who syncs
  regularly stays logged in.
- Passwords are hashed with argon2.
- Roles: `OWNER` and `WORKER`. Every endpoint checks the role (403 for the wrong role,
  401 without a valid token). Only workers can push daily records.
- Each user has a `token_version`. Resetting a password or deactivating a user
  increases it, which logs that user out on every device.
- After the first online login, the session is kept on the phone, so the app opens and
  works offline.
- Seed: one owner and two workers (see README).

### 2.2 Owner management (online)
- Users: list, create, deactivate/activate, reset password. The owner cannot deactivate
  their own account or change their own role, so they cannot lock themselves out.
- Chicken houses: create, rename, change capacity, deactivate. A house with an active
  flock cannot be deactivated.
- Flocks: create (breed, placement date, initial bird count) and end. One active flock
  per house, enforced by a partial unique index in PostgreSQL.

### 2.3 Daily record entry (works offline)
- One record per house per day: eggs good / cracked / rejected, feed (kg), water
  (litres, optional), dead, culled, notes.
- Validation on the phone and again on the server, with the same rules and the same
  Indonesian messages:
  - all counts are whole numbers ≥ 0;
  - total eggs ≤ live birds;
  - dead + culled ≤ live birds;
  - 0 < feed ≤ 0.2 kg × live birds;
  - the date is not in the future;
  - only today's or yesterday's record can be entered or edited.
- Live HDP, feed per bird and total eggs preview while typing.
- Live birds at the start of a day = flock initial count − all dead and culled on
  earlier days. The phone computes this from its own copy of the records, so it works
  offline.
- Numeric keyboard on phones; decimals accept a comma (`550,5`).
- If a record already exists for the house and day (for example one entered by another
  worker and pulled earlier), the form opens it for editing instead of creating a
  second one.

### 2.4 Offline storage and sync
- Dexie database per user (`poultry-farm-<user id>`), so workers sharing a phone never
  mix their offline data. Tables: `records`, `outbox`, `houses`, `conflicts`, `meta`.
- Local record fields: `id` (UUID made on the phone), `house_id`, `flock_id`,
  `record_date`, values, `base_version`, `updated_at`, `sync_status`
  (`pending | synced | conflict | rejected`), and the server's `errors` if rejected.
- Outbox pattern: every save adds an outbox entry. The sync engine sends the latest copy
  of each queued record and removes entries only after the server answered. An edit made
  while a push is in flight stays queued.
- Sync triggers: app start, the browser `online` event, every 60 seconds while online,
  and the **Sinkronkan** button.
- The status bar always shows Online/Offline, the number of records waiting, the last
  sync time and the sync button.

API:

| Endpoint | Purpose |
|---|---|
| `POST /api/sync/push` `{records: [...]}` | Per record: `accepted` (with new version), `conflict` (with conflict id) or `rejected` (with field errors). One bad record does not block the others. |
| `GET /api/sync/pull?since=<cursor>` | Records changed since the cursor (pages of 500), active houses with active flock and live birds, the caller's open conflicts, and the server's farm date. |

Server rules:
- Upsert by client UUID. Resending identical data is a no-op (`accepted`).
- Every record has a `version` that increases on every change.
- If the device's `base_version` is older than the server's, the server copy is not
  overwritten: the response is `conflict`, and the device copy is stored in
  `sync_conflicts` (reason `VERSION`).
- A second record with a different UUID for the same house and day is also a conflict
  (reason `DUPLICATE_DAY`).
- Resending the same conflicting batch does not create a second conflict.
- Every change gets a global `change_seq` from a PostgreSQL sequence, which the pull
  uses as its cursor. Record writes take a transaction-level advisory lock, so
  sequence order equals commit order and a device can never skip a record.

### 2.5 Conflict resolution (decision ADR 0001)
- The worker who submitted the losing copy sees a side-by-side comparison on their own
  phone and chooses **Pakai data di server**, **Pakai data saya** or **Gabungkan…**
  (enter merged values, validated).
- Only conflicts still open after the edit window (today/yesterday) go to the owner.
  The owner sees newer conflicts as *waiting for the worker*.
- A resolution is refused if the server record changed after the comparison was shown.
- The losing copy is never deleted; it stays in `sync_conflicts` with the resolution,
  who resolved it and when.

### 2.6 PWA
- Web app manifest (Indonesian name, standalone display, theme colour, 192/512 icons and
  a maskable icon) and a Workbox service worker that precaches the app shell.
- API responses are never cached by the service worker; data lives in IndexedDB.
- New versions install automatically.

### 2.7 Owner view
- **Catatan**: records per house and date range (default 14 days) with total eggs, HDP,
  feed per bird, dead, culled, who saved it and server sync time (WITA). The owner can
  delete a record (soft delete); phones remove it on the next pull.
- **Konflik**: conflicts the owner may resolve, plus those still waiting for a worker.

## 3. Data model

| Table | Main columns |
|---|---|
| `users` | id, username (unique), full_name, password_hash, role, is_active, token_version, created_at, updated_at |
| `chicken_houses` | id, name (unique), capacity (> 0), is_active, created_at, updated_at |
| `flocks` | id, house_id, breed, placement_date, initial_bird_count (> 0), is_active, timestamps; unique active flock per house |
| `daily_records` | id (client UUID), house_id, flock_id, record_date, egg counts, feed_kg, water_liters, dead, culled, notes, version, change_seq, created_by, updated_by, client_updated_at, server_updated_at, deleted_at; unique (house_id, record_date) among non-deleted rows; CHECK constraints for non-negative counts and positive feed |
| `sync_conflicts` | id, record_id, device_record_id, house_id, record_date, reason, device_payload (JSONB), server_version, submitted_by, status, resolution, resolved_by, resolved_at, created_at |

Migration: `backend/alembic/versions/20261026_32bbcd7fef16_initial_schema.py`
(upgrade and downgrade both tested).

## 4. Test results

### 4.1 Required sync scenarios (no lost or duplicated records)

| Scenario | Where it is tested | Result |
|---|---|---|
| Offline create | Pytest `test_offline_create_is_accepted`; Playwright offline test | Pass |
| Offline edit | Pytest `test_offline_edit_updates_and_bumps_version`; Vitest outbox tests | Pass |
| Sync interrupted halfway | Pytest `test_sync_interrupted_halfway_then_retried`; Vitest `keeps the queue when the network fails`, `keeps an edit made while the push was in flight` | Pass |
| Same record edited on two devices | Pytest `test_same_record_edited_on_two_devices` (server copy kept, device copy stored, retry makes no second conflict) | Pass |
| Same batch sent twice | Pytest `test_same_batch_twice_creates_no_duplicates`; Playwright presses Sinkronkan again and checks the server | Pass |

Playwright end-to-end (`frontend/e2e/offline-sync.spec.ts`, production build with the
service worker, real API and database):
1. Log in online, go offline, reload: **the app opens from the cache** and shows Offline.
2. Enter two records offline: "2 data menunggu dikirim"; both are in IndexedDB.
3. Go online: "Semua data terkirim". Sync again.
4. As the owner, query the API: **both records exist exactly once**, with the same UUIDs
   as on the phone and the same values.

The other Playwright tests check the PWA manifest, the 3-second load budget on a
throttled phone, and the 360 px layout with 44 px touch targets.

### 4.2 Backend (Pytest, 70 tests)

| File | Tests | Covers |
|---|---|---|
| `test_auth.py` | 10 | Login, wrong password, argon2 hash, refresh, token type, expiry, deactivated users |
| `test_owner_management.py` | 17 | Role checks (403/401) on owner endpoints, users, houses, flocks, one active flock |
| `test_validation.py` | 12 | Every validation rule and message, WITA farm date, edit window |
| `test_sync.py` | 18 | Idempotent push, five sync scenarios, rejections, pull cursor, deletes, owner records with HDP |
| `test_conflicts.py` | 9 | Keep/take/merge, validation of merged values, permissions inside and after the window, stale version |
| `test_models.py` | 3 | Database constraints and the change sequence |
| `test_health.py` | 1 | Health endpoint |

### 4.3 Frontend (Vitest, 42 tests)

| File | Tests | Covers |
|---|---|---|
| `lib/validation.test.ts` | 12 | Form validation (same messages as the server), decimal comma, HDP, feed per bird, WITA date |
| `sync/engine.test.ts` | 13 | Outbox, push results (accepted/conflict/rejected), network failure, in-flight edits, pull paging, merges, deletes, conflict clean-up |
| `sync/useSync.test.ts` | 4 | Sync triggers (start, online event, 60 s timer, button), offline state, waiting count |
| `pages/worker/RecordForm.test.tsx` | 5 | Live HDP/feed preview, error messages, save to outbox, editing an existing record, date window |
| `components/ConflictCard.test.tsx` | 5 | Difference highlighting, keep/take/merge, server errors, locked conflicts |
| `App.test.tsx` | 3 | Login screen, owner menu only for the owner |

### 4.4 Non-functional targets

| Target | Result |
|---|---|
| No lost or duplicated records | Met in all five scenarios (4.1) |
| Main pages load within 3 s on a mid-range Android phone after the first visit | Approximated in Playwright with 4× CPU slowdown and a slow network: the worker's main page was ready in about 0.55 s. Not yet measured on a real phone. |
| Passwords hashed; every endpoint checks the role | argon2; role checks covered by tests |
| Usable at 360 px, touch targets ≥ 44 px, numeric keyboard | Playwright checks the worker home and entry form at 360 × 760: no horizontal page scroll and every button, link and input is at least 44 px high. Number fields use `inputMode` numeric/decimal. Owner pages were checked by screenshots only. |

### 4.5 Docker Compose
`docker compose up` started `db`, `backend` (migrations and seed ran) and `frontend`
(production build with service worker). The app opened, the worker flow worked, and the
app reopened offline from the cache.

## 5. Decisions and changes to the original prompt

| Change | Reason | Agreed |
|---|---|---|
| Conflicts are resolved first by the worker on their own phone; the owner only handles those still open after the edit window (ADR 0001). The prompt said the owner resolves all conflicts. | With 10+ workers the owner would be a bottleneck, and the worker counted the eggs. | Yes, by the students |
| New records, not only edits, are limited to today or yesterday. | Simpler for workers; older data can be completed by the owner later. | Yes, by the students |
| The edit window is judged by when the record was saved on the phone, not when it synced. | A phone that was offline for days must not lose yesterday's edit. | Implementation detail |
| Business dates use WITA (Asia/Makassar). | Farm time zone. | Yes, by the students |
| One Dexie database per user. | Workers sharing a phone keep separate offline data. | Yes, by the students |
| `rejected` push status added next to `accepted`/`conflict`. | An invalid record must be reported, not lost; it stays on the phone with the message. | Implementation detail |
| Docker `frontend` serves a production build instead of the dev server. | The service worker (offline mode) only exists in a production build. | Implementation detail |

Update the Project Outline for the first two rows.

## 6. Known limitations

- **Not tested on a real Android phone.** Installing the PWA on a phone needs HTTPS, so
  this waits for deployment. Performance was only approximated with Chromium throttling.
- **Conflict resolution needs internet.** Entering data does not; choosing between two
  copies does.
- **Device clock.** The edit window uses the time the phone saved the record. A phone
  with a wrong clock could save an older record; the server still refuses future dates.
- **First pull downloads the full record history.** At 4 houses this is about 1,500
  records per year, which is fine; a much larger farm would need a limit.
- **Tokens are stored in `localStorage`** so the app works offline. This is normal for an
  offline PWA but means a cross-site scripting bug could read them. There is no
  server-side list of revoked refresh tokens (password reset and deactivation still log
  users out through `token_version`).
- **Flock changes while a phone is offline.** A new record is linked to the house's
  active flock when it reaches the server. If the owner ends a flock and starts a new
  one while a phone holds unsent records, those records go to the new flock.
- **A record rejected by the server** (rare, because the phone checks the same rules)
  stays on the phone marked *Ditolak*; the worker must open it, fix it and save again.
- **Owner records table** scrolls sideways on a phone screen.
- **Lint:** 7 warnings from the frontend linter (`set-state-in-effect` for data loading
  in effects, one fast-refresh notice). No errors.
- **Untested in an automated way:** owner pages by clicking (their logic is covered by
  API tests), the two-device conflict end to end in Playwright (covered at API and sync
  engine level, and checked manually in the browser).

## 7. Next steps (FYP II)

Iteration 2 (farm modules: vaccination and medication schedules, treatment withdrawal
periods, egg sales, stock, owner dashboard with HDP/FCR/mortality trends and exports),
then the AI features in Iteration 3. Before that:

1. Deploy to a server with HTTPS and test on the workers' real phones at the farm.
2. Replace the example houses and flocks with the farm's real data.
3. Prepare an anonymised sample of real farm records early; Iteration 3 depends on it.

## Appendix: commits

```
a7ebcea Add CLAUDE.md project guide
453942f Record sync conflict and time zone decisions
8669cb5 Add project skeleton: FastAPI, Vite React app, Docker Compose
f0d5a79 Add database models, initial migration and dev seed data
b752348 Add login, token refresh and role checks
8e43e90 Apply ruff lint fixes and formatting
ae90aa2 Add owner API for users, chicken houses and flocks
299dec9 Add login page, layout and owner pages for users, houses and flocks
2dfd252 Fix session hook missing sessions saved while unmounted
47132b8 Add daily record validation rules with Indonesian messages
63df4c4 Add sync push/pull, conflict handling and owner records API
e7ed491 Limit new daily records to today or yesterday too
5cae88e Add offline storage, outbox and sync engine on the phone
929abe7 Add worker entry form, sync status bar and conflict screen
1f874a9 Add owner pages for daily records and stale conflicts
223ec3f Make the app an installable PWA and add Playwright offline tests
```
