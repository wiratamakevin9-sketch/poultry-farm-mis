# ADR 0003: Iteration 2 farm modules (schedules, treatments, sales, stock, dashboard)

Status: accepted (2026-11-02; the students accepted all proposed defaults)

## Decisions
1. **Egg sales are recorded in kg with a price per kg.** The number of eggs (or trays) is
   also entered, because stock is kept in eggs. Where only one is known, kg is estimated
   from the average egg weight (default 62 g, setting `EGG_WEIGHT_G`).
2. **Good, cracked and dirty eggs are sold as separate grades** with their own price.
   Rejected eggs never enter the sellable stock.
3. **Eggs laid during a withdrawal period** (a house under treatment, up to the end date
   plus the withdrawal days) go to a **withheld** stock. Withheld eggs cannot be sold;
   the owner records them as disposed.
4. **One feed stock.** The owner records feed purchases (in); daily records use feed
   (out). A warning shows when the stock lasts fewer than 7 days at the recent rate.
5. **Vaccination schedules are entered by the owner** per date (house, vaccine, method).
   Reminders are in the app: the owner sees the next days; the worker's phone shows
   "Vaksinasi hari ini" and the worker confirms it, offline, through the sync queue.
6. **Treatments are recorded by the owner** (house, medicine, start and end date,
   withdrawal days), usually on the vet's advice. Eggs may be sold again from
   end date + withdrawal days + 1.

## Consequences
- Stock is computed from a ledger (production, sales, disposals, adjustments) rather than
  stored as a single number, so it can always be explained and corrected.
- No diagnosis is involved: treatments are recorded as given, not suggested.
