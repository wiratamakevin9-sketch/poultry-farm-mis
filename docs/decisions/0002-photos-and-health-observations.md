# ADR 0002: Egg tray photos (UC13) and health observations with photos (UC14)

Status: accepted (2026-10-29)

## Context
The students added two use cases:

- UC13 Capture Egg Tray Photo: photograph a tray, and the counts of good, cracked and
  dirty eggs go into the daily record.
- UC14 Record Health Observation with Photo: photo of the birds plus symptoms; the owner
  sees it and forwards it to the veterinarian.

A house produces about 4,000 eggs a day, about 130 trays of 30. Photographing every tray
is not realistic for a worker. Eggs are already sorted at the farm (cracked and dirty
eggs are separated).

## Decisions
1. **What is photographed (UC13):** good eggs are counted as full trays x eggs per tray
   plus the remainder; the worker photographs the remainder tray and the sorted cracked
   and dirty trays (about 2-5 photos per house per day).
2. **Dirty eggs** get their own field (`eggs_dirty`), separate from rejected eggs, because
   dirty eggs may still be sold after cleaning.
3. **Phased AI:** Iteration 2 captures, syncs and stores tray photos together with the
   counts the worker entered; these become labelled training data. Iteration 3 trains a
   small object-detection model that runs on the phone (offline) and suggests counts.
   The worker always confirms or corrects the suggestion.
4. **Health observations (UC14)** are recorded offline like daily records. The owner
   follows a status flow New -> Seen -> Forwarded -> Closed and records the vet's advice.
5. **Forwarding to the veterinarian:** the server makes a PDF (observation, symptoms,
   photos, a note that it is not a diagnosis); the owner shares it via WhatsApp or email
   from the phone's share sheet, or downloads it on a computer. The veterinarian stays
   outside the system.
6. **No diagnosis:** the system never suggests a disease from photos or symptoms.
7. **Owner alert:** a "Baru" badge in the app. Push notifications are deferred.
8. **Photo storage:** photos are compressed on the phone, kept in IndexedDB until
   uploaded, uploaded through their own queue (so photos never delay daily records), and
   stored on the server's disk volume. Location data (EXIF) is removed.

## Consequences
- Project Outline and Project Plan: UC13 (photo part) and UC14 move into Iteration 2;
  UC13 automatic counting is part of Iteration 3.
- Photos need storage and backups on the deployed server.
- The farm's tray photos with confirmed counts are the dataset for Iteration 3.
