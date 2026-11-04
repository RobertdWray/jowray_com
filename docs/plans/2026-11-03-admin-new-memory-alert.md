<!-- Repo copy of /Users/rob/.claude/plans/can-you-make-an-reactive-gadget.md (Rob's machine). This file is the cold-start runbook: keep § 0, § 2, § 8 and § 9 current. -->

# Admin alert email: "a new memory has landed"

Status: **approved for implementation (Rob, 2026-11-03 ~21:10 ET)** after the Oscar premortem; findings folded in as rulings R1–R13. Repo copy with the progress ledger: `docs/plans/2026-11-03-admin-new-memory-alert.md` on the branch (this file is the source until that copy exists; keep both in sync at each ledger update).

## 0. Cold-start contract (read first after a compact or handoff)

| Record | Value |
|---|---|
| Repository | `/Users/rob/Documents/active_work/jowray_com`, remote `origin https://github.com/RobertdWray/jowray_com.git`, default branch `main`. **Never edit there**: other agents share it. |
| Worktree / branch | `/Users/rob/Documents/active_work/jowray_wt_admin_alert`, branch `feat/admin-new-memory-alert`, cut from `origin/main` at the SHA recorded in the ledger (§ 9). Run every command from the worktree. `npm ci` there; copy `.env` and `.env.local` from the main checkout by hand (git-ignored, never committed, never printed). |
| Base already on main | PR #20 (confirmation email, cut point A, incl. review round `06c1a0b`), PR #21 (recorder feedback: `Media.durationSeconds` written at ticket time), PR #23 (mic picker hotfix). |
| In-flight overlap | None now: PR #22 `feat/claim-remove-replace` (issue 17 PR B: Media soft delete `deletedAt`, `replacesMediaId`, `sortOrder`, cron steps (f)/(f2)) merged as `1db03f6`, which is this branch's base. Media queries must carry `deletedAt: null` as #22 does. R13 is moot. |
| Database for this work | Neon branch `dev-admin-alert` = `br-cold-fire-bbsgvtlu` (child of `dev` `br-holy-rice-bbz4t50l`, project `icy-scene-20351172`), created 2026-11-03 22:01 UTC via the Neon connector; pooled host `ep-icy-feather-bbljh5t0-pooler.c-15.us-east-1.aws.neon.tech`, written only into the worktree's `.env.local` (`DATABASE_URL` + unpooled `DATABASE_URL_UNPOOLED`; `prisma.config.ts` loads `.env.local` over `.env`). Any `migrate dev` drift/reset prompt = **stop and report**, never reset. Delete the branch after merge. |
| Email in dev/preview | SendGrid from `memories@jowray.com`; `OUTBOUND_ENABLED=false` outside production; allowlist `robwray@gmail.com`. Real sends during verification go only to that address. Hotmail is verified after the production deploy. |
| Checks | `npm run validate` · `npm run test:run` · `npm run build:offline` (run the last one with `DATABASE_URL` unset and the `.env*` files temporarily moved aside, then restored). |
| Deploy order | `vercel.json`: `npx prisma migrate deploy && npx prisma db seed && npm run build`, so the enum value exists before the new client is built. Rob sets `ADMIN_ALERT_EMAILS` in Vercel (Production + Preview) **before** merge. |
| Evidence | `docs/plans/evidence/2026-11-admin-alert/` (synthetic renders only; inbox screenshots stay private, results recorded as text in § 9). |
| Recovery | An interrupted send: inspect `EmailLog` rows with `emailType = 'ADMIN_NEW_MEMORY'` and status `SENDING` before any replay; a stale SENDING row is reclaimed by the service after 15 min (duplicate possible, R5). Rollback: the enum value is additive and old code tolerates the rows, with one caveat (review finding, Oscar #1): the previous cron's step (e) used `emails: { none: {} }`, so a memory that has only an admin row and still owes a contributor confirmation would never be confirmed by that cron. Both rows are normally written in the same request or the same cron run, so the state is rare; if a rollback is ever needed, roll back to a build that keeps the type-specific `none` filter and the step (d) dispatch (any commit from `4ef66c6` on), or run the confirmation for such memories by hand. |

## 1. Context

Today only the contributor hears from the site when a memory is saved. Rob and the family inbox learn about new memories only by looking at the database. Rob wants an alert, to `robwray@gmail.com` and `rjwray@hotmail.com`, every time a new memory is posted, showing what landed. Content order (Rob): **Who, Date, Memory, Media, other details.** No link of any kind: "the admins shouldn't edit memories through this email notification; the edit links are for users only."

The admin email reuses PR #20's template chrome, media cards and inline CID assets, and the same send/claim machinery, so when issue #17 PR A fills `MemoryMediaSummary.preview` with thumbnails both emails get them.

## 2. Rulings (locked unless Rob reopens)

| ID | Ruling | Source |
|---|---|---|
| R1 | Content order Who, Date, Memory, Media, other details. Contributor email shown as plain text. Flags shown: can be contacted, wants to hear when posted, mailing list. | Rob; flags my call |
| R2 | **No authored links**: no `href` anywhere, no `src` from the network, no claim token or `/m/` path. Contributor prose and filenames are kept verbatim even when they contain a URL; mail-client auto-linking of prose is accepted. | Rob ("no links"); Oscar 4 |
| R3 | One message to both admins via a `to` array (recipients see each other); one `EmailLog` row per memory, type `ADMIN_NEW_MEMORY`; `recipientEmail` stores the **attempted** recipients joined with `", "`. SENT means SendGrid accepted the message for that set, not per-recipient delivery. | Oscar 8 |
| R4 | No per-recipient daily cap for admin alerts; the cap count is restricted to `MEMORY_CONFIRMATION` rows. | design |
| R5 | Delivery guarantee: the claim prevents concurrent sends; a crash between SendGrid's 202 and the SENT write can duplicate the alert after 15 min. Accepted, same as the confirmation (ledger). Rendering happens **before** the claim so a render error can never strand a SENDING row. | Oscar 5 |
| R6 | Activation boundary: cron backfill only considers memories with `createdAt >= ADMIN_ALERT_SINCE` (constant, set to the merge day). No historical backfill. | Oscar 1 |
| R7 | Empty `ADMIN_ALERT_EMAILS` → **no row written**, result `no_recipients`; the cron alerts the memory once the env is set (bounded by R6 and the 50-row batch). The outbound-guard skip stays a terminal SKIPPED row, as for the confirmation. | Oscar 2 |
| R8 | Cron step (e2) skips a memory that still has a live PENDING file younger than one hour; the request path alerts when the file is READY. The email states "n file(s) still uploading or did not arrive" when non-READY files exist. | Oscar 3 |
| R9 | Transport request timeout 10 s (`sgMail.setTimeout`), three attempts as today: worst case ≈ 33 s, inside the cron's 50 s step budget and the page's 120 s. | Oscar 6 |
| R10 | Test doubles honour `(memoryId, emailType)` everywhere; both types on the same memory are tested in both orders and concurrently. | Oscar 7 |
| R11 | Dedicated Neon branch for migrations and manual runs; cron replay only on synthetic rows. `npx prisma generate` runs right after `migrate dev` (Prisma 7 no longer does it). | Oscar 9, 10 |
| R12 | Submitted time in `America/New_York` (template constant), component `Intl` options with a zone abbreviation. | my call |
| R13 | Start from `main` now; rebase on PR #22 when it merges (see § 0). | Rob: "get the work done" |

## 3. The email

- **Subject:** `New memory from {name}` or `New memory`. Name through `stripControl`, capped at 60.
- **Preheader (hidden):** `{relationship or "No relationship given"} · {first 90 chars of the note or "No written note"}`.
- **Header:** heart + "Jo Wray". **H1:** "A new memory landed." **Lead:** "Submitted Tue, Nov 3, 2026, 2:38 PM EST." (R12 `[C7]`).
- **Card "Who":** Name · How they knew Jo · Email (plain text) · Can be contacted: Yes/No · Wants to hear when it's posted: Yes/No · Mailing list: Yes/No. Missing values: "Not given".
- **Card "Date":** Submitted · When, as they wrote it (`approxDateText`) · Where (`place`).
- **Card "Memory":** full note (`cleanNote`, `<br>`, pre-wrap) or "No written note." in walnut-soft italics.
- **Card "Media":** READY files in upload order, the confirmation's cards (preview image or badge + "Voice recording · 2:14"), **no anchor, no "Tap to…" line**; "{n} files" above when n > 1; "{k} file(s) still uploading or did not arrive" when non-READY, non-removed files exist (R8); "No files." for a text memory; previews capped at 4 as in the confirmation.
- **Other details:** Visibility ("Everyone who visits the memorial" / "Family only" / "Private"), Memory id in 13 px monospace.
- **Footer:** stitched heart; "Admin alert from jowray.com. This email carries no links on purpose: the edit link belongs to the contributor."
- **Text part** mirrors every section; no claim link.
- **Security:** `escapeHtml` on every field (alt included); `stripControl` + the confirmation's caps on single-line fields; `cleanNote` on the note; attachment filenames match the transport's `^[A-Za-z0-9._-]+$`; content ids from server ids; no `href`, no network `src` (R2).

## 4. Mechanics

- **Trigger:** TEXT memory on save (`createMemory`); file memory when READY (`finalizeUpload`); both post-response via `afterWithFlush` `[C1]`; cron retries failures and backfills (R6, R8). Readiness rule = `confirmMemory`'s (TEXT, or READY file, or words), with R8's pending guard in the cron only.
- **No contributor email required.**
- **Service:** `deliver()` shared by both email types (R3–R5); `sendAdminNewMemory` reads recipients from `getAdminAlertEnv()` `[C6]`, filters by the outbound guard, sends to the allowed subset, records the attempted set.
- **Logs:** ids, email type and counts only (logger already redacts note, name, email, relationship, place, date, filename, claim link).

## 5. Files

### Reused (not rebuilt)
`services/email/types.ts` (`MemoryMediaSummary`, `EmailAttachment`, `OutboundEmail`, `SendResult`); `templates/memory-confirmation.ts` helpers (`escapeHtml`, `stripControl`, `cleanNote`, `formatSeconds`, `usablePreview`, reserved-id checks, cards, detail rows, shell); `lib/email-assets`; `integrations/sendgrid` (attachments, `assertAttachmentContract`, tracking off); `scripts/render-email-preview.ts`, `scripts/send-test-email.ts`, `scripts/sample-confirmation.ts`.

### New and changed
1. **`prisma/schema.prisma` + `prisma/migrations/<ts>_email_type_admin_new_memory/`** `[C2, C3]`: `enum EmailType { MEMORY_CONFIRMATION ADMIN_NEW_MEMORY }`; comment on `EmailLog.recipientEmail` (R3). `npm run db:migrate -- --name email_type_admin_new_memory` on the `dev-admin-alert` branch, then `npx prisma generate` (R11).
2. **`server/config/env.ts`** `[C6]`: `adminAlertSchema = z.object({ ADMIN_ALERT_EMAILS: csvList.pipe(z.array(z.email())).default([]) })`, `getAdminAlertEnv`, `AdminAlertEnv`. **`docs/environment.md`** row.
3. **`integrations/sendgrid/client.ts`** (R9): `sgMail.setTimeout(REQUEST_TIMEOUT_MS)` once, beside `setApiKey`.
4. **`services/email/types.ts`**: `OutboundEmail.to: string | string[]`; `MemoryVisibility`; `AdminNewMemoryContent { memoryId; submittedAt: Date; name?; relationship?; email?; contactOptIn; mailingListOptIn; notifyWhenPosted; approxDateText?; place?; note?; visibility; media: MemoryMediaSummary[]; filesNotReady: number }`; `SkipReason` gains `"no_recipients"`.
5. **`services/email/templates/shared.ts`** (new, pure, relative imports): tokens, fonts, `escapeHtml`, `stripControl`, `cleanNote`, `cleanOptional`, `formatSeconds`, `NOUN`, `usablePreview`, `buildMediaCards`, `renderCardHtml(card, link: string | null)` (no anchor and no tap line when null), `renderCardText`, `detailRow`, `assetImg`, `assetAttachment`, `badgeFor`, `renderDocument({ title, preheader, body })`, `brandAttachments(badges)`. `memory-confirmation.ts` consumes it and keeps every current export; PR #20's template tests stay unchanged.
6. **`services/email/templates/admin-new-memory.ts`** (new) `[C7]`: `ADMIN_TIME_ZONE`, `adminNewMemorySubject`, `buildAdminNewMemory(content)`.
7. **`services/email/index.ts`** `[C4, C8]`: `deliver({ memoryId, emailType, recipients, enforceCap, rendered, rotateToClaimTokenHash?, label })` — render first (R5), guard per recipient, cap only when `enforceCap` and only against `MEMORY_CONFIRMATION` rows (R4), claim, send, record. `sendMemoryConfirmation` = `deliver` with `[to]`; `sendAdminNewMemory(content)`: recipients from env; empty → `{ sent: false, skipped: "no_recipients" }` with **no row** (R7); none allowed → terminal `outbound_disabled`; otherwise send to the allowed subset and store it (R3).
8. **`features/memories/media-summary.ts`** (new): `summarizeReadyMedia(rows)` using `memoryTypeFor`; `confirm.ts` switches to it.
9. **`features/memories/notify-admins.ts`** (new) `[C8]`: `notifyAdminsOfMemory({ memoryId })` → `SendResult | { sent: false; skipped: "not_found" | "deleted" | "not_ready" }`; loads contributor + flags + media; counts `filesNotReady` = PENDING or FAILED rows (after #22: non-removed); never touches the claim token.
10. **`features/memories/ingest-upload.ts`** `[C1]`: `notifyAdminsQuietly(memoryId)`; in `finalizeUpload`'s READY branch `afterWithFlush(() => notifyAdminsQuietly(memory.id))` before the checksum `after`.
11. **`features/memories/create-memory.ts`** `[C1]`: TEXT memory → `afterWithFlush(() => notifyAdminsQuietly(created.memoryId))` after `confirmQuietly`.
12. **`app/api/cron/reconcile-uploads/route.ts`** `[C9]`: `ADMIN_ALERT_SINCE` (R6); step (d) dispatches on `row.emailType`; step (e) narrows to `emails: { none: { emailType: "MEMORY_CONFIRMATION" } }`; step (e2) `adminAlertsSent`: `createdAt >= ADMIN_ALERT_SINCE` and `< now − 30 min`, not deleted, ready/TEXT/words, `emails: { none: { emailType: "ADMIN_NEW_MEMORY" } }`, `NOT: { media: { some: { status: "PENDING", createdAt: { gt: now − 1 h } } } }` (R8), no contributor-email condition, `take: 50`.
13. **Scripts:** `scripts/sample-admin-alert.ts`; `render-email-preview.ts [out.html] [confirmation|admin]`; `send-test-email.ts <address> [confirmation|admin]`.
14. **Docs:** `docs/plans/2026-11-03-admin-new-memory-alert.md` (this runbook + ledger); `docs/plans/phase1-ledger.md` "Task 13 — Admin alert"; `design/DESIGN.md` § 11 one line; `docs/code-layout.md` + `AGENTS.md` copy (`templates/shared.ts`); `docs/environment.md`.

## 6. Tests (first; `vi.mock` through `@` `[C10]`; doubles honour `(memoryId, emailType)` per R10)

- `__tests__/services/admin-template.test.ts`: subject variants, stripped, capped; escaping incl. alt; note paragraphs; "No written note."; flags; visibility labels; memory id; `Nov 3, 2026` + `EST`/`EDT` for fixed instants `[C7]`; cards without `<a>` or tap line; previews ≤ 4 then badges; "n files"; "k file(s) still uploading or did not arrive"; `cid:` ↔ attachments one-to-one; **no `href=`, no `src="http`, no `mailto:`**, no `/m/<token>` while a note containing `https://example.com/m/x` and a filename `http.jpg` survive verbatim (R2); text part has no claim link; attachment filenames match the transport regex; < 100 KB with a 10,000-char note and 10 files.
- `__tests__/services/email-template.test.ts` (PR #20): unchanged, green after the lift.
- `__tests__/services/email.test.ts`: doubles keyed by `(memoryId, emailType)`; existing confirmation tests green; `sendAdminNewMemory`: array `to`, row `recipientEmail` = attempted set; fourth memory in a day still sends; env empty → `no_recipients` and **no row**; one allowlisted admin → sent to that one, row records that one; none → `outbound_disabled` terminal; `already_sent`; concurrent → one send; FAILED + `nextAttemptAt`; a render error leaves no SENDING row (R5); both types on one memory in both orders and concurrently, one failing never changes the other; admin send never calls `memory.update`.
- `__tests__/features/notify-admins.test.ts`: content built from the row incl. `filesNotReady`; no contributor email still sends; `not_found` / `deleted` / `not_ready`; skip pass-through; no claim-token read or mint.
- `__tests__/features/confirm.test.ts`: unchanged after the helper switch.
- `__tests__/features/create-memory.test.ts` (mock `@/lib/sentry/after-flush`): TEXT → after-callback alerts once; file → not here.
- `__tests__/features/ingest-upload.test.ts`: READY → admin after-callback before checksum; PENDING/FAILED → none; a throwing alert never changes the finalize result.
- `__tests__/api/reconcile.test.ts`: `EmailRow.emailType`; `matches` understands `emails.none.emailType` and `NOT`/`media.some` with dates; (d) dispatch; (e) still confirms a memory with only an admin row; (e2) alerts a 31-min-old ready memory without contributor email, skips 10-min-old, skips pre-`ADMIN_ALERT_SINCE` (R6), skips one with a 20-min-old PENDING file and alerts once that file is READY or FAILED (R8); second run no-op; counts.
- `__tests__/lib/env.test.ts`: unset → `[]`; mixed-case/spaces → normalised; invalid → throws `Invalid environment (adminAlert)` `[C6]`.
- `__tests__/services/email.test.ts` transport: `setTimeout` applied once (R9).

## 7. Implementation order (TDD; commit per step; ledger row per step)

0. Worktree + branch from `origin/main`; `npm ci`; env copies; Neon branch `dev-admin-alert` + env override (R11). Record SHAs/ids in § 9.
1. Schema enum + migration + `prisma generate` `[C2, C3]`; env sub-schema + docs row `[C6]`.
2. Types; transport `to` array + timeout `[C4]` (R9).
3. `templates/shared.ts` lift; confirmation on top; PR #20 tests green.
4. `templates/admin-new-memory.ts` + tests `[C7]`.
5. `deliver()` extraction (render-first), `sendAdminNewMemory` + tests `[C4, C8]`.
6. `media-summary.ts`, `notify-admins.ts` + tests; `confirm.ts` switch.
7. Call sites + tests `[C1]`.
8. Cron (d)/(e)/(e2) + tests `[C9]`.
9. Scripts; renders at 390/1280 px → evidence folder.
10. Docs, ledger, PR body (behaviour, validation, non-goals § 8, follow-ups § 8). Rebase on #22 if merged. Team Code Review on request.

## 8. Non-goals and follow-ups

### 8.1 Non-goals (decided, with the reason; do not re-propose)

- Exactly-once external delivery / reconciliation against SendGrid (premortem Oscar 5): a duplicate admin alert in the rare window between SendGrid's 202 and the SENT write (reclaimed after 15 min) is cheaper than a reconciliation subsystem; the Phase 1 ledger already accepts the same residual for the contributor confirmation. Ruling R5.
- Historical backfill of alerts for memories that existed before this feature (Oscar 1): existing memories are already known to the family; the `ADMIN_ALERT_SINCE` cutoff makes "never alerted" and "new" deliberately distinct. Ruling R6.
- Cron fairness rework / remaining-budget accounting between confirmation and admin steps (Oscar 6): the existing deadline-check-between-operations pattern plus the new 10 s transport timeout (R9) bounds every step at launch volume; revisit only if the cron ever reports `errors` from timeouts.
- A Postgres integration test for the `(memoryId, emailType)` compound key and relation filters (Oscar 7): CI has no database; the unique constraint already exists in production, the enum change is additive, and the precedent migration `20261103031114_email_status_sending_skipped` proves the shape. Unit doubles honour the compound key instead (R10).
- Per-recipient `EmailLog` rows or a changed unique key: one row per memory per type keeps idempotency and the cron's retry logic unchanged; the attempted recipient set is recorded in `recipientEmail` (R3).
- `mailto:` on the contributor's address, or any link in the admin email: Rob's ruling "no links; the edit links are for users only" (R2).
- Hardcoding the two admin addresses: recipients come from `ADMIN_ALERT_EMAILS` per the AGENTS.md env rules.

### 8.2 Follow-ups (real, out of scope; add to the PR body; file as issues after merge at https://github.com/RobertdWray/jowray_com/issues)

- F15 Per-recipient delivery state (Oscar 8). Severity: low until a bounce is seen. Symptom: Gmail accepts, Hotmail rejects, row still says SENT. Pick-up: SendGrid Event Webhook → a per-recipient delivery table keyed by `sendgridMessageId` + address; surface bounces in the cron summary. First check: both inboxes after the first production alert.
- F13 Alert on later edits or files added from the claim page (Oscar 3). Severity: low. Today one alert per memory, like the confirmation; a second alert type or an "updated" flag on the existing row would be needed. Pick-up: `app/m/[claimToken]/actions.ts` and `features/memories/claim.ts` are the edit paths.
- F14 Daily digest instead of one email per memory if volume grows. Severity: low. Pick-up: a cron step that groups `ADMIN_NEW_MEMORY` rows by day; the no-cap ruling (R4) is deliberate for launch volume.
- F16 Hotmail/Outlook.com rendering and deliverability check of the admin template after the production deploy (needs `OUTBOUND_ENABLED=true` or a preview allowlist entry for `rjwray@hotmail.com`). Severity: medium (one of the two admin inboxes). Record the result in the ledger § 9.

## 9. Progress ledger

| Step | Status | Commit | Verification / notes |
|---|---|---|---|
| 0 | done 2026-11-03 22:02 UTC | — | worktree `/Users/rob/Documents/active_work/jowray_wt_admin_alert`, branch `feat/admin-new-memory-alert`, base `1db03f6` (main incl. PR #22); Neon `dev-admin-alert` = `br-cold-fire-bbsgvtlu`; baseline `test:run` 667/667; Oscar premortem folded in (R1–R12) |
| 1 | done | (see git log: "ADMIN_NEW_MEMORY email type and ADMIN_ALERT_EMAILS env") | migration `20261103220303_email_type_admin_new_memory` applied on the Neon branch (plus the two pending ones from main, no drift); `prisma generate` run; `env.test.ts` 15/15; `validate` clean |
| 2 | done | `6c301dd` | `OutboundEmail.to` array, `AdminNewMemoryContent`, 10 s SendGrid timeout; `email.test.ts` 23/23 |
| 3 | done | `8aa13b1` | `templates/shared.ts` lift; confirmation render byte-identical (diffed against a throwaway worktree of the previous commit) |
| 4 | done | `a044ffb` | `admin-new-memory.ts`; `admin-template.test.ts` 16/16 |
| 5 | done | `cd516b9` | `deliver()` + `sendAdminNewMemory`; doubles keyed by `(memoryId, emailType)`; `email.test.ts` 36/36 |
| 6 | done | `ebc3811` | `media-summary.ts`, `notify-admins.ts` (+ `ADMIN_ALERT_SINCE` added in step 8); `notify-admins.test.ts` 7/7; confirm tests unchanged |
| 7 | done | `63eebe5` | `notifyAdminsQuietly` in `afterWithFlush` from both call sites; 40/40 in the two feature test files |
| 8 | done | `4ef66c6` | cron (d)/(e)/(e2); `reconcile.test.ts` 6/6; whole suite 712/712 |
| 9 | done | `2f1bfeb`, `62c4c62` | sample + script switch; renders at 390/1280 px in `docs/plans/evidence/2026-11-admin-alert/`; **first real send exposed the `contentId` bug (SendGrid 400), fixed in `62c4c62`**; both samples then accepted (202) and received in Gmail with 5 inline attachments |
| 9b | done | — | end to end on Neon `dev-admin-alert` with `npm run dev`: synthetic TEXT memory without contributor email + FAILED admin row → cron step (d) retried through the admin path, outbound guard dropped the hotmail address, row SENT with `recipientEmail = robwray@gmail.com`, "New memory from Synthetic Tester" received; second run all zeros; (e)/(e2) Prisma filters executed without error |
| 10 | done | (docs commit) | `build:offline` exit 0 with no `.env*` and `DATABASE_URL` unset, 0 blocked hosts; `validate` clean; `test:run` 712/712; runbook copied to `docs/plans/2026-11-03-admin-new-memory-alert.md`; ledger Task 13; DESIGN § 11, code-layout, AGENTS, environment docs; PR opened (see git log) |

Rulings made while building:
- Ruling: the transport sends `content_id`, not `contentId` — `@sendgrid/mail` 8.1.6 stores attachment objects as given and does not snake-case them (verified by `Mail.create(...).toJSON()`), and the API answered 400 to every message with an inline image; PR #20's transport test had pinned the wrong key. Cost if wrong: none (the API field name is documented); the fix also unblocks the already-merged confirmation email.
- Ruling: `ADMIN_ALERT_SINCE = 2026-11-04T00:00:00Z` (7 PM ET on Nov 3). If the PR merges before then, memories submitted in between are still alerted by the request path; only the cron backfill is bounded. Cost if wrong: an alert for a memory the family already knew about, or none for one submitted in that window and left to the cron.
- Ruling: a memory whose contributor confirmation was SKIPPED (not allowlisted, capped) is still alerted to the admins; the two emails are independent. Cost if wrong: none observed.
- Ruling: the transport always passes `to` as an array (the attempted set), for both email types. Cost if wrong: none; SendGrid accepts a one-element array.

## 10. Verification

- `npm run validate`, `npm run test:run`, `npm run build:offline` clean in the worktree (env files moved aside for the build).
- Renders of both templates at 390 px and 1280 px in Chrome: no link cursor anywhere in the admin email, badge and preview cards, "k file(s) still uploading" line on the sample.
- `npx tsx --env-file=.env scripts/send-test-email.ts robwray@gmail.com admin`: Gmail web + iOS, Apple Mail; `Authentication-Results` dkim/spf/dmarc pass; no remote loads; subject correct. Hotmail checked after the production deploy (R3 / follow-up).
- Local end to end on `dev-admin-alert` (`npm run dev`): text memory → confirmation + admin alert; photo → alert after finalize; memory without contributor email → alert; fourth memory in a day → alert. `select "emailType", status, "recipientEmail" from "EmailLog" order by "createdAt" desc limit 5`.
- Cron on synthetic rows only: insert a 31-min-old ready memory (no admin row) → `adminAlertsSent: 1`; run again → 0; a pre-cutoff memory never alerts.
- Rob sets `ADMIN_ALERT_EMAILS` in Vercel before merge; preview submission alerts `robwray@gmail.com` only; production both.

## Citations

All quotes fetched live on 2026-11-03 (firecrawl, `maxAge: 0`). Repo files (AGENTS.md, docs/code-layout.md) count as primary sources per Rob's rule.

### [C1] — `maxDuration` on the page governs its Server Actions
- **Relevant File(s):** `features/memories/ingest-upload.ts`, `features/memories/create-memory.ts`
- **Change Summary:** The admin alert runs in `afterWithFlush` from Server Functions hosted by `app/share/page.tsx` (`maxDuration = 120`).
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/maxDuration
- **Verbatim Quote:**
  > "The maxDuration option allows you to set the maximum execution time (in seconds) for server-side logic in a route segment." … "If using Server Actions, set the maxDuration at the page level to change the default timeout of all Server Actions used on the page."
- **Justification:** The post-response alert inherits the page's 120 s like the checksum `after()`; with R9's 10 s transport timeout × 3 attempts the worst case is bounded well inside it.

### [C2] — Prisma 7 migration workflow, and `migrate dev` no longer generates the client
- **Relevant File(s):** `prisma/schema.prisma`, `prisma/migrations/<ts>_email_type_admin_new_memory/migration.sql`
- **Change Summary:** Generate the enum migration in development, run `prisma generate` explicitly, apply with `migrate deploy` in production (`vercel.json`).
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production and https://www.prisma.io/docs/cli/v7/migrate/dev
- **Verbatim Quote:**
  > "In a development environment, use the `migrate dev` command to generate and apply migrations" … "If it detects changes to the Prisma schema, it generates a new migration from these changes" … "In production and testing environments, use the `migrate deploy` command to apply migrations" … and from the CLI reference: "Prisma v7: migrate dev no longer automatically triggers prisma generate or seed scripts. Run them explicitly if needed."
- **Justification:** Installed Prisma is 7.10.1; the explicit `prisma generate` step (R11) is required for `tsc` to see `ADMIN_NEW_MEMORY`; `migrate deploy` precedes `next build` in `vercel.json`.

### [C3] — PostgreSQL `ALTER TYPE … ADD VALUE` inside a transaction
- **Relevant File(s):** the migration SQL
- **Change Summary:** The migration adds the value and nothing else.
- **Source URL:** https://www.postgresql.org/docs/current/sql-altertype.html
- **Verbatim Quote:**
  > "ADD VALUE (the form that adds a new value to an enum type) is executed inside a transaction block, the new value cannot be used until after the transaction has been committed."
- **Justification:** No statement in the same migration may use `ADMIN_NEW_MEMORY`; the precedent migration `20261103031114_email_status_sending_skipped` has the same shape.

### [C4] — `@sendgrid/mail`: one email to several recipients via a `to` array
- **Relevant File(s):** `services/email/types.ts`, `integrations/sendgrid/index.ts`, `services/email/index.ts`, `__tests__/services/email.test.ts`
- **Change Summary:** `OutboundEmail.to` becomes `string | string[]`; the admin alert is one message to both admins (R3).
- **Source URL:** https://github.com/sendgrid/sendgrid-nodejs/blob/main/docs/use-cases/single-email-multiple-recipients.md
- **Verbatim Quote:**
  > "The `to` field can contain an array of recipients, which will send a single email with all of the recipients in the `to` field. The recipients will be able to see each other" … "If you want to send multiple _individual_ emails to multiple recipient where they don't see each other's email addresses, use `sendMultiple` instead"
- **Justification:** One `send()` with an array matches the one-row-per-memory design; both admins are family, so mutual visibility is accepted and `sendMultiple` is not used.

### [C5] — SendGrid personalizations: recipients and limits
- **Relevant File(s):** `integrations/sendgrid/index.ts`
- **Change Summary:** A single personalization carries both recipients.
- **Source URL:** https://www.twilio.com/docs/sendgrid/for-developers/sending-email/personalizations
- **Verbatim Quote:**
  > "If you want to send one email message to multiple recipients, you can customize the message sent to each recipient using Personalizations." … "| to | Required | One or more intended addressed recipients displayed in your message. |" … "Each API request has a limit of 1,000 personalization objects." … "All recipients can see all other recipients to the email."
- **Justification:** Backs one message with a two-entry `to`; limits are far above two admins.

### [C6] — Zod: `.pipe()`, `.transform()`, `z.email()`, `.default()`
- **Relevant File(s):** `server/config/env.ts`, `__tests__/lib/env.test.ts`
- **Change Summary:** `ADMIN_ALERT_EMAILS: csvList.pipe(z.array(z.email())).default([])`.
- **Source URL:** https://zod.dev/api
- **Verbatim Quote:**
  > "Schemas can be chained together into \"pipes\". Pipes are primarily useful when used in conjunction with Transforms." … "Piping some schema into a transform is a common pattern, so Zod provides a convenience `.transform()` method." … "To validate email addresses:" "`z.email();`" "By default, Zod uses a comparatively strict email regex designed to validate normal email addresses containing common characters. It's roughly equivalent to the rules enforced by Gmail." … "A value schema that can stand in for an absent key — `.default()`, `.prefault()`, `.optional()` — makes that key optional on the input side"
- **Justification:** `csvList` is a `z.string().transform(...)`; piping into `z.array(z.email())` validates the transformed output; `.default([])` keeps the accessor safe when unset.

### [C7] — `Intl.DateTimeFormat` `timeZone` and style options
- **Relevant File(s):** `services/email/templates/admin-new-memory.ts`, `__tests__/services/admin-template.test.ts`
- **Change Summary:** Component options with `timeZoneName: "short"` in `America/New_York` (R12).
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat
- **Verbatim Quote:**
  > "The time zone to use. Can be any IANA time zone name, including named identifiers such as \"UTC\", \"America/New_York\", and \"Etc/GMT+8\" … The default is the runtime's time zone" … "Note: dateStyle and timeStyle can be used with each other, but not with other date-time component options (e.g., weekday, hour, month, etc.)."
- **Justification:** Vercel functions run in UTC, so the zone is explicit; the note is why component options are used (to show a zone abbreviation). Verified on Node 22: `Tue, Nov 3, 2026, 2:38 PM EST`.

### [C8] — Prisma compound unique key in `findUnique`
- **Relevant File(s):** `services/email/index.ts`, `features/memories/notify-admins.ts`
- **Change Summary:** The admin row is keyed by `{ memoryId_emailType: { memoryId, emailType: "ADMIN_NEW_MEMORY" } }`.
- **Source URL:** https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference#findunique
- **Verbatim Quote:**
  > "Get the `User` record with `firstName` of `Alice` and `lastName` of `Smith` (`@@unique`)" … "`fullname: {` `// name property of @@unique attribute - default is firstname_lastname` `firstName: \"Alice\",` `lastName: \"Smith\",` `},`"
- **Justification:** `EmailLog` declares `@@unique([memoryId, emailType])` without a name, so the key is `memoryId_emailType`; a second enum value yields one row per memory per type with no further schema change. (The constraint gives one row, not one external send: R5.)

### [C9] — Prisma relation filters `none` and `some`
- **Relevant File(s):** `app/api/cron/reconcile-uploads/route.ts`, `__tests__/api/reconcile.test.ts`
- **Change Summary:** Steps (e)/(e2) filter `none` by `emailType`; (e2) uses `NOT … media.some` for the pending guard (R8).
- **Source URL:** https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference#none
- **Verbatim Quote:**
  > "### `none`" "Returns all records where **zero** *related* records match filtering criteria." … "You can use `none` without parameters to return all records with no relations" … "### `some`" "Returns all records where **one or more** (\"some\") *related* records match filtering criteria."
- **Justification:** Today's `emails: { none: {} }` means "no email rows at all"; with admin rows it would exclude memories still owed a confirmation.

### [C10] — Vitest `vi.mock` is hoisted and alias-aware
- **Relevant File(s):** every new or extended test under `__tests__/`
- **Change Summary:** Stub db, email service, notify feature, after-flush and `@sendgrid/mail` per file.
- **Source URL:** https://vitest.dev/api/vi.html#vi-mock
- **Verbatim Quote:**
  > "Substitutes all imported modules from provided path with another module. You can use configured Vite aliases inside a path. The call to vi.mock is hoisted, so it doesn't matter where you call it. It will always be executed before all imports."
- **Justification:** The `@` alias is defined in `vitest.config.ts`; mocking through it isolates Neon, Blob and SendGrid as the suite already does.
