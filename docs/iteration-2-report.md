# Iteration 2 report: farm modules

Date: 3 November 2026
Decision record: [`decisions/0003-iteration-2-farm-modules.md`](decisions/0003-iteration-2-farm-modules.md)
Part 1 of this iteration (UC13 egg tray photos, UC14 health observations, dirty eggs) is
reported separately in [`iteration-2-part-1-report.md`](iteration-2-part-1-report.md).

## 1. Summary

Iteration 2 (Part C of the prompts) is complete:

| Requirement (Part C) | Delivered |
|---|---|
| Vaccination and medication schedules with reminders | Owner schedules vaccinations; worker's **Hari ini** panel shows vaccinations due or missed and medicine to give today |
| Worker confirms a scheduled vaccination offline (same sync queue) | Yes, with an optional note |
| Treatment records with egg withdrawal periods; eggs of a treated house not sellable until the date passes | Yes: eggs from the first treatment day to end date + withdrawal days are **withheld**; the sale form does not offer them and the server refuses them |
| Egg sales per buyer | Buyers, sales in kg at a price per kg, per grade |
| Egg and feed stock updated from production, usage and sales | Egg stock per grade and feed stock, both computed from their history |
| Owner dashboard with HDP, FCR and mortality trends per house, PDF/CSV export | Weekly charts and table, alerts, this week vs last week, CSV and PDF |

| Suite | Tests | Result |
|---|---|---|
| Backend (Pytest) | 157 (101 after part 1) | 157 passed |
| Frontend (Vitest + React Testing Library) | 81 (64 after part 1) | 81 passed |
| End-to-end (Playwright, Chromium, 360 px) | 9 (6 after part 1) | 9 passed, three runs in a row |

## 2. Decisions (agreed with the students, ADR 0003)

1. Egg sales are recorded **in kg with a price per kg**; the number of eggs is entered or
   estimated from the weight (average egg weight 62 g, setting `EGG_WEIGHT_G`).
2. **Good, cracked and dirty** eggs are sold as separate grades; rejected eggs never enter
   the sellable stock.
3. Eggs laid during a withdrawal period go to a **withheld** stock that cannot be sold;
   the owner records them as disposed.
4. **One feed stock**; warning under 7 days at the recent rate (`FEED_LOW_DAYS`).
5. Vaccinations are **scheduled by the owner** per date and confirmed by a worker.
6. Treatments are **recorded by the owner**; eggs are sellable again from end date +
   withdrawal days + 1.

## 3. What was built

### 3.1 Vaccinations
- `vaccination_schedules`: house, date, vaccine, method (air minum, tetes mata, suntik,
  semprot, lainnya), notes; done time, worker and note once confirmed.
- Owner (**Jadwal**): last 7 and next 30 days, missed ones first; add, edit and delete
  until a worker has confirmed (then only notes can change).
- Worker (**Hari ini**, offline): vaccinations due today and missed in the last 7 days,
  **Konfirmasi** with an optional note, tomorrow's as a preview.
- Sync: `POST /api/sync/vaccinations`, idempotent; the first confirmation wins; a
  schedule the owner deleted is reported back to the phone. The phone keeps unsent
  confirmations across pulls (IndexedDB schema version 4).

### 3.2 Treatments and withdrawal periods
- `treatments`: house, medicine, dose, start and end date, withdrawal days, notes; phase
  planned / giving / withdrawal / finished; **sellable from** = end + withdrawal + 1.
- Owner (**Jadwal → Pengobatan**): list of the last 60 days, form with a live preview of
  the sellable date.
- Every house reports `withdrawal_until` for today: the owner's **Kandang** page and the
  worker's home show **Masa henti obat s/d …**, also offline from the last sync.
- Medicine reminder: during the giving phase the worker's **Hari ini** panel lists house,
  medicine, dose and end date.

### 3.3 Egg stock
Computed, not stored, so every number can be traced:

    stock per grade = production (daily records) - sales - disposals + count adjustments

- Eggs of a house on a withheld day count as **WITHHELD** instead of their grade.
  Rejected eggs never count.
- Owner (**Stok**): a card per grade with eggs and estimated kg, withheld marked "Tidak
  boleh dijual"; disposal (never more than in stock); physical count (stok opname), which
  records the difference as an adjustment; 30-day history of disposals, counts and feed
  purchases. A negative stock is flagged.

### 3.4 Buyers and sales
- `buyers` (unique name, phone, active) and `egg_sales` (date, buyer, grade, eggs,
  whether the eggs were estimated, kg, price per kg, total).
- The server refuses: more eggs than in stock (409 with the available number), the
  WITHHELD grade (422; also blocked by a CHECK constraint), future dates, inactive buyers.
- Owner (**Penjualan**): form with each grade's stock, egg estimate, total in rupiah;
  30-day list with kg and rupiah totals; delete a sale to correct a mistake (the eggs
  return to stock); buyer management.

### 3.5 Feed stock
- `feed_purchases` (date, kg, supplier, optional price). Stock = purchases − feed in daily
  records + weighing adjustments.
- Average use of the last 7 days gives "cukup untuk sekitar N hari"; under 7 days the card
  turns red with a warning.

### 3.6 Dashboard
- `GET /api/reports/weekly` (weeks start on Monday, farm time), per house and for the
  whole farm:
  - **HDP** = eggs ÷ hen-days × 100 (hen-days = live birds at the start of each recorded day)
  - **FCR** = kg feed ÷ (eggs × 62 g)
  - **Mortality** = dead ÷ birds at the start of the week × 100
  - feed per bird per day
- `GET /api/reports/alerts`: low feed, withheld eggs, overdue and today's vaccinations,
  new health reports, open conflicts.
- Exports: `weekly.csv` (UTF-8 with BOM for Excel, Indonesian headers) and `weekly.pdf`
  (landscape tables: whole farm, then each house).
- **Dashboard** page (the owner's start page):
  - **Perlu perhatian** with links to the right page.
  - **Minggu ini** tiles (HDP, FCR, mortality, eggs per day) compared with last week,
    saying whether that is better or worse (lower is better for FCR and mortality). Eggs
    are per day so a week that has just started compares fairly.
  - Three line charts (one measure each, never two y-axes), one line per house with a
    fixed colour per house. The 4-colour palette was checked with a colour-blindness
    validator (worst adjacent ΔE 9.1); two colours are below 3:1 contrast, so every chart
    has a legend and the numbers are available as a table (**Lihat tabel angka**).
  - Period 4 / 12 / 26 weeks; CSV and PDF buttons.
- Recharts is loaded as a separate chunk for the dashboard only, so workers' phones do not
  download or parse it.

### 3.7 Owner menu
Dashboard · Catatan · Kesehatan · Jadwal · Penjualan · Stok · Lainnya (Konflik, Kandang,
Pengguna). Only the worker's header stays pinned to the top (for the sync status); the
owner's longer menu scrolls away.

## 4. Data model changes

| Table | Purpose |
|---|---|
| `vaccination_schedules` | Planned vaccinations and their confirmation |
| `treatments` | Medicine per house with dates and withdrawal days (CHECK end ≥ start, days ≥ 0) |
| `egg_disposals` | Eggs thrown away, per grade (CHECK quantity > 0) |
| `stock_adjustments` | Physical count corrections for each egg grade and for feed |
| `buyers` | Egg buyers |
| `egg_sales` | Sales per buyer (CHECK sellable grade, quantity > 0, kg > 0, price ≥ 0) |
| `feed_purchases` | Feed bought (CHECK kg > 0) |

Five migrations, each tested up and down. IndexedDB on the phone is at version 4
(adds `vaccinations`); today's medicine is kept in the existing `meta` table.

## 5. Test results

### 5.1 New backend tests (Pytest)

| File | Tests | Covers |
|---|---|---|
| `test_vaccinations.py` | 12 | Schedule, overdue/done status, date filter, edit/delete rules, offline confirmation idempotent, first confirmation wins, deleted schedule, pull window, role checks |
| `test_treatments.py` | 11 | Sellable date, phases, `withdrawal_until` on houses and in the pull, overlapping treatments, date and withdrawal validation, edit/delete, today's medicine in the pull, role checks |
| `test_stock.py` | 9 | Production per grade, rejected eggs excluded, withheld eggs, disposal, no over-disposal, physical count, deleted records, kg estimate, role check |
| `test_sales.py` | 10 | Sale in kg reduces stock, egg estimate from weight, no overselling, **withheld eggs cannot be sold**, deleting a sale, filters, date/buyer rules, buyers, inactive buyer, role checks |
| `test_feed.py` | 6 | Purchases in / daily feed out, 7-day rate, low warning, no estimate without use, weighing, purchase rules |
| `test_reports.py` | 8 | Monday weeks, **hand-checked HDP, FCR and mortality**, hen-days follow live birds, farm totals, CSV, PDF text, alerts, role checks |

### 5.2 New frontend tests (Vitest)
- `sync/vaccinations.test.ts` (4): offline confirmation sent, kept on network failure,
  kept across a pull, server changes applied.
- `pages/worker/TodayPanel.test.tsx` (4): due/missed/tomorrow, confirm and sync, today's
  medicine, empty panel.
- `pages/owner/TreatmentsSection.test.tsx` (2), `SalesPage.test.tsx` (4) and
  `DashboardPage.test.tsx` (3): sellable-date preview, only sellable grades offered, egg
  estimate and total, overselling blocked, alerts with links, fair week comparison,
  three charts.

### 5.3 End to end (Playwright, production build, real API and database)
1. **Vaccination offline:** the owner schedules ND-IB; the worker confirms offline with a
   note; online, the server shows it DONE by Pekerja Satu with the note.
2. **Withdrawal, sales and stock:** a treated house's eggs (4,030) go to withheld while
   another house's go to good; the sale form does not offer withheld eggs and the API
   refuses them (422); selling 31 kg removes 500 eggs; the withheld eggs are disposed;
   buying 2,000 kg of feed raises the feed stock by exactly 2,000 kg; the worker's phone
   shows "Masa henti obat s/d …".
3. **Dashboard:** charts are drawn, the table opens, the CSV downloads with the right
   headers.

The six Iteration 1 / part 1 e2e tests still pass. Two of them were adjusted because the
spec files share one database: they now check only their own houses.

### 5.4 Fixed during this iteration
- Two flaky frontend tests (camera button busy, house list not yet loaded) now wait for
  the right state; repeated runs pass.
- Dashboard: dots were invisible (white on white), curved lines could suggest values
  between weeks (now straight), duplicate FCR axis labels (now two decimals), and the
  eggs tile compared a partial week with a full one (now eggs per day).

## 6. Known limitations

- **Treatments entered afterwards change past stock.** A treatment that covers days
  whose eggs were already sold moves those eggs to withheld, so a grade's stock can go
  negative. The Stok page flags it; a physical count corrects it.
- **Stock is for the whole farm**, not per storage room or per house.
- **Egg numbers from kg are estimates** (62 g per egg). Regular physical counts keep the
  stock honest; the egg weight can be changed in the settings.
- **Feed rate** is the last 7 days' recorded feed ÷ 7: days not yet recorded lower the
  rate, so "days left" can look better than it is early in a week.
- **No vaccination programs/templates**: each vaccination is scheduled by date. No
  recurring schedules.
- **Medicine is not confirmed by workers** (only vaccinations are, as Part C asks); the
  reminder is informational.
- **Reminders are in the app only**; push notifications are still deferred (ADR 0002).
- **Weekly report** counts all eggs (including rejected) for HDP and FCR. If the farm
  prefers sellable eggs only, it is one line in `app/reports.py`.
- **CSV uses commas and decimal points.** Excel with Indonesian regional settings may
  need *Data → From Text/CSV* to split columns.
- **Not tried on real phones yet**; needs HTTPS deployment.

## 7. Next steps

1. Deploy with HTTPS (Iteration 4 planned it; it is now the main blocker for real use).
2. Enter the farm's real houses, flocks, buyers and opening stock (a physical count).
3. Iteration 3 (AI): anomaly early warning, weekly egg forecast, the RAG assistant and
   UC13 automatic tray counting. The weekly report already provides the features the
   forecast needs (HDP, feed, mortality per house and week).

## Appendix: commits

```
13e3aaa Record Iteration 2 farm module decisions (ADR 0003)
650909f Add vaccination schedules for the owner and a Lainnya menu
36e2d80 Let workers confirm vaccinations offline (Hari ini panel)
0b227b8 Add treatments and egg withdrawal periods
bf56b71 Add egg stock computed from its history
af3508d Add buyers and egg sales
1eab5ac Add feed stock with purchases and a low-stock warning
aff98d0 Add the owner dashboard with weekly HDP, FCR and mortality
65144b1 Add e2e tests for Iteration 2 farm modules
dcd7523 Remind workers of medicine to give today
```
