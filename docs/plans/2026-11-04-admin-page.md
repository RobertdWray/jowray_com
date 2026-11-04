# Family admin page: list, edit, approve, hide, delete, restore and draft memories

Status: **hypothesis ready to test** (not "approved"). Revision 4, 2026-11-04, reviewed against `origin/main` @ `6210009` (PR #30 merged 2026-11-04 14:49 UTC). Rob's decisions are in §1; everything marked **(my call)** is mine and can be vetoed. §9 records the three review rounds and what was done with each point.

## 0. Cold start (read this first if you are a resumed or new agent)

- **Repo:** `/Users/rob/Documents/active_work/jowray_com`, remote `origin` = `https://github.com/RobertdWray/jowray_com.git`. The main checkout is shared by several agents and is often behind; **never build there.** Run `git fetch origin` and confirm `origin/main` is at or after `6210009` (`git merge-base --is-ancestor 6210009 origin/main`). If `origin/main` moved past the reviewed SHA, re-check §13's repo citations before trusting them.
- **Worktree:** `git worktree add ../jowray_wt_admin_page -b feat/admin-page origin/main` (or `cd ../jowray_wt_admin_page` if it exists; `git status` and `git log --oneline -5` first). Branch `feat/admin-page`, PR against `main`. PR #30 is **merged**; nothing here depends on an open PR.
- **Do not touch** the untracked `docs/memory-drafter.md` in the main checkout (Rob's; not part of this work). Do not commit `.env*`.
- **Read before writing code:** `AGENTS.md` (layering, Cache Components rule, no `eslint-disable`, no band-aids, env sub-schemas, Pino only), `docs/code-layout.md`, `docs/environment.md`, `docs/plans/2026-11-03-draft-memory-on-behalf.md` §1 and §8.2 (PR #30's rulings, especially R6: a DRAFT's preferences are given only by Share), and the installed Next docs under `node_modules/next/dist/docs/01-app/` for `connection`, `cookies`, `use-server`, `server-actions`, `route-segment-config/prefetch`, `next-config-js/headers`.
- **Canonical plan:** once the branch exists, copy this file to `docs/plans/2026-11-04-admin-page.md` (first commit) and keep that copy current; this home-directory file is then an archive. The ledger in §2 is the source of truth for progress; update it as you go.
- **Pattern files to copy from:** `app/m/[claimToken]/page.tsx` (shell + Suspense + `connection()`), `app/m/[claimToken]/claim-form.tsx` (client form shape), `app/m/[claimToken]/actions.ts` (thin Server Functions), `app/api/admin/_auth.ts` (testable `NextResponse` handlers), `features/memories/claim.ts` (lock → re-read → decide → write → revision), `__tests__/features/claim.test.ts` (in-memory Prisma stub), `__tests__/api/admin-memories.test.ts` (route test + env reset).
- **Checks that must pass with no `.env*` in the worktree:** `npm run validate`, `npm run test:run`, `npm run build:offline`.

## 1. Decisions already made (Rob, 2026-11-04). Do not re-ask.

| # | Decision |
|---|---|
| D1 | **Entry link sets a cookie.** The family opens one link once; the server verifies the secret, sets an httpOnly cookie (30 days) and lands on a clean `/admin`. The secret is never in a page URL after that. Rotating the secret logs everyone out. **Amendment (my call, review round 2):** the link carries the key in the URL fragment, `https://www.jowray.com/admin/enter#key=<secret>`, not the query string, because a query string is written to Next's and Vercel's request logs and a fragment is never sent to any server (§3.3). Veto → revert to `?key=` and accept the log exposure recorded in §7. |
| D2 | **Separate `ADMIN_PAGE_SECRET`** (not `ADMIN_API_SECRET`). A family leak does not expose the script/skill bearer; each rotates independently. |
| D3 | **Scope:** edit words and fields; change status (approve / hide / back to pending; never from DRAFT); soft-delete and restore; create a draft on someone's behalf (reusing `draftMemory`). |
| D4 | **Media is view-only** in this alpha (thumbnails, players, upload state). No delete, replace or upload from admin; issue #17 covers the claim page. |
| D5 | MVP alpha for family. No user tables, roles or Auth.js. Rob accepts the shared-secret risk. |

## 2. Progress ledger (update as you go; a step is "verified" only with evidence)

Order is deliberate: contracts and failing tests first, then session and features, then purge coordination, then UI, then verification, then deployment. "Done" ≠ "verified".

| # | Step | Status | Commit | Evidence | Next action / blocker |
|---|---|---|---|---|---|
| L0 | Worktree + canonical plan copy committed | todo | | | |
| L1 | `lib/validations/admin.ts` schemas + tests (§3.5, §6 rows V1–V3) | todo | | | |
| L2 | `server/config/env.ts` `ADMIN_PAGE_SECRET` + env test | todo | | | |
| L3 | `features/admin/session.ts` (pure) + tests | todo | | | |
| L4 | `features/memories/media-state.ts` `appendRevision`; `features/memories/lock.ts` `lockContributor` | todo | | | |
| L5 | `features/admin/*` list/get/update/status/delete/create-draft + tests (write failing tests first) | todo | | | |
| L6 | `Media.purgedAt` schema + migration; cron (f) three-phase purge + reconcile tests (§3.6) | todo | | | |
| L7 | `features/media/serve-media.ts` extraction; `/api/media/[id]` adapter; media tests unchanged | todo | | | |
| L8 | `app/admin/media/[id]/route.ts` + tests | todo | | | |
| L9 | `app/admin/actions.ts` + action auth tests (`next/headers` mocked) | todo | | | |
| L10 | Pages, server components, client forms (§3.8) | todo | | | |
| L11 | `next.config.ts` headers; `lib/sentry/scrub.ts`; docs (`docs/admin.md`, `docs/environment.md`) | todo | | | |
| L12 | `npm run validate` / `test:run` / `build:offline` green with no `.env*` | todo | | paste the three summaries | |
| L13 | Local walk (§5, §6 rows B1–B14) with screenshots at 390 / 1440 / 2560 | todo | | commit SHA the screenshots were taken against | |
| L14 | PR opened with §10 non-goals and §11 follow-ups in the description | todo | | PR URL | |
| L15 | **Rob:** `ADMIN_PAGE_SECRET` in Vercel Production + local `.env` | todo | | | |
| L16 | **Rob:** Vercel Deployment Protection = Standard (§7) | todo | | | |
| L17 | Merge, production smoke (§7), record deployment id/SHA | todo | | | |
| L18 | **Rob:** send the entry link to the family | todo | | | |

## 3. What gets built

### 3.1 Base, worktree, PR

Branch `feat/admin-page` from `origin/main` (≥ `6210009`), worktree `../jowray_wt_admin_page`, PR against `main`. Everything PR #30 provided is on `main`: `MemoryStatus.DRAFT`, `draftMemory`, `reissueDraftClaimLink`, `getAdminEnv`, `lib/source-ref.ts`, the `source ↔ sourceRef` refine in `lib/validations/memory.ts`.

### 3.2 Secret and session (`server/config/env.ts`, `features/admin/session.ts`, `app/admin/_session.ts`, `docs/environment.md`)

- `server/config/env.ts`: new sub-schema `adminPageSchema { ADMIN_PAGE_SECRET: z.preprocess(v => v === "" ? undefined : v, z.string().min(32).optional()) }` and `getAdminPageEnv = memoized("adminPage", …)`, copying `adminSchema` on `main` including its empty-string normalisation, so `ADMIN_PAGE_SECRET=` means signed-out rather than a parse error [C32]. Unset means every check fails closed.
- `features/admin/session.ts` (`import "server-only"`, **pure: no `next/headers`**, so its tests need no Next mocks):
  - `ADMIN_COOKIE = "jowray_admin"`, `ADMIN_SESSION_MS = 30 days`.
  - `mintAdminCookie(now = Date.now())` → `${issuedAtMs}.${hmac}` where `hmac = createHmac("sha256", secret).update("v1:" + issuedAtMs).digest("hex")` [C20]. The cookie never carries the raw secret; a new secret invalidates every cookie; the timestamp makes the 30-day limit real on the server, not only in the browser.
  - `isAdminKey(key: string | null)`: `safeEqualHex(key ?? "", secret)` from `lib/claim-token` (constant-time; already used by the cron and admin API routes) [C21]. False when the secret is unset.
  - `isAdminCookie(value: string | undefined, now = Date.now())`: split on `.`, recompute the HMAC for that timestamp, `safeEqualHex`, and `now - issuedAt ≤ ADMIN_SESSION_MS`. False on any malformed value.
  - `adminCookieOptions()`: `{ httpOnly: true, secure: getSiteUrl().startsWith("https://"), sameSite: "lax", path: "/admin", maxAge: 30 * 24 * 60 * 60 }` [C5]. `secure` from the site URL (`lib/site-url`) rather than `NODE_ENV`, so `next start` over plain http still works. Path `/admin` keeps the cookie off `/m/<token>`, `/share` and `/api/*`; the cookie-gated media route therefore lives under `/admin/media/` (3.7).
- `app/admin/_session.ts` (server-only helper, not a route): `hasAdminSession()` = `(await cookies()).get(ADMIN_COOKIE)?.value` → `isAdminCookie` [C6]. The only `cookies()` reader; pages and actions import it.
- `docs/environment.md`: a row for `ADMIN_PAGE_SECRET` in the shape of the `ADMIN_API_SECRET` row [C32]: Production + local `.env`, `openssl rand -hex 32`, 32+ chars, rotating it signs everyone out, never Preview (Preview deploys read a copy of production rows), and the rotation caveat from §7 (older deployment URLs keep the old value).

### 3.3 Entry and exit (`app/admin/enter/page.tsx`, `app/admin/enter-form.tsx`, `app/admin/actions.ts`)

- **Entry link:** `https://www.jowray.com/admin/enter#key=<secret>`. The fragment is never sent to the server, so the secret appears in no request log, no `Referer`, and no Sentry server event; it remains in the browser's history for that one URL, which is accepted. `/admin/enter` is a static page (no Suspense needed; it reads nothing at request time) that renders `<EnterForm/>`.
- `enter-form.tsx` (`"use client"`): on mount reads `new URLSearchParams(location.hash.slice(1)).get("key")`; if present, immediately `history.replaceState(null, "", "/admin/enter")` (drops the fragment from the address bar and from any later navigation), then calls the Server Function `enterAdmin({ key })`. It also renders a plain "Paste the key" input with the same submit, for a link whose fragment a messaging app stripped. States: "Signing you in…", "That key didn't work, or it's expired. Ask Rob for a fresh one.", and "Open this link in the browser you'll keep using" (a link tapped inside Mail or Messages sets the cookie in that in-app browser, not Safari).
- `enterAdmin(input: unknown)` in `app/admin/actions.ts`: parse `{ key: string ≤ 256 }`; `isAdminKey` false or secret unset → `log.warn({ action: "admin_page_unauthorized", configured })` (never the key) and `{ ok: false, code: "unauthorized" }`; true → `(await cookies()).set(ADMIN_COOKIE, mintAdminCookie(), adminCookieOptions())` and `redirect("/admin")` [C4, C9]. The key travels in the Server Function's POST body: Next's request logger prints `POST /admin/enter` [C41] **and, in development, every Server Function's arguments as JSON unless `logging.serverFunctions` is off** [C44], so `next.config.ts` sets `logging: { serverFunctions: false }`; Vercel's request log holds method, path and query, not bodies; Sentry does not capture action bodies. `redirect` sits outside any `try` [C9]. This is the one Server Function that accepts a credential as a parameter, because it is the login step; every other action reads the cookie [C6].
- `leaveAdmin()` Server Function: `(await cookies()).delete({ name: ADMIN_COOKIE, path: "/admin" })` (delete must match the set path) then `redirect("/admin")` [C4, C9]. A "Sign out" button (`<form action={leaveAdmin}>`) in the admin bar, rendered whether or not a session exists.
- No `?key=` support anywhere (§10). `/admin?denied=1` is not needed either: the entry page shows its own failure state.

### 3.4 Leak controls (`next.config.ts`, `lib/sentry/scrub.ts`, `app/admin/layout.tsx`)

- `next.config.ts` `headers()`: add `{ source: "/admin/:path*", headers: [Referrer-Policy: no-referrer, X-Robots-Tag: "noindex, nofollow"] }` [C16, C38]. `:path*` is zero-or-more segments, so `/admin` itself matches; confirm with `curl -I` (§6 B2).
- `lib/sentry/scrub.ts`: generalise `TOKEN_QUERY` from `(^|[?&])t=` to `(^|[?&#])(t|key)=` so `?key=` and `#key=` never reach Sentry transactions, breadcrumbs or `request.url` (the browser SDK records `location.href` including the fragment) [C31]. Test in `__tests__/lib/sentry-scrub.test.ts`.
- `app/admin/layout.tsx`: `export const metadata = { title: "Family admin", robots: { index: false, follow: false } }` [C15] and `export const prefetch = "force-disabled"` [C14]. No `dynamic`/`revalidate`/`runtime`/`fetchCache` exports anywhere under `app/admin` [C12].
- Pino already redacts `authorization` and cookies; admin code logs ids and actions only, never rows, revisions or the key (PR #30 F1 still open).
- **Residual exposure, accepted and written in `docs/admin.md`:** the browser history entry for the entry link on the family member's device; Vercel request logs for `POST /admin/enter` (method and path only). Nothing else carries the secret.

### 3.5 Features (`features/admin/*`, all `import "server-only"`, zod schemas in `lib/validations/admin.ts`)

House shape: parse `unknown` with `safeParse`, return `{ ok: true, … } | { ok: false, code }`, lock, re-read, decide, write, revision. DTOs are shaped for the UI, never raw rows [C36]. Exact contracts are in §4.

- **`lockContributor(tx, contributorId)`** in `features/memories/lock.ts`, beside `lockMemory` [C25]: `SELECT "id" FROM "Contributor" WHERE "id" = ${id} FOR UPDATE`. Lock order everywhere: memory first, then contributor (the claim writer holds only the memory lock and touches the contributor inside it, so an admin that takes memory → contributor never deadlocks with it).
- **`appendRevision`** in `features/memories/media-state.ts`: generalise `appendClaimRevision` into `appendRevision(tx, { memoryId, changedVia, before, after, consentVersion })` and keep `appendClaimRevision` as a one-line wrapper with `changedVia: "CLAIM_LINK"`. All existing callers and tests unchanged.
- **`list-memories.ts`** — `listMemoriesForAdmin(raw)`; schema `adminListQuerySchema { status?: DRAFT|PENDING|APPROVED|HIDDEN, q?: string ≤ 100, deleted?: "on"|"1"|"true" → boolean }`. `findMany` with `deletedAt: deleted ? { not: null } : null`, optional `status`, and for `q` an `OR` over `contributorNote`, `place`, `contributor.name`, `contributor.email` with `{ contains: q, mode: "insensitive" }` [C18, C19]; `include` contributor (name, email, relationship) and live media (id, status, mimeType); `orderBy: [{ createdAt: "desc" }, { id: "desc" }]`, `take: 200`, plus a `count` with the same `where` so the UI can say "Showing 200 of N" when truncated (paging is follow-up A2). `adminStatusCounts()` via `groupBy({ by: ["status"], where: { deletedAt: null }, _count })` plus a deleted count.
- **`get-memory.ts`** — `getMemoryForAdmin(id)` → `AdminMemoryView | null` (§4.1). Deleted rows are returned with `deletedAt`.
- **`update-memory.ts`** — `updateMemoryAsAdmin(raw)` (§4.3 for the protocol). Schema `adminMemoryChangesSchema { memoryId: uuid, memoryVersion: ISO, contributorVersion: ISO | null, changes: { name?, relationship? (≤120), approxDateText? (≤120), place? (≤200), note? (≤10 000, nullable), visibility? } }` reusing `optionalText`; **only the keys the user changed are present** (dirty-field submission, 3.8). **Not editable from admin:** contributor `email` (cron step (e) and `confirmSubmission` mint and email a fresh claim link to whatever address a memory has, so a typo would hand the edit capability to a stranger and kill the sender's link), `notifyWhenPosted`, `contactOptIn`, `mailingListOptIn` (the person's own preferences, given at Share; PR #30 ruling R6). Log `admin_memory_updated { memoryId }`.
- **`set-status.ts`** — `setMemoryStatusAsAdmin({ memoryId, status: PENDING|APPROVED|HIDDEN })`. Lock, re-read; `not_found` (missing/deleted); **`draft`** when `fresh.status === "DRAFT"`: only the sender's Share press leaves DRAFT, and the CHECK constraint would refuse a non-DRAFT status with `consentedAt` null anyway [C26]. Revision ADMIN `{ status }` → `{ status }` with `consentVersion: fresh.consentVersion`. Log `admin_status_set { memoryId, status }`. Nothing emails on APPROVED (PR #30 F3); the admin alert already fired for every non-DRAFT row, so email behaviour is unchanged. Nothing public reads `APPROVED`/`HIDDEN` yet, so the detail page says so next to the buttons: "Approving doesn't publish anything yet; the public memorial pages aren't built."
- **`set-deleted.ts`** — `setMemoryDeletedAsAdmin({ memoryId, deleted: boolean })`. Lock, re-read; `not_found` when missing; no-op success when already in that state; set/clear `deletedAt`; revision ADMIN `{ deletedAt }`. Restore returns `purgedFiles` (§4.5). Log `admin_memory_deleted` / `admin_memory_restored`. A deleted memory's claim page already 404s (`getMemoryForClaim` checks `deletedAt`) and its uploads already stop (`ingest-upload.ts`).
- **`create-draft.ts`** — `createDraftAsAdmin(raw)`; schema `adminDraftFormSchema { name, email (required), relationship, note (required, verbatim), approxDateText, place, visibility (default PUBLIC) }`; no `phone`, **no `source` select**. `safeParse` first, then `source: "OTHER"` and `sourceRef = otherSourceRef(email, note)` from `lib/source-ref.ts` (pure; keyed on the sender's email and the full text, so a re-paste cannot make a second draft; it throws only on inputs the schema already rejects), then `draftMemory()` unchanged. `main`'s `draftMemoryInputSchema` refines `source ↔ sourceRef` prefix (`EMAIL ↔ gmail:`, `SMS ↔ sms:`, `OTHER ↔ other:`) [C42], and a browser form has no Gmail message id or E.164+timestamp to build the other two, so a browser-drafted memory is always `OTHER` with the words "pasted from an email, text or card" in the form's help text; the script and skill remain the way to record a Gmail or SMS reference (§10). On `duplicate`, look up the existing row's `deletedAt` and return it (§4.2).
- **Reissue** — the action calls `reissueDraftClaimLink({ memoryId })` directly; it is already conditional on `status = DRAFT` [C24].

### 3.6 Cron (`app/api/cron/reconcile-uploads/route.ts`)

- Step (f) purges blobs of soft-deleted memories on its next run [C23]. With a Restore button that would be a trap. Three changes:
  1. **30-day grace** for the memory branch: `DELETED_MEMORY_GRACE_MS = 30 days`; `{ memory: { deletedAt: { lt: new Date(now - DELETED_MEMORY_GRACE_MS) } } }` (`lt` excludes nulls in SQL). The claim-page file-removal branch keeps its existing grace. No production row has `deletedAt` set today, so no existing behaviour moves.
  2. **Durable purge intent: `Media.purgedAt DateTime?`** (schema + one expand-only migration `prisma/migrations/<ts>_media_purged_at/migration.sql`, `ALTER TABLE "Media" ADD COLUMN "purgedAt" TIMESTAMP(3)`; deploys run `prisma migrate deploy` [C46]). Storage deletion cannot be rolled back by a database transaction, so the database must say "being removed" *before* the first byte goes, and that mark must survive a crash, a timeout or a Restore. Column comment: "set by cron step (f) before any byte is deleted; once set the removal completes even if the memory is restored; READY rows flip to FAILED at the same time".
  3. **Three-phase purge, lock held only for the database write.** For each candidate:
     - *Phase 1 (claim), `db.$transaction(TX_OPTIONS)`:* `lockMemory(tx, row.memoryId)` [C25]; re-read the row with `memory.deletedAt`. If `purgedAt` is null and the row is no longer eligible (memory restored before the cutoff, or the file-removal branch's conditions no longer hold) → `"skipped"`, nothing touched. Otherwise set `purgedAt: now` (if null) and `status: "FAILED"` when the row is READY, commit. No storage call inside the lock, so `TX_OPTIONS` (10 s) is never at the mercy of the network.
     - *Phase 2 (bytes), no lock:* `storage.del` for each derived copy, the original, and the poster staging key, all idempotent (deleting a missing key is a no-op).
     - *Phase 3 (pointer):* `derivedMedia.deleteMany` for the deleted copies and `media.update { blobUrl: null }`.
     - *Selection* adds `{ purgedAt: { not: null } }` to the `OR` so a row whose phase 2 or 3 failed (or whose process died) is re-selected until `blobUrl` is null and no derived rows remain; retries are safe because every phase-2 call is idempotent and phase 1 is a no-op once `purgedAt` is set. Errors keep `counts.errors` and `logError` as today.
     - *Restore respects the mark:* a row with `purgedAt` set never serves again (`serveMedia` requires READY) and never counts as a READY file in any last-words check, whether phase 2 has run or not; `purged` in the DTO is `purgedAt !== null`. The family-facing rule is unchanged: "Restore within 30 days keeps the files"; after that the memory comes back with its words and the files are gone or going.
     - The in-flight window of the old race is closed by phase 1: a Restore that commits before the claim makes the row ineligible (skipped); a Restore that waits on the lock sees `purgedAt` set and reports the file as purged.
- Step (e3) `unreceipted` is **left as is**: `confirmSubmission` already drops deleted memories from the send and writes a SKIPPED `nothing_to_send` row when none remain, so a deleted anchor's live siblings still get their links. A reconcile test pins that.
- `__tests__/api/reconcile.test.ts`: the in-memory `matches` helper treats `null < Date` as true, so a `{ deletedAt: { lt } }` filter would "purge" live memories' media in the test. Fix `matches` to return false for `lt/lte/gt/gte` when the actual value is null or undefined (Prisma's SQL already behaves that way). Move the `med_gone`/`med_gone_done`/`med_prod_copy` fixtures from `ancient` (30 h) to 31 days; add the cases in §6 (C1–C6).

### 3.7 Media viewing (`features/media/serve-media.ts`, `app/api/media/[id]/route.ts`, `app/admin/media/[id]/route.ts`)

- `<img>`/`<audio>`/`<video>` cannot send a bearer, and `/api/media/[id]` is authorised only by the raw claim token whose hash is all we store. So: extract the body of the existing route (lookup, READY/MIME checks, ≤25 MB download streaming, derived-copy choice, 60 s presign redirect, `PROTECTIVE_HEADERS`) into `features/media/serve-media.ts` as `serveMedia({ id, variant, download, allowDeletedMemory, authorize: (memory: { claimTokenHash }) => boolean }): Promise<Response>`. `features/` may import `services/`; a route outside `app/api/**` may not [C22], which is why the shared code moves down a layer and why the admin route (under `/admin` for the cookie path) cannot copy it.
- `app/api/media/[id]/route.ts` becomes a thin adapter: request-time reads, `if (!token) notFound`, `serveMedia({ …, allowDeletedMemory: false, authorize: m => safeEqualHex(hashClaimToken(token), m.claimTokenHash) })`. The 10 tests in `__tests__/api/media.test.ts` must pass unchanged (they mock `@/server/db/client` and `@/services/storage`, which the feature module imports too).
- `app/admin/media/[id]/route.ts`: first reads `request.cookies.get(ADMIN_COOKIE)` and the `v`/`download` params [C11]; `isAdminCookie` false → the same 404 body as a wrong token (no oracle); true → `serveMedia({ …, allowDeletedMemory: true, authorize: () => true })`, so a deleted memory's thumbnails still render on the page where Restore is decided. Media rows that are themselves soft-deleted stay 404. `maxDuration = 60` like the sibling. The `/admin/:path*` header entry (3.4) covers it.

### 3.8 Pages and components (`app/admin/**`)

All dynamic pages: static shell, then `<Suspense>` → `await connection()` → `cookies()`/`searchParams`/`params` → data [C1, C2, C34]. Every page that hosts Server Functions sets `export const maxDuration = 30` [C12]. Client Components are named `*-form.tsx` / `*-client.tsx` so the ESLint client rule applies [C30]; they import `../_components/*` by relative path and call Server Functions only.

- **`layout.tsx`**: metadata + `prefetch` as in 3.4; an admin bar (title "Family admin", links `All memories` · `Draft for someone`, Sign out form) and `{children}` in `<main className="w-full flex-1 px-[max(16px,2%)] py-6">` (no max-width). **(my call)** The public `SiteHeader`/`SiteFooter` from the root layout stay above and below for this alpha; moving the public pages into a `(site)` route group touches every page and six open worktrees, so it is follow-up A1.
- **`page.tsx`** (`/admin`): list. Dynamic child: no session → `<SignedOut/>` ("Open the link Rob sent you, in the browser you'll keep using"); else `listMemoriesForAdmin` + counts → `<AdminShell list={<MemoryList …/>} detail={<EmptyDetail/>}/>`. `searchParams` read: `status`, `q`, `deleted` only, validated by `adminListQuerySchema` [C3]; status chips are plain links; "Showing 200 of N" when truncated.
- **`enter/page.tsx`**: static; renders `<EnterForm/>` (3.3). No session check (it is the way in).
- **`memories/[id]/page.tsx`**: detail. Same gate; `getMemoryForAdmin(id)` null → `notFound()` (streams a 200 like `/m/[claimToken]`, acceptable [C10]); renders `<AdminShell list={<MemoryList current={id} …/>} detail={<MemoryDetail …/>}/>`. A **deleted** memory renders read-only: no edit form, no status buttons, no New link; only Restore, the purged-file note and the gallery. On narrow screens the list is hidden and a "← All memories" link shows.
- **`new/page.tsx`**: the draft-on-behalf form.
- **`actions.ts`** (`"use server"`): `enterAdmin`, `leaveAdmin`, `saveMemory`, `setStatus`, `setDeleted`, `createDraft`, `reissueLink`. All but `enterAdmin` first do `if (!(await hasAdminSession())) return { ok: false, code: "unauthorized" }` [C6, C7, C8], then call the feature and return its result unchanged. Thin wrappers, like `app/m/[claimToken]/actions.ts`.
- **Server components** `admin-shell.tsx`, `memory-list.tsx`, `memory-detail.tsx`, `status-badge.tsx`, `list-filters.tsx` (a plain `<form method="get">`, no `"use client"`), `media-gallery.tsx` (thumbs `/admin/media/<id>?v=thumb` via `next/image` `unoptimized` with `fill` inside a fixed `aspect-square` parent and `object-cover`; click → `?v=web`; `<audio controls>`, `<video controls className="max-w-full">`; PENDING / FAILED / "file removed after 30 days" labelled), `history.tsx` (revisions: changedVia badge, time, changed keys as before → after; EmailLog rows). Every value cell and every grid child gets `min-w-0 break-words whitespace-pre-wrap` so a 10 000-character note or a 64-character hash never forces horizontal scroll at 390 px. Dates are formatted with `Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", … })` because Vercel renders in UTC.
- **Client components**:
  - `memory-edit-form.tsx`: uncontrolled inputs with `defaultValue`, `labelClass`/`inputClass`/`textareaClass`, `useState` busy/message, exactly the `claim-form.tsx` shape, **plus dirty tracking and the stale flow of §4.3**: the form keeps the `initial` values and both versions it was opened with in state; on submit it sends only the keys whose current value differs from `initial`, with the versions; on `stale` it stores `result.current`, sets the versions from it, lists the fields that changed on the server (`current` vs `initial`) in a banner ("Someone changed words and visibility since you opened this. Your edits are still here; press Save to keep them, or Reload to discard them"), and leaves every input as typed; Save again sends the same dirty keys with the new versions; Reload is a real page reload (the person asked to discard their edits). On success: "Saved.", the form adopts the typed values as its new baseline and the versions the server returns, then `router.refresh()` for the rest of the page [C13]. **Amendment (final review, 2026-11-04):** the form is never keyed on the versions, because a status action or New link in the aside also bumps `updatedAt` and a keyed remount would discard typed words; and when `stale` comes back with no editable field differing from the baseline (only status, token or a file moved), the form saves again at once instead of showing the banner. Shows the "shared by every memory sent together" note under name/relationship when `submissionId` is set.
  - `status-actions-client.tsx`: Approve / Hide / Back to pending shown by current status, with the "doesn't publish anything yet" note; DRAFT shows "Waiting for them to press Share" and a **New link** button that shows the fresh claim link once with a copy button and the note "Any earlier link stops working"; Delete / Restore with the two-step confirm pattern from the claim page's Remove; Delete's confirm copy: "It leaves the family's view now. Restore within 30 days keeps the files."; Restore's result names purged files when any.
  - `draft-form.tsx`: fields in 3.5; on success shows the claim link, a copy button, "The site will not email this. Send it to them yourself.", and a link to the memory; on `duplicate` shows "Already drafted" (or "Already drafted; it's in Deleted") with a link, and for a DRAFT duplicate a "New link" button (§4.2).
  - `enter-form.tsx`: 3.3.
- **Layout by width** (Tailwind v4, CSS-only):
  - `< 48rem` (phones, the house `narrow` variant): one column. `/admin` is the list as cards; `/admin/memories/[id]` is the detail alone. Status chips `flex-wrap` onto two rows (five 56 px targets do not fit 358 px).
  - `≥ 48rem` (`wide`): `grid-cols-[minmax(320px,420px)_minmax(0,1fr)]`; the list rail is `sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto`, the detail scrolls the page.
  - `≥ 100rem` (`min-[100rem]:` arbitrary breakpoint [C33]; 1600 CSS px, so it also fires on 1440p/4k desktops, which is intended; a 5k display at default scaling is 2560 CSS px): `grid-cols-[440px_minmax(0,1fr)_minmax(420px,600px)]`: list | words and fields editor | media gallery, status actions and history. The editor's text column is capped at `max-w-[72ch]`; the gallery grid uses `grid-cols-[repeat(auto-fill,minmax(180px,1fr))]` so a 5k screen shows a wall of thumbnails.
  - Tap targets keep `min-h-tap`; type scale and colours are the existing tokens (`paper` cards on `muslin`, `jo-red` primary, `walnut` text). Must look finished at 390 px.
- **`<Link prefetch={false}>`** for every admin link (200 rows; auth pages) [C14].

### 3.9 Docs

- `docs/environment.md` row (3.2).
- `docs/admin.md` (new): what the page does; the entry link and why it uses `#`; the residual exposure list (3.4); how to rotate `ADMIN_PAGE_SECRET` and the older-deployment caveat (§7); what "deleted" means (30-day grace, then files are removed and marked failed; restore after that brings back words only); what DRAFT rows are and why they cannot be approved here; the manual Server Function replay check (§6 A6).
- `docs/plans/2026-11-04-admin-page.md`: this plan, kept current (§0).
- `docs/plans/2026-11-03-draft-memory-on-behalf.md`: one line on F2 pointing at this PR.

## 4. Behaviour contracts

### 4.1 DTOs

```ts
// list row
{ id, status, type, source, visibility, createdAt, consentedAt, deletedAt,
  contributor: { name, email, relationship } | null,
  excerpt: string,                     // first 160 chars of contributorNote, whitespace collapsed
  media: { ready, pending, failed, photos, videos, audios } }
// counts
{ DRAFT, PENDING, APPROVED, HIDDEN, deleted, total, shown }   // shown ≤ 200
// detail
AdminMemoryView = {
  id, status, type, source, sourceRef, visibility, approxDateText, place, contributorNote,
  notifyWhenPosted, consentVersion, consentedAt, submissionId, submissionIndex,
  createdAt, updatedAt, deletedAt,
  memoryVersion: string,                      // memory.updatedAt ISO
  contributor: { id, name, email, relationship, phone, contactOptIn, mailingListOptIn, contributorVersion: string } | null,
  media: Array<{ id, status, mimeType, originalFilename, durationSeconds, width, height,
                 caption, approxDateText, place, sortOrder, webReady: boolean, thumbReady: boolean,
                 purged: boolean }>,          // purged: purgedAt !== null (the bytes are gone or being removed)
  revisions: Array<{ id, changedVia, before, after, createdAt }>,   // last 25, newest first
  emails: Array<{ emailType, status, sentAt, attempts, createdAt }> }
```
Never included: `claimTokenHash`, `blobUrl`, `storageKey`, `exif`.

### 4.2 Action result unions

| Action | Results |
|---|---|
| `enterAdmin({ key })` | `redirect("/admin")` · `{ ok: false, code: "unauthorized" \| "invalid" }` |
| `leaveAdmin()` | `redirect("/admin")` |
| `saveMemory(raw)` | `{ ok: true, written: string[], memoryVersion, contributorVersion }` (post-write versions) · `{ ok: false, code: "unauthorized" \| "invalid" \| "not_found" \| "stale", current?: AdminMemoryEditable }` · `"last_words"` |
| `setStatus(raw)` | `{ ok: true }` · `{ ok: false, code: "unauthorized" \| "invalid" \| "not_found" \| "draft" }` |
| `setDeleted(raw)` | `{ ok: true, purgedFiles: number }` · `{ ok: false, code: "unauthorized" \| "invalid" \| "not_found" }` |
| `createDraft(raw)` | `{ ok: true, memoryId, claimLink }` · `{ ok: false, code: "unauthorized" \| "invalid" \| "budget_exceeded" }` · `{ ok: false, code: "duplicate", memoryId, status, deletedAt }` |
| `reissueLink(raw)` | `{ ok: true, claimLink }` · `{ ok: false, code: "unauthorized" \| "invalid" \| "not_found" \| "not_draft" }` |

`AdminMemoryEditable` = `{ name, relationship, approxDateText, place, note, visibility, memoryVersion, contributorVersion }`.

**Lost responses.** Draft creation: the row exists; re-submitting the same email and words answers `duplicate` with the id and status; the form links to the memory and, while it is DRAFT, offers New link. Reissue: each press rotates the token; the last link shown is the live one; an earlier press whose response was lost simply issued a link nobody will use. Save: the write is committed or not; re-saving with the same dirty keys either succeeds or answers `stale` with the current values, which show whether the first save landed.

### 4.3 Version and locking protocol (admin writes)

1. Parse. `changes` holds only dirty keys. Memory keys: `approxDateText`, `place`, `note`, `visibility`. Contributor keys: `name`, `relationship`.
2. `$transaction(TX_OPTIONS)`: `lockMemory(tx, memoryId)`; if any contributor key is present and the memory has a contributor, `lockContributor(tx, contributorId)` (always memory first).
3. Re-read memory and contributor. `not_found` if missing or `deletedAt !== null`.
4. If any memory key is present and `fresh.updatedAt.toISOString() !== memoryVersion` → `stale`. If any contributor key is present and `freshContributor.updatedAt.toISOString() !== contributorVersion` → `stale`. The `stale` result carries `current: AdminMemoryEditable` from the locked read.
5. Drop keys whose submitted value equals the fresh value. If nothing remains → `{ ok: true, written: [] }` (no revision).
6. `last_words` if `note` would become empty and no READY file remains (same rule as `updateMemoryFromClaim`).
7. Write the remaining keys (`memory.update`, `contributor.update`); `recomputeMemoryType` when words appear or vanish; `appendRevision({ changedVia: "ADMIN", before, after, consentVersion: fresh.consentVersion })` with exactly the written keys.

Two admins editing different *memory* fields of sibling memories never clobber each other (different rows). The contributor row is shared and carries one version, so when two admins change contributor fields of sibling memories the second sees `stale` even if the fields differ; that is deliberately conservative for this alpha (the second admin sees what changed, presses Save, and only their dirty keys are written). The claim writer's own stale-overwrite is follow-up A8; this PR must not claim protection against a sender's old tab overwriting an admin correction.

### 4.4 Status transitions

| From \ To | PENDING | APPROVED | HIDDEN |
|---|---|---|---|
| DRAFT | `draft` (only Share) | `draft` | `draft` |
| PENDING | no-op ok | ok | ok |
| APPROVED | ok | no-op ok | ok |
| HIDDEN | ok | ok | no-op ok |
| any, `deletedAt` set | `not_found` | `not_found` | `not_found` |

No side effects beyond the revision row.

### 4.5 Delete, purge and restore outcomes

| Sequence | Outcome |
|---|---|
| Delete, restore within 30 days | Files intact; `purgedFiles: 0`. |
| Delete; cron selects the row; restore commits before the cron's phase-1 transaction takes the lock | Phase 1 re-read sees `memory.deletedAt === null` and `purgedAt` null → skipped; files intact. |
| Delete; phase 1 commits (`purgedAt` set, READY → FAILED); restore waits on the lock, then commits | Restore returns `purgedFiles: N`; phases 2–3 complete on this or a later run regardless of the restore; gallery labels the files; claim page shows the failed-upload state (contributor can re-add). |
| Phase 2 deletes the original, then a later call or phase 3 fails or the function dies | `purgedAt` is already committed, so the row is FAILED and never served; re-selected next run; idempotent deletes finish the job. Restore in between reports the file as purged. Nothing ever points a READY row at missing bytes. |
| Delete > 30 days, never restored | Blobs removed, rows FAILED with `purgedAt`; the memory row and its words remain forever (no hard delete). |
| Rollback to a build before this PR after any admin delete | That build's cron purges deleted memories immediately and ignores `purgedAt`. See §7 rollback floor. |

## 5. Safe verification environment

- **Database:** the Neon `dev` branch of the Vercel-managed project only (branch and endpoint ids are in `docs/plans/2026-11-02-bootstrap-report.md`; the connection string is the `DATABASE_URL` override in `.env.local`, which the Vercel CLI can silently overwrite, so re-check it after any `vercel` command). Never the production branch.
- **Env for the walk:** throwaway `ADMIN_PAGE_SECRET` (`openssl rand -hex 32`, never reused for production), `OUTBOUND_ENABLED=false` **and `OUTBOUND_ALLOWLIST=` (empty)**: the email guard sends to an allowlisted recipient even when outbound is off [C45], so both must be set before any cron run; `ADMIN_ALERT_EMAILS=` (empty); the site URL key set to `http://localhost:3000`; `CRON_SECRET` set to a throwaway for the local cron call. Keep `ADMIN_API_SECRET` unset unless testing the script. Confirm all of these in the running process (`next dev` prints nothing for them; check with a one-line `node -e` against the same `.env` loader, or a temporary log line removed before commit).
- **Migration:** this PR adds `Media.purgedAt`; run `npm run db:migrate` against the dev branch once, and confirm with `npx prisma migrate status`.
- **Fixtures:** create test memories through `/share` and through the admin draft form with synthetic names and a mailbox you own; never real family rows. Upload one JPEG, one HEIC, one short video and one audio clip so every gallery branch renders.
- **Cron:** running `GET /api/cron/reconcile-uploads` locally touches only blobs under this environment's storage prefix (`dev/`), but it also processes every row on the dev branch (confirmations are suppressed by `OUTBOUND_ENABLED=false`, admin alerts by the empty list). Run it only after the two env settings above are confirmed in the process environment.
- **Screenshots:** Chrome DevTools MCP at 390 × 844, 1440 × 900 and 2560 × 1440; record the commit SHA in the ledger next to them.

## 6. Acceptance matrix

Unit (Vitest; runs only `__tests__/**/*.test.ts`):

| # | Test | File |
|---|---|---|
| V1 | `adminListQuerySchema`: `deleted` "on"/"1"/"true" → true, absent → undefined; `q` trimmed, > 100 rejected; `status` enum | `__tests__/lib/validations-admin.test.ts` |
| V2 | `adminMemoryChangesSchema`: only listed keys accepted, `email`/preferences rejected as unknown keys (`.strict()`), versions required | same |
| V3 | `adminDraftFormSchema`: email required, note non-blank, no `source` key | same |
| V4 | `ADMIN_PAGE_SECRET` < 32 rejected; `""` → undefined | `__tests__/lib/env.test.ts` |
| V5 | session: value `issuedAt.hmac` deterministic; wrong/unset/empty/malformed/forged-timestamp/expired → false; fresh → true | `__tests__/features/admin-session.test.ts` |
| V6 | list: `findMany` called with the expected `where`/`orderBy`/`take`; `q` → insensitive OR over four fields; `deleted` → `not: null`; `shown`/`total` when truncated; DTO has no `claimTokenHash` | `__tests__/features/admin-memories.test.ts` (assert `vi.fn` args, as `admin-memories.test.ts` does for `draftMock`) |
| V7 | update: lock order memory → contributor (lock call log); stale memory version → `stale` with `current`; stale contributor version only when a contributor key is dirty; equal-to-fresh keys dropped; `written: []` writes no revision; `last_words`; deleted → `not_found`; revision has exactly the written keys and `changedVia: "ADMIN"`; **second save with the versions from `current` succeeds** | same (in-memory stub as `claim.test.ts`) |
| V8 | sibling race: two updates to different memories sharing one contributor; the second to change *any* contributor key after the first committed → `stale` (conservative single contributor version, §4.3); a second that changes only memory keys → succeeds | same |
| V9 | status: table 4.4 incl. `draft` and deleted `not_found`; revision written | same |
| V10 | delete/restore: toggles, idempotent, revisions; restore reports `purgedFiles` = rows with `purgedAt` set | same |
| V11 | create-draft: goes through the **real** `draftMemoryInputSchema` (mock only Prisma): `OTHER` + `other:` passes; `duplicate` carries `deletedAt` | same |
| V12 | media route: unchanged 10 tests pass; deleted memory still 404 | `__tests__/api/media.test.ts` |
| V13 | admin media: no / wrong / expired cookie → 404; right → 302 presign; `v=thumb` → THUMBNAIL; media row deleted → 404; **memory deleted + cookie → 302** | `__tests__/api/admin-media.test.ts` |
| V14 | actions: with `next/headers` `cookies()` mocked to no cookie, every mutating action returns `unauthorized` and the feature mock is never called; with a valid cookie it is called once | `__tests__/app/admin-actions.test.ts` |
| V15 | reconcile `matches`: `lt` against null → false | `__tests__/api/reconcile.test.ts` |
| C1 | (f): memory deleted 31 d → phase 1 inside a transaction after `lockMemory` sets `purgedAt` and FAILED and **makes no storage call**; phases 2–3 then delete bytes, derived rows, and null `blobUrl` | same |
| C2 | (f): memory deleted 1 d → not selected | same |
| C3 | (f): selected, but the locked re-read shows `memory.deletedAt` null and `purgedAt` null → skipped, `storage.del` never called | same |
| C4 | (f): claim-page-removed file branch keeps its grace; `purgedAt` set, no READY→FAILED flip needed (already deleted) | same |
| C5 | (f): original deleted, then the next `storage.del` throws → `purgedAt` and FAILED remain committed, `blobUrl` unchanged, `errors` incremented; **next run re-selects by `purgedAt`**, idempotent deletes complete, `blobUrl` null | same |
| C5b | (f): phase 3 `deleteMany` throws after all deletes → same recovery on the next run | same |
| C5c | (f): `purgedAt` already set and memory restored (`deletedAt` null) → still selected and completed (intent is durable) | same |
| C6 | (e3): anchor soft-deleted, sibling live → `confirmSubmission` still called | same |
| V16 | scrub: `?key=`, `&key=`, `#key=` dropped; others kept | `__tests__/lib/sentry-scrub.test.ts` |
| V17 | `claim.test.ts` unchanged and green (`appendClaimRevision` wrapper) | existing |

Browser and manual (§5 environment; record evidence in the ledger):

| # | Check |
|---|---|
| B1 | `/admin` signed out → signed-out page; `/admin/enter#key=wrong` → failure copy, no cookie; `/admin/enter#key=<secret>` → address bar shows `/admin/enter` without the fragment, then `/admin` with the list; cookie `HttpOnly; Path=/admin; SameSite=Lax; Max-Age=2592000` |
| B2 | `curl -I http://localhost:3000/admin` shows `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex, nofollow`; after B1, `grep -F '<the throwaway secret value>' <dev log>` finds **nothing** (not `key=`: the dev logger would print it as JSON `{"key":"…"}` without `logging.serverFunctions: false`), and the log shows only `POST /admin/enter` |
| B3 | `curl /admin/media/<id>` without cookie → 404; with the cookie → 302; thumbnails, audio and video render; HEIC shows its web copy |
| B4 | Edit words → "Saved."; revision row `changedVia: ADMIN` with only the changed keys |
| B5 | Two tabs: edit visibility in tab A, then save words in tab B → banner names "visibility", B's words intact; Save again → saved; Reload → fields match the server |
| B6 | Approve → APPROVED; Hide → HIDDEN; Back to pending → PENDING; notes visible |
| B7 | DRAFT row: no Approve; New link → working `/m/<token>`, old one 404; press Share on the claim page → list shows PENDING, preferences update in the detail |
| B8 | Delete → leaves the default list, appears under Deleted, detail read-only with Restore; thumbnails still render; Restore → back, `purgedFiles: 0` |
| B9 | Local cron with `CRON_SECRET` → `deletedBlobsRemoved: 0` for the fresh delete |
| B10 | Draft for someone → claim link opens the DRAFT claim page; same email + words again → "Already drafted" with link and New link |
| B11 | Sign out → signed-out page; the cookie is gone |
| B12 | 390 × 844: no horizontal scroll on list, detail with a 10 000-char note, and history; chips wrap; tap targets ≥ 56 px |
| B13 | 1440 × 900: two columns, sticky rail scrolls independently; 2560 × 1440: three columns, gallery wall |
| B14 | Replay a Server Function POST without the cookie (copy the request from DevTools as curl, strip `Cookie`) → `unauthorized`, no database query in the dev log |

## 7. Rollout, deployment and recovery record

| Step | Who | Evidence to record |
|---|---|---|
| 1 | Builder: L1–L14 green | ledger |
| 2 | **Rob:** `openssl rand -hex 32` → `ADMIN_PAGE_SECRET` in Vercel **Production** and local `.env` (never Preview) | key name only |
| 3 | **Rob:** Vercel → project → Settings → Deployment Protection → **Standard Protection** (protects every deployment URL except the production domains) [C40]. Without it, older production deployment URLs stay publicly reachable and, because a rolled-back or older deployment keeps the environment values it was built with [C39], a rotated secret would still open the admin page there. | screenshot or `vercel project inspect` output |
| 4 | Merge; Vercel builds `main`; record deployment id and SHA | ledger |
| 5 | Production smoke: `https://www.jowray.com/admin` signed-out page; `curl -I https://www.jowray.com/admin` headers; entry link works for Rob; one harmless edit (e.g. a date text on Rob's own test memory) and revert | ledger |
| 6 | **Rob:** send `https://www.jowray.com/admin/enter#key=<secret>` to the family through a private channel; each person opens it once and bookmarks `/admin` | ledger |

**Rollback floor.** Once any memory has been soft-deleted from admin, never roll back to a deployment older than this PR's merge commit: that cron purges deleted memories on its next run with no grace and ignores `purgedAt` (§4.5). Record the merge SHA here when known: `________`. If an older build must run anyway: first, in Vercel → project → Settings → Cron Jobs, press **Disable Cron Jobs** (a project-level setting that persists across Instant Rollback and promotions [C43]); verify in the same screen that the job shows as disabled and that no `/api/cron/reconcile-uploads` request appears in the logs at the next scheduled minute; then roll back. Re-enable only on a build at or above the floor. A rollback also restores the older deployment's cron definitions, which is why the switch must be the project-level one, not an edit to `vercel.json`.

**Rotation.** Change `ADMIN_PAGE_SECRET` in Vercel Production, redeploy, then verify: the old entry link fails on `https://www.jowray.com/admin/enter`; an old cookie answers the signed-out page; with Standard Protection on, the previous deployment's `*.vercel.app` URL asks for Vercel login. Resend the new link.

## 8. Resume procedure (after compaction or handoff)

1. `cd ../jowray_wt_admin_page && git status && git log --oneline -10 && git fetch origin && git log --oneline origin/main -3`. Note dirty files and whether `origin/main` moved.
2. Read `docs/plans/2026-11-04-admin-page.md` §2 (the ledger). The first row that is not "verified" is where you are.
3. Reconcile interrupted work: a half-written file → finish or revert from the ledger's last commit; a running `next dev` → restart; a local cron run → check `deletedBlobsRemoved` in its last output before running again.
4. Never infer from a summary that a deployment, a secret, a Vercel setting or a sent link exists. Check `gh pr view`, `vercel ls --prod`, and ask Rob for L15/L16/L18.
5. Re-run `npm run validate && npm run test:run` before continuing; record the result in the ledger.

## 9. Review record (what was done with each point)

**Round 1, fresh-context pre-mortem (2026-11-04).** 21 findings; 17 folded in: entry handler built with `NextResponse` (superseded by the fragment design in round 2), no email editing, reconcile stub `null < Date` bug, (e3) left alone, admin may view a deleted memory's media, purged-file flag on restore, preferences read-only, version/stale protocol, timestamped cookie, cookie path `/admin` and pure session module, layout rules, `secure` from site URL, webview copy, safeParse-first draft, duplicate-is-deleted copy, "doesn't publish yet" note, `list-filters.tsx` naming. No change: `prefetch` export valid under `partialPrefetching`; `:path*` matches bare `/admin`; `appendRevision` safe. Deferred: claim-form `not_found` copy → A6; purged rows → now in scope (3.6).

**Round 2, Rob's friend (2026-11-04), each point verified against `origin/main` @ `6210009`:**

| Point | Verified? | Bucket | Disposition |
|---|---|---|---|
| 1. Draft form fails `source ↔ sourceRef` refine | Yes: `lib/validations/memory.ts` refine on `main` | 1 | 3.5: browser drafts are `OTHER` + `other:`; V11 runs the real schema |
| 2. Contributor shared across siblings; `lockMemory` covers one memory; claim writer has no version | Yes: `lock.ts`, `claim.ts` | 1 (admin side) / 4 (claim side) | 3.5 `lockContributor`, 4.3 two versions + dirty keys; claim form → A8 |
| 3. `router.refresh()` + `defaultValue` does not reset the form | Yes (React/Next behaviour) | 1 | 3.8 + 4.3: dirty tracking, `current` on stale, controlled versions, Save-again / Reload, V7 second save, B5 |
| 4. Restore races the purge; purged rows stay READY | Yes: cron selects then deletes with no lock | 1 | 3.6: purge under `lockMemory` with re-check, FAILED on purge, C1–C5, 4.5 |
| 5. Rollback floor; older deployments keep env values | Yes: Vercel docs [C39, C40] | 1 | §7 rollback floor, Standard Protection (Rob), rotation verification |
| 6. "Request logs never print the key" was false | Yes: `node_modules/next/dist/server/dev/log-requests.js` prints `request.url` | 1 + 2 | Claim removed; fragment entry (D1 amendment) takes the key out of every server log; residual exposure listed in 3.4 |
| Handoff contract table | n/a | 1 | §0, §2, §4, §5, §6, §7, §8 |
| "200 of N"; empty-string env normalisation | Yes: `adminSchema` on `main` uses `preprocess` | 1 | 3.5, 3.2 |

**Round 3, Rob's friend (2026-11-04), each point verified:**

| Point | Verified? | Disposition |
|---|---|---|
| 1. A DB rollback cannot undo a storage delete; a partial failure leaves a READY row pointing at missing bytes; 10 s is not a network guarantee | Yes (by construction) | 3.6: durable intent `Media.purgedAt` (expand-only migration, reversing the earlier "no migration" non-goal because overloading `FAILED` could not express "being removed"), three phases, lock held only for the DB claim, idempotent retries by `purgedAt`; tests C1–C5c; outcomes 4.5 |
| 2. Dev logger prints Server Function arguments (`ƒ enterAdmin({"key":…})`) | Yes: `log-requests.js:49-50`, `logging.md` [C44] | 3.3: `logging: { serverFunctions: false }`; B2 greps the secret value, not `key=` |
| 3. `OUTBOUND_ENABLED=false` still sends to allowlisted recipients | Yes: `services/email/index.ts` `outboundAllowed` [C45] | §5: `OUTBOUND_ALLOWLIST=` required and confirmed in-process |
| 4. §4.3 and V8 contradicted each other on sibling contributor edits | Yes | Conservative behaviour kept and stated; V8 corrected |
| 5. "Pause the cron in `vercel.json`" is wrong under Instant Rollback | Yes: Vercel docs [C43] | §7: project-level Disable Cron Jobs + verification |

Bucket 3 items are in §10; bucket 4 in §11.

## 10. Non-goals (declined; do not re-raise unless the reason is wrong)

- No user table, roles, Auth.js or magic links (D5).
- No media delete/replace/upload from admin (D4; issue #17).
- No hard delete; no immediate blob purge on delete (30-day grace). The one schema change is `Media.purgedAt` (3.6); no other migration, no new table, no `DELETED` status.
- No reversal of a purge once `purgedAt` is set, even if the memory is restored seconds later: intent is durable so a crash can never leave a READY row pointing at deleted bytes; the family rule stays "within 30 days".
- No blocking of Restore after 30 days: the words are still worth restoring; the UI says which files are gone.
- No approving a DRAFT from admin: the sender's Share press is the consent [C26]. Admin can edit a DRAFT's words and reissue its link.
- No editing of a contributor's email, or of `notifyWhenPosted` / `contactOptIn` / `mailingListOptIn`, from admin (3.5).
- No `?key=` query-string entry, not even as a fallback beside the fragment: one path, and the query form lands the secret in Next's and Vercel's request logs (3.3).
- No Gmail-message-id or SMS fields in the browser draft form: the family cannot supply them and `scripts/draft-memory.ts` / the skill already do; browser drafts are `source: OTHER`.
- No contributor merging or dedupe by email (Phase 3 in the design doc).
- No version check added to the claim form in this PR (A8): it is shared public UI touched by other open work.
- No `deletedAt` filter on cron step (e3) (3.6).
- No "posted" email on APPROVED (PR #30 F3); no public pages reading `APPROVED`/`HIDDEN` (not built yet).
- No paging beyond 200 rows, no sorting controls, no bulk actions.
- No `proxy.ts`: auth lives in every Server Function and route handler [C8].
- No route-group refactor of the public layout (A1).

## 11. Follow-ups (real, out of scope; file H/M as issues after merge; copy to the PR description)

| # | Item | Sev | What another agent needs |
|---|---|---|---|
| A1 | Move public pages into `app/(site)/` so admin pages drop the public header/footer | L | `app/layout.tsx` keeps html/body/fonts; `app/(site)/layout.tsx` gets `SiteHeader`/`SiteFooter`; `git mv` `page.tsx`, `share/`, `obituary/`, `m/`; relative `_components` imports gain one `../`. Do it when no other worktree touches those files. |
| A2 | Paging and sorting once the memorial passes ~200 memories | L | Cursor on `(createdAt, id)` in `listMemoriesForAdmin`; "Older" link carrying the cursor; keep `take: 200`. |
| A3 | Per-person attribution: `MemoryRevision.changedByUserId` is null for every admin change | M | Needs a user table (D5 says not now). Until then the revision says ADMIN only. |
| A4 | Media delete/replace/upload from admin | M | After issue #17 lands on the claim page: reuse `retireMedia`, the ticket flow and `finalizeUpload` behind `hasAdminSession()`. |
| A5 | "Nudge" button for DRAFT rows nobody shared (PR #30 F2's second half) | M | New `EmailType`, template in `services/email/templates/`, honour `OUTBOUND_*`; the admin detail already lists DRAFT age. |
| A6 | Claim form shows "Could not save. Please check the fields" for `not_found` (memory deleted while the page was open) | L | `app/m/[claimToken]/claim-form.tsx` message map: add `not_found` → "This memory is no longer available". |
| A7 | *(now in scope, 3.6)* | | |
| A8 | Claim form stale overwrite: the sender's old tab sends every field on save and overwrites an admin correction (reverse of 4.3) | M | Add `version` to `ClaimView` and `claimChangesSchema`, dirty-only submission in `claim-form.tsx`, `stale` in `updateMemoryFromClaim` with the same re-read protocol as 4.3. Touches public UI; coordinate with issue #17 work. |
| A9 | Vercel request-log retention for `POST /admin/enter` and admin paths | L | Method and path only; no secret. Review the project's log drain/retention once and record it in `docs/admin.md`. |

## 12. Files

New: `features/admin/{session,list-memories,get-memory,update-memory,set-status,set-deleted,create-draft}.ts`, `features/media/serve-media.ts`, `lib/validations/admin.ts`, `app/admin/{layout,page,actions,_session}.tsx|ts`, `app/admin/enter/page.tsx`, `app/admin/media/[id]/route.ts`, `app/admin/memories/[id]/page.tsx`, `app/admin/new/page.tsx`, `app/admin/{admin-shell,memory-list,memory-detail,status-badge,list-filters,media-gallery,history}.tsx`, `app/admin/{enter-form,memory-edit-form,status-actions-client,draft-form}.tsx`, `docs/admin.md`, `docs/plans/2026-11-04-admin-page.md`, tests in §6.

New (schema): `prisma/migrations/<ts>_media_purged_at/migration.sql`.

Changed: `prisma/schema.prisma` (`Media.purgedAt`), `server/config/env.ts`, `docs/environment.md`, `next.config.ts` (headers + `logging.serverFunctions: false`), `lib/sentry/scrub.ts`, `features/memories/lock.ts` (`lockContributor`), `features/memories/media-state.ts` (`appendRevision`), `app/api/media/[id]/route.ts` (thin adapter), `app/api/cron/reconcile-uploads/route.ts` (step (f) grace + three-phase purge), `__tests__/api/reconcile.test.ts`, `__tests__/lib/sentry-scrub.test.ts`, `__tests__/lib/env.test.ts`, `docs/plans/2026-11-03-draft-memory-on-behalf.md` (F2 line).

## 13. Citations

Quotes from Next.js are verbatim from the installed `node_modules/next/dist/docs/` (Next.js 16.4.4, the version this repo runs) and map to the nextjs.org URL given; `use-server`, `cookies` and `proxy` were also fetched live on 2026-11-04 and match. Prisma quotes are from the ORM v7 docs (the repo uses `@prisma/client` 7.10; the default prisma.io docs now describe ORM 8, whose query API differs). Vercel quotes were fetched live on 2026-11-04. Repo quotes are from `origin/main` @ `6210009` and marked (repo).

### [C1] — `connection()` makes everything after it request-time

- **Relevant File(s):** `app/admin/page.tsx`, `app/admin/memories/[id]/page.tsx`, `app/admin/new/page.tsx`
- **Change Summary:** Each page's dynamic child awaits `connection()` before reading cookies, search params or the database.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/connection
- **Verbatim Quote:**
  > "The `connection()` function allows you to indicate rendering should wait for an incoming user request before continuing."
- **Justification:** The house Cache Components rule requires the first thing a dynamic page does to be `await connection()` so the Neon driver and env are never touched during a build or prefetch prerender.

### [C2] — `searchParams` and cookies must be read inside `<Suspense>`

- **Relevant File(s):** `app/admin/page.tsx`
- **Change Summary:** The `searchParams` promise is passed into a Suspense-wrapped child and awaited there (`status`, `q`, `deleted`).
- **Source URL:** https://nextjs.org/docs/app/guides/migrating-to-cache-components#cookies-headers-and-searchparams
- **Verbatim Quote:**
  > "Your page receives `params` and `searchParams` as props, and both are promises. Apply the same pattern: pass the promise straight through to the `<Suspense>`-wrapped component as a prop and `await` it there, rather than at the top of the page."
- **Justification:** Reading `searchParams` at the top of the page would block the static shell.

### [C3] — Validate `searchParams` like any client input

- **Relevant File(s):** `app/admin/page.tsx`, `lib/validations/admin.ts`
- **Change Summary:** List filters from the query string go through `adminListQuerySchema`; nothing about authorisation is read from the URL.
- **Source URL:** https://nextjs.org/docs/app/guides/data-security#validating-client-input
- **Verbatim Quote:**
  > "You should always validate input from client, as they can be easily modified. For example, form data, URL parameters, headers, and searchParams:"
- **Justification:** The docs' "BAD" example is `isAdmin` read from `searchParams`; this plan never derives any permission from the URL.

### [C4] — Cookies can only be set in a Server Function or Route Handler

- **Relevant File(s):** `app/admin/actions.ts` (`enterAdmin`, `leaveAdmin`)
- **Change Summary:** The entry step is a Server Function that sets the cookie and redirects; sign-out is a Server Function that deletes it.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/cookies#good-to-know
- **Verbatim Quote:**
  > "HTTP does not allow setting cookies after streaming starts, so you must use `.set` in a [Server Function](/docs/app/getting-started/mutating-data) or [Route Handler](/docs/app/api-reference/file-conventions/route)."
- **Justification:** The entry page itself cannot set the cookie; the client component hands the key to a Server Function.

### [C5] — Recommended cookie options

- **Relevant File(s):** `features/admin/session.ts` (`adminCookieOptions`)
- **Change Summary:** `httpOnly`, `secure` (https site URL), `sameSite: "lax"`, `maxAge` 30 days, `path: "/admin"`.
- **Source URL:** https://nextjs.org/docs/app/guides/authentication#3-setting-cookies-recommended-options
- **Verbatim Quote:**
  > "- **HttpOnly**: Prevents client-side JavaScript from accessing the cookie.
  > - **Secure**: Use https to send the cookie.
  > - **SameSite**: Specify whether the cookie can be sent with cross-site requests.
  > - **Max-Age or Expires**: Delete the cookie after a certain period.
  > - **Path**: Define the URL path for the cookie."
- **Justification:** Each option in `adminCookieOptions()` maps to one line of this list.

### [C6] — Authenticate inside every Server Function, from cookies

- **Relevant File(s):** `app/admin/actions.ts`, `app/admin/_session.ts`
- **Change Summary:** Every mutating action's first statement is `hasAdminSession()`, which reads the cookie; only the login step accepts a credential parameter.
- **Source URL:** https://nextjs.org/docs/app/api-reference/directives/use-server#authentication-and-authorization
- **Verbatim Quote:**
  > "Always authenticate and authorize users before performing sensitive server-side operations. Read authentication from cookies or headers rather than accepting tokens as function parameters."
- **Justification:** Direct instruction for the shape of `actions.ts` and for why the secret lives in a cookie after entry.

### [C7] — Page-level gating is not a security boundary

- **Relevant File(s):** `app/admin/actions.ts`
- **Change Summary:** The gate in each page is not relied on; each Server Function re-checks (V14, B14).
- **Source URL:** https://nextjs.org/docs/app/guides/server-actions#security
- **Verbatim Quote:**
  > "**Authenticate and authorize.** Render-time gating (only rendering a form on an authenticated page) is not a security boundary, because requests can be sent without going through the UI."
- **Justification:** Justifies the duplicated check in every action and the replay test.

### [C8] — No proxy: Server Functions are POSTs to their page

- **Relevant File(s):** `app/admin/actions.ts` (and the absence of `proxy.ts`)
- **Change Summary:** Auth is in each function and route handler, not in a proxy matcher.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/proxy#execution-order
- **Verbatim Quote:**
  > "A matcher change or a refactor that moves a Server Function to a different route can silently remove Proxy coverage. Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone."
- **Justification:** Chooses per-function checks over a `proxy.ts`, which the repo does not have.

### [C9] — `redirect()` in Server Functions

- **Relevant File(s):** `app/admin/actions.ts`
- **Change Summary:** `enterAdmin` and `leaveAdmin` redirect to `/admin` after setting or deleting the cookie; calls sit outside `try`.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/redirect#behavior
- **Verbatim Quote:**
  > "In Server Actions and Route Handlers, redirect should be called **outside** the `try` block when using `try/catch` statements."
- **Justification:** Shapes the control flow of both actions.

### [C10] — `notFound()` after streaming keeps a 200

- **Relevant File(s):** `app/admin/memories/[id]/page.tsx`
- **Change Summary:** A missing memory id calls `notFound()` inside the Suspense child, accepting a 200 with the not-found UI (same as `/m/[claimToken]`).
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/not-found#calling-notfound-after-streaming-has-started
- **Verbatim Quote:**
  > "The response starts streaming from the `<Suspense>` boundary before `notFound()` runs, so it keeps its `200` status. Next.js adds a `noindex` tag."
- **Justification:** Documents the known trade-off so reviewers do not flag the status code.

### [C11] — Reading cookies from `NextRequest` in a route handler

- **Relevant File(s):** `app/admin/media/[id]/route.ts`
- **Change Summary:** The media route reads `request.cookies.get(ADMIN_COOKIE)` as its first request-time read.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/proxy#using-cookies
- **Verbatim Quote:**
  > "Cookies are regular headers. On a `Request`, they are stored in the `Cookie` header. On a `Response` they are in the `Set-Cookie` header. Next.js provides a convenient way to access and manipulate these cookies through the `cookies` extension on `NextRequest` and `NextResponse`."
- **Justification:** `NextRequest.cookies` is the documented accessor, read before any database call (Cache Components rule), and keeps the handler a plain function the route tests can call.

### [C12] — `maxDuration` on the page; removed segment configs

- **Relevant File(s):** `app/admin/page.tsx`, `app/admin/memories/[id]/page.tsx`, `app/admin/new/page.tsx`, `app/admin/enter/page.tsx`, `app/admin/layout.tsx`
- **Change Summary:** `export const maxDuration = 30` on each page that hosts Server Functions; no `dynamic`, `revalidate`, `fetchCache`, `dynamicParams` or `runtime` exports.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/maxDuration#server-actions and https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#version-history
- **Verbatim Quote:**
  > "If using [Server Actions](/docs/app/getting-started/mutating-data), set the `maxDuration` at the page level to change the default timeout of all Server Actions used on the page."
  > "`v16.0.0` | `dynamic`, `dynamicParams`, `revalidate`, and `fetchCache` removed when [Cache Components](/docs/app/api-reference/config/next-config-js/cacheComponents) is enabled."
- **Justification:** Matches the house rule and PR #30's pages.

### [C13] — `router.refresh()` keeps client state

- **Relevant File(s):** `app/admin/memory-edit-form.tsx`, `app/admin/status-actions-client.tsx`, `app/admin/draft-form.tsx`
- **Change Summary:** After a successful save the client calls `router.refresh()`; because it preserves client-side state, the stale flow remounts the form with `key={versions}` when the user chooses Reload.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/use-router#userouter
- **Verbatim Quote:**
  > "`router.refresh()`: Refresh the current route. Making a new request to the server, re-fetching data requests, and re-rendering Server Components. The client will merge the updated React Server Component payload without losing unaffected client-side React (e.g. `useState`) or browser state (e.g. scroll position)."
- **Justification:** Explains why a refresh alone cannot reset uncontrolled inputs and the hidden versions (review round 2, point 3), and why the form is keyed.

### [C14] — No prefetching of admin routes

- **Relevant File(s):** `app/admin/layout.tsx`, `app/admin/memory-list.tsx`
- **Change Summary:** `export const prefetch = "force-disabled"` on the admin segment and `<Link prefetch={false}>` on every admin link.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/prefetch#force-disabled and https://nextjs.org/docs/app/api-reference/components/link#prefetch
- **Verbatim Quote:**
  > "Never prefetch this segment. The client will not request segment data ahead of navigation. Use this for segments where prefetching would be wasteful, for example pages behind authentication that are rarely visited."
  > "`false`: Prefetching will never happen both on entering the viewport and on hover."
- **Justification:** 200 list rows behind auth; prefetching them would be wasteful and `connection()` would block them anyway.

### [C15] — `robots` metadata merging

- **Relevant File(s):** `app/admin/layout.tsx`
- **Change Summary:** The admin layout exports `robots: { index: false, follow: false }`, overriding the root layout's metadata for everything under `/admin`.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/generate-metadata#merging
- **Verbatim Quote:**
  > "This means metadata with nested fields such as [`openGraph`](/docs/app/api-reference/functions/generate-metadata#opengraph) and [`robots`](/docs/app/api-reference/functions/generate-metadata#robots) that are defined in an earlier segment are **overwritten** by the last segment to define them."
- **Justification:** One export in the nested layout covers all admin pages.

### [C16] — `Referrer-Policy` header via `next.config.ts`

- **Relevant File(s):** `next.config.ts`
- **Change Summary:** Add a `/admin/:path*` entry with `Referrer-Policy: no-referrer` and `X-Robots-Tag`, beside the existing `/m/:path*` entry.
- **Source URL:** https://nextjs.org/docs/app/api-reference/config/next-config-js/headers#referrer-policy
- **Verbatim Quote:**
  > "[This header](https://developer.mozilla.org/docs/Web/HTTP/Headers/Referrer-Policy) controls how much information the browser includes when navigating from the current website (origin) to another."
- **Justification:** Admin pages link out (claim links, Blob presign redirects); `no-referrer` keeps admin URLs out of other hosts' logs.

### [C18] — Prisma `mode: "insensitive"` for the search box

- **Relevant File(s):** `features/admin/list-memories.ts`
- **Change Summary:** The `q` filter uses `{ contains: q, mode: "insensitive" }` on four string fields combined with `OR`.
- **Source URL:** https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference#mode
- **Verbatim Quote:**
  > "Get all `Post` records where `title` contains `prisma`, in a case insensitive way"
  > ```
  > const result = await prisma.post.findMany({
  >   where: {
  >     title: {
  >       contains: "prisma",
  >       mode: "insensitive",
  >     },
  >   },
  > });
  > ```
- **Justification:** Exact query shape for a family typing "joyce" to find "Joyce".

### [C19] — Case-insensitive filtering is PostgreSQL-specific

- **Relevant File(s):** `features/admin/list-memories.ts`
- **Change Summary:** Relies on Postgres (Neon) for `mode: "insensitive"`.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/queries/filtering-and-sorting#case-insensitive-filtering
- **Verbatim Quote:**
  > "For PostgreSQL, Prisma Client also supports specific case-insensitive filter modes on supported operators."
- **Justification:** Confirms the option is valid for this database.

### [C20] — `crypto.createHmac`

- **Relevant File(s):** `features/admin/session.ts`
- **Change Summary:** The cookie value is `issuedAt.HMAC-SHA256(secret, "v1:" + issuedAt)`, so the raw secret is never stored in the browser and the server can enforce the 30-day limit.
- **Source URL:** https://nodejs.org/api/crypto.html#cryptocreatehmacalgorithm-key-options
- **Verbatim Quote:**
  > "Creates and returns an `Hmac` object that uses the given `algorithm` and `key`."
- **Justification:** Standard-library primitive for a keyed, deterministic derivation that changes whenever the secret does.

### [C21] — Constant-time comparison for cookies and secrets

- **Relevant File(s):** `features/admin/session.ts` (via `lib/claim-token.ts` `safeEqualHex`, which wraps `timingSafeEqual`)
- **Change Summary:** Key and cookie checks use `safeEqualHex`, never `===`.
- **Source URL:** https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b
- **Verbatim Quote:**
  > "This function does not leak timing information that would allow an attacker to guess one of the values. This is suitable for comparing HMAC digests or secret values like authentication cookies"
- **Justification:** Exactly the two things compared here: an HMAC digest (cookie) and a secret (entry key).

### [C22] — Layering: only `app/api/**` may import `services/` (repo)

- **Relevant File(s):** `features/media/serve-media.ts`, `app/api/media/[id]/route.ts`, `app/admin/media/[id]/route.ts`
- **Change Summary:** The media-serving body moves into `features/` so both routes share it.
- **Source URL:** `AGENTS.md` (repo), "Layers and import direction"
- **Verbatim Quote:**
  > "Pages and Server Functions call `features/`; route handlers under `app/api/` may also call `services/` directly (they are the HTTP adapter layer); nothing in `app/` imports `integrations/`."
- **Justification:** The admin media route lives under `/admin` (cookie path) and so cannot import `services/`; `features/` can.

### [C23] — Cron step (f) purges blobs of soft-deleted memories (repo)

- **Relevant File(s):** `app/api/cron/reconcile-uploads/route.ts`
- **Change Summary:** Add a 30-day grace and run each purge under the memory lock with a re-check.
- **Source URL:** `app/api/cron/reconcile-uploads/route.ts` on `origin/main` @ `6210009`, comment above step (f)
- **Verbatim Quote:**
  > "(f) Purge: blobs of soft-deleted memories and of files removed through the claim page, only those this environment uploaded (preview/dev Neon branches hold copies of production rows and share the store). Only rows with a blob still recorded are selected, so a purged row is never re-selected."
- **Justification:** Without the grace, the first family "Delete" would destroy originals within the hour; without the lock, a Restore during a run would still lose them.

### [C24] — `reissueDraftClaimLink` is conditional on DRAFT (repo, PR #30)

- **Relevant File(s):** `app/admin/actions.ts` (`reissueLink`)
- **Change Summary:** The admin "New link" button calls the existing function unchanged.
- **Source URL:** https://github.com/RobertdWray/jowray_com/pull/30 (description, "What changes")
- **Verbatim Quote:**
  > "`features/memories/draft-memory.ts`: `draftMemory` (duplicate pre-check inside the tx, P2002 fallback outside it, no orphan Contributor) and `reissueDraftClaimLink` (conditional on `status = DRAFT`; a deliberate revocation)."
- **Justification:** The UI shows the button only for DRAFT rows, and the function refuses anything else.

### [C25] — `lockMemory` serialises writes to one memory (repo)

- **Relevant File(s):** `features/memories/lock.ts` (`lockContributor` added beside it), `features/admin/update-memory.ts`, `features/admin/set-status.ts`, `features/admin/set-deleted.ts`, `app/api/cron/reconcile-uploads/route.ts`
- **Change Summary:** Every admin write and every purge takes the `FOR UPDATE` lock and re-reads before deciding; contributor edits also lock the contributor row.
- **Source URL:** `features/memories/lock.ts` on `origin/main` @ `6210009`
- **Verbatim Quote:**
  > "Serialise every change to one memory's media. Interactive transactions run at READ COMMITTED, so two removals could each count two live files and both proceed; a `FOR UPDATE` lock on the parent row makes the second wait for the first to commit and then re-read. The id travels as a bound parameter."
- **Justification:** The same reasoning applies to admin saves racing a Share, to two admins on sibling memories (one contributor row), and to purge racing restore.

### [C26] — `consentedAt` is null only while DRAFT (repo)

- **Relevant File(s):** `features/admin/set-status.ts`
- **Change Summary:** Status changes refuse DRAFT rows with code `draft`.
- **Source URL:** `prisma/schema.prisma` on `origin/main` @ `6210009`, `Memory.consentedAt`
- **Verbatim Quote:**
  > "null only while status = DRAFT (CHECK constraint Memory_consent_when_not_draft); stamped when the person presses Share"
- **Justification:** Approving a DRAFT from admin would either violate the CHECK or require the admin to stamp consent the sender never gave.

### [C27] — PR #30 declared "no admin UI" as a non-goal and F2 as the follow-up (repo)

- **Relevant File(s):** `docs/plans/2026-11-03-draft-memory-on-behalf.md` (one-line F2 update), this plan
- **Change Summary:** This PR delivers F2's "admin view of DRAFT rows" without the Auth.js precondition, by Rob's 2026-11-04 decision.
- **Source URL:** https://github.com/RobertdWray/jowray_com/pull/30 (description, §10 and §11)
- **Verbatim Quote:**
  > "**No admin UI, no listing of drafts.** Rob watches rows in Prisma Studio or the Neon console, as for every other memory in Phase 1. Follow-up F2."
  > "F2 | Admin view of DRAFT rows: who was drafted, who pressed Share, nudge the rest | M | Phase 3 scope (design doc \"Manage\"). Needs auth first (Auth.js magic link, `AUTH_SECRET` placeholder exists)."
- **Justification:** Records that the precondition was consciously replaced by a shared-secret page (D1, D2, D5).

### [C30] — Client Components are recognised by file name (repo)

- **Relevant File(s):** `app/admin/enter-form.tsx`, `app/admin/memory-edit-form.tsx`, `app/admin/status-actions-client.tsx`, `app/admin/draft-form.tsx`
- **Change Summary:** Admin client files use the `*-form.tsx` / `*-client.tsx` suffixes.
- **Source URL:** `eslint.config.mjs` on `origin/main`, client-component rule comment
- **Verbatim Quote:**
  > "Client Components by convention: *-form.tsx, *-client.tsx, recorder.ts, use-*.ts, instrumentation-client.ts."
- **Justification:** The `no-restricted-imports` guard against `@/server` and `@/integrations` applies by file name, not by directive.

### [C31] — Sentry scrubbing covers every URL-carrying field (repo)

- **Relevant File(s):** `lib/sentry/scrub.ts`
- **Change Summary:** Extend the query-parameter regex from `t=` to `(t|key)=` and accept `#` as a delimiter.
- **Source URL:** `lib/sentry/scrub.ts` on `origin/main`, header comment
- **Verbatim Quote:**
  > "Claim tokens travel in the URL (`/m/<token>`, `?t=<token>`). Sentry events, transactions, spans and breadcrumbs all carry URLs, so every one of them is passed through here on the server and in the browser before it leaves the process."
- **Justification:** The browser SDK records `location.href` including the fragment; the same single choke point must strip the key.

### [C32] — Env sub-schema and docs row to mirror (repo)

- **Relevant File(s):** `server/config/env.ts`, `docs/environment.md`
- **Change Summary:** `adminPageSchema` / `getAdminPageEnv` and the `ADMIN_PAGE_SECRET` row copy the existing shape, including empty-string normalisation.
- **Source URL:** `server/config/env.ts` and `docs/environment.md` on `origin/main` @ `6210009`
- **Verbatim Quote:**
  > "// `ADMIN_API_SECRET=` (empty) means unset, like the other optional keys, so the routes fail closed with 401 rather than 500.
  > ADMIN_API_SECRET: z.preprocess((value) => (value === \"\" ? undefined : value), z.string().min(32, \"ADMIN_API_SECRET must be at least 32 characters\").optional()),"
  > "| `ADMIN_API_SECRET` | Bearer secret for the admin API (`POST /api/admin/memories`, `POST /api/admin/memories/[id]/claim-link`), used by `scripts/draft-memory.ts` for the `jowray-draft-memory` skill. 32+ characters; the routes answer 401 to everything when it is unset. Production + local `.env` (same value in both). Generate with `openssl rand -hex 32`. |"
- **Justification:** House rule: each task adds its own lazily parsed sub-schema; `ADMIN_PAGE_SECRET=` must mean signed-out, not a 500.

### [C33] — Tailwind arbitrary breakpoint for the three-column layout

- **Relevant File(s):** `app/admin/admin-shell.tsx`
- **Change Summary:** `min-[100rem]:grid-cols-[…]` adds the third column on displays 1600 CSS px and wider.
- **Source URL:** https://tailwindcss.com/docs/responsive-design#using-arbitrary-values
- **Verbatim Quote:**
  > "If you need to use a one-off breakpoint that doesn't make sense to include in your theme, use the `min` or `max` variants to generate a custom breakpoint on the fly using any arbitrary value."
- **Justification:** One admin-only breakpoint does not belong in the site theme next to `wide`/`narrow`.

### [C34] — Uncached data outside `<Suspense>` fails the build

- **Relevant File(s):** `app/admin/page.tsx`, `app/admin/memories/[id]/page.tsx`, `app/admin/new/page.tsx`
- **Change Summary:** All `connection()`/database access sits inside a Suspense child with a fallback.
- **Source URL:** https://nextjs.org/docs/app/guides/ai-agents#built-in-guidance-for-errors
- **Verbatim Quote:**
  > "`fetch(...)` or `connection()` accessed outside of `<Suspense>` prevents the route from being prerendered, blocking the page load and leading to a slower user experience."
- **Justification:** `npm run build:offline` must pass with no database.

### [C36] — Server Function return values are shaped for the UI

- **Relevant File(s):** `features/admin/get-memory.ts`, `features/admin/list-memories.ts`, `app/admin/actions.ts`
- **Change Summary:** DTOs (§4.1) omit `claimTokenHash`, `blobUrl`, `storageKey` and `exif`; actions return the unions in §4.2.
- **Source URL:** https://nextjs.org/docs/app/guides/server-actions#security
- **Verbatim Quote:**
  > "**Constrain return values.** Action returns are serialized to the client. Shape them to what the UI renders, not raw database records."
- **Justification:** The admin list has every memory; a raw row would ship the token hash and internal fields to the browser.

### [C38] — `headers()` `source` path matching

- **Relevant File(s):** `next.config.ts`
- **Change Summary:** `source: "/admin/:path*"` covers `/admin`, `/admin/enter`, `/admin/media/<id>` and `/admin/memories/<id>`.
- **Source URL:** https://nextjs.org/docs/app/api-reference/config/next-config-js/headers#path-matching
- **Verbatim Quote:**
  > "You can use modifiers on parameters: `*` (zero or more), `+` (one or more), `?` (zero or one). For example, `/blog/:slug*` matches `/blog`, `/blog/a`, and `/blog/a/b/c`."
- **Justification:** Confirms that the bare `/admin` gets the `Referrer-Policy` and `X-Robots-Tag` headers.

### [C39] — Vercel Instant Rollback keeps the old deployment's environment values

- **Relevant File(s):** `docs/admin.md`, §7 of this plan
- **Change Summary:** Rotation runbook states that an older production deployment still holds the previous `ADMIN_PAGE_SECRET`; rollback floor recorded.
- **Source URL:** https://vercel.com/docs/instant-rollback
- **Verbatim Quote:**
  > "There are no change in Environment Variables, and they will remain in their original state"
- **Justification:** A rotated secret does not reach a rolled-back or older deployment, so those URLs must be protected (C40) and the floor respected.

### [C40] — Vercel Standard Protection covers every URL except production domains

- **Relevant File(s):** §7 step 3 (Rob), `docs/admin.md`
- **Change Summary:** Rob enables Standard Protection so past production deployment URLs stop being publicly reachable.
- **Source URL:** https://vercel.com/docs/deployment-protection#standard-protection
- **Verbatim Quote:**
  > "Standard Protection is the recommended option for most projects. It protects all domains except [production domains](https://vercel.com/docs/domains/working-with-domains/add-a-domain)."
  > "(Legacy) Pre-Production Deployments … In contrast, all production URLs, including any past or current generated production branch URLs like `*-main.vercel.app`, remain accessible."
- **Justification:** Without Standard Protection an older deployment with the old secret in its environment stays reachable at its generated URL.

### [C41] — Next's dev request logger prints the full request URL (installed runtime)

- **Relevant File(s):** 3.3 (fragment entry), 3.4 residual exposure list
- **Change Summary:** The key is carried in the URL fragment and the Server Function body, never in a request URL.
- **Source URL:** `node_modules/next/dist/server/dev/log-requests.js` (Next.js 16.4.4), `logIncomingRequests`
- **Verbatim Quote:**
  > "const url = isRSC ? (0, _url.stripNextRscUnionQuery)(request.url) : request.url;"
- **Justification:** Neither Pino redaction nor the Sentry scrubber touches this logger, so a `?key=` entry would be printed in full (review round 2, point 6); a fragment is never part of `request.url`.

### [C43] — Vercel's Disable Cron Jobs setting persists across Instant Rollback

- **Relevant File(s):** §7 rollback floor, `docs/admin.md`
- **Change Summary:** Emergency rollback below the floor first disables cron jobs at the project level, never by editing `vercel.json`.
- **Source URL:** https://vercel.com/docs/cron-jobs/manage-cron-jobs#rollbacks-with-cron-jobs
- **Verbatim Quote:**
  > "The Disable Cron Jobs setting applies to the project and persists across deployment promotions and [Instant Rollbacks](https://vercel.com/docs/instant-rollback). If you disable cron jobs, they remain disabled until you explicitly re-enable them in the project's Cron Jobs settings."
- **Justification:** A rollback restores the target deployment's cron definitions, so only the project-level switch reliably keeps the old purge from running.

### [C44] — Next logs Server Function arguments in development unless disabled

- **Relevant File(s):** `next.config.ts` (`logging.serverFunctions: false`), §6 B2
- **Change Summary:** The entry key travels as a Server Function argument, so argument logging is switched off and the dev log is grepped for the secret value.
- **Source URL:** https://nextjs.org/docs/app/api-reference/config/next-config-js/logging#server-functions (installed docs `01-next-config-js/logging.md`, "Server Functions")
- **Verbatim Quote:**
  > "[Server Function](https://react.dev/reference/rsc/server-functions) invocations are logged by default during development. You can disable this by setting `logging.serverFunctions` to `false`."
  > "When enabled, the terminal displays each Server Function call with its function name, arguments, and duration:"
- **Justification:** `node_modules/next/dist/server/dev/log-requests.js:49-50` formats `serverActionLog.args` into the line; without the switch the key would be printed as `enterAdmin({"key":"…"})` (review round 3, point 2).

### [C45] — Outbound email guard: allowlisted recipients bypass `OUTBOUND_ENABLED=false` (repo)

- **Relevant File(s):** §5 safe verification environment
- **Change Summary:** The local walk sets `OUTBOUND_ALLOWLIST=` as well as `OUTBOUND_ENABLED=false` before any cron run.
- **Source URL:** `services/email/index.ts` on `origin/main` @ `6210009`, `outboundAllowed`
- **Verbatim Quote:**
  > "function outboundAllowed(recipient: string): boolean {
  >   const env = getOutboundEnv();
  >   return env.OUTBOUND_ENABLED || env.OUTBOUND_ALLOWLIST.includes(recipient);
  > }"
- **Justification:** A developer's own allowlisted address would still receive confirmations from a copied database during verification (review round 3, point 3).

### [C46] — Deploys run migrations on every build (repo, PR #30 plan)

- **Relevant File(s):** `prisma/schema.prisma`, `prisma/migrations/<ts>_media_purged_at/migration.sql`
- **Change Summary:** The `purgedAt` column ships as one expand-only migration that the production deploy applies before the new cron code runs.
- **Source URL:** `docs/plans/2026-11-03-draft-memory-on-behalf.md` §12 [C1] on `origin/main` (quoting `vercel.json`)
- **Verbatim Quote:**
  > "`vercel.json`; migrations must be expand-only · `\"buildCommand\": \"npx prisma migrate deploy && npx prisma db seed && npm run build\"` (per Phase 1 plan Task 3 step 8, which also says every migration must be backward-compatible)"
- **Justification:** Adding a nullable column is backward-compatible: the running old code ignores it, the new code reads it only after its own deploy.

### [C42] — `draftMemoryInputSchema` ties `source` to the `sourceRef` prefix (repo)

- **Relevant File(s):** `features/admin/create-draft.ts`
- **Change Summary:** Browser drafts are always `source: "OTHER"` with `otherSourceRef(email, note)`.
- **Source URL:** `lib/validations/memory.ts` on `origin/main` @ `6210009`
- **Verbatim Quote:**
  > ".refine((value) => value.sourceRef.startsWith(SOURCE_REF_PREFIX[value.source]), {
  >     message: \"sourceRef must match source (EMAIL ↔ gmail:, SMS ↔ sms:, OTHER ↔ other:)\",
  >     path: [\"sourceRef\"],
  >   });"
- **Justification:** An `EMAIL` draft with an `other:` reference is rejected by the merged validator (review round 2, point 1); the form therefore has no source select, and V11 exercises the real schema.
