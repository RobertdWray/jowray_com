# Plan: /share redesign: memory cards (one on phones, several on computers), each holding several files

## Context

Today `/share` (`app/share/share-form.tsx`) is one long form for **one** memory with **at most one** file. It has an in-page **voice** recorder beside it. Each send creates a new `Contributor`, one `Memory` with its own claim link, and one confirmation email.

The requester wants:
- **Phones:** one memory per send (voice, video, photo and/or words).
- **Computers:** contact details entered once, then several memory cards, with a "+" to add more. Everything is sent together.

Rob's issue #17 plan (ledger Task 13; PR #25 branch, `docs/plans/2026-11-03-photos-derived-media.md` § 3.5) already planned a share-form rewrite as its PR C. It is not started yet. Its design: many files in one memory, a ticket per file, an upload lease, one email per send. **This work takes that scope over** (D9).

Constraints found in the code:
1. At most 3 emails per address per day (`services/email/index.ts:27`). The batch email and D15 address this.
2. Raw claim tokens are never stored, so an email listing every private link must be sent while the browser still holds the tokens. Otherwise the cron rotates them (`features/memories/confirm.ts:31-37`).
3. Upload tickets expire 15 minutes after minting (`lib/upload-ticket.ts:15`), and the Blob token then lives 1 hour [C33].

**Outcome:** a calmer phone flow, a faster multi-memory computer flow, and one email per send. It must not regress the recorder safeguards, approved copy, or the upload, claim and email pipeline.

## Decisions (requester, 2026-11-03)

| # | Decision | Ruling |
|---|---|---|
| D1 | Which screens get one memory | Phones only, decided by CSS width and never by user agent: below 48rem (768px) **or** shorter than 30rem, which also keeps landscape phones on the phone layout [C53, C54]. |
| D2 | Date | Keep the free-text `approxDateText` ("roughly is fine"). |
| D3 | Email for a multi-memory send | One email per send, listing every memory with its own private link. |
| D4 | Phone video and photo | The phone's own camera or picker (`<input type="file" capture>`) [C40]. Voice keeps the in-page recorder. |
| D5 | "Who can see this?" | Asked once per send. Each claim page can change its own memory. |
| D6 | "Where?" | Kept on each card, optional. |
| D7 | Shipping | **Release 1:** cards, multiple files, phone camera, voice, batch email; computers upload video files. **Release 2:** in-page webcam recording. |
| D8 | "Name of the memory" field | **Not added.** The UX review and the technical review agree. A derived label (`labelFor`) is used instead. Family-side titles are a Phase 2 idea (parking lot). |
| D9 | Issue #17 PR C | This work takes over its share-form scope. A card is one memory holding up to 10 files of mixed kinds (Rob's ruling is kept). This overrides Rob's "no desktop/phone fork". |
| D10 | Per-file caption, date and place (PR C's `Media.caption/approxDateText/place`) | Not built; the card carries date, place and words. Flag to Rob (parking lot). |
| D11 | Cards 2–3 on computers | **Compact placeholders** that open with one click. Under "About you": "One memory is plenty. Add more if they come to you." |
| D12 | Phone tip about using a computer | **On the thank-you screen only.** |
| D13 | Visibility option labels | Plainer: "Everyone who visits jowray.com" · "The whole family" · "Richard, Rob and Tracy only". Applies to the share and claim forms; the stored values are unchanged [C59, C60]. |
| D14 | Long multi-memory emails | Links first. Each memory's words are shortened ("…read it all from its link") **only** when the email would pass Gmail's clipping size. One-memory emails are unchanged. This amends Rob's R1 for multi-memory sends [C38]. |
| D15 | Per-recipient email cap | Raised from 3 to **15 per day**. The requester is not worried about abuse; the firewall rule is the abuse control [C39]. |
| D16 | Photo thumbnails in the email | `completeSubmission` waits **up to 10 seconds** for READY thumbnails, then sends with whatever is ready. Amends issue #17 § 3.6 "must not wait" [C6]. |
| D17 | Who runs the loop | This session finishes this cited plan and commits it. **Rob's environment** runs the premortem, the four-bucket sort, the Astra build and the review loop. |
| D18 | *(proposed)* Admin alerts (PR #26) for memories in a send | Rob's rule stays: one alert per memory. For a send, the alerts are scheduled with `after()` once `completeSubmission` runs, not at the first READY file, so each alert lists every file [C69]. One alert per send is parked for Rob. |

## Coordination and dependencies

- **PR #22 is merged.** `lockMemory`, `recomputeMemoryType`, `summarizeMemoryType`, `LIVE_MEDIA_ORDER` and `uploadWithTicket` are on `main`.
- **PR #25 and PR #26 (both open) merge first.**
  - PR #25 changes the cron, the schema, `ingest-upload.ts` and `claim.ts`, and owns email thumbnails (`DerivedMedia` THUMBNAIL).
  - PR #26 is Rob's approved admin alert (rulings R1–R13). It adds:
    - the `ADMIN_NEW_MEMORY` email type and one alert per memory, sent from `after()` in `createMemory` and `finalizeUpload`;
    - a shared `deliver()`, `services/email/templates/shared.ts` and `features/memories/media-summary.ts`;
    - cron step **(e2)** for admin alerts, with step (e) now filtering email rows by type;
    - a per-recipient cap that counts only confirmations (R4);
    - the SendGrid `content_id` fix that inline thumbnails need [C37].
  - Slice A builds on all of it, so this plan's new cron step is **(e3)**.
- **Tell Rob and the issue #17 orchestrator:**
  - This effort owns PR C's share-form scope.
  - Email Task 4's thumbnail attachment point moves to the shared submission email builder (A8): at most 4 previews per send, unique content ids [C37].
  - D10 and D14–D16 amend Rob's rulings.
- **Sources:** the approved EmpathIQ docs URL returns **404**, and a site search finds nothing. House conventions come from `docs/code-layout.md` and AGENTS.md; ask Rob for the current EmpathIQ link. Auth.js and BAML are not used by this change.

## Process: plan → reviews → premortem → build → review → ship (from the orchestration document)

| Stage | Step | Status |
|---|---|---|
| A · Plan | This plan, with a who-does-what table | ✅ planning session |
| | UX/UI review (D8, overall design) | ✅ review subagent |
| | Technical design review | ✅ review subagent |
| | Citations verified against live docs | ✅ citation subagents plus spot checks (§ Citations) |
| | Premortem: `/team-code-review` (George, Oscar) with `premortum.md` | ☐ Rob's environment (D17) |
| | Four buckets: `friend-buckets-plan-review.md`, then `bucket-plan-sorting.md`. Buckets 1 and 2 go into the plan; 3 and 4 go to the parking lot. | ☐ Rob's environment |
| B · Build | The orchestrator runs § Who does what. Independent tasks go to `/astra-work` (2 at a time, one owner per file, no network). Deep-context tasks run linearly in the orchestrator. | ☐ |
| | One **draft** PR per slice, with checks green and the parking lot in the notes [C61] | ☐ |
| C · Review and repair (1–3 cycles) | `/team-code-review`, then four buckets confirmed by the requester (`friend-buckets-issue-review.md`, `bucket-work-sorting.md`). Buckets 1 and 2 are grouped into cited GitHub issues (`document-issue.md`; the repo has no issue template yet). Astra repairs; the orchestrator inspects every repair; the repair commits go back through review. Stop when nothing severe is left, the requester says stop, or the goals are met. | ☐ |
| Ship | Merge only with the requester's go-ahead | ☐ |

Roles: planner · premortem and PR review, George + Oscar · orchestrator · workers, `/astra-work` (no network) · issue writers · ship, the requester. **The repo copy names roles only**, because pushed artifacts carry no model identifiers.

**What the planning session does after approval (D17):**
1. Restart branch `ccr-3fdd2c84-jbsqh7` from `origin/main`. It carries only already-merged history.
2. Write `docs/plans/2026-11-03-share-redesign.md` in the house format, with citations, roles and no model identifiers [C61].
3. Append a `## Task N — Share redesign: memory cards (2026-11-03)` section to `docs/plans/phase1-ledger.md`, with D1–D18, the coordination notes and the parking lot. N is the next free number: PR #25 and PR #26 each add a "Task 13", so this is Task 14 unless one of them renumbers.
4. Commit `docs(share): cited plan for the memory-card redesign`, push, and open a **draft** PR (docs only) whose notes carry the parking lot [C61]. **No code changes in the planning session.**

## Who does what

| # | Task | Owner | Files (one owner each) | Network/DB | After |
|---|---|---|---|---|---|
| P0 | Plan copy, ledger, draft PR | planning session | `docs/plans/2026-11-03-share-redesign.md`, `docs/plans/phase1-ledger.md` | git | approval |
| P1 | Premortem and four buckets | Rob's env | plan doc | yes | P0 |
| A1 | Schema, migration, `prisma validate` | orchestrator | `prisma/schema.prisma`, `prisma/migrations/<ts>_submissions/` | Prisma CLI | P1, #25 and #26 merged |
| A2 | Upload-window constants | Astra | `lib/upload-ticket.ts`, `app/api/upload/route.ts`, `__tests__/lib/upload-ticket.test.ts` | no | A1 |
| A3 | Validation schemas | Astra | `lib/validations/memory.ts`, `__tests__/lib/validations-memory.test.ts` | no | A1 |
| A4 | N-memory email template, on PR #26's `templates/shared.ts` | Astra | `services/email/templates/memory-confirmation.ts`, `services/email/types.ts`, `__tests__/services/email-template.test.ts` | no | A1 |
| A5 | `createSubmission` and shared helpers | orchestrator | `features/memories/create-submission.ts`, `features/memories/create-memory.ts`, `__tests__/features/create-submission.test.ts` | no | A2, A3 |
| A6 | `issueUploadTicket`; claim-path lease renewal | orchestrator | `features/memories/issue-upload-ticket.ts`, `features/memories/create-memory.ts`, `__tests__/features/issue-upload-ticket.test.ts` | no | A5 |
| A7 | Email service: type, rotations, cap 15 | orchestrator | `services/email/index.ts`, `__tests__/services/email.test.ts` | no | A4 |
| A8 | `confirmSubmission`, `completeSubmission`, guards, thumbnails, admin-alert timing | orchestrator | `features/memories/confirm.ts`, `features/memories/ingest-upload.ts`, `__tests__/features/confirm.test.ts`, `__tests__/features/ingest-upload.test.ts` | no | A6, A7 |
| A9 | Cron (d), (e), lease check in (e2), new (e3) | orchestrator | `app/api/cron/reconcile-uploads/route.ts`, `__tests__/api/reconcile.test.ts` | no | A8 |
| A10 | Server Functions; claim "Try again" and copy | orchestrator | `app/share/actions.ts`, `app/m/[claimToken]/actions.ts`, `app/m/[claimToken]/media-list-client.tsx`, `app/m/[claimToken]/claim-form.tsx` | no | A6 |
| A11 | Checks and draft PR, Slice A | orchestrator | n/a | yes | A1–A10 |
| B1 | Cards helpers and reducer | Astra | `lib/memory-cards.ts`, `__tests__/lib/memory-cards.test.ts` | no | Slice A merged |
| B2 | Draft v2 | Astra | `lib/share-draft.ts`, `__tests__/lib/share-draft.test.ts` | no | Slice A merged |
| B3 | Send pipeline | Astra | `lib/submission-pipeline.ts`, `__tests__/lib/submission-pipeline.test.ts` | no | Slice A merged |
| B4 | One form-level recorder | orchestrator | `app/share/use-recorder.ts`, `app/share/recorder-panel-client.tsx` | no | Slice A merged |
| B5 | Cards UI | orchestrator | `app/share/memory-card-client.tsx`, `app/share/card-media-client.tsx`, `app/share/thank-you-client.tsx`, `app/share/use-memory-cards.ts`, `app/share/use-share-draft.ts`, `app/share/share-form.tsx`, `app/share/page.tsx`, `app/globals.css` | no | B1–B4 |
| B6 | Remove the old `createMemory` path | orchestrator | `features/memories/create-memory.ts`, `app/share/actions.ts`, tests | no | B5 |
| B7 | Smoke run, Playwright checks, evidence | orchestrator | `scripts/recorder-smoke.mjs`, `docs/plans/evidence/2026-11-share-redesign/` | yes | B6 |
| C1 | Recorder video profile | orchestrator | `app/share/recorder.ts`, `lib/recorder-state.ts`, `__tests__/app/recorder.test.ts`, `__tests__/stubs/browser-audio.ts` | no | release 1 shipped |
| C2 | Camera help copy and device list | Astra | `lib/recorder-help.ts`, `lib/recording-devices.ts`, their tests | no | release 1 shipped |
| C3 | Video panel and button | orchestrator | `app/share/video-recorder-panel-client.tsx`, `app/share/card-media-client.tsx`, `app/share/use-recorder.ts` | no | C1, C2 |
| C4 | Video smoke run; device pass | orchestrator + requester/Rob | `scripts/recorder-smoke.mjs` | yes | C3 |

## UI design (release 1)

**One component tree serves both layouts. The split is pure CSS** [C4, C53, C54]:
- `app/globals.css` defines `@custom-variant wide (@media (width >= 48rem) and (height >= 30rem))` and `@custom-variant narrow (@media (width < 48rem), (height < 30rem))` [C54].
- Hidden elements use `display:none`, so phones never hear about them [C52].
- Nothing reads the user agent or JavaScript width on the first render, so the prerendered page never shifts [C4, C5].

Page order:
1. **Intro.** The approved "Write it down here." and its paragraph.
2. **About you (once).** `name`, `email`, `relationship`, with today's labels, placeholders and remembered defaults. On computers it adds: "One memory is plenty. Add more if they come to you." (D11)
3. **Card 1, always full.** It is a `<section aria-labelledby>` with an `<h2 tabIndex={-1}>` and per-card ids from `useId` [C48, C56, C60].
   - Heading: "Memory 1" on computers, "Your memory" on phones. Headings stay "Memory N" and never change as the person types [C60].
   - Fields: When + Where (side by side when wide) · media area · "Your memory of Jo" textarea · card error line.
   - When card 1 has content it shows "Clear this memory".
4. **Cards 2–3 (computers only):** compact dashed muslin placeholders, each with one secondary button, "Add a second memory" / "Add a third memory". The button expands the card and focuses its first field [C48]. On phones they are `narrow:hidden` [C52].
5. **"+ Add another memory"** (`narrow:hidden`). It adds an expanded card and focuses its heading [C48], and stops at 10 cards: "That's the most we can take at once. Send these, then add more."
   - **Removing a card with content** asks inline: "Remove Memory 2? [Yes, remove it] [Keep it]". There is no modal.
   - After removal, a polite live line says "Memory 2 removed. You now have 2 memories." and focus moves to the previous heading [C46, C47, C48].
   - Remove is disabled while that card is recording.
6. **"Who can see these?"**, asked once (D5). It reads singular when one card has content. Labels per D13 [C59, C60].
7. **Error summary, silent-clip confirmation and the red Send button.**
   - The summary lists one link per problem; each link moves focus to the field. Fields get `aria-invalid` and `aria-describedby` [C49, C50].
   - The silent-clip warning names the card: "The recording in Memory 2 sounds silent…"
   - Send reads "Send this to Jo's family" or "Send these 3 memories to Jo's family".
   - Unchanged below it: the Richard/Rob/Tracy line, the three checkboxes with today's defaults, and the consent note.

**Media area (one list per card, up to 10 items).**
- Label: "Add a photo, video or voice recording (optional)". The periwinkle box "Rather say it than type it?" holds **Record your voice**; the other buttons sit below the box.
- **Phones:**
  - "Record a video" uses a hidden `<input type="file" accept="video/*" capture="user">` opened by a real `<button>` [C40]. The copy never promises "opens the camera", because some phones show a chooser.
  - "Add photos or videos" uses `multiple`, `accept={ACCEPT_ATTRIBUTE}` and no `capture` [C41].
- **Computers:** "Upload photos, videos or recordings" (`multiple`) [C41]. "Record a video" comes in release 2.
- **One recorder for the whole form** [C12]:
  - `share-form.tsx` calls `useRecorder({ onClip })` once.
  - A card's Record button sets `recordingCardId` and calls `rec.start()` in the same click, which keeps iOS's in-tap rule.
  - The `RecorderPanel` (level meter, help, verdict) renders in that card and receives its `id` and heading as props; only card 1 carries `id="record"` [C55].
  - `onClip` appends a row to that card.
  - While recording, every capture control on the page is disabled, including the phone camera inputs: "Finish the recording in Memory 1 first."
- **Rows:**
  - Previews: an image thumbnail from an object URL; `<video controls playsInline preload="metadata">`; `<audio controls>`; or, for HEIC outside Safari, "Photo · IMG_1234.HEIC · 3 MB. We can't show it here, but the family will see it fine." [C42, C43]
  - Object URLs are revoked on remove, reset and unmount [C42].
  - **Recording rows need a two-step remove** ("Remove this recording? [Yes, remove it] [Keep it]"). File rows remove in one step.
  - Picks are checked as they arrive with `normalizeMime` and `maxBytesFor`, because `accept` does not validate [C41]. Duplicates by name and size are refused: "That one's already here." Copy for the limits: "That's ten files for this memory, the most one can hold. Start another memory for the rest." · "We can't take IMG_1.ext. Photos, videos and voice recordings are what we can hold." · "That video is over 500 MB. A shorter clip will fit."

**Draft v2** (`jowray.share.draft.v2`):
- Holds `{ v: 2, savedAt, contributor: { name, relationship }, cards: [{ approxDateText, place, note }] }`. A v1 draft migrates into card 1. Email is never saved, and the 30-day TTL is enforced in code because `localStorage` never expires [C58].
- Restore: `useSyncExternalStore(subscribeNever, readDraftOnce, () => null)`, then a guarded `dispatch({ type: "restore" })` during render with a `restoredOnce` flag [C9, C10, C5]. A saved draft wins over remembered details; email comes only from remembered details.
- The draft is also saved on `visibilitychange` → hidden, and in the click handler that opens the phone camera, because Android may discard the tab [C45].
- `beforeunload` is attached only while unsent media exists, and removed afterwards. It is a **desktop** safeguard; iOS Safari doesn't fire it [C44].

**Sending.** `lib/submission-pipeline.ts`, dependency-injected and tested in Node, runs from the submit handler [C1].
1. Validate the non-empty cards (`validateForSend`) [C49].
2. Call `createSubmission` once.
3. **Photos first**, then each file **sequentially**: `issueUploadTicket`, `uploadWithTicket` (multipart, progress), `finalizeUpload` [C31, C32].
   - On an upload error: finalize first, since the file may have landed, then retry once with a fresh ticket.
4. In a `finally`, call `completeSubmission({ claimTokens })` once.

Progress, as the person sees it:
- The button reads "Sending file 2 of 5 · 40% done", byte-weighted.
- A polite line reads "Please keep this page open. Videos can take a few minutes on a phone." It is updated once per file and about every 25% [C46, C47]. After about 20 seconds with no change: "Still going. Big files take a while."
- Each row has a named `<progress>`, e.g. "Photo 2, Memory 1" [C51].
- A network failure before anything is created reads: "We couldn't get through just now. Nothing was lost; your words are still here. Check your connection and press Send again." It never resends on its own.

**Done screen** (`thank-you-client.tsx`):
- The h1 is focused through a ref callback [C48]. The approved copy stays, with plural variants.
- Each memory is listed by `labelFor`: "Memory 2 · Summer 1985 · Lake George", falling back to the first ~6 words, then the media kind. Each has its link.
- Partial failures are named: "One file didn't make it: IMG_2231.MOV. Your words and the other files are safe. Open this memory's link to add it again."
- If nothing was emailed (no address, or capped): "This page is the only copy of these links, so keep it open or save it."
- Phone tip (D12, `narrow` only): "Have another? Tap "Tell another one". On a computer, jowray.com/share lets you send several at once."
- The share button keeps its click-only rule and the mailto fallback [C57].

## Server design (release 1)

**Schema** (one additive migration, `…_submissions`) [C16, C17, C18, C19, C20]:
- New `Memory` columns: `submissionId String?`, `submissionIndex Int?` and `uploadLeaseUntil DateTime?`. Legacy rows keep NULLs.
- `@@index([submissionId, submissionIndex])`. **Not** `@@unique`: Prisma v7 requires mandatory fields in a compound unique [C17]. Uniqueness holds by construction (one transaction assigns 0…N−1) and a test pins it.
- New `EmailType` value `SUBMISSION_CONFIRMATION` (`ALTER TYPE … ADD VALUE`, not used in the same migration) [C18, C19].

**Upload window** (`lib/upload-ticket.ts`) [C33]:
- `BLOB_TOKEN_LIFETIME_MS` (1 h) moves here from `app/api/upload/route.ts`.
- `UPLOAD_WINDOW_MS = TICKET_TTL_MS + BLOB_TOKEN_LIFETIME_MS` (75 min).
- `UPLOAD_LEASE_MS = UPLOAD_WINDOW_MS + 5 min`.
- The cron's cancelled-reservation grace period derives from the same constant.

**`createSubmission`** (`features/memories/create-submission.ts`) [C2, C15, C21, C28, C29, C30]:
- **Input:** zod 4 (`error:` option), with 1–10 memories and ≤10 files each. Each memory needs files or words. Errors carry `memoryIndex` and `fileIndex`.
- **One transaction:**
  - A budget check for N memories and the **declared** bytes, `min(maxBytesFor(mime), file.size)`, which the token then enforces [C34].
  - One `Contributor`.
  - N `Memory` rows: distinct tokens, `submissionIndex` i, the shared visibility and notify flag, consent, `summarizeMemoryType`.
  - PENDING `Media` rows in `sortOrder`, with **no tickets**.
  - The anchor's lease is set to now + `UPLOAD_LEASE_MS` when the send has files.
- A send with no files emails inline (it holds every token). Caught email errors are reported [C13, C14].
- **The old `createMemory` stays exactly as it is in Slice A** and is removed in Slice B. A wrapper would break production between the two slices.

**`issueUploadTicket({ claimToken, mediaId })`** [C2, C31, C33, C24]:
- Read the memory by its token hash.
- Read the row and require it to be PENDING, live and owned by that memory.
- Renew the **anchor's** lease with one `UPDATE`; its row lock is enough, so no `lockMemory` is needed.
- Mint the ticket.

**Claim-page ticket paths** (`createUploadTicket`, `createReplacementTicket`) renew the anchor's lease as their **first** statement, then call `lockMemory(k)` [C23, C24, C25]. A claim-page **"Try again"** button for PENDING reservations calls `issueUploadTicket` through a thin Server Function [C2, C31].

**`completeSubmission({ claimTokens })`** [C2, C21, C25, C6, C13, C14]:
1. Require the tokens to cover every live memory of one submission.
2. Clear the anchor's lease in its own statement and commit.
3. Poll up to **10 seconds** (D16) for READY `THUMBNAIL` rows of the send's photos.
4. Send **outside any transaction**.
- `already_sent` and `in_progress` count as emailed. Errors are caught and reported, and never hide the links.

**`confirmSubmission`** (`features/memories/confirm.ts`) [C27, C8, C22, C25, C36, C37, C38]:
- Builds one email from the live memories in `submissionIndex` order, with live READY media in `sortOrder`. It uses PR #26's `summarizeReadyMedia` and `templates/shared.ts` rather than copying them.
- At most 4 inline thumbnails per send, with unique content ids.
- **Links first.** For N > 1, each memory's link sits above its words, and each memory has a text link instead of the red button; the words are shortened only when the email would pass the size budget (D14).
- One `EmailLog` row on the anchor, with `SUBMISSION_CONFIRMATION`.
- **Cron path:**
  - Returns `leased` while the lease is live.
  - After expiry, it calls `recordMedia` on any remaining PENDING rows. Then it sends, listing those files as "didn't arrive — add it again from this link".
  - It never drops a memory that has no READY file and no words, because its link is how the contributor recovers.
  - It rotates every live token in one transaction, in a pinned order: SENT, then the anchor, then ascending index [C22, C25].
  - A soft-deleted memory gets no link and no rotation. If no memory is live, it writes a terminal SKIPPED row.
- `confirmMemory` returns `in_submission` for any memory with a `submissionId`, the anchor included. So `finalizeUpload` and claim-page uploads never send per-memory emails [C8].

**Admin alerts** (PR #26; D18) [C69, C8]:
- `finalizeUpload` skips its admin-alert hook for memories with a `submissionId`, the same guard as the confirmation.
- `completeSubmission` schedules `notifyAdminsQuietly` with `after()` for each live memory of the send; a no-file `createSubmission` does the same. Each alert therefore lists every file, and none waits on the person's response.
- `notifyAdminsOfMemory` is unchanged and stays idempotent per memory.

**Email service** (`services/email/index.ts`, on PR #26's shared `deliver()`) [C18, C22, C39]:
- Takes the `emailType`, keeping today's idempotency, outbound guard and atomic claim.
- Takes the ordered `rotations[]`.
- `RECIPIENT_DAILY_CAP` goes from 3 to **15** (D15). The count covers `MEMORY_CONFIRMATION` and `SUBMISSION_CONFIRMATION` rows, so a send counts as one email; admin alerts stay uncapped (PR #26 R4).

**Cron** (`app/api/cron/reconcile-uploads/route.ts`) [C7, C8, C26, C33]:
- (d) Retries branch on all three email types (PR #26 adds `ADMIN_NEW_MEMORY`). `SUBMISSION_CONFIRMATION` rows wait until the anchor's lease has expired.
- (e) Keeps PR #26's type filter and gains `submissionId: null` (legacy rows only).
- PR #26's admin step (e2) also skips memories whose send still holds a live lease, checked in code once per `submissionId`. Alerts then list every file, not "still uploading".
- New **(e3)** runs right after (e2) and before (b) and (g), with `take: 10`. It selects anchors that are at least 30 minutes old, have a contributor email and no live lease, and have `emails: { none: { emailType: "SUBMISSION_CONFIRMATION" } }`. Then it calls `confirmSubmission`. The **type filter** is required: the anchor's own `ADMIN_NEW_MEMORY` row must not count as "already emailed" [C26].
- One race is accepted and recorded in the ledger: the cron reads an expired lease, a claim-page ticket renews it, then the cron rotates. That upload's finalize fails, but the webhook still records the file.

**Claim form:**
- Notes that the name and "how you knew Jo" are shared by every memory sent together. `updateMemoryFromClaim` writes the shared `Contributor` [C59].
- Uses the D13 labels [C59, C60].

## Implementation steps (tests first on every critical path [C35])

**Prerequisites:** the coordination items are done, and PR #25 and PR #26 are merged. Run `npm ci` and read the relevant guides in `node_modules/next/dist/docs/` (AGENTS.md).

### Slice A — server (release 1; draft PR)
1. **A1** Schema and migration [C16–C20]. Run `npx prisma validate` and `prisma migrate dev --create-only`, and review the SQL by hand.
2. **A2** Constants [C33]. Test: "the lease covers the ticket TTL plus the Blob token lifetime".
3. **A3** Validation [C28–C30]. Tests:
   - "1–10 memories, ≤10 files each"
   - "each memory needs files or words"
   - "issues carry memoryIndex and fileIndex"
4. **A5** `createSubmission` [C21, C30, C34, C2]. Tests:
   - "one Contributor and N memories, with distinct tokens, index 0..N−1, and the shared visibility and notify flag"
   - "PENDING media in sortOrder, no tickets"
   - "whole send refused, nothing created, over budget (count + N, declared bytes)"
   - "lease on the anchor only, only with files"
   - "text-only send emailed once, inline, with every raw token"
   - "index uniqueness by construction"
   - the MIME, duration and HEIC cases ported from `createMemory`
5. **A6** `issueUploadTicket` and claim-path renewal [C2, C24, C25, C31]. Tests:
   - "mints and renews the anchor lease"
   - "refuses READY, removed and foreign rows, and a wrong token"
   - "claim paths renew the anchor before lockMemory(k)"
   - "legacy memory has no lease"
6. **A4 and A7** Template and email service [C22, C36–C39]. Tests:
   - "one memory renders byte-for-byte as today"
   - "several memories: links first, plural subject, each token only in its own links"
   - "ten memories with maximum-length notes stay under 100 KB"
   - "≤4 previews per send, unique content ids"
   - "submission row is idempotent and independent of per-memory rows"
   - "the cap counts both confirmation types and a send once; 15th allowed, 16th capped; admin alerts uncapped"
   - "rotation writes SENT, then the anchor, then index order, in one transaction; nothing on skip or failure"
7. **A8** `confirmSubmission`, `completeSubmission`, the guards and admin-alert timing [C6, C8, C13, C14, C21, C27, C69]. Tests:
   - "finalizeUpload schedules no admin alert for submission memories"
   - "completeSubmission, and a no-file createSubmission, schedule one admin alert per memory after the response"
   - "refuses an incomplete or mixed token set"
   - "completion clears the lease, then sends without rotating; never inside a transaction"
   - "waits ≤10 s for thumbnails, then sends"
   - "retry maps already_sent to emailed"
   - "cron path: leased → after expiry re-checks PENDING, sends with missing files listed, rotates every live token"
   - "soft-deleted memory: no link, no rotation"
   - "confirmMemory returns in_submission, including for the anchor"
   - "finalizeUpload sends nothing for submission memories, from share or claim"
8. **A9** Cron [C7, C8, C26, C33]. Tests:
   - "(d) sends a submission retry through confirmSubmission, after the lease expires; admin rows still go to notifyAdminsOfMemory"
   - "(e) skips submission memories"
   - "(e2) admin step waits while the send's anchor lease is live"
   - "(e3) picks only anchors ≥30 min old with an email, no live lease and no SUBMISSION_CONFIRMATION row; an ADMIN_NEW_MEMORY row on the anchor doesn't block it; sends once; a second run does nothing"
   - reconcile fixtures carry PR #25's `derivatives: []`
9. **A10** Server Functions in `app/share/actions.ts` [C2, C15]; claim "Try again" and copy [C2, C31, C59, C60]. **Leave `createMemory` untouched.**
10. **A11** `npm run validate`, `npm run test:run`, `npm run build:offline`, then the draft PR with the parking lot in its notes [C61].

### Slice B — card UI (release 1; draft PR)
1. **B1–B3** Pure modules [C11, C49, C58, C1, C31, C32]:
   - `lib/memory-cards.ts`: `isEmpty`, `hasContent`, `validateForSend`, `labelFor` and the cards reducer.
   - `lib/share-draft.ts`: v2 with v1 migration.
   - `lib/submission-pipeline.ts`. Tests:
     - "one file at a time, each ticket issued just before its upload, photos first"
     - "on an upload error: finalize, then one retry with a fresh ticket"
     - "a failed file doesn't stop the rest"
     - "completeSubmission exactly once, in finally"
     - "create fails: nothing uploaded, nothing resent"
     - "progress text"
2. **B4** One form-level recorder (`useRecorder({ onClip })`); the panel takes `id` and heading as props [C12, C55].
3. **B5** Components and hooks:
   - `use-memory-cards.ts` [C11, C5, C10]
   - `use-share-draft.ts` v2 [C9, C10, C45, C58]
   - `memory-card-client.tsx` [C3, C46–C50, C56, C60]
   - `card-media-client.tsx` [C3, C9, C40–C43, C45, C51]
   - `thank-you-client.tsx` [C3, C48, C57]
   - `share-form.tsx` [C1, C12, C44, C46, C47, C50, C52, C59]
   - `page.tsx` [C4, C6, C53]
   - `globals.css` variants [C53, C54]
4. **B6** Remove `createMemory`, its Server Function and its tests.
5. **B7** Update `scripts/recorder-smoke.mjs` (`#record` on card 1) [C68]. Run the Playwright checks below.

### Slice C — webcam recording on computers (release 2; draft PR)
1. **C1** `app/share/recorder.ts` takes an audio/video **profile**. The audio path stays identical and its tests run untouched. Video:
   - Candidates in order: `video/mp4` (H.264/AAC) first, because most family members watch on iPhones, then `video/webm;codecs=vp9,opus`, `vp8,opus`, `video/webm` [C62].
   - `videoBitsPerSecond` about 2 Mbps; resolution and frame rate go in the `getUserMedia` constraints (ideal 1280×720 at 30, `facingMode: "user"`) [C63, C64].
   - A `previewing` state in `lib/recorder-state.ts` [C64].
   - **Auto-stop when the recorded chunks reach about 95% of 500 MB**, because the bitrate is only a hint [C63].
   - Skip `fix-webm-duration` above about 100 MB.
2. **C2** Camera help for `NotAllowedError`, `NotFoundError` and `NotReadableError`. A camera and no microphone also gives `NotFoundError` [C64]. Add a `videoinput` list beside the microphone list [C66].
3. **C3** `video-recorder-panel-client.tsx`:
   - The preview is `<video muted autoPlay playsInline>`, with `srcObject` set in a ref effect and `play().catch()` [C65, C67, C43, C3].
   - Add the computer "Record a video" button, shown where support is detected with `useSyncExternalStore` [C9].
4. **C4** Video fakes in `__tests__/stubs/browser-audio.ts` and engine tests [C35]. A smoke run with Chromium's fake camera [C68]. A device pass on a Mac with Safari, an iPhone and an Android phone (whether Safari supports video recording is not documented on MDN [C62]).

## Verification
- **Each slice:**
  - `npm run validate`, `npm run test:run` and `npm run build:offline`, with `DATABASE_URL` unset and no `.env`.
  - CI (lint, type-check, test, build) on the draft PR [C61].
- **Browser checks** with the preinstalled Playwright and Chromium, against `npm run dev` on a Neon preview branch with `OUTBOUND_ALLOWLIST`. Evidence goes to `docs/plans/evidence/2026-11-share-redesign/`.
  - **390 px:** one card; no placeholders and no "+"; fake-mic voice plus 2 photos in one memory; the done screen shows the phone tip.
  - **852×393 landscape:** the phone layout [C54].
  - **1280 px:** card 1 is full and cards 2–3 are placeholders. Open one, fill cards 1 and 2, add a 4th, remove it (focus and announcement). Send. **One** email with 2 links first, and each opens its claim page with its files in order.
  - **Lease:** close the tab mid-upload. Cron (e3) waits for the lease, then re-checks PENDING, sends and rotates. With the tab open, `completeSubmission` sends at once and the on-screen links work.
  - **Admin alerts:** one per memory, arriving after completion and listing every file (PR #26's allowlisted address).
  - **Thumbnails:** a send with one photo shows the photo in the email (10 s wait), not the badge.
  - **Size:** 10 memories with long notes. Links appear first, words are shortened, and the email stays under the limit.
  - **Draft and hydration:** v1 → v2 restore; no hydration warnings at any width.
- **Real devices on the preview:** an iPhone and an Android phone. Check the native camera (`.mov`), HEIC, the voice recorder, a cellular upload, and that the draft survives the camera opening. Record the results in the ledger; this also closes F7 / Task 10.

## Review findings in four buckets

**1 · Must do (folded in above):**
- **Technical review:**
  - Lease = upload window + 5 min.
  - Post-expiry re-check-and-send.
  - (e3) filters and ordering. It was (e2), a name PR #26 has since taken.
- **Repo drift (PR #26):** the type-filtered `none` in (e3); a cap that counts both confirmation types; admin alerts timed at completion (D18).
  - (d) respects the lease.
  - `createMemory` untouched in A.
  - Gmail size (D14).
  - Completion sends outside any transaction; the `already_sent` mapping.
  - Pinned rotation order and claim-path lock order.
  - The shared-contributor note.
  - Draft saved before the camera opens.
- **UX review:** two-step remove for recordings; progress copy that tells people to keep the page open; compact placeholders (D11); the phone tip on the done screen (D12).
- **Citations:**
  - `@@index` instead of a nullable `@@unique` [C17].
  - `beforeunload` is desktop-only [C44].
  - The `capture` copy doesn't promise the camera [C40].
  - Prisma v7 URLs.
  - Quotes about webcam bitrate and Safari behavior feed the device pass [C62, C63].

**2 · Nice to do (folded in above):**
- **Technical review:**
  - One form-level recorder.
  - Byte reservations from declared sizes.
  - Upload retry.
  - Claim "Try again".
  - Landscape variants.
  - Named per-row `<progress>`.
  - Error summary with `aria-invalid`.
  - Done-screen h1 focus.
  - Removal announcements.
- **UX review:** media label and box placement; limit, unsupported-type and HEIC copy; partial-failure copy; validation focus; singular/plural visibility label; plainer labels (D13); network-error copy; duplicate check; `preload="metadata"`; "Clear this memory"; the no-email warning.

### Parking lot
**3 · Don't do (with reasons):**
- **A title field** (D8): it adds friction, a derived label covers the need, and it belongs to family curation.
- **Per-card recorders plus a capture lock:** one form-level recorder gives one capture at a time for free.
- **A two-lock `lockForUpload` helper:** `issueUploadTicket` neither counts nor changes media, so one anchor `UPDATE` is enough.
- **Ordinal headings** ("First memory"): headings stay "Memory N", a stable label [C60].
- **Reading authorization from cookies or headers instead of token arguments** (Next.js `use server` advice): there is no login; the hashed claim token is the capability by design, and it is checked per resource [C2].
- **A `Submission` table or OPEN/COMPLETE state machine:** columns plus the lease give the same guarantees.
- **Pre-minted tickets:** they expire after 15 minutes.
- **One email per memory:** the email cap and the noise.
- **A phone tip at the top** (D12).
- **A hand-written partial unique index:** Prisma drift. Uniqueness by construction plus a test instead [C17].

**4 · Real, but out of scope:**
- Family-side titles (Phase 2).
- Per-file caption, date and place (D10), for Rob.
- A list of sibling memories on the claim page.
- Range/206 video seeking.
- Sentry `withServerActionInstrumentation`.
- The accepted lease-renewal race (in the ledger).
- iOS: no `beforeunload`, and drafts never hold media.
- The Safari MediaRecorder video container (device pass).
- The current EmpathIQ docs link (ask Rob).
- One admin alert per send instead of per memory. PR #26's per-memory rule is Rob's; ask him.

## Files touched (each with its citations)

| File | Change | Citations |
|---|---|---|
| `prisma/schema.prisma` | submission columns, index, enum value | C16, C17, C18 |
| `prisma/migrations/<ts>_submissions/migration.sql` | add columns, index, enum value | C19, C20 |
| `lib/upload-ticket.ts` | window and lease constants | C33 |
| `app/api/upload/route.ts` | import token lifetime; token uses the declared size | C33, C34 |
| `lib/validations/memory.ts` | submission, ticket and complete schemas | C28, C29, C30 |
| `features/memories/create-submission.ts` (new) | `createSubmission`; admin alerts via `after()` for no-file sends | C2, C13, C14, C21, C30, C34, C69 |
| `features/memories/ingest-upload.ts` | no admin alert or confirmation from `finalizeUpload` for submission memories | C8, C69 |
| `features/memories/create-memory.ts` | extracted helpers, declared bytes, claim-path lease renewal | C21, C23, C24, C25, C34 |
| `features/memories/issue-upload-ticket.ts` (new) | per-file ticket, lease renewal | C2, C24, C31, C33 |
| `services/email/types.ts`, `services/email/templates/memory-confirmation.ts` | N-memory content, links first, size budget, inline thumbnails | C36, C37, C38 |
| `services/email/index.ts` | `emailType`, ordered rotations, cap 15 | C18, C22, C25, C39 |
| `features/memories/confirm.ts` | `confirmSubmission`, `completeSubmission`, guard, thumbnail wait, admin alerts via `after()` | C2, C6, C8, C13, C14, C21, C25, C27, C37, C69 |
| `app/api/cron/reconcile-uploads/route.ts` | (d), (e), lease check in (e2), new (e3), grace constant | C7, C8, C26, C33 |
| `app/share/actions.ts`, `app/m/[claimToken]/actions.ts` | new Server Functions | C2, C15 |
| `app/m/[claimToken]/media-list-client.tsx` | "Try again" | C31 |
| `app/m/[claimToken]/claim-form.tsx` | shared-contributor note, D13 labels | C59, C60 |
| `lib/memory-cards.ts` (new) | helpers and reducer | C11, C49 |
| `lib/share-draft.ts` | v2 with migration | C58 |
| `lib/submission-pipeline.ts` (new) | sequential send | C1, C31, C32 |
| `app/share/use-memory-cards.ts` (new) | reducer hook | C5, C10, C11 |
| `app/share/use-share-draft.ts` | v2 restore and save | C9, C10, C45, C58 |
| `app/share/use-recorder.ts` | one instance, `onClip`; release 2 profile | C12, C62 |
| `app/share/recorder-panel-client.tsx` | `id` and heading props | C12, C55 |
| `app/share/memory-card-client.tsx` (new) | card, placeholder, remove | C3, C46, C47, C48, C49, C50, C56, C60 |
| `app/share/card-media-client.tsx` (new) | media list and buttons | C3, C9, C40, C41, C42, C43, C45, C51 |
| `app/share/thank-you-client.tsx` (new) | plural done screen, tip | C3, C48, C57 |
| `app/share/share-form.tsx` | orchestrator | C1, C12, C44, C46, C47, C50, C52, C59 |
| `app/share/page.tsx` | layout; keeps `maxDuration` | C4, C6, C53 |
| `app/globals.css` | `wide` / `narrow` variants | C53, C54 |
| `scripts/recorder-smoke.mjs` | new structure; video run | C68 |
| `app/share/recorder.ts`, `lib/recorder-state.ts` | video profile, previewing (R2) | C62, C63, C64 |
| `lib/recorder-help.ts`, `lib/recording-devices.ts` | camera help, `videoinput` (R2) | C64, C66 |
| `app/share/video-recorder-panel-client.tsx` (new, R2) | live preview | C3, C43, C65, C67 |
| `__tests__/**` (new and changed tests, stubs) | TDD | C35 |
| `docs/plans/2026-11-03-share-redesign.md` (new), `docs/plans/phase1-ledger.md` | plan copy, ledger Task N, draft-PR process | C61 |

## Citations

All quotes were fetched **live on 2026-11-03** through Firecrawl with `maxAge: 0`:
- Citation subagents fetched most of them.
- The planning session fetched C33, C34, C37, C38, C39, C45, C50, C51, C54, C56, C60 and C69.
- The planning session re-fetched C9, C10, C17, C25, C44 and C47 to spot-check them. Typography follows each site: React uses curly apostrophes; MDN and W3C use straight ones.
- The repo was re-checked before submission. PR #26 is new and is folded in (C8, C26, C37, C39, C69).

Notes on the sources:
- Prisma's docs now default to ORM 8, so the v7 pages are used (the repo is on 7.10.1).
- Several pages have moved since the plan was drafted: C1, C4, C13, C14, C52, C61.
- The EmpathIQ docs URL returns 404.
- The handoff of this plan into the repo lost a few characters of C2's second source anchor and the opening of its first quote; both are marked below and should be re-fetched before the wording is relied on.

### [C1] — Next.js: invoke Server Functions from event handlers
- **Relevant File(s):** `app/share/share-form.tsx`, `lib/submission-pipeline.ts`
- **Change Summary:** The send pipeline calls `createSubmission`, `issueUploadTicket`, `finalizeUpload` and `completeSubmission` one at a time from the submit handler.
- **Source URL:** https://nextjs.org/docs/app/getting-started/mutating-data#event-handlers
- **Verbatim Quote:**
  > "You can invoke a Server Function in a Client Component by using event handlers such as `onClick`."
- **Justification:** Per-file progress between several Server Function calls needs an event handler, not a single form `action`. The docs list event handlers as a supported way to invoke them. The old `getting-started/updating-data` URL now returns 404.

### [C2] — Next.js: authorize inside every Server Function
- **Relevant File(s):** `app/share/actions.ts`, `app/m/[claimToken]/actions.ts`, `features/memories/create-submission.ts`, `features/memories/issue-upload-ticket.ts`, `features/memories/confirm.ts`
- **Change Summary:** Each new Server Function validates its input and checks that the claim-token hash owns the memory or media row it touches.
- **Source URL:** https://nextjs.org/docs/app/guides/data-security#authentication-and-authorization ; https://nextjs.org/docs/app/guides/data-security#built-in-server-actions-security-features *(anchor reconstructed after the handoff)*
- **Verbatim Quote:**
  > "[opening words lost in the handoff; re-fetch] … reachable via direct POST requests and verify authentication and authorization inside each one."
  >
  > "Beyond authentication (is the user logged in?), remember to check **authorization** (does this user have permission to act on this specific resource?). This prevents Insecure Direct Object Reference (IDOR) vulnerabilities"
- **Justification:** `issueUploadTicket({ claimToken, mediaId })` and the claim-page retry have exactly this IDOR shape, so each checks per-resource ownership. `completeSubmission` requires the full token set. The `use server` reference also suggests cookies over token arguments; that is parked as Don't do (no login; the claim token is the capability).

### [C3] — Next.js / React: the "use client" directive
- **Relevant File(s):** `app/share/memory-card-client.tsx`, `app/share/card-media-client.tsx`, `app/share/thank-you-client.tsx`, `app/share/video-recorder-panel-client.tsx`
- **Change Summary:** The new interactive components start with `"use client"`, and the helpers they import stay browser-safe.
- **Source URL:** https://nextjs.org/docs/app/api-reference/directives/use-client#usage ; https://react.dev/reference/rsc/use-client
- **Verbatim Quote:**
  > "To declare an entry point for the Client Components, add the `'use client'` directive **at the top of the file**, before any imports."
  >
  > "Add `'use client'` at the top of a file to mark the module and its transitive dependencies as client code."
- **Justification:** These components use hooks, browser APIs and event handlers. Their imports (`lib/memory-cards.ts`, `lib/media-types.ts`, `lib/submission-pipeline.ts`) become client code, so they must not import `server-only` modules. The repo's ESLint client glob (`*-client.tsx`) matches them.

### [C4] — Next.js: prerendered output becomes static HTML
- **Relevant File(s):** `app/share/page.tsx`, `app/globals.css`
- **Change Summary:** `/share` reads no request data and stays prerendered. The phone/computer split is done with CSS variants, not request or JavaScript detection.
- **Source URL:** https://nextjs.org/docs/app/getting-started/caching#predictable-values
- **Verbatim Quote:**
  > "Unlike random values and timestamps, which can vary between renders, module imports, synchronous I/O, and pure computations produce the same result every time they run. Components using only these operations are prerendered automatically, and their output becomes part of the static HTML at build time."
- **Justification:** HTML fixed at build time cannot know the device, so only a CSS media query gives the right first paint without a hydration shift. The URL moved from `cache-components` to `caching`.

### [C5] — Next.js: hydration mismatch causes
- **Relevant File(s):** `app/share/use-memory-cards.ts`, `app/share/use-share-draft.ts`
- **Change Summary:** Initial card ids are deterministic (`c1..c3`), and the localStorage draft is applied only after hydration.
- **Source URL:** https://nextjs.org/docs/messages/react-hydration-error#common-causes
- **Verbatim Quote:**
  > "Using browser-only APIs like `window` or `localStorage` in your rendering logic"
  >
  > "Ensure that the component renders the same content server-side as it does during the initial client-side render to prevent a hydration mismatch."
- **Justification:** Reading `jowray.share.draft.v2` during the first render is exactly the listed cause. Random ids would also differ between server and client.

### [C6] — Next.js: `maxDuration` applies to a page's Server Actions
- **Relevant File(s):** `app/share/page.tsx`, `features/memories/confirm.ts`
- **Change Summary:** The page keeps `maxDuration = 120`, which bounds `completeSubmission`, including its 10-second thumbnail wait (D16).
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/maxDuration#server-actions
- **Verbatim Quote:**
  > "If using Server Actions, set the `maxDuration` at the page level to change the default timeout of all Server Actions used on the page."
- **Justification:** The 10-second poll plus the SendGrid send fits well inside the page-level limit that `completeSubmission` inherits. `maxDuration` is not among the options that Cache Components removed in v16.

### [C7] — Next.js: Route Handlers
- **Relevant File(s):** `app/api/cron/reconcile-uploads/route.ts`
- **Change Summary:** The cron route keeps its `GET(request)` handler. It gains step (e3) and a lease check in PR #26's admin step (e2).
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/route#http-methods
- **Verbatim Quote:**
  > "A **route** file allows you to create custom request handlers for a given route. The following HTTP methods are supported: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`."
- **Justification:** It confirms the handler shape that the new step lives in. The `CRON_SECRET` check reads `request.headers` first, which keeps it consistent with the Cache Components rule.

### [C8] — Vercel Cron: missed and duplicate runs; idempotency
- **Relevant File(s):** `app/api/cron/reconcile-uploads/route.ts`, `features/memories/confirm.ts`, `features/memories/ingest-upload.ts`
- **Change Summary:** (d) and (e3) are reconciliation steps that send only when no row of their type exists or a row is retryable. `confirmMemory` and `finalizeUpload` leave submission memories to the submission path, so every path produces one confirmation per send and one admin alert per memory.
- **Source URL:** https://vercel.com/docs/cron-jobs/manage-cron-jobs#cron-job-delivery-and-idempotency
- **Verbatim Quote:**
  > "Cron delivery can also occasionally invoke the same scheduled run more than once. Because of this, cron jobs should be resilient to both missed runs and duplicate runs."
  >
  > "Design your operations to be idempotent and reconciliation-based so each run can safely reprocess outstanding work since the last successful run."
- **Justification:** (e3) keys on "an anchor with no `SUBMISSION_CONFIRMATION` row" plus the atomic claim, so a duplicate run sends nothing. The `in_submission` guard stops finalize and the cron from sending a second, per-memory email for the same send.

### [C9] — React: `useSyncExternalStore` with `getServerSnapshot`
- **Relevant File(s):** `app/share/use-share-draft.ts`, `app/share/card-media-client.tsx`
- **Change Summary:** The draft snapshot (null on the server) and recording support (false on the server) are read through `useSyncExternalStore`.
- **Source URL:** https://react.dev/reference/react/useSyncExternalStore#adding-support-for-server-rendering
- **Verbatim Quote:**
  > "A function that returns the initial snapshot of the data in the store. It will be used only during server rendering and during hydration of server-rendered content on the client."
  >
  > "Make sure that getServerSnapshot returns the same exact data on the initial client render as it returned on the server."
- **Justification:** A fixed server snapshot (no draft; recording unsupported) keeps hydration identical. The real browser values arrive on the next render, with no setState inside an effect.

### [C10] — React: adjust state during render, not in an Effect
- **Relevant File(s):** `app/share/use-share-draft.ts`, `app/share/use-memory-cards.ts`
- **Change Summary:** The restored draft is applied with a guarded `dispatch({ type: "restore" })` during render, protected by a `restoredOnce` flag.
- **Source URL:** https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
- **Verbatim Quote:**
  > "Storing information from previous renders like this can be hard to understand, but it's better than updating the same state in an Effect."
  >
  > "To avoid very slow cascading retries, React only lets you update the same component's state during a render."
- **Justification:** The reducer that owns the cards applies the restore itself, in the same component, once. That is the pattern React prefers over an Effect.

### [C11] — React: consolidate state logic in a reducer
- **Relevant File(s):** `lib/memory-cards.ts`, `app/share/use-memory-cards.ts`
- **Change Summary:** Cards are added, opened, removed, updated, reset and restored through one pure reducer that Node tests cover.
- **Source URL:** https://react.dev/learn/extracting-state-logic-into-a-reducer#consolidate-state-logic-with-a-reducer
- **Verbatim Quote:**
  > "Components with many state updates spread across many event handlers can get overwhelming. For these cases, you can consolidate all the state update logic outside your component in a single function, called a _reducer._"
- **Justification:** Many handlers across many cards (add, open placeholder, remove, field edits, restore, reset) are the case the docs describe. A pure reducer can be unit-tested without a DOM.

### [C12] — React: lift shared state up to the common parent
- **Relevant File(s):** `app/share/share-form.tsx`, `app/share/use-recorder.ts`, `app/share/recorder-panel-client.tsx`, `app/share/memory-card-client.tsx`
- **Change Summary:** `useRecorder({ onClip })` is called once in the form. The recording card receives its state as props, and `onClip` appends the clip to that card.
- **Source URL:** https://react.dev/learn/sharing-state-between-components#a-single-source-of-truth-for-each-state
- **Verbatim Quote:**
  > "Instead of duplicating shared state between components, _lift it up_ to their common shared parent, and _pass it down_ to the children that need it."
- **Justification:** The microphone, the one-capture-at-a-time rule and the mic choice are shared by every card. Owning them in the form removes the per-card engines and the capture lock.

### [C13] — Sentry (Next.js): capture caught errors
- **Relevant File(s):** `features/memories/confirm.ts`, `features/memories/create-submission.ts`
- **Change Summary:** Email errors during completion and inline sends are caught, so links are never hidden, and reported through `logErrorAndFlush`, which calls `Sentry.captureException`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/capturing-errors/#caught-errors
- **Verbatim Quote:**
  > "When you catch errors to return graceful responses (in Server Actions, API routes, or middleware), add `captureException` before returning."
- **Justification:** `completeSubmission` swallows errors to return the links gracefully, which is the case the docs describe. The URL moved from `/usage/`.

### [C14] — Sentry: `flush(timeout)`
- **Relevant File(s):** `features/memories/confirm.ts`, `features/memories/create-submission.ts`
- **Change Summary:** The reused `logErrorAndFlush` waits on `Sentry.flush(2000)` after capturing.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/apis/#flush
- **Verbatim Quote:**
  > "Maximum time in ms the client should wait to flush its event queue. Omitting this parameter will cause the client to wait until all events are sent before resolving the promise."
- **Justification:** A bounded flush drains queued events before the Server Function returns. The page documents the mechanics only; the serverless rationale is the repo's own comment in `lib/logger/logger.ts`.

### [C15] — React: Server Function arguments must be serializable
- **Relevant File(s):** `app/share/actions.ts`, `app/m/[claimToken]/actions.ts`
- **Change Summary:** The new Server Functions take only file metadata, tokens and ids (never `File` objects) and return plain objects.
- **Source URL:** https://react.dev/reference/rsc/use-server#serializable-parameters-and-return-values
- **Verbatim Quote:**
  > "Since client code calls the Server Function over the network, any arguments passed will need to be serializable."
- **Justification:** File bytes travel through `uploadWithTicket` to Blob. The Server Functions see only serializable metadata, which zod validates as untrusted input.

### [C16] — Prisma v7: optional fields
- **Relevant File(s):** `prisma/schema.prisma`
- **Change Summary:** `submissionId String?`, `submissionIndex Int?` and `uploadLeaseUntil DateTime?` are optional, so legacy rows need no backfill.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/models#optional-and-mandatory-fields
- **Verbatim Quote:**
  > "Fields without `?` are required:"
  >
  > "**Relational databases**: Represented via `NOT NULL` constraints"
- **Justification:** Adding `?` keeps the new columns nullable, so the additive migration succeeds against existing `Memory` rows.

### [C17] — Prisma v7: compound `@@unique` needs mandatory fields
- **Relevant File(s):** `prisma/schema.prisma`, `features/memories/create-submission.ts`
- **Change Summary:** Use `@@index([submissionId, submissionIndex])`, not `@@unique`. Uniqueness holds by construction (one transaction assigns 0…N−1), and a test pins it.
- **Source URL:** https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference#general-2
- **Verbatim Quote:**
  > "Defines a compound unique constraint for the specified fields."
  >
  > "All fields that make up the unique constraint **must** be mandatory fields. The following model is **not** valid because `id` could be `null`:"
- **Justification:** The columns must stay nullable for legacy rows (C16), so a compound unique over them is invalid per the reference. A hand-written index would drift from the schema.

### [C18] — Prisma v7: enums
- **Relevant File(s):** `prisma/schema.prisma`, `services/email/index.ts`
- **Change Summary:** `EmailType` gains `SUBMISSION_CONFIRMATION`, and the email service keys idempotency on `(memoryId, emailType)` using the anchor.
- **Source URL:** https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference#enum
- **Verbatim Quote:**
  > "Defines an enum."
  >
  > "Enums are natively supported by PostgreSQL and MySQL"
- **Justification:** A native Postgres enum value separates batch rows from per-memory rows under the existing `@@unique([memoryId, emailType])`.

### [C19] — PostgreSQL: `ALTER TYPE … ADD VALUE` in a transaction
- **Relevant File(s):** `prisma/migrations/<ts>_submissions/migration.sql`
- **Change Summary:** The migration adds the enum value and does not use it in the same file.
- **Source URL:** https://www.postgresql.org/docs/current/sql-altertype.html#id-1.9.3.42.7
- **Verbatim Quote:**
  > "If `ALTER TYPE ... ADD VALUE` (the form that adds a new value to an enum type) is executed inside a transaction block, the new value cannot be used until after the transaction has been committed."
- **Justification:** Prisma applies each migration in a transaction, so the new value is first used in application code. The Notes section has only this auto-generated anchor.

### [C20] — Prisma v7: `migrate deploy` in production
- **Relevant File(s):** `prisma/migrations/<ts>_submissions/migration.sql`
- **Change Summary:** The committed SQL is what the Vercel build applies with `npx prisma migrate deploy`.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production#production-and-testing-environments
- **Verbatim Quote:**
  > "In production and testing environments, use the `migrate deploy` command to apply migrations:"
- **Justification:** The SQL file, reviewed by hand in A1, is what runs in production.

### [C21] — Prisma v7: interactive transactions; keep them short
- **Relevant File(s):** `features/memories/create-submission.ts`, `features/memories/create-memory.ts`, `features/memories/confirm.ts`
- **Change Summary:** One `$transaction(async (tx) => …, TX_OPTIONS)` creates the whole send. `completeSubmission` commits the lease clear before it sends.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions#interactive-transactions
- **Verbatim Quote:**
  > "For complex logic between queries, use interactive transactions:"
  >
  > "Keep transactions short. Long-running transactions hurt performance and can cause deadlocks."
- **Justification:** The budget check and N creates need one `tx`. Uploads and SendGrid calls stay outside transactions, under the lease.

### [C22] — Prisma v7: array `$transaction([])` is atomic and ordered
- **Relevant File(s):** `services/email/index.ts`
- **Change Summary:** Recording SENT and rotating each live token run as one batch, in a pinned order: SENT, then the anchor, then ascending index.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions#transaction-api
- **Verbatim Quote:**
  > "The `$transaction([])` API is generic solution to independent writes that allows you to run multiple operations as a single, atomic operation - if any operation fails, Prisma Client rolls back the entire transaction."
  >
  > "Its also worth noting that operations are executed according to the order they are placed in the transaction."
- **Justification:** All rotations commit or none do, so an emailed link never points at an unsaved hash. The documented ordering lets the plan pin a lock order (C25).

### [C23] — Prisma v7: `$queryRaw` is a parameterized tagged template
- **Relevant File(s):** `features/memories/create-memory.ts`
- **Change Summary:** The claim-page ticket paths keep calling `lockMemory(tx, k)`, which runs `tx.$queryRaw\`… FOR UPDATE\``, after renewing the anchor's lease.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/raw-queries#queryraw
- **Verbatim Quote:**
  > "The method is implemented as a tagged template, which allows you to pass a template literal where you can insert your variables. In turn, Prisma Client creates prepared statements that are safe from SQL injections:"
- **Justification:** The lock helper binds `memoryId` as a value, so reordering statements around it keeps it injection-safe.

### [C24] — PostgreSQL: row-level locks
- **Relevant File(s):** `features/memories/issue-upload-ticket.ts`, `features/memories/create-memory.ts`
- **Change Summary:** Renewing the anchor's lease is a single `UPDATE`, whose row lock serializes it against completion and rotation. No extra `SELECT … FOR UPDATE` is needed.
- **Source URL:** https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS
- **Verbatim Quote:**
  > "`FOR UPDATE` causes the rows retrieved by the `SELECT` statement to be locked as though for update. This prevents them from being locked, modified or deleted by other transactions until the current transaction ends."
  >
  > "Row-level locks are released at transaction end or during savepoint rollback, just like table-level locks."
- **Justification:** An `UPDATE` takes the same row lock as `FOR UPDATE`, so a renewal and a completion on the anchor cannot interleave.

### [C25] — PostgreSQL: avoid deadlocks with a consistent lock order
- **Relevant File(s):** `features/memories/create-memory.ts`, `services/email/index.ts`, `features/memories/confirm.ts`
- **Change Summary:** Every multi-row writer takes the anchor first, then the others in ascending order. Completion commits its lease clear before it calls SendGrid.
- **Source URL:** https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-DEADLOCKS
- **Verbatim Quote:**
  > "The best defense against deadlocks is generally to avoid them by being certain that all applications using a database acquire locks on multiple objects in a consistent order. In the example above, if both transactions had updated the rows in the same order, no deadlock would have occurred."
  >
  > "This means it is a bad idea for applications to hold transactions open for long periods of time (e.g., while waiting for user input)."
- **Justification:** The claim-path renewal (anchor, then k) and the cron rotation (anchor, then index order) share one order, so no cycle forms. No transaction waits on the network.

### [C26] — Prisma v7: the relation filter `none`
- **Relevant File(s):** `app/api/cron/reconcile-uploads/route.ts`
- **Change Summary:** (e3) selects anchors with `emails: { none: { emailType: "SUBMISSION_CONFIRMATION" } }`, a type-filtered `none` like PR #26's step (e).
- **Source URL:** https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference#none
- **Verbatim Quote:**
  > "Returns all records where **zero** _related_ records match filtering criteria."
  >
  > "You can use `none` without parameters to return all records with no relations"
- **Justification:** `none` with criteria returns records where zero related rows match those criteria. Only a `SUBMISSION_CONFIRMATION` row marks the send as emailed, so PR #26's `ADMIN_NEW_MEMORY` row on the same anchor can't block the batch email.

### [C27] — Prisma v7: filter and sort nested relations
- **Relevant File(s):** `features/memories/confirm.ts`
- **Change Summary:** One query loads the send's memories by `submissionIndex`, with the contributor and their live READY media ordered by `sortOrder`.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/queries/relation-queries#filter-a-list-of-relations
- **Verbatim Quote:**
  > "When you use `select` or `include` to return a subset of the related data, you can **filter and sort the list of relations** inside the `select` or `include`."
- **Justification:** A nested `where` and `orderBy` return the email's files already filtered and in display order.

### [C28] — zod 4: array length checks
- **Relevant File(s):** `lib/validations/memory.ts`
- **Change Summary:** `memories` takes 1–10 entries, `files` at most 10 per memory, and `claimTokens` 1–10.
- **Source URL:** https://zod.dev/api#arrays
- **Verbatim Quote:**
  > "Zod implements a number of array-specific validations:"
  >
  > "z.array(z.string()).min(5); // must contain 5 or more items"
  >
  > "z.array(z.string()).max(5); // must contain 5 or fewer items"
- **Justification:** These are the current zod 4 calls that enforce `MAX_MEMORIES_PER_SUBMISSION` and `MAX_FILES_PER_MEMORY`.

### [C29] — zod 4: `.refine()`
- **Relevant File(s):** `lib/validations/memory.ts`
- **Change Summary:** Each memory must have files or non-blank words; new schemas pass `{ error: … }`.
- **Source URL:** https://zod.dev/api#refine
- **Verbatim Quote:**
  > "Every Zod schema stores an array of _refinements_."
  >
  > "Refinement functions should never throw. Instead they should return a falsy value to signal failure. Thrown errors are not caught by Zod."
- **Justification:** A cross-field rule needs a refinement that returns a boolean. The live page shows the `error` option, so new code uses it.

### [C30] — zod 4: `safeParse` and the issue path
- **Relevant File(s):** `features/memories/create-submission.ts`, `lib/validations/memory.ts`
- **Change Summary:** `issues[0].path`, for example `["memories", 2, "files", 0, "size"]`, maps to `memoryIndex` and `fileIndex` for the card error.
- **Source URL:** https://zod.dev/basics#handling-errors
- **Verbatim Quote:**
  > "To avoid a `try/catch` block, you can use the `.safeParse()` method to get back a plain result object containing either the successfully parsed data or a `ZodError`. The result type is a discriminated union, so you can handle both cases conveniently."
- **Justification:** The path's numeric entries identify the card and file, so the UI can focus the right field (C49).

### [C31] — Vercel Blob: authorize client uploads in `onBeforeGenerateToken`
- **Relevant File(s):** `features/memories/issue-upload-ticket.ts`, `lib/submission-pipeline.ts`, `app/m/[claimToken]/media-list-client.tsx`
- **Change Summary:** A ticket is minted per file right before its upload, and the token route authorizes exactly that file. The claim page's "Try again" uses the same path.
- **Source URL:** https://vercel.com/docs/vercel-blob/client-upload#authenticating-client-uploads
- **Verbatim Quote:**
  > "The `onBeforeGenerateToken` callback in your server route runs before the SDK generates a client token. You must verify that the requesting user is authenticated and authorized to upload before returning a token. Without this check, your upload route is open to the public."
- **Justification:** The per-file ticket is that authorization. Issuing it just before upload keeps every token exchange inside the 15-minute ticket TTL.

### [C32] — Vercel Blob SDK: `upload()`, `multipart` and `onUploadProgress`
- **Relevant File(s):** `lib/submission-pipeline.ts`, `app/share/share-form.tsx`
- **Change Summary:** Each file is uploaded with `multipart: true`. Per-file `onUploadProgress` feeds the byte-weighted "Sending file 2 of 5 · 40% done".
- **Source URL:** https://vercel.com/docs/vercel-blob/using-blob-sdk#upload
- **Verbatim Quote:**
  > "The `upload` method is dedicated to client uploads. It fetches a client token on your server using the `handleUploadUrl` before uploading the blob."
  >
  > "| `multipart` | No | Pass `multipart: true` when uploading large files. It will split the file into multiple parts, upload them in parallel and retry failed parts. |"
  >
  > "| `onUploadProgress` | No | Callback to track upload progress: `onUploadProgress({loaded: number, total: number, percentage: number})` |"
- **Justification:** `loaded` and `total` give the byte-weighted progress, and multipart already retries failed parts. The pipeline adds one whole-file retry on top.

### [C33] — Vercel Blob SDK: client token `validUntil` defaults to one hour
- **Relevant File(s):** `lib/upload-ticket.ts`, `app/api/upload/route.ts`, `app/api/cron/reconcile-uploads/route.ts`, `features/memories/issue-upload-ticket.ts`, `features/memories/create-submission.ts`
- **Change Summary:** `UPLOAD_WINDOW_MS = TICKET_TTL_MS + BLOB_TOKEN_LIFETIME_MS` and the lease is window + 5 min. The cron grace period derives from the same constant.
- **Source URL:** https://vercel.com/docs/vercel-blob/using-blob-sdk#onbeforegeneratetoken
- **Verbatim Quote:**
  > "A number specifying the timestamp in ms when the token will expire. By default, it's now + 1 hour."
- **Justification:** Bytes can arrive up to 15 + 60 minutes after a ticket is minted. A 70-minute lease would let the cron rotate tokens while a file is still landing; 80 minutes covers it.

### [C34] — Vercel Blob SDK: `maximumSizeInBytes`
- **Relevant File(s):** `features/memories/create-submission.ts`, `features/memories/create-memory.ts`, `app/api/upload/route.ts`
- **Change Summary:** `createPendingMedia` reserves `min(maxBytesFor(mime), file.size)`, and the token's maximum is the ticket's `maxBytes`.
- **Source URL:** https://vercel.com/docs/vercel-blob/using-blob-sdk#onbeforegeneratetoken
- **Verbatim Quote:**
  > "A number specifying the maximum size in bytes that can be uploaded. The maximum is 5TB."
- **Justification:** Blob enforces the declared size at upload and `recordMedia` checks it again. Ten videos no longer reserve 5 GB of the daily budget before they are sent.

### [C35] — Vitest: `vi.mock`
- **Relevant File(s):** `__tests__/features/create-submission.test.ts`, `__tests__/features/issue-upload-ticket.test.ts`, `__tests__/features/confirm.test.ts`, `__tests__/api/reconcile.test.ts`, `__tests__/services/email.test.ts`, `__tests__/services/email-template.test.ts`, `__tests__/lib/*.test.ts`, `__tests__/app/recorder.test.ts`, `__tests__/stubs/browser-audio.ts`
- **Change Summary:** The new tests mock `@/server/db/client`, `@/services/email` and `@/services/storage`, as the existing tests do.
- **Source URL:** https://vitest.dev/api/vi.html#vi-mock
- **Verbatim Quote:**
  > "Substitutes all imported modules from provided `path` with another module. You can use configured Vite aliases inside a path."
  >
  > "If the `factory` function is defined, all imports will return its result."
- **Justification:** The `@/` alias works inside `vi.mock`, so the in-memory Prisma stubs replace the real client before the feature modules load.

### [C36] — SendGrid Mail Send: one `content` entry per MIME type
- **Relevant File(s):** `services/email/types.ts`, `services/email/templates/memory-confirmation.ts`
- **Change Summary:** The N-memory template still returns both a plain-text and an HTML body.
- **Source URL:** https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send#request-body
- **Verbatim Quote:**
  > "An array of objects, each containing a message body's content and MIME type. You must specify at least one MIME type and may include multiple. To include more than one MIME type, add an object for each type to the array."
- **Justification:** The generalized builder keeps emitting both variants, so the transport needs no change.

### [C37] — SendGrid Mail Send: inline images via `content_id`
- **Relevant File(s):** `services/email/templates/memory-confirmation.ts`, `features/memories/confirm.ts`
- **Change Summary:** Up to 4 READY photo thumbnails per send are attached inline with unique content ids, after the 10-second wait (D16).
- **Source URL:** https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send#request-body
- **Verbatim Quote:**
  > "The attachment's content ID. The content_id is used when the disposition is set to inline and the attachment is an image, allowing the file to be displayed within the body of the email."
- **Justification:** Inline content ids are how the photo appears in the body, and they must be unique across every memory in a send. PR #26 fixes the transport so it actually sends `content_id` to SendGrid, which makes this depend on PR #26.

### [C38] — SendGrid support: Gmail clips HTML over 102KB
- **Relevant File(s):** `services/email/templates/memory-confirmation.ts`, `__tests__/services/email-template.test.ts`
- **Change Summary:** Multi-memory emails list the links first. Words are shortened only when the HTML would pass the budget, which is tested with ten memories at maximum length (D14).
- **Source URL:** https://support.sendgrid.com/hc/en-us/articles/9298249378075--Message-clipped-Emails-Sent-to-Gmail-Inboxes (section "What triggers email clipping in Gmail?"; this support article has no heading anchors)
- **Verbatim Quote:**
  > "If your email's HTML content is larger than 102KB, Gmail will generally clip the message."
- **Justification:** Ten 10,000-character notes would pass the limit and hide the links at the bottom. Putting links first plus a size budget keeps them visible.

### [C39] — Vercel WAF: rate limiting
- **Relevant File(s):** `services/email/index.ts`
- **Change Summary:** `RECIPIENT_DAILY_CAP` goes from 3 to 15 (D15), counting only contributor confirmations (`MEMORY_CONFIRMATION`, `SUBMISSION_CONFIRMATION`, per PR #26 R4). Abuse control sits at the firewall rule, which is still a launch gate.
- **Source URL:** https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting (page introduction)
- **Verbatim Quote:**
  > "Rate limiting allows you to control the number of times that a request from the same source can hit your application within a specific timeframe."
- **Justification:** Per-source request limits belong in the WAF. The email cap only has to stop runaway sends, so 15 lets phone users who send one memory at a time get every email.

### [C40] — HTML `capture` attribute
- **Relevant File(s):** `app/share/card-media-client.tsx`
- **Change Summary:** The phone's "Record a video" opens `<input type="file" accept="video/*" capture="user">`. The copy doesn't promise the camera app.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture#examples
- **Verbatim Quote:**
  > "The `capture` attribute specifies that, optionally, a new file should be captured, and which device should be used to capture that new media of a type defined by the `accept` attribute."
  >
  > "Note these work better on mobile devices; if your device is a desktop computer, you'll likely get a typical file picker."
- **Justification:** `capture="user"` requests the front camera for video on phones only, which matches the `narrow`-only placement. Some phones show a chooser, so the copy stays neutral.

### [C41] — `<input type="file">`: `multiple` and `accept`
- **Relevant File(s):** `app/share/card-media-client.tsx`
- **Change Summary:** "Add photos or videos" and "Upload photos, videos or recordings" use `multiple` and `accept={ACCEPT_ATTRIBUTE}`. Picks are checked with `normalizeMime` and `maxBytesFor`.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file#multiple ; https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file#accept
- **Verbatim Quote:**
  > "When the `multiple` Boolean attribute is specified, the file input allows the user to select more than one file."
  >
  > "The `accept` attribute doesn't validate the types of the selected files; it provides hints for browsers to guide users towards selecting the correct file types."
- **Justification:** Selecting several files at once fits multi-file cards. Because `accept` only hints, each pick is validated in code before it attaches.

### [C42] — `URL.revokeObjectURL()`
- **Relevant File(s):** `app/share/card-media-client.tsx`
- **Change Summary:** Row previews use object URLs that are revoked on remove, reset and unmount.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static
- **Verbatim Quote:**
  > "Call this method when you've finished using an object URL to let the browser know not to keep the reference to the file any longer."
- **Justification:** Up to 10 previews per card would otherwise pin large files in memory on older phones.

### [C43] — `<video>`: `preload` and `playsinline`
- **Relevant File(s):** `app/share/card-media-client.tsx`, `app/share/video-recorder-panel-client.tsx`
- **Change Summary:** Video rows render `<video controls playsInline preload="metadata">`, and the release 2 preview plays inline.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video#preload ; https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video#playsinline
- **Verbatim Quote:**
  > "`metadata`: Indicates that only video metadata (e.g., length) is fetched."
  >
  > "A Boolean attribute indicating that the video is to be played "inline", that is, within the element's playback area."
- **Justification:** Metadata-only preload avoids decoding several clips at once. `playsinline` keeps iPhone playback inside the row.

### [C44] — The `beforeunload` event: only while there are unsaved changes
- **Relevant File(s):** `app/share/share-form.tsx`
- **Change Summary:** The listener is attached only while a card holds unsent media and removed afterwards. It is a desktop safeguard.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event#usage_notes
- **Verbatim Quote:**
  > "We recommend that you listen for `beforeunload` only when users have unsaved changes, so that the confirmation dialog can warn them about impending data loss, and that you remove the listener when it's no longer needed."
  >
  > "The `beforeunload` event is not reliably fired, especially on mobile platforms."
- **Justification:** This matches the add-and-remove discipline. Phones rely on draft saves on `visibilitychange` (C45) because iOS Safari doesn't fire this event.

### [C45] — The `visibilitychange` event: the last reliable moment
- **Relevant File(s):** `app/share/use-share-draft.ts`, `app/share/card-media-client.tsx`
- **Change Summary:** The draft is saved when the page becomes hidden, and in the click handler that opens the phone camera.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event#usage_notes
- **Verbatim Quote:**
  > "This event fires with a visibilityState of hidden when a user navigates to a new page, switches tabs, closes the tab, minimizes or closes the browser, or, on mobile, switches from the browser to a different app. Transitioning to hidden is the last event that's reliably observable by the page, so developers should treat it as the likely end of the user's session (for example, for sending analytics data)."
- **Justification:** Opening the camera app switches away from the browser, and Android may then discard the tab. Saving at that moment keeps the typed words.

### [C46] — `aria-live="polite"`
- **Relevant File(s):** `app/share/share-form.tsx`, `app/share/memory-card-client.tsx`
- **Change Summary:** One polite line carries upload progress (per file and about every 25%) and "Memory 2 removed. You now have 2 memories."
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-live#choosing_the_aria-live_value
- **Verbatim Quote:**
  > "When `aria-live`'s attribute is set to `polite`, assistive technologies will notify users of updates but generally do not interrupt the current task, with the updates having a low priority."
- **Justification:** Progress and removal notices are low-urgency updates that must not interrupt typing.

### [C47] — WCAG 2.2 SC 4.1.3 Status Messages
- **Relevant File(s):** `app/share/share-form.tsx`, `app/share/memory-card-client.tsx`
- **Change Summary:** Status text is announced without moving focus, and only at file boundaries and about every 25%.
- **Source URL:** https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html#intent
- **Verbatim Quote:**
  > "In content implemented using markup languages, status messages can be programmatically determined through role or properties such that they can be presented to the user by assistive technologies without receiving focus."
  >
  > "However, there is a risk of making an application too "chatty" for a screen reader user."
- **Justification:** The upload status is a status message. The "chatty" warning is why it is not announced on every percent.

### [C48] — `tabindex="-1"` for programmatic focus
- **Relevant File(s):** `app/share/memory-card-client.tsx`, `app/share/thank-you-client.tsx`
- **Change Summary:** Card headings and the done-screen h1 take `tabIndex={-1}` so focus can move to them after add, open, remove and send.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/tabindex#try_it
- **Verbatim Quote:**
  > "`tabindex="-1"` may be useful for elements that should not be navigated to directly using the `Tab` key, but need to have keyboard focus set to them. Examples include an off-screen modal window that should be focused when it comes into view, or a form submission error message that should be immediately focused when an errant form is submitted."
- **Justification:** Headings aren't focusable by default. `-1` allows `focus()` without adding tab stops.

### [C49] — WCAG 2.2 SC 3.3.1 Error Identification
- **Relevant File(s):** `lib/memory-cards.ts`, `app/share/memory-card-client.tsx`
- **Change Summary:** `validateForSend` names the card and the problem in text, for the card error and the summary.
- **Source URL:** https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html#intent
- **Verbatim Quote:**
  > "If an input error is automatically detected, the item that is in error is identified and the error is described to the user in text."
- **Justification:** A message like "Memory 2 needs a recording, a file or a few words" identifies the item and describes the error in text.

### [C50] — `aria-invalid`
- **Relevant File(s):** `app/share/memory-card-client.tsx`, `app/share/share-form.tsx`
- **Change Summary:** Fields in error get `aria-invalid="true"` and `aria-describedby`, pointing at their message. The summary links move focus to them.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-invalid#description
- **Verbatim Quote:**
  > "If a value is determined to be invalid or out-of-range, set aria-invalid="true" and tell the user there is an error."
  >
  > "If you are creating your own form validation scripts, make sure to include aria-invalid on invalid form controls, along with styling (use the [aria-invalid="true"] attribute selector) and messaging (with aria-errormessage) to help users understand where the mistake is and how they can fix it."
- **Justification:** The form validates in script, so each invalid control must expose its state and its message.

### [C51] — `<progress>` needs an accessible label
- **Relevant File(s):** `app/share/card-media-client.tsx`
- **Change Summary:** Each row's progress is named, e.g. "Photo 2, Memory 1".
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/progress#accessibility
- **Verbatim Quote:**
  > "In most cases you should provide an accessible label when using <progress>. While you can use the standard ARIA labeling attributes aria-labelledby or aria-label as you would for any element with role="progressbar", when using <progress> you can alternatively use the <label> element."
- **Justification:** Without names, several bars on the page would be indistinguishable to screen readers.

### [C52] — `display: none` removes elements from the accessibility tree
- **Relevant File(s):** `app/share/share-form.tsx`, `app/share/memory-card-client.tsx`
- **Change Summary:** Placeholders and "+" are `narrow:hidden` on phones and are never announced there.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/display#display_none
- **Verbatim Quote:**
  > "Using a `display` value of `none` on an element will remove it from the accessibility tree. This will cause the element and all its descendant elements to no longer be announced by screen reading technology."
- **Justification:** Phone screen-reader users never hear about cards they can't use. Cards with content are never hidden. The MDN path moved under `/Reference/Properties/`.

### [C53] — Tailwind v4: `md` is 48rem; `max-*` variants
- **Relevant File(s):** `app/globals.css`, `app/share/page.tsx`, `app/share/share-form.tsx`
- **Change Summary:** The `wide` and `narrow` variants are built on the 48rem breakpoint.
- **Source URL:** https://tailwindcss.com/docs/responsive-design#overview ; https://tailwindcss.com/docs/responsive-design#targeting-a-breakpoint-range
- **Verbatim Quote:**
  > "| `md` | 48rem _(768px)_ | `@media (width >= 48rem) { ... }` |"
  >
  > "Tailwind generates a corresponding `max-*` variant for each breakpoint, so out of the box the following variants are available:"
- **Justification:** It confirms 768px = 48rem, the D1 threshold, and that complementary ranges exist. The custom variants (C54) add a height condition for landscape phones.

### [C54] — Tailwind v4: `@custom-variant`
- **Relevant File(s):** `app/globals.css`
- **Change Summary:** Defines `@custom-variant wide (@media (width >= 48rem) and (height >= 30rem))` and `@custom-variant narrow (@media (width < 48rem), (height < 30rem))`.
- **Source URL:** https://tailwindcss.com/docs/adding-custom-styles#adding-custom-variants
- **Verbatim Quote:**
  > "In addition to using the variants that ship with Tailwind, you can also add your own custom variants using the @custom-variant directive:"
- **Justification:** A width-only `md` would put landscape phones (e.g. 852×393) on the computer layout. The paired custom variants keep them on the phone layout, still in pure CSS (D1).

### [C55] — The `id` attribute must be unique
- **Relevant File(s):** `app/share/recorder-panel-client.tsx`
- **Change Summary:** `id` becomes a prop, so only card 1 carries `id="record"`.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/id#description
- **Verbatim Quote:**
  > "The **`id`** global attribute defines an identifier (ID) that must be unique within the entire document."
- **Justification:** The panel is reused per card. A hard-coded id would duplicate and break `/share#record`.

### [C56] — React `useId`
- **Relevant File(s):** `app/share/memory-card-client.tsx`
- **Change Summary:** Per-card label, error and heading ids come from `useId`.
- **Source URL:** https://react.dev/reference/react/useId#why-is-useid-better-than-an-incrementing-counter
- **Verbatim Quote:**
  > "useId is a React Hook for generating unique IDs that can be passed to accessibility attributes."
  >
  > "The primary benefit of useId is that React ensures that it works with server rendering."
- **Justification:** Several cards need distinct `aria-labelledby` and `aria-describedby` ids that match between server and client.

### [C57] — Web Share API `navigator.share()`
- **Relevant File(s):** `app/share/thank-you-client.tsx`
- **Change Summary:** The extracted done screen keeps the share button, called only from its click, with the mailto fallback.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#security
- **Verbatim Quote:**
  > "This method requires that the current document have the web-share Permissions Policy and transient activation. (It must be triggered off a UI event like a button click and cannot be launched at arbitrary points by a script.)"
- **Justification:** Moving the button into a new component must keep the call inside the click handler.

### [C58] — `localStorage` never expires
- **Relevant File(s):** `lib/share-draft.ts`, `app/share/use-share-draft.ts`
- **Change Summary:** The v2 draft stores `savedAt` and enforces its own 30-day TTL.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage#value
- **Verbatim Quote:**
  > "`localStorage` is similar to `sessionStorage`, except that while `localStorage` data has no expiration time, `sessionStorage` data gets cleared when the page session ends — that is, when the page is closed."
- **Justification:** The browser never expires the draft, so the code discards stale drafts itself.

### [C59] — WCAG 2.2 SC 3.3.2 Labels or Instructions
- **Relevant File(s):** `app/share/share-form.tsx`, `app/m/[claimToken]/claim-form.tsx`
- **Change Summary:** The visibility options use the D13 wording. The claim form explains that name and relationship are shared by the whole send.
- **Source URL:** https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html#intent
- **Verbatim Quote:**
  > "In the case of radio buttons, checkboxes, comboboxes, or similar controls that provide users with options, each option must have an appropriate label so that users know what they are actually selecting."
- **Justification:** "Richard, Rob and Tracy only" tells people what they are choosing. The shared-contributor note tells them what an edit will change.

### [C60] — WCAG 2.2 SC 2.4.6 Headings and Labels
- **Relevant File(s):** `app/share/memory-card-client.tsx`, `app/share/share-form.tsx`, `app/m/[claimToken]/claim-form.tsx`
- **Change Summary:** Stable "Memory N" headings and plainer option labels.
- **Source URL:** https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html#intent
- **Verbatim Quote:**
  > "Headings and labels describe topic or purpose."
  >
  > "Descriptive headings are especially helpful for users who have disabilities that make reading slow and for people with limited short-term memory."
- **Justification:** The audience is largely 70+. Clear, stable headings and labels help people with slow reading and limited short-term memory.

### [C61] — GitHub: draft pull requests cannot be merged
- **Relevant File(s):** `docs/plans/2026-11-03-share-redesign.md`, `docs/plans/phase1-ledger.md`
- **Change Summary:** Each slice ends in a draft PR carrying the parking lot. Nothing merges without the requester's go-ahead.
- **Source URL:** https://docs.github.com/en/pull-requests/reference/pull-requests#draft-pull-requests
- **Verbatim Quote:**
  > "Draft pull requests cannot be merged, and code owners are not automatically requested to review them."
- **Justification:** A platform guarantee backs the "ship only on go-ahead" rule from the orchestration loop. The old "About pull requests" URL redirects here.

### [C62] — `MediaRecorder.isTypeSupported()` (release 2)
- **Relevant File(s):** `app/share/recorder.ts`, `app/share/use-recorder.ts`
- **Change Summary:** The video profile probes `video/mp4` (H.264/AAC) first, then WebM VP9/VP8 with Opus, then `video/webm`.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static#return_value
- **Verbatim Quote:**
  > "A `Boolean`, `true` if the `MediaRecorder` implementation is capable of recording `Blob` objects for the specified MIME type. Recording may still fail if there are insufficient resources to support the recording and encoding process."
- **Justification:** Probing in order picks a format, and the existing `onerror` → finish path stays because a supported type can still fail. MDN doesn't state Safari's video container, so the device pass confirms it.

### [C63] — `MediaRecorder()` options (release 2)
- **Relevant File(s):** `app/share/recorder.ts`, `lib/recorder-state.ts`
- **Change Summary:** `videoBitsPerSecond` about 2 Mbps. Resolution and frame rate go in the constraints, and the size cap is enforced from the accumulated chunk bytes.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/MediaRecorder#options
- **Verbatim Quote:**
  > "If bits per second values are not specified for video and/or audio, the default adopted for video is 2.5Mbps or 10 Mbps, depending on the browser."
  >
  > "Video resolution, frame rate and similar settings are specified as constraints when calling `getUserMedia()`, not here in the MediaStream Recording API."
- **Justification:** At a 10 Mbps default, 20 minutes would be about 1.5 GB. Setting the rate and stopping at about 95% of 500 MB by measured size keeps clips uploadable.

### [C64] — `getUserMedia()`: constraints and errors (release 2)
- **Relevant File(s):** `app/share/recorder.ts`, `lib/recorder-state.ts`, `lib/recorder-help.ts`
- **Change Summary:** Request `{ audio, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } }`; add a `previewing` state; add camera help for each error.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#exceptions ; https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#using_getusermedia
- **Verbatim Quote:**
  > "An `ideal` value, when used, has gravity — which means that the browser will try to find the setting (and camera, if you have more than one), with the smallest fitness distance from the ideal values given."
  >
  > "`NotFoundError` `DOMException` — Thrown if no media tracks of the type specified were found that satisfy the given constraints."
  >
  > "`NotReadableError` `DOMException` — Thrown if, although the user granted permission to use the matching devices, a hardware error occurred at the operating system, browser, or Web page level which prevented access to the device."
- **Justification:** `ideal` values never fail on modest webcams. The help copy needs camera wording, including the case of a camera with no microphone, which raises `NotFoundError`.

### [C65] — `HTMLMediaElement.srcObject` (release 2)
- **Relevant File(s):** `app/share/video-recorder-panel-client.tsx`
- **Change Summary:** The live `MediaStream` is set on the preview through a ref effect and cleared on cancel and finish.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/srcObject#usage_notes
- **Verbatim Quote:**
  > "Older versions of the Media Source specification required using `URL.createObjectURL()` to create an object URL then setting `src` to that URL. Now you can just set `srcObject` to the `MediaStream` directly."
- **Justification:** `srcObject` is a DOM property, so React sets it imperatively. No object URL is needed for the live preview.

### [C66] — `MediaDeviceInfo.kind` (release 2)
- **Relevant File(s):** `lib/recording-devices.ts`
- **Change Summary:** A `videoInputsFor()` sibling filters `"videoinput"` from the same enumeration and is re-read after permission.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/MediaDeviceInfo/kind#value ; https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices#return_value
- **Verbatim Quote:**
  > "One of `"videoinput"`, `"audioinput"` or `"audiooutput"`."
  >
  > "Other than default devices, only devices for which permission has been granted are "available"."
- **Justification:** One enumeration lists both kinds. Camera labels appear only after `getUserMedia` resolves, so the list refreshes when the recorder enters `previewing`.

### [C67] — Autoplay is allowed for muted video (release 2)
- **Relevant File(s):** `app/share/video-recorder-panel-client.tsx`
- **Change Summary:** The preview is `<video muted autoPlay playsInline>`, with `play().catch()` after setting `srcObject`.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay#autoplay_availability
- **Verbatim Quote:**
  > "Autoplay blocking is _not_ applied to `<video>` elements when the source media does not have an audio track, or if the audio track is muted."
- **Justification:** The preview stream carries the microphone track. Muting it lets the preview autoplay and prevents feedback.

### [C68] — Chromium fake media devices for automated tests
- **Relevant File(s):** `scripts/recorder-smoke.mjs`
- **Change Summary:** The smoke script targets `#record` on card 1, and release 2 adds a video run with the existing fake-device flags.
- **Source URL:** https://webrtc.github.io/webrtc-org/testing/ ; https://webrtc.org/getting-started/testing#chrome
- **Verbatim Quote:**
  > "`--use-fake-ui-for-media-stream` avoids the need to grant camera/microphone permissions."
  >
  > "`--use-fake-device-for-media-stream` feeds a test pattern to `getUserMedia()` instead of live camera input."
- **Justification:** The flags the script already passes give headless Chromium a fake camera and microphone, so the video run needs no new tooling.

### [C69] — Next.js: `after()` runs work once the response is finished
- **Relevant File(s):** `features/memories/confirm.ts`, `features/memories/create-submission.ts`, `features/memories/ingest-upload.ts`
- **Change Summary:** `completeSubmission`, and a no-file `createSubmission`, schedule `notifyAdminsQuietly` for each memory with `after()`. `finalizeUpload` no longer alerts for submission memories (D18).
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/after (page introduction; the reference has no separate section for these sentences)
- **Verbatim Quote:**
  > "after allows you to schedule work to be executed after a response (or prerender) is finished."
  >
  > "It can be used in Server Components (including generateMetadata), Server Functions, Route Handlers, and Proxy."
  >
  > "after will run for the platform's default or configured max duration of your route."
- **Justification:** `completeSubmission` is a Server Function, so the docs allow `after()` there. Admin alerts then run once the person already has their links, and up to N alerts never delay the done screen. They run within the page's `maxDuration` [C6], following PR #26's `afterWithFlush` pattern for `createMemory` and `finalizeUpload`.
