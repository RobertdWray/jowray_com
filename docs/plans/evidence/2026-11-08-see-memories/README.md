# See memories: verification evidence (plan L13, 2026-11-08)

Plan: [`docs/plans/2026-11-08-see-memories.md`](../../2026-11-08-see-memories.md), section "Verification". Branch `see-memories`, checked at `c15d03e` (pages, components, the search-field fix) on 2026-11-08.

## How the browser checks were run

- **Data.** Invented only: `scripts/seed-sample-memories.ts` loaded the canvas seed (`design/reference/see-memories/data/memories.js`, "Every contributor and memory below is invented") into a fresh local PostgreSQL 18 database (`127.0.0.1:54329`, database `jowray_seemem_dev`) under its own memorial: 100 memories (83 APPROVED + PUBLIC, the rest FAMILY or PENDING, five undated), 80 files. The script refuses any host but loopback; no Neon branch was touched (non-goal N6).
- **Server.** `next dev` from a throwaway worktree at the same commit, never committed, with one difference: `server/db/client.ts` used `@prisma/adapter-pg` instead of `@prisma/adapter-neon`, because the Neon serverless driver cannot reach a plain local PostgreSQL and Docker (for Neon's WebSocket proxy) was not running. Environment: only `DATABASE_URL` (local), `PUBLIC_MEMORIES_ENABLED`, `PLACES_PROVIDER=off`; no `.env*` file, no secrets. `BLOB_READ_WRITE_TOKEN` was absent on purpose, so `/api/public-media` answered 500 for public files (the Blob client could not be built) and the pages fell back to their placeholder tiles; the 302 path is proven by `__tests__/api/public-media.test.ts`.
- **Browser.** `playwright-core` driving the installed Google Chrome, headless, at 390×844, 1280×900 and 2400×1400; full-page screenshots, console errors, horizontal overflow, `robots` meta and `X-Robots-Tag`.

## Results

> **Later change (PR #94, 2026-11-08):** Rob amended D16, so a public MOV with a location now answers 302 to its original instead of 404, and there is no stripped video copy (F1 closed). The rows below are the results recorded at `c15d03e`; re-running them gives 302 on the "scan found a location" row.

| Check | Result |
|---|---|
| `npm run validate` | pass (exit 0) at every ledger row; last at `c15d03e` |
| `npm run test:run` with `TEST_DATABASE_URL` (real-Postgres suites run, none skipped) | pass: 111 files, 2622 tests at the L7 commit; one earlier run failed in `__tests__/integration/extract-photo-gps.test.ts` ("video no-location.mov"); first recorded here as a timing flake, it was the parallel integration files deadlocking against the budget suite's `TRUNCATE` (found by the TCR round 1 regression review). Since `35bb0c8` the real-Postgres files run one at a time (`vitest.config.ts` project `integration`), five consecutive full runs were green, and the merged head passed 132 files, 3319 tests |
| `npm run build:offline`, no `.env*`, no database variables | pass (exit 0); no `blocking-prerender-*` error; `/`, `/how-it-was-built`, `/share` stay fully static (○); `/memories`, `/memories/map`, `/memories/tags`, `/memories/[id]` are partial prerenders (◐). The offline build prints no Sentry tunnel line, on this branch and on the base (L0), so that line cannot be checked offline |
| Flag off: `/memories`, `/memories/map`, `/memories/timeline`, `/memories/tags`, `/memories/<public id>` | each 200 with "See memories opens November 10." and no memory content |
| Flag off: `/api/public-media/<public browser-recorded file>` | 404 |
| Flag off: header | no `href="/memories"` on `/` |
| Flag on: the five routes at 1280 and 390, Explore at 2400 | 200, no horizontal overflow, no console error other than the Blob-less media 500s; titles "See memories — Jo Wray", "Memories by place — Jo Wray", "Memories by year — Jo Wray", "What she loved — Jo Wray", "A memory from <name> — Jo Wray" |
| Flag on: `/memories/<FAMILY id>`, `/memories/<PENDING id>`, `/memories/not-a-uuid`, `/memories/<unknown uuid>` | each the not-found UI with `<meta name="robots" content="noindex">`, status 200 (D13: the shell has streamed); the contributor's name and words of the FAMILY and PENDING memories appear nowhere in the response |
| Flag on: `/api/public-media/<file of a FAMILY memory>` | 404 |
| Flag on: `/api/public-media/<public MOV whose scan found a location>` | 404 (D16) |
| `X-Robots-Tag` | `noindex, nofollow` on `/memories` and on `/api/public-media/*` (with `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff` on the media route) |
| Search box (finding #6): type "bus" | URL becomes `?q=bus` after the pause; the field keeps focus and its text |
| Search box: type more, press a chip before the 400 ms pause | the chip wins (`?kind=VOICE&q=bus`); the half-typed search is never sent |
| Search box: Back | **found a bug, fixed in `c15d03e`**: before the fix the URL said `?q=bus` while the field still showed the unsent "buses" (the field re-synced only when `q` changed); after the fix the field shows "bus" |
| Search box: Enter on `?tag=quilting&n=24` | `?q=calico&tag=quilting`: filters kept, `n` reset |
| Phone timeline accordion | one decade open: the fullest (2020s, 13) by default; `#d1980` opens the 1980s; pressing the 1990s header opens it and sets `aria-expanded` true on it and false on the 1980s; at 1280 all nine bodies show |
| Phone timeline with JavaScript off | **not as planned**: the page stays on "Loading…", because streamed Suspense content is put in place by an inline script. The same is true of every dynamic page on the site (`/admin` checked). The `<noscript>` rule works only for content already in the document. Recorded as a known gap |
| Sentry: an event from the memory page carries `memory_id` | NOT RUN: no Sentry DSN in the local run; the page calls `tagIds({ memoryId })` (`app/memories/[id]/page.tsx`) |
| Real Blob files (302 to a stripped copy; `readVideoLocation` over the redirected bytes of a public `no-location.mov`) | NOT RUN locally (no Blob token); covered by the route tests and to be checked on a preview with real files |

## Screenshots (invented sample data; the "N" circle is the Next.js dev indicator)

| File | What |
|---|---|
| `explore-1280.jpg` | Explore at 1280 (compare `design/reference/see-memories/Main.png`) |
| `map-1280.jpg` | Map at 1280 with the "Closer to home" inset beside the US map (`Map.png`; the board's floating inset covered pins and the caption) |
| `timeline-1280-top.jpg` | The first 3600 px of the timeline at 1280 (the whole page is about 30,800 px with 83 memories) |
| `tags-1280.jpg` | The quilt and the first patch's memories (`Tags.png`) |
| `photo-1280.jpg` | A photo memory (`Memory.png`); the photo areas are empty because no Blob token was set |
| `voice-1280.jpg`, `voice-390.jpg` | A browser-recorded voice memory with the player (`Phone-Memory.png`) |
| `m4a-390.jpg` | An M4A not scanned yet: "This recording will play once the family's copy is ready." (D16) |
| `videolocated-1280.jpg` | A MOV whose scan found a location: "This video will play once the family's copy is ready." (D16) |
| `explore-390-top.jpg`, `timeline-390-top.jpg`, `map-390.jpg` | Phone boards |
| `explore-2400-scaled.jpg` | The three-pane Explore at 2400, scaled to 1600 wide (`Main-XL.png`) |

## Differences from the boards (agent calls, for Rob's review)

- The "Closer to home" inset sits beside the map from 1024px, not over it (SPEC §8, defect 1).
- Phone Explore has no map section, as the Phone · explore board draws; places are one tap away under "By place".
- The phone header keeps the site header (plan), not the board's logo-and-button header.
- The XL Explore is an approximation: extra space under the search box, and the decade bars are columns, not the board's horizontal rows.
- The Tags page note says the family sews the patches on; the board's note implied automatic tagging, which D3 rules out.
- Eras: the timeline uses the 1280 board's per-decade lines (2000s: "The teaching years, then retirement"); Explore keeps its own five-range line. Both verbatim for Rob to confirm (D14).
