# ADR 0001: Sync conflict resolution by the worker first

Status: accepted (2026-10-26)

## Context
Workers record data offline on their own phones. The farm may have 10 or more workers,
and any worker may enter data for any chicken house. Two kinds of conflict can happen:

- VERSION: the same record (same UUID) was edited on two devices, so the device's
  `base_version` is older than the server version.
- DUPLICATE_DAY: two devices created different records (different UUIDs) for the same
  house and date, which breaks the rule "one record per house per day".

The original Iteration 1 prompt said the owner resolves every conflict. With many workers
this makes the owner a bottleneck, and the owner did not count the eggs.

## Decision
1. Prevent: while online, the phone pulls the latest records. When a worker opens a house
   that already has a record for the day, the form edits that record instead of creating
   a new one.
2. The server never overwrites on conflict. It keeps the server copy, stores the device
   copy in `sync_conflicts` and answers `conflict`.
3. The worker who submitted the losing copy sees the conflict on their own phone and
   chooses: keep the server copy, take their copy, or edit a merged version.
4. If a conflict is still open after the edit window (today or yesterday in WITA), only
   the owner can resolve it.
5. The losing copy is never deleted: it stays in `sync_conflicts` with the resolution.

## Consequences
- The owner only handles rare, stale conflicts.
- Workers need a simple comparison screen.
- This changes the Iteration 1 prompt (owner-only resolution); mention it in the
  Project Outline.

## Alternatives rejected
- Last write wins: no action needed, but wrong data could be saved silently.
- Per-collection entries summed per day: no conflicts, but eggs could be counted twice
  and it breaks "one record per house per day".
