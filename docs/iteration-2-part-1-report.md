# Iteration 2, part 1 report: egg tray photos (UC13) and health observations (UC14)

Date: 29 October 2026
Decision record: [`decisions/0002-photos-and-health-observations.md`](decisions/0002-photos-and-health-observations.md)

## 1. Summary

The students added two use cases after Iteration 1. This part delivers:

- **UC13 Capture Egg Tray Photo, phase 1:** tray photos taken offline, stored with the
  counts the worker entered (the training data for automatic counting in Iteration 3),
  plus a tray counter and a separate dirty eggs count.
- **UC14 Record Health Observation with Photo:** reported offline by the worker; the owner
  sees it, shares it with the veterinarian as a PDF (WhatsApp or email), records the
  vet's advice and closes it; the worker sees the status and the advice.

Automatic egg counting from photos (UC13 phase 2) is planned for Iteration 3. The rest of
Iteration 2 (vaccination and medication, withdrawal periods, sales, stock, dashboard)
comes next.

| Suite | Tests | Result |
|---|---|---|
| Backend (Pytest) | 101 (was 70) | 101 passed |
| Frontend (Vitest + React Testing Library) | 64 (was 42) | 64 passed |
| End-to-end (Playwright, Chromium, 360 px) | 6 (was 4) | 6 passed, 3 runs in a row |

## 2. Decisions (agreed with the students)

| Question | Decision |
|---|---|
| What is photographed? A house gives about 130 trays a day. | Eggs are already sorted at the farm. Good eggs = full trays × 30 + remainder; the worker photographs the remainder tray and the cracked and dirty trays (about 2–5 photos per house per day). |
| Dirty eggs | A separate `eggs_dirty` count, not part of rejected eggs. |
| How does the owner forward to the vet? | A PDF, shared via WhatsApp or email. |
| Owner alert | A "Baru" badge in the app; push notifications later. |
| Schedule | UC14 and the photo part of UC13 in Iteration 2; automatic counting in Iteration 3. |

Assumptions stated in the plan and not changed by the students: 30 eggs per tray
(setting `EGGS_PER_TRAY`); health reports cannot be edited after saving (an unsent one
can be removed); the vet's contact is not stored; the symptom list (below) should be
checked by the farm's veterinarian.

## 3. What was built

### 3.1 Dirty eggs
- New column `daily_records.eggs_dirty` (≥ 0, existing rows 0). It counts towards the
  egg total, the "total eggs ≤ live birds" rule and HDP, on the phone and the server.
- Phones running an older version that do not send the field still sync (treated as 0).

### 3.2 Photo storage (shared by UC13 and UC14)
- `photos` table and `PUT /api/photos/{id}` (multipart). Idempotent by the phone's UUID:
  sending a photo twice stores it once.
- A photo is accepted only once its record or observation is on the server; until then
  the server answers 409 and the phone keeps the photo.
- The server opens the image, turns it upright, scales it to at most 1600 px and saves a
  new JPEG. Re-encoding removes all metadata, including the **GPS location**. Files that
  are not images or are larger than 3 MB are refused.
- Photos are visible only to the owner and the worker who took them. Docker Compose keeps
  them in the `photo-data` volume.

### 3.3 Photos on the phone
- The camera opens directly (`capture="environment"`). Each photo is shrunk on the phone
  to 1280 px JPEG (a 4000 × 3000 photo of 430 KB became 1280 × 960, about 63 KB) plus a
  240 px thumbnail.
- Photos wait in IndexedDB (schema version 2) and are uploaded one by one **after** their
  record or observation has synced, so photos never delay daily records. After upload
  the full image is removed from the phone; the thumbnail stays.
- The status bar shows photos waiting ("· 2 foto menunggu"). A photo the server refuses
  is marked *Gagal* with the reason.

### 3.4 UC13 in the daily record form
- **Tray penuh** and **Sisa butir** fill in **Telur bagus** (trays × eggs per tray +
  remainder); the remainder must be smaller than a full tray. Typing good eggs directly
  still works.
- **Foto tray**: remainder tray of good eggs, cracked tray, dirty tray (more than one
  per type is allowed).
- Photos are written to the phone's database only when the record is saved, so leaving
  the form does not leave orphan photos.
- Each photo is labelled with the worker's count: remainder tray → the remainder, cracked
  tray → cracked eggs, dirty tray → dirty eggs. Labels of photos not yet sent are updated
  if the record is edited.
- Owner: the records table has a **Foto** column that opens the photos with their counts.

### 3.5 UC14 health observations
Worker (offline, IndexedDB schema version 3):
- Form: house, symptom checklist, other symptoms, estimated affected birds, notes,
  1–3 photos. Same rules on the phone and the server: at least one symptom or a
  description; affected birds a whole number not above live birds; not in the future.
- Symptom list: Lesu; Nafsu makan turun; Minum berkurang; Diare atau kotoran tidak
  normal; Ngorok atau sesak napas; Jengger/pial pucat atau kebiruan; Bengkak di kepala
  atau mata; Produksi telur turun mendadak; Kematian mendadak; plus free text.
- **Laporan saya**: each report's status (waiting, sent, seen by the owner, forwarded to
  the vet, closed) and the vet's advice, updated on every sync. Unsent reports can be
  removed.

Server:
- `POST /api/sync/observations` (worker, idempotent by UUID); the pull returns the
  worker's own reports of the last 60 days with their status.
- Owner: list (`?status=`), new count for the badge, open (marks it **seen**), mark as
  forwarded (WhatsApp / email / other), vet advice, close and reopen.
- `GET /api/health-observations/{id}/pdf`: house, time (WITA), reporter, live birds and
  breed, affected birds, symptoms, notes, vet advice, photos, and the sentence *"Laporan
  ini berisi pengamatan pekerja kandang, bukan diagnosis. Mohon pemeriksaan dan saran
  dokter hewan."*

Owner:
- **Kesehatan** menu with a **Baru n** badge (refreshed every minute and when a report is
  opened). New reports first; closed ones on request.
- Report page: details, photos, a not-a-diagnosis note, **Bagikan PDF** (Android share
  sheet → WhatsApp or email with the PDF attached; on a computer the PDF downloads),
  **Unduh PDF**, WhatsApp Web and email links, **Sudah dikirim lewat** WhatsApp / Email /
  Lainnya, vet advice, **Tandai selesai** / **Buka lagi**.

No part of the system suggests a disease (CLAUDE.md rule).

## 4. Data model changes

| Table | Change |
|---|---|
| `daily_records` | `eggs_dirty` integer ≥ 0 (default 0); CHECK constraint updated |
| `photos` (new) | id (phone UUID), kind (TRAY/HEALTH), house_id, record_date, tray_category (GOOD_REMAINDER/CRACKED/DIRTY), label_count, observation_id, file_path, size_bytes, width, height, taken_at, uploaded_by, created_at; CHECK that a TRAY photo has a date and category and a HEALTH photo an observation |
| `health_observations` (new) | id (phone UUID), house_id, observed_at, symptoms (JSONB), other_symptoms, affected_count, notes, status (NEW/SEEN/FORWARDED/CLOSED), forwarded_via, vet_advice, seen_at, forwarded_at, closed_at, created_by, created_at, updated_at |

Migrations `add_eggs_dirty`, `add_photos`, `add_health_observations`; each upgrade and
downgrade was tested. IndexedDB on the phone moved to version 3 (adds `photos` and
`observations`); existing data is kept.

## 5. Test results

### 5.1 New backend tests (Pytest)

| File | Tests | Covers |
|---|---|---|
| `test_photos.py` | 14 | Upload, idempotency, another worker's id, waiting for the record, **GPS removed**, scaling, size limit, non-image, missing category, owner cannot upload, who can view, owner listing, photo count in records, eggs per tray in pull |
| `test_health_observations.py` | 13 | Report, idempotency, symptom or description required, unknown symptom, affected ≤ live birds, future time, owner cannot push, status flow NEW → SEEN → FORWARDED → CLOSED → reopen, worker pull, role checks, health photo needs own observation, **PDF content** (text, photo, non-Latin characters), worker cannot get the PDF |
| `test_sync.py` / `test_validation.py` | +4 | Dirty eggs stored, in HDP, in the egg total, older phones without the field |

### 5.2 New frontend tests (Vitest)

| File | Tests | Covers |
|---|---|---|
| `sync/photos.test.ts` | 6 | Waits for the record, upload fields, drops full image and keeps thumbnail, network failure, server 409, refused photo, remove only before upload |
| `sync/observations.test.ts` | 7 | Save with photos, payload, network failure, rejection, photos after the observation, status and vet advice after pull, remove only before sending |
| `pages/worker/RecordForm.test.tsx` | +2 | Tray counter and remainder limit; tray photos saved on Simpan with the right labels |
| `pages/worker/HealthForm.test.tsx` | 3 | Required fields, affected ≤ live birds, saves report and 3 photos |
| `lib/image.test.ts`, `lib/validation.test.ts`, `sync/engine.test.ts` | +4 | Photo scaling, dirty eggs rules, old records without dirty eggs |

### 5.3 End to end (Playwright, production build, real API and database)

1. **Tray photos offline:** fill the record with the tray counter (132 × 30 + 21 = 3,981),
   add two tray photos, save offline ("1 data menunggu dikirim · 2 foto menunggu"), go
   online, sync again. Server: the record has 3,981 good eggs, 9 dirty eggs and
   2 photos; the photo labels are remainder 21 and cracked 18; the photos are at most
   1280 px.
2. **Health report offline to PDF:** the worker reports offline with a photo; online it
   becomes "Terkirim, belum dilihat". The owner sees **Baru 1**, opens it (badge goes),
   sees the photo, downloads the PDF (starts with `%PDF`), marks it forwarded via
   WhatsApp, writes advice and closes it. Server: exactly one observation with one
   photo, CLOSED, WHATSAPP. The worker then sees the advice and **Selesai**.
3. The touch-target test now also covers the health list and form: every control is at
   least 44 px high at 360 px width, with no sideways scrolling.

A flaky check was found and fixed while repeating the run: a text match also matched the
status bar ("1 data menunggu dikirim"); it now matches the badge text exactly.

## 6. Known limitations

- **Not tried on a real Android phone.** The camera button, the share sheet with a PDF
  attached, and photo sizes on a low-cost phone still need testing at the farm (needs
  HTTPS deployment). In the tests the photo comes from a file and the share button falls
  back to downloading.
- **Tray photos are only visible on the phone that took them.** Another worker editing the
  same record does not see them; the owner sees all.
- **A photo waits forever if its record is rejected or deleted by the owner.** It stays in
  the "foto menunggu" count; the worker can remove it before upload.
- **Labels can go stale:** if a record is edited after its photos were uploaded, the
  stored label is not changed. For cracked and dirty trays the Iteration 3 training script
  can use the record's final counts instead.
- **Photo storage needs backups** on the deployed server (the `photo-data` volume).
- **The symptom list has not been checked by a veterinarian yet.**
- **The owner's "Baru" badge** is a count refreshed every minute while the app is open;
  there is no push notification yet (agreed).
- **Lint:** the frontend linter reports the same kind of warnings as before
  (`set-state-in-effect` when loading data); no errors.

## 7. Next steps

1. Ask the farm's veterinarian to check the symptom list and the PDF layout.
2. Deploy with HTTPS and test the camera and the WhatsApp/email sharing on the workers'
   and owner's phones.
3. Start collecting tray photos at the farm now; Iteration 3 needs a few hundred labelled
   photos to train and evaluate automatic counting.
4. Continue Iteration 2: vaccination and medication schedules, treatment withdrawal
   periods, egg sales, stock and the owner dashboard (Part C of the prompts).

## Appendix: commits

```
dfe173f Add UC13 egg tray photos and UC14 health observations to the plan
6554390 Add a separate dirty eggs count to daily records
55ff031 Add photo upload and storage on the server
ec23dc8 Add photo capture, compression and upload queue on the phone
7dba5c8 Add egg tray photos and a tray counter to the daily record form (UC13)
4c7b403 Add health observations on the server (UC14)
c607eb4 Add health observation reporting on the worker's phone (UC14)
3f4217d Add the health observation PDF for the veterinarian (UC14)
4439146 Add the owner's health page with PDF sharing (UC14)
d1d9eaa Add e2e tests for tray photos and health reports (UC13, UC14)
```
