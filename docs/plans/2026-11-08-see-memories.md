# See memories: public browsing of approved memories

Plan v2, 2026-11-08 (v1 2026-11-07; premortem by George, Oscar and a Claude pass sorted into the plan on 2026-11-08 with Rob's rulings). Design source: Rob's canvas "See memories", 10 artboards (Explore, Map, Timeline, Tags, One memory, four phone boards at 390px, one 2400px three-pane board), committed to the repo in step L1 below.

## Cold start: read this first

Everything an agent needs after a compaction or a handoff is in this file and in the repo; nothing points at a sandbox or a chat.

| Item | Value |
|---|---|
| Canonical plan path | `docs/plans/2026-11-08-see-memories.md` (the local draft `docs/plans/memory_Viewer_gui.md` is renamed to this in L1; only one copy exists) |
| Base commit | `origin/main` at `7bbd54a0` ("Merge pull request #88", 2026-11-07 17:24 UTC). If the branch is cut later, record the actual base SHA in ledger row L1 and re-check the newest migration name (`ls prisma/migrations \| tail -1`). |
| Branch | `see-memories`, cut from `origin/main` (pushed 2026-11-08; draft [PR #93](https://github.com/RobertdWray/jowray_com/pull/93)). The sandbox branch `claude/relaxed-gauss-jb2vf1` never reached origin. |
| Worktree | `../jowray_wt_see-memories` (the main checkout is behind origin; never work there) |
| Tracking issue | #89 "See memories: public browsing of approved memories", created at kickoff (L0) on 2026-11-07; the PR names it. Issue #37 is the closed docs issue whose body listed the Phase 2 ideas; it is not the tracker. |
| Launch constraint | 2026-11-10: `app/share/thank-you-client.tsx` promises "On November 10th, after we have some stories, photos and videos collected, we'll be sharing them with everyone and will email an update to all who have contributed." The pages ship dark behind `PUBLIC_MEMORIES_ENABLED` and go live only after Rob's inventory sign-off (D15). |
| Design inputs | `design/reference/see-memories/` (the ten `.dc.html` artboards, `data/memories.js`, `ds/jo-wray/tokens.json`, one PNG per artboard), committed in L1, same precedent as `design/reference/home.html`. The copy about Jo's life (eras, hero sentences) lives there and in `lib/memories/timeline.ts`. |
| Local environment | PostgreSQL 18 on port 54329 (`TEST_DATABASE_URL` and `DATABASE_URL_UNPOOLED` for local work), Node 26 from Homebrew, `npm ci`, then read `node_modules/next/dist/docs/` before any Next.js code (AGENTS.md). Env key names and purposes: `docs/environment.md`; never commit `.env*`. |
| Checks | `npm run validate`, `TEST_DATABASE_URL=postgresql://…:54329/jowray_test npm run test:run` (so the real-Postgres suites run instead of skipping), `npm run build:offline`. All three pass on the untouched base before any change (L0). |
| House rules that bite here | Every change on a branch with a PR; no `eslint-disable` without Rob's all-caps YES; no band-aids; TDD on critical paths (media serving, the public guard, claim re-review); `await connection()` first in every dynamic component; no Prisma or env at module scope; Pino only, ids never rows; `lib/memories/*` is pure and tested. |
| How to resume | Read the ledger below; the first row not marked done is the next step. Re-run the three checks first. The rulings log says why things are the way they are; do not re-open a ruling without Rob. |

## Decision status

| Id | Decision | Status | Owner |
|---|---|---|---|
| D1 | Public = `status APPROVED` AND `visibility PUBLIC` AND `deletedAt IS NULL`, one constant `PUBLIC_MEMORY_WHERE` (debt rule M-E-14). Since `/share` and the admin draft form both default visibility to PUBLIC, nearly every approved memory is already public, which is why D15 exists. | approved 2026-11-08 (bucket sort) | Rob |
| D2 | Map pins only from `Memory.latitude/longitude` (MCP-set, a named place), never `Media` GPS; grouped by place slug; pin = group mean rounded to 0.05°; town text only. Schema comment updated. | proposed (unchanged from v1); say so in review to drop the map | Rob |
| D3 | `Memory.tags String[] @default([])`, editable through MCP `update_memory` and the admin edit form; slugs from names; no AI tagging, no `Tag` tables. | proposed (unchanged from v1) | Rob |
| D4 | Display year = `approxYear ?? parseApproxYear(approxDateText)`; `approxYear`/`approxMonth` editable; undated memories in a trailing "Not dated yet" group. | proposed (unchanged from v1) | Rob |
| D5 | Server-rendered, URL-driven filters like `/admin`: `<Link>` chips, `next/form` search, no client dataset, no Server Functions. | approved 2026-11-08 (bucket sort) | Rob |
| D6 | Media through `/api/public-media/[id]` via `serveMedia` caller `"public"`; images only from derived copies; `download`/`original` refused; `next/image` `unoptimized`; media elements only on the memory page with `preload="metadata"`. | approved 2026-11-08, extended by D16 and D18 | Rob |
| D7 | Kind = `Memory.type`. | approved | agent call |
| D8 | Dropped from the design: people chips, transcript box, the design's footer, the phone page size of 5. | approved | agent call |
| D9 | "See memories" first in the header nav with `aria-current`, shown only when D15's flag is on. | approved | agent call |
| D10 | Three-pane Explore from 1920px (`min-[120rem]`); 12 cards per page everywhere, XL included. | approved 2026-11-08 (#9) | agent call |
| D11 | No caching in this PR; `io()` + `"use cache"` is a follow-up needing a ruling. | proposed | Rob |
| D12 | Prev/next link to the adjacent memory page. | approved | agent call |
| D13 | Memory URLs use the row id; a non-public id renders the not-found UI with `noindex` (HTTP 200 once streaming has begun; the media route is a true 404). | approved 2026-11-08 (#3, #15) | Rob |
| D14 | Copy about Jo's life taken verbatim from the design; Rob confirms the facts in review. | proposed | Rob |
| D15 | Launch flag `PUBLIC_MEMORIES_ENABLED` (strict boolean, default false): pages, media route and header link stay dark until Rob signs off the inventory; flipping it is a redeploy. | approved 2026-11-08 (#11) | Rob |
| D16 | Location gate: VIDEO and MP4-family audio play publicly only when the media row's location scan is decided with no coordinates; browser-recorded formats play; everything else shows a one-line status. Stripped copies are follow-up F1. | approved 2026-11-08 (#1, #10) | Rob |
| D17 | A claim-link content edit, file add, remove or replace on an APPROVED memory sets it back to PENDING; preference and visibility changes do not. | approved 2026-11-08 (#24) | Rob |
| D18 | Public media has its own budgets (`MEDIA_PUBLIC_*`) and counter scopes; claim and admin budgets are untouched. | approved 2026-11-08 (#4, #13) | Rob |
| D19 | `X-Robots-Tag: noindex, nofollow` on `/memories/:path*` and `/api/public-media/:path*` at launch, plus `robots` metadata; revisit after launch (F7). | approved 2026-11-08 | Rob |
| D20 | Sentry stays as it is (100 % unmasked replays) for public visitors; the privacy note gains one sentence saying visitors who browse the memories are recorded too. A visitor telemetry policy is follow-up F3. | approved 2026-11-08 | Rob |

## Ledger

| Row | Step | Done when | Status |
|---|---|---|---|
| L0 | Kickoff: worktree, branch from `origin/main`, `npm ci`, the three checks green on the base, tracking issue created, base SHA and newest migration recorded here | three green checks recorded; issue number in the cold-start table | done 2026-11-07: base `7bbd54a07e7f` (unchanged from the plan), newest migration `20261107000000_media_admin_upload`; `npm run validate` exit 0; `test:run` with `TEST_DATABASE_URL` on a dedicated local database `jowray_seemem_test` (port 54329): 102 files, 2280 tests, 0 skipped; `build:offline` exit 0 with no `.env*` and no database variables. The base build log has no Sentry tunnel line (none is printed offline), so L13 checks for no new errors rather than for that line. Issue #89. |
| L1 | Commit the design inputs to `design/reference/see-memories/`; rename the plan to its canonical path; first commit | files present; `__tests__/lib/readme-diagrams.test.ts` still green (no Mermaid touched) | done 2026-11-07: the ten artboards unpacked from Rob's `See memories.html` export (`~/Downloads`, 2026-11-07) with their seed data, tokens, PNGs and a provenance `README.md`; plan copied from the untracked draft |
| L2 | `lib/memories/types.ts` (DTOs) | typecheck green | done 2026-11-07: `types.ts` (also `ExploreFilters`, `PlaceGroup`) and a shared `lib/memories/slug.ts` (`slugify`, used by both `tags.ts` and `places.ts` so their slugs cannot drift) with `__tests__/lib/memories-slug.test.ts`; tsc and eslint green |
| L3 | Astra A1–A3: `approx-year.ts`, `tags.ts`, `places.ts` + tests | tests green, inspected, integrated | done 2026-11-08: Astra run `~/.local/state/astra-work/888f1417a12a/20261108T005059Z-cffcf66e`; A1 `8c87f49`, A2 `ceccd4d`, A3 `0379368` (cherry-picked onto the L4 commit); each task inspected, checked independently and accepted; combined `validate` + `test:run` on the integration branch passed. `pinSize` keeps the plan's formula; the artboards use slightly different coefficients per board (plan wins) |
| L4 | Schema + migration (`tags`), `update-memory.ts`, `get-memory.ts`, admin edit form, MCP descriptions, snapshot test; `prisma migrate dev --name memory_tags` on local PG | `TEST_DATABASE_URL` run green including the new tags round-trip test | done 2026-11-08: migration `20261108005301_memory_tags` (`TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`; Prisma generates the column nullable, NOT NULL added by hand and shown drift-free with `migrate diff`); local database `jowray_seemem2` (the first one, `jowray_seemem_test`, holds the pre-edit migration and can be dropped); month-without-year refused in the schema when both are sent and in the locked update against the stored year; `npm run validate` exit 0; `test:run` with `TEST_DATABASE_URL`: 106 files, 2393 tests |
| L5 | Astra A4–A5: `explore.ts`, `timeline.ts`, `related.ts`, `validations/public-memories.ts` + tests | tests green, inspected, integrated | done 2026-11-08: Astra run `~/.local/state/astra-work/888f1417a12a/20261108T010019Z-56da82a4`; A4 (`format.ts`, `explore.ts` with the Map and Tags models, `timeline.ts`, `related.ts`; 108 tests) `959eec5`, A5 (`lib/validations/public-memories.ts`, `app/memories/_components/hrefs.ts`; 102 tests) `37f0032`; each inspected and checked independently; combined `validate` + `test:run` passed on the integration branch. `format.ts` was not in the plan's owner table and went to A4. Eras: one `ERAS` (the 1280 timeline's per-decade copy) and a separate `ERA_LINE` (the Explore page's five ranges), both verbatim for Rob (D14) |
| L6 | Env: `PUBLIC_MEMORIES_ENABLED`, `MEDIA_PUBLIC_*`; `lib/media-location.ts` audio types; `serve-media.ts` public caller, budgets, location gate; `/api/public-media/[id]` + tests | route tests prove every refusal in the verification list | done 2026-11-08: `__tests__/api/public-media.test.ts` written first (red), then green: 404 for PENDING/HIDDEN/DRAFT/FAMILY/PRIVATE, deleted memory, removed/purged/not-READY file, missing copy, unknown id, flag off (no database read), located or unscanned MOV/M4A; 302 for a clean MOV/M4A and WebM; photo originals and downloads never served; only `public:` scopes charged; 429 per viewer and site-wide; `serveMedia` refuses for `public` even when `authorize` says yes. `lib/memories/playability.ts` is the one D16 rule (also used by the pages). `lib/media-location.ts` gains `MP4_CONTAINER_MIME_TYPES`/`isMp4Container` so `readGps` routes M4A to the MP4 reader (an old test that pinned "voice notes are skipped" now pins WebM, and M4A joins the location cases). Residual: `readVideoLocation` stamps a malformed or over-limit file `absent`, which D16 treats as clean (PR notes) |
| L7 | Claim re-review (D17) in `claim.ts`, ingest transition, replacement flow + tests | `__tests__/features/claim.test.ts` and ingest tests green | done 2026-11-08: tests first (14 red), then green. `reopensForReview` in `claim.ts`; words/name/relationship/date/place edits, removing a READY file and editing a file's caption on an APPROVED memory write PENDING in the locked transaction with `status` in the CLAIM_LINK revision; visibility/preferences, no-op saves, cancelled reservations, non-APPROVED memories keep their status. `ingest-upload.ts` `transition`: a site file (not `addedVia = ADMIN`) added or swapped in on an APPROVED memory sets PENDING (separate revision for an add, `status` in the swap revision for a replacement); failed files and replacements cancelled in flight do not. Results carry `reopened`; the claim page says "Saved. The family will take another look before it is back on See memories." (`lib/memories/review-again.ts`). Six older tests that pinned "M4A has no location reader" (L6 consequence) now pin WebM, and place suggestions now include M4A points. Full `test:run` with `TEST_DATABASE_URL`: 111 files, 2622 tests (one earlier run failed in `__tests__/integration/extract-photo-gps.test.ts`; it was the integration-file deadlock against the budget suite's TRUNCATE, fixed in `35bb0c8` by running those files one at a time) |
| L8 | `features/memories/public.ts` + tests | guard test asserts `PUBLIC_MEMORY_WHERE` and the DTO shape | done 2026-11-08: test first (red), then green (16): exact `where`, explicit `select` with no email/token hash/blob URL/EXIF/file name/original key, no secret or exact coordinate in any DTO, point rounded, photos only with a non-staged READY web copy, D16 playability per type, "A friend of Jo's", month only with the family's year; `getPublicMemory` refuses a non-UUID without a query. Typed with `satisfies Prisma.MemorySelect` and `MemoryGetPayload` (no casts). Real Postgres: APPROVED + PUBLIC listed; FAMILY, PENDING and deleted not listed and `getPublicMemory` null for each |
| L9 | Components and the five pages at 1280 | screenshots match the five desktop boards | done 2026-11-08 (`eba9997`): `app/memories/**` pages and `_components`; screenshots in the evidence folder. Agent calls listed there (inset beside the map, phone Explore without a map, Tags note per D3, eras) |
| L10 | Astra A6: client pieces (search, accordion, zoom, photo figure, player) | contracts from this plan hold in the browser | done 2026-11-08: Astra run `~/.local/state/astra-work/888f1417a12a/20261108T011659Z-d2f39d66`, launched in parallel with L9 against fixed prop contracts; `37adba3` (with `NavLink` and the pure `lib/memories/client-logic.ts`); browser check found one search-sync bug, fixed in `c15d03e` |
| L11 | Phone (390) and XL (1920+) passes; header nav; `globals.css` utilities; `next.config.ts` headers; privacy note sentence | screenshots match the phone boards and the XL board | done 2026-11-08 (`eba9997`): phone-first classes with `sm:`, XL grid placement with `min-[120rem]:` (an approximation, see evidence); the header link is passed in by the root layout (`app/_components` may not read env, and an awaited `connection()` there would make every page dynamic; a flag change is a redeploy anyway, so `/`, `/share` and `/how-it-was-built` stay static); D19 headers pinned in `__tests__/next-config.test.ts`; D20 sentence |
| L12 | Astra A7–A8: copy sweep, DESIGN.md §5.12, feature doc, README rows | `npm run validate` green; links resolve | done 2026-11-08: Astra run `~/.local/state/astra-work/888f1417a12a/20261108T013408Z-5cf0b815`; A7 `fc31a6d` (copy sweep; dated rulings keep their words with a superseded note), A8 `30bd828` (`docs/features/see-memories.md`, `docs/features/README.md` row, DESIGN.md §5.12 and §9); combined `validate` + `test:run` passed. F8 needed nothing: main already said twelve tools |
| L13 | Verification run (below) with evidence saved under `docs/plans/evidence/2026-11-08-see-memories/` | every line of Verification has a recorded result or a NOT RUN line | done 2026-11-08: see the evidence README. Local `next dev` ran from a throwaway worktree whose `getDb` used node-postgres (the Neon driver cannot reach a local PostgreSQL; Docker was off), with invented data only. Two NOT RUN lines (Sentry tag, real Blob files) and one plan expectation that cannot hold (no-JS timeline: streamed content needs its inline script, site-wide) |
| L14 | Draft PR with the parking lot in its notes; `/team-code-review`; buckets confirmed by Rob; cited issues; repairs; re-review | nothing severe left or Rob says stop | done 2026-11-08 by Rob's six-step final review: draft PR #93; one TCR round (George 7, Oscar 7 findings; log `~/Downloads/team-review-20261107-204104-jowray_com-pr93-048bf05.md`); buckets by the orchestrator (B1: give-up location scans, shared-contributor edits, approval review version, seed host check; B2: photo fallback, one public rule, search blur, timeline re-click, plan text; B3 in the PR comment; B4 in the PR notes); fixes by the TCR subagent on `see-memories-tcr1` (`e8b0b72`…`86689d2`, merged into this branch); regression review on Fable 5.1 found one blocker (integration-file deadlock, fixed) and minor notes; merged head green (validate, 132 files / 3319 tests on real Postgres, build:offline) |
| L15 | Rob's inventory sign-off (including every memory's place checked for a street address and edited to the town, TCR round 1 B2-5); flag on; redeploy on or before 2026-11-10 | public pages live | todo |

## Rulings log (what, why, cost if wrong)

- 2026-11-04, Rob: 100 % tracking and unmasked replays "since … only family will be using it". Re-affirmed for public visitors on 2026-11-08 (D20). Cost if wrong: strangers' sessions recorded unmasked; mitigated by the privacy note sentence; reversible by changing `instrumentation-client.ts` (follow-up F3).
- 2026-11-08, Rob: noindex at launch (D19). Cost if wrong: the section is not found by search engines until revisited; nothing leaks.
- 2026-11-08, Rob: buckets 1 and 2 go into the plan; bucket 3 becomes non-goals; bucket 4 the parking lot; the plan must survive a cold start.
- 2026-11-08, agent: public playback of location-bearing video waits for stripped copies (D16) rather than accepting exposure. Cost if wrong: fewer videos play on launch day; reversible by F1.
- 2026-11-08, agent: PENDING on claim-link edits (D17) rather than a snapshot table. Cost if wrong: an edited memory disappears from the public site until re-approved; the admin page shows it as pending.
- 2026-11-07, agent: 0.05° rounding of the town pin (D2). Cost if wrong: a pin a few miles off the town centre; never a house.
- 2026-11-07, agent: year parsing from `approxDateText` (D4). Cost if wrong: a memory lands in the wrong decade until the year is edited.

## Premortem crosswalk (27 findings, 2026-11-08)

| Findings | Bucket | Where it landed |
|---|---|---|
| #1, #10 location in public audio/video | 1 | D16; serve-media and the public route; follow-up F1 |
| #11 (+#2 part 1) everything goes live on deploy | 1 | D15; L6, L15; launch gates |
| #3, #15 `notFound()` streams 200 | 1 | D13; Verification; non-goal N1 |
| #24 claim edits publish without review | 1 | D17; L7; non-goal N4 |
| #25 Nov 10 promise, notify opt-in | 1 (date) + 4 (email) | cold-start table; follow-up F2 |
| #4, #13 shared media caps | 1 | D18; L6; follow-ups F5 (capacity, Blob calls) and F6 (card thumbnails) |
| #5, #17, #18, #23, #27 handoff gaps | 1 | this cold-start header, ledger, decisions, L1 |
| #6 (+#22 essentials) search contract | 1 | search form section; non-goal N3 |
| #8, #19 slugs | 1 | `lib/memories/tags.ts`, `places.ts` |
| #9 16 vs 12 cards, pill prefetch | 1 | D10; components |
| #14 seed guard | 1 | loopback-only seed; non-goal N6 |
| #16 verification gaps | 1 | Verification |
| #21 phone timeline accordion | 1 | `timeline-decades-client.tsx` |
| #7 year/month clearing and parsing | 1 (clearing) + 2 (niceties) | validations; `approx-year.ts` |
| #2, #12 Sentry for public visitors | decision | D20; follow-up F3 |
| #26 indexing | decision | D19; follow-up F7 |
| #20 cursor pagination | 3 | non-goal N2 |
| #22 race-test matrix | 3 | non-goal N3 |

Facts the premortem established on `origin/main` `7bbd54a`, kept here because they shape the design: `features/media/serve-media.ts` derives only `image/*` (audio and video serve the original); `lib/video-gps.ts` + `features/media/extract-photo-gps.ts` read MOV/MP4 location into `Media.latitude/longitude` with `gpsCheckedAt` (decided) and `gpsAttempts` (max 3), with fixtures `__tests__/fixtures/location-mdta.mov`, `location-xyz.mp4`, `no-location.mov`; `features/memories/claim.ts` changes status only when a DRAFT is shared; `app/share/share-form.tsx` and `app/admin/draft-form.tsx` default visibility to PUBLIC; `instrumentation-client.ts` records 100 % unmasked; `server/config/env.ts` caps are 300 requests per viewer per day, 100 viewer-days per approved file, 50 GiB per day site-wide, all shared; `integrations/vercel-blob/index.ts` `presignGet` makes one Blob API call per request; `lib/sentry/secrets.ts` secret keys do not collide with `place`, `decade`, `tag`, `kind`, `q`, `n`; the newest migration is `20261107000000_media_admin_upload`; the MCP now has twelve tools.

## Context

jowray.com collects memories of Jo but shows none: the admin page says approving publishes nothing, `/how-it-was-built` says "Nothing you share is public yet", and the README's Phase 2 roadmap describes what the design draws: every approved memory the family makes public, browsable by place, year, patch (tag) and kind with a search box, and one page per memory that plays the recording or video and shows the photos in the house patchwork frame. The admin list page (`app/admin/page.tsx`, `list-filters.tsx`) already proves the pattern reused end to end: static shell → `<Suspense>` → `await connection()` → `await searchParams` → feature → `<Link>` chips and a GET form.

Outcome: `/memories`, `/memories/map`, `/memories/timeline`, `/memories/tags`, `/memories/<id>` and `/api/public-media/<id>` behind a launch flag, matching the artboards with the site's own tokens, buttons, hearts, header and footer; tags and year editable through MCP `update_memory` and the admin edit form; claim-link edits of approved memories re-reviewed; every "nothing is public yet" line brought up to date.

## Artboard → implementation

| Artboard | Route / component | Notes |
|---|---|---|
| Main (Explore, 1280) | `app/memories/page.tsx` | Hero with live stats and three tilted stat tiles; `PrimaryLink` "Leave a memory of Jo" with `StitchedHeart`, `SecondaryLink` "Start at the beginning" → timeline; "Ways to look" band (view pills + search); "Where the stories happened" US map + top-7 places; "When" decade bars + era line; "What she loved" tag chips + Kind chips; results heading, "Show everything again", empty state, card grid `grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))]`, "Show 12 more of N"; lake-green share band |
| Map (1280) | `app/memories/map/page.tsx?place=<slug>` | Hero copy, view pills, big map with "Closer to home" inset, selected place (eyebrow, name, "The earliest is from…", "See all N in Everything" → `/memories?place=`), 6 cards oldest first, "Every place, most stories first" grid, "N memories don't say where they happened" |
| Timeline (1280) | `app/memories/timeline/page.tsx?kind=` | "N years of Jo stories, first to last"; decade jump bars (`#d1980` anchors); "Show:" kind chips; per decade: 60px red Fraunces label, era, count, dashed red thread with heart markers, rotated red year pills, cards; empty decade note; "The thread keeps going. Add a stitch."; trailing "Not dated yet" group (D4) |
| Tags (1280) | `app/memories/tags/page.tsx?tag=<slug>&n=` | The quilt: patches sized `20 + (n/max)^0.8 × 26` px, tilts and dashed edge colours cycling (periwinkle, goldenrod, lake-green, sunhat-pink, plum, wood), selected = periwinkle-deep; "N memories carry this patch", "Often stitched next to:" (top-4 co-occurring), "Mix this with a place or a year" → `/memories?tag=`; 9 cards + "Show 9 more of N" |
| One memory (1280) | `app/memories/[id]/page.tsx` | Breadcrumb "All the memories" + "Memory i of N on the thread"; patchwork figure with the real web copy, Fraunces caption, red pill "when, town", thumbnail buttons for the other photos (client); eyebrow "A memory from", h1 who, relationship; dashed blockquote; `<dl>` When/Where tiles ("as they remembered it", "N more from <town>" → map); patches; `PrimaryLink` "This reminds me of a Jo story" + "Something wrong here? Tell the family" (`mailto:` the family address); Earlier/Later; "Close to this one" (same town 3 pts, within 5 years 2 pts, each shared tag 1 pt; top 3) with kind badges |
| Phone · one memory (voice) | same page, `kind === "VOICE"` | "A voice memory from"; the recording box: decorative bars, 0:00 / m:ss, big red Listen/Pause button (client) over a native `<audio controls preload="metadata">`, "Nothing plays until you press it."; VIDEO gets a native `<video controls preload="metadata" playsInline>` in the dashed frame. When D16 withholds the file the box shows "This recording will play once the family's copy is ready." and no player |
| Phone · explore / map / timeline | same pages at 390px | View pills in a horizontally scrolling row (`overflow-x-auto scrollbar-none`), `text-display-sm`/`text-h2-sm`, compact decade bars with `’50` labels, tag/kind chips scrolling rows; map: "Close to home / Whole country" segmented control (client) swapping inset and US map; timeline: one decade open at a time below `sm`, driven by the URL hash (D4, #21), all open from `sm` and without JavaScript |
| Main-XL (2400) | `app/memories/page.tsx` at `min-[120rem]` | `grid-template-areas`: header band (h1 inline + stats + nav + primary CTA) / filters aside (view nav stacked, search, Kind 2×2, When rows with horizontal bars, patches) / results `auto-fill` grid, 12 before "Show more" (D10) / map aside (map, "Closer to home" 2:1, top-8 places 2-col) |

Shared look (from the design and the tokens that already exist in `app/globals.css`): page ground `bg-muslin` + gingham (body rule), cards `rounded-card border-[3px] border-wood-light bg-paper p-5 shadow-card motion-safe:transition-transform motion-safe:hover:-translate-y-[3px] motion-safe:hover:shadow-card-hover` (the home-page card hover), eyebrows `text-small font-bold uppercase tracking-[0.08em] text-jo-red-deep sm:text-body`, active view pill `min-h-tap rounded-full bg-periwinkle-deep px-[22px] text-label font-bold text-white shadow-[0_4px_0_#26406a]`, inactive pill `border-[3px] border-dashed border-periwinkle bg-paper`, chips the same at `min-h-12`, place rows `rounded-input`, section bands `border-y-[3px] border-dashed border-jo-red bg-paper`, hearts from `SolidHeart`/`StitchedHeart`, 17px floor everywhere (map labels are HTML, never SVG text).

## Architecture

```
app/memories/**              thin pages: static shell → <Suspense> → connection() → flag → searchParams → features → render
app/api/public-media/[id]    HTTP adapter over features/media/serve-media (caller "public", location gate, own budgets)
features/memories/public.ts  listPublicMemories(), getPublicMemory(id): the only readers of PUBLIC_MEMORY_WHERE
features/memories/claim.ts   claim-link edits of an APPROVED memory go back to PENDING (D17)
lib/memories/*               pure, unit-tested: DTOs, year parsing, tags + slugs, places + projection, explore facets, timeline, related
lib/validations/*            zod: public query strings; tags/approxYear in the admin changes schema
server/config/env.ts         PUBLIC_MEMORIES_ENABLED, MEDIA_PUBLIC_*
```

Data flow for `/memories?place=towson-md&decade=1980&kind=PHOTO&q=quilt&n=24`: the page renders its static hero copy and view nav immediately `[C3]`; inside `<Suspense>` `[C1, C4]` an async `ExploreContent` awaits `connection()`, reads the flag (dark → the "Opening November 10" note), awaits `searchParams` `[C2]`, validates them with `publicExploreQuerySchema` (invalid → defaults, as the admin page does) `[C37]`, calls `listPublicMemories()` once (React `cache`-wrapped) `[C36]`, runs the pure `buildExplore(memories, filters)` and renders cards and `<Link>` chips `[C5]`. Every chip href is the current query with one key toggled and `n` reset; "Show 12 more" is the same URL with `n` raised, `scroll={false}` `[C5]`; card images load lazily, so a long page fetches only what scrolls into view `[C45]`.

## Changes by file

### Environment, data model, validation, admin and MCP plumbing

- `server/config/env.ts`: `publicMemoriesSchema` with `PUBLIC_MEMORIES_ENABLED: strictBoolean.default(false)` and `getPublicMemoriesEnv()`; `mediaServingSchema` gains `MEDIA_PUBLIC_DAILY_EGRESS_BYTES` (default 20 GiB), `MEDIA_PUBLIC_FILE_DAILY_MULTIPLE` (default 100) and `MEDIA_PUBLIC_VIEWER_DAILY_REQUESTS` (default 600), all `blankIsUnset` like their siblings `[C37, C48]`. `docs/environment.md` lists the four keys and says a flag flip is a redeploy.
- `prisma/schema.prisma`: `tags String[] @default([])` on `Memory` `[C20]`; `latitude`/`longitude` comments updated to D2 (town-level, rounded, APPROVED + PUBLIC only; `Media` coordinates stay "never shown on the site" and now also gate public playback, D16).
- `prisma/migrations/<timestamp>_memory_tags/migration.sql`: `ALTER TABLE "Memory" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];`. Created with `prisma migrate dev --name memory_tags` against the local PostgreSQL (L4) `[C22]`; when no database is at hand, generated with `prisma migrate diff --from-schema <(git show <base>:prisma/schema.prisma) --to-schema prisma/schema.prisma --script` `[C21]`. The folder must sort after the newest migration at run time (`ls prisma/migrations | tail -1`, currently `20261107000000_media_admin_upload`), and `__tests__/integration/` gains a test asserting the exact column, type and default.
- `lib/memories/tags.ts` (new): `normalizeTags(string[])` (trim, collapse spaces, drop empties, ≤40 chars each, dedupe by slug keeping the first spelling, ≤20, refuse a tag whose slug is empty) and `tagSlug(name)` (lower-case, diacritics stripped, `[^a-z0-9]+` → `-`, hyphens trimmed, ≤80) `[C20, C37]`. Tests: `café`/`cafe`, `St. Mary's`/`St Marys`, trailing spaces, punctuation-only, non-Latin names, the 80-character cap.
- `lib/memories/approx-year.ts` (new): `parseApproxYear(text)` → `number | null`: a 4-digit year, `'85`/`’85`, "the 1950s" → 1950, a range "1949–66" → 1949, bounded 1900 to the current year; `displayYear(memory)` = `approxYear ?? parseApproxYear(approxDateText)` `[C20]`.
- `lib/validations/admin.ts`: `changes` gains `tags: z.array(z.string().trim().min(1).max(40)).max(20).transform(normalizeTags).optional()`, `approxYear: z.number().int().min(1900).max(<current year>).nullable().optional()`, `approxMonth: z.number().int().min(1).max(12).nullable().optional()`, with a refinement that refuses a month when the resulting year is null; `null` clears, `undefined` leaves alone `[C37]`. The `adminShareDraftSchema` description "APPROVED publishes nothing public yet" becomes "APPROVED + PUBLIC shows on See memories once the family turns it on" `[C38]`. `lib/validations/mcp.ts` needs no change.
- `lib/validations/public-memories.ts` (new): `slugSchema` (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤80), `publicExploreQuerySchema { place?, decade? (coerced int, 1900–2090, multiple of 10), tag?, kind? (PHOTO|VOICE|VIDEO|TEXT), q? (trim, ≤100, empty → undefined), n? (coerced int ≥ 1, default 12; clamped to the total in the model, no other cap) }`, `publicMapQuerySchema { place? }`, `publicTimelineQuerySchema { kind? }`, `publicTagsQuerySchema { tag?, n? (default 9) }`, `firstParam()` `[C2, C37]`.
- `features/admin/update-memory.ts`: `MEMORY_KEYS`, `AdminMemoryEditable`, `REVISION_KEY` and both `select`s gain `tags`, `approxYear`, `approxMonth`; array equality via `tagsEqual`; writes `tags: changes.tags` `[C20, C24]`.
- `features/admin/get-memory.ts`: `AdminMemoryView` gains `tags`, `approxYear`, `approxMonth` `[C23]`.
- `app/admin/memory-edit-form.tsx`: fields "year" (number), "month" (select 1–12 or blank) and "patches" (comma-separated text, split and normalised before submit); dirty tracking compares the joined string `[C13, C37]`. `app/admin/memory-detail.tsx`: a "Patches" chip row `[C27]`.
- `app/api/mcp/tools.ts`: `update_memory` description names tags and the year; `share_draft`/`set_status` say what APPROVED + PUBLIC shows and that the flag must be on `[C38]`; the tools/list snapshot in `__tests__/api/mcp.test.ts` updated.

### Public read model

- `lib/memories/types.ts` (new): `PublicMemory { id, kind, who, relationship, note, when, year, month, place: { label, slug } | null, point: { lat, lon } | null, tags: { name, slug }[], durationSeconds, photos: { id, width, height, alt }[], playable: "yes" | "waiting", createdAt }` and `PublicMemoryDetail` (adds the media list `{ id, kind, mimeType, caption, durationSeconds, width, height, hasThumb, playable }`) `[C13, C23]`. Never an email, claim token hash, blob URL, storage key or exact coordinate.
- `features/memories/public.ts` (new, `import "server-only"`): `PUBLIC_MEMORY_WHERE = { status: "APPROVED", visibility: "PUBLIC", deletedAt: null }` with the M-E-14 comment `[C24]`; `listPublicMemories = cache(async () => …)` selecting exactly the DTO fields, `contributor: { select: { name, relationship } }`, `media: { where: { deletedAt: null, purgedAt: null, status: "READY" }, select: { id, mimeType, durationSeconds, width, height, caption, sortOrder, latitude, longitude, gpsCheckedAt, derivatives: { where: { status: "READY" }, select: { kind, width, height } } }, orderBy: LIVE_MEDIA_ORDER }`, `orderBy: [{ createdAt: "desc" }, { id: "desc" }]` `[C23, C25, C36]`; `getPublicMemory = cache(async (id) => …)`. `playable` is computed by `publicPlayability(media)` in `lib/memories/playability.ts` (pure, tested): `yes` for `image/*` with a READY derived copy, for `audio/webm`, `audio/ogg`, `audio/wav`, `audio/mpeg`, `video/webm`, and for `video/quicktime`, `video/mp4`, `audio/mp4`, `audio/x-m4a` only when `gpsCheckedAt !== null && latitude === null && longitude === null`; otherwise `waiting` (D16) `[C20]`. Who = contributor name or "A friend of Jo's". Point = rounded to 0.05° in `lib/memories/places.ts`. Logs with `createLogger({ category: "api" })`, ids only.
- `lib/memories/places.ts` (new): `normalizePlaceLabel`, `placeSlug`, `groupPlaces(memories)` → `{ slug, label, count, years, point }[]` grouped by slug (mean of member points rounded to 0.05°; no pin when no member has coordinates), `US_OUTLINE_PATH` (from `design/reference/see-memories/Map.dc.html`), `usPoint(lat, lon) = { x: (lon + 125.5) × 1.69, y: (49.8 − lat) × 3.9286 }` %, `inUsBounds`, `homePoint`/`inHomeBounds` (lon −77.7…−74.7, lat 38.1…40.6), `pinSize(n, selected) = round(26 + √n × 7) + (selected ? 6 : 0)` `[C20]`.
- `lib/memories/explore.ts` (new): `buildExplore(memories, filters)` → stats (total, places, first, last, decades), pins and top places (counts computed with every filter except `place`), decades 1950s–2020s extended to the data's range (counts without `decade`), tag chips (top 12 without `tag`, selected always kept), kinds (without `kind`), the filtered list sorted year desc, month desc, createdAt desc with undated last, `shown = list.slice(0, min(n, total))`, the summary heading ("57 memories, newest first" / "12 photos about quilting from Towson, MD in the 1980s mentioning “bus”"), `hasFilters`, `nextN`. Search = case-insensitive substring over who, relationship, note, when, place label and tag names `[C2, C37]`.
- `lib/memories/timeline.ts` (new): `ERAS` (design copy, D14), `buildTimeline(memories, kind)` → title, jumps (bar heights and `#d<decade>` ids), decades with years and cards, undated group `[C20]`.
- `lib/memories/related.ts` (new): `threadOrder`, `prevNext(sorted, id)`, `nearby(all, memory, 3)` `[C20]`.
- `lib/memories/format.ts` (new): `countNoun`, `durationText` ("47 sec", "3 min"; `lib/format-duration.ts` stays for the m:ss clock), `fakeBars(seed, count)` `[C34]`.

### Public media (critical path, TDD)

- `lib/media-location.ts`: `hasLocationReader` also returns true for `audio/mp4` and `audio/x-m4a` (same MP4 container, same `readVideoLocation`), so the cron's GPS step scans them and stamps `gpsCheckedAt` `[C20]`.
- `features/media/serve-media.ts`: `MediaCaller` gains `"public"`; the memory `select` adds `visibility`; the media `select` adds `latitude`, `longitude`, `gpsCheckedAt`; `authorize` receives `{ claimTokenHash, status, visibility }`; a new `publicPlayable(media)` check (the same rule as `lib/memories/playability.ts`) refuses with the uniform 404 when the caller is `"public"` and the row is not playable; `withinAllowance` charges `"public"` to `public:` scopes against the `MEDIA_PUBLIC_*` limits and never touches the claim or admin scopes (D18) `[C23]`.
- `app/api/public-media/[id]/route.ts` (new): `GET(request: NextRequest, ctx: RouteContext<"/api/public-media/[id]">)`, request reads first (`v`, `viewerKeyFrom(request.headers)`), flag check (dark → 404), `original` mapped to `web`, `download` ignored, `await ctx.params`, then `serveMedia({ caller: "public", allowDeletedMemory: false, authorize: (m) => m.status === "APPROVED" && m.visibility === "PUBLIC" })`; `export const maxDuration = 60` `[C14, C12]`.

### Claim-link re-review (critical path, TDD)

- `features/memories/claim.ts`: in `updateMemoryFromClaim`, when `fresh.status === "APPROVED"` and the written snapshot changes any of name, relationship, contributorNote, approxDateText or place, the same locked transaction also writes `status: "PENDING"` and the revision's `before`/`after` carry `status`; changes limited to `visibility`, `notifyWhenPosted`, `contactOptIn` leave the status alone. `retireMedia` and `updateMediaFromClaim` do the same for an APPROVED memory, and so does the replacement-READY transition in `features/memories/ingest-upload.ts` and the claim-page add path (D17) `[C49, C24]`.
- `app/m/[claimToken]/claim-form.tsx` and `media-list-client.tsx`: when the memory was APPROVED, the success copy reads "Saved. The family will take another look before it is back on See memories." `[C13]`.
- `features/admin/set-status.ts`, `share-draft.ts`: comments updated (copy sweep).

### Pages and components (`app/memories/**`)

- `app/memories/page.tsx`, `map/page.tsx`, `timeline/page.tsx`, `tags/page.tsx`: static `metadata` titles ("See memories — Jo Wray", "Memories by place — Jo Wray", "Memories by year — Jo Wray", "What she loved — Jo Wray") with `robots: { index: false, follow: false }` (D19) `[C9]`; static hero and view nav; one `<Suspense fallback={<p className="text-body text-walnut-soft">Loading…</p>}>` around an async content component that starts with `await connection()` `[C1, C4]`, reads the flag (dark → `OpeningSoon` note), awaits `searchParams` `[C2]`, validates, loads, builds the model and renders. No `dynamic`/`revalidate`/`runtime` exports `[C12]`.
- `app/memories/[id]/page.tsx`: `generateMetadata({ params })` awaits `connection()`, then `params`, then `getPublicMemory(id)` → `{ title: "A memory from <who> — Jo Wray", description: first 160 chars of the note, robots: { index: false, follow: false } }`, or a generic title when the memory is not public `[C9, C39]`; the content component repeats `connection()` → flag → `params` → `getPublicMemory` (deduplicated by React `cache`) `[C36]`, calls `notFound()` for a missing or non-public memory `[C10]`, sets `tagIds({ memoryId })` `[C18]`, and renders the figure, `<dl>` tiles `[C35]`, the player or the D16 status line `[C34]`, prev/next and nearby cards.
- `app/memories/_components/hrefs.ts`: `exploreHref(filters)`, `mapHref`, `timelineHref`, `tagsHref`, `memoryHref`, `publicMediaHref(id, "thumb" | "web")`, strings via `URLSearchParams`; every filter change resets `n` `[C2, C5]`.
- `_components/chips.ts`: the class strings under "Shared look" `[C27]`.
- `_components/view-nav.tsx`: four pills, `aria-current="page"`, default prefetch (D10), `scrollbar-none` row on phones `[C5, C31, C29]`.
- `_components/memory-card.tsx`: the card `<Link prefetch={false}>`; PHOTO → `patchwork-sm` frame with a `relative aspect-[4/3]` mount holding `<Image fill unoptimized loading="lazy" className="object-cover">` of the first photo's `v=thumb` and the "N photos" pill; VOICE → dashed box, play circle, `fakeBars`, duration; VIDEO → 16:9 dashed tile, badge-play, duration pill; TEXT → Fraunces quote `line-clamp-7`; others `line-clamp-3`; who, meta, up to two tag chips `[C5, C11, C43, C45, C30]`. `KindBadge` exported from the same file `[C27]`. A broken image falls back to the patchwork placeholder tile behind it (bucket 2): the mount carries the placeholder as background and a tiny `image-fallback-client.tsx` hides the `<img>` on `onError` `[C13]`.
- `_components/us-map.tsx`: `UsMap` and `HomeInset`: the `aspect-[1000/560]` (or 1:1 / 2:1) box, the outline `<svg aria-hidden="true">`, pins as absolutely positioned `<Link prefetch={false} aria-label aria-current>` with `style={{ left, top }}`, `SolidHeart size={pinSize}`, HTML label pills `[C5, C31]`.
- `_components/decade-bars.tsx`: `<Link prefetch={false}>` chart, `’50` labels below `sm` `[C5, C29]`.
- `_components/tag-quilt.tsx`: patches as `<Link prefetch={false}>` with inline `fontSize`/`transform` `[C5, C31]`.
- `_components/search-form-client.tsx` (client): `<Form action={pathname} scroll={false}>` from `next/form` `[C42]`; the current filters arrive as props and the component builds the URL itself (`q` from the input, `n` reset); the input is uncontrolled (`defaultValue`), never keyed on `q`, so focus and caret survive; on input, after 400 ms, `router.replace(href, { scroll: false })` `[C6]`; the timer is cancelled on submit, unmount and navigation; the field re-syncs from the URL only when it is not focused; no `useSearchParams` `[C7, C13]`.
- `_components/timeline-decades-client.tsx` (client): receives `{ key, header, body, count }[]` of server-rendered nodes; below `sm` one decade is open, chosen from `location.hash` on mount and on `hashchange` (jump links set the hash), else the decade with most memories; header buttons carry `aria-expanded`/`aria-controls`; from `sm` every body is visible; a `<noscript><style>` rule shows every body when JavaScript is off `[C13, C33, C46, C47, C29]`.
- `_components/map-zoom-client.tsx` (client): two `aria-pressed` buttons (`sm:hidden`) swapping the `home`/`us` slots `[C13, C32, C29]`.
- `_components/photo-figure-client.tsx` (client): the big photo (`v=web`, real width/height, `loading="eager"`) + thumbnail buttons `[C13, C11, C43]`; `_components/audio-player-client.tsx` (client): red Listen/Pause button driving a native `<audio controls preload="metadata">`, time readout from `timeupdate` `[C13, C34]`.
- `_components/bands.tsx`: `EmptyState`, `ShareBand`, `LoadMore` (`<Link scroll={false} prefetch={false}>`), `OpeningSoon` (the dark-flag note: "Jo's family is reading every memory first. See memories opens November 10.") `[C5, C27]`.

### Shared UI and configuration

- `app/_components/nav-link-client.tsx` (new, client): `NavLink({ href, children })` with `usePathname()`, `aria-current="page"` and the dashed red underline when active; exports `isActivePath` `[C8, C5, C31]`.
- `app/_components/site-header.tsx`: takes a `showMemories` prop and renders "See memories" first only when it is true, then the `NavLink`s `[C8]`. As built in L11 (this bullet updated in TCR round 1, B2-5; it first described an async `HeaderNav` inside Suspense): `app/layout.tsx` reads `getPublicMemoriesEnv().PUBLIC_MEMORIES_ENABLED` and passes it in, because `app/_components` may not read env and an awaited `connection()` in the header would make every page dynamic. Reading the flag when the layout prerenders at build time is enough, since a flag change is a redeploy anyway `[C48]`; `/`, `/share` and `/how-it-was-built` stay static. The pages and `/api/public-media` still read the flag per request after `connection()`.
- `app/globals.css`: `@utility scrollbar-none` and `@utility patchwork-sm` `[C28, C27]`.
- `next.config.ts`: a `headers()` entry `{ source: "/memories/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }` and one for `/api/public-media/:path*` (D19), pinned in `__tests__/next-config.test.ts` `[C44]`. `/memories` itself matches because `:path*` is zero or more segments, as the existing `/admin/:path*` rule notes.
- `app/_components/privacy-note-client.tsx`: one added sentence: "If you browse the memories, the same recording applies to you." (D20) `[C19]`.

### Copy sweep

`app/how-it-was-built/page.tsx` ("The family reads every memory before it appears on See memories."), `app/admin/status-actions-client.tsx` ("Approving shows the memory on See memories once its visibility is Everyone and the family has turned the pages on."), comments in `features/admin/set-status.ts` and `features/admin/share-draft.ts`, `lib/validations/admin.ts` and `app/api/mcp/tools.ts` descriptions, `docs/features/admin-panel.md`, `docs/features/mcp.md` (also: twelve tools now), `docs/features/draft-on-behalf.md`, `docs/skills/jowray-draft-memory/SKILL.md`, `design/DESIGN.md:248` `[C24, C38]`. Plans under `docs/plans/` stay frozen.

### Docs

- `design/DESIGN.md`: §9 drops "the memory wall, tag cloud, search"; new §5.12 "See memories" (view pills, chips, memory card, map: decorative SVG outline with HTML pins and labels, decade bars, quilt, the two phone client behaviours, the dark-flag note) `[C27, C29]`.
- `docs/features/see-memories.md` (new, from `docs/features/template.md`), a row in `docs/features/README.md`, one sentence in the root README features table; README roadmap items for gallery/timeline/tag cloud marked shipped (no Mermaid edits) `[C1, C24]`.
- `docs/plans/2026-11-08-see-memories.md`: this plan `[C3]`. `docs/environment.md`: the four new keys. `docs/2026-11-04-debt-catalog.md`: M-E-14 references `PUBLIC_MEMORY_WHERE` `[C24]`.

### Tests (Vitest, node environment) `[C17]`

TDD first on the critical paths:
- `__tests__/api/public-media.test.ts` (modelled on `__tests__/api/media.test.ts`): serves `v=thumb`/`v=web` for an APPROVED + PUBLIC photo without a token; 404 for PENDING, HIDDEN, FAMILY, PRIVATE, deleted memory, deleted or purged media, missing derived copy, flag off; 404 for a `video/quicktime` row with coordinates (the `location-mdta.mov` shape), for one with `gpsCheckedAt` null, and for `audio/mp4` without a scan; 302 for `no-location.mov` with `gpsCheckedAt` set and for `audio/webm`; `download=1` and `v=original` never stream the original; the `public:` scopes are charged and the claim scopes are not `[C14]`.
- `__tests__/api/media.test.ts`, `__tests__/api/admin-media.test.ts`: existing callers still pass with the widened `authorize` and the untouched budgets.
- `__tests__/features/public-memories.test.ts`: `findMany` is called with exactly `PUBLIC_MEMORY_WHERE`; the DTO never contains `email`, `claimTokenHash`, `blobUrl`, `storageKey` or unrounded coordinates; media filtered to READY + not purged + READY derivative; `playable` per the D16 table; `who` fallback `[C23, C24]`.
- `__tests__/features/claim.test.ts` and the ingest tests: an APPROVED memory edited through the claim link becomes PENDING with the revision naming `status`; a visibility-only edit does not; file remove, replace and add do (D17) `[C49]`.
- Pure modules: `memories-approx-year`, `memories-tags`, `memories-places`, `memories-playability`, `memories-explore`, `memories-timeline`, `memories-related`, `public-memories-validations`, `nav-link`. Extend `__tests__/features/admin-memories.test.ts` (tags/year writes, revision keys, month-without-year refusal), `__tests__/api/mcp.test.ts` (snapshot), `__tests__/next-config.test.ts` (the two header rules), `__tests__/server/media-serving-env.test.ts` (new keys and defaults).
- Real Postgres (`TEST_DATABASE_URL`): a new `__tests__/integration/public-memories.test.ts` that writes a memory with tags and reads it back through `listPublicMemories`, and asserts the migration's column.

## Who does what (Astra workers, Opus subagents, the orchestrator)

Quality over speed. The orchestrator (Opus 5.5, locally) owns the context, runs every step that needs network or git (`npm ci`, `prisma generate`, `prisma migrate dev` on local PG, Playwright, GitHub), writes the shared types first and inspects every worker result before accepting it. Astra workers (Codex CLI via `/astra-work`: no network, one owner per file, two at a time at most, never more without Rob's explicit reply) get pure, fully specified modules with their tests. Critical paths, shared code and anything that needs the artboards' visual judgment stay linear in the orchestrator. Opus subagents do reading-heavy side quests (artboard-to-spec extraction, screenshot comparison, review passes) and return short results so the orchestrator's context stays small.

| Step | Owner | Why |
|---|---|---|
| L0, L1 kickoff and design inputs | orchestrator | network, git, the artifact |
| L2 `lib/memories/types.ts` | orchestrator | the shared interface must settle first |
| L3 A1 `approx-year.ts`, A2 `tags.ts`, A3 `places.ts` (+ tests) | Astra, three briefs, two at a time | pure, independent, fully specified above |
| L4 schema, migration, admin/MCP plumbing | orchestrator | critical path, locking, local database |
| L5 A4 `explore.ts` + `timeline.ts` + `related.ts`, A5 `validations/public-memories.ts` (+ tests) | Astra, after L3 integrates | pure, depend on types and slugs |
| L6 env, `media-location.ts`, `serve-media.ts`, public route (+ tests) | orchestrator | privacy-critical, shared code |
| L7 claim re-review (+ tests) | orchestrator | critical path, locking |
| L8 `features/memories/public.ts` (+ tests) | orchestrator | the privacy guard |
| L9 components and pages at 1280 | orchestrator, with an Opus subagent producing a per-artboard spec (sizes, colours, copy) from `design/reference/see-memories/*.dc.html` | design matching needs judgment |
| L10 A6 client pieces | one Astra worker, after L9 | self-contained files; the contracts (#6, #21) are in the brief |
| L11 phone and XL passes, header, headers, privacy sentence | orchestrator | layout judgment, config |
| L12 A7 copy sweep (owned paths: the listed docs and the three code files), A8 feature doc + DESIGN.md §5.12 (from the merged code) | Astra, two briefs | mechanical, low risk |
| L13 verification and evidence | orchestrator | browser and network |
| L14 PR, `/team-code-review`, buckets, issues, repairs | orchestrator with Rob confirming buckets | the loop in orchestration.md |

Each Astra brief carries: the plan section it implements, the exact `types.ts`, the acceptance commands (`npm run validate`, `npx vitest run <file>`), the owned paths, and the house rules the worker cannot see (no `eslint-disable`, no band-aids, no network, TDD). After every integration the orchestrator reruns `npm run validate && npm run test:run` and writes the ledger row.

## Verification (L13; results recorded under `docs/plans/evidence/2026-11-08-see-memories/`)

- `npm run validate`, `TEST_DATABASE_URL=… npm run test:run` (the integration suites must run, not skip), `npm run build:offline` with no `.env*`: all green. The build log must still contain the Sentry tunnel line and no `blocking-prerender-*` error `[C4, C39]`.
- Local fixtures on the local PostgreSQL through the loopback-only `scripts/seed-sample-memories.ts` (refuses any host other than `localhost`, `127.0.0.1`, `::1`; no override flag): mixed media (a photo with READY derived copies, a voice note, `no-location.mov` with `gpsCheckedAt` set, `location-mdta.mov` with coordinates), tags, years, places and town-level coordinates `[C26]`.
- `next dev` with the flag off: `/memories` shows the opening note, `/api/public-media/<id>` is 404, the header has no link. Flag on: the five routes render; `/memories/<id>` of a FAMILY, PENDING or deleted memory shows the not-found UI with `<meta name="robots" content="noindex">` and no contributor name or words in body or title; `/api/public-media/<id>` of a non-public photo is 404 and of a public one 302s; the redirected bytes of a public `no-location.mov` run through `readVideoLocation` → absent; `location-mdta.mov` is never served. Response headers on `/memories` and `/api/public-media/*` carry `X-Robots-Tag: noindex, nofollow`.
- Playwright screenshots at 390×844, 1280×900 and 2400×1400 for the five routes (voice and photo memory variants) plus a11y trees, compared side by side with the committed artboard PNGs; the search check (type fast, click a chip mid-debounce, press Back); the phone timeline (`#d1980` opens the decade; with JavaScript off every decade shows).
- Sentry: an event from the memory page carries `memory_id`.
- Before pushing: `git diff --stat`, no `.env*`, no secrets, the migration folder sorts last.

## Launch gates and rollback

Gates, in order: the PR merges with the flag absent (dark); Rob reviews `list_memories(status: "APPROVED")`, sets anything that must not be public to FAMILY, and checks every memory's place field (the "Where" the pages show) for a street address, editing it to the town (`update_memory`, or the admin edit form) because place text is published as written (TCR round 1, B2-5) (inventory sign-off, L15); on or before 2026-11-10 Rob sets `PUBLIC_MEMORIES_ENABLED=true` in Vercel Production and redeploys, because a changed variable applies only to new deployments `[C48]`. Rollback: set the flag to `false` and redeploy; the pages show the opening note, the header link disappears and the media route answers 404; presigned URLs already handed out expire within 60 seconds; the additive `tags` column stays.

## Non-goals: what this PR deliberately does not do

These notes are copied into the PR description so later review cycles do not raise the same points again.

- **Pre-stream 404 for `/memories/<id>` (#3, #15).** We keep the documented behaviour for non-public memories: 200, `noindex` and the not-found UI; `/api/public-media` returns a real 404. A pre-stream 404 would move the database read above Suspense, defeating the static shell and breaking the `connection()` house rule. Revisit only if Rob's D11 ruling changes that rule.
- **Cursor pagination (#20).** We are not adding cursor-based paging to the index. `listPublicMemories()` already holds every public row in memory, and a cumulative `n` clamped to the total, with lazily loaded card images and no arbitrary cap, reaches every memory. Revisit only if `listPublicMemories()` stops loading every public row in one read.
- **Browser race-test matrix for the search box (#22).** We are not automating browser race tests. The #6 rules (uncontrolled input, debounce cancelled on submit, unmount and navigation, re-sync when unfocused) cover the real risks; one manual check, type fast, click a chip mid-debounce, press Back, is in verification. Revisit if that check finds a race the rules miss.
- **Keeping the last approved version public during re-review (#24).** A content edit through a claim link sends an APPROVED memory back to PENDING, so it leaves See memories until re-approved. Showing the old version needs a snapshot or version table; PENDING on edit is simpler and safe. Revisit only if a version table lands for another reason.
- **Recording Rob's explicit acceptance of location exposure (#1).** Not offered as an option. A public file carrying exact GPS is never acceptable, so the public media route refuses any original that could still carry location instead of asking anyone to accept the risk. Nothing changes this: D2's "never" now covers media.
- **Seeding Neon preview or production with invented memories (#14).** No Neon branch is ever seeded. The preview database is a branch of production and already holds real APPROVED + PUBLIC memories; invented names on a memorial are a reputational risk. Nothing changes this: the local seed script accepts only loopback hosts and has no `--allow-host` escape hatch.
- **The stripped `WEB_VIDEO`/`WEB_AUDIO` pipeline in this PR (#1).** Deferred, not rejected: the stripped derived copies are real and needed, but building them here would double this PR's size. Until they exist, iPhone videos with location will not play publicly; the public route plays only originals that are scanned clean or cannot carry location. Nothing changes this here; it is follow-up F1.

## Follow-ups: parking lot for after the merge

| Id | Item | Severity | Pick-up notes | From |
|---|---|---|---|---|
| F1 | Stripped `WEB_VIDEO`/`WEB_AUDIO` derived copies so location-bearing iPhone videos can play publicly | high: until it lands, iPhone videos with location do not play on the public pages | Approach decided: a remux-free rename of the `udta`/`meta` atoms to `free`, written by the cron like `WEB_IMAGE`. Involves `features/media/serve-media.ts` (the derived-copy branch is `image/` only today), `lib/video-gps.ts`, `lib/media-location.ts` (`hasLocationReader`) and the public rule this PR adds (VIDEO plays only when `gpsCheckedAt` is set, `gpsScanComplete` is true and both coordinates are null; the completeness flag is TCR round 1, B1-1). Accept when a `location-mdta.mov` or `location-xyz.mp4` row plays publicly and `readVideoLocation` over the redirected bytes reports absent. | #1, #10 |
| F2 | The "your memory is posted" email and `notifyWhenPosted`; the November 10 promise; issue #59 | high: `app/share/thank-you-client.tsx` already promises contributors an email update after November 10 | Cross-references decided: `Memory.notifyWhenPosted` (the opt-in), issue #59 (notify correspondents: harvest, paced send, `/s/` prefill) and the thank-you copy "we'll be sharing them with everyone and will email an update to all who have contributed". The launch date 2026-11-10 and that promise are the plan's constraint; flipping `PUBLIC_MEMORIES_ENABLED` is what makes memories visible. Acceptance: TBD; at minimum every contributor with `notifyWhenPosted` gets one email once their memory is on See memories. | #25 |
| F3 | Public-visitor telemetry policy and a fuller privacy note | medium: the Sentry ruling rests on "only family will be using it", which stops holding at launch | Rob, 2026-11-08: Sentry stays fully unmasked for public visitors (`instrumentation-client.ts`: `replaysSessionSampleRate: 1.0`, `maskAllText: false`, `maskAllInputs: false`, `blockAllMedia: false`, `networkCaptureBodies: true`, feedback widget on); this PR adds only one sentence for visitors to `app/_components/privacy-note-client.tsx`, which says "This is just for family and friends". Ready starting point, the plan's recommended default that was not taken: `replayIntegration` masking through `[data-replay-mask]` and `[data-replay-block]` attributes on the memories pages' `<main>` and media elements, `networkDetailDenyUrls` for `/api/public-media`, feedback prefill unchanged. Acceptance: TBD until the visitor policy is written; the policy lives in `lib/sentry/data-collection.ts`. | #2, #12 |
| F4 | Admin alert when a claim-link edit sends an APPROVED memory back to PENDING | medium: the memory leaves See memories on edit and nobody but the contributor is told | This PR makes a content change through a claim link set `status: "PENDING"` in the locked transaction in `features/memories/claim.ts` (`updateMemoryFromClaim`, `retireMedia`, `updateMediaFromClaim`, the replacement-READY transition) and names it in the CLAIM_LINK revision; changes to `visibility`, `notifyWhenPosted` or `contactOptIn` alone do not. Approach decided: reuse the admin-alert email path. Accept when that transition sends exactly one admin alert and `__tests__/features/claim.test.ts` covers it. | #24 |
| F5 | Public media allowance exhaustion: capacity reserved for claim viewers; fewer Blob API calls | medium: the public counters fail open, and `presignGet` still costs one Blob API call per request | This PR gives the `"public"` caller its own budgets (`MEDIA_PUBLIC_DAILY_EGRESS_BYTES` 20 GiB, `MEDIA_PUBLIC_FILE_DAILY_MULTIPLE` 100, `MEDIA_PUBLIC_VIEWER_DAILY_REQUESTS` 600, counter scopes prefixed `public:`), so strangers cannot exhaust the claim or admin budgets, and adds the broken-media fallback on cards (a placeholder tile behind each image and `image-fallback-client.tsx` hiding the `<img>` on error). Remaining here: capacity reserved for claim viewers beyond the separate budgets, and `integrations/vercel-blob/index.ts` `presignGet` calling `issueSignedToken` on every request. Accept when an exhausted public allowance shows placeholders, not broken images, and claim-link viewers are unaffected. | #13, #4 |
| F6 | Smaller card thumbnails (`CARD`, about 400 px) and video posters (`POSTER`) | medium: card bytes on phones are roughly five times what they need to be, against a 20 GiB daily public budget | Deferred from bucket 2 to keep this PR reviewable: a `CARD` derived JPEG of about 400 px beside `THUMBNAIL`, falling back to the 1000 px thumbnail (a new `DerivedKind` value, the sharp derive step and the cron's claim logic); `POSTER` for videos alongside. Cards keep `loading="lazy"` (the `next/image` default), and `sizes` does nothing on an `unoptimized` image (no `srcset`), so the saving comes only from a smaller derived copy. Accept when index cards load the `CARD` copy and fall back to `THUMBNAIL` when it is missing. | #4 |
| F7 | Indexing revisit and a sitemap after launch | low: deliberately deferred; nothing breaks while the section is noindex | Rob, 2026-11-08: launch with `X-Robots-Tag: noindex, nofollow` on `/memories/:path*` and `/api/public-media/:path*` (`next.config.ts` headers, pinned in `__tests__/next-config.test.ts`) plus `robots: { index: false, follow: false }` metadata. The revisit weighs contributor names appearing in Google and crawler load on filter URLs (the load behind #4); a sitemap goes with any lift. Acceptance: Rob's recorded ruling; lifting noindex changes the headers, the metadata and the pinned test together. | #26, #4 |
| F8 | Docs drift already on main: the MCP tool count | low: documentation only, no behaviour change | The MCP now has twelve tools (`request_upload` and `finalize_upload` were added) while `docs/features/mcp.md` and the README still say ten. Independent of this PR. Accept when both documents list twelve tools. | none (code check, 2026-11-08) |
| F9 | The rest of #7's approximate-date parser niceties | low: "Christmas 1959" already works via the 4-digit rule | This PR's parser accepts `'` and `’`, "the 1950s" (1950) and ranges like "1949–66" (1949), bounded 1900 to the current year, with `null` clearing and `undefined` leaving alone. Remaining: "early 1950s" and similar phrases; the full list and target years are TBD. Accept with a unit case per phrase. | #7 |
| F10 | Caching with `io()` and `"use cache"` | low: performance only; blocked on Rob's D11 ruling | Blocked on Rob's ruling on the `connection()` house rule (D11); until then the public pages stay fully dynamic behind `await connection()` inside Suspense. The plan's citations [C15], [C16], [C40] and [C41] are marked follow-up only and hold the `"use cache"`, `io()`, `cacheTag`/`updateTag` and `revalidateTag` notes. Acceptance: TBD with the ruling. | D11 |
| F11 | `Tag`/`MemoryTag` tables, AI tagging, people, transcripts | low: README Phase 2; this PR's `tags` already cover browsing by tag | This PR adds `tags` normalized by `normalizeTags` (grouped by slug, slugs hyphen-trimmed and capped at 80 characters, empty slugs refused, tests for `café`/`cafe` and `St. Mary's`/`St Marys`) with an integration test that round-trips them; `prisma/schema.prisma` on main has no tags yet. Relational tables, AI tagging, people and transcripts are README Phase 2. Approach and acceptance: TBD per feature. | README Phase 2 |
| F12 | FAMILY-visibility access without a login | low: Phase 3 auth; no launch dependency | Public means APPROVED + PUBLIC (D1); FAMILY memories are not on See memories, and Rob sets anything that should not be public to FAMILY before `PUBLIC_MEMORIES_ENABLED` flips (MCP `list_memories` with `status: "APPROVED"` shows each row's `visibility`). Both entry paths (`app/share/share-form.tsx`, `app/admin/draft-form.tsx`) default to PUBLIC, so FAMILY is an explicit choice. Approach and acceptance: TBD. | none (Phase 3) |

These rows are copied into the PR description's parking lot so reviewers see them.

## Sources checked but not citable

- **EmpathIQ docs** (`https://empathiq.dev/82c8632048c0074f8614c3c8/docs/`): 308 → 404, and the space redirects to a sign-in page; nothing is quoted. The repo's `docs/code-layout.md` ("Adapted from the EmpathIQ conventions") is the citable statement of those rules and this plan follows it.
- **Auth.js migrating-to-v5**: fetched (opens with "The Auth.js project is now part of Better Auth."); not applicable, the repo has no Auth.js and `/admin` uses an HMAC cookie.
- **BAML**: fetched ("This is auto-generated code with all boilerplate to call the LLM endpoint, parse the output, fix broken JSON, and handle errors."); not applicable, no LLM step in this PR.

## Citations

Pages fetched live on 2026-11-07 and 2026-11-08; each quote is copied from the page as rendered and was re-checked against a saved copy. Freshness flags: Next.js now prefers `io()` over `connection()` under Cache Components (kept `connection()` per the house rule, D11); Prisma's docs default to ORM 8, so every Prisma citation is a `/orm/v7/` page matching this repo's Prisma 7; Sentry's `withSentryConfig` import and tunnel handler already match this repo; MDN element URLs moved under `/Web/HTML/Reference/Elements/`; `next/image` `priority` is deprecated in 16 and `sizes` does nothing on an `unoptimized` image.

### [C1] — `connection()`: request-time rendering behind a Suspense boundary

- **Relevant File(s):** `app/memories/page.tsx`, `app/memories/map/page.tsx`, `app/memories/timeline/page.tsx`, `app/memories/tags/page.tsx`, `app/memories/[id]/page.tsx`, `app/_components/site-header.tsx`, `docs/features/see-memories.md`
- **Change Summary:** Every dynamic content component (and the header's flag-aware nav) awaits `connection()` first, inside `<Suspense>`, before reading env, `searchParams` or Prisma.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/connection#good-to-know
- **Verbatim Quote:**
  > "With Cache Components, place the component that calls `connection()` inside a `<Suspense>` boundary, either directly or through an ancestor such as a `loading.js` file. The nearest boundary's fallback is prerendered into the static shell, and the code after `connection()` runs at request time. Without a boundary, navigations to the route block instead of being instant."
- **Justification:** The pages keep the hero and view nav in the static shell and put `connection()`, the flag read and data access in a Suspense-wrapped child, which is the placement the docs prescribe and the pattern `app/admin/page.tsx` already uses. (The same section adds "Reach for `connection()` only when rendering should wait for a real user request."; D11 keeps `connection()` because the Neon driver's connect must never run in a prefetch prerender, per AGENTS.md.)

### [C2] — `searchParams` is a Promise and a request-time API

- **Relevant File(s):** `app/memories/page.tsx`, `app/memories/map/page.tsx`, `app/memories/timeline/page.tsx`, `app/memories/tags/page.tsx`, `lib/validations/public-memories.ts`, `lib/memories/explore.ts`, `app/memories/_components/hrefs.ts`
- **Change Summary:** Pages type their props with `PageProps<"/memories">`, `await searchParams` inside the dynamic hole, and pass plain string values to the validator and href builder.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/page#searchparams-optional
- **Verbatim Quote:**
  > "`searchParams` is a Request-time API whose values cannot be known ahead of time. Using it will opt the page into dynamic rendering at request time."
  > "You can type pages with `PageProps` to get strongly typed `params` and `searchParams` from the route literal. `PageProps` is a globally available helper."
- **Justification:** Filters live in the URL, so reading them is request-time work that belongs after `connection()` in the Suspense hole; the values arrive as `string | string[] | undefined`, which is why `firstParam()` and the zod schema exist. (Second sentence from `#page-props-helper` on the same page.)

### [C3] — Cache Components: static shell plus streamed dynamic content

- **Relevant File(s):** `app/memories/page.tsx` (and the sibling pages), `docs/plans/2026-11-08-see-memories.md`
- **Change Summary:** The hero copy, view nav and footer are static; results, counts and cards stream in.
- **Source URL:** https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents (introduction, before "Usage")
- **Verbatim Quote:**
  > "Data fetching is dynamic by default, and you choose what to cache at the page, component, or function level. Next.js prerenders a static HTML shell that is served immediately while dynamic content streams in when ready, letting you mix static and dynamic content within a single route."
- **Justification:** This is the rendering model the repo enables in `next.config.ts` (`cacheComponents: true`, `partialPrefetching: true`); the new pages are a prerendered shell with one dynamic region each.

### [C4] — Uncached data must sit inside an explicit Suspense boundary

- **Relevant File(s):** `app/memories/page.tsx`, `app/memories/map/page.tsx`, `app/memories/timeline/page.tsx`, `app/memories/tags/page.tsx`, `app/memories/[id]/page.tsx`
- **Change Summary:** One `<Suspense fallback>` per page around only the data-dependent part, no `loading.tsx`.
- **Source URL:** https://nextjs.org/docs/messages/blocking-prerender-dynamic#wrap-in-or-move-into-suspense
- **Verbatim Quote:**
  > "Choose this fix when the data must be fresh on every request. A `<Suspense>` boundary lets the static shell ship instantly while the dynamic region streams in once the data resolves."
  > "If page-level content could be prerendered (a static intro, a known title), use explicit `<Suspense>` boundaries inside `page.js` around only the dynamic parts."
- **Justification:** Each page has a static intro and a known title, so the docs' own recommendation is explicit boundaries inside `page.tsx` rather than a segment-wide `loading.tsx`; the build check in Verification looks for this error class.

### [C5] — `<Link>`: scroll and prefetch behaviour for filter chips

- **Relevant File(s):** `app/memories/_components/view-nav.tsx`, `memory-card.tsx`, `us-map.tsx`, `decade-bars.tsx`, `tag-quilt.tsx`, `bands.tsx`, `hrefs.ts`, `app/_components/nav-link-client.tsx`
- **Change Summary:** Chips, pins, patches, cards and "Show more" are `<Link prefetch={false}>`; links that only change the query add `scroll={false}`; the four view pills and the header links keep the default prefetch.
- **Source URL:** https://nextjs.org/docs/app/api-reference/components/link#prefetch
- **Verbatim Quote:**
  > "Prefetching happens when a `<Link />` component enters the user's viewport (initially or through scroll)."
  > "- `false`: Prefetching will never happen both on entering the viewport and on hover."
  > "When `scroll = {false}`, Next.js will not attempt to scroll to the first Page element."
- **Justification:** A page with dozens of chip links would prefetch dozens of query variants as they scroll into view; `prefetch={false}` keeps that to the five route links, and `scroll={false}` keeps the visitor's place when a filter or "Show more" re-renders the same page. (Third sentence from `#scroll` on the same page.)

### [C6] — `useRouter().replace(href, { scroll: false })` for the live search box

- **Relevant File(s):** `app/memories/_components/search-form-client.tsx`
- **Change Summary:** Typing debounces into `router.replace` with `scroll: false`; Enter submits the GET form.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/use-router#disabling-scroll-to-top
- **Verbatim Quote:**
  > "By default, Next.js will scroll to the top of the page when navigating to a new route. You can disable this behavior by passing `scroll: false` to `router.push()` or `router.replace()`."
  > "`router.replace(href: string, { scroll: boolean, transitionTypes: string[] })`: Perform a client-side navigation to the provided route without adding a new entry into the browser’s history stack."
- **Justification:** Each keystroke should refine the list in place without a history entry per character and without jumping to the top, which is exactly `replace` + `scroll: false`. (Second sentence from `#userouter` on the same page.)

### [C7] — Prefer the page's `searchParams` prop over `useSearchParams`

- **Relevant File(s):** `app/memories/_components/search-form-client.tsx`
- **Change Summary:** The client form receives the current filters as props from the server page and never calls `useSearchParams`.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/use-search-params#behavior
- **Verbatim Quote:**
  > "During production builds, a static page that calls `useSearchParams` from a Client Component must be wrapped in a `Suspense` boundary, otherwise the build fails with the Missing Suspense boundary with useSearchParams error."
  > "If you're already in a Server Component Page, consider using the `searchParams` prop and passing the values to Client Components."
- **Justification:** Passing the filters down avoids a second Suspense boundary and the build failure mode the docs describe, while keeping the page's own `searchParams` read as the single source of truth.

### [C8] — `usePathname` for the active header link, with its Cache Components caveat

- **Relevant File(s):** `app/_components/nav-link-client.tsx`, `app/_components/site-header.tsx`
- **Change Summary:** A client `NavLink` marks "See memories" current; the header wraps the nav in `<Suspense>` with plain links as the fallback.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/use-pathname#cache-components
- **Verbatim Quote:**
  > "`usePathname` is a **Client Component** hook that lets you read the current URL's **pathname**."
  > "This applies even when the component that calls `usePathname` is itself static. For example, a sidebar with active links rendered in a layout suspends on any page below it that has an unknown dynamic param. To keep the rest of the layout prerendered, wrap the component that calls `usePathname` (or a parent) in a `Suspense` boundary with a fallback."
- **Justification:** The header is rendered by the root layout above `/memories/[id]`, `/m/[claimToken]` and `/admin/memories/[id]`, all dynamic params without `generateStaticParams`, so the Suspense wrapper is required for the build to pass and the fallback must look like the nav.

### [C9] — Metadata: static objects for the index pages, `generateMetadata` for the memory page, `robots`

- **Relevant File(s):** `app/memories/page.tsx`, `app/memories/map/page.tsx`, `app/memories/timeline/page.tsx`, `app/memories/tags/page.tsx`, `app/memories/[id]/page.tsx`
- **Change Summary:** Four pages export `metadata` titles with `robots: { index: false, follow: false }`; the memory page's `generateMetadata` reads `params` and the database, which is allowed because the page body also defers.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/generate-metadata#with-cache-components
- **Verbatim Quote:**
  > "When Cache Components is enabled, `generateMetadata` follows the same rules as other components. If metadata accesses runtime data (`cookies()`, `headers()`, `params`, `searchParams`) or performs uncached data fetching, it defers to request time."
  > "**If other parts also defer to request time**: Prerendering generates a static shell, and metadata streams in with other deferred content."
  > "To define static metadata, export a `Metadata` object from a `layout.js` or `page.js` file."
- **Justification:** The memory page's content component already defers, so a request-time `generateMetadata` is the documented, error-free case; the index pages have fixed titles and take the static form; `robots` is the same field `app/admin/layout.tsx` already uses. (Third sentence from `#the-metadata-object` on the same page.)

### [C10] — `notFound()` for memories that are not public

- **Relevant File(s):** `app/memories/[id]/page.tsx`
- **Change Summary:** A missing, deleted, non-APPROVED or non-PUBLIC memory renders the not-found UI with a noindex meta tag.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/not-found (reference section, before "Good to know")
- **Verbatim Quote:**
  > "Invoking `notFound()` throws a `NEXT_HTTP_ERROR_FALLBACK;404` error and terminates rendering of the route segment where it was thrown. Next.js also injects a `<meta name="robots" content="noindex" />` tag so the page is not indexed."
  > "`notFound()` can be invoked in Server Components, Server Functions, and Route Handlers."
  > "The response starts streaming from the `<Suspense>` boundary before `notFound()` runs, so it keeps its `200` status. Next.js adds a `noindex` tag."
- **Justification:** The public guard returns null for anything outside D1 and the page calls `notFound()` in the render path, as `/m/[claimToken]` does; because the shell has already streamed, the status is 200 and verification checks the noindex tag and the absence of private content instead (D13). (Third sentence from `#calling-notfound-after-streaming-has-started` on the same page.)

### [C11] — `next/image` `unoptimized` for media served through our own route

- **Relevant File(s):** `app/memories/_components/memory-card.tsx`, `app/memories/_components/photo-figure-client.tsx`
- **Change Summary:** Photos render with `<Image unoptimized>` pointing at `/api/public-media/<id>?v=thumb|web`, which redirects to a short-lived blob URL.
- **Source URL:** https://nextjs.org/docs/app/api-reference/components/image#unoptimized
- **Verbatim Quote:**
  > "A boolean that indicates if the image should skip the Image Optimization API to be served as-is."
  > "`true`: The source image will be served as-is from the `src` instead of changing quality, size, or format."
- **Justification:** The derived copies are already sized and come through an authorising redirect, so the optimizer would add a cache of bytes it must not hold; this matches the repo's existing comments in `app/admin/media-gallery.tsx` and `media-list-client.tsx`. No `remotePatterns` entry is needed because the `src` is same-origin and unoptimized.

### [C12] — Route segment config under Cache Components

- **Relevant File(s):** `app/memories/**/page.tsx`, `app/api/public-media/[id]/route.ts`
- **Change Summary:** No `dynamic`, `revalidate`, `fetchCache` or `runtime` exports; the media route exports only `maxDuration`.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#version-history
- **Verbatim Quote (the `v16.0.0` row of the version history):**
  > "`dynamic`, `dynamicParams`, `revalidate`, and `fetchCache` removed when Cache Components is enabled."
- **Justification:** The house rule in AGENTS.md mirrors this removal; `maxDuration` remains in the options table ("Set by deployment platform") and is what the sibling media routes export.

### [C13] — Server/Client boundary: serializable props and server-rendered slots

- **Relevant File(s):** `app/memories/_components/search-form-client.tsx`, `timeline-decades-client.tsx`, `map-zoom-client.tsx`, `photo-figure-client.tsx`, `audio-player-client.tsx`, `image-fallback-client.tsx`, `app/admin/memory-edit-form.tsx`, `app/m/[claimToken]/claim-form.tsx`, `lib/memories/types.ts`
- **Change Summary:** The few interactive pieces are `"use client"` files that receive plain data or already-rendered server nodes as props.
- **Source URL:** https://nextjs.org/docs/app/getting-started/server-and-client-components#passing-data-from-server-to-client-components
- **Verbatim Quote:**
  > "Props passed to Client Components need to be serializable by React."
  > "It does not apply to Server Components passed as children or other props. Those components are not imported into the Client Component’s module graph. They are rendered on the server and passed to the Client Component as rendered output."
- **Justification:** The accordion and zoom toggle wrap server-rendered card lists (slots), and the forms and players receive strings and numbers only, so no Prisma type or function ever crosses the boundary; the DTOs are designed to be serializable for the same reason. (Second sentence from `#using-client-components` on the same page.)

### [C14] — Route Handler signature: `NextRequest` and `RouteContext` with a `params` Promise

- **Relevant File(s):** `app/api/public-media/[id]/route.ts`, `__tests__/api/public-media.test.ts`
- **Change Summary:** `GET(request: NextRequest, ctx: RouteContext<"/api/public-media/[id]">)` reads `request.nextUrl` first and `await ctx.params` second.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/route#route-context-helper
- **Verbatim Quote:**
  > "You can type the Route Handler context using `RouteContext` to get strongly typed `params` from a route literal. `RouteContext` is a globally available helper."
  > "**`params`**: a promise that resolves to an object containing the dynamic route parameters for the current route."
- **Justification:** Same shape as `app/api/media/[id]/route.ts`; the test calls `GET(req, { params: Promise.resolve({ id }) })` as the existing media test does. (Second sentence from `#context-optional` on the same page.)

### [C15] — `"use cache"` constraints (follow-up only)

- **Relevant File(s):** none in this PR (`features/memories/public.ts` in follow-up F10)
- **Change Summary:** Records why the approved list is not cached yet and what a cached version must respect.
- **Source URL:** https://nextjs.org/docs/app/api-reference/directives/use-cache#request-time-apis
- **Verbatim Quote:**
  > "Cached functions and components **cannot** access runtime APIs like `cookies()`, `headers()`, or `searchParams`, and the restriction follows the call stack: a helper the cached function calls that reads one of these fails the same way, with the `next-request-in-use-cache` error."
- **Justification:** A cached `listPublicMemories()` would have to take the filters as arguments and never touch `searchParams`; that restructuring, plus the `connection()` ruling, is why caching is deferred.

### [C16] — `io()` versus `connection()` (follow-up only)

- **Relevant File(s):** none in this PR (follow-up F10)
- **Change Summary:** Names the API the docs now prefer so Rob can rule on replacing the house rule.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/io#how-io-differs-from-connection
- **Verbatim Quote:**
  > "Calling `connection()` inside a cache scope throws an error. Outside a cache scope, the two behave the same: the code after either one is excluded from every prerender, whether the prerender runs at build time or for a prefetch. Prefer `io()` over `connection()`, and reach for `connection()` only when you need to wait for a real user request."
- **Justification:** Switching would let the list live in a `"use cache"` scope; it contradicts the AGENTS.md rule, so it is a follow-up with an explicit decision, not a silent change.

### [C17] — Vitest unit tests in `__tests__/`

- **Relevant File(s):** `__tests__/api/public-media.test.ts`, `__tests__/features/public-memories.test.ts`, `__tests__/features/claim.test.ts`, `__tests__/lib/memories-*.test.ts`, `__tests__/lib/public-memories-validations.test.ts`, `__tests__/app/nav-link.test.ts`, `__tests__/features/admin-memories.test.ts`, `__tests__/api/mcp.test.ts`, `__tests__/next-config.test.ts`, `__tests__/server/media-serving-env.test.ts`, `__tests__/integration/public-memories.test.ts`
- **Change Summary:** Pure modules, the feature guard, the claim transition and the route are unit-tested with Vitest; the pages are verified end to end in the browser.
- **Source URL:** https://nextjs.org/docs/app/guides/testing/vitest#creating-your-first-vitest-unit-test
- **Verbatim Quote:**
  > "Since `async` Server Components are new to the React ecosystem, Vitest currently does not support them. While you can still run **unit tests** for synchronous Server and Client Components, we recommend using **E2E tests** for `async` components."
  > "The example above uses the common `__tests__` convention, but test files can also be colocated inside the `app` router."
- **Justification:** The async page components are covered by the Playwright evidence run; everything with logic is pulled into `lib/memories/*` and tested directly, which is also the repo's convention (`vitest.config.ts` includes `__tests__/**/*.test.ts`, node environment).

### [C18] — Sentry tags on the memory page

- **Relevant File(s):** `app/memories/[id]/page.tsx`
- **Change Summary:** Calls the existing `tagIds({ memoryId })` so errors from the memory page carry `memory_id`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/enriching-events/tags/
- **Verbatim Quote:**
  > "**Tags** are key/value string pairs that are both indexed and searchable."
  > "_Tag keys_ have a maximum length of 200 characters and can contain only letters (`a-zA-Z`), numbers (`0-9`), underscores (`_`), periods (`.`), colons (`:`), and dashes (`-`)."
  > "Tags still apply to errors, and in transaction mode (`traceLifecycle: "static"`) they're still added to the transaction."
- **Justification:** `memory_id` is the repo's agreed tag key (`lib/sentry/user.ts`), within the key rules; the third sentence records that tags reach error events, which is what the page needs.

### [C19] — What the Sentry Next.js SDK captures without extra code

- **Relevant File(s):** `app/memories/**/page.tsx`, `app/api/public-media/[id]/route.ts`, `app/_components/privacy-note-client.tsx`, `docs/features/see-memories.md`
- **Change Summary:** No new Sentry wiring beyond the tag; the privacy note's added sentence describes what the unchanged SDK records for visitors (D20).
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/capturing-errors/#whats-captured-automatically
- **Verbatim Quote:**
  > "Sentry's Next.js SDK automatically captures most unhandled errors. However, Next.js has built-in error handling patterns that intercept errors before they reach Sentry."
  > "- **Server errors** that crash (API routes, Server Components)"
  > "**The pattern is the same everywhere:** if you `catch` and don't `throw`, call `captureException`."
- **Justification:** The new code throws rather than swallows (the `notFound()` path is a framework interrupt), so the existing `onRequestError = Sentry.captureRequestError` export covers the pages and route; the privacy note states plainly that visitors are recorded the same way. (Third sentence from `#caught-errors` on the same page.)

### [C20] — Prisma 7 data model: scalar lists and optional fields

- **Relevant File(s):** `prisma/schema.prisma`, `lib/memories/tags.ts`, `lib/memories/approx-year.ts`, `lib/memories/places.ts`, `lib/memories/playability.ts`, `lib/memories/timeline.ts`, `lib/memories/related.ts`, `lib/media-location.ts`, `features/admin/update-memory.ts`, `features/memories/public.ts`
- **Change Summary:** `tags String[] @default([])` is a PostgreSQL scalar list; `approxYear Int?`, `approxMonth Int?`, `latitude Float?`, `longitude Float?`, `gpsCheckedAt DateTime?` are optional, so every pure module (and the D16 playability rule) handles `null` explicitly.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/models#lists
- **Verbatim Quote:**
  > "Scalar lists are only supported if the database connector supports them natively or at a Prisma ORM level."
  > "**Lists**: `[5, 6, 8]` (`Int[]`), `["Hello", "Goodbye"]` (`String[]`)"
  > "Fields without `?` are required:"
- **Justification:** PostgreSQL supports arrays natively, `@default([])` is the documented list default form, and the `?` fields are why year parsing, place grouping, the playability gate and the related-memory scoring all take `number | null` or `Date | null`. (Second and third sentences from `#defining-a-default-value` and `#optional-and-mandatory-fields` on the same page.)

### [C21] — Generating the migration without a database: `prisma migrate diff`

- **Relevant File(s):** `prisma/migrations/<timestamp>_memory_tags/migration.sql`
- **Change Summary:** When no PostgreSQL is at hand, the SQL is produced by diffing the base commit's schema against the edited schema.
- **Source URL:** https://www.prisma.io/docs/orm/v7/reference/prisma-cli-reference#migrate-diff
- **Verbatim Quote:**
  > "This command compares two database schema sources and outputs a description of a migration taking the first to the state of the second."
  > "**Prisma v7 breaking change**: The `--from-url`, `--to-url`, `--from-schema-datasource`, `--to-schema-datasource`, and `--shadow-database-url` options have been removed. Use `--from-config-datasource` and `--to-config-datasource` instead, which read the database URL from `prisma.config.ts`."
  > "| `--script` | No | Outputs a SQL script instead of the default human-readable summary | Not supported in MongoDB |"
- **Justification:** `--from-schema`/`--to-schema` compare two schema files with no connection; the base schema comes from `git show <base>:prisma/schema.prisma`, so the diff is reproducible after the change is committed (#23). The v7 flag rename is why the command does not use the older `--from-schema-datamodel` names.

### [C22] — Applying migrations: `migrate dev` in development, `migrate deploy` in CI and production

- **Relevant File(s):** `prisma/migrations/<timestamp>_memory_tags/migration.sql`, `docs/features/see-memories.md`
- **Change Summary:** The migration is created with `migrate dev` on the local PostgreSQL and applied by `prisma migrate deploy` in `.github/workflows/ci.yml` and `vercel.json`, never by hand against production.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production#production-and-testing-environments
- **Verbatim Quote:**
  > "In production and testing environments, use the `migrate deploy` command to apply migrations:"
  > "`migrate deploy` should generally be part of an automated CI/CD pipeline, and we do not recommend running this command locally to deploy changes to a production database."
  > "`migrate dev` is a development command and should never be used in a production environment."
- **Justification:** Confirms the repo's existing pipeline is the right place for the new migration and that the plan must not run `migrate dev` or `db push` anywhere shared. (Third sentence from `#create-and-apply-migrations` on the same page.)

### [C23] — Prisma 7 `select`/`include`: return only what the public page needs

- **Relevant File(s):** `features/memories/public.ts`, `features/media/serve-media.ts`, `features/admin/get-memory.ts`, `lib/memories/types.ts`, `__tests__/features/public-memories.test.ts`
- **Change Summary:** The public queries `select` an explicit field list and nest `select` on `contributor`, `media` and `derivatives`; `serveMedia` adds `visibility` and the GPS decision fields to its selects.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/queries/select-fields#return-the-default-fields
- **Verbatim Quote:**
  > "By default, Prisma Client returns all scalar fields for a model and no relations. Use `select` and `include` to make the result smaller, clearer, and more intentional."
  > "If you do not pass `select`, `include`, or `omit`, Prisma Client returns all scalar fields for the model and excludes relations from the result."
- **Justification:** An explicit `select` is the mechanism that keeps private columns out of the public DTO by construction, and the unit test asserts the exact `select` passed to the stub.

### [C24] — Prisma 7 filtering with `where`: the public guard

- **Relevant File(s):** `features/memories/public.ts`, `features/admin/update-memory.ts`, `features/memories/claim.ts`, `docs/2026-11-04-debt-catalog.md`, `README.md`, `docs/features/*.md`, `app/how-it-was-built/page.tsx`, `app/admin/status-actions-client.tsx`, `features/admin/set-status.ts`, `features/admin/share-draft.ts`
- **Change Summary:** `PUBLIC_MEMORY_WHERE = { status: "APPROVED", visibility: "PUBLIC", deletedAt: null }` is the one rule every public reader and every piece of copy now describes.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/queries/filtering-and-sorting#filtering-with-where
- **Verbatim Quote:**
  > "Prisma Client lets you narrow results with `where` and order them with `orderBy`."
  > "You can compose filters with operators such as `OR`, `AND`, and `NOT`:"
- **Justification:** The three equality conditions in one `where` object are an implicit AND; stating them together (and naming M-E-14 in the comment) is how DRAFT, PENDING, HIDDEN, FAMILY, PRIVATE and deleted rows are excluded explicitly, which is also what the swept copy must now say. (Second sentence from `#combining-operators` on the same page.)

### [C25] — Prisma 7 `orderBy` with several fields

- **Relevant File(s):** `features/memories/public.ts`
- **Change Summary:** `orderBy: [{ createdAt: "desc" }, { id: "desc" }]` gives a stable newest-first base order before the in-memory year sort.
- **Source URL:** https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference#sort-user-by-multiple-fields---email-and-role
- **Verbatim Quote:**
  > "The following example sorts users by two fields - first `email`, then `role`:"
  > "Sorts a list of records. See also: Sorting"
- **Justification:** The array form is the documented way to add a tiebreaker; `id` as the second key makes "Show N more" deterministic when two memories share a `createdAt`. (Second sentence from `#orderby` on the same page.)

### [C26] — Prisma 7 `createMany` for the loopback-only sample-data script

- **Relevant File(s):** `scripts/seed-sample-memories.ts`
- **Change Summary:** A development-only script inserts clearly invented mixed-media memories into the local PostgreSQL (loopback hosts only) so the pages can be checked visually.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/queries/crud#create-multiple-records
- **Verbatim Quote:**
  > "```
  > const createMany = await prisma.user.createMany({
  >   data: [
  >     { name: "Bob", email: "bob@prisma.io" },
  >     { name: "Yewande", email: "yewande@prisma.io" },
  >   ],
  >   skipDuplicates: true, // Skip records with duplicate unique fields
  > });
  > // Returns: { count: 2 }
  > ```"
- **Justification:** One `createMany` per table keeps the script short; the loopback-only host check (#14) is the plan's own guard and has no override.

### [C27] — Tailwind v4 `@theme` tokens become the utilities the components use

- **Relevant File(s):** `app/memories/_components/chips.ts`, `bands.tsx`, `memory-card.tsx`, `app/memories/_components/*.tsx`, `app/admin/memory-detail.tsx`, `app/globals.css`, `design/DESIGN.md`
- **Change Summary:** All colours, radii, shadows, text sizes and tap heights come from the existing `@theme` block, no new hex values in components.
- **Source URL:** https://tailwindcss.com/docs/theme#what-are-theme-variables
- **Verbatim Quote:**
  > "Theme variables are special CSS variables defined using the `@theme` directive that influence which utility classes exist in your project."
  > "Use `@theme` when you want a design token to map directly to a utility class, and use `:root` for defining regular CSS variables that shouldn't have corresponding utility classes."
- **Justification:** The design's hex values are exactly the tokens already declared in `app/globals.css`, so every class string in `chips.ts` maps to a token utility; DESIGN.md §5.12 documents the mapping. (Second sentence from `#why-theme-instead-of-root` on the same page.)

### [C28] — Tailwind v4 `@utility` for the two new helpers

- **Relevant File(s):** `app/globals.css`
- **Change Summary:** Adds `scrollbar-none` and `patchwork-sm` next to the existing `patchwork` utility.
- **Source URL:** https://tailwindcss.com/docs/adding-custom-styles#simple-utilities
- **Verbatim Quote:**
  > "Use the `@utility` directive to add a custom utility to your project:"
  > "Custom utilities are automatically inserted into the `utilities` layer along with all of the built-in utilities in the framework."
- **Justification:** The repo already defines `patchwork` with `@utility`; the same directive keeps the two additions in the utilities layer so variants like `sm:` and `hover:` work on them.

### [C29] — Tailwind v4 breakpoints: mobile-first with `sm` at 40rem

- **Relevant File(s):** `app/memories/_components/view-nav.tsx`, `decade-bars.tsx`, `us-map.tsx`, `timeline-decades-client.tsx`, `map-zoom-client.tsx`, `app/memories/page.tsx` (XL grid), `design/DESIGN.md`
- **Change Summary:** Phone behaviour is the unprefixed default, `sm:` restores the desktop boards, and the three-pane grid uses the arbitrary `min-[120rem]` variant.
- **Source URL:** https://tailwindcss.com/docs/responsive-design#working-mobile-first
- **Verbatim Quote:**
  > "Tailwind uses a mobile-first breakpoint system, similar to what you might be used to in other frameworks like Bootstrap."
  > "What this means is that unprefixed utilities (like `uppercase`) take effect on all screen sizes, while prefixed utilities (like `md:uppercase`) only take effect at the specified breakpoint _and above_."
  > "| `sm` | 40rem _(640px)_ | `@media (width >= 40rem) { ... }` |"
- **Justification:** The design's phone boards are 390px and its desktop boards 1280px, so the accordion, zoom control and scrolling rows are the defaults and `sm:` (640px, the site's existing `text-display-sm sm:text-display` split) switches to the expanded layouts. (Third line from `#overview` on the same page.)

### [C30] — Tailwind v4 `line-clamp-*` for note excerpts

- **Relevant File(s):** `app/memories/_components/memory-card.tsx`
- **Change Summary:** Text cards clamp the Fraunces quote to 7 lines (6 on phones and XL), other cards clamp the note to 3 lines, "Close to this one" to 4.
- **Source URL:** https://tailwindcss.com/docs/line-clamp#basic-example
- **Verbatim Quote:**
  > "Use `line-clamp-<number>` utilities like `line-clamp-2` and `line-clamp-3` to truncate multi-line text after a specific number of lines:"
- **Justification:** The design's `-webkit-line-clamp` inline styles map one to one onto these utilities, so no custom CSS is needed.

### [C31] — `aria-current="page"` on the active pill, nav link and selected pin

- **Relevant File(s):** `app/memories/_components/view-nav.tsx`, `us-map.tsx`, `tag-quilt.tsx`, `app/_components/nav-link-client.tsx`, `app/memories/map/page.tsx`
- **Change Summary:** The active view pill and header link carry `aria-current="page"`; the selected place or patch link carries `aria-current="true"`.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-current#page
- **Verbatim Quote:**
  > "Represents the current page within a set of pages such as the link to the current document in a breadcrumb."
  > "Only mark one element in a set of elements as current with `aria-current`."
- **Justification:** The design marks exactly one pill per nav and one selected place or patch per view; since the chips are links, `aria-current` is the correct state attribute rather than `aria-pressed`. (Second sentence from `#description` on the same page.)

### [C32] — `aria-pressed` on the phone map's segmented control

- **Relevant File(s):** `app/memories/_components/map-zoom-client.tsx`
- **Change Summary:** "Close to home" and "Whole country" are real `<button type="button">`s with `aria-pressed`.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-pressed#description
- **Verbatim Quote:**
  > "The `aria-pressed` attribute is only relevant for toggle buttons. It represents the button's current \"pressed\" state."
  > "Do not change the contents of the label on a toggle when the state changes."
- **Justification:** This is the one control in the design that toggles view state rather than navigating, so it is a toggle button, and its labels stay fixed while the pressed state flips.

### [C33] — `aria-expanded`/`aria-controls` on the phone timeline accordion

- **Relevant File(s):** `app/memories/_components/timeline-decades-client.tsx`
- **Change Summary:** Each decade header button sets `aria-expanded` and `aria-controls` to its body's id.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-expanded#buttons
- **Verbatim Quote:**
  > "A button that toggles a widget should have `aria-controls` set to the `id` of the toggled widget and `aria-expanded` set to the current state of the widget."
  > "When the widget is visible, the controlling object relays that information via having `aria-expanded=\"true\"` set on it."
- **Justification:** The design's phone timeline already uses this attribute pair on its decade buttons; the component reproduces it with real buttons.

### [C34] — `<audio>`/`<video>` `preload="metadata"`: nothing plays until pressed

- **Relevant File(s):** `app/memories/[id]/page.tsx`, `app/memories/_components/audio-player-client.tsx`, `lib/memories/format.ts`
- **Change Summary:** Media elements appear only on the memory page with `controls` and `preload="metadata"`; cards show no media element.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/audio#preload
- **Verbatim Quote:**
  > "- `metadata`: Indicates that only audio metadata (e.g., length) is fetched."
  > "- The browser is not forced by the specification to follow the value of this attribute; it is a mere hint."
- **Justification:** The design's "Nothing plays until you press it." and the public egress budget both argue for fetching only metadata until the visitor presses Listen; the hint caveat is why the duration text comes from `Media.durationSeconds` rather than the element.

### [C35] — `<dl>` for the When/Where tiles

- **Relevant File(s):** `app/memories/[id]/page.tsx`
- **Change Summary:** The two metadata tiles are a description list, as drawn.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dl
- **Verbatim Quote:**
  > "Common uses for this element are to implement a glossary or to display metadata (a list of key-value pairs)."
- **Justification:** "When" and "Where" with their values are key-value metadata, so the element the design already uses is also the semantically right one.

### [C36] — React `cache()` to share one memory load between `generateMetadata` and the page

- **Relevant File(s):** `features/memories/public.ts`, `app/memories/[id]/page.tsx`
- **Change Summary:** `listPublicMemories` and `getPublicMemory` are exported as `cache(...)`-wrapped functions from one module.
- **Source URL:** https://react.dev/reference/react/cache#take-and-share-snapshot-of-data
- **Verbatim Quote:**
  > "To share a snapshot of data between components, call `cache` with a data-fetching function like `fetch`. When multiple components make the same data fetch, only one request is made and the data returned is cached and shared across components."
  > "React will invalidate the cache for all memoized functions for each server request."
- **Justification:** `generateMetadata` and the page body both need the same memory in the same request; one memoized function in one module means one Prisma query per request and no cross-request caching, which keeps D11 intact. (Second sentence from `#caveats` on the same page.)

### [C37] — Zod 4 for query strings, env and tags: coercion, enums, optionals

- **Relevant File(s):** `lib/validations/public-memories.ts`, `lib/validations/admin.ts`, `lib/memories/tags.ts`, `lib/memories/explore.ts`, `app/admin/memory-edit-form.tsx`, `server/config/env.ts`
- **Change Summary:** `n` and `decade` arrive as strings and are coerced; `kind` is `z.enum([...])`; every filter is `.optional()`; tags are an array schema with a `transform` to `normalizeTags`; the new env keys follow the file's `blankIsUnset(z.coerce.number()…)` and `strictBoolean` patterns.
- **Source URL:** https://zod.dev/api#coercion
- **Verbatim Quote:**
  > "To coerce input data to the appropriate type, use `z.coerce` instead:"
  > "Use `z.enum` to validate inputs against a fixed set of allowable _string_ values."
  > "To make a schema _optional_ (that is, to allow `undefined` inputs)."
- **Justification:** Query-string and environment values are strings, so `z.coerce.number().int()` is the documented route to the page size, decade and byte limits; `z.enum` pins `kind` to the four `MemoryType` values. (Second and third sentences from `#enums` and `#optionals` on the same page.)

### [C38] — Zod `.describe()` text is the MCP tool documentation

- **Relevant File(s):** `lib/validations/admin.ts`, `app/api/mcp/tools.ts`, `__tests__/api/mcp.test.ts`
- **Change Summary:** The schema descriptions that say "APPROVED publishes nothing public yet" are reworded and the new `tags`/`approxYear` keys get descriptions, because they surface in the MCP tools/list output that the snapshot test pins.
- **Source URL:** https://zod.dev/metadata#describe
- **Verbatim Quote:**
  > "The `.describe()` method is a shorthand for registering a schema in `z.globalRegistry` with just a `description` field."
  > "The `.describe()` method remains available, but `.meta()` is the recommended approach."
- **Justification:** The repo uses `.describe()` throughout its admin/MCP schemas; the plan keeps that convention and updates the snapshot test because the description text is part of the published schema.

### [C39] — Metadata that reads the database is fine when the page body is already dynamic

- **Relevant File(s):** `app/memories/[id]/page.tsx`
- **Change Summary:** Confirms no `DynamicMarker` or `"use cache"` is needed for the memory page's `generateMetadata`.
- **Source URL:** https://nextjs.org/docs/messages/blocking-prerender-metadata-dynamic#gotchas-1
- **Verbatim Quote:**
  > "If the page already has a genuinely dynamic component (one that reads `cookies()` or uncached data inside a `<Suspense>` boundary), you won't see this error. The page is already partially dynamic."
  > "During prerendering, `generateMetadata()` performed an uncached data access (`fetch()`, database call, `await connection()`). With Cache Components enabled, Next.js expects metadata to be prerenderable when the rest of the route is."
- **Justification:** The memory page's content component reads Prisma inside Suspense, so its `generateMetadata` may read `params` and Prisma too; the plan still awaits `connection()` first in `generateMetadata` (listed by the page as an uncached access it may perform) so the Neon connect never runs inside a prefetch prerender.

### [C40] — `cacheTag` and `updateTag` (follow-up only)

- **Relevant File(s):** none in this PR (follow-up F10)
- **Change Summary:** Records how the cached public list would be tagged and refreshed from the admin Server Functions.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/cacheTag#good-to-know
- **Verbatim Quote:**
  > "The `cacheTag` function takes one or more string values."
  > "Use `updateTag` for read-your-own-writes scenarios, such as forms and other user-triggered mutations, where a user makes a change and the next read should fetch fresh data immediately. `updateTag` is only available inside Server Functions."
- **Justification:** Approving or re-tagging a memory from the admin page is a user-triggered mutation whose next read should be fresh, so `updateTag("public-memories")` is the documented fit once caching lands.

### [C41] — `revalidateTag` from the MCP route handler (follow-up only)

- **Relevant File(s):** none in this PR (follow-up F10)
- **Change Summary:** The MCP handler is a Route Handler, so it would use `revalidateTag`, not `updateTag`.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/revalidateTag
- **Verbatim Quote:**
  > "`revalidateTag` can be called in Server Functions and Route Handlers."
  > "**`profile=\"max\"` (recommended)**: A one year window, long enough that requests are always served stale content while the revalidation runs."
- **Justification:** `set_status`/`update_memory` run inside `app/api/mcp/route.ts`, where only `revalidateTag` is available; the recommended `max` profile matches a family site where a few seconds of staleness is fine.

### [C42] — `next/form` for the GET search form

- **Relevant File(s):** `app/memories/_components/search-form-client.tsx`
- **Change Summary:** The search box is a `<Form action="/memories" scroll={false}>` whose submit encodes `q` and the hidden filters into the URL and navigates client-side; the typing enhancement sits on top.
- **Source URL:** https://nextjs.org/docs/app/api-reference/components/form#reference
- **Verbatim Quote:**
  > "- When `action` is a **string**, the `<Form>` behaves like a native HTML form that uses a **`GET`** method. The form data is encoded into the URL as search params, and when the form is submitted, it navigates to the specified URL. In addition, Next.js:"
  > "When the user updates the query input field and submits the form, the form data will be encoded into the URL as search params, e.g. `/search?query=abc`."
  > "- **[`method`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form#method), [`encType`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form#enctype), [`target`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form#target)**: Are not supported as they override `<Form>` behavior."
- **Justification:** This is the framework's documented way to drive `searchParams` from a form with progressive enhancement, so the search works with JavaScript off (plain GET) and as a client-side navigation with it; no `method="get"` attribute is written because `<Form>` is GET by construction. (Second and third sentences from `#search-form-that-leads-to-a-search-result-page` and `#caveats` on the same page.)

### [C43] — `next/image` `fill` and eager loading on the memory page

- **Relevant File(s):** `app/memories/_components/memory-card.tsx`, `app/memories/_components/photo-figure-client.tsx`
- **Change Summary:** Card thumbnails use `fill` inside a `relative aspect-[4/3]` mount; the memory page's main photo passes the derived copy's width/height and `loading="eager"`. No `sizes` prop: it has no effect on an `unoptimized` image, which generates no `srcset` (#4).
- **Source URL:** https://nextjs.org/docs/app/api-reference/components/image#fill
- **Verbatim Quote:**
  > "A boolean that causes the image to expand to the size of the parent element."
  > "- The parent element **must** assign `position: "relative"`, `"fixed"`, `"absolute"`."
  > "In most cases, you should use `loading="eager"` or `fetchPriority="high"` instead of `preload`."
- **Justification:** The card mount is the positioned parent the docs require, and the main photo uses `loading="eager"` because `priority` is deprecated in Next.js 16 ("Starting with Next.js 16, the `priority` property has been deprecated in favor of the `preload` property"). (Third sentence from `#preload` on the same page.)

### [C44] — `headers()` in `next.config.ts` for `X-Robots-Tag` on the public section

- **Relevant File(s):** `next.config.ts`, `__tests__/next-config.test.ts`
- **Change Summary:** Two header rules, `/memories/:path*` and `/api/public-media/:path*`, each setting `X-Robots-Tag: noindex, nofollow` (D19), pinned by the existing config test.
- **Source URL:** https://nextjs.org/docs/app/api-reference/config/next-config-js/headers#wildcard-path-matching
- **Verbatim Quote:**
  > "`headers` can be defined as a synchronous or async function. It should return, or resolve to, an array of objects with `source` and `headers` properties:"
  > "To match a wildcard path you can use `*` after a parameter, for example `/blog/:slug*` will match `/blog/a/b/c/d/hello-world`:"
  > "If two headers match the same path and set the same header key, the last header key will override the first."
- **Justification:** The repo's `/admin/:path*` rule is the precedent (its comment notes `:path*` also matches the bare path); the two new rules use the same wildcard form, and the override rule says why they are placed after the site-wide `Document-Policy` rule rather than inside it. (First sentence from the page's reference section, third from `#header-overriding-behavior`.)

### [C45] — `next/image` `loading="lazy"` keeps a long card list cheap

- **Relevant File(s):** `app/memories/_components/memory-card.tsx`, `lib/memories/explore.ts`
- **Change Summary:** Card thumbnails keep the default lazy loading and the `n` cap is removed, so a long "Show more" page fetches only the thumbnails that scroll into view (#4, #20).
- **Source URL:** https://nextjs.org/docs/app/api-reference/components/image#loading
- **Verbatim Quote:**
  > "- `lazy`: Defer loading the image until it reaches a calculated distance from the viewport."
  > "Use `eager` only when you want to ensure the image is loaded immediately."
- **Justification:** Lazy loading is what makes an uncapped cumulative list acceptable for the public media budget: requests follow scrolling, not `n`; only the memory page's main photo is eager.

### [C46] — The `hashchange` event drives the phone timeline accordion

- **Relevant File(s):** `app/memories/_components/timeline-decades-client.tsx`
- **Change Summary:** The open decade follows `location.hash` on mount and on `hashchange`, so the decade jump links (`#d1980`) open the collapsed decade on phones (#21).
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/Window/hashchange_event
- **Verbatim Quote:**
  > "The hashchange event is fired when the fragment identifier of the URL has changed (the part of the URL beginning with and following the # symbol)."
- **Justification:** The jump links are plain anchors to in-page ids, so listening for the fragment change is the smallest way to make them also expand the target decade without turning them into buttons.

### [C47] — `<noscript>` shows every decade when JavaScript is off

- **Relevant File(s):** `app/memories/_components/timeline-decades-client.tsx`
- **Change Summary:** A `<noscript><style>` rule overrides the collapsed state so the full timeline is readable without JavaScript (#21).
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/noscript
- **Verbatim Quote:**
  > "The <noscript> HTML element defines a section of HTML to be inserted if a script type on the page is unsupported or if scripting is currently turned off in the browser."
- **Justification:** The server renders every decade body with a collapsed class; the `<noscript>` style is the documented hook for the no-script case, so the content is never unreachable.

### [C48] — Vercel environment variables apply to new deployments only

- **Relevant File(s):** `server/config/env.ts`, `docs/environment.md`, `docs/plans/2026-11-08-see-memories.md` (launch gates and rollback)
- **Change Summary:** The launch flag and the public media budgets are environment variables; turning the pages on or off is a flag change followed by a redeploy (D15).
- **Source URL:** https://vercel.com/docs/environment-variables (introduction, above "Creating environment variables")
- **Verbatim Quote:**
  > "Any change you make to environment variables are not applied to previous deployments, they only apply to new deployments."
- **Justification:** The launch gate and the rollback both say "set the flag and redeploy" because a bare variable change does nothing to the running deployment.

### [C49] — Prisma 7 interactive transactions for the claim-link re-review

- **Relevant File(s):** `features/memories/claim.ts`, `features/memories/ingest-upload.ts`, `__tests__/features/claim.test.ts`
- **Change Summary:** The status flip to PENDING is written inside the same `$transaction(async (tx) => …)` that already holds the memory lock, the re-read and the revision (D17).
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions#interactive-transactions
- **Verbatim Quote:**
  > "For complex logic between queries, use interactive transactions:"
- **Justification:** `updateMemoryFromClaim` already runs as an interactive transaction with `lockMemory` and a re-read under the lock; adding the status write to that callback keeps the edit, the status and the revision atomic, which is the property the test asserts.