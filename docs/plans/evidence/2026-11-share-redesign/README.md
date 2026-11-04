# Evidence: /share memory cards (Task 15, Slice B)

Run on 2026-11-04 against `npm run dev` on `:3101` with the Neon dev branch (`ep-solitary-tree`, migrations applied with `prisma migrate deploy`) and `OUTBOUND_ENABLED=false`, so every receipt ends as a `SKIPPED outbound_disabled` row rather than a real email. Chromium via the preinstalled Playwright 1.64 with the fake microphone and camera flags. The check script lives outside the repo (session scratchpad); its results are in `browser-checks.json`.

## Browser checks (51 scripted assertions, 50 passed + 1 re-run by hand)

| Area | Result |
|---|---|
| 390 × 844 and 852 × 393 | One card headed "Your memory"; no placeholders, no "+ Add another memory", "Record a video" and "Add photos or videos" shown, no desktop upload button; D13 labels. `phone-390.jpg`, `phone-landscape-852x393.jpg`. |
| 1280 × 900 | "Memory 1" full, cards 2–3 as placeholders, desktop upload button, the "One memory is plenty" hint. Opening a placeholder focuses its first field; "+ Add another memory" opens the waiting placeholder (focus on its heading), then appends Memory 4; the send button counts the filled cards; removing Memory 4 announces "Memory 4 removed. You now have 3 memories." and focuses Memory 3's heading. `desktop-1280-four-cards.jpg`. |
| Send of two text memories | Done heading focused, two private links listed by label ("Memory 1 · Summer 1985 · Lake George"), "only copy of these links" line (outbound disabled), no phone tip. `desktop-1280-done.jpg`. Each link opens its own claim page with its own words, "This is memory N of the 2 you sent together", D13 labels and the shared FAMILY visibility. `claim-1280.jpg`. |
| Phone send: fake-mic voice + 2 photos | Meter reads "Hearing you"; the clip becomes a row with a player; two photos added (3 rows); a duplicate pick is refused ("That one's already here."); done screen with one link and the D12 phone tip; the claim page shows all three files READY. `phone-390-filled.jpg`, `phone-390-done.jpg`, `phone-390-claim.jpg`. |
| Progress | With Blob requests slowed to 2.5 s: button read "Sending file 1 of 2 · 0% done" → "98% done" → "100% done" → "Sending file 2 of 2 · 100% done"; the polite region carried "Please keep this page open…"; two named `<progress>` bars. (The scripted assertion missed it only because the unslowed tiny files finished in under a frame.) |
| Draft | v2 restore after reload (card 1 words, contributor name, the restore notice); a v1 draft under the old key migrates into card 1 and the contributor fields and the old key is removed. |
| Hydration | No hydration warnings or page errors at any width. |

## Recorder smoke (`scripts/recorder-smoke.mjs`, card 1's `#record` area)

- `--expect hearing`: status "Hearing you", timer advanced, player duration finite, no silent verdict → `ok: true`. `hearing-clip.png`.
- `--expect silent --audio-file scripts/fixtures/silence-1s.wav`: status "We're not hearing anything", row flagged "This recording sounds silent." → `ok: true`.

## Lease and cron step (e3)

A completed send was staged back in SQL to the abandoned state (receipt row deleted, anchor lease 30 min in the future, anchor 31 min old, its file set to PENDING):

1. Cron run with the lease live: `submissionReceiptsSent: 0`, no receipt row, file still PENDING.
2. Lease expired by SQL, cron run: `confirmSubmission` re-checked the PENDING row against the store (`upload recorded` → READY) and attempted the receipt; with outbound disabled the row is `SUBMISSION_CONFIRMATION | SKIPPED | outbound_disabled`.
3. Third run: nothing selected (the terminal row stops (e3)).

Token rotation only happens on a SENT row, so it is covered by the unit tests (`complete-submission.test.ts`, `email.test.ts`), not by this run.

## Not run here (plan § Verification)

Real emails (allowlisted address needed): the two-link receipt, the thumbnail-in-email case after the 10 s wait, the ten-memory size case, admin alerts after completion. Real devices (iPhone, Android): native camera `.mov`, HEIC, cellular upload, the draft surviving the camera app. Slice C (webcam recording) is release 2.
