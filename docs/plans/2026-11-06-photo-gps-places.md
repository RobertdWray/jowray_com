# Share form: optional fields made clear + photo GPS, place suggestions and MCP lookup (Refs #58)

**Plan revision 3 (2026-11-06); executed 2026-11-06 (ledger §5.7, rulings §5.8).** Reviewed against `origin/main` = `982a1414c07c89afc17b4ae0637bdd18f184e68f` and PR #60 head =
`9d841a8217c459cdfdaba662f52e286c333fd57b`.

**Authoritative copy.**
- Until step B0, the authoritative copy is this file: `/Users/rob/.claude-work/plans/can-you-help-me-vectorized-sphinx.md` (the filename
  is the planner's auto-name).
- From B0 on, the authoritative copy is the repo copy
  `/Users/rob/Documents/active_work/jowray_wt_photo_gps/docs/plans/2026-11-06-photo-gps-places.md`, committed on `feat/photo-gps-places`.
- Execution edits only the repo copy and mirrors it here at the end of each step.
- If the two differ, the repo copy wins, unless this file has a later "Plan revision N" header (then reconcile by hand and log a ruling).
- Every revision bumps the header and records the commit it was reviewed against.

## 1. Context

Rob, 2026-11-06 (verbatim; issue #58 "make it clear fields are optional" says the same and was closed by Rob at 16:08 UTC that day):

1. "feature clarification. when a user leaves a memory on https://www.jowray.com/share Text should be optional, Date should he optional"
2. "new feature - if a user uploads a photo, we should extract the cordinates out of that, and then use that to suggest a location to
   the user. No matter what, we should save the GPS cordinates in the database to be attached to that photo. So the GPS cordinates need
   to be associated with the memory, or the photo, if there are multiple photos per memory, we should suggest multiple locations for the
   user to pick from."
3. On the MCP server (PR #60): "We should modify our MCP server to also support this GPS lookup - for example, if I'm uploading stuff
   directly from my iphone library using the MCP server and claude desktop. This should stack on top of this PR assuming it gets merged
   in."

### 1.1 What exists today (at the reviewed commits)

- **Date is already optional everywhere.** No `required`, zod `optionalText(120)`, column `Memory.approxDateText String?`. Only the label
  (`app/share/memory-card-client.tsx:94`) does not say so.
- **Words are already optional when the card has media.** The rule is "a file, a recording or a few words":
  - client: `validateForSend`, `lib/memory-cards.ts:183-194`;
  - server: `submissionMemorySchema`, `lib/validations/memory.ts:84-92`, with `NEEDS_CONTENT` at `:39`;
  - six downstream guards in `features/`.
- **The empty-card error already gets the email treatment**: the summary link, the red border and ring
  (`app/_components/field-classes.ts:5-7`), the inline line, and scroll plus focus (`app/share/share-form.tsx:194-213, 268-277`).
- **Each card has "Where? (optional)"** (`memory-card-client.tsx:105-116`, `Memory.place`, max 200).
- **No GPS is read anywhere.**
  - `Media.capturedAt`/`exif` exist and are never written, and there is no EXIF library.
  - The browser uploads the picked `File` untouched (`lib/upload-client.ts:17-26`), so originals in Blob keep their EXIF.
  - Derived copies are stripped [C41].
- **Environments.** Previews get their own `preview/<git-branch>` database branch [C46]. Every environment shares one Blob store, and
  `storagePrefix()` scopes each environment's keys (`lib/site-url.ts:28-36`). Every Vercel build runs `prisma migrate deploy` [C47].
- **PR #60** (open, branch `claude/affectionate-cannon-an6o5d`):
  - adds `Memory.latitude/longitude` (MCP-owned, "never a residence") and `coordinatesSchema` (`lib/validations/memory.ts:164-170`);
  - adds eight MCP tools and `includeCoordinates`;
  - parks "Per-media coordinates" as its §8.4 [C39].

### 1.2 Evidence (sanitized; full notes go to `docs/plans/evidence/2026-11-photo-gps/README.md` at B0)

- **Production photos carry GPS.** Memory `62a9a223-0555-47cc-9a38-3e41dbbe7820` has two READY JPEGs, read on 2026-11-06 with a
  read-only script and the `.env` credentials (Rob's instruction).
  - Media `b58bbb0c-…` (`IMG_0565.jpeg`): iPhone 7, iOS 12.1.4, 2019-03-15, full GPS IFD, 28.40 N / 81.45 W (2 dp), 10 m error.
  - Media `52bb6436-…` (`IMG_5415.jpeg`): 384×512, software "Google", no GPS IFD.
  - Nominatim reverse (jsonv2) at zoom 18 returned `name "Grande Vista Golf Club"`, `leisure/golf_course`, city Orlando, state
    Florida, with a `house_number` in the address. Zoom 14 returned "Williamsburg"; zoom 10 returned "Orange County".
- **Phones often strip GPS before the page sees it.**
  - iPhone library picks include metadata unless the person turns Location off, and they arrive as JPEG [C25].
  - Safari "Take Photo" re-encodes with no EXIF (WebKit `WKFileUploadPanel.mm`: "FIXME: Should EXIF data be maintained?").
  - Android hides location from apps without `ACCESS_MEDIA_LOCATION` [C26]. Chrome lacks it (Chromium issues 40721166 and 40287342:
    zeros and blank refs).
  - `accept="image/*"` is reported to strip GPS on Android [C12]. Our inputs use an explicit type list.
  - Desktop browsers pass files through.

## 2. Rob's rulings (final; do not re-ask)

| # | Date | Ruling |
|---|---|---|
| R1 | 2026-11-06 | "we need at least on item to complete a memory. It could be a photo, audio, video, text." Empty cards get the same visible treatment as a missing email. |
| R2 | 2026-11-06 | Place names come from **OpenStreetMap Nominatim**, a deliberate, informed choice after the usage policy was shown [C1–C4]. |
| R3 | 2026-11-06 | Build the GPS feature **stacked on PR #60**; the MCP server gets the lookup too. |
| R4 | 2026-11-06 | Read-only production checks may use `.env` / Neon MCP; production writes are Rob's STOP points. |
| R5 | 2026-11-06 | "I'd like to do **full detail cordinates** goign to open streetmaps and then the user can adjust if too personal." |
| R6 | 2026-11-06 | `brew install exiftool` approved (for the GPS HEIC fixture). |
| R7 | 2026-11-06 | Issue #58 stays closed; both PRs say "Refs #58". |
| R8 | 2026-11-06 | Outside review: apply Bucket 1 and Bucket 2 by judgement. Bucket 3 goes in the PR as "Not doing (and why)", written by a subagent (§11). Bucket 4 goes in the PR notes as follow-ups with severity (§12). The goal: "world-class code … that will quickly pass a PR review." |

## 3. Decisions (veto any before approval)

| # | Decision | Why |
|---|---|---|
| D1 | GPS is stored **per photo** (`Media.latitude/longitude`); `Memory.latitude/longitude` is never written by this feature | "attached to that photo"; memory coordinates are MCP-owned for named places [C39, C40] |
| D2 | The **server reads GPS from the stored original**, in its own step, independent of derived copies. The browser reads GPS **only to suggest**; values sent by the browser are never stored | Originals untouched [C41]; client values are untrusted |
| D3 | GPS outcomes are durable: `gpsCheckedAt` (null = not yet decided) and `gpsAttempts` (at most 3). A cron step retries undecided photos and is also the backfill | "No matter what"; cron step (g) never revisits derived photos [C48] |
| D4 | Suggestions are **buttons a person taps**; nothing fills automatically | Reverse geocoding may give "unexpected results" [C6]; R5 "the user can adjust" |
| D5 | A label is **landmark + town + region** or **town + region**, never a house number, road or postcode. A landmark is used only for named non-residential features. Labels are at most 200 characters | MCP place rule [C40]; the Where field max is 200 |
| D6 | Coordinates go to Nominatim **at full detail (6 dp)** from our server, with **no** name, email, memory id or visitor IP | R5. The policy asks for no personal data [C4]; Rob accepts that a photo taken at home sends that point, and requests carry no identity |
| D7 | **Only Production calls Nominatim**: `PLACES_PROVIDER` = `nominatim` (Production), `stub` (Preview and local), `off` (default) | The limit is per application [C2]; previews have separate databases and throttle rows [C46] |
| D8 | Site-wide **lease and fence** throttle: claim, send at once, then fence next-allowed = DB `now()` + 1.1 s; the lease expires after 10 s | Real sends are spaced, not just reservations [C1, C23, C22] |
| D9 | Quota contract: the **viewer counter counts incoming requests** and is checked first; the **provider counter counts calls actually sent**, charged after the slot is won and a fresh cache check misses | Clear accounting; the fresh check also stops duplicate calls for the same new point |
| D10 | Lookups use a **POST Route Handler**, not a Server Function | Server Actions queue one at a time [C15] |
| D11 | **ExifReader 4.51.0** (4.54.0 since the Team Code Review round, §5.8), pinned exactly (MPL-2.0; JPEG and HEIC). In the browser, `length: 'auto'` on the `File` | Maintained; adaptive reads handle metadata past a fixed prefix [C9, C11] |
| D12 | 0/0, NaN, out-of-range values or a missing N/S/E/W ref count as **absent** | Android sends zeros and blank refs |
| D13 | MCP `suggest_places` returns, for landmark labels, the **matched place's own point**; the skill proposes `set_coordinates` only with that, never the camera point | Camera point ≠ place point [C7] |
| D14 | Coordinates are **shown nowhere on the site**, admin page included; only MCP with `includeCoordinates`. Pino redacts them; Sentry keeps them | PR #60 rule [C39]; logger rule [C44]; Rob's telemetry ruling [C38] |

## 4. Reviews folded in

**Builder check (separate Plan subagent, 2026-11-06), 11 findings, all applied:**
- the backfill script's `server-only` crash (superseded by the cron step, §B3);
- layer-safe types in `lib/places/`;
- buttons outside the Where `<label>`;
- PR A copy, DESIGN.md and the wording mismatch;
- the MCP 30 s limit;
- the rolled-back spacing test;
- the B6 gaps;
- the tool count pinned in three test spots;
- `Prisma.DbNull` for null JSON;
- the PR A/B overlap;
- test anchors.

**Outside review (Rob's friend, 2026-11-06), sorted into four buckets (R8):**

| Point | Bucket | Where |
|---|---|---|
| Throttle spaced reservations, not sends; previews have separate throttles | 1 | D7, D8, §B4, tests in §B4 |
| A temporary GPS failure becomes permanent; parse errors read as "no GPS" | 1 | D3, §B2, §B3 |
| 4-dp rounding is not anonymization | 1, resolved by R5 | D6 (explicit rule) |
| Camera point vs named-place point in MCP | 1 | D13, §B7 |
| Quota accounting order; same-point concurrency | 1 | D9, §B4 |
| Fixed 256 KiB browser read misses late metadata; HEIC fixture optional; main thread | 1 (adaptive read, late-EXIF and HEIC fixtures) / 3 (worker) | D11, §B2, §11 |
| Labels ≤ 200 characters; MCP result codes distinguish retryable from final | 1 | D5, §B4, §B7 |
| Handoff: authoritative copy, executable cold start, evidence ledger, environment manifest, release and recovery, stacked-PR procedure, portable evidence, agent fallback, untracked docs, #58 closed | 1 | header, §5, §10, R7 |
| Backfill resume contract | 3 (no script; the cron step is idempotent) | §11 |
| Custom ExifReader build (my Bucket 2 candidate) | moved to 3 by judgement: the README calls it beta and it needs a build step | §11 |
| `capturedAt` from EXIF (my Bucket 2 candidate) | moved to 4 by judgement: `DateTimeOriginal` has no timezone | §12 |

## 5. Cold start (read this first after a compaction or handoff)

### 5.1 Executable start-up (run in order; stop on any surprise and log it)

```bash
export PATH=/opt/homebrew/bin:$PATH && node -v          # expect v26.x (nvm default v22 is wrong)
cd /Users/rob/Documents/active_work/jowray_com
git remote -v                                           # expect origin https://github.com/RobertdWray/jowray_com.git
git status --short                                      # expect ONLY: ?? docs/memory-drafter.md and ?? "docs/plans/Execution plan bearer-protected MCP endpoint (apimcp) …md" — never touch, stage or delete them
git fetch origin
git worktree list                                       # find existing worktrees from §5.2; RESUME them, never recreate or delete
gh pr view 60 --repo RobertdWray/jowray_com --json state,headRefOid,mergedAt,mergeCommit
gh pr list --repo RobertdWray/jowray_com --state open --json number,title,headRefName,baseRefName
# In each existing worktree: git status --short; git log --oneline -5; compare with the ledger (§5.7). Uncommitted work = resume, not discard.
# Missing worktree → create it per §5.2, then: npm ci
ls -a <worktree> | grep '^\.env'                        # expect none: checks run without env files; local e2e passes env per process (§5.3)
```

### 5.2 Execution manifest

| PR | Branch | Worktree | Base (pinned) | PR text |
|---|---|---|---|---|
| A, labels and the empty-card rule | `fix/share-optional-labels` | `/Users/rob/Documents/active_work/jowray_wt_share_optional` | `origin/main` at A0 (record SHA) | "Refs #58" |
| B, photo GPS, places and MCP | `feat/photo-gps-places` | `/Users/rob/Documents/active_work/jowray_wt_photo_gps` | `origin/claude/affectionate-cannon-an6o5d` at B0 (record SHA; `9d841a8` at review) | "Refs #58"; includes §11 and §12 |

Create a missing worktree with:

```bash
git worktree add ../jowray_wt_photo_gps -b feat/photo-gps-places origin/claude/affectionate-cannon-an6o5d
```

The main checkout is behind `origin/main` and shared with other sessions. Never build there.

### 5.3 Environment manifest (fill the blanks during execution; never write secret values)

| Item | Value or source | Owner / cleanup |
|---|---|---|
| Node | Homebrew Node 26 (`/opt/homebrew/bin`) | — |
| Unit/lint/build checks | no `.env*`, `DATABASE_URL` unset (`npm run validate`, `npm run test:run`, `npm run build:offline`) | — |
| Integration DB | local Postgres 18, `TEST_DATABASE_URL=postgres://…/jowray_test` (record port) | builder drops the test DB at the end |
| Local e2e DB | throwaway Neon branch `gps-e2e-<yyyymmdd>` from production via Neon MCP (record branch id `br-…`), pooled URL as `DATABASE_URL`, unpooled as `DATABASE_URL_UNPOOLED`, passed as process env to `next dev` | **Rob approves deleting it** at the end (record in ledger) |
| Local e2e server | `next dev -p 3107` (record port) | builder stops it |
| Blob | shared store; the local token comes from `.env.local` key `BLOB_READ_WRITE_TOKEN` (value never printed); local uploads land under the dev `storagePrefix()` | cron purge rules apply |
| Outbound email | `OUTBOUND_ENABLED` unset = false [C49], so mail goes only to `OUTBOUND_ALLOWLIST` | — |
| Places locally | `PLACES_PROVIDER=stub` (process env) | — |
| Vercel env (Rob) | Production `PLACES_PROVIDER=nominatim`; Preview `PLACES_PROVIDER=stub`; caps default | Rob, at B12 |
| `.env.local` caution | any `vercel` command may overwrite `.env.local`; re-check the Neon dev override afterwards | — |

### 5.4 Standing rules

- Branch plus PR for everything; `main` needs a PR plus `ci`.
- TDD for the GPS step, the cron step and the throttle [C37].
- No `eslint-disable` without Rob's "YES"; no band-aids; no force-push; never print secrets.
- Never print real photo coordinates beyond 2 dp in logs, PRs or chat.
- Fixtures use the Statue of Liberty (40.689247 N, 74.044502 W) or official Nominatim doc examples, never a family photo.
- Keep `accept` explicit on the photo inputs (never `image/*`) [C12].

### 5.5 Roles and fallback

- **Orchestrator** (main session): owns the ledger, approvals, merges into the stacked branch, and mirroring the plan.
- **Builder** (Opus subagent, fresh context, one ledger step at a time, TDD): works in the worktree and returns the commit SHA plus check
  output.
- **Reviewer** (separate subagent; `/code-review high` on the PR diff only, without the builder's reasoning): the orchestrator sorts its
  findings into the four buckets.
- **Fallback.** If subagents are unavailable, the orchestrator executes inline with `superpowers:executing-plans` and still runs
  `/code-review high` before opening the PR. If the named model is unavailable, any capable model follows this runbook unchanged. Review
  is never skipped.

### 5.6 Stop points (Rob only)

1. Merging PR A, PR #60 and PR B.
2. Setting Vercel `PLACES_PROVIDER` (Production `nominatim`, Preview `stub`).
3. Deleting the throwaway Neon branch.
4. Device checks on his iPhone and an Android phone.
5. Any production write outside the deployed cron (none planned).
6. If OSMF ever asks us to stop: `PLACES_PROVIDER=off`, then redeploy.

### 5.7 Ledger (update after every step; states: todo → implemented → reviewed → merged → deployed → verified)

| Step | What | Done-check | State | Commit | Evidence | Next |
|---|---|---|---|---|---|---|
| A0 | Worktree from `origin/main` | `git log -1` = recorded `origin/main` | reviewed | `982a141` (base) | worktree `jowray_wt_share_optional` | A1 |
| A1 | Tests first (messages) | RED for the right reason | reviewed | `051f043` | RED: 3 failures on the old text only | A2 |
| A2 | Copy and DESIGN.md | tests GREEN | reviewed | `051f043`, `90e50fe` | GREEN 73/73; one shared `NEEDS_CONTENT_ITEMS` phrase after review | A3 |
| A3 | Checks, runtime check, docs | three checks pass; §9.A bullets pass | reviewed | `96ec1cb`, `75c3819`, `86eff4d` | `docs/plans/evidence/2026-11-share-optional/` (on the PR A branch) | A4 |
| A4 | PR A opened ("Refs #58"), `ci` green, review sorted | PR URL; review verdict | reviewed | `f2495a0` (merge of `origin/main`) | [#63](https://github.com/RobertdWray/jowray_com/pull/63); `/code-review high` + spec: Approved, fix round 1 re-reviewed clean | Rob merges |
| B0 | Worktree from #60; plan and evidence README committed | `docs/plans/2026-11-06-photo-gps-places.md` plus `docs/plans/evidence/2026-11-photo-gps/README.md` in `git log` | reviewed | `ba9c884` (base `9d841a8`) | exiftool 13.55 (R6); local PG 18 on 127.0.0.1:55432 | B1 |
| B1 | Schema and migration | integration CHECK tests pass on PG 18 | reviewed | `9b1d5db` | RED three ways, GREEN; `migrate diff` no drift | B2 |
| B2 | `lib/photo-gps.ts` and fixtures (late-EXIF JPEG, GPS HEIC via exiftool) | unit tests GREEN | reviewed | `9d10cb6`, `4c81778` | 48/48; XMP excluded (ruling) | B3 |
| B3 | `extractPhotoGps`, after-hooks, cron step (h) | unit and route tests GREEN incl. the fail-once-then-recover test | reviewed | `058c1cd`, `d63bd2f`, `a87d2e3` | 24/24 + integration; readPrefix deadline after review | B4 |
| B4 | Places: env, lib, services, Nominatim + stub, `lookupPlace` | unit tests GREEN; fake-provider timing tests; real-PG two-caller spacing test | reviewed | `1368561`, `1302b3e` | sends ≥ 1.1 s apart (fake clock and PG 18); 3 s send budget after review | B5 |
| B5 | `POST /api/places/suggest` | route tests GREEN | reviewed | `39d6018` | 24/24; review clean | B6 |
| B6 | Share UI suggestions | lib tests GREEN; runtime check with stub shows buttons | reviewed | `8faf41e`, `7ca8a9c`, `8f20e67` | `b6-*` evidence; queue helper after review | B7 |
| B7 | MCP: media coordinates, `suggest_places`, skill | `mcp.test.ts` updated in all three spots; tool tests GREEN | reviewed | `e6cd48c`, `8b2c9be`, `0b2ec46` | 9 tools both eras | B8 |
| B8 | Logger keys, docs, layout sync | grep checks in §B8 | reviewed | `dd2aa6d`, `41a8598`, `d61e0d9` | both greps hit; AGENTS.md block identical | B9 |
| B9 | Full checks plus local e2e (§9.B) | all bullets pass; Neon branch id recorded | reviewed | `ccae5ef` | Neon `gps-e2e-20261106` = `br-winter-lab-bbd4405m`; `b9-*` evidence | B10 |
| B10 | PR B opened (base `main`; #60 merged first), `ci` green, review sorted | PR URL; review verdict | reviewed | `1e4d0c8`, fix wave `cbb50b2`…`6c5e996`, Team Code Review wave (see §5.8) | [#66](https://github.com/RobertdWray/jowray_com/pull/66) (draft); per-step reviews closed; final whole-branch review + `/code-review high`: ready with fixes → one fix wave; Team Code Review (George + Oscar, 8 findings): ExifReader 4.54.0, wider `excludeTags`, 509 refusal, step (h) margin, purge doc; migrations unchanged (F16) | Rob's final review process, then merge |
| B11 | After #60 (and A) merge: transition per §10 | `git diff origin/main...HEAD --stat` lists only B files; `ci` green | implemented (early) | `7c110d2`, `b43d1db` | #60 merged 2026-11-06 18:56 UTC as merge commit `d583308`; merged `origin/main` before B6 and again after #61; only B files in the diff | after A merges: merge again |
| B12 | Rob: Vercel env, merge, deploy, smoke, device checks (§9.C, §9.D) | deployed SHA recorded; smoke passes | todo | | | done |

### 5.8 Rulings log (execution-time deviations: "Ruling: what — why — cost if wrong")

- Ruling: PR A and PR B were built at the same time in their own worktrees — separate branches cannot collide; the one overlap is merged at B11 — cost if wrong: a slightly larger merge.
- Ruling: PR A's runtime check used the Neon `dev` branch with env files copied in for the run and deleted after — §9.A names no database — cost if wrong: one throwaway row on `dev`.
- Ruling: the Neon `dev` branch was brought up to `main` with `prisma migrate deploy` (four additive migrations already in production) — every send 500'd without them — cost if wrong: none; `dev` is meant to track `main`.
- Ruling: the B1 migration was generated against a local PG 18 database, not a Neon branch — only a database at the latest migration is needed — cost if wrong: none.
- Ruling: PR A's per-step review and its `/code-review high` were one reviewer — ~60 lines of copy — cost if wrong: one less pass on a copy PR.
- Ruling: the `/share` intro now says the date is optional ("if you know") and names the non-word options — it asked everyone for a date, contradicting #58 and R1 — cost if wrong: Rob rewords one sentence.
- Ruling: `readGpsFromFile` falls back to the bytes path when the `length: "auto"` read rejects — ExifReader rejects metadata-less WebP/HEIC with an untyped error; no message matching — cost if wrong: one extra local read for such files.
- Ruling: GPS refs must be exactly N/S/E/W and `MetadataMissingError` is `absent` (D12) — cost if wrong: a rare lowercase-ref camera gives no suggestion.
- Ruling: `excludeTags` gains `xmp: true` on both read paths (deviates from §B2's verbatim options) — GPS comes only from EXIF; skips parsing untrusted XML — cost if wrong: none for GPS.
- Ruling: the GPS claim is compare-and-set on the attempt count just read, not `gpsAttempts < 3` — with `< 3` two workers can both claim — cost if wrong: none; strictly stronger.
- Ruling: no new index for step (h) — measured 0.3 ms on 5,010 rows; a partial index needs Prisma's `partialIndexes` preview feature — cost if wrong: a slower cron query at a size this site won't reach.
- Ruling: a `failed` GPS read is counted and sent to Sentry but does not mark the cron run errored, like (g) — cost if wrong: the failure shows in Sentry, not the check-in.
- Ruling: with `PLACES_PROVIDER` `off` or `stub`, `lookupPlace` answers right after the viewer count without reading the cache — Preview databases copy production, so a cache read would hide whether the stub works; `off` is a total switch — cost if wrong: cached labels are not shown while `off`.
- Ruling: a lookup that cannot send within 3 s of winning the slot releases it and answers `busy` (review finding on §B4's proof: a stall between claim and send could break the 1.1 s spacing) — cost if wrong: an occasional extra `busy`.
- Ruling: Sentry's `sentry-trace`/`baggage` on Nominatim requests are disclosed, not changed — no personal data; `tracePropagationTargets` is a repo-wide choice — cost if wrong: OSMF sees our trace metadata; follow-up F10.
- Ruling: B11's merge of `origin/main` ran before B6 (and again after #61) — #60 merged as a merge commit and its later commits touched files B7/B8 edit — cost if wrong: none.
- Ruling: `suggest_places` keeps `photos[].coordinates` and its description names it as the camera point — less churn than renaming; Rob approves every save — cost if wrong: a model could conflate the points.
- Ruling: GPS reads on /share have their own queue (cap 2), separate from lookups (cap 2) — lookups can wait seconds on the site slot — cost if wrong: up to four tasks at once on a phone.
- Ruling: migrations are append-only once PR #66's Preview build applied `20261106200000_photo_gps_places`; the final fix wave adds `20261106210000_photo_gps_claim_lease` — cost if wrong: one extra small migration.
- Ruling: the GPS claim became a time-limited lease (`Media.gpsClaimedAt`, deriveMedia's pattern) instead of leaving overlapping reads as a follow-up — the final review ranked it first — cost if wrong: one nullable column.
- Ruling (Team Code Review round): `exifreader` 4.51.0 → 4.54.0, pinned exactly, after a supply-chain check (same maintainer, provenance-attested GitHub Actions publish, same `scripts`, no new network/fs/eval/child_process in `src/` or `dist/`) — 4.54.0 caps a PNG's text chunks at 4,096; on 4.51.0 a crafted 25 MB PNG grew the heap by about 921 MB — cost if wrong: a three-day-old release.
- Ruling (Team Code Review round): both read paths also skip `icc`, `iptc`, `photoshop`, `makerNotes` and `thumbnail`; `png` is kept, because ExifReader parses PNG text chunks whenever it parses `exif` — cost if wrong: none for GPS.
- Ruling (Team Code Review round): Nominatim's 509 is a refusal (`provider_refused`) like 403 and 429 — cost if wrong: a transient 509 ends an MCP call that a retry might have finished.
- Ruling (Team Code Review round): cron step (h) starts a photo only with the 15 s read deadline plus a 5 s database margin (`GPS_DB_MARGIN_MS`) left — the read's deadline does not cover the row read, claim and decision write — cost if wrong: one fewer photo in a run that started (h) late.
- Ruling (Team Code Review round): the two PR migrations are not edited to add `SET lock_timeout` — Prisma v7 docs: `migrate deploy` "Compares applied migrations against the migration history and **warns** if any migrations have been modified", and both are applied on throwaway databases — cost if wrong: a deploy-time `ALTER TABLE` could queue behind a long transaction; F16.

---

## 6. PR A — "at least one piece" stated up front; date and words labelled optional

One list phrase is used everywhere: **"a photo, a video, a voice recording or a few words"**.

1. **`app/share/memory-card-client.tsx`** [C31, C35]
   - Under the card heading, add one standalone helper line, styled `text-small ${helperClass}` like `card-media-client.tsx:211`:
     "Add at least one: a photo, a video, a voice recording or a few words. Everything else is optional."
   - Date label: "When is this memory from? (optional, roughly is fine)", inline per DESIGN.md:154-155.
   - Words label: "Your memory of Jo" plus inline helper "(optional with a photo, video or voice recording)".
   - "Where? (optional)" is unchanged.
2. **`app/share/card-media-client.tsx:150`** [C31]: drop "(optional)" from "Add a photo, video or voice recording (optional)".
3. **`lib/memory-cards.ts:190`** [C43]: "Memory {n} needs at least one: a photo, a video, a voice recording or a few words." The target stays
   `note`, so the email-style reveal applies unchanged [C43].
4. **`lib/validations/memory.ts:39`** [C35]: `NEEDS_CONTENT` = "Add at least one: a photo, a video, a voice recording or a few words".
5. **`design/DESIGN.md:65, :68`** plus the media helper text [C31]: update in the same commit.
6. **Tests first** [C37]: the messages at `__tests__/lib/memory-cards.test.ts:63, :68`, plus any text assertion in
   `__tests__/lib/validations-memory.test.ts`.
7. **Docs** [C31]: `docs/features/share-form.md`. The PR text says "Refs #58" (R7).

The "files or words" guards in `features/` are unchanged (R1).

---

## 7. PR B — photo GPS saved per photo, place suggestions on /share, MCP lookup

### B0. Setup and portable evidence

- Run §5.1 and create the worktree (§5.2). Run `npm ci`. `brew install exiftool` (R6).
- Commit the plan copy, plus `docs/plans/evidence/2026-11-photo-gps/README.md`:
  - §1.2 at 2 dp;
  - the research sources ([C25], [C26], [C12] and the Chromium/WebKit links);
  - the method (a read-only SELECT plus Blob `get`; no script committed).

### B1. Schema and migration [C19, C20, C21, C39]

- `model Media` gains, after `place`:
  - `latitude Float?` and `longitude Float?`, commented "WGS 84 from the original's EXIF; never shown on the site; read through
    /api/mcp";
  - `gpsCheckedAt DateTime?`, meaning "found or absent decided; null = not yet";
  - `gpsAttempts Int @default(0)`.
- `model PlaceLookup { provider String; latE6 Int; lonE6 Int; result Json?; fetchedAt DateTime @default(now()); @@id([provider, latE6, lonE6]) }`
  - `result` holds the trimmed response: `name`, `category`, `type`, `addresstype`, the place point `lat`/`lon` [C7], and
    `address.{city,town,village,hamlet,county,state,country,country_code}`.
  - Never `house_number`, `road` or `postcode`.
  - `Prisma.DbNull` means "provider had no result".
- `model PlaceLookupThrottle { provider String @id; nextAllowedAt DateTime; leaseToken String?; leaseUntil DateTime? }`.
- `prisma/migrations/20261106200000_photo_gps_places/migration.sql`: generated with `migrate dev --create-only` on a dev branch, then
  CHECKs added by hand [C21]. It is expand-only:
  - columns `DOUBLE PRECISION` [C20], `TIMESTAMP(3)`, and `INTEGER NOT NULL DEFAULT 0`;
  - CHECKs `Media_coordinates_pair`, `Media_latitude_range` and `Media_longitude_range` (same SQL as `Memory_*` in #60 [C39]);
  - CHECK `Media_coordinates_checked`: `"latitude" IS NULL OR "gpsCheckedAt" IS NOT NULL`;
  - the two tables.
- `__tests__/integration/media-coordinates.test.ts` (rolled-back pattern like #60's): pair, ranges, `Media_coordinates_checked`, and a
  `PlaceLookup` round trip with `Prisma.DbNull`.

### B2. `lib/photo-gps.ts`, isomorphic and no `server-only` [C9, C10, C11, C18, C24]

- `package.json`: `"exifreader": "4.51.0"` exactly (4.54.0 since the Team Code Review round, §5.8).
- The result type: `type GpsRead = { status: "found"; coordinates: Coordinates } | { status: "absent" } | { status: "failed"; error: unknown }`.
- `readGpsFromFile(file: File): Promise<GpsRead>` (browser):
  - Calls `ExifReader.load(file, { length: "auto", expanded: true, includeOffsets: true, excludeTags: { mpf: true } })`, so only the
    metadata bytes are read, via `File.slice` [C11].
- `readGpsFromBytes(bytes: Uint8Array): GpsRead` (server):
  - Calls `ExifReader.load(bytes, { expanded: true })` [C9]; it is always given bytes, never a string.
- Both validate the same way:
  - `gps.Latitude/Longitude` [C10] must pass PR #60's `coordinatesSchema` [C18];
  - the pair must not be 0/0;
  - the raw `GPSLatitudeRef`/`GPSLongitudeRef` must be present.
  - Otherwise the result is `absent` (D12). A thrown parse error is `failed`, never `absent`.
- `jpegMetadataComplete(prefix: Uint8Array): boolean`: walks JPEG markers from SOI and is true once SOS (`FFDA`) is reached inside the
  prefix. The server uses it to decide whether a prefix result is final.
- Fixtures, made by tests or committed with their provenance in `__tests__/fixtures/README.md`:
  - JPEG with GPS via sharp `withExif` IFD3 [C24], plus S/W variants, zeros, missing refs and no EXIF;
  - a **late-EXIF JPEG**: SOI, then a 200 KiB APP2 filler, then the EXIF APP1, assembled in the test from the sharp output;
  - **`gps.heic`** (acceptance requirement), made with
    `exiftool -GPSLatitude=40.689247 -GPSLatitudeRef=N -GPSLongitude=74.044502 -GPSLongitudeRef=W -o __tests__/fixtures/gps.heic __tests__/fixtures/tiny.heic`.
- `__tests__/lib/photo-gps.test.ts` covers found, absent, failed, the late-EXIF file through `readGpsFromFile` (jsdom/undici `File`),
  `gps.heic`, and `jpegMetadataComplete`.

### B3. Durable GPS extraction, independent of derived copies [C32, C37, C41, C44, C48, C50]

- New `features/media/extract-photo-gps.ts` (`server-only`): `extractPhotoGps({ mediaId })`. It returns
  `"found" | "absent" | "failed" | "skipped"` and never throws.
  1. Load the row. It must be READY, `image/*`, not deleted, its memory not deleted, `gpsCheckedAt` null, `gpsAttempts < 3`, and
     `storageKey` starting with `storagePrefix()`. Otherwise `skipped`.
  2. Conditional `updateMany` increments `gpsAttempts` where `gpsCheckedAt IS NULL AND gpsAttempts < 3`. Zero rows means another worker
     has it: `skipped`.
  3. Read the bytes:
     - JPEG: `storage.readPrefix(key, 128 KiB)` [C50]. If the result is not `found` and `!jpegMetadataComplete(prefix)`, read the whole
       original with `storage.get` (≤ 25 MB) and parse again.
     - Other image types: read the whole original.
  4. `found`: conditional update where `gpsCheckedAt IS NULL` sets the coordinates plus `gpsCheckedAt`. `absent`: sets only
     `gpsCheckedAt`. `failed` or any thrown error: leave `gpsCheckedAt` null, `Sentry.captureException` with tag `step: photo_gps` [C32],
     and `log.warn`.
  5. Log `{ action: "photo_gps", mediaId, outcome, attempt }`, never coordinates [C44].
- Call sites; `deriveMedia` is **not** touched [C41]:
  - `features/memories/ingest-upload.ts`, next to `afterWithFlush("finalize.checksum_and_derive", …)` (`:258`): a separate
    `afterWithFlush("finalize.photo_gps", () => extractPhotoGps({ mediaId: outcome.mediaId }))` [C37, C41].
  - `app/api/upload/route.ts`, after-block (`:110` area): the same call after `recordMedia`; it is the closed-tab backstop
    [C37, C48].
- `app/api/cron/reconcile-uploads/route.ts`, new **step (h)** after (g) (`:598`) [C48]:
  - It takes READY `image/*` media of this environment (`storagePrefix()`), live, with `gpsCheckedAt IS NULL AND gpsAttempts < 3`,
    oldest first, at most 10 per run, inside the shared run budget (`maxDuration = 60`).
  - It runs `extractPhotoGps` sequentially and counts outcomes in the cron summary.
  - This step is also the backfill for photos uploaded before the feature: about 60 photos an hour.
- Tests first [C37]:
  - `__tests__/features/extract-photo-gps.test.ts`: found, absent, failed; the prefix escalation; skip rules; the attempt cap; a
    concurrent claim. **Fail-once-then-recover:** the first coordinate write throws, the second run writes.
  - `__tests__/api/reconcile.test.ts`: step (h) picks only eligible rows, respects the batch and budget, and leaves derived-copy logic
    unchanged.
  - `__tests__/features/ingest-upload.test.ts` and `__tests__/api/upload.test.ts`: the new after-hook is scheduled.

### B4. Places: env, provider, cache, throttle, counters, labels [C1, C2, C4, C5, C6, C7, C22, C23, C35, C36, C42]

- `server/config/env.ts`: its own sub-schema, `placesSchema` plus `getPlacesEnv = memoized("places", …)` [C36].
  - `PLACES_PROVIDER`: `z.enum(["nominatim","stub","off"]).default("off")`.
  - `PLACES_LOOKUP_URL`: URL, default `https://nominatim.openstreetmap.org`; switchable by config [C2].
  - `PLACES_DAILY_PROVIDER_CALLS`: `lenientPositiveInt`, default 500.
  - `PLACES_VIEWER_DAILY_REQUESTS`: default 60.
  - Tests in `__tests__/lib/env.test.ts`; rows in `docs/environment.md`.
- `lib/places/types.ts` (`PlaceResult`, `PlaceLabel = { text; kind: "landmark" | "town"; point?: Coordinates }`) and
  `lib/places/errors.ts` (`PlaceProviderRefusedError`), following `lib/image-derive-error.ts`, because `integrations/` may import only
  types from `services/` [C35].
- `lib/places/label.ts` (pure) builds labels from a result (D5):
  - `locality` = city ?? town ?? village ?? hamlet ?? county; `region` = state, plus the country when `country_code !== "us"`.
  - The town label is `locality, region`.
  - A landmark label (`name, locality, region`, with `point` = the result's own `lat`/`lon` [C7]) is used only when:
    - `name` is non-empty and differs from `locality`;
    - the category is in {amenity, tourism, leisure, historic, natural, waterway, aeroway}, or `place` with island/islet/square, or
      `boundary` with national_park/protected_area;
    - the result is never building/house/residential/apartments.
  - Labels over 200 characters are dropped.
  - Fixtures: the Nominatim docs examples [C5] (a Bologna house, so a residential result gives a town label only; a motorway gives no
    landmark), an Orlando-shaped golf club, a non-US town, an empty result, and a county-only rural point.
- `services/places/types.ts` (`ReverseGeocoder`, re-exporting the lib types) and `services/places/index.ts` (lazy
  `getReverseGeocoder()` choosing from `PLACES_PROVIDER`; nothing at module scope) [C35].
- `integrations/nominatim/client.ts` (`server-only`):
  - `GET {PLACES_LOOKUP_URL}/reverse?format=jsonv2&lat=…&lon=…&zoom=18&addressdetails=1&accept-language=en` [C5], with coordinates at
    6 dp (D6).
  - Header `User-Agent: jowray.com family memorial (https://www.jowray.com; memories@jowray.com)` [C1]; 5 s timeout; no retries.
  - 403/429 throw `PlaceProviderRefusedError`; other failures throw sanitized errors (pattern: `integrations/sendgrid/index.ts`).
  - It returns the trimmed result.
- `integrations/places-stub/client.ts`: returns one town label, "Photo location found near {lat 2 dp}, {lon 2 dp} (test)", with no
  network, so Preview and local device checks show whether GPS arrived.
- `features/places/lookup-place.ts` (`server-only`): `lookupPlace(point, { viewerKey?, deadline })` returns
  `{ ok: true, labels, attribution } | { ok: false, code }`, where `code ∈ rate_limited | daily_limit | busy | disabled | provider_refused | failed`.
  1. The key is `latE6`/`lonE6`.
  2. If there is a `viewerKey`: `countRequest("places:viewer:<sha256 prefix>", PLACES_VIEWER_DAILY_REQUESTS)` [C42]. Over the limit
     means `rate_limited` (nothing else consumed).
  3. Cache hit: return the labels.
  4. `off` means `disabled`. `stub` means the stub labels (no throttle, not cached).
  5. **Claim the lease** in one statement [C23]; the provider is a bind parameter:
     ```sql
     INSERT INTO "PlaceLookupThrottle" ("provider","nextAllowedAt","leaseToken","leaseUntil")
     VALUES (${provider}, now(), ${token}, now() + interval '10 seconds')
     ON CONFLICT ("provider") DO UPDATE SET "leaseToken" = EXCLUDED."leaseToken", "leaseUntil" = EXCLUDED."leaseUntil"
       WHERE "PlaceLookupThrottle"."nextAllowedAt" <= now()
         AND ("PlaceLookupThrottle"."leaseToken" IS NULL OR "PlaceLookupThrottle"."leaseUntil" <= now())
     RETURNING "leaseToken"
     ```
     No row returned means read `nextAllowedAt`/`leaseUntil`/`now()`, sleep min(wait, 500 ms) and retry until `deadline`, then `busy`.
  6. Re-read the cache. On a hit, **release** the lease (`leaseToken = NULL` where the token matches; `nextAllowedAt` unchanged, since no
     send happened) and return.
  7. `countRequest("places:provider", PLACES_DAILY_PROVIDER_CALLS)`. Over the limit means release and `daily_limit`.
  8. **Send immediately**. Then, in `finally`, **fence**:
     `UPDATE … SET "nextAllowedAt" = now() + interval '1100 milliseconds', "leaseToken" = NULL, "leaseUntil" = NULL WHERE "provider" = $1 AND "leaseToken" = $token`.
     Zero rows means the lease expired (it should never happen with a 5 s timeout and a 10 s lease): `log.warn`.
  9. Success: upsert the cache (`Prisma.DbNull` for no result), return labels plus `attribution: "© OpenStreetMap contributors"` [C8].
     Refusal: Sentry warning, `provider_refused`. Other failure: Sentry, `failed` (retryable).
  - **Guarantee:** a send starts before its fence's `now()`, and the next claim needs `now() ≥ fence + 1.1 s`. So real sends site-wide
    are at least 1.1 s apart, no transaction is held across HTTP [C22], and a dead holder blocks for at most 10 s.
- Tests:
  - `__tests__/features/lookup-place.test.ts`: the counter order (viewer before cache; provider only after the slot is won and the
    fresh check misses; `busy` costs nothing); the re-check that avoids a duplicate call for the same point; `off`/`stub`; refusal;
    deadline.
  - **Timing:** a fake provider records send timestamps and a fake db injects reply delays (0 ms vs 900 ms) and late timer wakeups;
    consecutive sends must be ≥ 1100 ms apart.
  - `__tests__/integration/place-throttle.test.ts` (committed, not rolled back; provider `test-<uuid>`; rows deleted in `afterAll`): two
    concurrent `lookupPlace` calls against a fake provider show sends ≥ 1.1 s apart on real Postgres 18.

### B5. `app/api/places/suggest/route.ts`, POST [C15, C16, C17, C18, C35]

- It reads `request.headers` (`viewerKeyFrom`) and `await request.json()` first [C17, C35]. `export const maxDuration = 30` [C35].
- Body: `lib/validations/places.ts` = PR #60's `coordinatesSchema` plus a refine rejecting 0/0 [C18].
- It calls `lookupPlace(point, { viewerKey, deadline: now + 20 s })`.
- Answers:
  - `{ success: true, data: { labels: string[], attribution } }`;
  - `{ error: { code, message } }` with 400 (invalid), 429 (`rate_limited`, `daily_limit`), 503 (`busy`, `disabled`, `provider_refused`)
    or 502 (`failed`).
- The endpoint is public by nature, so the counters are its guard [C16].
- Tests: `__tests__/api/places-suggest.test.ts`.

### B6. Share UI suggestions [C4, C6, C8, C14, C29, C30, C32]

- `lib/memory-cards.ts`: `CardMediaItem` gains `gps?: Coordinates | null` and `placeLabels?: string[] | null`, never persisted in the
  draft.
  - `undefined` means not looked at yet, or pending.
  - `null` means none, or failed.
  - `[]` means looked up, but no usable label.
  - New actions `setMediaGps` and `setMediaPlaces`. Tests in `__tests__/lib/memory-cards.test.ts` [C37].
- `app/share/use-place-suggestions.ts`, called once in `app/share/share-form.tsx` (owner of `state`/`dispatch`, `:121-122`) [C14, C15]:
  - It handles items with `kind === "PHOTO"`, using `const { readGpsFromFile } = await import("@/lib/photo-gps")` [C14].
  - Then it calls `POST /api/places/suggest` with concurrency 2, and drops results for removed items.
  - After a draft restore there are no files, so nothing runs.
  - It reports only unexpected outcomes (network, 5xx other than 503, a GPS `failed`) with
    `reportClientError(error, { surface: "share-form", step: "place_suggest" })` [C32].
  - It never reports `rate_limited`, `daily_limit`, `busy`, `disabled`, `provider_refused` or a 400.
- `app/share/memory-card-client.tsx` [C6]: wrap the Where `<label>` and `<PlaceSuggestions>` in one `<div>` carrying the label's current
  `flex-[1_1_220px] roomy:flex-none` classes.
- `app/share/place-suggestions-client.tsx`:
  - "From your photos:" plus one `<button type="button">` per unique label (card-wide dedupe, photo order, at most 6).
  - `min-h-tap` [C30]; `aria-pressed` when equal to the field.
  - A tap fills Where via `onField("place", label)` and never fills it automatically (D4) [C6]; the person can edit afterwards (R5).
  - A polite live region shows "Looking up where your photos were taken…" and then the buttons [C29].
  - The line "Place names © OpenStreetMap contributors" links to `https://www.openstreetmap.org/copyright` [C1, C8].
  - It renders nothing without GPS, and is disabled while sending.

### B7. MCP (stacked on PR #60) [C27, C28, C39, C40, C45]

- `features/admin/get-memory.ts`: media rows carry `coordinates` **only** with `includeCoordinates` [C39].
- `features/places/suggest-for-memory.ts`, for READY, live `image/*` media with coordinates:
  - It calls `lookupPlace` per unique E6 point (no viewer key) with a deadline 20 s from the start (`/api/mcp` `maxDuration = 30`).
  - It returns `{ photos: [{ mediaId, originalFilename, coordinates, labels: PlaceLabel[] }], pending: mediaId[], attribution }`.
  - `pending` lists points that came back `busy` or `failed` (retryable).
  - Call-level `isError` codes: `not_found`, `disabled`, `daily_limit`, `provider_refused`. These are not retryable.
- `app/api/mcp/tools.ts`: a ninth tool, `suggest_places`.
  - Input: `adminMemoryIdSchema`. Annotations: `{ readOnlyHint: true, openWorldHint: true }` [C27].
  - Results go through `toolResult`/`runTool` [C28].
  - Description: "Place names near where each photo was taken, from the GPS saved with the photo (OpenStreetMap). Read-only. Landmark
    labels carry the place's own point; the photo's point is where the camera was. If `pending` is non-empty, call again at most twice
    (results are cached), then tell Rob which photos are still pending. ${PLACE_RULE}" [C40].
- Tests: `__tests__/api/mcp.test.ts` pins the tool count at `:128` (sorted names), `:158` (inline snapshot) and `:899`
  (`toHaveLength(8)` → 9). Add `@/features/places/suggest-for-memory` to the hoisted mocks (`:21-37`). Cover the codes, `pending` and
  both eras. `__tests__/features/admin-memories.test.ts` covers media coordinates only with the flag.
- Wording "eight" → "nine": `app/api/mcp/route.ts:36`, `app/api/mcp/tools.ts:25, :128`, `docs/features/mcp.md:3, 12, 59, 122, 139`.
  Done-check: `grep -rn "eight" app/api/mcp docs/features/mcp.md` shows no stale count.
- `docs/skills/jowray-draft-memory/SKILL.md`: after photos exist, call `suggest_places`.
  - Propose a `place` text via `update_memory`.
  - Propose `set_coordinates` only for a landmark label, with that label's `point`, never a photo's coordinates (D13).
  - **Ask Rob first** [C40].
- MCP has no file upload (draft-on-behalf: "attachments are not ingested" [C45]). Rob's iPhone flow: open the claim link in Safari, pick
  from Photos with Location on, then in Claude Desktop "suggest places for memory X". GPS is saved from the original either way (D2).

### B8. Logger, docs, layout [C35, C38, C44]

- `lib/logger/logger.ts` `PII_KEYS`: add `"latitude"` and `"longitude"` [C44]. Sentry is unchanged [C38].
  Done-check: `grep -n '"latitude"' lib/logger/logger.ts`.
- Docs:
  - `docs/features/media-uploads.md`: extraction step, cron (h), outcomes [C41].
  - `docs/features/share-form.md`: suggestions and Rob's informed Nominatim choice with the policy link [C3].
  - `docs/features/mcp.md`: ninth tool [C27, C45].
  - `docs/environment.md`: four keys and the Production/Preview values [C36].
  - `docs/code-layout.md` plus the synced `AGENTS.md` block: `integrations/nominatim`, `integrations/places-stub`, `services/places`,
    `features/places`, `features/media/extract-photo-gps`, `lib/photo-gps`, `lib/places` [C35].
  - Done-check: `grep -n "nominatim" docs/code-layout.md AGENTS.md`.

### B9. Release and recovery (goes into the PR description)

- **Builds.** Every Vercel build (previews too) runs `prisma migrate deploy && prisma db seed && npm run build` [C47]. The migration is
  expand-only: nullable columns, a defaulted integer, new tables, and CHECKs that hold for all existing rows. Old code ignores it.
- **Activation order:**
  1. #60 merged and deployed.
  2. PR A merged (independent).
  3. Rob sets `PLACES_PROVIDER` (Production `nominatim`, Preview `stub`).
  4. PR B transitioned (§10) and merged.
  5. Production deploy.
  6. Verify the deployed SHA equals the merge commit (`gh api repos/RobertdWray/jowray_com/deployments --jq '.[0] | {sha, environment}'`
     or the Vercel dashboard).
- **Smoke test, read-only apart from the cache:**
  1. Within about 20 minutes, cron step (h) fills `Media.latitude/longitude` for `b58bbb0c-…`. Read it with a read-only SELECT.
  2. MCP `suggest_places` on memory `62a9a223-…` returns labels near "Grande Vista Golf Club, Orlando, Florida" and "Orlando, Florida".
- **Rollback.**
  - Vercel instant rollback to the previous deployment; the schema stays.
  - Lookups only: `PLACES_PROVIDER=off` and redeploy. GPS extraction **keeps running** (it does not depend on the provider).
  - Data already written stays valid.

---

## 8. PR description checklist (both PRs)

- **Title.** A: `fix(share): say what a memory needs; date and words optional`. B:
  `feat(photos): save photo GPS, suggest places on /share and via MCP`.
- **Body:**
  - summary;
  - "Refs #58" (R7);
  - what changed by commit;
  - test plan (§9);
  - release and recovery (§B9, B only);
  - **Not doing (and why)** (§11, B; A gets items 8 and 10 only);
  - **Follow-ups** (§12);
  - the attribution lines from the session's system reminder.
- **After each review round:** add new declined items to "Not doing" and new out-of-scope items to "Follow-ups", so later rounds don't
  re-raise them.

## 9. Verification

### 9.A PR A

- `npm run validate && npm run test:run && npm run build:offline`, with no `.env*`.
- `next dev` at 390×844 and 1280×800:
  - the labels and the helper line show;
  - name and email plus an empty card, then Send: the summary says "Memory 1 needs at least one: …", focus lands on Memory 1's words
    box with the red border and ring, and the page scrolls to it;
  - a photo-only card sends;
  - a date-only card is refused.

### 9.B PR B, local

- All three checks pass offline.
- Integration tests pass on PG 18: the CHECKs, and the two-caller spacing test.
- The build log still names the Sentry tunnel route.
- e2e on the throwaway Neon branch with `PLACES_PROVIDER=stub` (§5.3):
  1. On /share, picking the Statue-of-Liberty JPEG shows the stub button "Photo location found near 40.69, -74.04 (test)" plus the
     attribution. A tap fills Where.
  2. A no-GPS photo shows nothing.
  3. Send. After the after-hook, a tsx read shows coordinates plus `gpsCheckedAt` for the GPS photo, and `gpsCheckedAt` with no
     coordinates for the other.
  4. Calling the cron route locally (with the cron secret) leaves those rows unchanged.
  5. MCP JSON-RPC script (PR #60's): `tools/list` has 9 tools; `get_memory` shows media coordinates; `suggest_places` returns stub labels.

### 9.C Production (Rob, after deploy)

- The smoke test in §B9.

### 9.D Device checks (Rob, on the preview with `stub`)

Record whether the stub button appears, using both photo buttons:

- iPhone Safari, Photo Library pick with Options → Location on: expected yes [C25].
- The same with Location off: expected none.
- iPhone "Take Photo": expected none.
- Android Chrome: expected none [C26], but record it, because the explicit `accept` list may route to a file chooser.
- Samsung Internet if available.
- Desktop Chrome and Safari from disk: expected yes.

## 10. Stacked-PR transition (B11)

House practice merges `origin/main` into feature branches (for example `460610b Merge origin/main (#54, #57…) into feat/why-and-how-built`),
so the transition never force-pushes.

1. `git fetch origin`. Run `gh pr view 60 --json state,mergeCommit`. Note whether the merge commit has two parents (a merge commit) or
   one (squash or rebase; squash is enabled on the repo, and it "turns all commits in the pull request into one commit" [C34]).
2. In `jowray_wt_photo_gps`: `git merge origin/main`.
   - After a merge-commit merge of #60 this is clean: the same commits.
   - After a squash, git may still apply cleanly, because the content is identical. On conflicts in #60's own files take
     `origin/main`'s side, and in B's files keep B.
   - If PR A merged first, resolve the overlap in `memory-card-client.tsx`, `lib/memory-cards.ts` and `docs/features/share-form.md`
     (A's copy plus B's wrapper `div`).
3. `gh pr edit <B> --base main`.
4. Verify:
   - `git diff origin/main...HEAD --stat` lists only PR B's files (compare with §7);
   - `git diff origin/main...HEAD -- app/api/mcp` shows only `suggest_places`;
   - `git log origin/main..HEAD` contains no #60 commits.
5. Re-run the three checks; `ci` green; request a re-review of the delta only.

## 11. Not doing (and why) — PR B notes (Bucket 3)

Written by a separate subagent (R8). Paste it as-is into PR B's description (and the relevant items into PR A's).

> We considered these and decided against them. Please don't suggest them again unless the reason given no longer applies.
>
> 1. **Parse EXIF in a Web Worker.** Why: the ExifReader 4.51.0 README says "If you use the `length: 'auto'` option, ExifReader reads only
>    the bytes that contain metadata, well under 1 ms per file for typical phone JPEGs." The parser loads only when someone picks a photo.
> 2. **Hold a transaction or advisory lock while calling Nominatim.** Why: the Prisma v7 docs say "Keep transactions short.
>    Long-running transactions hurt performance and can cause deadlocks." The lease-and-fence already keeps sends 1.1 s apart using two
>    short statements. It claims a lease, sends, then sets next-allowed to DB `now()` + 1.1 s. A lease expires after 10 s.
> 3. **A one-off backfill script with batches, cursors and resume.** Why: an idempotent cron step retries unchecked photos instead (up
>    to 3 attempts, 10 photos per run) with conditional writes. It runs the same code as live uploads, so stopping it partway does no
>    harm and there's no second version to keep in sync.
> 4. **A GPS status enum (pending/found/absent/failed).** Why: `gpsCheckedAt`, `gpsAttempts` and the coordinates already hold this:
>    - found: coordinates are set
>    - absent: checked, no coordinates
>    - failed: attempts > 0 and not checked
>    - given up: attempts ≥ 3
> 5. **Switch away from Nominatim.** Why: Rob chose it on purpose on 2026-11-06, after he was shown the usage policy (the policy
>    requires that). It sits behind `PLACES_PROVIDER` and a `ReverseGeocoder` interface, so it can be swapped if that's ever needed.
> 6. **Round coordinates before the lookup.** Why: Rob decided on 2026-11-06: "I'd like to do full detail cordinates goign to open
>    streetmaps and then the user can adjust if too personal." Requests carry no name, email, memory id or visitor IP. Suggestions only
>    fill the field when tapped, and they can be edited.
> 7. **ExifReader custom build (~9 KiB).** Why: the README says "This functionality is in beta." It would need `npx exifreader build` on
>    every install and CI run, because the postinstall rebuild is deprecated. The parser is already loaded only when a photo is picked.
> 8. **Narrow the photo input's `accept` to `image/*`.** Why: the ExifReader README warns that on Android, "Apparently setting the
>    `accept` attribute to this value will strip the GPS values." The form keeps its explicit list of MIME types and extensions.
> 9. **Show photo coordinates on the admin page.** Why: PR #60 rule: coordinates are "Present only when asked for
>    (`includeCoordinates`, the MCP tools); the admin page never sees it."
> 10. **Auto-fill "Where?" from GPS.** Why: the Nominatim docs say reverse geocoding finds "the closest suitable OSM object … This may
>     occasionally lead to unexpected results." So a person taps to choose a name and can edit it.
> 11. **Call Nominatim from the browser.** Why: the usage policy asks apps to "set up a proxy and also enable caching of requests", and
>     the 1 request/second limit applies to the whole app. Only our Production server calls Nominatim.
> 12. **Store GPS sent by the browser.** Why: the server reads GPS from the untouched original in Blob storage, which is the source of
>     truth for every upload path. We don't trust values from the browser and use them only for suggestions.
> 13. **Save a landmark's name with the photo's camera coordinates via MCP `set_coordinates`.** Why: where the camera stood is not where
>     the place is. For landmark names, `suggest_places` returns the matched place's own coordinates, and the skill only proposes those.

## 12. Follow-ups for the PR notes (Bucket 4; file as issues after merge)

| # | Item | Severity | What the next agent needs |
|---|---|---|---|
| F1 | Place buttons on the claim page (memory "Where" and each file's "Where") from stored coordinates | medium | Server already has `Media.latitude/longitude`. Reuse `lookupPlace` and `<PlaceSuggestions>`. Files: `app/m/[claimToken]/claim-form.tsx:135`, `media-list-client.tsx:291-294`. |
| F2 | Privacy note: say we keep where photos were taken and never show it | medium | Rob's wording; ties to the privacy-note worktree `jowray_wt_privacy-diagrams`. |
| F3 | Photo date: store EXIF `DateTimeOriginal` in `Media.capturedAt` and suggest "When?" | low | `DateTimeOriginal` has no zone. Use `OffsetTimeOriginal` when present, else keep local-time text. Same parse in `lib/photo-gps.ts`. |
| F4 | Fallback place provider if OSMF blocks or changes policy | low | Add `integrations/<provider>` behind `services/places` `ReverseGeocoder`; switch with `PLACES_PROVIDER`; check that provider's storage terms. |
| F5 | Video GPS (QuickTime/MP4 ISO 6709 location) | low | ExifReader does not read video. Needs a box parser for `©xyz`/`udta`. Same `Media` columns and step (h). |
| F6 | Prune `PlaceLookup`, `PlaceLookupThrottle` test rows and `EgressCounter` | medium (privacy; Team Code Review #4) | `PlaceLookup` keeps each looked-up point at 6 dp with its place and `fetchedAt`, after a purge and for `/share` photos never sent. A reconcile step deleting rows older than N days, oldest first, bounded per run. |
| F7 | iPhone hint near the photo buttons ("Options → Location to include where it was taken") | low | Only if device checks show Location off by default. Copy in `card-media-client.tsx`. |
| F8 | Preview database branches inherit production rows, now including photo coordinates | low | Previews are protected and already hold names and emails. Consider scrubbing on branch creation. |
| F9 | A general per-media "enrichment" status if more per-photo extractions are added | low | Generalize `gpsCheckedAt`/`gpsAttempts` and step (h) when a second extractor arrives. |
| F10 | Server `tracePropagationTargets` so third-party calls (Nominatim, SendGrid, Blob) don't carry `sentry-trace`/`baggage` | low | Repo-wide Sentry choice under Rob's full-telemetry policy; the headers carry no personal data. |
| F11 | IP-rotating abuse of `POST /api/places/suggest` can use up the 500/day provider budget until the next UTC day | low | The counters stop a free proxy, not this. Options: a lower per-viewer cap, or require a recent upload ticket. |
| F12 | `recordMedia`'s `readPrefix` call has no deadline signal (pre-existing) | low | Pass the same `{ signal }` the GPS step uses. |
| F13 | (Fixed in this PR by the `gpsClaimedAt` lease, migration `20261106210000_photo_gps_claim_lease`.) | — | — |
| F14 | Rob: delete the throwaway Neon branch `gps-e2e-20261106` (`br-winter-lab-bbd4405m`) | — | Holds a production copy plus the B9 e2e memory. |
| F15 | Cron step (h) runs last and starts a photo only with 20 s left (15 s read + 5 s database margin since the Team Code Review round), so a backlog in (a)–(g) can skip whole runs | low | Delays GPS retries and the backfill; never costs an attempt. Option: run (h) before (g) with its own slice. |
| F16 | A bounded `lock_timeout` for every migration at deploy level (the migrate-deploy connection), so no `ALTER TABLE` can queue the site's queries behind a long transaction; the two PR #66 migrations lack the per-file `SET lock_timeout = '5s'` of `20261105140000_media_reserved_until` | low | Team Code Review #2/#6. Not by editing applied migrations: `migrate deploy` warns when an applied migration was modified. Repo-wide build config, e.g. `options=-c lock_timeout=5s` on the migrate URL; document the `migrate resolve --rolled-back` recovery with it. |

---

## Citations

### [C1] — Nominatim usage policy: requirements

- **Relevant File(s):** `integrations/nominatim/client.ts`, `features/places/lookup-place.ts`, `app/share/place-suggestions-client.tsx`
- **Change Summary:** Real sends site-wide at least 1.1 s apart, an identifying User-Agent, and a visible credit.
- **Source URL:** https://operations.osmfoundation.org/policies/nominatim/#requirements
- **Verbatim Quote:**
  > "No heavy uses (an absolute maximum of 1 request per second)."
  > "Provide a valid HTTP Referer or User-Agent identifying the application (stock User-Agents as set by http libraries will not do)."
  > "Clearly display attribution as suitable for your medium."
- **Justification:** The lease and fence spaces actual sends. The client sets a fixed identifying User-Agent. The suggestion block shows
  the OSM credit.

### [C2] — Nominatim usage policy: websites, switching, proxy, caching

- **Relevant File(s):** `server/config/env.ts`, `prisma/schema.prisma` (`PlaceLookup`), `features/places/lookup-place.ts`
- **Change Summary:** `PLACES_PROVIDER`/`PLACES_LOOKUP_URL`; all calls go through our server and a cache; only Production calls Nominatim.
- **Source URL:** https://operations.osmfoundation.org/policies/nominatim/#websites-and-apps
- **Verbatim Quote:**
  > "Note that the usage limits above apply per website/application: the sum of traffic by all your users should not exceed the limits."
  > "Apps must make sure that they can switch the service at our request at any time (in particular, switching should be possible
  > without requiring a software update). If at all possible, set up a proxy and also enable caching of requests."
- **Justification:** One provider row in one database (Production) makes the throttle application-wide. Config switches or stops the
  service. The route is the proxy and `PlaceLookup` the cache.

### [C3] — Nominatim usage policy: LLM-suggested use needs a deliberate decision

- **Relevant File(s):** this plan (R2); `docs/features/share-form.md`
- **Change Summary:** The policy was shown to Rob before he chose; the docs record his choice and responsibility.
- **Source URL:** https://operations.osmfoundation.org/policies/nominatim/#usage-in-llms
- **Verbatim Quote:**
  > "LLMs may only suggest this service, if they prominently point to this usage policy and explain the restrictions of use to the user."
  > "Use of the public API is only permitted where the application developer has made a deliberate, informed decision to use it and is
  > directly responsible for complying with this policy."
- **Justification:** R2 is that informed decision; the feature doc links the policy.

### [C4] — Nominatim usage policy: privacy

- **Relevant File(s):** `features/places/lookup-place.ts`, `integrations/nominatim/client.ts`
- **Change Summary:** Full-detail coordinates (R5), sent from our server with no name, email, memory id or visitor IP.
- **Source URL:** https://operations.osmfoundation.org/policies/nominatim/#privacy
- **Verbatim Quote:**
  > "Please do not submit personal data or other confidential material to any of our services."
- **Justification:** D6 states the rule. Only a point travels, never who it belongs to. Rob accepted that a home photo sends its point,
  and the person edits the suggestion.

### [C5] — Nominatim reverse API: zoom, address details, examples

- **Relevant File(s):** `integrations/nominatim/client.ts`, `lib/places/label.ts` (fixtures)
- **Change Summary:** `format=jsonv2&zoom=18&addressdetails=1`; the docs examples serve as label fixtures.
- **Source URL:** https://nominatim.org/release-docs/latest/api/Reverse/#result-restriction
- **Verbatim Quote:**
  > "Level of detail required for the address. This is a number that corresponds roughly to the zoom level used in XYZ tile sources in
  > frameworks like Leaflet.js, Openlayers etc."
  > "| 18 | building |"
  > "When set to 1, include a breakdown of the address into elements."
- **Justification:** Zoom 18 yields the nearest named feature plus the address parts; the label keeps only town and region.

### [C6] — Nominatim reverse API: closest object, unexpected results

- **Relevant File(s):** `app/share/place-suggestions-client.tsx`, `app/share/memory-card-client.tsx`, `lib/places/label.ts`
- **Change Summary:** Tap-to-fill buttons, editable afterwards; never automatic.
- **Source URL:** https://nominatim.org/release-docs/latest/api/Reverse/#how-it-works
- **Verbatim Quote:**
  > "The reverse geocoding API does not exactly compute the address for the coordinate it receives. It works by finding the closest
  > suitable OSM object and returning its address information. This may occasionally lead to unexpected results."
- **Justification:** The person chooses; D4.

### [C7] — Nominatim reverse API: results carry the object's own coordinates

- **Relevant File(s):** `lib/places/label.ts`, `features/places/suggest-for-memory.ts`, `docs/skills/jowray-draft-memory/SKILL.md`
- **Change Summary:** A landmark label carries the matched object's `lat`/`lon` as its `point`; MCP proposes only that point.
- **Source URL:** https://nominatim.org/release-docs/latest/api/Reverse/#example-with-formatjsonv2
- **Verbatim Quote:**
  > "\"lat\":\"-34.4391708\","
  > "\"lon\":\"-58.7064573\","
- **Justification:** The response's coordinates belong to the found object, not to the query point, so camera and place stay distinct
  (D13).

### [C8] — OSMF attribution guidelines

- **Relevant File(s):** `app/share/place-suggestions-client.tsx`, `features/places/lookup-place.ts`, `features/places/suggest-for-memory.ts`
- **Change Summary:** "© OpenStreetMap contributors" next to the buttons and in MCP results; a chosen `place` carries none.
- **Source URL:** https://osmfoundation.org/wiki/Licence/Attribution_Guidelines#Geocoding_(search)
- **Verbatim Quote:**
  > "The historical forms of attribution “© OpenStreetMap contributors” or “© OpenStreetMap” are acceptable."
  > "A group of geocoding results need not maintain attribution attached to the results, as long as it does not form a Derivative
  > Database"
- **Justification:** It credits where results are shown; a person's chosen place text needs no attached credit.

### [C9] — ExifReader: formats and bytes-only input

- **Relevant File(s):** `package.json`, `lib/photo-gps.ts`
- **Change Summary:** Pin `exifreader@4.51.0`; the server passes bytes, never a string.
- **Source URL:** https://github.com/mattiasw/ExifReader/blob/v4.51.0/README.md
- **Verbatim Quote:**
  > "Supports JPEG, JPEG XL, TIFF, PNG, HEIC, AVIF, WebP, and GIF files with Exif, IPTC, XMP, ICC, MPF, and more metadata (depending on
  > file type)."
  > "Never pass an untrusted or user-controlled string to `load()`."
  > "For untrusted image data, always pass the bytes themselves (an `ArrayBuffer`, a typed array such as `Uint8Array` or `Buffer`, or a
  > browser `File`), never a string."
- **Justification:** One parser covers JPEG and HEIC in the browser and Node. Bytes-only avoids string-as-URL/path behaviour.

### [C10] — ExifReader: the expanded `gps` group

- **Relevant File(s):** `lib/photo-gps.ts`
- **Change Summary:** Read signed `gps.Latitude/Longitude`; refs are still checked (D12).
- **Source URL:** https://github.com/mattiasw/ExifReader/blob/v4.51.0/README.md#gps
- **Verbatim Quote:**
  > "If `expanded: true` is specified in the options, there will be a `gps` group. This group currently contains `Latitude`,
  > `Longitude`, and `Altitude` which will be negative for values that are south of the equator, west of the IRM, or below sealevel."
- **Justification:** Signed degrees match the columns directly.

### [C11] — ExifReader: `length: 'auto'` and the fixed-prefix warning

- **Relevant File(s):** `lib/photo-gps.ts` (`readGpsFromFile`, `jpegMetadataComplete`), `features/media/extract-photo-gps.ts`
- **Change Summary:** Adaptive reads in the browser; the server escalates from a 128 KiB prefix when the metadata is not complete.
- **Source URL:** https://github.com/mattiasw/ExifReader/blob/v4.51.0/README.md#read-only-the-metadata-bytes-length-auto
- **Verbatim Quote:**
  > "If you use the `length: 'auto'` option, ExifReader reads only the bytes that contain metadata, **well under 1 ms per file** for
  > typical phone JPEGs and **over 95% less bandwidth**."
  > "Just be aware that it's common for the metadata to be spread out over a larger area so please try it out on your set of files to
  > know if it's suitable for your situation."
  > "- Browser `File` object via `File.slice`"
- **Justification:** It replaces the unsafe fixed 256 KiB slice. The late-EXIF fixture proves both paths.

### [C12] — ExifReader: `accept="image/*"` strips GPS on Android

- **Relevant File(s):** `app/share/card-media-client.tsx` (unchanged; guarded by §5.4 and §11), `docs/features/share-form.md`
- **Change Summary:** Keep the explicit accept list; never narrow it to `image/*`.
- **Source URL:** https://github.com/mattiasw/ExifReader/blob/v4.51.0/README.md#gps
- **Verbatim Quote:**
  > "If you're having trouble getting the GPS values on Android (and possibly also IOS) and are using a `type="file"` input to upload the
  > image, make sure you are **not** setting `accept="image/*"` on the input element."
- **Justification:** The form already lists explicit types (`lib/media-types.ts:68-71`). The note stops a well-meant "simplification"
  in review.

### [C13] — ExifReader: the custom build is beta

- **Relevant File(s):** none (§11, not doing)
- **Change Summary:** No custom build.
- **Source URL:** https://github.com/mattiasw/ExifReader/blob/v4.51.0/README.md#configure-a-custom-build
- **Verbatim Quote:**
  > "**NOTE 1:** This functionality is in beta but should work fine."
- **Justification:** A beta build step in every install and CI run is a review and maintenance risk; the parser is already lazy-loaded.

### [C14] — Next.js: load external libraries on demand

- **Relevant File(s):** `app/share/use-place-suggestions.ts`
- **Change Summary:** `await import("@/lib/photo-gps")` on the first photo only.
- **Source URL:** https://nextjs.org/docs/app/guides/lazy-loading#loading-external-libraries
- **Verbatim Quote:**
  > "External libraries can be loaded on demand using the import() function."
- **Justification:** Visitors who add no photo never download the parser.

### [C15] — Next.js: Server Actions are dispatched one at a time

- **Relevant File(s):** `app/api/places/suggest/route.ts`, `app/share/use-place-suggestions.ts`
- **Change Summary:** Lookups use a Route Handler.
- **Source URL:** https://nextjs.org/docs/app/guides/server-actions#sequential-dispatch-on-the-client
- **Verbatim Quote:**
  > "Next.js dispatches Server Actions one at a time per client. If a user triggers three actions in quick succession, the second waits
  > for the first to finish, then the third waits for the second."
  > "If you need parallel work, do it inside a single Server Action, fetch in parallel from a Server Component, or use a Route Handler for
  > non-mutation requests."
- **Justification:** A lookup waiting for its slot must never delay Send.

### [C16] — Next.js: server endpoints are reachable by anyone

- **Relevant File(s):** `app/api/places/suggest/route.ts`, `features/places/lookup-place.ts`
- **Change Summary:** Viewer and provider counters guard the public lookup.
- **Source URL:** https://nextjs.org/docs/app/guides/server-actions#security
- **Verbatim Quote:**
  > "A Server Action runs as a POST request against the page that invokes it."
  > "The implementation stays on the server, but the route is reachable to anyone who can send the same POST."
- **Justification:** Either endpoint shape is public, so caps, not obscurity, stop it becoming a free Nominatim proxy.

### [C17] — Next.js `route.js`: POST and `request.json()`

- **Relevant File(s):** `app/api/places/suggest/route.ts`
- **Change Summary:** `export async function POST(request)` reads the JSON body.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/route
- **Verbatim Quote:**
  > "The following HTTP methods are supported: GET, POST, PUT, PATCH, DELETE, HEAD, and OPTIONS."
  > "const res = await request.json()"
- **Justification:** A POST body keeps coordinates out of URLs, access logs and breadcrumbs.

### [C18] — zod numbers

- **Relevant File(s):** `lib/validations/places.ts`, `lib/photo-gps.ts`
- **Change Summary:** Reuse #60's `coordinatesSchema`; reject 0/0.
- **Source URL:** https://zod.dev/api#numbers
- **Verbatim Quote:**
  > "Use z.number() to validate numbers. It allows any finite number."
  > "z.number().gte(5);                     // alias .min(5)"
- **Justification:** NaN and Infinity fail; ranges match the database CHECKs.

### [C19] — Prisma: optional fields

- **Relevant File(s):** `prisma/schema.prisma`
- **Change Summary:** `latitude`/`longitude`/`gpsCheckedAt` are optional.
- **Source URL:** https://www.prisma.io/docs/orm/data-modeling#optional-and-mandatory-fields
- **Verbatim Quote:**
  > "A trailing ? makes a field optional: name String?."
- **Justification:** Null is the honest state for "no GPS" and "not yet decided".

### [C20] — Prisma v7: `Float` maps to `double precision`

- **Relevant File(s):** `prisma/migrations/20261106200000_photo_gps_places/migration.sql`
- **Change Summary:** `DOUBLE PRECISION` columns.
- **Source URL:** https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference#float
- **Verbatim Quote:**
  > "Floating point number."
  > "| PostgreSQL | double precision |"
- **Justification:** The hand-written SQL matches Prisma's mapping, so there is no drift.

### [C21] — Prisma v7: customizing migrations

- **Relevant File(s):** `prisma/migrations/20261106200000_photo_gps_places/migration.sql`
- **Change Summary:** `--create-only`, then add the CHECKs by hand.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/customizing-migrations
- **Verbatim Quote:**
  > "Create a draft migration using:"
  > "prisma migrate dev --create-only"
  > "Modify the generated SQL file."
- **Justification:** CHECK constraints are not expressible in the schema language.

### [C22] — Prisma v7: keep transactions short

- **Relevant File(s):** `features/places/lookup-place.ts`
- **Change Summary:** No transaction or lock across the HTTP call; the lease and fence instead.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions#interactive-transactions
- **Verbatim Quote:**
  > "Keep transactions short. Long-running transactions hurt performance and can cause deadlocks."
- **Justification:** Two short statements give the spacing guarantee without a held transaction.

### [C23] — PostgreSQL: atomic `ON CONFLICT DO UPDATE … RETURNING`

- **Relevant File(s):** `features/places/lookup-place.ts` (lease claim, cache upsert)
- **Change Summary:** One statement claims the lease only when the fence has passed and no live lease exists.
- **Source URL:** https://www.postgresql.org/docs/18/sql-insert.html#SQL-ON-CONFLICT
- **Verbatim Quote:**
  > "ON CONFLICT DO UPDATE guarantees an atomic INSERT or UPDATE outcome; provided there is no independent error, one of those two
  > outcomes is guaranteed, even under high concurrency."
  > "The optional RETURNING clause causes INSERT to compute and return value(s) based on each row actually inserted (or updated, if an
  > ON CONFLICT DO UPDATE clause was used)."
- **Justification:** Concurrent claimers cannot both win; RETURNING tells each whether it did.

### [C24] — sharp `withExif`

- **Relevant File(s):** `__tests__/lib/photo-gps.test.ts`, `__tests__/features/extract-photo-gps.test.ts`
- **Change Summary:** GPS JPEG fixtures built in memory.
- **Source URL:** https://sharp.pixelplumbing.com/api-output/#withexif
- **Verbatim Quote:**
  > "Set EXIF metadata in the output image, ignoring any EXIF in the input image."
  > "GPSLatitudeRef: 'N',"
  > "GPSLatitude: '51/1 30/1 3230/100',"
- **Justification:** Fake public-landmark points; no family photo enters the public repo.

### [C25] — Apple: picker metadata included unless location is removed

- **Relevant File(s):** `app/share/place-suggestions-client.tsx` (silent without GPS), §9.D
- **Change Summary:** Expect GPS from iPhone library picks with Location on.
- **Source URL:** https://developer.apple.com/videos/play/wwdc2023/10107/?time=688
- **Verbatim Quote:**
  > "The new Options menu gives users more control over what they can share with your app. By default, all image metadata are included,
  > but users can now choose to remove sensitive metadata, like location, from selected photos."
- **Justification:** This explains `IMG_0565.jpeg` and the expected device results.

### [C26] — Android: location hidden by default

- **Relevant File(s):** `lib/photo-gps.ts` (zeros and missing refs are absent), §9.D
- **Change Summary:** No error shown for Android's missing GPS.
- **Source URL:** https://developer.android.com/training/data-storage/shared/media#media-location-permission
- **Verbatim Quote:**
  > "If your app uses scoped storage, the system hides location information by default."
- **Justification:** The browser does not hold the permission, so absence is normal.

### [C27] — MCP schema: `readOnlyHint` and `openWorldHint`

- **Relevant File(s):** `app/api/mcp/tools.ts`
- **Change Summary:** `suggest_places` annotations.
- **Source URL:** https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-11-25/schema.ts (interface `ToolAnnotations`)
- **Verbatim Quote:**
  > "If true, the tool does not modify its environment."
  > "If true, this tool may interact with an "open world" of external entities. If false, the tool's domain of interaction is closed.
  > For example, the world of a web search tool is open, whereas that of a memory tool is not."
- **Justification:** It changes no memory (only a cache) and calls OpenStreetMap.

### [C28] — MCP spec: structured content plus text; annotations untrusted

- **Relevant File(s):** `app/api/mcp/tools.ts`, `__tests__/api/mcp.test.ts`
- **Change Summary:** `suggest_places` reuses `toolResult` and `runTool`; the privacy rule lives in the description.
- **Source URL:** https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content
- **Verbatim Quote:**
  > "Structured content is returned as a JSON object in the structuredContent field of a result."
  > "For backwards compatibility, a tool that returns structured content SHOULD also return the serialized JSON in a TextContent block."
  > "For trust & safety and security, clients MUST consider tool annotations to be untrusted unless they come from trusted servers."
- **Justification:** It matches the existing tools.

### [C29] — MDN `aria-live="polite"`

- **Relevant File(s):** `app/share/place-suggestions-client.tsx`
- **Change Summary:** Status and buttons are announced politely.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-live
- **Verbatim Quote:**
  > "When aria-live's attribute is set to polite, assistive technologies will notify users of updates but generally do not interrupt the
  > current task, with the updates having a low priority."
- **Justification:** Suggestions arrive while the person types elsewhere on the card.

### [C30] — WCAG 2.2 SC 2.5.8 Target Size (Minimum)

- **Relevant File(s):** `app/share/place-suggestions-client.tsx`
- **Change Summary:** `min-h-tap` buttons.
- **Source URL:** https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- **Verbatim Quote:**
  > "The size of the target for pointer inputs is at least 24 by 24 CSS pixels, except when:"
- **Justification:** Older relatives tap these on phones.

### [C31] — WCAG 2.2 SC 3.3.2 Labels or Instructions

- **Relevant File(s):** `app/share/memory-card-client.tsx`, `app/share/card-media-client.tsx`, `design/DESIGN.md`, `docs/features/share-form.md` (PR A)
- **Change Summary:** "(optional …)" labels plus the "Add at least one" instruction.
- **Source URL:** https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html
- **Verbatim Quote:**
  > "Labels or instructions are provided when content requires user input."
  > "The criterion applies to all form fields, whether they're required or optional."
- **Justification:** It states the one-of-four rule before Send and marks what is optional.

### [C32] — Sentry for Next.js: capture swallowed errors

- **Relevant File(s):** `features/media/extract-photo-gps.ts`, `features/places/lookup-place.ts`, `app/share/use-place-suggestions.ts`
- **Change Summary:** Every silent failure path reports; expected codes do not.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/capturing-errors/
- **Verbatim Quote:**
  > "// Error is swallowed - add captureException"
  > "Sentry.captureException(error);"
- **Justification:** The person sees nothing on failure, so Rob must.

### [C33] — Withdrawn (rebase `--onto` replaced by merging `origin/main`, house practice, no force-push). Kept so numbering is stable.

### [C34] — GitHub: squash merging creates a new single commit

- **Relevant File(s):** §10 procedure
- **Change Summary:** Detect a squash merge of #60 and resolve the merge accordingly.
- **Source URL:** https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/about-pull-request-merges
- **Verbatim Quote:**
  > "Squashing turns all commits in the pull request into one commit on the base branch."
- **Justification:** After a squash, B's copies of #60's commits are not on `main`, so the merge may conflict on identical content;
  §10 says which side to keep.

### [C35] — Repo rules: layers, route handlers, env, `maxDuration`

- **Relevant File(s):** `integrations/nominatim/*`, `integrations/places-stub/*`, `services/places/*`, `features/places/*`,
  `features/media/extract-photo-gps.ts`, `lib/places/*`, `app/api/places/suggest/route.ts`, `lib/validations/memory.ts`,
  `app/share/memory-card-client.tsx`, `docs/code-layout.md`, `AGENTS.md`
- **Change Summary:** Every new file sits in its layer; the routes use the house shapes; env is lazy.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a1414c07c89afc17b4ae0637bdd18f184e68f/AGENTS.md?plain=1#L37-L51
- **Verbatim Quote:**
  > "A layer imports only from layers below it plus `lib/` and `server/`."
  > "Route handlers validate input with zod schemas from `lib/validations` and answer `{ success, data }` or `{ error: { code, message } }`."
  > "`maxDuration` is allowed; for Server Functions it is set on the page that hosts them."
  > "Never construct a `PrismaClient` or parse env at module scope."
- **Justification:** Lint passes and `build:offline` stays green.

### [C36] — Repo: each task adds its own env sub-schema

- **Relevant File(s):** `server/config/env.ts`, `docs/environment.md`
- **Change Summary:** `placesSchema`, memoized `getPlacesEnv`.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a1414c07c89afc17b4ae0637bdd18f184e68f/AGENTS.md?plain=1#L52
- **Verbatim Quote:**
  > "Each task adds only its own env sub-schema to `server/config/env.ts`; booleans parse strictly (`"true"` / `"false"`), lists are
  > split, trimmed and lower-cased."
- **Justification:** Four keys in one sub-schema, parsed on first use.

### [C37] — Repo: TDD for critical paths

- **Relevant File(s):** `__tests__/features/extract-photo-gps.test.ts`, `__tests__/api/reconcile.test.ts`,
  `__tests__/features/lookup-place.test.ts`, `__tests__/lib/memory-cards.test.ts`, PR A tests
- **Change Summary:** Tests first for the finalize hook, cron step (h) and the throttle.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a1414c07c89afc17b4ae0637bdd18f184e68f/AGENTS.md?plain=1#L72
- **Verbatim Quote:**
  > "- TDD for critical paths (upload tickets, finalize, confirmation, cron)."
- **Justification:** The new step hooks finalize and cron.

### [C38] — Repo: Sentry alpha data policy

- **Relevant File(s):** `lib/sentry/*` (unchanged)
- **Change Summary:** Coordinates may appear in Sentry contexts.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a1414c07c89afc17b4ae0637bdd18f184e68f/AGENTS.md?plain=1#L57
- **Verbatim Quote:**
  > "Allowed in Sentry: contributor email and name as user context, Server Function inputs and outputs, headers, Prisma query data,
  > stack-frame locals, unmasked replays."
- **Justification:** Rob's ruling covers non-secret contributor data.

### [C39] — PR #60: per-media coordinates parked with the same CHECKs; admin page never sees coordinates

- **Relevant File(s):** `prisma/schema.prisma`, `migration.sql`, `features/admin/get-memory.ts`
- **Change Summary:** Media coordinates with pair and range CHECKs; only with `includeCoordinates`.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/9d841a8217c459cdfdaba662f52e286c333fd57b/docs/plans/2026-11-06-mcp-endpoint.md?plain=1#L252
- **Verbatim Quote:**
  > "| 8.4 | **Per-media coordinates.** `Media` rows have `place` but no coordinates. | low | Same column pair, pair and range CHECKs, and
  > an MCP tool; wait until the map exists. |"
  > (`features/admin/get-memory.ts:65` at the same commit) "/** Present only when asked for (`includeCoordinates`, the MCP tools); the
  > admin page never sees it. */"
- **Justification:** It implements §8.4 as specified, now that Rob asked.

### [C40] — PR #60: the place rule

- **Relevant File(s):** `app/api/mcp/tools.ts`, `docs/skills/jowray-draft-memory/SKILL.md`, `lib/places/label.ts`
- **Change Summary:** `suggest_places` repeats the rule; Rob approves any saved place or coordinates.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/9d841a8217c459cdfdaba662f52e286c333fd57b/app/api/mcp/tools.ts#L41
- **Verbatim Quote:**
  > "`coordinates` are WGS 84 decimal degrees for the named place (a town, a facility or community campus such as Broadmead, a church, a
  > park, a lake), never a residence or a unit inside a place. Ask Rob before saving them."
- **Justification:** Photo GPS is often a home; the rule still governs what is saved.

### [C41] — Repo: originals untouched, served copies stripped

- **Relevant File(s):** `features/media/extract-photo-gps.ts`, `docs/features/media-uploads.md`
- **Change Summary:** GPS is read from originals; `deriveMedia` and its stripping are unchanged.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a1414c07c89afc17b4ae0637bdd18f184e68f/docs/plans/2026-11-03-photos-derived-media.md?plain=1#L37
- **Verbatim Quote:**
  > "EXIF (incl. GPS) stripped from everything served inline; originals untouched."
- **Justification:** The original is the only trustworthy GPS source.

### [C42] — Repo: daily request counter

- **Relevant File(s):** `features/places/lookup-place.ts`
- **Change Summary:** `countRequest` for `places:viewer:<hash>` and `places:provider`.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a1414c07c89afc17b4ae0637bdd18f184e68f/features/media/egress.ts#L111
- **Verbatim Quote:**
  > "Count one more request under `scope` unless that would pass `limit`."
- **Justification:** An existing, tested atomic counter.

### [C43] — Repo: the error reveal the email uses

- **Relevant File(s):** `lib/memory-cards.ts`, `lib/validations/memory.ts` (PR A)
- **Change Summary:** The empty-card issue keeps target `note`, so it gets the same summary, red state, scroll and focus.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a1414c07c89afc17b4ae0637bdd18f184e68f/app/share/share-form.tsx#L268
- **Verbatim Quote:**
  > "// The form's order: who is sending, then the cards. The first problem is the one brought into view."
  > (`app/_components/field-classes.ts:5`) "the 2px jo-red-deep border is the 3:1 state indicator (SC 1.4.11), the 40% ring reinforces it."
- **Justification:** R1's "same as the email" is this mechanism.

### [C44] — Repo: contributor content never in a log line

- **Relevant File(s):** `lib/logger/logger.ts`, `features/media/extract-photo-gps.ts`
- **Change Summary:** Redact `latitude`/`longitude`; log outcomes, not coordinates.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a1414c07c89afc17b4ae0637bdd18f184e68f/lib/logger/logger.ts#L15
- **Verbatim Quote:**
  > "// Contributor content and the bearer link (2026-11-03): never in a log line either."
- **Justification:** Where a photo was taken is contributor content.

### [C45] — Repo: draft-on-behalf does not ingest attachments

- **Relevant File(s):** `docs/features/mcp.md`, `docs/skills/jowray-draft-memory/SKILL.md`
- **Change Summary:** Photos arrive through the claim link; MCP suggests places afterwards.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a1414c07c89afc17b4ae0637bdd18f184e68f/docs/features/draft-on-behalf.md?plain=1#L101
- **Verbatim Quote:**
  > "M-E-11 (F5): attachments are not ingested; the reply asks the sender to add the photo."
- **Justification:** An MCP upload tool is a separate feature.

### [C46] — Repo: previews get their own database branch

- **Relevant File(s):** `server/config/env.ts` (`PLACES_PROVIDER`), `docs/environment.md`
- **Change Summary:** Only Production calls Nominatim; Preview uses the stub.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/9d841a8217c459cdfdaba662f52e286c333fd57b/docs/environment.md?plain=1#L38
- **Verbatim Quote:**
  > "Preview deployments get their own `preview/<git-branch>` database branch, with its own values."
- **Justification:** Separate databases mean separate throttle rows, so a per-application limit needs a single caller.

### [C47] — Repo: migrations run in every Vercel build

- **Relevant File(s):** `prisma/migrations/20261106200000_photo_gps_places/migration.sql`, §B9
- **Change Summary:** Expand-only migration; activation order and rollback.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a1414c07c89afc17b4ae0637bdd18f184e68f/vercel.json#L3
- **Verbatim Quote:**
  > "\"buildCommand\": \"npx prisma migrate deploy && npx prisma db seed && npm run build\","
- **Justification:** Old deployments keep running against the new schema, so it must be additive.

### [C48] — Repo: cron step (g) revisits only photos missing derived copies

- **Relevant File(s):** `app/api/cron/reconcile-uploads/route.ts` (new step h), `features/media/extract-photo-gps.ts`
- **Change Summary:** GPS gets its own retry step and state.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/9d841a8217c459cdfdaba662f52e286c333fd57b/app/api/cron/reconcile-uploads/route.ts#L598
- **Verbatim Quote:**
  > "// (g) Derived copies (web image + email thumbnail) for READY photos of this"
  > "// environment that have none, a stale claim, or a retryable failure."
- **Justification:** A derived photo whose GPS write failed would never be revisited by (g).

### [C49] — Repo: outbound email is off unless set

- **Relevant File(s):** §5.3 (local e2e)
- **Change Summary:** Local sends reach only the allowlist.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a1414c07c89afc17b4ae0637bdd18f184e68f/server/config/env.ts#L86
- **Verbatim Quote:**
  > "OUTBOUND_ENABLED: strictBoolean.default(false),"
- **Justification:** The e2e Send cannot email family members.

### [C50] — Repo: storage `readPrefix`

- **Relevant File(s):** `features/media/extract-photo-gps.ts`
- **Change Summary:** A 128 KiB Range read first; the whole file only if metadata continues.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a1414c07c89afc17b4ae0637bdd18f184e68f/services/storage/types.ts#L44
- **Verbatim Quote:**
  > "readPrefix(pathname: string, maxBytes: number): Promise<Uint8Array | null>;"
- **Justification:** It saves downloading whole originals for the common JPEG case.
