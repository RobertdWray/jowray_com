# Video posters: one server-made frame for every video (cards, memory page, admin gallery, admin alert)

**Status:** executed on 2026-11-08 on branch `feat/video-posters` as one PR, [#99](https://github.com/RobertdWray/jowray_com/pull/99) (open as a draft; not merged). Tasks 1–14 are committed, with Task 9 (docs) run last by ruling R15. `ci` and the Vercel preview passed on `03c42e8`: 144 of 144 test files, check-traces OK on Linux. Team Code Review round 1 ran on `03c42e8`; its Bucket 1 and 2 fixes followed in the same PR ([Execution ledger](#execution-ledger), "Team Code Review round 1"). Written 2026-11-08 from `origin/main` at `c837789` (PR #94 merge); the branch is based on `6113021` (PR #96 merge). This file is the session plan copied into the repo unchanged, apart from this line, the [Ledger](#ledger), FU-7 to FU-9 under [Non-goals and follow-ups](#non-goals-and-follow-ups), and two sections added before the Citations: [Execution rulings](#execution-rulings) (verbatim from the execution ledger) and [Execution ledger](#execution-ledger) (commits and outcome per task). The feature doc is [`docs/features/video-posters.md`](../features/video-posters.md).

This plan is safe to hand off: paths are absolute or repo-relative, every step has a done-check, and the [Ledger](#ledger) is the progress record. Update the ledger after every step, and record deviations as "Ruling: what — why — cost if wrong".

---

## Context

**What Rob saw.** On https://www.jowray.com/memories/timeline, video memories show a dashed wood box with a red play badge and no picture. Photo cards show their photo.

**Root cause (verified 2026-11-08; not a regression).** No code path ever makes a picture for a video.

| Evidence | Where (origin/main) |
|---|---|
| The video card draws only `<PlayBadge>` on a wood fill and never asks for an image. | `app/memories/_components/memory-card.tsx:98-106` (`VideoSlot`) |
| `DerivedKind.POSTER` was *reserved* in PR #25, and nothing writes a POSTER row. | `prisma/schema.prisma:53`; `features/memories/derive-media.ts:17` (`DERIVED_KINDS = ["WEB_IMAGE","THUMBNAIL"]`); `:148` (gate `mimeType.startsWith("image/")`) |
| The poster flow was deferred twice: R3 (browser capture, then M-B-01) and see-memories F6. | `docs/plans/phase1-ledger.md:34`; `docs/2026-11-04-debt-catalog.md:286-294`; `docs/features/see-memories.md:133` |
| `PublicMemory` carries no video media id, so a card has nothing to build a URL from. | `features/memories/public.ts:93-119`; `lib/memories/types.ts:56-80` |
| **Latent hazard:** a video's `?v=thumb` answers **302 to the original video**, and the counters are charged its full size. An `<img>` pointed at today's URL would download the video. | `features/media/serve-media.ts:155-168, 203-204` |
| The memory page `<video>` has no `poster` and uses `preload="none"`, so it shows an empty walnut box until play. | `app/memories/_components/video-player.tsx:16-19` |
| The admin alert attaches no picture of any kind (`preview: null` always). The template is already ready for previews, admin audience only (issue #46). | `features/memories/media-summary.ts:38`; `services/email/templates/shared.ts:127-170` |

**Live data (2026-11-08).**
- The timeline HTML has 43 cards; 6 are video placeholders with no `<img>`.
- All 6 videos are iPhone `.MOV`, HEVC (`hvc1`), SDR (`colr` transfer 1).
- The `moov` index sits **after** the `mdat` (20 MB for 16 s).
- All 6 were added through MCP `request_upload`/`finalize_upload`; no browser was involved.
- Media ids: `272f2b81-ef68-4bb8-9777-50e8dae29fb3`, `df8c812e-24a9-44bf-92d0-f68791813759`, `0cc545c0-a216-43cb-a3b3-c8af919822e5`, `20e88737-9bf7-4817-9eac-dea529b01dad`, `153fd779-5f9f-4ae2-97df-f2d4113c98af`, `59232ff8-60da-40df-86f3-734c951e0708`.
- `GET /api/public-media/272f2b81-…?v=thumb` → `302` to `originals/…/….mov`.

**Intended outcome.** Every READY video gets one server-made JPEG frame, stored as a `DerivedMedia` row of kind `POSTER` at the THUMBNAIL spec. It shows on:
1. every memory card (Explore, Map, Timeline, Tags);
2. the memory page player (`poster` attribute);
3. the admin media gallery;
4. the admin "new memory" alert.

The cron backfills the six live videos.

---

## Rulings

| # | Ruling | Who / when | Notes |
|---|---|---|---|
| R-P1 | Posters are made **server-side with ffmpeg** (`ffmpeg-static`). This **supersedes R3** ("Video posters are captured in the browser at upload time" `[C38]`). | Rob, 2026-11-08 (AskUserQuestion: "Server ffmpeg (Recommended)") | R3 predates the MCP attach path. Every live video came through MCP, where no browser exists. |
| R-P2 | Scope: cards **plus** the memory page player, the admin media gallery and emails. | Rob, 2026-11-08 (multi-select: "Memory page player", "Admin media gallery", "Emails") | "Emails" means the **admin alert only**. Contributor receipts carry no uploaded picture by ruling `[C34]`, and this plan keeps that. |
| R-P3 | Claim-page posters (`app/m/[claimToken]/media-list-client.tsx:280`) are out of scope: not offered, not chosen. | — | Follow-up FU-1. |

**Proposed decisions** (agent calls; Rob may overrule any before execution starts):

| # | Decision | Why | Cost if wrong |
|---|---|---|---|
| D1 | The ffmpeg binary is traced into **only** `/api/upload`, `/api/mcp` and `/api/cron/reconcile-uploads`. Contributor pages (`/share`, `/s/[inviteToken]`, `/m/[claimToken]`) never run ffmpeg. Browser uploads get their poster from the upload-completed callback, which already derives whenever the file is READY `[C37]`. MCP uploads get theirs from `/api/mcp`, and cron step (g2) is the backstop. | The binary is about 80 MB uncompressed `[C5]`. Keeping it out of the pages families upload from protects their cold starts and the 250 MB limit `[C1, C2]`. | A video uploaded while the callback cannot reach the deployment (for example a protected preview) waits up to 10 min for the cron. |
| D2 | ffmpeg reads the original through a **one-shot loopback HTTP server** on `127.0.0.1:0` that serves Range requests from `storage.readRange` in lazy 1 MiB windows, capped at 64 MiB per poster. It never receives a Blob URL. | The static Linux build cannot resolve DNS `[C5]`. Loopback needs no DNS, keeps signed URLs out of ffmpeg's arguments and stderr, and reads only what ffmpeg asks for: the moov plus the first keyframe, not the whole 20–500 MB file `[C19, C20]`. | More moving parts than a temp-file download; T5's real-binary tests are the gate. |
| D3 | The frame is the keyframe at or before 1 s (`-ss 1 -noaccurate_seek`), or at 0 when the clip yields nothing at 1 s `[C7]`. | Decodes one frame, so CPU and memory stay small. | Some posters show the opening frame. Rob can ask for a different moment later. |
| D4 | POSTER is a clean frame at the THUMBNAIL spec (≤1000 px long edge, mozjpeg q72, ≤350 KB, on #fffdf8), re-encoded by sharp, which strips metadata `[C21]`. **No play badge baked in.** The web overlays its own badge; email cards already say "Video". | One copy serves cards, the player, the gallery and the email; GPS and other metadata never leave in the JPEG. | A dedicated ~400 px `CARD` copy remains follow-up F6. |
| D5 | HDR (HLG or PQ, read from the `colr` box) is tone-mapped with `zscale` + `tonemap` `[C14]`. SDR is left untouched. | iPhones record HLG by default; an untone-mapped HLG frame looks grey. The six live videos are SDR. | A poorly tuned operator darkens HDR posters. The real-binary HLG test bounds this. |
| D6 | Publishing a POSTER never writes the `Media` row (no width/height fill). | `Media.updatedAt` feeds `reviewVersion`, so a backfill would make MCP approvals go `stale` `[C36]`. | None known. |
| D7 | `?v=thumb` on a video serves its READY POSTER, or **404**, never the original `[C26]`. `v=web` and downloads are unchanged. | Closes the latent hazard in Context. | A client that relied on `v=thumb` for playback breaks. None exist. |
| D8 | Admin-alert previews include **photo THUMBNAILs as well as video POSTERs**: the same loader, the template's existing cap of 4. | Rob chose "Emails" for posters. The template already renders photo previews, and leaving photos as badges beside video frames would look broken. This also closes email Task 4. | Rob may want videos only; then it is a one-line filter. |
| D9 | `ffmpeg-static` is pinned to exactly `5.3.0` `[C4]` and approved in `allowScripts` as a pinned entry `[C6]`. | npm 12 skips unapproved install scripts silently `[C6]`. An unpinned upgrade can change the ffmpeg major `[C4]`. | None. |
| D10 | Licensing: the GPLv3 binary is not committed. It runs server-side as a separate program over a pipe and loopback socket `[C31]`. The license text is traced next to it and documented in `docs/dependencies.md`. | The repo is public; the obligations and our position are written down. | If Rob's counsel disagrees, swap to an LGPL build (FU-5). |

---

## Design overview

```
upload callback (/api/upload) ─┐
MCP finalize   (/api/mcp)  ────┼─► derivePoster(mediaId, deadline)            features/memories/derive-poster.ts
cron step (g2) (/api/cron) ────┘     ├─ gate: READY video/*, live, our prefix, binary available, budget ≥ 6 s
                                     ├─ sniff readPrefix(128) → mov | matroska; mov → readVideoTrackInfo (pixels, HDR)
                                     ├─ claim POSTER row (shared claim helpers, derived-claims.ts)
                                     ├─ services/video-frames → integrations/video-frames
                                     │     loopback 127.0.0.1:0 /__frames/<nonce>  ◄─ ffmpeg -f mov -i http://127.0.0.1:P/…
                                     │     (Range → storage.readRange 1 MiB windows)   -ss 1 -noaccurate_seek -frames:v 1 → PNG on stdout
                                     ├─ image slot.thumbnail(PNG) → JPEG ≤1000 px ≤350 KB
                                     └─ storage.put + publish under lockMemory (no Media write)
serve-media: video + v=thumb → POSTER (302) | 404 ─► cards (FallbackImage), <video poster>, admin gallery
admin alert: poll ≤15 s for READY THUMBNAIL/POSTER → inline cid previews (admin audience only)
```

---

## Execution setup

- **Worktree, never the main checkout:**
  `git -C /Users/rob/Documents/active_work/jowray_com worktree add ../jowray_wt_video_posters -b feat/video-posters origin/main`
  Then from `/Users/rob/Documents/active_work/jowray_wt_video_posters`: `export PATH=/opt/homebrew/bin:$PATH` (Node 26) and `npm ci`.
- **Single PR (Rob, 2026-11-08: "Let's keep this in one pr please.")** All tasks land on `feat/video-posters`. The PR-1/PR-2/PR-3 headings below are now task groups, not separate PRs. After Task 14: push, open one PR, then Rob's 7-step review flow.
- **Former PR stack (superseded):**

  | PR | Branch | Base |
  |---|---|---|
  | PR-1 | `feat/video-posters` | `main` |
  | PR-2 | `feat/video-posters-ui` | `feat/video-posters` |
  | PR-3 | `feat/admin-alert-previews` | `feat/video-posters-ui` |

  Merge in order, each after `ci` passes (main ruleset).
- **TDD for each task:** write the named tests first, see them fail, implement, see them pass `[C33]`.
- **Checks before every push:**
  - `npm run validate`
  - `npm run test:run`
  - the real-Postgres suites on local PG 18 (port 54329, `TEST_DATABASE_URL`)
  - `npm run build:offline`

---

## PR-1 `feat/video-posters`: pipeline and serving

### Task 1 (T1) Dependency, install-script approval and tracing
- **`package.json`, `package-lock.json`:**
  - `npm install --save-exact ffmpeg-static@5.3.0` `[C4]`.
  - `npm approve-scripts ffmpeg-static` writes the pinned `allowScripts` entry `[C6]`.
  - The `build` script becomes `prisma generate && next build && tsx scripts/check-traces.ts` `[C33]`.
- **`next.config.ts`:**
  - Add `"ffmpeg-static"` to `serverExternalPackages`. Its `index.js` resolves the binary from `__dirname`, so it must not be bundled `[C3]`.
  - Add `outputFileTracingIncludes` keys `"/api/upload"`, `"/api/mcp"` and `"/api/cron/reconcile-uploads"`, each mapped to `["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffmpeg-static/ffmpeg.LICENSE", "./node_modules/ffmpeg-static/ffmpeg.README"]` `[C2]`.
  - Keep the existing `"/**"` HEIC entry. No other key (D1).
- **`scripts/check-traces.ts` (new):** after `next build`, read every `.next/server/app/**/{route,page}.js.nft.json` and fail when any of these holds `[C1, C2]`:
  - (a) one of the three routes lacks `node_modules/ffmpeg-static/ffmpeg`;
  - (b) any page function has it;
  - (c) any function's traced files total more than 220 MB.

  Record the real nft paths in the ledger the first time it runs.
- **Tests first:** `__tests__/scripts/check-traces.test.ts` (fixture nft JSON: pass, missing binary, binary in `/share`, oversize) `[C33]`.
- **`docs/dependencies.md`:**
  - pin and reason `[C4]`;
  - the binary is a John Van Sickle build of ffmpeg 7.0.2 with libzimg, about 80 MB `[C5]`;
  - the DNS limitation is why the loopback design exists (D2, `[C5]`);
  - the GPLv3 position (D10, `[C31]`);
  - the `allowScripts` approval `[C6]`.
- **Done-check:**
  - `node -p "require('ffmpeg-static')"` prints an existing path.
  - `"$(node -p "require('ffmpeg-static')")" -hide_banner -version` prints `ffmpeg version`.
  - `npm run build:offline` passes, including `check-traces`.

### Task 2 (T2) MP4 track info (pixel ceiling and HDR detection)
- **`lib/mp4-boxes.ts` (new, pure):** extract `viewOf`, `headerAt`, `children` and the top-level `moov` walk from `lib/video-gps.ts`, keeping its error strings `[C32]`. `lib/video-gps.ts` uses it. `__tests__/lib/video-gps.test.ts` stays **unchanged** as the regression guard.
- **`lib/video-track.ts` (new, pure):** `readVideoTrackInfo(read, size, limits?)`. It walks `moov/trak` (handler `vide`) → `mdia/minf/stbl/stsd` → the first visual sample entry. It returns `{ codec, width, height, transferKind: "sdr" | "hlg" | "pq" | "unknown" }`, where `colr` `nclx`/`nclc` transfer 18 = HLG and 16 = PQ `[C14]`.
- **Tests first:** `__tests__/lib/video-track.test.ts` covering:
  - SDR `nclc`
  - HLG `nclx` (`.mp4`) and HLG `nclc` (`.mov`)
  - no `colr`
  - no video track
  - truncated `stsd`

  Fixtures are made with Homebrew ffmpeg; add the recipes to `__tests__/fixtures/README.md` `[C14]`.
- **Done-check:** both test files green; `video-gps.test.ts` diff is empty.

### Task 3 (T3) Thumbnail-only encode in the image service
- **`services/images/types.ts`, `services/images/index.ts`:** add `DeriveSlot.thumbnail(input, ThumbnailOptions): Promise<ThumbnailSet>` `[C21]`.
- **`integrations/images/sharp-heic.ts`:**
  - Split decoding from encoding. `thumbnailNow` decodes once and runs `encodeThumb` only, with no web copy.
  - Keep the label-versus-bytes format check.
  - A released slot refuses `thumbnail` `[C21]`.
- **Tests first** (`__tests__/integrations/images.test.ts`):
  - PNG → JPEG ≤1000 px on #fffdf8 with no web encode
  - `noise.png` → `too_large`
  - mismatched label → `unsupported_type`
  - a released slot refuses
- **Done-check:** existing image tests unchanged and green.

### Task 4 (T4) Frame extraction: loopback server and ffmpeg runner
- **`lib/video-frames.ts` (new, pure):** `FRAME_SERVER_PREFIX = "/__frames/"`, the error codes (`decode_failed`, `timeout`, `no_video_stream`, `no_frame`, `source_limit`, `unsupported_type`, `too_many_pixels:<n>`) and `MAX_VIDEO_PIXELS = 33_177_600` (8K UHD).
- **`integrations/video-frames/frame-server.ts` (new, `server-only`)** `[C5, C17, C18, C19]`:
  - `http.createServer` listening on `127.0.0.1` port 0, which picks a free port; one random path `/__frames/<nonce>`.
  - **Ranges:** GET and HEAD; `bytes=a-` and `bytes=a-b` → `206` with `Accept-Ranges: bytes`, `Content-Range: bytes a-b/size`, `Content-Length` and `Connection: close`. An unsatisfiable range → `416` with `bytes */size`. Any other path → `404`.
  - **Body:** pulled lazily in 1 MiB windows from the injected `read(offset, length, signal)` (the `readVideoLocation` shape). Pipe with `stream.pipeline`; abort the window loop when the client closes.
  - **Robustness:** `error` handlers on the request, response and socket, so a reset never crashes the instance.
  - **Cap:** stops serving after `maxSourceBytes` (64 MiB) → `source_limit`.
- **`integrations/video-frames/ffmpeg.ts` (new, `server-only`):** `execFile(binary, args, { env: {}, timeout, killSignal: "SIGKILL", maxBuffer: 16 MiB, encoding: "buffer" })`, no shell `[C16]`. Arguments, in order:
  `-hide_banner -nostdin -v error -threads 2 -protocol_whitelist http,tcp -f <mov|matroska> -seekable 1 -ss <1|0> -noaccurate_seek -i http://127.0.0.1:<port>/__frames/<nonce> -map 0:v:0 -an -sn -dn -frames:v 1 -vf <[hdr chain,]scale=w=1000:h=1000:force_original_aspect_ratio=decrease> -f image2pipe -c:v png pipe:1`
  `[C7, C8, C9, C10, C11, C13, C15]`.
  - **Rotation:** autorotate stays on, so portrait iPhone clips come out portrait `[C12]`.
  - **HDR chain** (only when `transferKind` is `hlg` or `pq`): start from the documented `zscale=transfer=linear,tonemap=…,zscale=transfer=bt709,format=yuv420p` `[C14]`. Tune the operator against the HLG fixture; the docs example uses `bt709` but the value list says `709`, so test which spelling the binary accepts.
  - **Fallbacks:** if `zscale` is missing from the binary, run without the chain and log `hdr_untonemapped` at warn. An empty stdout at `-ss 1` → retry at `-ss 0` → `no_frame`.
  - **Failure mapping:** spawn `ENOENT`/`EACCES`/`EAGAIN`/`ENOMEM` → `deferred`, not a failure. A non-zero exit → `decode_failed`. The timeout → `timeout`.
  - **Logging:** the stderr tail (it can hold no secret, D2) goes to Pino with `mediaId`.
- **`services/video-frames/types.ts`, `services/video-frames/index.ts` (new):**
  - The factory reads the binary path from `ffmpeg-static` `[C4]`.
  - `available()` is `fs.access(path, X_OK)`.
  - `extractPoster({ size, read, container, transferKind, deadlineMs, signal })` composes the frame server and the runner `[C32]`.
- **`instrumentation.ts`:** add `Sentry.httpIntegration({ ignoreIncomingRequests: (path) => path.startsWith(FRAME_SERVER_PREFIX) })` so loopback requests create no transactions `[C25]`.
- **Tests first:**
  - **`__tests__/integrations/frame-server.test.ts`** (fake source, Node client): open and closed ranges, HEAD, 416, wrong path 404, client abort stops further `read` calls, a socket reset does not throw, the 64 MiB cap.
  - **`__tests__/integrations/video-frames.test.ts`** (real binary from `ffmpeg-static`):

    | Fixture | Expected result |
    |---|---|
    | moov-after-mdat `.mov`: the existing `location-mdta.mov` (H.264, 1.6 KB, verified `ftyp/wide/mdat/moov`) plus a new ~2 s **HEVC `hvc1`** `.mov` in the same layout (the iPhone shape; recipe in `__tests__/fixtures/README.md`) | a frame; ≤ 5 requests; upstream bytes ≤ moov + 2 windows |
    | faststart H.264 `.mp4` | a frame |
    | cue-less WebM (`-live 1`) | a frame |
    | `-display_rotation 90` clip | portrait output |
    | 0.5 s clip | the retry at 0 produces a frame |
    | garbage bytes | `decode_failed` or `no_video_stream` |
    | a source that never answers | `timeout`, and the child is killed |
    | HLG clip | mean luma inside a band; runs on `linux` only (the production platform), because Homebrew and darwin builds lack `zscale`. Documented in the test, and CI is linux. |

    `[C16, C19]`
- **Done-check:** both files green locally (darwin binary) and in CI (linux binary, including HLG).

### Task 5 (T5) Shared claim and publish helpers
- **`features/memories/derived-claims.ts` (new):** move `isEligible`, `quietDel`, the claim body (`derive-media.ts:173-224`), `failClaims` and the publish transaction (`:284-322`) behind kind-generic helpers. `publishClaims` takes an optional `whileLocked` callback `[C35]`.
- **`features/memories/derive-media.ts`:** use the helpers and re-export the constants the cron imports. Prisma call order is unchanged `[C35]`.
- **Tests first:** none new. `__tests__/features/derive-media.test.ts` must pass **unchanged**; that is the done-check.

### Task 6 (T6) `derivePoster`
- **`features/memories/derive-poster.ts` (new):** `derivePoster({ mediaId, deadlineMs, now })` never throws `[C35, C36]`.
  - **Gate:** the file is READY, `video/*`, allowed, not deleted, its memory not deleted, and its key under `storagePrefix()`.
  - **Preflight, before any claim:** `available()`, slot `acquire`, and remaining budget ≥ 6 s. A miss → `deferred`, with no attempt spent.
  - **Inspect:** sniff `readPrefix(128)` to choose `mov` or `matroska`; anything else → `unsupported_type`. For `mov`, run `readVideoTrackInfo` through `readRange`; over `MAX_VIDEO_PIXELS` → `too_many_pixels:<n>`.
  - **Claim** POSTER with `derivedKeyFor(storageKey, "jpg")`.
  - **Extract** inside `Sentry.startSpan({ name: "video poster", op: "media.poster" })` `[C24]`, then `slot.thumbnail` `[C21]`, then `storage.put`.
  - **Publish:** no `whileLocked` callback (D6). `too_large` is FAILED and final.
  - **Retries:** `decode_failed` and `timeout` retry up to 3 attempts. Losing the binary after the claim deletes our PENDING row and returns `deferred`.
  - **Log** `durationMs`, `sourceBytesRead` and `transferKind`.
- **Tests first:** `__tests__/features/derive-poster.test.ts`, mirroring the derive-media race cases `[C33]`:
  - not eligible / claimed elsewhere / P2002 then re-read
  - stale reclaim
  - exhausted → `abandoned`
  - the media deleted mid-run
  - conditional publish lost
  - each failure code
  - `deferred` paths spend no attempt
  - no `media.update` call ever

### Task 7 (T7) Scheduling (callback, MCP, cron)
- **`app/api/upload/route.ts`:** when READY and `video/*`, start a separate `afterWithFlush("upload.callback.poster")` task that runs `derivePoster` with 15 s `[C22, C37]`.
- **`features/memories/ingest-upload.ts`:** `scheduleReadyFollowUps` gains an opt-in `poster?: boolean`. Only MCP passes it. Page-hosted finalize stays as is (D1) `[C22]`.
- **`features/admin/attach-media.ts`:** pass `poster: true`; the task uses the remaining `deadlineAt` budget (route `maxDuration` 30), and the cron covers a deferral `[C22, C23]`.
- **`app/api/cron/reconcile-uploads/route.ts`:** new step **(g2)** after (g) `[C24, C23]`.
  - Selects READY, live `video/*` media under our prefix that lack an eligible POSTER, mirroring (g)'s OR for kind POSTER.
  - Batch 2, step budget 20 s, each item inside `Sentry.withIsolationScope`, counted in `counts.posters`.
  - (g) stays image-only.
- **Tests first:**
  - `__tests__/api/upload.test.ts`
  - `__tests__/features/schedule-ready-follow-ups.test.ts` (poster only when opted in and video)
  - `__tests__/features/attach-media.test.ts`
  - `__tests__/api/reconcile.test.ts` ((g2) selection, budget, isolation; the "(g) remains image-only" pin unchanged)
  - add `derive-poster` mocks where the module graph now reaches it, including `__tests__/integration/attach-media.test.ts` `[C33]`

### Task 8 (T8) Serving
- **`features/media/serve-media.ts`:** for `video/*` with `variant === "thumb"` (and no download), use the READY non-staging POSTER: pathname = its key, cost = its `sizeBytes`, copy `"thumb"`. With no poster → `mediaNotFound()`. Everything else is unchanged (D7, `[C26]`).
- **Tests first** `[C33]`:
  - **`__tests__/api/media.test.ts`:** poster redirect, the viewer scope `media:<id>:thumb:…` charged poster bytes, 404 without a poster (presign never called), `v=web` still the original.
  - **`__tests__/api/public-media.test.ts`:** the same with `public:` scopes; 404 for a non-public memory.
  - **`__tests__/api/admin-media.test.ts`:** the poster is served, and the global counter grows by poster bytes.

### Task 9 (T9) Housekeeping and docs for PR-1
- **`prisma/schema.prisma:53`:** the comment becomes `// video poster: one frame extracted server-side with ffmpeg (R-P1)`. A `//` comment is not in the AST, so no migration is needed `[C30]`.
- **`AGENTS.md`, `docs/code-layout.md`:** add `integrations/video-frames`, `services/video-frames`, `lib/mp4-boxes.ts`, `lib/video-track.ts` and `lib/video-frames.ts` to the layer list `[C32]`.
- **`docs/features/media-uploads.md`, `docs/2026-11-04-debt-catalog.md` (M-B-01), `docs/plans/phase1-ledger.md` (R3 row), `README.md:310`:** POSTER is built server-side, and R3 is superseded by R-P1 `[C38]`.
- **Done-check for PR-1:**
  - all checks green;
  - an independent review subagent's findings resolved (build → review → approve flow);
  - Team Code Review if Rob asks;
  - preview verification V1–V4 below.

---

## PR-2 `feat/video-posters-ui`: show the posters

### Task 10 (T10) Read model
- **`features/memories/public.ts`:**
  - `servedCopy` accepts POSTER.
  - `hasThumb` uses POSTER for videos and THUMBNAIL for photos.
  - `toPublicMemory` adds `poster: { mediaId, width, height } | null`, taken from the first VIDEO item with a READY non-staging POSTER.
  - `PUBLIC_SELECT` is unchanged; it already selects READY derivatives' kind, size and key `[C27]`.
- **`lib/memories/types.ts`:** add the `poster` field and fix the "photos only" comment on `hasThumb` `[C27]`.
- **Tests first:** `__tests__/features/public-memories.test.ts` (poster chosen, staging keys excluded). The fixture factories in `__tests__/lib/memories-{explore,related,timeline}.test.ts` gain `poster: null` `[C33]`.

### Task 11 (T11) Cards and memory page player
- **`app/memories/_components/memory-card.tsx` (`VideoSlot`, now exported):**
  - Add `overflow-hidden`.
  - Render `<FallbackImage src={publicMediaHref(poster.mediaId, "thumb")} alt="" fill unoptimized className="object-cover" />` first.
  - Put `PlayBadge` and the duration pill in positioned `z-[1]` wrappers, so the fill image cannot cover them.
  - With no poster, or after an image error, today's look remains (`FallbackImage` renders `null`) `[C27]`.
- **`app/memories/_components/video-player.tsx`:** `poster={item.hasThumb ? publicMediaHref(item.id, "thumb") : undefined}`. Keep `preload="none"`. Update the comment, since the poster is now fetched before play `[C26]`.
- **Tests first:**
  - `__tests__/app/memory-card.test.ts` (new): an `<img>` when a poster exists; the badge stays above it; no `<img>` without one.
  - `__tests__/app/memory-players.test.ts`: the `poster` attribute present or absent `[C33]`.

### Task 12 (T12) Admin gallery
- **`features/admin/get-memory.ts`:** add `posterReady` to `AdminMediaView`. MCP `get_memory` serialises this view, so it gains the field automatically `[C26]`.
- **`app/admin/media-gallery.tsx`:** `<video controls preload="none" poster={item.posterReady ? `${src}?v=thumb` : undefined} …>` `[C26]`.
- **Tests first:** `__tests__/features/admin-memories.test.ts` (posterReady) and `__tests__/app/media-gallery.test.ts` (new). Re-run `__tests__/api/mcp.test.ts`, whose `get_memory` output gains `posterReady` `[C33]`.
- **Docs:** `docs/features/see-memories.md` F6. Posters are done; the `CARD` copy remains `[C26]`.

---

## PR-3 `feat/admin-alert-previews`: posters and photos in the admin alert

### Task 13 (T13) Preview loader
- **`features/memories/admin-previews.ts` (new, `server-only`)** `[C28, C29, C34]`. It never throws.
  - **`waitForAdminPreviews({ memoryId, until })`:** polls every 1 s until each of the first 4 READY photos or videos has a READY copy or a final FAILED one, or until `until`. It never derives; posters come from D1's producers.
  - **`loadAdminPreviews(media, signal)`:**
    - Reads at most 4 READY non-staging THUMBNAIL (photo) or POSTER (video) copies of ≤ `PREVIEW_MAX_BYTES`.
    - Content id `preview-<mediaId>`, checked against `CONTENT_ID` and the reserved brand ids.
    - Bytes are base64. Width and height come from the derived row.
    - One `AbortSignal.timeout(5_000)` covers all reads.
- **`features/memories/media-summary.ts`:** `summarizeReadyMedia(rows, previews = new Map())` fills `preview`. Fix the stale comment at `:6` `[C34]`.
- **Tests first:** `__tests__/features/admin-previews.test.ts`:
  - the cap of 4
  - the size filter
  - staging keys skipped
  - poll timing with fake timers
  - a read failure → no preview, never a throw
  - content-id rules

### Task 14 (T14) Wire the alert
- **`features/memories/notify-admins.ts`:** select READY THUMBNAIL/POSTER derivatives `[C34, C22]`, then:
  1. Run the existing readiness checks.
  2. Do an advisory `EmailLog` read. If the alert is already SENT or SENDING, skip waiting and loading.
  3. If `previewsUntil` is set, wait.
  4. Load, then send.
- **`features/memories/ingest-upload.ts`** (finalize alert) passes `previewsUntil = Date.now() + 15_000` `[C22]`.
- **`features/memories/complete-submission.ts`** computes **one** `until` before its loop, so a send of N memories waits at most 15 s in total `[C22]`.
- **Cron** passes no `previewsUntil`; it loads only.
- **Contributor receipts are unchanged.** The template ignores previews for contributors `[C34]`.
- **Tests first** `[C33]`:
  - `__tests__/features/notify-admins.test.ts`
  - `__tests__/features/complete-submission.test.ts` (shared deadline)
  - `__tests__/features/ingest-upload.test.ts` (`previewsUntil`)
  - `__tests__/services/admin-template.test.ts` (video preview `video-N.jpg`)
  - `__tests__/api/reconcile.test.ts` (no wait in cron)
- **Docs:** `docs/features/email-and-cron.md` covers admin-alert previews; the debt catalog closes email Task 4 and T6 `[C28]`.

---

## Verification

| # | When | Check | Pass |
|---|---|---|---|
| V0 | Each task | Its named tests fail first, then pass. Then `npm run validate`, `npm run test:run`, the local PG 18 integration suites, and `npm run build:offline` with `check-traces`. | All green; `check-traces` lists the binary in exactly the 3 route functions |
| V1 | PR-1 preview | Set `VERCEL_ANALYZE_BUILD_OUTPUT=1` on the preview build `[C1]` and read function sizes. | Every function < 250 MB; the binary appears only in the 3 functions |
| V2 | PR-1 preview | On the preview (E2E harness, dev DB branch), upload one iPhone `.MOV`, one `.mp4` and one recorder WebM through the share form, plus one `.MOV` through the claim page. Read the `DerivedMedia` rows with a `tsx` script, and `curl -sI` the claim-link `?v=thumb` URL, printing status and `location` path suffix only, never the token. | POSTER READY within about 20 s; `302` to a `.jpg`; Sentry span `media.poster` visible; no `/__frames` transactions |
| V3 | PR-1 preview | Trigger the cron by hand with the cron secret (never printed). | Response `counts.posters` ≥ 1 for any video without a poster |
| V4 | PR-1 preview | Measure `/share` cold TTFB before and after. | No regression (the binary is not in that function) |
| V5 | After PR-1 merges (prod) | Wait two or three cron runs (≤ 30 min). For each of the 6 media ids in Context: `curl -s -o /dev/null -w '%{http_code} %{content_type}\n' -L 'https://www.jowray.com/api/public-media/<id>?v=thumb'` | `200 image/jpeg` for all six |
| V6 | After PR-2 merges | `curl -s https://www.jowray.com/memories/timeline`; then chrome-devtools screenshots of `/memories/timeline` (desktop and 390 px), one `/memories/<id>` video page and the admin memory gallery. | Each of the 6 video cards contains `<img … ?v=thumb>`; the frame is visible under the badge; the player shows the frame before play |
| V7 | PR-3 preview | Share a memory with a photo and a video, with the outbound allowlist set to Rob's Gmail. | The admin alert shows both inline pictures; the contributor receipt has no picture |
| V8 | PR-1 HDR | The CI HLG test passes; optionally Rob records a 3 s HDR clip on an iPhone and attaches it via MCP on a preview. | The poster is not grey or washed out |

---

## Premortem (assume it shipped and failed; top risks → where they are caught)

| # | Failure | Caught by |
|---|---|---|
| 1 | The binary is missing from a function: a trace-key miss, the install script skipped, or the exec bit lost. | `check-traces` in `build` (T1); `available()` preflight → `deferred`, logged to Sentry (T6); `allowScripts` (T1) |
| 2 | ffmpeg's HTTP seeking disagrees with the loopback server (open ranges, closes mid-body). | The `frame-server` and real-binary tests with request and byte budgets (T4) |
| 3 | Function size or cold start. | D1, `check-traces`' 220 MB gate, V1, V4 |
| 4 | Memory or CPU blow-up on 4K 10-bit HEVC. | One keyframe (`-noaccurate_seek`), `-threads 2`, the image slot held, `MAX_VIDEO_PIXELS`, the SIGKILL timeout (T4, T6) |
| 5 | Attempts burnt under contention: posters permanently FAILED. | The 6 s budget floor; environment errors → `deferred`; race tests (T6) |
| 6 | Wrong picture: rotation or HDR. | Rotation and HLG fixtures (T2, T4); V8 |
| 7 | Blob reads balloon on large files. | 1 MiB lazy windows and the 64 MiB cap; `sourceBytesRead` logged (T4) |
| 8 | Previews delay or break the admin alert. | A bounded 15 s shared wait; the loader never throws (T13, T14) |

---

## Recovery rules
- Never force-push a shared branch, run `npm audit fix --force`, add `eslint-disable` without Rob's "YES", or skip a failing test to move on. Fix the root cause `[C33]`.
- Rolling back PR-1 is a revert PR. POSTER rows and blobs are harmless if left behind. Purge already deletes every derivative kind (`app/api/cron/reconcile-uploads/route.ts:546,589-598`).
- Never print secrets, claim tokens, invite tokens or presigned URLs. Use `curl -w` with status and content type only.
- If the loopback design fails T4's real-binary tests after two honest attempts, stop and ask Rob. The fallback (a `/tmp` download of files ≤ 250 MB) changes D2 and needs his ruling.

## Non-goals and follow-ups
- **FU-1:** claim-page posters (R-P3; debt M-C-20).
- **FU-2:** a ~400 px `CARD` derivative for cards (see-memories F6).
- **FU-3:** a play badge composited on email video previews (`PLAY_BADGE_COMPOSITE`), if Rob wants it.
- **FU-4:** an HEVC → H.264 web copy for browsers that cannot play HEVC. ffmpeg is now available server-side; this needs Rob's ruling, since videos currently "play as recorded".
- **FU-5:** an LGPL ffmpeg build, if licensing review asks (D10).
- **FU-6:** remove the unused browser poster staging key (`posterStagingKeyFor`), once nothing reserves it.

Added during execution (2026-11-08):
- **FU-7:** approve or deny the five pre-existing unapproved install scripts (`prisma`, `@prisma/engines`, `esbuild`, `exifreader`, `fsevents`) before npm 12 blocks them by default (Task 1 note). Rob's.
- **FU-8:** head-of-line blocking in cron (g2) (a Task 7 review minor): a video whose header reads stall in every run (`inspect_time`) holds the oldest-first batch of 2, so the backfill stops behind it, with a Sentry warning each run; new uploads are unaffected. Cheapest fix: alternate the order by run slot (amends R11). **Fixed in Team Code Review round 1 (B2-6, `17a2ee8`).**
- **FU-9:** the admin alert's preview alt text still says "Your video" / "Your photo" (the template's contributor wording; Tasks 13–14 note).

Added after Team Code Review round 1 (2026-11-08; details in the [feature doc](../features/video-posters.md#known-gaps-and-follow-ups) and the PR #99 description):
- **FU-10 (High, owner Rob):** move to a maintained FFmpeg build. The Linux `ffmpeg-static` binary is stuck at FFmpeg 7.0.2 ([dependencies](../dependencies.md#ffmpeg-static-video-posters)). Do it before uploads open beyond family use, or on a code-execution CVE in the mov or matroska demuxers or the h264, hevc, vp8 or vp9 decoders.
- **(Low)** PQ output is untested: the PQ case runs on the HLG fixture. Add a real PQ fixture when FU-10 re-runs the real-binary suite.

---

## Ledger

| Step | Status | Commit / PR | Notes |
|---|---|---|---|
| Plan approved | done | — | Rob's rulings R-P1 to R-P3 (2026-11-08); execution started the same day. Rob, 2026-11-08: "Let's keep this in one pr please." |
| Setup (worktree, `npm ci`) | done | base `6113021` | Worktree `../jowray_wt_video_posters`, branch `feat/video-posters` from `origin/main` `6113021` (PR #96 merge; the plan was written at `c837789`). |
| T1 dependency + tracing | done | `4332502`, `456b5df` | nft paths: `.next/server/app/<app path>/{page,route}.js.nft.json`, one per function (30); Turbopack matches the un-prefixed keys. The server runtime trace `.next/next-minimal-server.js.nft.json` exists locally and in CI but not on Vercel, which builds through its adapter (fix `456b5df`). |
| T2 track info | done | `eef7f7d`, `ff95f8b`, `4fa431a` | R3, R3a |
| T3 thumbnail slot | done | `d7a93c9` | |
| T4 frame extraction | done | `adba1ea`, `867aa8c`, `d8fa501`, `6378dc9`, `01377cf` | R4a, R5, R7; Linux 7.0.2 passed in CI at `01377cf` |
| T5 claim helpers | done | `2d3b557` | `derive-media.test.ts` unchanged |
| T6 derivePoster | done | `85c0c2f`, `84cbd20` | R6, R8, R9, R10; two T6 minors folded into T7 as `5a43897` |
| T7 scheduling | done | `8d2b0f2`, `5a43897`, `d20831e` | R2, R11, R12, R13 |
| T8 serving | done | `a69dacb` | D7 |
| T9 docs + PR-1 review | docs done (run last, R15); TCR round 1 done; regression check, approval and merge pending | `8ba6d5c`, `f2ea77f`, `fa6dc3f`, `03c42e8` | The PR review is Rob's 7-step flow (Execution ledger, PR #99). `ci` and the preview passed on `03c42e8`. |
| TCR round 1 + bucket work | done | `a84e1e3`, `a7f8535`, `2da847f`, `61747d5`, `17a2ee8`, `ff0dd3c`, `aa7a863` and the docs commit that updates this file | 12 findings (George 7, Oscar 5) plus 3 of the controller's; Buckets 1 and 2 done; Bucket 3 in a PR comment; Bucket 4 in the PR description (Execution ledger). |
| V1–V4 preview | V1 partly done; V2–V4 not run | PR #99 preview at `456b5df` | V1: the function sizes come from check-traces on the Vercel build (`/api/mcp` 140.7 MB, cron 140.3, upload 140.3, `/share` 63.0; ffmpeg only in the three routes), not from `VERCEL_ANALYZE_BUILD_OUTPUT`. |
| PR-1 merged, V5 | pending | PR #99 (one PR for all tasks) | |
| T10–T12, PR-2 merged, V6 | code done; merge and V6 pending | `9bbb477`, `757b46e`, `d10de91` (R16) | In PR #99 |
| T13–T14, PR-3 merged, V7 | code done; merge and V7 pending | `307c021`, `7225d7e`, `898fd64`, `567e5ac` (R17, R18, R19) | In PR #99 |

## Execution rulings

Every line of the execution ledger (`.superpowers/sdd/thumbnails-of-videos-don-t-glimmering-pearl/progress.md`, local to the worktree and not committed) that contains `Ruling`, copied verbatim and in ledger order. These are the controller's rulings, from the pre-flight scan and during execution (agent's calls, 2026-11-08), each as "what — why — cost if wrong". The ledger opens with:

> Spec: none separate. The plan's Context and Rulings (R-P1, R-P2, R-P3 from Rob, 2026-11-08) are the authority, so rulings made here are provisional against them.

- Ruling R1: use `npm install-scripts approve ffmpeg-static` (the installed npm 11.20.0 syntax, which blocks by default) instead of the plan's `npm approve-scripts` — the local docs and the install warnings show blocking with this command name; both write `allowScripts` — cost if wrong: on npm 12 the CLI name differs, but the field is the same.
- Ruling R2: the MCP poster task is scheduled in features/admin/attach-media.ts, not via the scheduleReadyFollowUps option — ingest-upload is imported by page functions, and an ffmpeg-static import there could be traced into /share,/s,/m — cost if wrong: one extra after() call site.
- Ruling R3: readVideoTrackInfo returns a found/absent/failed union like readVideoLocation — consistency with the existing parser and its error handling — cost if wrong: a small type refactor.
- Ruling R4: extractPoster resolves `{ok:true,png,sourceBytesRead,toneMapped} | {ok:false,code|"deferred",detail}` — derivePoster must map outcomes without try/catch around expected failures — cost if wrong: a small type refactor.
- Ruling R5: the Task 4 HLG real-binary test runs on every platform, not linux-only — the darwin ffmpeg-static binary (6.0) lists zscale (T1 report); the plan's linux-only clause assumed Homebrew — cost if wrong: a red local run on a Mac without zscale, fixed by restoring runIf.
- Ruling R6 (T2 concern 1 → T6): derivePoster maps readVideoTrackInfo `failed` to retryable `decode_failed` (≤3 attempts, then abandoned); no string matching on reasons; log `reason` with extract-photo-gps's care — a malformed file is bounded at 3 attempts — cost if wrong: two wasted attempts per malformed video.
- Ruling R7 (T2 concern 2 → T4): ffmpeg also gets `-max_pixels 33177600` (MAX_VIDEO_PIXELS) as a decoder option if the binaries (darwin 6.0, linux 7.0.2) accept it, because the sample-entry size is declared, not decoded — cost if wrong: one extra arg; if unsupported, drop it and log the ruling.
- Ruling R3a (amends R3, after the T2 review's plan-mandated Important): readVideoTrackInfo `failed` carries `error: Error` (non-Errors wrapped, value kept in `cause`) alongside `reason`, mirroring readVideoLocation (lib/video-gps.ts:29,:91). R6 still maps failed → retryable decode_failed, and T6 logs it via logError — keeps the stack/class for Sentry and matches the existing parser — cost if wrong: none material.
- Ruling R4a (T4 deviations accepted, all measured by the implementer): (1) `-recv_buffer_size 65536` added so reads stay at moov + 2 windows; (2) scale runs BEFORE the HDR chain and keeps even sides (4K HLG ffmpeg RSS 596→280 MB; fixes a 1080p HLG zscale failure); (3) tonemap = mobius param 0.7 at npl 203 (luma 141 vs BT.2408's predicted 143) instead of hable/npl 100; (4) the contract widens: the pixel refusal returns `too_many_pixels:<limit>` (final, not retried), success may carry `warning: "hdr_untonemapped"`, failure may carry `error?: Error`, and every spawn failure → `deferred`; (5) Sentry: the httpIntegration passed keeps `disableIncomingRequestSpans: true` (the @sentry/nextjs 11.11 default that ours replaces) plus ignoreIncomingRequests for /__frames/ (lib/sentry/http-options.ts) — the plan's line alone would have added an http.server span to every request — cost if wrong: the Sentry config change needs the final review's eye.
- Ruling R8 (T6 choice 3): a `deferred` after a RECLAIM deletes our row and resets its attempt history — accepted; it only follows rare environment failures (binary missing, server_error) and stays bounded — cost if wrong: a twice-failed video gets ≤3 more tries after an environment fault.
- Ruling R9: T6 Minors 1–4 are promoted to a fix round before T7 — they decide convergence under MCP's ~12–15 s budget and log hygiene: (1) check the 6 s floor first, then acquire(remaining − 6 s), and retire exhausted stale rows before the preflight/inspection; (2) abort the inspection at remaining − 6 s so a run can't defer forever without spending an attempt; (3) scrub the loopback URL from the stderr tail; (4) count inspection reads in sourceBytesRead and re-check the budget after the claim, before ffmpeg. Plus a test for `put` throwing — cost if wrong: one extra review round.
- Ruling R10 (T6 fix 1 concern): a storage error thrown while reading the ORIGINAL records retryable decode_failed (≤3 attempts) rather than deferred — such errors can be blob-specific, so deferring could loop forever; put failures and publish-transaction failures give the claim back (deferred, reported to Sentry) because they cannot be caused by the video — cost if wrong: a store outage burns ≤3 attempts per video during the outage (recoverable by the stale-attempt rule? no — FAILED after 3; an operator would re-queue).
- Ruling R11 (T7): cron step (g2) runs AFTER (h) (GPS) and uses only the leftover run budget, capped at 20 s — (g) can already take 30 s of the 50 s RUN_DEADLINE, so (g2) before (h) could starve GPS — cost if wrong: during a big backlog posters progress slower (batch 2 per run, every 10 min).
- Ruling R12 (T7 concern 1): the MCP poster task gets `deadlineAt - Date.now() - 3_000`, the same margin as the hash/derive tasks, so put/publish/flush fit inside maxDuration 30 — cost if wrong: MCP posters need ≥10 s left (else the cron makes them).
- Ruling R13 (T7 concern 3): (g2) selects `mimeType in <allowed video MIME list>` (from lib/media-types), not startsWith "video/" — derivePoster rejects disallowed types as not_eligible, and with batch 2 ordered by createdAt asc such rows would be re-picked every run and could block the queue — cost if wrong: none.
- Ruling R15: Task 9 (docs/housekeeping) moves to the END and absorbs the docs bullets of T12 (see-memories F6) and T14 (email-and-cron, debt Task 4/T6) — one PR, so docs are written once against the final design — cost if wrong: none.
- Ruling R16: Tasks 10–12 (read model → cards/player → admin gallery) go to ONE implementer with one commit per task and ONE combined review — small, sequential, same UI surface — cost if wrong: one larger review diff.
- Ruling R17: Tasks 13–14 (admin-alert preview loader + wiring) go to ONE implementer, one commit per task, one combined review — tightly coupled — cost if wrong: one larger review diff.
- Ruling R18 (T13-14 concern 3): the admin-preview READ deadline is shared across a whole completion send (one deadline = the shared wait `until` + 5 s), not 5 s per memory — keeps a large send within ~20 s of preview work against maxDuration 120 — cost if wrong: later memories in a big send may go without previews when storage is slow.
- Ruling R19 (T13-14 review Minors 1–5 promoted to fix round 1): (1) the cron's preview reads are bounded by its RUN_DEADLINE (pass previewsReadUntil); (2) the advisory EmailLog read fails OPEN (logError, treat as open) so a transient DB error doesn't push the alert to the cron; (3) the wait and the loader use the same slot filter; (4) rename the local Pick → PreviewPick; (5) key the complete-submission test's emailLog stub by emailType — small, same files, (1)/(2) protect alert timeliness and cron steps — cost if wrong: one review round.

Notes on these rulings, from the same ledger:
- There is no R14.
- R1, the ledger's Task 1 note, verbatim: "Note (T1): npm 11.20 did not actually block ffmpeg-static's install script (the docs disagree); the pinned allowScripts entry protects against npm 12."
- R4a (1) was superseded by the Task 4 fix round (`01377cf`): the frame server answers each request with at most one 1 MiB window and ffmpeg continues with `-reconnect 1 -reconnect_delay_max 0`, so the bound no longer depends on socket buffers, and `-recv_buffer_size` was removed.
- R5: the HLG real-binary test passed on Linux (ffmpeg 7.0.2) in CI at `01377cf`.

## Execution ledger

What each task committed and how it ended, from the execution ledger and the task reports. Each task wrote its tests first and saw them fail, then pass; every task ran `npm run validate`, `npm run test:run` and `npm run build:offline` (check-traces OK) before it was reviewed by a separate subagent. "Deferred" lists the review minors left open.

**Task 1: dependency, install-script approval, tracing.** `4332502`, then `456b5df` (fix 1).
- `ffmpeg-static` 5.3.0 pinned, with `"allowScripts": { "ffmpeg-static@5.3.0": true }` written by `npm install-scripts approve ffmpeg-static` (R1). `serverExternalPackages` and the three `outputFileTracingIncludes` keys; `build` ends with `tsx scripts/check-traces.ts`.
- Local (darwin, ffmpeg 6.0, 45.6 MB) sizes: `/api/mcp` 86.9 MB, cron and upload 86.4 MB, `/share` 43.4 MB. A deliberate misconfiguration (the `/api/mcp` key renamed `/share`) failed the build with both problems named.
- Fix 1: the first Vercel preview build failed in check-traces with `.next/next-minimal-server.js.nft.json` ENOENT. Root cause: Vercel builds through its Next.js adapter, and with an adapter Next 16.3+ under Turbopack writes no server traces (vercel/next.js#93684); reproduced locally with a stub adapter. The trace is now an optional size addend. The preview then passed, with Linux sizes `/api/mcp` 140.7 MB, cron and upload 140.3 MB, `/share` 63.0 MB.
- Review clean; the fix's re-review approved.
- Deferred: the entrypoint detection is a basename heuristic, and a misfire would skip the gate silently (lean: fix); the `additionalRoots` failure branch is untested; `describeFunction` keeps `(group)` and `@slot` segments in route names; the over-limit message still says "with the server runtime" when the trace is absent; a non-ENOENT stat error throws uncaught (loud, but not a formatted failure line); adapter-mode sizes exclude about 1.5 MB of instrumentation trace. Done in Task 9: the `docs/dependencies.md` audit line and the `AGENTS.md` / `docs/code-layout.md` Checks note.

**Task 2: MP4 track info.** `eef7f7d` (the shared box walk, `lib/mp4-boxes.ts`), `ff95f8b` (`lib/video-track.ts`), `4fa431a` (fix 1, R3a).
- `__tests__/lib/video-gps.test.ts` unchanged and green (150/150); a 50,000-input differential fuzz of old and new `lib/video-gps.ts` found 0 mismatches. `readVideoTrackInfo` returns found / absent / failed (R3, R3a), reading `colr` `nclx` and `nclc` with the H.273 transfer table (18 HLG, 16 PQ). Four synthetic fixtures with recipes.
- Review clean after one fix round.
- Deferred: `VideoTrackLimits` and its defaults duplicate `MoovReadLimits` and the video-GPS budgets; `readMoov` validates undeclared keys; a tautological "at most 16 reads" assertion; a misleading `hdlr` test name; a 0×0 sample entry is reported as found (Task 6 treats it as unknown, and `-max_pixels` guards it, R7); the pre-existing "Could not parse HEIF file" stderr noise in the full suite.

**Task 3: thumbnail-only encode.** `d7a93c9`.
- `DeriveSlot.thumbnail` decodes once and encodes the thumbnail alone; a released slot refuses it. The existing image tests are unchanged and green (25/25 in the file).
- Review clean.
- Deferred: an `images.test.ts` comment and name overclaim the q60 fallback; the no-web-copy spy depends on the private method name `encodeWeb` (a control call guards it); the 1 ms HEIC deadline test relies on worker start-up taking over 1 ms. Done in Task 9: the stale `noise.png` note in `__tests__/fixtures/README.md`.

**Task 4: frame extraction.** `adba1ea` (fixtures), `867aa8c` (frame server), `d8fa501` (ffmpeg runner and frame service), `6378dc9` (Sentry Http options), `01377cf` (fix 1).
- The loopback design worked against the real binary on the first attempt. Accepted deviations (R4a): scale before the HDR chain (4K HLG peak memory 596 → 280 MB, and a 1080p odd-height zscale failure fixed with `force_divisible_by=2`); mobius 0.7 at npl 203 (mid-grey HLG luma 141 against BT.2408's 143); `too_many_pixels:<limit>` from ffmpeg's `-max_pixels` (R7); every spawn failure deferred; the Http integration keeps `disableIncomingRequestSpans: true`.
- Fix 1 (review Important 1 and 2): one window per frame-server answer with `-reconnect 1 -reconnect_delay_max 0`, so a moov-after-mdat file padded to 48 MiB reads exactly `[1 MiB, moov, 1 MiB]` whatever the kernel buffers; a server error after listen now fails the run as `deferred` with its cause.
- PR #99 opened as a draft at `01377cf`. Linux CI (ffmpeg 7.0.2): video-frames 32/32, frame-server 34/34, video-track 74/74, check-traces 14/14; 138/138 files with the real-Postgres suites.
- Review clean after one fix round.
- Deferred: `detectZscale` caches the first caller's signal and timeout; the PQ test uses the HLG fixture; a satisfiable multi-range gets 416; a comment claims 7.0.2 accepts `bt709`/`709` without having run it; the Sentry `ignoreIncomingRequests` filter is inert under `disableIncomingRequestSpans` and untested, and loopback request sessions remain; `runFilterList` repeats `runFfmpeg`; a bad injected window or cap surfaces as `deferred`; a test pins 6.0's exact request sequence (a CI failure only there would be a 7.0.2 demuxer difference to rule on); the frame-server body doc ignores HEAD; `messageOf` is duplicated; "Stream ends prematurely" lines crowd `stderrTail`; the whole-body (no Range) path can read ahead (unused by ffmpeg, capped). Done in Task 9: the fixtures README's byte-check claim.

**Task 5: shared claim and publish helpers.** `2d3b557`.
- `features/memories/derived-claims.ts`; `derive-media.ts` uses it with the same Prisma call order; `__tests__/features/derive-media.test.ts` has an empty diff and passes.
- Review clean.
- Deferred: a reclaim calls `quietDel` before the claim is recorded (only bites if `logError` throws; worst case the row stays PENDING for at most 10 minutes, then converges).

**Task 6: `derivePoster`.** `85c0c2f`, `84cbd20` (fix 1); two minors folded into Task 7 as `5a43897`.
- Inspect, then claim; R6 maps a malformed movie box to a retryable `decode_failed`; R8 accepts that a deferral after a reclaim resets the row's attempts.
- Fix 1 (R9, R10): the budget floor checked before the binary and the slot; the inspection aborted while the floor is whole; the loopback URL redacted from `stderrTail`; inspection bytes counted; a failed blob write or publish gives the claim back.
- Review clean after one fix round.
- Deferred: a test could assert exactly 14,000 ms; a lost acknowledgement after a commit that dropped our claim leaks our JPEG (pre-existing: `failClaims` did the same); the post-slot and post-claim floor checks are not pinned at exactly the boundary.

**Task 7: scheduling.** `8d2b0f2`, `5a43897` (Task 6 minors), `d20831e` (R12, R13).
- Three producers: `upload.callback.poster` (15 s), `mcp.finalize.poster` in `features/admin/attach-media.ts` (R2; the call's deadline less 3 s, R12) and cron (g2) after (h) on at most 20 s of leftover run time (R11), selecting only allowed video types (R13). Stalled inspections now warn, and report to Sentry when the window was at least 10 s; a 1 s claim margin before the claim makes the start threshold 7 s.
- Real-Postgres suites at `d20831e` (local PG 18): 16/16 files, 255/255 tests.
- Review clean.
- Deferred: head-of-line blocking in (g2) (FU-8); the `inspect_time` path hand-builds the deferred log shape; exactly 7 s left can still reach `acquire(0)`; (g2) compares `too_many_pixels` codes as strings while `isEligible` compares numbers.

**Task 8: serving.** `a69dacb`.
- A video's `v=thumb` serves its READY, non-staging POSTER, charged at the poster's size, or 404 (D7); `v=web`, no `v` and downloads unchanged.
- Review clean.
- Deferred: the `sizeBytes`-null fallback is untested; a public-media test reads the day from the counter keys' order; the staging-key 404 is tested on the claim route only.

**Tasks 10–12: read model, cards and player, admin gallery** (R16, one implementer and one combined review). `9bbb477`, `757b46e`, `d10de91`.
- `PublicMemory.poster` and a kind-aware `hasThumb` (always false for a recording); `VideoSlot` shows the poster under the badge and the pill; the memory page and admin players get `poster`; the admin view and MCP `get_memory` report `posterReady`. A static render of the cards on the built CSS was screenshotted (not committed).
- Combined review clean.
- Deferred: the admin `posterReady` does not exclude staging keys (as `thumbReady` and `webReady`); the card's poster and duration pill can come from different videos; the no-poster card gained a wrapper span (visual parity shown only by the screenshot).

**Tasks 13–14: admin-alert previews** (R17, one implementer and one combined review). `307c021`, `7225d7e`, `898fd64` (R18), `567e5ac` (R19).
- `features/memories/admin-previews.ts` (the wait and the loader; never derives, with a D1 module-graph test); `notifyAdminsOfMemory` waits, re-reads, loads and sends; `deliveryClosed` in the email service. R18 shares one read budget across a send; R19 bounds the cron's reads by its run deadline, fails the advisory `EmailLog` read open and gives the wait and the loader one slot rule.
- Real-Postgres suites at `7225d7e` (local PG 18): 16/16 files, 255/255 tests. The fail-open advisory read cannot double-send: `EmailLog` has `@@unique([memoryId, emailType])`, an advisory-lock claim and conditional claims.
- Review clean after one fix round.
- Deferred: the alt text (FU-9); the R19 cron test leans on the run's start equalling the route's `now` under a frozen `Date`; a memory can show fewer than 4 pictures when a copy is unusable (intended).

**Task 9: docs and housekeeping** (R15: moved to the end, absorbing the docs bullets of Tasks 12 and 14). `8ba6d5c` (code layout), `f2ea77f` (schema comment, fixtures README, dependencies), `fa6dc3f` (feature docs) and the commit that adds this file.
- Docs only, the `schema.prisma` comment and the fixtures README; no code. Checks on `fa6dc3f` plus this file, with no `.env*` file and no database variables (darwin, Node 26): `npm run validate` exit 0; `npm run test:run` 133 files passed and 11 skipped (144), 3,632 tests passed and 68 skipped (3,700; the skips are the real-Postgres suites without `TEST_DATABASE_URL`); `npm run build:offline` exit 0, with check-traces OK (30 functions; ffmpeg only in the three routes; `/api/mcp` 86.9 MB, the cron and `/api/upload` 86.5 MB, `/share` and `/s/[inviteToken]` 43.4 MB, `/m/[claimToken]` 43.0 MB). `npm audit` the same day: 4 low, the deepmerge chain, as before `ffmpeg-static`. No integration-test fake changed.

**Team Code Review round 1** (2026-11-08, on `03c42e8`). George (Gemini) and Oscar (Codex) found 12 issues: George 7 (G1–G7), Oscar 5 (O8–O12). The controller sorted them into buckets, verified the CVE claims against NVD, cve.org, Red Hat, SUSE and Ubuntu, and added three findings of its own from the deferred minors above. Rob authorized the work going into this PR. One review subagent ran the round and then the bucket work, each code change test first, in these commits:
- `a84e1e3` check-traces:
  - B1-1 (G1, O9): the binary must match `FFMPEG_BINARY_PINS` for the build platform, by size and then SHA-256. linux-x64 is `e7e7fb30…aa3eb99` (79,826,272 bytes) and darwin-arm64 `a90e3db6…18336584` (45,568,216 bytes), from the `b6.1.1` release asset digests; the gunzipped `ffmpeg-linux-x64.gz` was hashed to confirm. A platform with no pin fails.
  - B1-3 (O12): an `ffmpeg-static` file in a shared source fails once, naming that source.
  - B2-2 (G3, O12): sizes add the instrumentation trace and the required server files.
  - B2-7: the CLI entry check compares real paths, and a `tsx` spawn test proves the gate runs. The over-limit message names the shared sources.
  - These close Task 1's deferred entrypoint, wording and instrumentation-size minors.
- `a7f8535` B1-1, the runtime half: `createVideoFrameService` throws while `FFMPEG_BIN` is set, in every environment, so only the pinned binary runs.
- `2da847f` B2-1 (G2; Task 4's deferred minor): one `-filters` probe per binary, on its own `FILTER_CHECK_MS` clock; each caller races its own deadline and signal.
- `61747d5` derivePoster:
  - B2-4 (G7; Task 7's minor): exactly the start threshold defers before the binary and the slot.
  - B2-5 (O11): `PUBLISH_RESERVE_MS` (2 s) comes out of ffmpeg's and sharp's deadlines and is added to the floors (8 s after the claim, 9 s before it). The write starts only with 2 s left and the publish only with 1 s; otherwise the claim is given back and reported as `publish_budget`.
- `17a2ee8` B2-6 (FU-8; amends R11): (g2) takes oldest first in even ten-minute slots and newest first in odd ones.
- `ff0dd3c` B2-3 (G5; Tasks 10–12's minor): `posterReady`, `thumbReady` and `webReady` ignore copies on browser-staged keys.
- `aa7a863` B2-8 (Task 8's minor): a test pins the POSTER `sizeBytes`-null cost fallback.
- The docs commit, B1-2 (G1, O8) and B2-9: the FFmpeg 7.0.2 risk record in `docs/dependencies.md` and the feature doc; the env variables that must never be set; R4a in the Key decisions; these Status lines and this entry.

Not done, with the reasons in a PR #99 comment (Bucket 3): G4, Sentry request sessions for the loopback requests; G6, the `too_many_pixels` string comparison; O10, the unbounded preview query; and switching to a maintained FFmpeg build within this PR. The last is FU-10 instead. Follow-ups FU-1 to FU-7, FU-9 and FU-10 and the PQ fixture are in the PR description (Bucket 4).

Checks before the push (darwin, Node 26, no `.env*`, no database variables): `npm run validate` exit 0; `npm run test:run` 134 files passed and 11 skipped (145), 3,669 tests passed and 68 skipped (the real-Postgres suites); `npm run build:offline` exit 0. Its check-traces passed: the darwin-arm64 hash was verified, there are 30 functions, ffmpeg is in the three routes only, and the sizes now include the shared files (`/api/mcp` 88.6 MB, the cron and `/api/upload` 88.2 MB, `/share` and `/s/[inviteToken]` 45.1 MB). No integration-test fake changed. `__tests__/integration/review-version.test.ts` and `share-draft.test.ts` call `getMemoryForAdmin`, whose derivatives select gained `storageKey`; the orchestrator runs those suites on its own Postgres.

**PR #99.** Opened as a draft at `01377cf` and pushed again at `456b5df` and `03c42e8`; `ci` and the Vercel preview passed on each push (`ci` on `01377cf`, `456b5df` and `03c42e8`; the preview on `456b5df` and `03c42e8`). The Team Code Review round 1 commits were pushed after that. Rob, 2026-11-08: "Finish the PR then apply these steps." After the push: one Team Code Review round, the friend-buckets sort, the bucket work by the same review subagent, a regression check, the orchestrator's approval, and a merge to `main` if there are no serious regressions.

---

## Citations

All external quotes were fetched live on 2026-11-08. The repo quotes are from `origin/main` at `c837789`.

### [C1] — Vercel function size, memory and build-output analysis
- **Relevant File(s):** `next.config.ts`, `scripts/check-traces.ts`
- **Change Summary:** Keep the ffmpeg binary out of most functions, gate traced size in the build, and read real sizes on the preview.
- **Source URL:** https://vercel.com/docs/functions/limitations#bundle-size-limits (also #troubleshooting-the-250-mb-limit, #memory-size-limits; "last_updated: 2026-08-24")
- **Verbatim Quote:**
  > "For Vercel Functions, the maximum uncompressed size is 250 MB including layers which are automatically used depending on runtimes."
  > "To find out what's making a function large, add the `VERCEL_ANALYZE_BUILD_OUTPUT` environment variable with the value `1` and redeploy."
  > "Hobby | 2 GB / 1 vCPU | 2 GB / 1 vCPU"
- **Justification:** An 80 MB binary in every function eats a third of the 250 MB budget, and 1 vCPU limits decode concurrency. So D1 restricts the binary, `check-traces` fails builds over 220 MB, and V1 uses the documented variable to confirm sizes.

### [C2] — Next.js `outputFileTracingIncludes` route globs
- **Relevant File(s):** `next.config.ts`, `scripts/check-traces.ts`
- **Change Summary:** Add the binary, its license and its readme to the traces of three routes only.
- **Source URL:** https://nextjs.org/docs/app/api-reference/config/next-config-js/output#caveats (lastUpdated 2026-09-18)
- **Verbatim Quote:**
  > "Each option accepts an object whose keys are route globs (matched with picomatch against the route path, e.g. `/api/hello`) and whose values are glob patterns resolved from the project root that specify files to include or exclude in the trace."
  > "Keep patterns as narrow as possible to avoid oversized traces (avoid `**/*` at the repo root)."
- **Justification:** ffmpeg-static resolves the binary at runtime, so tracing cannot see it. The documented include map with narrow route keys (`/api/upload`, `/api/mcp`, `/api/cron/reconcile-uploads`) adds it exactly where D1 needs it.

### [C3] — Next.js `serverExternalPackages`
- **Relevant File(s):** `next.config.ts`
- **Change Summary:** Do not bundle `ffmpeg-static`; require it natively.
- **Source URL:** https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages (lastUpdated 2025-12-05)
- **Verbatim Quote:**
  > "If a dependency is using Node.js specific features, you can choose to opt-out specific dependencies from the Server Components bundling and use native Node.js `require`."
- **Justification:** `ffmpeg-static` builds its binary path from `__dirname`, a Node-specific feature that bundling would break. It is not on Next's built-in external list, so it is added explicitly.

### [C4] — ffmpeg-static: install-time download, strict version, binary path
- **Relevant File(s):** `package.json`, `package-lock.json`, `services/video-frames/index.ts`, `docs/dependencies.md`
- **Change Summary:** Pin `ffmpeg-static@5.3.0` exactly; the factory takes the binary path from the package.
- **Source URL:** https://github.com/eugeneware/ffmpeg-static/tree/master/packages/ffmpeg-static#installation (and #example-usage)
- **Verbatim Quote:**
  > "During installation, it will download the appropriate `ffmpeg` binary from the `b6.1.1` GitHub release. Use and distribution of the binary releases of `ffmpeg` are covered by their respective license."
  > "To prevent an `ffmpeg-static` upgrade downloading backwards-incompatible ffmpeg versions, use a strict version range for it or use a lockfile."
  > "Returns the path of a statically linked ffmpeg binary on the local filesystem."
- **Justification:** The binary arrives through an install script (hence T1's approval) and can change between package versions (hence `--save-exact`). The factory uses the exported path rather than a PATH lookup.

### [C5] — The static Linux build: no DNS, GPLv3, version and libzimg
- **Relevant File(s):** `integrations/video-frames/frame-server.ts`, `integrations/video-frames/ffmpeg.ts`, `docs/dependencies.md`
- **Change Summary:** Feed ffmpeg from a loopback server instead of a Blob URL; document the license and version.
- **Source URL:** https://johnvansickle.com/ffmpeg/release-readme.txt (Last-Modified 24 Aug 2024), and the release asset https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/linux-x64.README
- **Verbatim Quote:**
  > "Notes:  A limitation of statically linking glibc is the loss of DNS resolution. Installing nscd through your package manager will fix this."
  > "This static build is licensed under the GNU General Public License version 3."
  > "build: ffmpeg-7.0.2-amd64-static.tar.xz" … "libzimg: 3.0.3"
- **Justification:** Vercel functions run no nscd, so ffmpeg could not resolve `*.blob.vercel-storage.com`. A numeric `127.0.0.1` URL needs no DNS (D2). libzimg means `zscale` is available for D5. The GPLv3 statement drives D10.

### [C6] — npm `allowScripts`: blocked by default in npm 12, advisory in npm 11
- **Relevant File(s):** `package.json`
- **Change Summary:** Approve `ffmpeg-static`'s install script with a pinned entry.
- **Source URL:** https://docs.npmjs.com/cli/v12/commands/npm-approve-scripts#description ; https://docs.npmjs.com/cli/v11/commands/npm-approve-scripts#description
- **Verbatim Quote:**
  > (v12) "Dependency install scripts are blocked by default. Install commands silently skip lifecycle scripts for any dependency that does not have a matching entry in allowScripts, and end with a list of the packages whose scripts were skipped so you can review them with this command."
  > (v12) "By default the command writes pinned entries (pkg@1.2.3), which keep their approval narrowed to the specific version you reviewed."
  > (v11) "In the current release, this field is advisory: install scripts still run by default, but installs print a list of packages whose scripts have not been reviewed. A future release will block unreviewed install scripts."
- **Justification:** Local Node 26 ships npm 11.20, and `npm@latest` is 12.2.2. Without an entry, any npm 12 install (CI, Vercel or a laptop) would silently leave no binary. A pinned entry keeps the approval tied to the reviewed 5.3.0.

### [C7] — ffmpeg `-ss` as an input option, and `-noaccurate_seek`
- **Relevant File(s):** `integrations/video-frames/ffmpeg.ts`
- **Change Summary:** Take the keyframe at or before 1 s (D3), decoding a single frame.
- **Source URL:** https://ffmpeg.org/ffmpeg.html#Main-options (HTTP Last-Modified 7 Nov 2026)
- **Verbatim Quote:**
  > "When used as an input option (before -i), seeks in this input file to position. Note that in most formats it is not possible to seek exactly, so ffmpeg will seek to the closest seek point before position. When transcoding and -accurate_seek is enabled (the default), this extra segment between the seek point and position will be decoded and discarded. When doing stream copy or when -noaccurate_seek is used, it will be preserved."
- **Justification:** With `-noaccurate_seek` the first output frame is the keyframe the seek lands on, so ffmpeg decodes one frame instead of up to a GOP. That bounds CPU and memory on 1 vCPU.

### [C8] — ffmpeg `-frames`, `-map`, `-an`
- **Relevant File(s):** `integrations/video-frames/ffmpeg.ts`
- **Change Summary:** Output exactly one frame from the first video stream, with no audio, subtitles or data.
- **Source URL:** https://ffmpeg.org/ffmpeg.html#Main-options ; https://ffmpeg.org/ffmpeg.html#Audio-Options
- **Verbatim Quote:**
  > "-frames[:stream_specifier] framecount (output,per-stream) Stop writing to the stream after framecount frames."
  > "Create one or more streams in the output file."
  > "As an output option, disables audio recording i.e. automatic selection or mapping of any audio stream."
- **Justification:** `-map 0:v:0 -frames:v 1 -an -sn -dn` selects the first video stream only and stops after one frame, so iPhone metadata and audio tracks are never decoded.

### [C9] — ffmpeg `-f` (forced input format) and `-nostdin`
- **Relevant File(s):** `integrations/video-frames/ffmpeg.ts`, `features/memories/derive-poster.ts`
- **Change Summary:** Force the demuxer chosen from sniffed bytes, and disable stdin interaction.
- **Source URL:** https://ffmpeg.org/ffmpeg.html#Main-options ; https://ffmpeg.org/ffmpeg.html#stdin-option
- **Verbatim Quote:**
  > "-f fmt (input/output) Force input or output file format. The format is normally auto detected for input files and guessed from the file extension for output files, so this option is not needed in most cases."
  > "-stdin Enable interaction on standard input. On by default unless standard input is used as an input. To explicitly disable interaction you need to specify -nostdin."
- **Justification:** Uploads are untrusted. Forcing `mov`/`matroska` from our own sniff stops ffmpeg probing an upload as a playlist or concat list, and `-nostdin` keeps a background child from waiting on the terminal.

### [C10] — ffmpeg HTTP `seekable` and `protocol_whitelist`
- **Relevant File(s):** `integrations/video-frames/ffmpeg.ts`
- **Change Summary:** Tell ffmpeg the loopback input is seekable; allow only `http,tcp`.
- **Source URL:** https://ffmpeg.org/ffmpeg-protocols.html#http ; https://ffmpeg.org/ffmpeg-protocols.html#Protocol-Options
- **Verbatim Quote:**
  > "seekable Control seekability of connection. If set to 1 the resource is supposed to be seekable, if set to 0 it is assumed not to be seekable, if set to -1 it will try to autodetect if it is seekable. Default value is -1."
  > "protocol_whitelist list (input) Set a ","-separated list of allowed protocols. "ALL" matches all protocols. Protocols prefixed by "-" are disabled. All protocols are allowed by default but protocols used by an another protocol (nested protocols) are restricted to a per protocol subset."
- **Justification:** A moov-after-mdat MOV needs seeking back and forth, so `-seekable 1` removes autodetection doubt. With every protocol allowed by default, the whitelist stops a malicious file reaching `file:` or the network.

### [C11] — ffmpeg demuxer security notes
- **Relevant File(s):** `integrations/video-frames/ffmpeg.ts`, `features/memories/derive-poster.ts`
- **Change Summary:** Keep `use_absolute_path` off (the default) and never let the concat or HLS demuxers see an upload.
- **Source URL:** https://ffmpeg.org/ffmpeg-formats.html#mov_002fmp4_002f3gp ; https://ffmpeg.org/ffmpeg-formats.html#Format-Options ; https://ffmpeg.org/ffmpeg-formats.html#concat
- **Verbatim Quote:**
  > "use_absolute_path Allows loading of external tracks via absolute paths, disabled by default. Enabling this poses a security risk. It should only be enabled if the source is known to be non-malicious."
  > "format_whitelist list (input) "," separated list of allowed demuxers. By default all are allowed."
  > "safe If set to 1, reject unsafe file paths and directives."
- **Justification:** The docs name the external-reference risks. The plan keeps the risky option at its safe default and forces the demuxer ([C9]), so the concat and HLS paths never run on contributor bytes.

### [C12] — ffmpeg `-autorotate`
- **Relevant File(s):** `integrations/video-frames/ffmpeg.ts`, `__tests__/integrations/video-frames.test.ts`
- **Change Summary:** Rely on default autorotation so portrait phone clips give portrait posters; test it.
- **Source URL:** https://ffmpeg.org/ffmpeg.html#Video-Options
- **Verbatim Quote:**
  > "-autorotate Automatically rotate the video according to file metadata. Enabled by default, use -noautorotate to disable it."
- **Justification:** iPhone portrait video stores a display matrix rather than rotated pixels. Leaving autorotate on applies it, and the `-display_rotation 90` fixture proves it.

### [C13] — ffmpeg `scale` with `force_original_aspect_ratio`
- **Relevant File(s):** `integrations/video-frames/ffmpeg.ts`
- **Change Summary:** Shrink the frame to ≤1000 px on its long edge before PNG output.
- **Source URL:** https://ffmpeg.org/ffmpeg-filters.html#scale-1 (§11.223 scale)
- **Verbatim Quote:**
  > "force_original_aspect_ratio Enable decreasing or increasing output video width or height if necessary to keep the original aspect ratio."
  > "‘decrease’ The output video dimensions will automatically be decreased if needed."
- **Justification:** `scale=w=1000:h=1000:force_original_aspect_ratio=decrease` keeps the shape and bounds the PNG on stdout (well under `maxBuffer`) before sharp's final encode.

### [C14] — ffmpeg `zscale` and `tonemap` (HDR)
- **Relevant File(s):** `integrations/video-frames/ffmpeg.ts`, `lib/video-track.ts`, `__tests__/lib/video-track.test.ts`, `__tests__/fixtures/README.md`
- **Change Summary:** Detect HLG/PQ from `colr`, and only then tone-map to BT.709 (D5).
- **Source URL:** https://ffmpeg.org/ffmpeg-filters.html#zscale ; https://ffmpeg.org/ffmpeg-filters.html#tonemap
- **Verbatim Quote:**
  > "Scale (resize) the input video, using the z.lib library: https://github.com/sekrit-twc/zimg. To enable compilation of this filter, you need to configure FFmpeg with --enable-libzimg."
  > "Tone map colors from different dynamic ranges. This filter expects data in single precision floating point, as it needs to operate on (and can output) out-of-range values. Another filter, such as zscale, is needed to convert the resulting frame to a usable format."
  > "The tonemapping algorithms implemented only work on linear light, so input data should be linearized beforehand (and possibly correctly tagged)."
  > "ffmpeg -i INPUT -vf zscale=transfer=linear,tonemap=clip,zscale=transfer=bt709,format=yuv420p OUTPUT"
- **Justification:** Tone mapping needs linear light and libzimg; the static build has libzimg ([C5]). Applying it to SDR would darken it, so `lib/video-track.ts` decides per file from the `colr` transfer value. The chain starts from the documented example.

### [C15] — ffmpeg `image2pipe` and the `pipe:` protocol
- **Relevant File(s):** `integrations/video-frames/ffmpeg.ts`
- **Change Summary:** Write the PNG to stdout; no file is written.
- **Source URL:** https://ffmpeg.org/ffmpeg-formats.html#image2_002c-image2pipe ; https://ffmpeg.org/ffmpeg-protocols.html#pipe
- **Verbatim Quote:**
  > "The ‘image2pipe’ muxer accepts the same options as the ‘image2’ muxer, but ignores the pattern verification and expansion, as it is supposed to write to the command output rather than to an actual stored file."
  > "If number is not specified, by default the stdout file descriptor will be used for writing, stdin for reading."
- **Justification:** `-f image2pipe -c:v png pipe:1` returns the frame through `execFile`'s buffered stdout ([C16]). Nothing touches the shared `/tmp`.

### [C16] — Node `child_process.execFile`
- **Relevant File(s):** `integrations/video-frames/ffmpeg.ts`, `__tests__/integrations/video-frames.test.ts`
- **Change Summary:** Spawn ffmpeg without a shell, with an empty environment, a hard timeout, SIGKILL and an output cap.
- **Source URL:** https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback (Node.js v26.13.0)
- **Verbatim Quote:**
  > "The child_process.execFile() function is similar to child_process.exec() except that it does not spawn a shell by default. Rather, the specified executable file is spawned directly as a new process making it slightly more efficient than child_process.exec()."
  > "env <Object> Environment key-value pairs. Default: process.env."
  > "maxBuffer <number> Largest amount of data in bytes allowed on stdout or stderr. If exceeded, the child process is terminated and any output is truncated."
  > "killSignal <string> | <integer> Default: 'SIGTERM'"
- **Justification:**
  - No shell means no injection through arguments.
  - `env: {}` replaces the default `process.env`, so secrets are not handed to the child.
  - `maxBuffer` bounds memory.
  - `killSignal: "SIGKILL"` overrides SIGTERM, so a wedged decoder cannot outlive the timeout.

### [C17] — Node `http.createServer` and `listen(0, "127.0.0.1")`
- **Relevant File(s):** `integrations/video-frames/frame-server.ts`
- **Change Summary:** A one-shot server on a random loopback port.
- **Source URL:** https://nodejs.org/api/http.html#httpcreateserveroptions-requestlistener ; https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback
- **Verbatim Quote:**
  > "Returns a new instance of http.Server. The requestListener is a function which is automatically added to the 'request' event."
  > "If port is omitted or is 0, the operating system will assign an arbitrary unused port, which can be retrieved by using server.address().port after the 'listening' event has been emitted."
  > "If host is omitted, the server will accept connections on the unspecified IPv6 address (::) when IPv6 is available, or the unspecified IPv4 address (0.0.0.0) otherwise."
- **Justification:** Port 0 avoids collisions between concurrent derives in one Fluid instance. Passing `127.0.0.1` explicitly avoids the documented default of all interfaces, so nothing off-host can reach the server.

### [C18] — Node `stream.pipeline`
- **Relevant File(s):** `integrations/video-frames/frame-server.ts`
- **Change Summary:** Pipe the lazily-read windows into the response with backpressure and cleanup.
- **Source URL:** https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-callback ; https://nodejs.org/api/stream.html#piping-to-writable-streams-from-async-iterators
- **Verbatim Quote:**
  > "A module method to pipe between streams and generators forwarding errors and properly cleaning up and provide a callback when the pipeline is complete."
  > "stream.pipeline() abstracts away the handling of backpressure and backpressure-related errors:"
- **Justification:** The windows come from an async generator over `readRange`. The pipeline pulls the next window only when ffmpeg drains the socket, and it tears down when ffmpeg closes early, so no unbounded Blob reads happen.

### [C19] — RFC 9110 byte ranges, 206 and Content-Range
- **Relevant File(s):** `integrations/video-frames/frame-server.ts`, `__tests__/integrations/frame-server.test.ts`, `__tests__/integrations/video-frames.test.ts`
- **Change Summary:** Answer `bytes=a-` and `bytes=a-b` with a correct single-part 206.
- **Source URL:** https://www.rfc-editor.org/rfc/rfc9110.html#name-byte-ranges ; https://www.rfc-editor.org/rfc/rfc9110.html#partial.single
- **Verbatim Quote:**
  > "If the last-pos value is absent, or if the value is greater than or equal to the current length of the representation data, the byte range is interpreted as the remainder of the representation"
  > "If a single part is being transferred, the server generating the 206 response MUST generate a Content-Range header field, describing what range of the selected representation is enclosed, and a content consisting of the range."
- **Justification:** ffmpeg opens with an open-ended range and re-requests on every seek. Serving the remainder with a 206 and Content-Range is what lets it treat the input as seekable ([C10]); the tests assert those headers.

### [C20] — Vercel Blob `get()`, and the repo's Range precedent
- **Relevant File(s):** `integrations/video-frames/frame-server.ts` (through the injected `read`), `features/memories/derive-poster.ts`
- **Change Summary:** Reuse the existing `storage.readRange` (private `get()` with a Range header and strict Content-Range checks) for every window; add no new storage method.
- **Source URL:** https://vercel.com/docs/vercel-blob/using-blob-sdk#get-a-blob ("Last updated August 26, 2026"); repo `integrations/vercel-blob/index.ts:162-200`
- **Verbatim Quote:**
  > "Retrieve blob content as a stream. For private blobs, this is how you deliver files through your functions."
  > "headers | No | Additional headers to include in the fetch request. The authorization header is set automatically."
  > (repo) "// The SDK reports 206 as 200; only Content-Range establishes which bytes"
- **Justification:** The Blob docs document custom headers but say nothing about Range or 206 (a gap the research confirmed). The repo's `readRange` already validates Content-Range strictly and has served video-GPS reads in production since PR #94. Reusing it keeps one tested path.

### [C21] — sharp: `fit: inside`, mozjpeg, metadata stripped
- **Relevant File(s):** `services/images/types.ts`, `services/images/index.ts`, `integrations/images/sharp-heic.ts`, `features/memories/derive-poster.ts`
- **Change Summary:** A thumbnail-only slot method that re-encodes the PNG frame at the THUMBNAIL spec.
- **Source URL:** https://sharp.pixelplumbing.com/api-resize#resize ; https://sharp.pixelplumbing.com/api-output#keepmetadata (sharp v0.35.5)
- **Verbatim Quote:**
  > "inside: Preserving aspect ratio, resize the image to be as large as possible while ensuring its dimensions are less than or equal to both those specified."
  > "The default behaviour, when keepMetadata is not used, is to convert to the device-independent sRGB colour space and strip all metadata, including the removal of any ICC profile."
- **Justification:** The existing `encodeThumb` already uses `fit: inside` and the default (stripping) output. Routing the frame through it gives posters the same bounded, metadata-free JPEG as photo thumbnails (D4), with no GPS in the output.

### [C22] — Next.js `after()`
- **Relevant File(s):** `app/api/upload/route.ts`, `features/memories/ingest-upload.ts`, `features/admin/attach-media.ts`, `features/memories/notify-admins.ts`, `features/memories/complete-submission.ts`
- **Change Summary:** Posters, and the alert's preview wait, run after the response within the route's duration.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/after (and #duration; v16.4.5, "Last updated September 16, 2026")
- **Verbatim Quote:**
  > "after allows you to schedule work to be executed after a response (or prerender) is finished. This is useful for tasks and other side effects that should not block the response, such as logging and analytics."
  > "after will run for the platform's default or configured max duration of your route."
- **Justification:** Poster extraction must not delay the callback, MCP or alert responses. The deadlines (15 s callback, MCP's remaining `deadlineAt`, a 15 s preview wait) are sized to fit each route's max duration.

### [C23] — Vercel `maxDuration` for the App Router
- **Relevant File(s):** `app/api/cron/reconcile-uploads/route.ts`, `features/admin/attach-media.ts`
- **Change Summary:** Keep the existing `maxDuration` exports; size (g2)'s 20 s and MCP's poster budget inside them.
- **Source URL:** https://vercel.com/docs/functions/configuring-functions/duration#maximum-duration-for-different-runtimes ("Last updated August 24, 2026")
- **Verbatim Quote:**
  > "For example, Next.js pages router and Node.js /api routes use an exported config object, while the Next.js app router uses a named maxDuration export."
- **Justification:** The cron exports `maxDuration = 60` (`RUN_DEADLINE_MS` 50 s) and MCP exports 30. (g2) takes 20 s of the cron run, and the MCP poster uses only what `deadlineAt` leaves, deferring to the cron otherwise.

### [C24] — Sentry `startSpan` and `withIsolationScope`
- **Relevant File(s):** `features/memories/derive-poster.ts`, `app/api/cron/reconcile-uploads/route.ts`
- **Change Summary:** One `media.poster` span per extraction; each (g2) item in its own isolation scope.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/tracing/instrumentation/#starting-an-active-span-startspan ; https://docs.sentry.io/platforms/javascript/guides/nextjs/enriching-events/scopes/#using-withisolationscope
- **Verbatim Quote:**
  > "For most scenarios, we recommend to start active spans with Sentry.startSpan(). This will start a new span that is active in the provided callback, and will automatically end the span when the callback is done."
  > "But in cases where you e.g. want to isolate a non-request process (e.g. a background job), you can use withIsolationScope to create a new isolation scope that is only active for the duration of the callback:"
- **Justification:** Rob's alpha telemetry policy wants every step visible. A span around ffmpeg times the expensive part, and (g2) copies (g)'s per-item isolation, so one bad video's tags never leak onto another's events.

### [C25] — Sentry `httpIntegration` `ignoreIncomingRequests`
- **Relevant File(s):** `instrumentation.ts`, `lib/video-frames.ts`
- **Change Summary:** Do not trace the loopback frame server's requests.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/integrations/http/#ignoreincomingrequests
- **Verbatim Quote:**
  > "It captures spans for incoming and outgoing HTTP requests."
  > "Allows you to define a method to filter out incoming requests based on the URL. If the method returns true, no span or transaction will be captured for the incoming request."
- **Justification:** Without the filter, each ffmpeg range request would become a transaction at the 100 % sample rate. Filtering on `FRAME_SERVER_PREFIX` keeps the `media.poster` span ([C24]) as the single record.

### [C26] — MDN `<video>` `poster` and `preload`
- **Relevant File(s):** `app/memories/_components/video-player.tsx`, `app/admin/media-gallery.tsx`, `features/media/serve-media.ts`, `features/admin/get-memory.ts`, `docs/features/see-memories.md`
- **Change Summary:** Add `poster` beside `preload="none"`; make the thumb URL always an image (D7).
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video#poster (and #preload; "last modified on Jul 16, 2026")
- **Verbatim Quote:**
  > "A URL for an image to be shown while the video is downloading. If this attribute isn't specified, nothing is displayed until the first frame is available, then the first frame is shown as the poster frame."
  > "none: Indicates that the video should not be preloaded."
- **Justification:** With `preload="none"` no frame ever loads before play, which is why the player shows an empty box. `poster` must be an image URL, so `serve-media` returns the POSTER JPEG for `v=thumb` or 404, never the video bytes.

### [C27] — Next.js `<Image>` `fill` and `unoptimized`
- **Relevant File(s):** `app/memories/_components/memory-card.tsx`, `features/memories/public.ts`, `lib/memories/types.ts`
- **Change Summary:** The card renders the poster as a fill image with `object-cover`, served as-is.
- **Source URL:** https://nextjs.org/docs/app/api-reference/components/image#fill ; https://nextjs.org/docs/app/api-reference/components/image#unoptimized (v16.4.5, "Last updated November 6, 2026")
- **Verbatim Quote:**
  > "A boolean that causes the image to expand to the size of the parent element."
  > "If no styles are applied to the image, the image will stretch to fit the container. You can use objectFit to control cropping and scaling."
  > "true: The source image will be served as-is from the src instead of changing quality, size, or format."
- **Justification:** `PhotoSlot` already uses `fill unoptimized object-cover` through `FallbackImage`. `VideoSlot` copies it: the poster is already a sized JPEG, and `object-cover` crops it into the 16:9 slot. The read model supplies `poster.mediaId` for the URL.

### [C28] — SendGrid inline attachments (`content_id`)
- **Relevant File(s):** `features/memories/admin-previews.ts`, `docs/features/email-and-cron.md`
- **Change Summary:** Previews travel as inline attachments referenced by content id.
- **Source URL:** https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send#request-body (dateModified 2025-09-25)
- **Verbatim Quote:**
  > "The content_id is used when the disposition is set to inline and the attachment is an image, allowing the file to be displayed within the body of the email."
- **Justification:** The template already emits inline attachments with `contentId` (`shared.ts:166`). The loader only has to supply base64 JPEG bytes and an id, so pictures arrive without remote image URLs.

### [C29] — RFC 2392 `cid:` URLs
- **Relevant File(s):** `features/memories/admin-previews.ts`
- **Change Summary:** Content ids are `preview-<mediaId>`, checked against the template's `CONTENT_ID` rule.
- **Source URL:** https://www.rfc-editor.org/rfc/rfc2392.html#section-2
- **Verbatim Quote:**
  > "A "cid" URL is converted to the corresponding Content-ID message header [MIME] by removing the "cid:" prefix, converting the % encoded character to their equivalent US-ASCII characters, and enclosing the remaining parts with an angle bracket pair, "<" and ">"."
- **Justification:** UUIDs with a `preview-` prefix are plain lowercase ASCII. `cid:preview-<uuid>` therefore maps to its Content-ID with no escaping, which matches the template's `/^[a-z0-9-]+$/` rule and its tests.

### [C30] — Prisma `//` comments are not in the AST
- **Relevant File(s):** `prisma/schema.prisma`
- **Change Summary:** Update the POSTER enum comment; no migration.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-schema/overview#comments (dateModified 2026-09-18)
- **Verbatim Quote:**
  > "// comment: This comment is for the reader's clarity and is not present in the abstract syntax tree (AST) of the schema."
- **Justification:** The `POSTER` value already exists. Rewording its `//` comment (which still says "browser-captured staging upload") changes nothing Prisma sees, so no migration or client change is needed.

### [C31] — GNU GPL FAQ: separate programs; private use
- **Relevant File(s):** `docs/dependencies.md`
- **Change Summary:** Record why spawning the GPLv3 binary server-side is acceptable for this public repo (D10).
- **Source URL:** https://www.gnu.org/licenses/gpl-faq.html#MereAggregation ; https://www.gnu.org/licenses/gpl-faq.html#UnreleasedMods (Updated 2026/01/13)
- **Verbatim Quote:**
  > "By contrast, pipes, sockets and command-line arguments are communication mechanisms normally used between two separate programs. So when they are used for communication, the modules normally are separate programs."
  > "The GPL permits anyone to make a modified version and use it without ever distributing it to others."
- **Justification:** The app talks to ffmpeg only through arguments, a stdout pipe and a loopback socket, and the binary is neither committed nor shipped to visitors. Both points are documented, with FU-5 as the exit if counsel disagrees.

### [C32] — Repo layering and `server-only`
- **Relevant File(s):** `integrations/video-frames/*`, `services/video-frames/*`, `lib/mp4-boxes.ts`, `lib/video-track.ts`, `lib/video-gps.ts`, `lib/video-frames.ts`, `AGENTS.md`, `docs/code-layout.md`
- **Change Summary:** Place the new modules by layer and record them in the layer list.
- **Source URL:** repo `AGENTS.md` § "Layers and import direction" (origin/main c837789)
- **Verbatim Quote:**
  > "`app/ → features/ → services/ → integrations/`. A layer imports only from layers below it plus `lib/` and `server/`."
  > "`integrations/*`, `server/*` and anything that reads secrets start with `import "server-only"`."
  > "One exception: `integrations/*` may import **types** from `services/*/types` (they implement those interfaces); value imports stay forbidden."
- **Justification:**
  - The frame server and runner are vendor-binary integrations (`server-only`), and the service factory composes them.
  - `derivePoster` (a feature) supplies the storage-backed `read`, so the integration never imports storage.
  - The pure box parsers live in `lib/`.

### [C33] — Repo TDD rule and required checks
- **Relevant File(s):** every new or changed `__tests__/**` file named in T1–T14, `scripts/check-traces.ts`, `package.json` (`build` script)
- **Change Summary:** Tests first on the finalize, cron and confirmation paths; `check-traces` joins the build that `build:offline` runs.
- **Source URL:** repo `AGENTS.md` § "Rules every agent follows" and § "Checks"
- **Verbatim Quote:**
  > "TDD for critical paths (upload tickets, finalize, confirmation, cron)."
  > "Never hide an error to keep moving. Fix the root cause with best-practice code."
  > "`npm run validate` (= `next typegen && tsc --noEmit`, then `eslint`), `npm run test:run`, `npm run build:offline`"
- **Justification:** T6–T8 and T14 touch finalize, cron and the alert, so every task names its failing tests first. A missing binary must fail the build loudly rather than leave posters silently absent.

### [C34] — Repo rule: only the admin alert may carry previews (issue #46)
- **Relevant File(s):** `features/memories/admin-previews.ts`, `features/memories/media-summary.ts`, `features/memories/notify-admins.ts`
- **Change Summary:** Fill `preview` for the admin alert; contributor receipts are unchanged.
- **Source URL:** repo `services/email/templates/shared.ts:127` and `features/memories/media-summary.ts:25-30`
- **Verbatim Quote:**
  > "Who reads the email: the admins may see uploaded previews and filenames; a contributor's receipt shows kinds and lengths only (issue #46, D1 and review #6)."
  > "`preview` stays null until the derived-media pipeline (issue #17 PR A) fills it here. Only the admin audience may see previews"
- **Justification:** The comment names the exact hook (`summarizeReadyMedia`) and audience. PR-3 fills it for admins only, and the template's own audience guard keeps receipts picture-free.

### [C35] — Repo: POSTER rows use the same claim/publish protocol
- **Relevant File(s):** `features/memories/derived-claims.ts`, `features/memories/derive-media.ts`, `features/memories/derive-poster.ts`
- **Change Summary:** Extract the claim and publish helpers; `derivePoster` reuses them.
- **Source URL:** repo `docs/plans/2026-11-03-photos-derived-media.md:219` (§3.6)
- **Verbatim Quote:**
  > "The browser-capture flow, the `kind: "poster"` upload ticket and `attachPosterPreview` are defined in the email plan § 3.4 `[C47]` and will create POSTER rows through the same claim/publish protocol (§ 3.2) in a later PR; A–C create none."
- **Justification:** The source of POSTER bytes changes (R-P1), but the original design's invariant stands: POSTER rows go through the same claim/publish protocol. Hence the extraction in T5, with `derive-media.test.ts` unchanged as proof.

### [C36] — Repo: background writes to `Media` move `reviewVersion`
- **Relevant File(s):** `features/memories/derive-poster.ts`
- **Change Summary:** Publishing a POSTER never updates the `Media` row (D6).
- **Source URL:** repo `lib/review-version.ts:9-13`
- **Verbatim Quote:**
  > "Background work on a file (the location scan, the hash) also moves `updatedAt`, so a version can go stale without a visible change; re-reading is the answer either way."
- **Justification:** The cron backfills six approved public videos. Writing width/height to `Media` would move `updatedAt` and stale any `reviewVersion` Rob holds in MCP, so posters keep their dimensions on the `DerivedMedia` row only.

### [C37] — Repo: the upload callback already derives whenever the file is READY
- **Relevant File(s):** `app/api/upload/route.ts`
- **Change Summary:** Add a poster task beside the existing derive in the callback; this is the browser-upload producer for D1.
- **Source URL:** repo `app/api/upload/route.ts:118-120`
- **Verbatim Quote:**
  > "Closed-tab backstop for the derived copies; finalize normally gets there first and the claim rows make the race harmless. A failure here is not a callback failure: cron (g) retries."
- **Justification:** The callback runs for every browser upload and acts on any READY outcome, whoever made it READY. That makes it a reliable place to derive posters without tracing ffmpeg into the contributor page functions. The claim rows already make duplicate attempts harmless, and (g2) mirrors (g)'s retry.

### [C38] — Repo: R3, the ruling R-P1 supersedes
- **Relevant File(s):** `docs/plans/phase1-ledger.md`, `docs/2026-11-04-debt-catalog.md`, `docs/features/media-uploads.md`, `README.md`
- **Change Summary:** Mark R3 superseded by R-P1 (server-side ffmpeg, Rob 2026-11-08); close M-B-01.
- **Source URL:** repo `docs/plans/2026-11-03-confirmation-email-preview.md:23`
- **Verbatim Quote:**
  > "| R3 | Video posters are **captured in the browser** at upload time and uploaded as a derived JPEG. | — |"
- **Justification:** The docs still describe the browser-capture plan. Recording the supersession with Rob's date keeps the decision trail correct for later agents.
