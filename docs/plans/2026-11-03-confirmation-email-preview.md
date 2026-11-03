# Confirmation email with a preview of what was sent (repo copy)

The full plan with its citation section (C1–C35) lives at `/Users/rob/.claude/plans/please-use-worldclass-email-fancy-mountain.md` on Rob's machine. This copy carries what a fresh agent needs: the cold-start contract, the locked rulings, the re-plan that split the work, the parking lot, and the progress ledger.

## 0. Cold-start contract

| Item | Value |
|---|---|
| Repository | `/Users/rob/Documents/active_work/jowray_com`, remote `origin https://github.com/RobertdWray/jowray_com.git`, default branch `main`. Work in a **separate git worktree** (other agents share this checkout). |
| This PR's branch | `feat/confirmation-email-preview`, worktree `/Users/rob/Documents/active_work/jowray_wt_email`, cut from `main@636ddfd` (2026-11-03). |
| Authoritative docs | This file; `AGENTS.md`; `docs/plans/phase1-ledger.md` (rulings, resource ids, Task 12 section); `design/DESIGN.md` § 11 (email rules). |
| Environments | Production `https://www.jowray.com`; preview = branch URL; local `npm run dev` on Neon branch `dev` (`br-holy-rice-bbz4t50l`, project `icy-scene-20351172`). One private Blob store for all environments (`jowray-media`), keys separated by prefix. |
| Email | SendGrid, from `memories@jowray.com`; `OUTBOUND_ENABLED=true` in production only; allowlist `robwray@gmail.com` elsewhere. `scripts/send-test-email.ts` sends outside the app (no `EmailLog`). |
| Checks | `npm run validate`, `npm run test:run`, `npm run build:offline` (no `.env`, `DATABASE_URL` unset). |
| Evidence | `docs/plans/evidence/2026-11-confirmation-email/` (screenshots named by commit; nothing sensitive). |

## 1. Rulings (locked; do not re-open)

| ID | Ruling | Supersedes |
|---|---|---|
| R1 | The confirmation email echoes the contributor's **full note**, name, relationship, when and where. | Phase 1 S2. |
| R2 | Previews travel as **inline CID attachments**; no tokenized URLs, no external asset loads; tracking stays off. | — |
| R3 | Video posters are **captured in the browser** at upload time and uploaded as a derived JPEG. | — |
| R4 | Brand heart and media badges are **inline CID PNGs**. | — |
| R5 | **Originals are never degraded.** HEIC stays accepted and stored as-is; the server converts for previews only (sharp cannot decode HEVC; a WASM libheif decoder does, in issue 17 PR A). | — |
| R6 | Compatibility over style: tables, inline CSS, Georgia/Arial fallbacks, no `@font-face`. | — |

Implementation choices (may change with a ledger note): D1 previews are generated synchronously at finalize with a hard deadline, no general backfill; D2 only the server writes final preview keys; D3 posters stage under a separate key and are re-encoded by the server; D4 previews ≤ 1000×1000, ≤ 350 KB each, ≤ 4 per email, ≤ 1.5 MB total; D5 `sharp` pinned to Next's version; D6 HEIC decode in a terminable worker thread; D7 `durationSeconds` is client-reported and untrusted; D8 brand assets are committed base64 constants; D9 the claim page does not use previews yet.

## 2. Re-plan (Rob, 2026-11-03): this PR stops at Cut point A

- **Shipped here:** attachments through the transport, brand assets, the template rewrite, `confirmMemory` sending details and the READY file list (badge cards; `preview: null` for every file until the pipeline exists), the preview/test scripts, docs.
- **Moved to issue 17 PR A (session 95e0ccc1):** the server image pipeline (`lib/image-preview`, worker-thread HEIC decode), the `Media` preview columns, `derivedPrefix()` / staging keys, `ensurePreview` / `attachPosterPreview`, and cron step (g). PR A adds a `DerivedMedia` table with `THUMBNAIL` and `POSTER` kinds using this plan's §3.2 output spec (≤ 1000×1000 `fit: inside`, JPEG q72 mozjpeg, ≤ 350 KB, play badge composited for posters; `lib/email-assets` exports `PLAY_BADGE_COMPOSITE` at 160 px for that).
- **After PR A merges:**
  - Task 4 → `confirmMemory` reads `DerivedMedia` `THUMBNAIL` rows for READY media (in upload order, first 4, each ≤ 400 KB by `head()`, ≤ 1.5 MB base64 total, 8 s fetch deadline) and fills `MemoryMediaSummary.preview` with `{ contentId: "preview-<mediaId>", contentBase64, width, height }`. The template already renders previews and caps at four.
  - Task 5 → `durationSeconds` from the browser (zod `z.int().min(0).max(86400)`), stored at READY, shown as "Voice recording · 2:14".
  - Task 6 (browser half) → `app/share/video-poster.ts` capture with one 8 s deadline, ticket `kind: "poster"`, poster client token scoped to `image/jpeg` ≤ 2 MB and the exact staging key, `finalizeUpload({ posterTicket })` hands the staged bytes to PR A's pipeline, which writes a `POSTER` row.
- **Premortem findings carried to PR A** (Oscar, Codex, 2026-11-03): a deadline must terminate the synchronous WASM decode (worker `terminate()`), authorization must bind the exact staging key and ticket kind, concurrent finalize/callback must converge on one preview (write-once `put` + conditional DB publish + adoption that reads dimensions from the JPEG), abandoned staging blobs need an owner (cron step (g)), attachment sizes must be enforced in bytes, and deployed HEIC decode must be verified unmocked with recorded timing and memory.

## 3. Parking lot

**Don't do (with reasons)**
- A general preview backfill cron: previews have one consumer (the not-yet-sent email); cron step (g) in PR A covers abandoned uploads only.
- `[data-ogsc]`/`[data-ogsb]` Outlook.com dark-mode overrides: attribute selectors are outside Gmail's documented CSS support and could cost the whole `<style>` block; `color-scheme: light` metas and `bgcolor` attributes carry the ground colour instead.
- `@font-face` in the email: fonts cannot travel as CID attachments and Outlook 2007–2016 regress to Times New Roman; Georgia/Arial stacks are the ruling (R6).
- Dropping HEIC from the picker so iOS transcodes to JPEG: rejected by R5 (originals keep full quality).

**Real, but out of scope**
- F10 claim-page thumbnails/posters (needs a tokenized derived-media route).
- F11 posters for files added from the claim page.
- F12 Playwright coverage of poster capture (depends on F1, the browser test harness).
- Delivered-message checks across Gmail web/iOS, Apple Mail, Outlook, Yahoo in light mode, dark mode and with images blocked: to be recorded in the evidence folder after a real send.

## 4. Progress ledger

| ID | Step | Status | Commit | Verification |
|---|---|---|---|---|
| T1 | Attachments through the transport | integrated | `16e94e6` | `email.test.ts` 20/20; validate clean |
| T2 | Brand assets + generator | integrated | `fc8496e` | `email-assets.test.ts` 4/4; marks checked on muslin |
| T3 | Template rewrite, confirm details, scripts | integrated | `e8eeb60` | suite 167/167; validate; `build:offline` exit 0; Chrome 1280/390 px |
| T4 | Thumbnails from DerivedMedia | blocked on issue 17 PR A | | |
| T5 | `durationSeconds` | todo (after PR A) | | |
| T6 | Browser poster capture + poster ticket | todo (after PR A) | | |
| T7 | Docs, ledger, PR (Cut point A) | this commit | | |

Rulings made while building (full text in the worktree ledger, `.superpowers/sdd/please-use-worldclass-email-fancy-mountain/progress.md`, git-ignored): three template assertions corrected (escaped filename substring, token in every card `href`, voice card falls back to the filename); `<br>` without a trailing newline in the pre-wrap note cell; image-blocked fallback colour on the `<img>` rather than the cell; the preview script matches `cid:<id>"` with the closing quote because `brand-heart` is a prefix of `brand-heart-stitched`.
