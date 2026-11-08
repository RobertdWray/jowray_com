# See memories

See memories lets visitors browse the family's approved public memories by place, year, patch (tag) or kind, then open a memory to read it, see its photos or play its recording. It lives at `/memories` and its Map, Timeline, Tags and individual-memory pages.

**Status:** implemented and tested in [PR #93](https://github.com/RobertdWray/jowray_com/pull/93) (2026-11-08). The pages ship dark behind `PUBLIC_MEMORIES_ENABLED`: until Rob sets it in Production and redeploys, nothing is public. [Issue #89](https://github.com/RobertdWray/jowray_com/issues/89) tracks the work; the [plan and ledger](../plans/2026-11-08-see-memories.md#ledger) record delivery. Rob's inventory sign-off, Production flag change and redeploy remain L15.

## What we built

1. With the flag on, visitors follow the header's first link, “See memories,” to `/memories`. Explore combines place, decade, patch, kind and word filters, with 12 cards initially at every screen size and a “Show more” link.
2. `/memories/map` groups memories by named place; `/memories/timeline` groups them by decade and year, ending with “Not dated yet”; `/memories/tags` presents a quilt of patches and nine initial cards for the selected patch. Map and Tags select the most-used place or patch when none is chosen.
3. `/memories/<id>` shows the contributor's name and relationship, words, date, place, patches and available media. Earlier/Later links open adjacent memory pages; “Close to this one” offers up to three related memories. Missing names use “A friend of Jo's.”
4. Visitors see only APPROVED + PUBLIC memories that are not deleted. FAMILY, PRIVATE, DRAFT, PENDING, HIDDEN and deleted memories are excluded. A non-public or unknown id shows the not-found UI with `noindex`; after streaming starts its HTTP status is 200. The media endpoint returns a true 404 (D13).
5. The family edits patches, year and month in the admin form or through MCP `update_memory`. Contributors still edit through their private claim links; content changes to an approved memory take it off See memories until the family approves it again.

## Why we built it

The site collected memories but offered no way to browse them. [The plan's Context](../plans/2026-11-08-see-memories.md#context) connects the public gallery to the 2026-11-10 sharing promise. The launch flag lets the family review the existing approved inventory before opening it to everyone.

## Key decisions (Rob)

These are summaries of the [Decision status table](../plans/2026-11-08-see-memories.md#decision-status), not new quotations or approvals.

| Decision | Source |
|---|---|
| Public requires APPROVED + PUBLIC + not deleted; launch waits for inventory sign-off and an explicit flag change. Approved by Rob on 2026-11-08. | D1, D15; [launch gates](../plans/2026-11-08-see-memories.md#launch-gates-and-rollback) |
| URL-driven server rendering; derived photos only, no download mode; videos and recordings play as recorded, location included (D16 as amended by Rob later on 2026-11-08); separate public budgets. Approved by Rob on 2026-11-08. | D5, D6, D16, D18 |
| Claim-link content changes return approved memories to PENDING; streamed not-found pages are accepted. Approved by Rob on 2026-11-08. | D13, D17 |
| Launch with noindex and keep the existing full Sentry collection for public visitors. Approved by Rob on 2026-11-08. | D19, D20 |
| Kind comes from `Memory.type`; omit people chips/transcripts; put See memories first in the header; use 12 Explore cards and adjacent-memory navigation. These are agent calls marked approved in the plan, not separately quoted Rob rulings. | D7–D10, D12 |
| Town-point rounding, scalar tags, display-year parsing, no cross-request cache and the design's life-story copy are implemented; their decision rows still say proposed, with Rob as owner. | D2–D4, D11, D14 |

## How it works

### Rendering and the public read model

Each page keeps a static shell and a `Suspense` boundary. Its dynamic content starts with `await connection()`, checks the flag, then reads parameters and data. The individual page's `generateMetadata` follows the same guard. With the flag off, pages show `OpeningSoon` without reading memories; the header link is hidden and public media is unavailable.

`features/memories/public.ts` owns `PUBLIC_MEMORY_WHERE` and the explicit `PUBLIC_SELECT`. It selects only needed memory fields, contributor name/relationship, live READY media and READY derivatives. The memory's exact coordinates are read only to round its town point; no file's coordinates are read (playability no longer depends on them, D16 as amended, PR #94); derivative storage keys are read only to reject staged copies. Public DTOs contain neither exact coordinates nor storage keys, email, claim-token hashes, original filenames, EXIF or blob URLs. Map groups use `Memory` points, never `Media` GPS, and round their mean to 0.05°. Places without a point still appear in lists.

`listPublicMemories` and `getPublicMemory` use React `cache()` to share reads within one request, including the detail page and its metadata. There is no cross-request cache. The list loads every public row; pure helpers filter, sort, group and select related memories. Cumulative `n` is clamped to the matching total; cursor pagination is outside this build.

| URL input | Contract |
|---|---|
| Explore: `place`, `decade`, `tag`, `kind`, `q`, `n` | Slugs, decade 1900–2090 in tens, PHOTO/VOICE/VIDEO/TEXT, trimmed search up to 100 characters, positive integer count (default 12). Search covers name, relationship, words, date text, place and tags. |
| Map: `place`; Timeline: `kind`; Tags: `tag`, `n` | Tags defaults to 9; timeline jumps use `#d<decade>`. |
| Repeated or invalid inputs | First value wins; each invalid field is dropped/defaulted independently, preserving valid neighbours. |

Chips are links with `aria-current`; changing a filter resets `n`. Search uses a `next/form` GET form with a 400 ms typing enhancement; it sends no client dataset and calls no Server Function. Plain links and GET submission do not require JavaScript, but streamed dynamic content currently does: see the no-JavaScript gap below.

### Public media

`/api/public-media/<id>` calls `serveMedia` with caller `public`. The feature independently checks public eligibility even if the adapter's authorization callback permits it.

| Request or file | Result |
|---|---|
| Flag off, non-public/deleted memory, missing/removed/purged/not-READY file, unavailable photo copy or a type the site does not accept | Uniform 404; flag-off refusal happens before a database read. |
| Photo | READY server-made `WEB_IMAGE`, or `THUMBNAIL` for `v=thumb` with web-copy fallback; staged keys are refused. Never the original. |
| Any accepted video or recording (MOV, MP4, WebM, M4A, MP3, Ogg, WAV) | The original plays as recorded, including any location a phone saved in it. Rob, 2026-11-08: no open-source tool hides it at serve time without a second copy or a processing step, so "we'll just publish the videos with GPS locations" (videos and voice notes). The location scan still runs, for place suggestions only. |
| A video's `v=thumb` | Its READY server-made `POSTER` JPEG, or 404; never the video itself (video-posters D7, [PR #99](https://github.com/RobertdWray/jowray_com/pull/99)). |
| `v=original` or `download` | Original maps to the web view; download is ignored. There is no public download mode. Eligible audio/video still uses its original bytes for inline playback. |
| Allowed / allowance exhausted | 302 to a presigned URL valid for 60 seconds / 429 with `Retry-After`. |

Photos and video posters use `next/image` with `unoptimized`, so access stays behind the route. Cards load images lazily and contain no audio/video elements; a video card shows its first video's poster under the play badge once that copy is READY ([Video posters](./video-posters.md)). Players appear only on the memory page, without autoplay and with `preload="none"` (a browser hint), so opening a page requests no recording or video until the visitor presses play. A video's `poster` JPEG, when READY, is the one request before play, and only its bytes are charged to the public allowance. The duration shown comes from the database. Their single `<source>` carries no `type`, because a browser skips a typed source it says it cannot play (Chrome does for `video/quicktime`) instead of sniffing the file (D6 as amended in PR #94 Team Code Review round 1; was `preload="metadata"` with the stored mime type). The same `lib/memories/playability.ts` rule drives both page offerings and serving.

`MEDIA_PUBLIC_*` budgets use separate `public:` counters: default 20 GiB per UTC day site-wide, file egress capped at 100 times original size, and 600 requests per viewer per copy per file per day. Bytes are charged on that viewer/copy's first request. Claim/admin counters are untouched; counter errors still fail open (F5).

### Editing and re-review

The admin form and MCP `update_memory` share `lib/validations/admin.ts` and `features/admin/update-memory.ts`. `tags` is a normalized string array: at most 20 entries, at most 40 characters each, deduplicated by slug; `[]` clears it. `approxYear` accepts 1900 through the current year; `approxMonth` accepts 1–12. `null` clears these date fields and omitted fields stay unchanged. Validation and the locked update refuse a resulting month without a year. Display year is `approxYear ?? parseApproxYear(approxDateText)`; unparseable dates go to “Not dated yet.”

For a claim-link edit, `claim.ts` changes APPROVED to PENDING in the same locked transaction and revision as changed words, name, relationship, date, place, file caption or removal of a READY file. `ingest-upload.ts` does so when a site-added file or replacement becomes READY; failed/cancelled uploads and admin-added files do not trigger that transition. Preference/visibility-only changes and no-op saves keep status. A changed name or relationship also sends every other APPROVED memory of that contributor (one Contributor row per send) back to PENDING, whatever the edited memory's status, each with its own CLAIM_LINK revision; such an edit locks all of those memories in one id-ordered `FOR UPDATE` first (`lockContributorMemories`, TCR round 1 B1-2). The contributor sees the re-review message, which names the other memories when they went back too; there is no approved-version snapshot and no admin alert yet (F4)..

### Indexing and telemetry

`next.config.ts` sends `X-Robots-Tag: noindex, nofollow` on `/memories/:path*` and `/api/public-media/:path*`; page metadata also disables indexing/following. This is indexing policy, not access control (D19).

D20 keeps 100% Sentry traces and unmasked Session Replay for public visitors, including the existing network-body and feedback collection. The privacy note adds browsing visitors to its disclosure. The memory page tags `memory_id`; Pino continues logging ids with its existing redactions, and Sentry's secret scrubber still removes claim tokens, upload tickets and protected header values. See [Sentry telemetry](./sentry-telemetry.md) and F3.

## Operations and rollback

Use the [environment key reference](../environment.md#phase-1-application-keys) and the [plan's launch gates and rollback](../plans/2026-11-08-see-memories.md#launch-gates-and-rollback). `PUBLIC_MEMORIES_ENABLED` is a strict boolean, default false; unset/blank/false is dark and invalid values fail validation.

1. Merge and deploy with the flag absent. The additive tags migration accompanies the code; this task does not perform either step.
2. **Rob, L15:** review `list_memories(status: "APPROVED")`, including visibility, and change anything that must not be public to FAMILY. Check every memory's place for a street address and edit it to the town: place text is published as written. Both entry forms default to PUBLIC, so approval alone is not sufficient inventory sign-off. Confirm the design's life-story copy too (D14).
3. **Rob, L15:** set `PUBLIC_MEMORIES_ENABLED=true` in Vercel Production and redeploy on or before 2026-11-10. Changing the variable alone does not change the running deployment. Leave Preview dark unless intentionally enabled.
4. Check header navigation, all five page types, non-public not-found behaviour, media refusals/playback and noindex headers against [L13 verification](../plans/2026-11-08-see-memories.md#verification-l13-results-recorded-under-docsplansevidence2026-11-08-see-memories).

To roll back, set the flag to false and redeploy: opening notes return, the header link disappears, and public-media requests return 404. Already-issued signed URLs expire within 60 seconds. Keep the additive `tags` column; no destructive migration rollback is required.

## Key files

| Path | Role |
|---|---|
| **app** | |
| `app/memories/page.tsx`, `app/memories/map/page.tsx`, `app/memories/timeline/page.tsx`, `app/memories/tags/page.tsx`, `app/memories/[id]/page.tsx` | Five guarded pages and metadata |
| `app/memories/_components/` | Cards, pills/chips, maps, quilt, search, players, photo selection and phone accordion |
| `app/api/public-media/[id]/route.ts`, `app/_components/site-header.tsx`, `app/admin/memory-edit-form.tsx` | Public media adapter, conditional nav and editing |
| **features** | |
| `features/memories/public.ts`, `features/media/serve-media.ts` | Explicit public read model and serving gates/budgets |
| `features/memories/claim.ts`, `features/memories/ingest-upload.ts`, `features/admin/update-memory.ts` | Re-review transitions and family edits |
| **lib + server** | |
| `lib/memories/`, `lib/validations/public-memories.ts`, `lib/validations/admin.ts` | DTOs, pure models, playability and input contracts |
| `lib/media-location.ts`, `lib/video-gps.ts`, `server/config/env.ts`, `next.config.ts` | Location readers, launch/budget settings and noindex headers |
| **tests** | |
| `__tests__/api/public-media.test.ts`, `__tests__/features/public-memories.test.ts` | Serving refusals, isolated budgets, public guard and DTO fields |
| `__tests__/features/claim.test.ts`, `__tests__/features/ingest-upload.test.ts` | Re-review transitions and exceptions |
| `__tests__/integration/public-memories.test.ts` | Real-Postgres guard and tags column/default/round-trip |
| `__tests__/lib/memories-*.test.ts` (test-file family), `__tests__/lib/public-memories-validations.test.ts`, `__tests__/app/memories-hrefs.test.ts` | Year/tag/place models, facets, timeline, related items, playability, client logic, parsing and URLs |
| **Prisma** | `prisma/schema.prisma`, `prisma/migrations/20261108005301_memory_tags/migration.sql`: non-null text array with an empty-array default |

## Tests and evidence

The [ledger](../plans/2026-11-08-see-memories.md#ledger) records backend tests first going red then green in L6–L8, and L7's full database-backed run (111 files, 2622 tests). Those are earlier branch results, not a current full-suite count. L0 records the offline build on the untouched base; it does not establish the final feature build.

The [2026-11-08 evidence folder](../plans/evidence/2026-11-08-see-memories/) is being delivered in a parallel commit for L13; it is not present in this documentation worktree yet.

Documentation-task checks on 2026-11-08 (UTC), base `c15d03e` plus the A8 documentation edits, with no `.env*` files or database variables:

- `npm run validate`: passed (type generation, TypeScript and ESLint).
- `npm run test:run`: **blocked from an all-green result by sandbox permissions**. 109 files passed, one failed, eight skipped; 2751 tests passed, three failed, 50 skipped. The three failures are the loopback-listener cases in `__tests__/scripts/no-network.test.ts`: `listen EPERM: operation not permitted 127.0.0.1`. The database suites skipped as expected without `TEST_DATABASE_URL`. No tests or checks were weakened; this run needs repeating where loopback listeners are permitted.
- Documentation checks: heading order, removed template instructions, code paths, unchanged index Mermaid block and `git diff --check` passed. Relative file links resolve except the intentionally pending evidence folder.

**NOT RUN:** database-backed suites, `npm run build:offline`, browser/screenshots/a11y checks, live Sentry event delivery, CI and Production launch checks in this documentation task. No production or real-family-data exercise is claimed.

## Known gaps and follow-ups

Open items from the [plan's parking lot](../plans/2026-11-08-see-memories.md#follow-ups-parking-lot-for-after-the-merge):

- **F1 — closed, won't do (Rob, 2026-11-08):** no stripped `WEB_VIDEO`/`WEB_AUDIO` copies; videos and recordings play as recorded instead.
- **F2 — high:** the posted-memory email and `notifyWhenPosted` delivery are absent. [Issue #59](https://github.com/RobertdWray/jowray_com/issues/59) and the 2026-11-10 email promise need follow-through; enabling the flag sends no such email.
- **F3 — medium, Rob:** write the public-visitor telemetry policy and fuller privacy note. Public visitors currently inherit unmasked alpha collection.
- **F4 — medium:** send exactly one family/admin alert when a claim edit reopens an approved memory; currently only the contributor is told.
- **F5 — medium:** capacity reservation beyond separate budgets and fewer Blob API calls remain. Counters fail open on errors; `presignGet` makes a Blob API call per request. Card image fallback exists, but see the large-photo gap below.
- **F6 — medium:** video `POSTER` copies are built in [PR #99](https://github.com/RobertdWray/jowray_com/pull/99): one server-made frame per video at the THUMBNAIL spec, on cards, in the player and in the admin gallery ([Video posters](./video-posters.md)). Smaller roughly 400px `CARD` derivatives remain (video posters FU-2); cards still use the larger thumbnail/web copies and the 1000 px poster.
- **F7 — low, Rob:** decide whether to lift noindex and add a sitemap after launch; change headers, metadata and their test together.
- **F9 — low:** define richer approximate-date phrases and target years, with a test per phrase. Unlike the plan's example of missing support, the current four-digit rule already extracts 1950 from “early 1950s”; it does not interpret “early” as a more precise year.
- **F10 — low, Rob:** cross-request caching with `io()`/`"use cache"` waits for the D11 ruling on the `connection()` house rule. React request memoization is already present.
- **F11 — low:** relational Tag/MemoryTag tables, AI tagging, people filters and transcripts remain outside this build. Current patches are edited by the family, not automatically inferred.
- **F12 — low:** FAMILY browsing needs the later access/auth design; FAMILY memories stay off these public pages.

Additional branch findings supplied with this task; severities below are the documenting agent's assessments, not new Rob rulings:

- **No-JavaScript streaming — medium:** with JavaScript off, streamed content never replaces “Loading…” on any dynamic page of the site; Suspense needs its inline script. The plan's “every decade shows without JavaScript” holds only once that content is in the document, despite the accordion's `noscript` style. This browser finding was not rerun for this document.
- **XL design fidelity — low:** the 1920px+ three-pane Explore approximates Main-XL: extra space remains under search, and decade bars are columns instead of the board's horizontal rows. The code also retains the shared header/view pills and omits the XL inset. See [DESIGN §5.12](../../design/DESIGN.md#512-see-memories-memories-added-2026-11-08).
- **Large-photo fallback — fixed in TCR round 1 (B2-1):** the memory page's main photo and thumbnails sit over placeholder tiles and use `FallbackImage`, like the cards.
- **Location scan ambiguity — fixed in TCR round 1 (B1-1):** `readVideoLocation` now says whether an absence comes from a complete parse (`complete: true`) or a give-up (a limit, a malformed or unsupported box, a location value it could not use); `extractPhotoGps` stores that as `Media.gpsScanComplete` for MP4-family files. Since D16 was amended (Rob, 2026-11-08) the flag no longer decides public playback; it marks the files the reader gave up on. The reader still does not parse track-level metadata, XMP `uuid` boxes, 3GPP `loci` or iTunes `mdir` `©xyz` (issue #83), which now matters only for place suggestions.
- **Shared contributor edits — fixed in TCR round 1 (B1-2):** a name or relationship change through one claim link now reopens every other APPROVED memory of that contributor, so none shows an unreviewed name.
- **M4A place suggestions — informational:** M4A voice notes now use the MP4 location reader and feed place suggestions too; this extends behaviour beyond photos/video.

## Related

- [Plan, decisions and ledger](../plans/2026-11-08-see-memories.md), [parallel verification evidence](../plans/evidence/2026-11-08-see-memories/), [artboard spec and adjacent PNGs](../../design/reference/see-memories/SPEC.md), [DESIGN §5.12](../../design/DESIGN.md#512-see-memories-memories-added-2026-11-08).
- [Share form](./share-form.md), [Media uploads](./media-uploads.md), [Video posters](./video-posters.md), [Admin panel](./admin-panel.md), [MCP connector](./mcp.md), [Privacy note](./privacy.md).
- [Environment keys](../environment.md#phase-1-application-keys), [admin runbook](../admin.md), [code layout](../code-layout.md).
