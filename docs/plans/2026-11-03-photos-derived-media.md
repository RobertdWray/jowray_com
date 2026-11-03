# Photos and media: derived web copies, remove/replace/add, multi-file memories (issue #17)

Written 2026-11-03 against `main` @ `636ddfd` (PR #16 merged 19:12 UTC). Issue: https://github.com/RobertdWray/jowray_com/issues/17.
Repo: `RobertdWray/jowray_com` (from `git remote -v`). Default branch `main`. Citations are `[C#]` inline and collected in § 10.
Reviewed twice before approval: pre-mortem 1 (Claude Plan agent) and pre-mortem 2 (GPT-6 Astra, run `20261103T193954Z-a8f353e3`, report retained at that run's worktree `docs/plans/reviews/2026-11-03-issue17-premortem-astra.md`). § 8 lists every finding and where it landed.

## 0. Cold start: read this first

- **What this is.** Three PRs (A, B, C) that fix issue #17 and lay the data model for richer confirmation emails (follow-on PR D) and the Phase 2 family site. Each PR: own branch, own PR, TDD on every upload/finalize/confirm/cron path, one additive Prisma migration `[C26, C33]`.
- **Order and ownership (2026-11-03, Rob).** A from `main` now, **implemented by the email session `25e018cf-d54b-4ecb-b9a6-fcce1e2f0c62`**; that session ships its email-template PR without image processing and consumes PR A's `DerivedMedia` rows after A merges. B and C are implemented by this session, each in its own git worktree (never in the main checkout: other agents work there). B is rebased onto `main` after A merges; C follows B. Nothing else blocks (PR #16 is in `main`).
- **PR A scope amendment (2026-11-03, Rob).** PR A also owns the email thumbnail: `DerivedKind.THUMBNAIL` (1000 px long edge, alpha flattened onto `#fffdf8`, JPEG q72 `mozjpeg`, re-encoded at q60 if over 350 KB, else `FAILED too_large`), produced from the **same decode** as `WEB_IMAGE`. `DerivedKind.POSTER` is reserved now with the staging-key contract from the email plan (`/Users/rob/.claude/plans/please-use-worldclass-email-fancy-mountain.md` § 3.1 and § 3.4) `[C47]`. HEIC decodes in a `worker_threads` Worker with `resourceLimits` and `terminate()` on deadline (`lib/heic-worker.ts`) `[C44]`, in addition to the per-instance semaphore. See § 3.2.
- **Resume protocol (after a compaction or handoff).** Read `AGENTS.md`, `docs/plans/2026-11-02-bootstrap-report.md`, `docs/plans/phase1-ledger.md`, then this file's `## Progress`. Verify `git remote -v`, current branch, `HEAD` and dirty paths before any action; preserve unrelated work. Copy this plan into the repo once (PR A) at `docs/plans/2026-11-03-photos-derived-media.md`; B and C edit that tracked copy. Record for each step: status, commit SHA, migration folder, the actual check output, evidence paths, blockers, next action. Verify recorded commits exist. The orchestrator owns the ledger, installs, deployments and external checks; a worker's "done" is not acceptance.
- **Rules that bind every step** `[C33, C34, C37]`: `app → features → services → integrations`; `features/` never imports `integrations/`; `integrations/` may import only **types** from `services/` (so shared runtime classes live in `lib/`); `lib/validations` never imports `features/` (so shared constants live in `lib/`); Client Components are named `*-client.tsx` / `*-form.tsx` so the lint guard applies and never import `@/server` or `@/integrations`; zod schemas live in `lib/validations/*` and are parsed inside `features/*`, Server Functions stay thin; `import "server-only"` on anything that reads secrets; Pino via `lib/logger`, ids only; `await connection()` first in dynamic pages, `request.nextUrl` first in handlers `[C12, C14]`; no `eslint-disable`, no band-aids, no submodules, never print a claim token.
- **Checks at every checkpoint:** `npm run validate && npm run test:run && npm run build:offline` with no `.env*`.
- **Migrations.** Generate only against a disposable database identified by `DATABASE_URL_UNPOOLED` (a Neon preview branch or local Postgres), never inferred from an env filename; record the migration folder and the `prisma migrate diff` result. Prove A alone, then A+B, then A+B+C. Schema and history stay additive; never reset production. Rollback note: once B writes `Media.deletedAt`, pre-B serving code would show removed files again, so a rollback of B is a compatibility fix-forward, not a revert. Purged blobs are irreversible.
- **Don't re-ask Rob** the four decisions in § 2. The planner's calls (P1–P18) are overridable but already applied.

## 1. Context

A production memory at www.jowray.com shows `Download IMG_8487.HEIC (this browser cannot display image/heic)` instead of the photo. The code is correct (`isRenderableIn`, `lib/media-types.ts:122-132`); the browser cannot decode HEVC and no renderable copy exists. iPhones shoot HEIC by default. Two feature gaps share the same code: the claim page cannot remove or replace a file (`app/m/[claimToken]/claim-form.tsx:46-76` adds only), and `/share` accepts one file per memory (`lib/validations/memory.ts:40`), which forces a shoebox of photos into N memories, N claim links and N emails against a 3-per-recipient-per-day cap (`services/email/index.ts:16-25`) `[C39]`.

Verified facts that shape the design:

- `sharp@0.35.5` ships only as Next's optional dependency and its prebuilt libvips has no HEVC decoder `[C1, C2]` (measured: `libde265` missing). `heic-decode@2.1.0` (libheif in WASM, LGPL-3.0, embedded wasm via `libheif-js/wasm-bundle`) decodes the sample in ~0.7 s and `.all()` exposes width/height **before** decoding `[C3, C4, C40]`.
- Vercel Fluid compute: per-function memory **cannot** be set in `vercel.json` `[C20]`; default 2 GB `[C19]`; invocations share one instance, so two concurrent decodes share one heap.
- The Phase 2 design (`docs/Memorial Memories Site initial thinking.md:293-301, 449`) already specifies `DERIVED_MEDIA` and "derived files live under a separate prefix" `[C36]`.
- The confirmation email is sent once per memory on the first READY file (`ingest-upload.ts:161`, `confirm.ts:49,63`) `[C39]`; `Memory.type` is set once from the single file.
- Upload tickets expire 15 min after minting and `/api/upload` enforces expiry at token exchange (`lib/upload-ticket.ts:15`, `app/api/upload/route.ts:50`); the Blob client token itself lives 1 h (`route.ts:20`) `[C38]`.
- `confirmMemory` without a raw token (cron path) **rotates** the claim token (`confirm.ts:53-66`). Cron step (e) sends for any memory older than 30 min with a note or a READY file; a single 45-minute upload today already races it. Every request-path confirmation must happen while the raw token is on hand and cron must be held off for the life of a submission.
- Prisma interactive transactions run at the database default isolation (READ COMMITTED on Postgres) `[C41]`; the existing `$transaction` wrappers bound time, not concurrency. Count-based invariants need a row lock `[C42]`.
- `design/DESIGN.md` § 6 forbids fixed heights and modals, uses only the `sm:` breakpoint, and requires the page to look finished at 390 px `[C35]`.

## 2. Decisions from Rob (2026-11-03)

| Decision | Ruling |
|---|---|
| Which photos get a derived web copy | **Every photo.** HEIC via WASM decoder, the rest via sharp. Uniform sizes for Phase 2 and emails; EXIF (incl. GPS) stripped from everything served inline; originals untouched. |
| Multi-file UI | **Every device**, one `multiple` input, responsive rows. No desktop/phone fork. |
| Unit of a multi-file submission | **One Memory, many Media of mixed kinds** (photos, video, audio recording). One claim link, one email, one consent record. |
| Serving before/without a sanitized copy | **Placeholder until sanitized; originals downloadable.** Inline views only ever serve a derived copy (the claim page shows "Preparing your photo…" for a few seconds; a failed derivation shows the download link). The claim-link holder can still download the untouched original with its EXIF. Phase 2 family pages serve derivatives only. |
| Email thumbnail and poster | **PR A owns `THUMBNAIL`** (spec in § 0) and **reserves `POSTER`** with the email plan's staging-key contract; the email session consumes READY `THUMBNAIL` rows after A merges (§ 3.6). |
| HEIC decode isolation | **`worker_threads` Worker** with `resourceLimits` and `terminate()` on deadline (`lib/heic-worker.ts`), plus the semaphore. |

Planner's calls (overridable; listed so Rob can check them):

| # | Call | Why |
|---|---|---|
| P1 | `DerivedMedia` table (kinds `WEB_IMAGE`, `THUMBNAIL`), not columns on `Media` `[C36]` | Matches the Phase 2 design; one-to-many per original; PR D adds thumbnails without reshaping. |
| P2 | Output container follows the source: HEIC/HEIF/JPEG → JPEG q85; PNG → PNG; WebP → WebP q85; GIF → GIF with animation preserved (`animated: true`) `[C9, C43]` | A JPEG of a transparent PNG or an animated GIF is a regression (PM1 #7); sharp re-encodes GIFs with metadata stripped, so no format needs an exception. Long edge 2048 px, `withoutEnlargement` `[C8]`. |
| P3 | Pixel ceiling 30 MP, recorded in the FAILED row as `too_many_pixels:30000000`; cron retries when the constant is raised `[C6, C19]` | Default iPhone HEIF is 12–24 MP; 48 MP shots need ~1.6 GB. Raising the constant heals old rows (PM1 #8). |
| P4 | A `DerivedMedia` row is **claimed** (`PENDING`, with its candidate `storageKey` already set) before any download or decode; `@@unique([mediaId, kind])` makes the race loser return at once `[C21, C25]` | PM1 #1/#4 (concurrent decodes, deleted good copy); PM2 #1 (a key allocated only at READY is lost if `put` succeeds and the DB write fails). |
| P5 | One decode at a time per instance (module-level semaphore in the integration), lazy `import()` of sharp and heic-decode | PM1 #1: Fluid shares one 2 GB heap `[C19, C20]`; `build:offline` and prerender never load WASM. |
| P6 | Soft delete (`Media.deletedAt`) with cron purge, mirroring `Memory.deletedAt`; purge selects only rows with outstanding cleanup work | Design doc: "nothing is hard-deleted"; idempotent purge `[C15]`; PM2 #6 (tombstones re-selected forever). |
| P7 | Replace = new PENDING row with `replacesMediaId` (one-to-many self relation, no unique); swap when the new file reaches READY, in one locked transaction that requires the target to still be live, else the replacement is cancelled `[C22, C23, C42]` | A failed upload never loses the old photo; PM2 #5 (removed photo resurfacing), PM2 #8 (one-to-one blocks retry after a FAILED attempt). |
| P8 | `Memory.type` recomputed on **every** media transition (READY, FAILED, remove, swap) and on note edits: live READY media VIDEO > VOICE > PHOTO; none with non-blank `contributorNote` → TEXT; none and no words → keep the provisional type and stay confirmation-ineligible | PM2 #12 (stale summary); Phase 2 reads media rows directly. |
| P9 | Non-empty invariant: the last live file of a memory with no words cannot be removed (`last_file`), and the note cannot be cleared when no live READY media exists (`last_words`) | PM1 #6 and PM2 #10: otherwise an empty memory becomes a "written memory" that gets confirmed. Captions never substitute for the note. |
| P10 | Multi-file: `createMemory` creates N PENDING rows but mints **no** tickets; the client asks for each ticket right before its upload (`issueUploadTicket`) `[C38]` | PM1 #2: pre-minted tickets expire mid-batch. |
| P11 | **Submission lease** `Memory.uploadLeaseUntil`: set on create (files > 0) and renewed to now + 70 min on every ticket issuance (≥ the 1 h Blob token); cron steps (d)/(e) skip memories whose lease is in the future; `completeSubmission` closes it and sends the one email with the raw token (`settleNow`); request-path `confirmQuietly` defers while a live PENDING row is younger than 15 min | PM1 #3 and PM2 #3: both the "young PENDING" rule and explicit completion lose to a 45-minute upload; the lease makes cron wait for the whole submission, and expiry (abandonment) hands over to cron's existing rotate-and-send. |
| P12 | File cap counts live READY **and** PENDING rows; a replacement may exceed it by one; one PENDING replacement per target; PENDING/FAILED reservations are visible on the claim page with **Retry** (re-issue the ticket for the same row) and **Cancel** (soft-delete the reservation) | PM1 #5 (unbounded PENDING rows) and PM2 #4 (invisible reservations block the cap for 24 h). |
| P13 | `Media.sortOrder` set at creation, copied on replace (B copies `sortOrder` only; C extends the copy to caption/date/place) | Order preserved; PM2 #9 (B must not reference C's columns). |
| P14 | Derived blobs are not counted in the daily byte budget | Strictly smaller than their originals, which already reserved `maxBytes`. |
| P15 | Every transaction that counts or mutates a memory's media first takes `SELECT id FROM "Memory" WHERE id = $1 FOR UPDATE` via `tx.$queryRaw` (`lockMemory(tx, memoryId)` in `features/memories/lock.ts`) `[C41, C42]` | PM2 #10: READ COMMITTED lets two removals each see two files. A row lock is cheaper and simpler than `Serializable` with retries. |
| P16 | `ImageDeriveError` lives in `lib/image-derive-error.ts`; `MAX_FILES_PER_MEMORY` moves to `lib/media-types.ts` (re-exported from `create-memory.ts`) | PM2 #11 and § 4.5: integrations may import only types from services; `lib/validations` cannot import `features`. |
| P17 | Inline image requests without a READY `WEB_IMAGE` row answer 404; the claim page decides from `ClaimView` what to render (picture, placeholder, or download link) and polls `router.refresh()` every 3 s for up to 30 s while a derivation is PENDING | Rob's serving decision; the page, not the image URL, carries the state. Audio/video keep presigning the original (no derivatives yet). |
| P18 | One shared eligibility predicate and one conditional reclaim statement for derivations, used by both the feature and cron (§ 3.2) | PM2 #7: the feature's "existing row → skipped" contradicted cron's retry selection. |
| P19 | `WEB_IMAGE` and `THUMBNAIL` come from one decode: the integration returns both encodings from a single decoded pixel buffer; each kind keeps its own `DerivedMedia` row, key and publish `[C9, C45, C46]` | Rob's amendment: the HEIC decode is the expensive step (~0.7 s locally, more on Vercel); decoding twice would double peak memory and time. |
| P20 | The HEIC decode runs in `lib/heic-worker.ts` (`worker_threads`, `eval: true` script that requires `heic-decode`, RGBA buffer transferred back, `resourceLimits: { maxOldGenerationSizeMb: 512 }`, `terminate()` at the deadline) and is still serialised by the semaphore `[C3, C44]` | Rob's amendment; `heic-decode` blocks its thread, so only a worker can be interrupted; the deadline becomes `FAILED timeout` (retryable like `decode_failed`). |
| P21 | `POSTER` is reserved now: enum value, `posterStagingKeyFor()`/`isStagingKey()` in `lib/derived-keys.ts`, media route and email consumers refuse `*.upload.jpg`, purge deletes staging keys; no POSTER rows are created in A–C `[C47]` | Rob's amendment: the email plan's video-poster flow lands later and must not need a second migration or a second key scheme. |

## 3. Target design

### 3.1 Data model (additive migrations, one per PR) `[C21, C22, C26]`

```prisma
// PR A
enum DerivedKind   { WEB_IMAGE  THUMBNAIL  POSTER }  // POSTER reserved (P21); WEB_AUDIO, WEB_VIDEO when Phase 2 builds them [C36]
enum DerivedStatus { PENDING  READY  FAILED }

model DerivedMedia {
  id         String        @id @default(uuid())
  mediaId    String
  media      Media         @relation(fields: [mediaId], references: [id])
  kind       DerivedKind
  status     DerivedStatus @default(PENDING)
  storageKey String        @unique     // candidate key set at claim time: <env derived prefix><memoryId>/<uuid>.<ext>; the blob exists only once READY
  mimeType   String?                   // image/jpeg | image/png | image/webp | image/gif
  sizeBytes  Int?
  width      Int?
  height     Int?
  error      String?                   // too_many_pixels:<limit> | decode_failed | timeout | too_large | unsupported_type
  attempts   Int           @default(0)
  claimedAt  DateTime?                 // stale after 10 min
  createdAt  DateTime      @default(now())
  updatedAt  DateTime      @updatedAt
  @@unique([mediaId, kind])            // one row per kind; the race loser gets P2002 [C21, C25]
  @@index([status, updatedAt])
}
// Media gains: derivatives DerivedMedia[]

// PR B (on Media)
deletedAt       DateTime?              // soft delete (removed file, cancelled reservation, cancelled replacement)
replacesMediaId String?                // PENDING replacement points at the row it will retire; one-to-many, no unique [C22]
replaces        Media?   @relation("Replacement", fields: [replacesMediaId], references: [id])
replacements    Media[]  @relation("Replacement")
sortOrder       Int       @default(0)
// + @@index([memoryId, deletedAt]), @@index([replacesMediaId])

// PR C (on Media)
caption         String?                // per-file words, max 2000
approxDateText  String?                // per-file, max 120
place           String?                // per-file, max 200
// PR C (on Memory)
uploadLeaseUntil DateTime?             // submission lease; cron (d)/(e) wait while it is in the future
```

`Media.storageKey` and `checksumSha256` are untouched: the original is never rewritten.

### 3.2 Derivation pipeline (PR A)

```
lib/image-derive-error.ts    class ImageDeriveError extends Error { code: "too_many_pixels" | "decode_failed" | "timeout" | "too_large" | "unsupported_type"; limit?: number }   [P16]
lib/derived-keys.ts          server-only, pure [C47]: derivedKeyFor(storageKey, ext) → `${derivedPrefix()}${memoryId}/${randomUUID()}.${ext}`;
                             posterStagingKeyFor(storageKey) → `${derivedPrefix()}${memoryId}/${originalUuid}.upload.jpg` (deterministic from the original's key);
                             isStagingKey(key) → key.endsWith(".upload.jpg"). Invariant D2 (copied from the email plan § 3.1): final derived keys are written only by the
                             server from bytes it decoded and re-encoded; staging keys hold untrusted browser bytes and are never attached to an email or served.
lib/heic-worker.ts           server-only [C44]: decodeHeicInWorker(buffer, { deadlineMs, maxPixels }) → { width, height, data: Uint8ClampedArray }.
                             new Worker(<eval script that requires "heic-decode", calls decode.all, checks width*height ≤ maxPixels, decodes images[0], posts { width, height, data } with data.buffer in the transferList>, { eval: true, workerData: { buffer, maxPixels }, transferList: [buffer.buffer], resourceLimits: { maxOldGenerationSizeMb: 512 } })
                             A timer at deadlineMs calls worker.terminate() and rejects with ImageDeriveError("timeout"); the worker's 'error' event with ERR_WORKER_OUT_OF_MEMORY → ImageDeriveError("too_many_pixels") (limit = maxPixels); any other 'error' → "decode_failed". The semaphore (below) still ensures one worker at a time per instance.
services/images/types.ts     interface ImageService { derive(input: Buffer, opts): Promise<DerivedSet> }   (types only)
                             opts = { sourceMime; deadlineMs; maxPixels: 30_000_000; web: { maxEdge: 2048; quality: 85 }; thumb: { maxEdge: 1000; quality: 72; fallbackQuality: 60; maxBytes: 350_000; background: "#fffdf8" } }
                             Encoded = { data: Buffer; mimeType; extension; width; height }
                             DerivedSet = { sourceWidth; sourceHeight; web: Encoded; thumb: Encoded | { failed: "too_large" } }
services/images/index.ts     createImageService() → cached SharpHeicImageService
integrations/images/sharp-heic.ts   import "server-only"; lazy `await import("sharp")`; module-level semaphore (1) around decode+encode
   DECODE ONCE (P19):
   image/heic | image/heif   decodeHeicInWorker(input, { deadlineMs, maxPixels }) [C3, C40, C44] → base = sharp(data, { raw: { width, height, channels: 4 } }) [C6]  (libheif applies irot/imir; the rotated.heic fixture proves it)
   image/gif                 base = sharp(input, { animated: true, limitInputPixels: maxPixels }) [C43]  (web copy keeps animation; thumbnail uses page 0 via sharp(input, { page: 0 }))
   image/jpeg|png|webp       base = sharp(input, { limitInputPixels: maxPixels }).rotate() [C6, C7]  (sharp's limit error → too_many_pixels)
   anything else             throw unsupported_type
   ENCODE TWICE from base.clone():
   web   non-gif: .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }) [C8] → .jpeg({ quality: 85 }) | .png() | .webp({ quality: 85 }) [C9]
         gif:     .resize({ width: 2048, withoutEnlargement: true }).gif() [C43]
   thumb .flatten({ background: "#fffdf8" }) [C45] → .resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true }) [C8] → .jpeg({ quality: 72, mozjpeg: true }) [C46]
         → if data.length > 350_000: re-encode once at quality 60; if still > 350_000 → thumb = { failed: "too_large" } (web is unaffected)
   metadata is stripped by default on every output [C9]

features/memories/derive-media.ts     deriveMedia({ mediaId, deadlineMs, now = new Date() }): Promise<Record<"WEB_IMAGE" | "THUMBNAIL", "derived" | "failed" | "not_eligible" | "claimed_elsewhere">>
   ELIGIBLE(row) := row is null
                 || (row.status === PENDING && (row.claimedAt === null || row.claimedAt < now - 10 min))
                 || (row.status === FAILED && (row.error === "decode_failed" || row.error === "timeout") && row.attempts < 3)
                 || (row.status === FAILED && row.error starts with "too_many_pixels:" && Number(limit) < MAX_PIXELS)
                 (FAILED too_large and unsupported_type are terminal)
   1. media.findUnique incl. memory.deletedAt + derivatives(kind in [WEB_IMAGE, THUMBNAIL]). Not eligible unless media READY, image/*, media.deletedAt null (PR B), memory live, storageKey startsWith storagePrefix().
   2. CLAIM each eligible kind (both normally; one when the other is already READY/terminal). If no row: derivedMedia.create({ mediaId, kind, status: PENDING, storageKey: derivedKeyFor(storageKey, ext), claimedAt: now, attempts: 1 }); on P2002 [C25] re-read the row and fall through.
      If row and ELIGIBLE: storage.del(row.storageKey) (idempotent; removes a half-written candidate) [C15], then
        n = derivedMedia.updateMany({ where: { id: row.id, status: row.status, claimedAt: row.claimedAt, attempts: row.attempts },
                                      data: { status: PENDING, claimedAt: now, attempts: { increment: 1 }, error: null, storageKey: derivedKeyFor(storageKey, ext) } })
        n === 1 → claimed; n === 0 → "claimed_elsewhere" for that kind. If row and not ELIGIBLE → "not_eligible". If nothing was claimed → return.
   3. storage.get(media.storageKey) → Buffer (≤ 25 MB) [C15, C16]
   4. imageService.derive(input, { ..., deadlineMs }) once → for each claimed kind: storage.put(claim.storageKey, encoded.data, encoded.mimeType) [C15]  (THUMBNAIL claimed but thumb.failed → skip the put)
   5. PUBLISH each claimed kind inside one $transaction with lockMemory(tx, memoryId) [C42]: re-check media live; derivedMedia.updateMany({ where: { id, status: PENDING, claimedAt: now, attempts: claim.attempts }, data: { status: READY, mimeType, sizeBytes, width, height } }) must affect 1 row, else storage.del(claim.storageKey) and "claimed_elsewhere"; THUMBNAIL with thumb.failed → conditional update to FAILED `too_large`; media.update width/height from sourceWidth/Height when null.
      on ImageDeriveError (decode failed for both kinds): conditional update of every claimed row to FAILED with error (`too_many_pixels:${limit}` | `decode_failed` | `timeout` | `unsupported_type`); storage.del(candidates) (nothing was written).
      on anything else: conditional update to FAILED `decode_failed`, log.error { mediaId }, Sentry.captureException(err, { tags: { mediaId } }) [C31]; never the token.
Triggers:
   finalizeUpload (ingest-upload.ts:161-168)              afterWithFlush: computeChecksum, then deriveMedia({ deadlineMs: 20_000 }) when READY and image/* [C10]
   /api/upload onUploadCompleted (upload/route.ts:75-104) same afterWithFlush after recordMedia READY, deadlineMs: 15_000 [C10, C17]
   cron step (g)                                          candidates = READY image media, prefix-scoped, memory live, media live, with for either kind `derivatives: { none: { kind } }` OR `some: { kind, <ELIGIBLE translated to a where> }` [C24]; oldest first, take 3, DERIVE_DEADLINE_MS = 30_000 checked before each and passed as deadlineMs [C18]; response counts gain `derived`
Config:  next.config.ts serverExternalPackages: ["heic-decode", "libheif-js"] (sharp is already on Next's default list; the worker `require`s heic-decode from node_modules) [C5]
         package.json: "sharp": "0.35.5" (pinned to Next's copy) [C1], "heic-decode": "^2.1.0" [C3]
         lib/site-url.ts: derivedPrefix() → "derived/" | "preview/derived/" | "dev/derived/" beside storagePrefix() [C36]
```

Purge (§ 3.4) leaves a `DerivedMedia` row alone while it is PENDING and `claimedAt` is younger than 10 min, so a worker never races the purge for the same key. Purge also deletes `posterStagingKeyFor(storageKey)` best-effort for every selected media (P21).

### 3.3 Serving (PR A; 404-on-removed in PR B) `[C12, C13, C15, C16]`

`/api/media/[id]` reads `request.nextUrl` first (`t`, `download`, new `v`) `[C12]`:

| Request | Serves |
|---|---|
| inline, no `v` (default) | image/*: READY `WEB_IMAGE` derivative, else **404** (P17). audio/video: original (as today) |
| `v=thumb` | READY `THUMBNAIL` (PR D), else web, else 404 |
| `v=original` or `download=1` | original; `download=1` keeps the streamed `Content-Disposition` path (Rob: originals stay downloadable) |

Same `PROTECTIVE_HEADERS`, same 60 s presign, same token gate; derived blobs are private too `[C16]`. The claim page renders from `ClaimView.media[].web = { status: "ready" | "pending" | "failed" | "none", mimeType? }`: ready → `<Image unoptimized>` of the inline URL `[C13]`; pending → "Preparing your photo…" placeholder and a small `derive-poll-client.tsx` that calls `router.refresh()` every 3 s for up to 30 s; failed → "We could not prepare this photo for the page" + the download link; `isRenderableIn` is still consulted with the derived MIME.

### 3.4 Remove, replace, add, reservations (PR B)

- **Validation** in `lib/validations/media.ts` (new): `claimMediaRefSchema = { claimToken: 16..128, mediaId: uuid }`, `replaceRequestSchema = claimMediaRefSchema + file` `[C27]`; parsed inside the features `[C37]`.
- **`features/memories/lock.ts`** `lockMemory(tx, memoryId)` = `tx.$queryRaw\`SELECT "id" FROM "Memory" WHERE "id" = ${memoryId} FOR UPDATE\`` `[C42]`; every tx below calls it first (P15).
- **`features/memories/claim.ts`**
  - `removeMediaFromClaim(raw)` — locked tx `[C23]`: memory by token hash (live) → media belongs and `deletedAt null` → if it is the only live READY row and `contributorNote` is blank → `last_file` → else set `deletedAt`, soft-delete any PENDING replacements of it (their blobs, if any arrived, purge via (f)), recompute type (P8), `MemoryRevision` CLAIM_LINK with before/after `{ mediaIds, type, ...fields }` `[C11]`. Codes `ok | not_found | invalid | last_file`.
  - `cancelReservation(raw)` — same shape for a PENDING or FAILED row of the memory: set `deletedAt`, revision row. Frees a cap slot.
  - `createReplacementTicket(raw)` — locked tx: target live; refuse if a live PENDING row already has this `replacesMediaId`; cap `pendingOrLive < MAX_FILES_PER_MEMORY + 1`; budget check; `createPendingMedia` with `replacesMediaId` and `sortOrder` copied (C adds the three fields); renew lease (C); mint ticket `[C38]`.
  - `updateMemoryFromClaim` gains the `last_words` refusal (P9) and the type recompute.
  - `getMemoryForClaim` returns live rows (`deletedAt null`) of all statuses, ordered by `sortOrder, createdAt`, each with `status`, `web` state, `renderMimeType`, `sortOrder`, `isReplacementOf`.
- **`features/memories/ingest-upload.ts`** — `transition()` to READY runs in a locked tx `[C23]`: conditional update to READY (P2025 → `lost_race` `[C25]`); if `replacesMediaId`: `updateMany({ where: { id: replacesMediaId, deletedAt: null }, data: { deletedAt: now } })` must return 1, otherwise the new row is soft-deleted instead (target already removed; PM2 #5) and the tx still commits; revision row; type recompute (also on FAILED).
- **Live-only reads everywhere:** media route (404 for `deletedAt`), both ticket caps (`status in [PENDING, READY] and deletedAt null`), `confirm.ts` READY count, cron (a)(b)(e)(g), `/api/upload` `onBeforeGenerateToken` (`status PENDING && deletedAt null`) `[C17]`.
- **Cron step (f) → purge** `[C15, C18]`: `media` where `(memory.deletedAt not null OR media.deletedAt not null)` AND `storageKey startsWith storagePrefix()` AND (`blobUrl not null` OR `derivatives: { some: { status: { not: PENDING } } }` OR `derivatives: { some: { status: PENDING, claimedAt: { lt: now - 10 min } } }`), ordered by `id`, take 50 → `storage.del(storageKey)` if `blobUrl`, `storage.del(derivative.storageKey)` for each selected derivative, then `blobUrl = null` and delete those `DerivedMedia` rows. A second run selects nothing (test with 51 tombstones).
- **Server Functions** in `app/m/[claimToken]/actions.ts`: `removeFile`, `cancelReservation`, `replaceFileTicket`, `retryReservationTicket` (→ `issueUploadTicket`), thin `[C11, C37]`.
- **UI:** `app/m/[claimToken]/media-list-client.tsx` `[C34]`: one card per live row. READY → picture/placeholder/player per § 3.3, per-file fields (C), **Remove** (two-step inline: "Remove this photo?" → "Yes, remove" / "Keep it"; no modal `[C35]`), **Replace** `<input type="file">` `[C28]`. PENDING/FAILED → "Not received yet" / "Could not be received" with **Try again** and **Cancel**. **Add** input below. Both forms share `lib/upload-client.ts#uploadWithTicket(grant, file, onProgress)` (wraps `@vercel/blob/client` `upload()` with `access: "private"`, `handleUploadUrl: "/api/upload"`, `multipart: true`, `contentType`, `clientPayload`) `[C15, C17]`; it imports nothing server-side `[C34]`.
- `summarizeMemoryType(media: { mimeType }[], hasWords: boolean)` in `lib/media-types.ts` beside `memoryTypeFor`; MIME normalised first (P8).

### 3.5 Multi-file memories and the submission lease (PR C)

- **Validation** `[C27]`: `createMemoryInputSchema.files = z.array(fileInputSchema.extend({ caption?: ≤2000, approxDateText?: ≤120, place?: ≤200 })).max(MAX_FILES_PER_MEMORY)` (constant from `lib/media-types.ts`, P16); refine `files.length > 0 || note`. `uploadTicketRequestSchema.file` gains the same fields. `issueTicketSchema = { claimToken, mediaId }`, `mediaChangesSchema`.
- **`features/memories/create-memory.ts`**: `createMemory` creates N PENDING rows in the one tx (`sortOrder = index`, budget sums all `maxBytes`, `type = summarizeMemoryType(normalised files, hasWords)`, `uploadLeaseUntil = now + 70 min` when N > 0) `[C23]` and returns `{ memoryId, claimToken, media: [{ mediaId, sortOrder }], emailed }` with **no** tickets (P10). `issueUploadTicket(raw)`: locked tx; row PENDING, belongs to the memory, `deletedAt null` → renew lease → `mintUploadTicket` `[C38]`. `createUploadTicket` and `createReplacementTicket` also renew the lease.
- **`features/memories/confirm.ts`**: `confirmMemory({ memoryId, claimToken?, settleNow? })`. `not_ready` when (as today) nothing to confirm, or when a live PENDING row is younger than `TICKET_TTL_MS` **unless `settleNow`**. The cron path additionally returns `leased` while `uploadLeaseUntil > now` (and cron steps (d)/(e) exclude such memories in their `where`). `received` becomes `{ counts: { photo, video, voice }, hasWords }`. New `completeSubmission({ claimToken })`: locked tx sets `uploadLeaseUntil = null`, then `confirmMemory({ memoryId, claimToken, settleNow: true })`; idempotent; errors are caught and reported without ever hiding the claim link. Text-only submissions complete inside `createMemory` as today.
- **`services/email/templates/memory-confirmation.ts`**, `services/email/types.ts`: `describeReceived` renders "3 photos, a video and a voice recording" (singular/plural; no user text echoed) `[C30, C39]`.
- **`app/share/share-form.tsx`** `[C28, C29, C35]`: `multiple` on the one file input. State machine: `editing → creating → uploading(rowIndex, progress) → completing → done | partial`. Rows `{ id, file, previewUrl: string | null, caption, approxDateText, place, outcome?: "ready" | "pending" | "failed" }`; a recorded clip is appended as a row and never discards others. Selection, edits, removal and recording are disabled from `creating` on. `createMemory({ ..., files })` → map client rows to `media[]` by `sortOrder` → for each row sequentially `issueUploadTicket` → `uploadWithTicket` → `finalizeUpload` (PENDING means "still checking", not failed) → `finally` `completeSubmission({ claimToken })`. The claim link is shown as soon as creation succeeds and survives every later failure; `partial` lists the rows that did not arrive and says the link's page can retry them. Thumbnails via `URL.createObjectURL`, revoked on remove, reset and unmount `[C29]` (HEIC previews draw only in Safari; otherwise filename + size). Layout `flex flex-wrap`, rows side by side from `sm:`, stacked at 390 px; no `<table>`, no fixed heights `[C35]`. Progress label "Uploading 2 of 5… 40%".
- **Claim page**: `media-list-client.tsx` edits per-file fields through `updateMediaFromClaim` (revision row) `[C11]`.

### 3.6 Consumer contract for the email session and the reserved POSTER kind

The email session (`25e018cf…`) ships its template PR without image processing and, after PR A merges, reads thumbnails from `DerivedMedia`:

- A usable thumbnail is exactly a row with `kind = THUMBNAIL`, `status = READY`, `storageKey` under `derivedPrefix()` and **not** `isStagingKey()`, `mimeType = "image/jpeg"`, `sizeBytes ≤ 350_000`, `width`/`height` set. Consumers read the bytes with `storage.get(storageKey)` and attach them **inline as CID attachments** `[C30]`; they never build a URL from the key and never read PENDING or FAILED rows. A `FAILED too_large` thumbnail means "use the no-image card".
- The email must not wait for derivation: `completeSubmission`/`confirmMemory` send with whatever THUMBNAIL rows are READY at that moment (the derive runs in `after()` of the same finalize, typically finishing within seconds; cron (g) backfills the rest for later surfaces).
- `POSTER` (video) is reserved: the enum value exists, `posterStagingKeyFor()`/`isStagingKey()` exist, the media route answers 404 for any staging key, and purge deletes staging keys. The browser-capture flow, the `kind: "poster"` upload ticket and `attachPosterPreview` are defined in the email plan § 3.4 `[C47]` and will create POSTER rows through the same claim/publish protocol (§ 3.2) in a later PR; A–C create none.
- Phase 2 family pages and PR #16's `notifyWhenPosted` notification reuse the same rows.

## 4. Steps

Every step: tests first (Vitest; mocks at the `@/server/db/client`, `@/services/storage`, `@/services/images` boundaries; `afterWithFlush` captured into an array, exactly as `__tests__/features/ingest-upload.test.ts:25-55` does; the transaction stub must now also expose `$queryRaw` for `lockMemory`) `[C32, C33]`, then implementation, then the checkpoint. Record the exact command and result in `## Progress`.

### PR A — `feat/derived-web-images` (branch from `main`)

1. **Deps and config** `[C1, C3, C4, C5]`: `sharp@0.35.5`, `heic-decode@^2.1.0`; `serverExternalPackages: ["heic-decode", "libheif-js"]`; LGPL-3.0 note for `libheif-js` in `docs/environment.md`. Done-check: `npm ls sharp` shows one copy; `npm run build:offline` downloads nothing.
2. **Schema + migration** `prisma/migrations/2026110320xxxx_derived_media/` `[C21, C26]`. Done-check: `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$DATABASE_URL_UNPOOLED"` reports no difference.
3. **`lib/site-url.ts#derivedPrefix()`** `[C36]` + `__tests__/lib/site-url.test.ts` (new). **`lib/image-derive-error.ts`** (P16). **`lib/derived-keys.ts`** `[C47]` + `__tests__/lib/derived-keys.test.ts`: `derivedKeyFor` under the env prefix with a fresh uuid; `posterStagingKeyFor` deterministic from the original key and ending `.upload.jpg`; `isStagingKey` true only for that suffix.
4. **Fixtures** (commit the files and the tool versions in a `__tests__/fixtures/README.md`): `magick -size 64x48 xc:red /tmp/issue17-tiny.png && heif-enc --hevc -q 85 -o __tests__/fixtures/tiny.heic /tmp/issue17-tiny.png`; `magick -size 64x48 xc:red -fill blue -draw 'rectangle 0,0 15,15' /tmp/issue17-oriented.png && heif-enc --hevc --rotate-cw 90 -q 85 -o __tests__/fixtures/rotated.heic /tmp/issue17-oriented.png` (expect 48×64 decoded, blue landmark top-right). CI needs no encoder.
5. **`lib/heic-worker.ts`** `[C3, C44]` with `__tests__/lib/heic-worker.test.ts`: decodes `tiny.heic` to 64×48 RGBA in a worker; a stalled worker (test script that never posts) is terminated at the deadline and rejects with `timeout`; a buffer over `maxPixels` rejects with `too_many_pixels` without decoding; the worker exits after every call (no leaked threads).
6. **`services/images` + `integrations/images/sharp-heic.ts`** `[C6, C7, C8, C9, C43, C45, C46]` with `__tests__/integrations/images.test.ts`: one `derive()` call returns `web` and `thumb`; in-test PNG/JPEG with `withMetadata({ orientation: 6 })` → upright, web ≤2048 edge, thumb ≤1000 edge, no EXIF on either; PNG web stays PNG, thumb is JPEG; a transparent PNG's thumb has `#fffdf8` where it was transparent; animated GIF web stays animated, thumb is a single JPEG frame; `limitInputPixels` → `too_many_pixels` with limit; both HEIC fixtures decode with the expected size and landmark; a noisy 1000×1000 input whose q72 and q60 encodings both exceed 350 KB → `thumb.failed === "too_large"` with `web` intact; corrupt buffer → `decode_failed`; semaphore serialises two concurrent calls.
7. **`features/memories/derive-media.ts`** `[C10, C15, C24, C25, C31, C42]` with `__tests__/features/derive-media.test.ts`: both rows claimed (with keys) before `storage.get`; one decode per call (image service mock called once); P2002 then not-eligible → `not_eligible`; stale PENDING reclaimed (old key deleted, new key set); fresh PENDING → `claimed_elsewhere`; publish conditional on `claimedAt/attempts`; READY rows + width/height filled; `too_many_pixels:<limit>` FAILED on both; `timeout` and `decode_failed` increment attempts and stay eligible until 3; `too_large` on THUMBNAIL only with WEB_IMAGE READY; unexpected error → FAILED + Sentry with `mediaId` only.
8. **Triggers** `[C10, C17, C18]`: `finalizeUpload` (20 s) and `/api/upload` (15 s) afterWithFlush; cron step (g) with the shared predicate over both kinds, `derived` count and 30 s deadline. Extend `__tests__/features/ingest-upload.test.ts`, `__tests__/api/upload.test.ts`, `__tests__/api/reconcile.test.ts` (one derive per run, each retry rule, deadline, prefix-scoped, counts object at `reconcile.test.ts:124`).
9. **Serving** `[C12, C13, C16, C47]`: `/api/media/[id]` `v` param (`web` default, `thumb`, `original`), derivative selection, 404 for image inline without READY copy, 404 for any `isStagingKey()` key; `__tests__/api/media.test.ts`. `ClaimView.media[].web`; `page.tsx` placeholder/failed states; `derive-poll-client.tsx`.
10. **Docs:** plan copy under `docs/plans/`; `docs/code-layout.md` and the AGENTS.md copy gain `services/images`, `lib/image-derive-error.ts`, `lib/derived-keys.ts`, `lib/heic-worker.ts` and the derived prefix `[C33]`; the consumer contract (§ 3.6) copied verbatim into the plan copy; PR body carries § 6 and the preview note (§ 8, PM1 #10).

**Checkpoint:** `npm run validate && npm run test:run && npm run build:offline`. Commits `feat(media): …`.

### PR B — `feat/claim-remove-replace` (from `main` after A merges)

1. **Schema + migration** `…_media_soft_delete/` `[C21, C22, C26]`: `deletedAt`, `replacesMediaId` + one-to-many self relation, `sortOrder`, indexes.
2. **`lib/media-types.ts`**: `summarizeMemoryType`, `MAX_FILES_PER_MEMORY` moved here (P16) + tests; **`lib/validations/media.ts`** `[C27]` + `__tests__/lib/validations-media.test.ts`; **`features/memories/lock.ts`** `[C42]`.
3. **`features/memories/claim.ts`** `[C11, C23, C37, C38]`: `removeMediaFromClaim`, `cancelReservation`, `createReplacementTicket`, `last_words`, reads of all live statuses. Tests: wrong token, wrong memory, already removed, `last_file`, `last_words`, pending replacements cancelled on removal, revision with `mediaIds`, type recomputed; replacement copies `sortOrder`, cap `MAX+1`, second pending replacement refused; every tx calls `lockMemory` first.
4. **`ingest-upload.ts` swap on READY** `[C23, C25]`; tests: old row survives while PENDING, swapped on READY, replacement cancelled when the target was removed meanwhile, untouched on FAILED, type recomputed on READY and FAILED, lost race.
5. **Live-only everywhere** `[C17]`: both ticket caps, `confirm.ts`, cron (a)(b)(e)(g), `onBeforeGenerateToken`, media route 404. One-line test each.
6. **Cron (f) → purge** `[C15, C18]`; tests: original and derivative blobs deleted, rows cleaned, prefix-scoped, fresh PENDING claim skipped, 51 tombstones drain to zero on the second run.
7. **UI** `[C15, C17, C28, C34, C35]`: `lib/upload-client.ts` (share-form refactored onto it, behaviour unchanged), `media-list-client.tsx` with reservations, Server Functions `[C11]`. Copy per DESIGN.md § 7; 44 px targets, 17 px floor.
8. **Docs/progress.**

**Checkpoint** as above. Commits `feat(claim): …`.

### PR C — `feat/multi-file-memories` (from `main` after B merges)

1. **Schema + migration** `…_media_per_file_fields_lease/` `[C21, C26]`: `Media.caption/approxDateText/place`, `Memory.uploadLeaseUntil`.
2. **Validation** `[C27]`: `files[]`, `issueTicketSchema`, `mediaChangesSchema`; extend `__tests__/lib/validations-memory.test.ts` and `validations-media.test.ts`.
3. **`createMemory` N rows + lease, `issueUploadTicket`, lease renewal in all ticket paths, replacement copies the three fields** `[C23, C38]`; tests: 10 OK, 11 refused, budget sums all, type summarised, `sortOrder` sequential, no tickets returned, lease set/renewed, ticket refused for READY/foreign/removed rows.
4. **`confirm.ts` deferral + `leased` + `settleNow`, `completeSubmission`, cron (d)/(e) `where` excludes leased memories** `[C11, C39]`; template wording `[C30]`; tests in `__tests__/features/confirm.test.ts`, `__tests__/api/reconcile.test.ts`, `__tests__/services/email.test.ts`: defers under 15 min, cron skips a leased memory, `settleNow` sends with the READY count and no rotation, expired lease falls back to cron rotate-and-send, "3 photos, a video and a voice recording", "a written memory" unchanged.
5. **`updateMediaFromClaim`** + Server Function + revision `[C11]`; tests.
6. **Share form state machine** `[C28, C29, C35]` per § 3.5; `media-list-client.tsx` per-file field editing.
7. **Docs/progress**; ledger Task 7/8/10 HEIC lines and brand follow-up F7 marked "superseded by #17 PRs A–C; iPhone device pass still owed (Task 10 gate)".

**Checkpoint** as above. Commits `feat(share): …`.

## 5. Files touched

| Path | PR | Change | Cites |
|---|---|---|---|
| `package.json`, `package-lock.json` | A | `sharp` 0.35.5, `heic-decode` | C1, C3 |
| `next.config.ts` | A | `serverExternalPackages` | C4, C5 |
| `prisma/schema.prisma` + 3 migrations | A,B,C | § 3.1 | C21, C22, C26 |
| `lib/site-url.ts` | A | `derivedPrefix()` | C36 |
| `lib/image-derive-error.ts` (new) | A | shared runtime error class | C33 |
| `lib/derived-keys.ts` (new) | A | derived and poster-staging key scheme, `isStagingKey` | C47 |
| `lib/heic-worker.ts` (new) | A | `worker_threads` HEIC decode with `resourceLimits` and `terminate()` | C3, C44 |
| `lib/media-types.ts` | B | `summarizeMemoryType`, `MAX_FILES_PER_MEMORY` | C33 |
| `lib/upload-client.ts` (new) | B | shared client upload helper | C15, C17, C34 |
| `lib/validations/media.ts` (new), `lib/validations/memory.ts` | B,C | media refs; `files[]`; per-file fields | C27, C37 |
| `services/images/{types,index}.ts` (new) | A | decoder interface (types) + factory | C33 |
| `integrations/images/sharp-heic.ts` (new) | A | one decode → web + thumbnail encodings, GIF path, semaphore, lazy import | C1, C2, C3, C6, C7, C8, C9, C40, C43, C45, C46 |
| `features/memories/derive-media.ts` (new) | A | claim/reclaim/publish protocol | C10, C15, C24, C25, C31, C42 |
| `features/memories/lock.ts` (new) | B | `lockMemory` row lock | C41, C42 |
| `features/memories/ingest-upload.ts` | A,B | derive trigger; locked swap; type recompute | C10, C23, C25, C42 |
| `features/memories/create-memory.ts` | B,C | caps; N rows; `issueUploadTicket`; lease | C23, C38, C42 |
| `features/memories/claim.ts` | A,B,C | web state; remove/cancel/replace; `last_words`; per-file edit | C11, C23, C37, C42 |
| `features/memories/confirm.ts` | B,C | live-only; deferral; lease; `settleNow`; summary; `completeSubmission` | C39 |
| `services/email/templates/memory-confirmation.ts`, `services/email/types.ts` | C | per-kind wording | C30, C39 |
| `app/api/media/[id]/route.ts` | A,B | `v` param, derivative-only inline, 404 removed | C12, C13, C16 |
| `app/api/upload/route.ts` | A,B | derive trigger; live-only token | C10, C17 |
| `app/api/cron/reconcile-uploads/route.ts` | A,B,C | step (g); purge (f); live-only; lease-aware (d)/(e) | C15, C18, C24 |
| `app/m/[claimToken]/page.tsx`, `actions.ts`, `media-list-client.tsx` (new), `derive-poll-client.tsx` (new), `claim-form.tsx` | A,B,C | placeholder/failed states; remove/cancel/replace/retry/add; fields | C11, C13, C14, C28, C34, C35 |
| `app/share/share-form.tsx`, `app/share/actions.ts` | C | state machine, `multiple`, sequential uploads, `completeSubmission` | C11, C28, C29, C35 |
| `__tests__/**` incl. `__tests__/fixtures/{tiny,rotated}.heic`, `__tests__/fixtures/README.md` | all | per step | C32, C33 |
| `docs/plans/2026-11-03-photos-derived-media.md` (new), `docs/code-layout.md`, `AGENTS.md`, `docs/environment.md`, `docs/plans/phase1-ledger.md` | all | runbook, layer list, licence note, ledger | C4, C33 |

Not touched: `services/storage/*`, `integrations/vercel-blob/*` (`put/head/get/del/presignGet` suffice `[C15]`), `lib/upload-ticket.ts`, `server/config/env.ts` (no new env), `vercel.json` (schedule and `maxDuration` unchanged; memory is a dashboard setting `[C20]`).

## 6. Not doing (and why; copy into PR bodies)

1. Converting at request time in `/api/media/[id]`: a 1–3 s synchronous decode on every view `[C3]`.
2. Client-side HEIC→JPEG: does not fix stored files; Chrome/Firefox/Android cannot decode HEIC; Rob wants the original kept. (Informational iPhone test: whether dropping HEIC from `accept` makes iOS send JPEG.)
3. Render columns on `Media`: collides with the Phase 2 `DERIVED_MEDIA` design `[C36]`.
4. Desktop-only table via `matchMedia`: viewport fork against DESIGN.md § 6 `[C35]`.
5. One memory per photo: N emails against the 3/day cap `[C39]`.
6. Raising function memory per route: impossible under Fluid compute `[C20]`.
7. Pre-minting all tickets in `createMemory`: they expire in 15 min `[C38]`.
8. `Serializable` isolation instead of a row lock: needs retry loops everywhere `[C41]`; `FOR UPDATE` on the parent row is enough.
9. A full OPEN/COMPLETE/ABANDONED submission state machine (PM2 § 4.4): one lease column gives the same guarantees with one field.
10. Serving the original inline as a fallback: Rob chose placeholder-until-sanitized.
11. Range/206 for long-video seeking: unrelated, stays a Task 10 item.

## 7. Verification

Each row needs an executor, the deployment SHA, evidence path and pass/fail/blocked in `## Progress`. Mocked tests prove logic, not runtime.

| # | Check | Where | Pass condition |
|---|---|---|---|
| V1 | Unit + layering | local, CI | `npm run validate && npm run test:run && npm run build:offline` green with no `.env*`; no `eslint-disable`; no `console.log` |
| V2 | A2: new HEIC renders | Vercel preview; Chrome, Firefox, Safari | Upload a HEIC from an iPhone and from a desktop; placeholder shows, then (≤30 s) the photo, upright; `curl -sI` the inline URL → 302 Location contains `/derived/`; `?download=1` returns the original (`Content-Disposition` `.HEIC`, same `checksumSha256`) |
| V3 | Sanitized copies | preview | `exiftool` on the derived JPEG shows no GPS; PNG upload serves `image/png`; animated GIF still animates |
| V4 | A1: production memory | production after A merges | Within 10 min Rob's claim link shows the photo in Chrome; `vercel blob list` shows one `derived/` object; cron counts `derived: 1` then `0` |
| V5 | A3: failure paths | preview, a >30 MP and a corrupt `.heic` | FAILED rows `too_many_pixels:30000000` / `decode_failed` (3 attempts then stops), download link shown, Sentry event with `mediaId` only |
| V6 | Concurrency | preview, two HEICs finalised within a second, plus two removals fired together | One `DerivedMedia` row each, no duplicate blobs, no OOM in Vercel logs; the second removal returns `last_file` or `not_found`, never an empty wordless memory |
| V7 | B1/B2: remove, replace, cancel | preview | Remove hides at once, URL 404s, revision lists `mediaIds`; blobs gone after one cron run; replace keeps the old photo until READY; removing the target mid-replacement cancels the replacement; Cancel frees a slot |
| V8 | B3: caps | unit + preview | 10 live files refuse the 11th; replacing one of 10 works; second pending replacement refused |
| V9 | C1: five files, one memory | preview; desktop, then Safari iOS and Chrome Android | Five mixed JPEG/HEIC/.mov/recording → one memory, one claim link, one email with the right per-kind counts, five rows in order; 390 px has no horizontal scroll |
| V10 | C: lease and batch email | preview | Abandon one of three uploads: one email at `completeSubmission` saying "2 photos", on-screen link still works; a memory with a live lease is skipped by cron (e); after the lease expires cron sends and rotates |
| V11 | Token hygiene | Sentry, logs | No `/m/<token>` or `t=` in any event or log from the new code |
| V12 | A: thumbnail contract | preview | After V2, the same media has a READY `THUMBNAIL` row: `image/jpeg`, long edge ≤ 1000, `sizeBytes ≤ 350000`, no EXIF, transparent PNG flattened onto `#fffdf8`; `?v=thumb` serves it; a request for a `*.upload.jpg` key answers 404 |
| V13 | A: worker deadline | preview, Vercel logs | A deliberately stalled decode (test hook or a 29 MP HEIC on a cold instance) ends with `FAILED timeout`, the function returns normally, no orphaned worker thread in the next invocation's logs, and cron (g) retries up to 3 times |

## 8. Pre-mortem findings and where each landed

**Pre-mortem 1** (Claude Plan agent, 2026-11-03):

| # | Finding | Severity | Landed in |
|---|---|---|---|
| 1 | Three triggers decode the same HEIC concurrently on one Fluid instance → OOM | Critical | P4 claim row, P5 semaphore + lazy import |
| 2 | Pre-minted batch tickets expire mid-upload | High | P10 |
| 3 | Deferred batch email goes to cron, which rotates the token | High | P11 (superseded by the lease; see PM2 #3) |
| 4 | Race loser deletes the only good derivative; `decode_failed` permanent | High | P4, § 3.2 retry rules |
| 5 | Replacement tickets are an unbounded PENDING-row sink | Medium | P12 |
| 6 | Removing the last file makes an empty TEXT memory that gets confirmed | Medium | P9 |
| 7 | JPEG for every photo regresses GIF/PNG | Medium | P2 |
| 8 | 30 MP ceiling permanently fails 48 MP shots | Medium | P3 |
| 9 | Cron (g) overruns `maxDuration` | Medium | 30 s step deadline, take 3 |
| 10 | Preview branches hold prod rows without derivatives | Low | PR body note; ledger Task 10 checklist |

**Pre-mortem 2** (GPT-6 Astra, 2026-11-03):

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 1 | Derived key allocated only at READY is lost if `put` succeeds and the DB write fails | High | P4: candidate key stored on the PENDING claim; reclaim deletes it first |
| 2 | Default inline served the GPS-bearing original while the derivative was pending | High | Rob's fourth decision; P17 placeholder, 404 for inline without a READY copy |
| 3 | Cron sends and rotates during a legitimate 45-min upload; "young PENDING" and explicit completion both lose | High | P11 submission lease (simplified from the proposed state machine, § 6 #9) |
| 4 | Interrupted reservations are invisible and block the cap for 24 h | High | P12 Retry/Cancel on the claim page |
| 5 | Removed photo reappears through its pending replacement | High | P7: swap requires a live target, else cancels; removal cancels pending replacements |
| 6 | Purge selector re-selects tombstones forever | High | P6 outstanding-work selector; 51-tombstone test |
| 7 | Cron selects FAILED rows the feature then skips | High | P18 shared predicate + conditional reclaim |
| 8 | One-to-one self relation needs a unique FK and blocks retry after FAILED | High | P7 one-to-many |
| 9 | PR B copies PR C's columns | High | P13 |
| 10 | Count invariants unprotected at READ COMMITTED; note edits bypass P9 | High | P15 row lock; P9 `last_words` |
| 11 | Runtime error class in `services/` breaks the integrations import rule | Medium | P16 `lib/image-derive-error.ts` |
| 12 | `Memory.type` stale after ordinary READY/FAILED transitions | Medium | P8 recompute on every transition |
| § 4.1–4.9 | Context-survival gaps (resume protocol, migration contract, exact derivation protocol, lease, summary rules, share-form state machine, named test files, fixture commands, inherited decisions) | — | § 0, § 3.2, § 3.5, § 4, § 7 |
| § 4.7 | Prove competing mutations on a real PostgreSQL | — | Partly: V6 on a preview; no test database exists in this repo |
| § 4.9 | Provenance notes unrelated to #17 (focus outline, recorder cap) | — | Not adopted; already governed by the brand plan |

## 9. Risks and open items for Rob (none block PR A)

- **Memory on Vercel for a 24 MP HEIC**: ~0.8 GB locally; validate on a preview (V2, V6). If it OOMs at 2 GB, lower `MAX_PIXELS` to 20 MP or raise project memory in the dashboard `[C19, C20]`.
- **Licence**: `libheif-js` is LGPL-3.0 `[C4]` (server-side use; recorded in docs). HEVC decoding patents are a grey area shared by every HEIC tool; noted, not blocking.
- **iPhone device pass** (ledger Task 10 / F7) still has to run after C; this plan does not close it.
- **Astra run artifacts** for pre-mortem 2 are retained under `~/.local/state/astra-work/888f1417a12a/20261103T193954Z-a8f353e3/` (report only; nothing accepted, integrated or published).

## 10. Citations

### [C1] — sharp prebuilt binaries: supported input formats
- **Relevant File(s):** `package.json`, `integrations/images/sharp-heic.ts`
- **Change Summary:** Add `sharp` as a direct, pinned dependency for JPEG/PNG/WebP/GIF decoding and all encoding; it cannot decode HEIC on its own.
- **Source URL:** https://sharp.pixelplumbing.com/install/#prebuilt-binaries
- **Verbatim Quote:**
  > "This provides support for the JPEG, PNG, Ultra HDR, WebP, AVIF, TIFF, GIF and SVG (input) image formats."
  > "The use of a globally-installed libvips is unsupported on Windows and on macOS when running Node.js under Rosetta."
- **Justification:** HEIC is absent from the prebuilt input list and a custom libvips is not available on Vercel, so the integration decodes HEIC with a separate decoder and uses sharp only for the listed formats and for encoding.

### [C2] — sharp HEIF output: HEVC needs a custom libvips
- **Relevant File(s):** `integrations/images/sharp-heic.ts`
- **Change Summary:** Route `image/heic` and `image/heif` through the WASM decoder instead of `sharp(input)`.
- **Source URL:** https://sharp.pixelplumbing.com/api-output/#heif
- **Verbatim Quote:**
  > "Support for patent-encumbered HEIC images using hevc compression requires the use of a globally-installed libvips compiled with support for libheif, libde265 and x265."
- **Justification:** Confirms the codec gap observed in the measured `libde265` error; the integration's branch on `sourceMime` exists because of it.

### [C3] — heic-decode usage, `.all()` and the synchronous-work note
- **Relevant File(s):** `package.json`, `integrations/images/sharp-heic.ts`, `features/memories/derive-media.ts`
- **Change Summary:** Decode HEIC with `heic-decode`, check dimensions before decoding, and run the work in `after()`/cron rather than in a request handler.
- **Source URL:** https://github.com/catdad-experiments/heic-decode#usage
- **Verbatim Quote:**
  > "const images = await decode.all({ buffer });
  > // decode and use each image individually
  > const {
  > width,  // integer width of the image
  > height, // integer height of the image
  > data    // Uint8ClampedArray containing pixel data
  > } = await image.decode();"
  > "Note that while the decoder returns a Promise, it does the majority of the work synchronously, so you should consider using a worker thread in order to not block the main thread in highly concurrent production environments."
- **Justification:** The `.all()` shape gives width/height before `decode()` (the pixel ceiling); the synchronous note is why derivation is never on the request path and why one decode runs at a time per instance.

### [C4] — libheif-js wasm-bundle entry and LGPL-3.0 licence
- **Relevant File(s):** `next.config.ts`, `docs/environment.md`
- **Change Summary:** Mark `heic-decode`/`libheif-js` as server-external (no loose `.wasm` to trace) and record the LGPL-3.0 licence.
- **Source URL:** https://github.com/catdad-experiments/libheif-js
- **Verbatim Quote:**
  > "const libheif = require('libheif-js/wasm-bundle');"
  > "LGPL-3.0 license"
- **Justification:** `heic-decode@2.1.0/index.js` requires exactly this `wasm-bundle` entry (verified 2026-11-03 from the published file), so the wasm is embedded in JS and no file tracing is needed; the licence line is what the docs note records.

### [C5] — Next.js `serverExternalPackages`
- **Relevant File(s):** `next.config.ts`
- **Change Summary:** Opt `heic-decode` and `libheif-js` out of server bundling; leave `sharp` on Next's built-in list.
- **Source URL:** https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages (installed copy: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md`; default list `node_modules/next/dist/lib/server-external-packages.jsonc:88`)
- **Verbatim Quote:**
  > "If a dependency is using Node.js specific features, you can choose to opt-out specific dependencies from the Server Components bundling and use native Node.js `require`."
  > "Next.js includes a short list of popular packages that currently are working on compatibility and automatically opt-ed out:" … "- `sharp`"
- **Justification:** A 9 MB WASM bundle that uses Node features should not go through Turbopack; `sharp` is already excluded, so listing it would be redundant.

### [C6] — sharp constructor: `raw` input and `limitInputPixels`
- **Relevant File(s):** `integrations/images/sharp-heic.ts`
- **Change Summary:** Feed decoded RGBA into sharp as raw pixels; enforce the pixel ceiling on native formats via `limitInputPixels`.
- **Source URL:** https://sharp.pixelplumbing.com/api-constructor/#new
- **Verbatim Quote:**
  > "[options.limitInputPixels] | number | boolean | 268402689 | Do not process input images where the number of pixels (width x height) exceeds this limit. Assumes image dimensions contained in the input metadata can be trusted. An integral Number of pixels, zero or false to remove limit, true to use default limit of 268402689 (0x3FFF x 0x3FFF)."
  > "[options.raw] | Object | describes raw pixel input image data. See raw() for pixel ordering."
  > "[options.raw.channels] | number | integral number of channels, between 1 and 4."
- **Justification:** `sharp(raw, { raw: { width, height, channels: 4 } })` consumes heic-decode's `Uint8ClampedArray`; `limitInputPixels: MAX_PIXELS` makes sharp refuse oversized native images before allocation, mapped to `too_many_pixels`.

### [C7] — sharp `rotate()` auto-orientation
- **Relevant File(s):** `integrations/images/sharp-heic.ts`
- **Change Summary:** Call `.rotate()` on native-format input so portrait phone photos come out upright with the orientation tag removed.
- **Source URL:** https://sharp.pixelplumbing.com/api-operation/#rotate
- **Verbatim Quote:**
  > "For backwards compatibility, if no angle is provided, .autoOrient() will be called."
  > "Auto-orient based on the EXIF Orientation tag, then remove the tag."
- **Justification:** The derived copy is served `unoptimized` and must already be upright; this call is the documented way.

### [C8] — sharp `resize()` `fit: inside` and `withoutEnlargement`
- **Relevant File(s):** `integrations/images/sharp-heic.ts`
- **Change Summary:** Cap the long edge at 2048 px without upscaling small images.
- **Source URL:** https://sharp.pixelplumbing.com/api-resize/#resize
- **Verbatim Quote:**
  > "inside: Preserving aspect ratio, resize the image to be as large as possible while ensuring its dimensions are less than or equal to both those specified."
  > "[options.withoutEnlargement] | Boolean | false | Do not scale up if the width or height are already less than the target dimensions, equivalent to GraphicsMagick's > geometry option. This may result in output dimensions smaller than the target dimensions."
- **Justification:** `.resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })` is exactly P2.

### [C9] — sharp output: JPEG quality and default metadata stripping
- **Relevant File(s):** `integrations/images/sharp-heic.ts`
- **Change Summary:** Encode at quality 85 and rely on sharp's default to drop EXIF/GPS from every served copy.
- **Source URL:** https://sharp.pixelplumbing.com/api-output/#jpeg and https://sharp.pixelplumbing.com/api-output/#keepmetadata
- **Verbatim Quote:**
  > "[options.quality] | number | 80 | quality, integer 1-100"
  > "The default behaviour, when keepMetadata is not used, is to convert to the device-independent sRGB colour space and strip all metadata, including the removal of any ICC profile."
- **Justification:** Not calling `keepMetadata()` is what strips GPS (Rob's decision and V3); `quality` is a documented option for the chosen 85.

### [C10] — Next.js `after()`
- **Relevant File(s):** `features/memories/ingest-upload.ts`, `app/api/upload/route.ts`, `features/memories/derive-media.ts`
- **Change Summary:** Run `deriveWebImage` inside the existing `afterWithFlush` so the finalize response and the Blob callback return before the decode.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/after (installed copy `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md:6,50`)
- **Verbatim Quote:**
  > "`after` allows you to schedule work to be executed after a response (or prerender) is finished. This is useful for tasks and other side effects that should not block the response, such as logging and analytics."
  > "`after` will run for the platform's default or configured max duration of your route."
- **Justification:** The decode is a side effect of a READY transition; `maxDuration = 120` on the host page already bounds it.

### [C11] — Next.js Server Functions must authorize inside
- **Relevant File(s):** `app/m/[claimToken]/actions.ts`, `app/share/actions.ts`, `features/memories/claim.ts`, `features/memories/confirm.ts`
- **Change Summary:** Every new Server Function (`removeFile`, `cancelReservation`, `replaceFileTicket`, `retryReservationTicket`, `issueUploadTicket`, `completeSubmission`, `updateMediaFromClaim`) verifies the claim-token hash in the feature it calls.
- **Source URL:** https://nextjs.org/docs/app/getting-started/mutating-data (installed copy `.../01-getting-started/07-mutating-data.md:32`)
- **Verbatim Quote:**
  > "Server Functions are reachable via direct POST requests, not just through your application's UI. Always verify authentication and authorization inside every Server Function."
- **Justification:** The UI hiding a button is not authorization; the token check lives in `features/`.

### [C12] — Route handlers: `request.nextUrl`
- **Relevant File(s):** `app/api/media/[id]/route.ts`
- **Change Summary:** Read `t`, `download` and the new `v` from `request.nextUrl.searchParams` before touching Prisma (Cache Components rule).
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/route (installed copy `.../03-file-conventions/route.md:64`)
- **Verbatim Quote:**
  > "The `request` object is a NextRequest object, which is an extension of the Web Request API. `NextRequest` gives you further control over the incoming request, including easily accessing `cookies` and an extended, parsed, URL object `nextUrl`."
- **Justification:** The existing handler already reads `nextUrl` first; the `v` parameter is read in the same place so the prerender rule holds.

### [C13] — Next.js `<Image unoptimized>` for authenticated sources
- **Relevant File(s):** `app/m/[claimToken]/page.tsx`, `app/api/media/[id]/route.ts`
- **Change Summary:** Keep `unoptimized` when switching `src` to the derived copy; size the copy server-side instead.
- **Source URL:** https://nextjs.org/docs/app/api-reference/components/image#unoptimized (installed copy `.../02-components/image.md:88`)
- **Verbatim Quote:**
  > "If the `src` image requires authentication, consider using the unoptimized property to disable Image Optimization."
- **Justification:** The media route is token-gated; the optimizer would cache private bytes, so the 2048 px derivative must already be the right size.

### [C14] — Next.js `connection()`
- **Relevant File(s):** `app/m/[claimToken]/page.tsx`
- **Change Summary:** The claim page keeps `await connection()` as its first statement while gaining the derivative-state lookup.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/connection (installed copy `.../04-functions/connection.md:6`)
- **Verbatim Quote:**
  > "The `connection()` function allows you to indicate rendering should wait for an incoming user request before continuing."
- **Justification:** The new Prisma query must not run during the build's prerender (AGENTS.md Cache Components rule).

### [C15] — Vercel Blob SDK: `put` `allowOverwrite`/`multipart`, `get` for private blobs, `del` idempotency
- **Relevant File(s):** `features/memories/derive-media.ts`, `app/api/cron/reconcile-uploads/route.ts`, `lib/upload-client.ts`, `app/api/media/[id]/route.ts`
- **Change Summary:** Write derived copies to a pre-allocated uuid pathname (no overwrite), read originals with `get`, delete half-written candidates and purge originals/derivatives with `del`, keep `multipart: true` on client uploads.
- **Source URL:** https://vercel.com/docs/vercel-blob/using-blob-sdk#put , https://vercel.com/docs/vercel-blob/using-blob-sdk#get , https://vercel.com/docs/vercel-blob/using-blob-sdk#del
- **Verbatim Quote:**
  > "allowOverwrite | No | A boolean to allow overwriting blobs. By default an error will be thrown if you try to overwrite a blob by using the same pathname for multiple blobs."
  > "multipart | No | Pass multipart: true when uploading large files. It will split the file into multiple parts, upload them in parallel and retry failed parts."
  > "For private blobs, this is how you deliver files through your functions."
  > "del() returns a void response. A delete action is always successful if the blob url exists. A delete action won't throw if the blob url doesn't exist."
- **Justification:** `integrations/vercel-blob` already passes `allowOverwrite: false`; because a reclaim deletes the old candidate key and allocates a new one, a retry never collides. `del` not throwing on a missing blob is what makes both the reclaim cleanup and the purge safe to re-run.

### [C16] — Vercel Blob private storage delivery
- **Relevant File(s):** `app/api/media/[id]/route.ts`, `features/memories/derive-media.ts`
- **Change Summary:** Derived copies are written to the same private store and served only through the token-gated route (presigned 302), never by direct URL.
- **Source URL:** https://vercel.com/docs/vercel-blob#private-and-public-storage
- **Verbatim Quote:**
  > "Delivery | Through your Functions, which fetch the blob with the SDK | Direct blob URL"
  > "It's important to choose the correct access mode for your use case since you cannot change it after the creation of a blob store."
- **Justification:** The store is private and cannot change; the derived copy inherits the route-based delivery and `PROTECTIVE_HEADERS`.

### [C17] — Vercel Blob client uploads: authorize in `onBeforeGenerateToken`, `onUploadCompleted`
- **Relevant File(s):** `app/api/upload/route.ts`, `lib/upload-client.ts`, `features/memories/create-memory.ts`
- **Change Summary:** Keep one ticket per file as the authorization unit (`issueUploadTicket` per row); hook derivation off the completion callback; require `deletedAt null` in the token step.
- **Source URL:** https://vercel.com/docs/vercel-blob/client-upload#authenticating-client-uploads , https://vercel.com/docs/vercel-blob/client-upload#onuploadcompleted-callback-behavior
- **Verbatim Quote:**
  > "You must authenticate and authorize users in the onBeforeGenerateToken callback of your server route before generating a client token."
  > "The onUploadCompleted callback is called by Vercel API when a client upload completes."
- **Justification:** Multi-file upload loops the existing ticketed flow rather than inventing a bulk token; the callback is a second, server-to-server place to start derivation.

### [C18] — Vercel cron: `CRON_SECRET` and duration
- **Relevant File(s):** `app/api/cron/reconcile-uploads/route.ts`
- **Change Summary:** Add step (g), the purge extension and the lease-aware (d)/(e) behind the existing bearer check, with a 30 s step deadline inside the 60 s function limit.
- **Source URL:** https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs , https://vercel.com/docs/cron-jobs/manage-cron-jobs#cron-job-duration
- **Verbatim Quote:**
  > "The value of the variable will be automatically sent as an Authorization header when Vercel invokes your cron job. Your endpoint can then compare both values, the authorization header and the environment variable, to verify the authenticity of the request."
  > "The duration limits for Cron jobs are identical to those of Vercel Functions."
- **Justification:** The new steps run under the same auth and the same `maxDuration`, hence `DERIVE_DEADLINE_MS` and `take 3`.

### [C19] — Vercel Functions limits: memory and body size
- **Relevant File(s):** `integrations/images/sharp-heic.ts`, `features/memories/derive-media.ts`
- **Change Summary:** 30 MP ceiling and one-decode-at-a-time semaphore; read originals from Blob, never from a request body.
- **Source URL:** https://vercel.com/docs/functions/limitations#memory-size-limits , https://vercel.com/docs/functions/limitations#request-body-size
- **Verbatim Quote:**
  > "Pro / Enterprise | 2 GB / 1 vCPU | 4 GB / 2 vCPU"
  > "The maximum payload size for the request body or the response body of a Vercel Function is 4.5 MB."
- **Justification:** A 24 MP decode peaked at ~0.8 GB locally; two at once on a 2 GB default instance is the OOM the pre-mortem flagged. Originals (≤25 MB) exceed 4.5 MB, so derivation must pull from Blob.

### [C20] — `vercel.json` `functions.memory` is not available under Fluid compute
- **Relevant File(s):** `vercel.json` (not changed), § 9 risk
- **Change Summary:** Do not attempt a per-route memory bump; memory is a dashboard setting Rob can raise.
- **Source URL:** https://vercel.com/docs/project-configuration/vercel-json#functions
- **Verbatim Quote:**
  > "`memory`: Memory cannot be set in `vercel.json` with Fluid compute enabled. Instead set it in the Functions section in your project dashboard sidebar."
- **Justification:** Settles issue #17 open question 8: the code-side guard is the pixel ceiling; raising memory is Rob's dashboard action.

### [C21] — Prisma 7 schema reference: `@unique`, `@@unique`, `?`, `@@index`
- **Relevant File(s):** `prisma/schema.prisma`, the three migrations
- **Change Summary:** `DerivedMedia.storageKey @unique`, `@@unique([mediaId, kind])`, nullable columns, `@@index([memoryId, deletedAt])`, `@@index([replacesMediaId])`.
- **Source URL:** https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference#unique-1 (and `#unique`, `#index`, `#optional-fields`)
- **Verbatim Quote:**
  > "Defines a unique constraint for this field."
  > "Defines a compound unique constraint for the specified fields."
  > "Makes a field optional."
  > "Defines an index in the database."
- **Justification:** The compound unique is the race arbiter (one row per kind per media); nullable additive columns keep the migrations backfill-free.

### [C22] — Prisma 7 self-relations
- **Relevant File(s):** `prisma/schema.prisma` (PR B)
- **Change Summary:** `Media.replacesMediaId` with a named **one-to-many** self relation (`replaces` / `replacements`), no unique on the foreign key.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/relations/self-relations
- **Verbatim Quote:**
  > "A relation field can reference its own model, called a self-relation."
  > "Both sides must use the same `@relation` name"
  > "One side must be fully annotated with `fields` and `references`"
- **Justification:** The schema snippet follows these rules; one-to-many was chosen because a one-to-one would need `@unique` on `replacesMediaId` and block a second replacement attempt after a FAILED one (PM2 #8).

### [C23] — Prisma 7 interactive transactions and timeouts
- **Relevant File(s):** `features/memories/ingest-upload.ts`, `features/memories/claim.ts`, `features/memories/create-memory.ts`, `features/memories/derive-media.ts`
- **Change Summary:** Replace-swap, remove-with-revision, N-row create and derivation publish each run inside `$transaction(async (tx) => …)` with the repo's `TX_OPTIONS`.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions#interactive-transactions
- **Verbatim Quote:**
  > "const result = await prisma.$transaction(async (tx) => {"
  > "maxWait: 5000, // Max wait to acquire transaction (default: 2000ms)"
  > "timeout: 10000, // Max transaction run time (default: 5000ms)"
- **Justification:** The soft-delete of the replaced row and the READY transition of its replacement must commit together; `create-memory.ts` already uses `TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 }` because Neon wake-up exceeds the defaults quoted.

### [C24] — Prisma 7 relation filters `some` / `none`
- **Relevant File(s):** `app/api/cron/reconcile-uploads/route.ts`, `features/memories/derive-media.ts`
- **Change Summary:** Select media with no `WEB_IMAGE` row (`none`) or with a retryable row (`some`), and tombstones with outstanding derivative cleanup (`some`).
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/queries/relation-queries#filter-on--to-many-relations
- **Verbatim Quote:**
  > "Prisma Client provides the some, every, and none options to filter records by the properties of related records on the \"-to-many\" side of the relation."
  > "\"I want a list of every User that has no unpublished Post records\" | none of the posts are unpublished"
- **Justification:** Step (g)'s candidate query and step (f)'s purge selector are `none`/`some` filters over `Media.derivatives`.

### [C25] — Prisma 7 errors P2002 and P2025
- **Relevant File(s):** `features/memories/derive-media.ts`, `features/memories/ingest-upload.ts`
- **Change Summary:** Treat P2002 on the claim insert as "a row exists, re-read and evaluate eligibility"; keep P2025 as the existing `lost_race` signal in `transition()`.
- **Source URL:** https://www.prisma.io/docs/orm/v7/reference/error-reference#p2002 , https://www.prisma.io/docs/orm/v7/reference/error-reference#p2025
- **Verbatim Quote:**
  > "Unique constraint failed on the {constraint}"
  > "An operation failed because it depends on one or more records that were required but not found. {cause}"
- **Justification:** The claim-row design (P4/P18) depends on the unique insert failing fast; the conditional READY update already maps P2025 to `lost_race`.

### [C26] — Prisma 7 Migrate: `migrate dev` vs `migrate deploy`
- **Relevant File(s):** `prisma/migrations/*` (three new folders), `vercel.json` (unchanged `buildCommand`)
- **Change Summary:** Generate each additive migration with `migrate dev` against a disposable database; production applies it through the existing `migrate deploy` in the build command.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production
- **Verbatim Quote:**
  > "In a development environment, use the migrate dev command to generate and apply migrations:"
  > "In production and testing environments, use the migrate deploy command to apply migrations:"
- **Justification:** The repo pins Prisma `^7.10.1`; the v7 page is cited because the un-versioned docs now default to ORM 8 with a different API.

### [C27] — zod: array `.max()` and `.refine()`
- **Relevant File(s):** `lib/validations/memory.ts`, `lib/validations/media.ts`
- **Change Summary:** `files: z.array(...).max(MAX_FILES_PER_MEMORY)` with a refine requiring a file or words; uuid/token schemas for media references.
- **Source URL:** https://zod.dev/api?id=arrays , https://zod.dev/api?id=refinements
- **Verbatim Quote:**
  > "z.array(z.string()).max(5); // must contain 5 or fewer items"
  > "Every Zod schema stores an array of refinements. Refinements are a way to perform custom validation that Zod doesn't provide a native API for."
- **Justification:** The cap and the "file or words" rule are expressed with these two primitives, matching the existing `createMemoryInputSchema` refine.

### [C28] — MDN `<input type="file" multiple>` and `files`
- **Relevant File(s):** `app/share/share-form.tsx`, `app/m/[claimToken]/media-list-client.tsx`
- **Change Summary:** One `multiple` input feeds the row list; Replace uses a single-file input.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file#multiple
- **Verbatim Quote:**
  > "When the multiple Boolean attribute is specified, the file input allows the user to select more than one file."
  > "The selected files are returned by the element's HTMLInputElement.files property, which is a FileList object containing a list of File objects."
- **Justification:** The form iterates `input.files` into rows and mints one ticket per `File`.

### [C29] — MDN `URL.createObjectURL()` and revocation
- **Relevant File(s):** `app/share/share-form.tsx`
- **Change Summary:** Row thumbnails use object URLs, revoked on row removal, reset and unmount.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static#memory_management
- **Verbatim Quote:**
  > "The createObjectURL() static method of the URL interface creates a string containing a blob URL pointing to the object given in the parameter."
  > "To release an object URL, call revokeObjectURL()."
- **Justification:** Ten previews of 20 MB photos would otherwise stay resident for the page's life.

### [C30] — SendGrid Mail Send: inline attachments with `content_id`
- **Relevant File(s):** `services/email/templates/memory-confirmation.ts`, `services/email/types.ts` (PR C wording; PR D thumbnails)
- **Change Summary:** Restructure `received` so the template can later attach thumbnails inline without public URLs.
- **Source URL:** https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send (request body → `attachments`)
- **Verbatim Quote:**
  > "The attachment's content-disposition specifies how you would like the attachment to be displayed. For example, inline results in the attached file being displayed automatically within the message while attachment results in the attached file requiring some action to be taken before it is displayed such as opening or downloading the file."
  > "The content_id is used when the disposition is set to inline and the attachment is an image, allowing the file to be displayed within the body of the email."
- **Justification:** This is the mechanism PR D will use, and why PR A derives into a table that can hold a `THUMBNAIL` kind rather than a one-off column.

### [C31] — Sentry for Next.js: capture handled errors
- **Relevant File(s):** `features/memories/derive-media.ts`
- **Change Summary:** Unexpected derivation errors are caught (so the row can be marked FAILED) and reported with `captureException` plus a `mediaId` tag only.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/capturing-errors/
- **Verbatim Quote:**
  > "When you catch errors to return graceful responses (in Server Actions, API routes, or middleware), add captureException before returning."
  > "The pattern is the same everywhere: if you catch and don't throw, call captureException."
- **Justification:** The derive path swallows the error to record state; without `captureException` the failure would be invisible (acceptance A3).

### [C32] — Vitest `vi.mock` and `vi.fn`
- **Relevant File(s):** `__tests__/features/derive-media.test.ts`, `__tests__/integrations/images.test.ts`, `__tests__/lib/validations-media.test.ts`, extensions to `__tests__/features/*.test.ts`, `__tests__/api/*.test.ts`, `__tests__/services/email.test.ts`
- **Change Summary:** Mock `@/server/db/client` (including `$transaction` and `$queryRaw`), `@/services/storage`, `@/services/images` and `@/lib/sentry/after-flush` at module boundaries, as the existing suites do.
- **Source URL:** https://vitest.dev/api/vi.html#vi-mock , https://vitest.dev/api/vi.html#vi-fn
- **Verbatim Quote:**
  > "Substitutes all imported modules from provided path with another module. The call to vi.mock is hoisted, so it doesn't matter where you call it."
  > "Creates a spy on a function, but can also be initiated without one. Every time a function is invoked, it stores its call arguments, returns, and instances."
- **Justification:** The repo's pattern (`__tests__/features/ingest-upload.test.ts:25-55`) is `vi.mock` + in-memory arrays of `vi.fn`; new tests follow it so the decoder never runs in unit tests except the integration file.

### [C33] — Project rules: layering, Cache Components, TDD (AGENTS.md / docs/code-layout.md)
- **Relevant File(s):** every new module (`services/images/*`, `integrations/images/*`, `features/memories/derive-media.ts`, `lib/*`), `docs/code-layout.md`, `AGENTS.md`, `__tests__/**`
- **Change Summary:** The decoder sits behind `services/images` with an `integrations/` implementation; features never import the vendor package; shared runtime code that both services and integrations need lives in `lib/`; critical paths are test-first.
- **Source URL:** `AGENTS.md` (repo root, "Code layout and house rules"), mirrored in `docs/code-layout.md`
- **Verbatim Quote:**
  > "`app/ → features/ → services/ → integrations/`. A layer imports only from layers below it plus `lib/` and `server/`. Nothing imports from `app/`."
  > "One exception: `integrations/*` may import **types** from `services/*/types` (they implement those interfaces); value imports stay forbidden."
  > "The **first** thing a dynamic page component does is `await connection()` (then `params`/`searchParams`/`headers()` as needed); a `GET` handler reads `request.headers` or `request.nextUrl` first. Only then touch Prisma or env."
  > "TDD for critical paths (upload tickets, finalize, confirmation, cron)."
- **Justification:** These rules decide where `sharp`/`heic-decode` may be imported, why `ImageDeriveError` and `MAX_FILES_PER_MEMORY` move to `lib/`, the read order in the media route and claim page, and the tests-first sequencing of every step.

### [C34] — Project rule: client-file lint guard (eslint.config.mjs)
- **Relevant File(s):** `app/m/[claimToken]/media-list-client.tsx`, `app/m/[claimToken]/derive-poll-client.tsx`, `lib/upload-client.ts`
- **Change Summary:** Name the new Client Components `*-client.tsx` so the no-server-imports rule applies; keep the upload helper free of server modules.
- **Source URL:** `eslint.config.mjs` (repo root, client-file block: `app/**/*-form.tsx`, `app/**/*-client.tsx`, `app/**/recorder.ts`, `app/**/error.tsx`, `app/global-error.tsx`, `app/_components/**/*.{ts,tsx}`, `instrumentation-client.ts`)
- **Verbatim Quote:**
  > "Client Components cannot import server modules or integrations. Call a Server Function instead."
- **Justification:** The pre-mortem found a `media-list.tsx` would escape this guard; the `-client` suffix is what binds the rule.

### [C35] — Project rule: layout and interaction constraints (design/DESIGN.md § 6)
- **Relevant File(s):** `app/share/share-form.tsx`, `app/m/[claimToken]/media-list-client.tsx`
- **Change Summary:** File rows are wrapping flex rows (no `<table>`, no fixed heights); Remove confirms inline rather than in a modal; everything works at 390 px.
- **Source URL:** `design/DESIGN.md` § 6 (repo)
- **Verbatim Quote:**
  > "Every section is a wrapping flex row or a flex column; no fixed heights."
  > "No sticky header, no modals, no autoplay audio, no hover-only interactions."
  > "The page must look finished at 390px wide"
- **Justification:** Rules out the desktop-only `<table>` from the issue and the modal confirm; shapes the responsive row design Rob chose.

### [C36] — Project design: Phase 2 `DERIVED_MEDIA` and the derived prefix
- **Relevant File(s):** `prisma/schema.prisma`, `lib/site-url.ts`
- **Change Summary:** Build `DerivedMedia` (not columns on `Media`) and store derivatives under a separate environment-scoped prefix.
- **Source URL:** `docs/Memorial Memories Site initial thinking.md:293-301, 449`
- **Verbatim Quote:**
  > "DERIVED_MEDIA { uuid id PK uuid media_id FK enum kind \"thumbnail | poster | web_audio | web_video\" string storage_key string mime_type int width int height }"
  > "Originals are write-once; derived files live under a separate prefix. Keep the storage key in MEDIA, never a public URL."
- **Justification:** P1 and `derivedPrefix()` implement the design doc as written; issue #17's columns would have contradicted it.

### [C37] — Project ruling: thin Server Functions, validation in features
- **Relevant File(s):** `app/m/[claimToken]/actions.ts`, `app/share/actions.ts`, `features/memories/claim.ts`, `lib/validations/media.ts`
- **Change Summary:** New Server Functions pass `unknown` straight to features, which `safeParse` with schemas from `lib/validations`.
- **Source URL:** `app/share/actions.ts:12-13` and `docs/plans/phase1-ledger.md` Task 7 (repo)
- **Verbatim Quote:**
  > "validation and authorization live in features/"
- **Justification:** The issue proposed validating in `actions.ts`; the existing ruling places it in features, as `updateMemoryFromClaim` already does.

### [C38] — Project code: ticket TTL, exchange-time expiry and the 1 h Blob token
- **Relevant File(s):** `features/memories/create-memory.ts` (`issueUploadTicket`, lease renewal), `features/memories/confirm.ts` (deferral window), `app/api/upload/route.ts`
- **Change Summary:** Mint each ticket just before its upload; renew the submission lease to 70 min on each issuance so it outlives the Blob token; defer the batch email while a PENDING row is younger than the TTL.
- **Source URL:** `lib/upload-ticket.ts:15`, `app/api/upload/route.ts:20,50`, `features/memories/ingest-upload.ts:148` (repo)
- **Verbatim Quote:**
  > `TICKET_TTL_MS = 15 min` (constant); `BLOB_TOKEN_LIFETIME_MS = 1h` (constant); the token exchange calls `verifyUploadTicket(ticket)` with expiry enforced, while `finalizeUpload` passes `{ ignoreExpiry: true }`.
- **Justification:** A ten-file batch pre-minted at T0 would be refused at exchange after 15 minutes (PM1 #2); an upload can legitimately run for the whole 1 h token life, which is why the lease is longer than the token (PM2 #3).

### [C39] — Project code: one confirmation per memory, 3-per-recipient cap, cron rotation
- **Relevant File(s):** `features/memories/confirm.ts`, `services/email/index.ts` (unchanged), `services/email/templates/memory-confirmation.ts`
- **Change Summary:** Keep exactly one email per memory, describe all files in it, send it from the request path while the raw token is on hand, and hold cron off with the lease.
- **Source URL:** `prisma/schema.prisma` `EmailLog`, `services/email/index.ts:16-25`, `features/memories/confirm.ts:53-66` (repo)
- **Verbatim Quote:**
  > "@@unique([memoryId, emailType]) // confirmation idempotency by constraint"
  > "RECIPIENT_DAILY_CAP = 3"
  > (confirm.ts) the cron path, called without a raw token, mints a new token and passes `rotateToClaimTokenHash`.
- **Justification:** One memory per photo would hit the cap on the fourth photo; a cron-sent confirmation rotates the token and would invalidate the link the contributor is still using.

### [C40] — heic-decode `lib.js`: lazy per-image decode (verified source)
- **Relevant File(s):** `integrations/images/sharp-heic.ts`
- **Change Summary:** Use `.all()` to read dimensions and `dispose()` without decoding when the pixel ceiling is exceeded.
- **Source URL:** https://unpkg.com/heic-decode@2.1.0/lib.js (fetched 2026-11-03)
- **Verbatim Quote:**
  > "width: image.get_width(), height: image.get_height(), decode: async () => await decodeImage(image)"
- **Justification:** Proves the ceiling check is free: `width`/`height` come from the HEIF handle and `decode()` is only called when the image is within limits.

### [C41] — Prisma 7 transaction isolation level
- **Relevant File(s):** `features/memories/lock.ts`, `features/memories/claim.ts`, `features/memories/create-memory.ts`, `features/memories/ingest-upload.ts`
- **Change Summary:** Do not rely on the default isolation for count-based invariants; take an explicit row lock instead of raising the isolation level.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions#transaction-isolation-level
- **Verbatim Quote:**
  > "isolationLevel: Prisma.TransactionIsolationLevel.Serializable, // optional, default defined by database configuration"
  > "To avoid this problem, you can set a higher isolation level (RepeatableRead or Serializable)."
- **Justification:** PM2 #10: at the database default two removals can each see two files. `Serializable` would need retry loops in every feature; a `FOR UPDATE` lock on the parent memory (next citation) serialises the same operations without retries.

### [C42] — Prisma 7 `$queryRaw` inside a transaction
- **Relevant File(s):** `features/memories/lock.ts`
- **Change Summary:** `lockMemory(tx, memoryId)` runs `SELECT "id" FROM "Memory" WHERE "id" = ${memoryId} FOR UPDATE` through the transaction client as a tagged template.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/raw-queries#queryraw
- **Verbatim Quote:**
  > "You can use .$executeRaw() and .$queryRaw() inside a transaction."
  > "The other two methods are safe to use with a simple template tag, no string building, and no concatenation."
- **Justification:** The lock must be part of the same interactive transaction as the count and the write, and the tagged template keeps `memoryId` parameterised.

### [C43] — sharp animated input and GIF output
- **Relevant File(s):** `integrations/images/sharp-heic.ts`
- **Change Summary:** Derive GIFs as GIFs with animation preserved and metadata stripped, so no format needs a "serve the original" exception.
- **Source URL:** https://sharp.pixelplumbing.com/api-constructor/#new (options.animated) and https://sharp.pixelplumbing.com/api-output/#gif
- **Verbatim Quote:**
  > "[options.animated] | boolean | false | Set to true to read all frames/pages of an animated image (GIF, WebP, TIFF), equivalent of setting pages to -1."
  > "const out = await sharp('in.gif', { animated: true })
  > .resize({ width: 128, height: 128 })
  > .gif({ dither: 0 })"
  > "The palette of the input image will be re-used if possible."
- **Justification:** PM1 #7 and Rob's "everything served is sanitized": `sharp(input, { animated: true }).resize({ width: 2048, withoutEnlargement: true }).gif()` keeps the animation and applies the default metadata strip.

### [C44] — Node.js `worker_threads`: `terminate()`, `resourceLimits`, `eval`
- **Relevant File(s):** `lib/heic-worker.ts`, `integrations/images/sharp-heic.ts`, `__tests__/lib/heic-worker.test.ts`
- **Change Summary:** Run the blocking WASM HEIC decode in a Worker created from an inline script, cap its heap, and terminate it at the deadline.
- **Source URL:** https://nodejs.org/api/worker_threads.html#workerterminate , https://nodejs.org/api/worker_threads.html#new-workerfilename-options
- **Verbatim Quote:**
  > "Stop all JavaScript execution in the worker thread as soon as possible. Returns a Promise for the exit code that is fulfilled when the 'exit' event is emitted."
  > "resourceLimits <Object> An optional set of resource limits for the new JS engine instance. Reaching these limits leads to termination of the Worker instance. These limits only affect the JS engine, and no external data, including no ArrayBuffers. Even if these limits are set, the process may still abort if it encounters a global out-of-memory situation."
  > "maxOldGenerationSizeMb <number> The maximum size of the main heap in MB."
  > "eval <boolean> If true and the first argument is a string, interpret the first argument to the constructor as a script that is executed once the worker is online."
- **Justification:** `heic-decode` does its work synchronously `[C3]`, so a timer on the request thread can never interrupt it; a Worker is the only interruptible host, `terminate()` is the documented stop, and `resourceLimits` bounds the JS heap. The quote's caveat that `ArrayBuffer`s are outside the limit is why the pixel ceiling and the semaphore stay in place.

### [C45] — sharp `flatten()`
- **Relevant File(s):** `integrations/images/sharp-heic.ts`
- **Change Summary:** Flatten transparent PNG/WebP/GIF pixels onto `#fffdf8` before the JPEG thumbnail encode.
- **Source URL:** https://sharp.pixelplumbing.com/api-operation/#flatten
- **Verbatim Quote:**
  > "Merge alpha transparency channel, if any, with a background, then remove the alpha channel."
  > "[options.background] | string | Object | "{r: 0, g: 0, b: 0}" | background colour, parsed by the color module, defaults to black."
- **Justification:** JPEG has no alpha; without `flatten({ background: "#fffdf8" })` the email thumbnail of a transparent image would get a black background instead of the card colour.

### [C46] — sharp `jpeg({ mozjpeg })`
- **Relevant File(s):** `integrations/images/sharp-heic.ts`
- **Change Summary:** Encode thumbnails with `jpeg({ quality: 72, mozjpeg: true })`, re-encoding once at 60 when over 350 KB.
- **Source URL:** https://sharp.pixelplumbing.com/api-output/#jpeg
- **Verbatim Quote:**
  > "[options.mozjpeg] | boolean | false | use mozjpeg defaults, equivalent to { trellisQuantisation: true, overshootDeringing: true, optimiseScans: true, quantisationTable: 3 }"
- **Justification:** The email plan budgets ~1.5 MB for four inline images; mozjpeg's defaults give the smallest JPEG at a given quality, and `optimiseScans` already implies progressive output.

### [C47] — Email plan: schema keys, invariant D2 and the poster staging contract
- **Relevant File(s):** `lib/derived-keys.ts`, `prisma/schema.prisma` (`DerivedKind.POSTER`), `app/api/media/[id]/route.ts`, `app/api/cron/reconcile-uploads/route.ts`
- **Change Summary:** Reserve the POSTER kind and adopt the email plan's two-key scheme and its invariant so the later poster PR needs no new migration or key scheme.
- **Source URL:** `/Users/rob/.claude/plans/please-use-worldclass-email-fancy-mountain.md` § 3.1 and § 3.4 (local plan, 2026-11-03)
- **Verbatim Quote:**
  > "`lib/preview-keys.ts` (server-only, pure): `previewKeyFor(storageKey)` → `<derivedPrefix><memoryId>/<uuid>.jpg`; `posterStagingKeyFor(storageKey)` → `<derivedPrefix><memoryId>/<uuid>.upload.jpg`; `isStagingKey(key)`. Two distinct keys because a blob pathname cannot be overwritten"
  > "**Invariant (D2):** final preview keys (`*.jpg` under `derived/`) are written only by the server from bytes it decoded and re-encoded; staging keys (`*.upload.jpg`) hold untrusted browser bytes and are never attached to an email or served."
  > "the poster ticket requires `\"poster\"`, `mimeType === \"image/jpeg\"`, `maxBytes ≤ 2 MB`, and `pathname === posterStagingKeyFor(<the media row's storageKey>)`."
- **Justification:** Rob asked PR A to reserve POSTER with exactly this contract; `lib/derived-keys.ts` is that plan's `lib/preview-keys.ts` renamed to match the `DerivedMedia` vocabulary, and the media route's `isStagingKey` 404 plus the purge of staging keys enforce D2 before any poster code exists.

## Progress

- [ ] PR A `feat/derived-web-images` — steps 1–10 (owner: THIS session, after B merges; session 25e018cf finished without opening A). Also absorbs B's deferred hooks: derivative/staging purge, `web` placeholder state, 51-tombstone test, docs copy.
- [x] PR B `feat/claim-remove-replace` — **merged 2026-11-03 21:42 UTC as 1db03f6** (PR #22). Rebased onto main @ 5edd042; Team Code Review round 1 (George 6, Oscar 3) applied with tests first; fresh Fable regression check: no serious regression. Bucket 3/4 notes are on the PR. Deferred to A: derivative/staging purge, `web` placeholder state, 51-tombstone test, docs copy. Deferred to C: Retry on reservations.
- [ ] PR C `feat/multi-file-memories` — steps 1–7
- [ ] Ledger Task 12 section; Task 7/8/10 HEIC lines and F7 updated
