# Voice recorder feedback: level meter, silence warning, device picker, permission help, real durations

## Context

Rob recorded a test memory on www.jowray.com/share from his Mac. The row landed as READY (`Media` 4e14e723…, 6 143 bytes, `audio/webm`). Pulled from Blob and measured with ffmpeg: **24 s of pure digital silence** (mean and peak −91 dBFS). Headset recordings from the same machine are fine.

The exact cause on Rob's Mac is **unconfirmed** (premortem P11). Chromium issue 41437397 documented exactly this symptom — OS-level microphone denial making `getUserMedia` **succeed with an all-zero stream** `[C1]` — but it is marked *Fixed* in Chrome 73, which now throws `NotAllowedError` instead. On current Chrome the likeliest causes are the macOS *Sound → Input* volume at zero, or the system default input being an idle Bluetooth headset or a virtual/aggregate device. All of these look identical to the page: a stream of silence. `app/share/recorder.ts` calls `getUserMedia({ audio: true })` with no device choice, no level feedback and no silence check, and `share-form.tsx` shows the raw `error.message` on permission errors. A contributor can talk for a minute and send the family a silent file without knowing.

Two smaller defects on the same rows: Chrome's WebM has no duration header, so `<audio controls>` shows a broken timeline (ffprobe `Duration: N/A`) `[C21]`; and `recorder.ts` measures `durationMs` but `Media.durationSeconds` (column exists, `prisma/schema.prisma:144`, no migration needed) is never written.

Outcome: on any phone or desktop browser the contributor sees they are being heard while they talk, is told within ~3 s when they are not (with steps for their OS), can pick a microphone on desktop, cannot send a silent clip by accident, and gets a player with a real timeline. Capture stays on native `MediaRecorder` (already right: Opus/WebM on Chrome/Firefox/Safari 18.4+, `audio/mp4` on older iOS Safari). No capture library; ElevenLabs is post-capture only (transcription, isolation).

## Decisions (Rob, 2026-11-03: "let's do all these things")

1. Native `MediaRecorder` + existing `pickRecordingType()`. No wavesurfer.js (1.6 MB for a meter we draw in ~80 lines).
2. Live meter: scrolling bar waveform on a `<canvas>` from an `AnalyserNode` `[C2]`; elapsed time; red recording dot. `prefers-reduced-motion` → static level bar, no pulse `[C16, C18]`.
3. **(Revised after premortem P1, Rob 2026-11-03: warn, never delete.)** Silence while recording (rolling 3 s window, −60 dBFS threshold, first verdict at 3 s): "We're not hearing anything" + OS steps, no auto-stop. On Stop every clip is kept and playable. The clip carries a `verdict`: `heard` (≥ 200 ms above threshold), `suspectedSilent` (analysed, nothing heard), or `unchecked` (analyser never ran, or coverage gaps > 500 ms). `suspectedSilent` → the player shows "This recording sounds silent" and the Send button becomes a two-step "Send anyway / Record again"; `unchecked` → "We couldn't check this recording — play it back before you send". Nothing is ever discarded automatically; missing analysis is never evidence of silence.
4. Device picker after permission (`enumerateDevices()` labelled `audioinput`s `[C10]`), shown only when ≥ 2; always "Using: <mic label>" `[C12]`. `devicechange` refreshes `[C11]`. Select disabled while recording. Selected device that vanished → retry `{ audio: true }` `[C9]`.
5. Permission help: `getUserMedia` error names `[C8]` + silent-stream case `[C1]` → copy per platform (mac-chrome, mac-safari, mac-firefox, ios, android, windows-chromium, windows-firefox, other), each step set taken from the vendor's own support page `[C29–C35]`. UA only picks copy, never gates features.
6. Duration: `fix-webm-duration@1.0.6` (MIT, typed, 28 KB, no deps) patches the EBML header for `audio/webm` blobs only `[C21]`; `durationSeconds` sent with file metadata `[C22]`, stored on the PENDING `Media` row `[C23]`, shown on the claim page.
7. Decision logic in pure `lib/` modules with Vitest tests (node env `[C24]`, `__tests__/**/*.test.ts` only `[C25]`; no jsdom/Playwright). Browser glue thin in `app/share/` `[C14, C27]`.
8. Branch `feat/recorder-feedback` cut from `main` at **`636ddfd`** (PR #16 merged after the plan was drafted), PR to `main` `[C27]`. This file (`docs/plans/2026-11-03-recorder-feedback.md`) is the runbook; the ledger at the end is authoritative over the body where they differ.
10. **(Rob, 2026-11-03, premortem P4)** Draft autosave: the five text fields (`name`, `relationship`, `approxDateText`, `place`, `note`) are saved to `localStorage` key `jowray.share.draft.v1` (debounced 500 ms), restored on mount, cleared on successful send and by "Tell another one". Pure helpers in `lib/share-draft.ts` (serialize / parse with zod, 30-day expiry) with tests; the hook `app/share/use-share-draft.ts` wraps `localStorage` in try/catch. Help copy says "Your written words are kept on this device until you send them."
11. **(Rob, 2026-11-03, premortem P14)** The engine takes injectable browser factories (`{ mediaDevices, createAudioContext, createMediaRecorder, now }`, browser defaults) so lifecycle tests run in Node; those tests are written by a delegated worker after the engine lands.
9. **Premortem first (Rob, 2026-11-03):** before any code, run the Oscar (Codex) premortem using `docs/workflows/premortum.md`'s question. PREP is staged: `REVIEW_TMP=/tmp/review-anything-20261103-142524-fa67b62`, prompt at `/Users/rob/.claude/plans/what-s-missing-is-feedback-enumerated-bumblebee-agent-a25c3f49dcc59b8a6.md` (plan mode blocked the `cp` into `REVIEW_TMP`). Fold its findings into the `docs/plans/` copy as rulings before step 1 below.

## Architecture

Hot data (100 ms levels) never goes through React state. `AudioRecorder` (engine, `app/share/recorder.ts`) owns `MediaStream`, `MediaRecorder`, `AudioContext`/`AnalyserNode`, a `Float32Array(60)` ring buffer of dBFS and an immutable **snapshot**; it exposes `subscribe()/getSnapshot()/getServerSnapshot()` and a `useRecorder()` hook consumes it via `useSyncExternalStore` `[C13]` (pattern already in `share-form.tsx:47`). OS-interrupted stops (screen lock, phone call) fire `MediaRecorder`'s `stop` event `[C7]`, which updates the snapshot so the UI follows without a tap. Phase transitions go through a pure reducer so double-tap and OS-stop cases are unit-tested.

## New pure modules (TDD first)

**`lib/audio-level.ts`** `[C2, C1]`
- Constants: `SILENCE_FLOOR_DBFS = -100`, `SILENCE_THRESHOLD_DBFS = -60`, `SILENCE_GRACE_MS = 3000`, `SILENCE_WINDOW_MS = 3000`, `MIN_LOUD_MS = 200`.
- `rmsDbfs(samples)` → `20·log10(rms)` clamped ≥ −100 (empty/zeros → −100); `byteSampleToFloat(v)` = `(v−128)/128`; `levelToBarHeight(dbfs, floor=-60)` → 0..1 linear in dB.
- `SilenceState { startedAt, lastObservedAt, lastLoudAt, loudMs, observedMs, coverageGap, peakDbfs }` (all times from `performance.now()`-style monotonic `now`; `observedMs` counts analysed ticks at a fixed `TICK_MS = 100` each, never wall time, P17); `createSilenceState(now)`; `observeLevel(state, dbfs, now)` (a gap `> MAX_GAP_MS = 500` since `lastObservedAt` sets `coverageGap`); `hearingVerdict(state, now): "unknown" | "listening" | "hearing" | "silent"` (no observations → unknown; loud within window → hearing; under grace and never loud → listening; else silent); `clipVerdict(state): "heard" | "suspectedSilent" | "unchecked"` = `loudMs ≥ MIN_LOUD_MS` → heard; `observedMs === 0 || coverageGap` → unchecked; else suspectedSilent.

**`lib/recorder-help.ts`** `[C8, C1, C29–C35]`
- `RecorderProblem = "not-allowed" | "not-found" | "not-readable" | "overconstrained" | "security" | "silent" | "unsupported" | "unknown"`; `problemFromError(error)` maps DOMException names `[C8]` incl. legacy (`PermissionDeniedError`, `DevicesNotFoundError`, `TrackStartError`, `ConstraintNotSatisfiedError`).
- `Platform` union above; `detectPlatform(userAgent, maxTouchPoints=0)` (iPadOS = Macintosh UA + touch; CriOS/FxiOS → ios).
- `helpFor(problem, platform): { title, body, steps[] }`. Every cell non-empty. Steps are the vendor's own: macOS System Settings → Privacy & Security → Microphone `[C29]` (named for `silent`/`not-allowed` on mac-*, then quit and reopen the browser `[C1]`), plus Chrome site settings `[C32]`, Safari → Settings → Websites → Microphone `[C31]`, iPhone Settings → Privacy & Security → Microphone `[C30]`, Android Chrome Site settings `[C33]`, Firefox Permissions → Microphone and the address-bar icon `[C34]`, Windows Settings → Privacy & security → Microphone incl. "Let desktop apps access your microphone" `[C35]`. `unsupported` → "attach a voice memo with the file field".

**`lib/recording-devices.ts`** `[C10, C9, C12]`
- `audioInputsFor(devices)` → `audioinput` with non-empty label `[C10]`; drop Chrome pseudo `default`/`communications` when another entry shares `groupId`; keep order. `shouldShowPicker(inputs)` = length ≥ 2. `resolveSelectedDevice(savedId, inputs)` → id or null. `audioConstraintsFor(deviceId)` → `{ audio: { deviceId: { exact } } }` | `{ audio: true }` `[C9]`. `describeActiveInput(track, inputs)` → track label `[C12]` → match by id → "your microphone".

**`lib/recorder-state.ts`** `[C13, C7]`
- `RecorderStatus`: `idle | requesting | recording{startedAt, hearing, elapsedSeconds, interrupted: boolean} | finishing | clip{durationMs, verdict: "heard" | "suspectedSilent" | "unchecked", warning?: "partial"} | error{problem}`.
- `RecorderEvent`: `start | granted{now} | failed{problem} | hearing{hearing} | tick{now} | interrupted | resumed | stop | ended | finished{durationMs, verdict, partial?} | discard`.
- `reduceRecorder(state, event)` (full table, premortem P7/P2): idle/clip/error –start→ requesting; requesting –granted{now}→ recording (startedAt = now), –failed→ error; recording –hearing/tick→ recording (same reference when nothing changed `[C13]`); recording –interrupted→ recording{interrupted:true}, –resumed→ {interrupted:false}; recording –stop|ended→ finishing (`ended` = the track ended without a user tap `[C7]`); recording/finishing –failed→ error; finishing –finished→ clip; clip –discard→ idle; requesting/recording/finishing –cancel→ idle; everything else returns `state` unchanged (double-tap guard). `elapsedSeconds` comes from the wall clock on `tick`, never from the analyser.

## Engine: `app/share/recorder.ts`

Keep `pickRecordingType`, `Recording` (+ `verdict`, `partial`). `AudioRecorder` is constructed with `RecorderDeps = { mediaDevices: MediaDevices; createAudioContext: () => AudioContext; createMediaRecorder: (stream, options) => MediaRecorder; now: () => number }` (defaults wrap the browser globals; tests pass fakes — premortem P14). Every `await` is followed by `if (session !== this.session) { stop any stream just obtained; return; }` (P6). `AudioRecorder`:
- `start({ deviceId })`: guard already-active; **synchronously before any await** create `AudioContext` and `void resume()` — Web Audio started outside a user-input handler is subject to autoplay rules `[C6]`; `getUserMedia(audioConstraintsFor(deviceId))` `[C9]`, on `OverconstrainedError` with a deviceId retry once with `{ audio: true }` `[C8]`; graph `source → analyser (fftSize 2048, smoothing 0) → gain 0 → destination` (zero-gain sink keeps the graph pulled on old WebKit, no feedback); `MediaRecorder` as today (handlers before `start(1000)`); `createSilenceState(now)`; **`setInterval(sample, 100)`** — not rAF, which is paused in background tabs `[C4]`; intervals are only throttled to a 1 s minimum there `[C3]` and the judge is timestamp-based, so throttling cannot skew it. `sample()`: skip unless `context.state === "running"`; `getFloatTimeDomainData` `[C2]` (fallback byte + `byteSampleToFloat`); `rmsDbfs` → ring buffer; `observeLevel`; publish snapshot only when verdict or whole second changed `[C13]`. After the stream: `enumerateDevices()` `[C10]` → `audioInputsFor` → snapshot `inputs`, `activeInput` `[C12]`; one `devicechange` listener `[C11]` (removed in `release()`).
- `onerror` only records the error (P7: spec order is error → dataavailable → stop); `onstop` → `finalize()` once: `audio/webm` → `fixWebmDuration(blob, durationMs, { logger: false })` in try/catch (the library also swallows its own failures and returns the original blob — no UI claim of repair, P9) `[C21]`; build `File` as today; resolve with `verdict = clipVerdict(this.silence)` and `partial: true` when an error preceded the stop; no data at all → reject. Track `mute`/`unmute` → `interrupted`/`resumed`; track `ended` → finalize (P2); `AudioContext` `statechange` away from `running` marks a coverage gap (P17). Session counter (`this.session++` on start/cancel) makes any late continuation a no-op.
- `release()`: clear interval; disconnect nodes; `context.close().catch(() => {})` `[C5]` (the source node otherwise keeps the stream alive; iOS caps live contexts); stop tracks; remove listener; null all.
- Snapshot: `{ status, activeInput }` only — immutable, replaced on change; `getServerSnapshot()` constant idle `[C13]` (P5). Levels never enter the snapshot: `readLevels(target: Float32Array): number` copies the ring into `target` and returns the head index (rAF meter), and `onLevel(cb: (dbfs) => void): () => void` fires per analysed tick (reduced-motion bar). Device list ownership moves to the hook (P3). Keep `cancel()` (valid while `requesting`), `hasFinishedClip`; `onstop` still finalises an OS-interrupted clip `[C7]`.

## Hook and UI (`app/share/`)

- `use-recorder.ts` `[C13, C14, C20]`: `useRecorder()` → `{ snapshot, clip: { recording, url } | null, inputs, help, selectedDeviceId, deviceNotice, start(), stop(), discard(), selectDevice(id), recorder }`. Owns the engine ref, object URL (`createObjectURL` on clip, `revokeObjectURL` on discard/replace/unmount `[C20]`), the **device list** for the panel's lifetime (enumerate after the first grant, on `devicechange` `[C11]`, on `visibilitychange` → visible and before each start; `deviceNotice` = "Your chosen microphone was unplugged — using <label>" when `resolveSelectedDevice` returns null, P3), and `help = helpFor(problem, detectPlatform(navigator.userAgent, navigator.maxTouchPoints))` for `error`, `clip.verdict === "suspectedSilent"`, or `hearing === "silent"`. A failed re-record keeps the previous accepted clip (P10). Unmount: `recorder.cancel()` + revoke.
- `level-meter-client.tsx` `[C14, C15, C16, C17, C18, C19]`: `<LevelMeter recorder hearing reducedMotion />`. Canvas 100 % × 56 px; DPR scaling on mount + `ResizeObserver` `[C19]`; colours from `getComputedStyle(document.documentElement).getPropertyValue("--color-periwinkle-deep" | "--color-wood-light" | "--color-jo-red")` (Tailwind 4 emits theme tokens as CSS variables `[C15]`). Motion-safe: rAF loop `[C4]` draws 60 bars right-aligned, newest right, height `levelToBarHeight`, periwinkle-deep above threshold / wood-light below; 10 px jo-red dot with `motion-safe:animate-pulse` `[C16, C17]`. Reduced motion (`matchMedia("(prefers-reduced-motion: reduce)")` `[C18]`): no rAF, single horizontal level bar redrawn on `levelsVersion`, static dot. `role="img" aria-label="Microphone level"` + visible `<p aria-live="polite">` "Listening…" / "Hearing you" / "We're not hearing anything" + `formatDuration(elapsedSeconds*1000)`.
- `recorder-panel-client.tsx` `[C14, C27]`: replaces the inline `#record` block. Start/Stop `TertiaryButton` (label by status: Starting… / Stop recording / Record again / Try again); meter while recording ("Recording paused by your phone" while `interrupted`); "Using: {activeInput}" (`text-small text-walnut-soft`) once granted; `<select className={selectClass}>` with a visible label "Microphone" only when `shouldShowPicker` (disabled while recording); silence-warning box (dashed periwinkle, `helperClass` body + `<ol>` steps) while `hearing === "silent"`; for every `clip`: `<audio controls>` + "Recorded m:ss" + Remove, plus a verdict line — `suspectedSilent`: "This recording sounds silent" + steps; `unchecked`: "We couldn't check this recording — play it back before you send"; `partial`: "The recording was cut short; what we have is here". Error box (`errorClass` title + steps). Elapsed timer sits outside the `aria-live` region; only verdict changes are announced (P16).
- `share-form.tsx` `[C13, C27]`: `const rec = useRecorder()`; `busy = phase.kind === "saving" || status.kind ∈ {requesting, recording, finishing}`, enforced in `onSubmit`/`toggle` handlers as well as `disabled` (P10); attachment precedence: a clip always wins over the file input, and the file input is cleared when a clip exists; `file = rec.clip?.recording.file ?? picked`; when `rec.clip.verdict === "suspectedSilent"` the submit is two-step ("Send anyway" confirms once); `createMemory` payload's `file` gains `durationSeconds: durationSecondsFor(durationMs)` (`Math.max(1, Math.round(ms / 1000))`, P8) only when `rec.clip` `[C22]`; draft autosave via `useShareDraft()` (decision 10); `resetForm` → `rec.discard()` + clear draft; delete `isRecording/isStarting/recorderError/clip` state and `recorderRef`.
- `eslint.config.mjs` `[C26, C27]`: add `"app/**/use-*.ts"` to the client rule's `files` array (line 108) **and** to the general app rule's `ignores` array (line 131), otherwise the later rule overwrites the client import restriction (P15). Mention `use-*.ts` in `docs/code-layout.md` and the AGENTS.md copy of the client-component convention `[C27]`.
- `package.json` `[C21]`: `npm i -E fix-webm-duration@1.0.6`.

## Duration persistence (server)

- `lib/validations/memory.ts` `[C22]`: `MAX_DURATION_SECONDS = 86_400`; `fileInputSchema` gains `durationSeconds: z.number().int().min(0).max(MAX_DURATION_SECONDS).optional()` (zod strips unknown keys, so the field must be declared for it to survive parsing `[C22]`; optional, so claim-page tickets are unaffected; `0` is accepted and stored as `null` so a rounding edge can never reject a whole memory, P8). `lib/format-duration.ts` gains `durationSecondsFor(ms)` = `Math.max(1, Math.round(ms / 1000))` for finite positive `ms`, else `undefined`.
- `features/memories/create-memory.ts` `[C23]`: `ResolvedFile.durationSeconds: number | null`; `resolveFile` keeps it only when `memoryTypeFor(mimeType) !== "PHOTO"` and it is `> 0`; `createPendingMedia` adds it to the `media.create({ data })` call `[C23]`. `ingest-upload.transition` only writes `status/sizeBytes/blobUrl`, so it survives READY. Untrusted display hint; never gates anything.
- `features/memories/claim.ts` `[C23]`: `select` + `ClaimView.media[]` gain `durationSeconds`.
- `app/m/[claimToken]/page.tsx` `[C28]` audio branch (~line 82): `<p className="text-small text-walnut-soft">{formatDuration(item.durationSeconds * 1000)}</p>` when not null; the page's `await connection()`-first order is untouched `[C28]`.

## Tests `[C24, C25]`

- `__tests__/lib/audio-level.test.ts`: `rmsDbfs` (zeros/empty → −100; ±1 square → 0; sine amp 1 ≈ −3.01; amp 0.001 ≈ −60); `byteSampleToFloat` (128→0, 0→−1, 255≈0.99); `levelToBarHeight` (−100→0, −60→0, −30→0.5, 0→1, +3→1); judge: no observations → `unknown` & `clipVerdict` `unchecked`; silent 2.9 s → listening, 3.0 s → silent; one loud → hearing; loud then 3 s silent → silent (rolling); 1 loud tick (100 ms) → `suspectedSilent`, 2 → `heard`; −60 exactly counts as loud; a gap > 500 ms between ticks sets `coverageGap` and `clipVerdict` → `unchecked` unless `heard`; `peakDbfs` tracks max.
- `__tests__/lib/recorder-help.test.ts`: `problemFromError` table (modern + legacy names `[C8]`; `Error`, string, undefined → unknown); `detectPlatform` table (Mac Chrome/Safari/Firefox, iPhone, iPad Macintosh UA + touch 5, CriOS, Android, Windows Edge/Firefox, Linux → other); `helpFor` `it.each` problem × platform non-empty; spot checks (silent/mac-chrome mentions "System Settings" and "Chrome" `[C29]`; not-allowed/ios mentions "Settings" `[C30]`; unsupported mentions the file field; silent never names another OS's settings app).
- `__tests__/lib/recording-devices.test.ts`: filtering `[C10]`, pseudo-device collapse, lone `default` kept, order; `shouldShowPicker` 0/1/2; `resolveSelectedDevice`; `audioConstraintsFor` `[C9]`; `describeActiveInput` precedence `[C12]`.
- `__tests__/lib/recorder-state.test.ts`: one `it` per transition in the full table incl. `interrupted`/`resumed`, `failed` from recording and finishing, `cancel` from every active state; `start` during recording and `stop` in idle return the same reference `[C13]`; unchanged `tick` same reference; `ended` → finishing → finished → clip `[C7]`.
- `__tests__/lib/share-draft.test.ts`: round-trip, expiry, malformed JSON → null, unknown keys dropped.
- `__tests__/app/recorder.test.ts` (delegated, after the engine lands): fake `mediaDevices`/`AudioContext`/`MediaRecorder`; cancel before grant stops the late stream; error → dataavailable → stop yields a `partial` clip; double `stop()` returns the same promise; stale finalize after cancel is a no-op; `release()` closes the context, stops tracks, clears the interval; OS `stop` without user tap resolves the clip; `unchecked` verdict when the context never runs.
- `__tests__/lib/validations-memory.test.ts` (new) `[C22]`: accepts absent / 0 / 24; rejects 1.5, −1, 86 401; `createMemoryInputSchema` keeps it on `file`. `__tests__/lib/format-duration.test.ts` gains `durationSecondsFor` at 1, 199, 400, 499, 500, 999, 1 000, 24 400 ms (→ 1,1,1,1,1,1,1,24) and `NaN`/`-1` → `undefined`.
- `__tests__/features/create-memory.test.ts` `[C23]`: `MediaRow` (line 9) + `durationSeconds?: number | null`; "stores durationSeconds for a recording" (webm + 24 → 24); "null when not sent"; "ignores it on a photo"; "rejects −1 → `{ ok:false, code:"invalid" }`, no rows".
- `__tests__/features/claim.test.ts` `[C23]`: fixtures + `durationSeconds`; assert pass-through.

## Who does what (orchestration per `TrayVerify/…/docs/workflows/orchestration.md`: independent tasks → Astra workers, two at a time, one owner per file; deep-context tasks → the orchestrator, one after another)

| Task | Owner | Owned paths | Depends on | Checks |
|---|---|---|---|---|
| W1 pure recorder modules (TDD) | Astra | `lib/audio-level.ts`, `lib/recorder-help.ts`, `lib/recording-devices.ts`, `lib/recorder-state.ts`, `__tests__/lib/{audio-level,recorder-help,recording-devices,recorder-state}.test.ts` | — | `npx vitest run __tests__/lib`, `npm run type-check`, `npx eslint lib __tests__/lib` |
| W2 server slice + draft helpers (TDD) | Astra | `lib/validations/memory.ts`, `lib/format-duration.ts`, `lib/share-draft.ts`, `features/memories/create-memory.ts`, `features/memories/claim.ts`, `app/m/[claimToken]/page.tsx`, `__tests__/lib/{validations-memory,format-duration,share-draft}.test.ts`, `__tests__/features/{create-memory,claim}.test.ts` | — | `npx vitest run __tests__/lib __tests__/features`, `npm run type-check`, `npx eslint <owned>` |
| L1 engine rewrite with injectable deps | orchestrator (linear) | `app/share/recorder.ts` | W1 integrated | `npm run type-check` |
| L2 hook, meter, panel, form wiring, autosave hook, eslint globs, docs | orchestrator (linear) | `app/share/use-recorder.ts`, `app/share/use-share-draft.ts`, `app/share/level-meter-client.tsx`, `app/share/recorder-panel-client.tsx`, `app/share/share-form.tsx`, `eslint.config.mjs`, `docs/code-layout.md`, `AGENTS.md` | L1, W2 | `npm run validate`, `npm run test:run` |
| W3 engine lifecycle tests | Astra | `__tests__/app/recorder.test.ts`, `__tests__/stubs/browser-audio.ts` | L1 integrated | `npx vitest run __tests__/app`, `npm run type-check` |
| V smoke script + fixture, offline build in a scratch worktree, device matrix, PR | orchestrator | `scripts/recorder-smoke.mjs`, `scripts/fixtures/silence-2s.wav` | L2, W3 | `npm run build:offline` (scratch worktree, no `.env*`), checklist |

Workers have no shell network: anything needing it (npm install, `next typegen` fonts are local, Vercel) is run by the orchestrator. Each brief carries: the module signatures from this plan verbatim, the premortem rulings that touch its files, the repo rules (branch/PR, no `eslint-disable`, no `console.log` server-side, no `@/server` in client files), and "do not stage, commit, or touch files outside owned paths".

## Implementation order

0. ✅ Oscar premortem; rulings in the ledger below; Rob's answers recorded in decisions 3, 10, 11.
1. ✅ Branch `feat/recorder-feedback` from `636ddfd`; `fix-webm-duration@1.0.6` installed (UMD/CJS + typed default export `[C21]`).
2. Astra `init`; W1 + W2 in parallel; inspect, check, accept, integrate.
3. L1 engine; L2 UI (orchestrator), each followed by `npm run validate && npm run test:run`.
4. W3 engine tests (Astra) after L1 integrates; inspect, accept, integrate.
5. V: smoke script + offline build in a scratch worktree (never delete anyone's `.env*`) `[C27]`; device matrix; PR body carries the parking lot; `/team-code-review` on the PR; four buckets; Rob's go before merge.

## Verification

- **Mac Chrome, mic denied in System Settings** (the production failure `[C1]`): Start → flat meter; at 3 s "We're not hearing anything" with System Settings steps `[C29]`; Stop at ~10 s → "came out silent", no player, Try again. Allow Chrome, quit/reopen → bars move, "Hearing you", clip plays with a seekable timeline; submit → claim page shows "0:xx"; DB row has `durationSeconds`.
- **Mac + headset/USB mic**: "Using: MacBook Pro Microphone" `[C12]`; picker lists ≥ 2 without the "Default – …" duplicate; choose headset while idle → next recording uses it; select disabled while recording; unplug → list refreshes `[C11]`; unplug the selected one then Start → silent fallback to `{ audio: true }` `[C9]`.
- **Mac Safari**: `audio/mp4` path, no `fixWebmDuration` call `[C21]`, native duration; `AudioContext` running; Safari steps on deny `[C31]`.
- **iPhone Safari**: meter moves on first tap (context created in the gesture `[C6]`); lock screen mid-recording → clip appears without another tap `[C7]`; deny → iOS steps `[C30]`; Reduce Motion on → static bar, no pulse `[C18]`.
- **Android Chrome** `[C33]`, **Firefox** (webm → `fixWebmDuration`, seekable; Firefox steps on deny `[C34]`), **Windows Chrome/Edge** `[C35]`.
- **Headless Chromium smoke** via chrome-devtools MCP against `npm run dev`: `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` → "Hearing you" at 4 s, `<audio>` with finite `duration` after Stop; `--use-file-for-fake-audio-capture=<WAV of zeros>` → warning at ~3 s, "came out silent" after Stop; 10× start/stop → no growth in live `AudioContext`s `[C5]`; navigate away mid-recording → tab mic indicator off.

## Parking lot

**3 · Don't do (with reasons)**
- Server-side content validation of uploaded audio (ffprobe/volumedetect in the cron) as a second silence check — premortem P1 suggested it "if automatic rejection remains required"; Rob chose warn-not-delete, so nothing is rejected and the client verdict is advisory only.
- Stored duration from the media file itself (overwriting the client hint) — would need a media probe in the ingest path; the hint is display-only and capped.
- Draft autosave of the recorded clip (IndexedDB) — the typed story is the irreplaceable part; a clip can be re-recorded, and persisting blobs raises storage/privacy questions for a memorial site.

**4 · Real, but out of scope (maybe an issue later)**
- Existing silent recordings in production (one row) and historical `durationSeconds = null` rows — no backfill.
- A release/rollback runbook for the site as a whole — this PR deploys via Vercel on merge and reverts via Vercel rollback; uploaded media and the additive column survive either way.
- `npm audit`: 28 pre-existing advisories (4 high) in the tree, none from `fix-webm-duration`.

## Risks

- Discarding silent clips is only safe with the `unknown`-keeps-clip rule above; never default to "silent".
- −60 dBFS: digital silence is −100, real rooms ≥ −80 after Chrome's noise suppression; a quiet person pausing 3 s sees the warning and it clears on speech. One constant, easy to tune.
- No automated coverage for engine/hook/canvas `[C24]`; reducer + judge carry the logic, the session counter and the 10× smoke cover leaks.
- `durationSeconds` is client-reported: display only, capped at one day `[C22]`.

## Citations

All quotes fetched live on 2026-11-03. Repo sources are the working-tree files at `b1e1afa` (the GitHub URL is the same content).

### [C1] — Chromium: macOS-level mic denial yields silent `getUserMedia`
- **Relevant File(s):** `lib/audio-level.ts`, `lib/recorder-help.ts`
- **Change Summary:** Justifies silence detection as a first-class state and the "quit and reopen the browser after allowing it in System Settings" step in the help copy.
- **Source URL:** https://issues.chromium.org/issues/41437397
- **Verbatim Quote:**
  > "(1) Deny mic permission for Chrome in System Preferences > Security & Privacy > Privacy > Microphone. … What is the expected result? getUserMedia fails (see printout in console). What happens instead? getUserMedia succeeds, but audio is silent."
- **Justification:** The browser reports success, so no error path can catch this case; only measuring the signal (`rmsDbfs` → `hearingVerdict === "silent"`) can, and the help must point at the OS setting rather than the site permission.

### [C2] — MDN: `AnalyserNode.getFloatTimeDomainData()`
- **Relevant File(s):** `lib/audio-level.ts`, `app/share/recorder.ts`
- **Change Summary:** The meter samples raw time-domain data from an `AnalyserNode` and computes RMS in dBFS.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData
- **Verbatim Quote:**
  > "The getFloatTimeDomainData() method of the AnalyserNode Interface copies the current waveform, or time-domain, data into a Float32Array array passed into it. … If the array has fewer elements than the AnalyserNode.fftSize, excess elements are dropped."
- **Justification:** `sample()` allocates a `Float32Array(analyser.fftSize)` once and passes it each tick; `rmsDbfs` operates on those waveform samples.

### [C3] — MDN: timers in inactive tabs are throttled, not stopped
- **Relevant File(s):** `app/share/recorder.ts` (sample loop)
- **Change Summary:** The silence judge runs on `setInterval` and compares timestamps, so a 1 s minimum in a background tab still yields a correct verdict.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#timeouts_in_inactive_tabs
- **Verbatim Quote:**
  > "To reduce the load (and associated battery usage) from background tabs, browsers will enforce a minimum timeout delay in inactive tabs. It may also be waived if a page is playing sound using a Web Audio API AudioContext."
- **Justification:** `observeLevel(state, dbfs, now, intervalMs)` and `hearingVerdict(state, now)` use `now - lastLoudAt`, not tick counts, so a throttled interval cannot produce a false "silent".

### [C4] — MDN: `requestAnimationFrame` pauses in background tabs
- **Relevant File(s):** `app/share/recorder.ts`, `app/share/level-meter-client.tsx`
- **Change Summary:** rAF drives only the drawing; it must not drive the judge.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- **Verbatim Quote:**
  > "requestAnimationFrame() calls are paused in most browsers when running in background tabs or hidden <iframe>s, in order to improve performance and battery life."
- **Justification:** A contributor who switches tabs mid-recording would otherwise freeze the silence judgement; the engine samples on `setInterval` `[C3]` and the canvas uses rAF only for paint.

### [C5] — MDN: `AudioContext.close()`
- **Relevant File(s):** `app/share/recorder.ts` (`release()`)
- **Change Summary:** Teardown closes the context so the mic indicator goes off and contexts do not accumulate.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/close
- **Verbatim Quote:**
  > "The close() method of the AudioContext Interface closes the audio context, releasing any system audio resources that it uses."
- **Justification:** `release()` calls `context.close()` in addition to stopping tracks; the 10× start/stop smoke checks no live contexts remain.

### [C6] — MDN: Web Audio outside a user-input handler is subject to autoplay rules
- **Relevant File(s):** `app/share/recorder.ts` (`start()`)
- **Change Summary:** The `AudioContext` is created and `resume()`d synchronously in the tap handler, before the first `await`.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay#autoplay_using_the_web_audio_api
- **Verbatim Quote:**
  > "In the Web Audio API, a website or app can start playing audio using the start() method on a source node linked to the AudioContext. Doing so outside the context of handling a user input event is subject to autoplay rules."
- **Justification:** If the context were created after `await getUserMedia()`, iOS Safari may leave it `suspended`, the meter reads zeros, and (without the `unknown` rule) a good clip would be judged silent.

### [C7] — MDN: `MediaRecorder` `stop` event fires when the stream ends
- **Relevant File(s):** `app/share/recorder.ts`, `lib/recorder-state.ts`
- **Change Summary:** The `ended` reducer event and the engine's `onstop` handling cover OS-interrupted recordings (screen lock, phone call).
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/stop_event
- **Verbatim Quote:**
  > "The stop event of the MediaRecorder interface is fired when MediaRecorder.stop() is called, or when the media stream being captured ends. In each case, the stop event is preceded by a dataavailable event, making the Blob captured up to that point available for you to use in your application."
- **Justification:** `onstop` → `finish()` → `finalize()` runs for both the user tap and the OS stop; the reducer's `ended` transition lets the snapshot (and UI) advance without a tap.

### [C8] — MDN: `getUserMedia()` exceptions
- **Relevant File(s):** `lib/recorder-help.ts` (`problemFromError`), `app/share/recorder.ts` (retry)
- **Change Summary:** Error names map to `RecorderProblem`; `OverconstrainedError` triggers one retry with `{ audio: true }`.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#exceptions
- **Verbatim Quote:**
  > "NotAllowedError … Thrown if one or more of the requested source devices cannot be used at this time. … NotFoundError … Thrown if no media tracks of the type specified were found that satisfy the given constraints. NotReadableError … Thrown if, although the user granted permission to use the matching devices, a hardware error occurred at the operating system, browser, or Web page level which prevented access to the device. OverconstrainedError … Thrown if the specified constraints resulted in no candidate devices which met the criteria requested. … SecurityError … Thrown if user media support is disabled on the Document on which getUserMedia() was called."
- **Justification:** Each name is a distinct user situation needing distinct copy; the `OverconstrainedError` definition is exactly the "saved device vanished" case the retry handles.

### [C9] — MDN: `deviceId: { exact }` constraint
- **Relevant File(s):** `lib/recording-devices.ts` (`audioConstraintsFor`)
- **Change Summary:** A chosen microphone is requested with `exact`; no choice falls back to `{ audio: true }`.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#using_getusermedia
- **Verbatim Quote:**
  > "The above will return the camera you requested, or a different camera if that specific camera is no longer available. … Again, to require the specific camera, you would use: … deviceId: { exact: myExactCameraOrBustDeviceId }"
- **Justification:** Without `exact` the browser may silently substitute another input, defeating the picker and the "Using:" line; with it, a missing device throws `OverconstrainedError` `[C8]`, which the engine turns into a fallback.

### [C10] — MDN: `enumerateDevices()` availability depends on permission
- **Relevant File(s):** `lib/recording-devices.ts` (`audioInputsFor`), `app/share/recorder.ts`
- **Change Summary:** Devices are enumerated only after the stream is granted, and unlabelled entries are dropped.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices
- **Verbatim Quote:**
  > "Other than default devices, only devices for which permission has been granted are \"available\"."
- **Justification:** Enumerating before `getUserMedia` would yield an unusable list; filtering `label !== ""` removes the pre-permission placeholders so `shouldShowPicker` counts real choices.

### [C11] — MDN: `devicechange` event
- **Relevant File(s):** `app/share/recorder.ts`
- **Change Summary:** One listener re-enumerates when a headset is plugged or unplugged; removed in `release()`.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/devicechange_event
- **Verbatim Quote:**
  > "The devicechange event is sent to a MediaDevices instance whenever a media device such as a camera, microphone, or speaker is connected to or removed from the system."
- **Justification:** Keeps the picker and `resolveSelectedDevice` current without polling.

### [C12] — MDN: `MediaStreamTrack.label`
- **Relevant File(s):** `lib/recording-devices.ts` (`describeActiveInput`)
- **Change Summary:** The "Using: …" line reads the live track's label first.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/label
- **Verbatim Quote:**
  > "The label read-only property of the MediaStreamTrack interface returns a string containing a user agent-assigned label that identifies the track source, as in \"internal microphone\"."
- **Justification:** The track label names the input actually in use, which is what the contributor needs to see when the wrong microphone was picked.

### [C13] — React: `useSyncExternalStore` snapshot contract
- **Relevant File(s):** `app/share/recorder.ts` (store), `app/share/use-recorder.ts`, `lib/recorder-state.ts`, `app/share/share-form.tsx`
- **Change Summary:** The engine publishes immutable snapshots and the reducer returns the same reference when nothing changed; `getServerSnapshot` returns a constant.
- **Source URL:** https://react.dev/reference/react/useSyncExternalStore
- **Verbatim Quote:**
  > "useSyncExternalStore is a React Hook that lets you subscribe to an external store. … The store snapshot returned by getSnapshot must be immutable. If the underlying store has mutable data, return a new immutable snapshot if the data has changed. … getServerSnapshot: A function that returns the initial snapshot of the data in the store. The server snapshot must be the same between the client and the server … If you omit this argument, rendering the component on the server will throw an error."
- **Justification:** Level data (100 ms) is kept out of React by publishing a new snapshot only on verdict/second changes; the reducer's same-reference rule is what prevents re-render storms, and the constant server snapshot keeps hydration identical (the same reason `share-form.tsx:47` already uses this hook).

### [C14] — Next.js (installed 16.4.4 docs): Client Components for browser APIs; `"use client"` boundary
- **Relevant File(s):** `app/share/use-recorder.ts`, `app/share/level-meter-client.tsx`, `app/share/recorder-panel-client.tsx`
- **Change Summary:** The hook, meter and panel are client modules; `share-form.tsx` already carries `"use client"`, so files it imports are in the client bundle.
- **Source URL:** https://nextjs.org/docs/app/getting-started/server-and-client-components (verified against the installed copy `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`, which AGENTS.md says is authoritative for this version)
- **Verbatim Quote:**
  > "Use **Client Components** when you need: … Browser-only APIs. E.g. `localStorage`, `window`, `navigator.geolocation`, etc. … Once a file is marked with `"use client"`, **all of its imports and the components it directly renders are included in the client bundle**. This means you don't need to add the directive to every component that is intended for the client."
- **Justification:** `navigator.mediaDevices`, `AudioContext` and `<canvas>` are browser-only; the new files are imported from `share-form.tsx` (already `"use client"`), and the `-client.tsx` / `use-*.ts` names put them under the repo's client-import lint rule `[C27]`.

### [C15] — Tailwind CSS v4: theme tokens are emitted as CSS variables
- **Relevant File(s):** `app/share/level-meter-client.tsx`
- **Change Summary:** The canvas reads `--color-periwinkle-deep`, `--color-wood-light`, `--color-jo-red` via `getComputedStyle` instead of hard-coding hex values.
- **Source URL:** https://tailwindcss.com/docs/theme#using-your-theme-variables
- **Verbatim Quote:**
  > "Tailwind also generates regular CSS variables for your theme variables so you can reference your design tokens in arbitrary values or inline styles: `<div style=\"background-color: var(--color-mint-500)\">`"
- **Justification:** Canvas drawing cannot use utility classes; the generated variables keep the meter on the brand palette defined in `app/globals.css` `@theme`.

### [C16] — Tailwind CSS v4: `motion-safe` / `motion-reduce` variants
- **Relevant File(s):** `app/share/level-meter-client.tsx`
- **Change Summary:** The pulsing dot uses `motion-safe:animate-pulse`.
- **Source URL:** https://tailwindcss.com/docs/hover-focus-and-other-states#prefers-reduced-motion
- **Verbatim Quote:**
  > "Use the motion-reduce variant to conditionally add styles when the user has requested reduced motion: … Tailwind also includes a motion-safe variant that only adds styles when the user has not requested reduced motion."
- **Justification:** Matches the only motion precedent in the repo (`motion-safe:` on `app/page.tsx` cards) and removes the pulse automatically under Reduce Motion.

### [C17] — Tailwind CSS v4: `animate-pulse`
- **Relevant File(s):** `app/share/level-meter-client.tsx`
- **Change Summary:** The recording indicator uses the built-in utility; no custom keyframes are added.
- **Source URL:** https://tailwindcss.com/docs/animation#adding-a-pulse-animation
- **Verbatim Quote:**
  > "Use the animate-pulse utility to make an element gently fade in and out—useful for things like skeleton loaders:"
- **Justification:** A gentle fade is the conventional "recording" cue and avoids introducing the repo's first `@keyframes`.

### [C18] — MDN: `prefers-reduced-motion`
- **Relevant File(s):** `app/share/level-meter-client.tsx`, `app/share/use-recorder.ts`
- **Change Summary:** `matchMedia("(prefers-reduced-motion: reduce)")` switches the scrolling bars to a static level bar.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- **Verbatim Quote:**
  > "The prefers-reduced-motion CSS media feature is used to detect if a user has enabled a setting on their device to minimize the amount of non-essential motion. … reduce: Indicates that a user has enabled the setting on their device for reduced motion."
- **Justification:** A continuously scrolling waveform is non-essential motion; the static bar still answers "am I being heard?" without it.

### [C19] — MDN: correcting canvas resolution with `devicePixelRatio`
- **Relevant File(s):** `app/share/level-meter-client.tsx`
- **Change Summary:** Canvas backing size is scaled by DPR on mount and on `ResizeObserver` changes.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio#correcting_resolution_in_a_canvas
- **Verbatim Quote:**
  > "A <canvas> can appear too blurry on retina screens. Use window.devicePixelRatio to determine how much extra pixel density should be added to allow for a sharper image."
- **Justification:** Every phone and Mac the contributors use is high-DPI; without scaling the bars render blurred against the crisp brand typography.

### [C20] — MDN: `URL.revokeObjectURL()`
- **Relevant File(s):** `app/share/use-recorder.ts`
- **Change Summary:** The clip's object URL is revoked on discard, replace and unmount (today's `replaceClip` behaviour, moved into the hook).
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static
- **Verbatim Quote:**
  > "The revokeObjectURL() static method of the URL interface releases an existing object URL which was previously created by calling URL.createObjectURL(). Call this method when you've finished using an object URL to let the browser know not to keep the reference to the file any longer."
- **Justification:** "Record again" can happen many times in one session; each clip is up to 100 MB in memory until revoked.

### [C21] — fix-webm-duration (npm, v1.0.6): README
- **Relevant File(s):** `app/share/recorder.ts` (`finalize`), `package.json`
- **Change Summary:** WebM blobs get a duration header patched in before the `File` is built; `audio/mp4` is untouched.
- **Source URL:** https://www.npmjs.com/package/fix-webm-duration (README, fetched via `npm view fix-webm-duration readme` on 2026-11-03; version 1.0.6, MIT, `types` declared)
- **Verbatim Quote:**
  > "`navigator.mediaDevices.getUserMedia` + `MediaRecorder` create WEBM files without duration metadata. This library appends missing metadata section right to the file blob. … `ysFixWebmDuration(blob, duration, callback = undefined, options = {})` … `duration` is video duration in milliseconds (you should calculate it while recording the video) … If omitted, a `Promise` object will be returned instead. … `options.logger` … Passing `false` will disable the logging. … If the original blob already contains duration metadata section and the duration value is not empty, the callback will receive it without any changes made."
- **Justification:** Matches the observed `Duration: N/A` on the production webm; the engine already measures `durationMs`, the promise form fits `finalize()`, `logger: false` respects the no-`console` rule, and the no-op-when-present behaviour makes it safe for Safari 18.4+ WebM.

### [C22] — Zod: number validators; unknown keys stripped
- **Relevant File(s):** `lib/validations/memory.ts`, `app/share/share-form.tsx`, `__tests__/lib/validations-memory.test.ts`
- **Change Summary:** `durationSeconds` is declared as `z.number().int().positive().max(86_400).optional()`; without a declaration the client's value would be dropped.
- **Source URL:** https://zod.dev/api#numbers and https://zod.dev/api#objects
- **Verbatim Quote:**
  > "Zod implements a handful of number-specific validations: … z.number().lte(5); // alias .max(5) … z.number().positive(); // alias .gt(0) … By default, unrecognized keys are stripped from the parsed result:"
- **Justification:** `.positive()` and `.max()` bound the untrusted client value; the stripping rule is why `fileInputSchema` must name the field for it to reach `createPendingMedia`.

### [C23] — Prisma Client v7 reference: `create()` `data`; `select`
- **Relevant File(s):** `features/memories/create-memory.ts`, `features/memories/claim.ts`, `__tests__/features/create-memory.test.ts`, `__tests__/features/claim.test.ts`
- **Change Summary:** `durationSeconds` is added to the `media.create({ data })` object and to the claim query's `select`.
- **Source URL:** https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference#create (repo runs `prisma@7.10.1`)
- **Verbatim Quote:**
  > "create creates a new database record. … data … Wraps all the model fields in a type so that they can be provided when creating new records. … Fields that are marked as optional or have default values in the datamodel are optional. … select … Specifies which properties to include on the returned object."
- **Justification:** `durationSeconds Int?` is optional in the datamodel, so adding it to `data` needs no migration; `claim.ts` uses an explicit `select`, so the new column must be listed to reach the page.

### [C24] — Vitest: `environment` option
- **Relevant File(s):** `__tests__/lib/audio-level.test.ts`, `__tests__/lib/recorder-help.test.ts`, `__tests__/lib/recording-devices.test.ts`, `__tests__/lib/recorder-state.test.ts`
- **Change Summary:** All testable logic lives in DOM-free `lib/` modules because the repo's `vitest.config.ts` uses the default Node environment.
- **Source URL:** https://vitest.dev/config/environment
- **Verbatim Quote:**
  > "The environment that will be used for testing. The default environment in Vitest is a Node.js environment. If you are building a web application, you can use browser-like environment through either jsdom or happy-dom instead."
- **Justification:** Adding jsdom was not asked for; keeping `AudioContext`/canvas/`navigator` out of the pure modules lets the judge, reducer, help and device logic run in the existing node environment.

### [C25] — Vitest: `include` option
- **Relevant File(s):** `__tests__/lib/validations-memory.test.ts` (new) and the other new `__tests__/lib/*.test.ts` files
- **Change Summary:** New tests use the `.test.ts` suffix under `__tests__/`, matching the repo's `include: ["__tests__/**/*.test.ts"]`.
- **Source URL:** https://vitest.dev/config/include
- **Verbatim Quote:**
  > "A list of glob patterns that match your test files. These patterns are resolved relative to the root (process.cwd() by default)."
- **Justification:** A `.test.tsx` file would be silently skipped by the repo's narrower pattern, so none are planned.

### [C26] — ESLint flat config: `files` globs
- **Relevant File(s):** `eslint.config.mjs`
- **Change Summary:** Add `"app/**/use-*.ts"` to the two client-component `files` arrays so `use-recorder.ts` is covered by the client `no-restricted-imports` rule.
- **Source URL:** https://eslint.org/docs/latest/use/configure/configuration-files#specifying-files-and-ignores
- **Verbatim Quote:**
  > "An array of glob patterns indicating the files that the configuration object should apply to. If not specified, the configuration object applies to all files matched by any other configuration object."
- **Justification:** The existing globs name `*-form.tsx`, `*-client.tsx`, `recorder.ts`; a hook file would otherwise escape the rule that keeps `@/server` and `@/integrations` out of client code — this is a config scope change, not a suppression.

### [C27] — Repo rules (AGENTS.md / `docs/code-layout.md`): client-component convention, PR rule, checks
- **Relevant File(s):** `app/share/share-form.tsx`, `app/share/recorder-panel-client.tsx`, `docs/code-layout.md`, `eslint.config.mjs`
- **Change Summary:** New client files follow the naming convention and import nothing from `@/server`/`@/integrations`; the convention text gains `use-*.ts`; work ships on a branch with a PR and the three checks.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/main/AGENTS.md (same text in `docs/code-layout.md`)
- **Verbatim Quote:**
  > "Client Components (by convention `*-form.tsx`, `*-client.tsx`, `recorder.ts`, `app/global-error.tsx`, `instrumentation-client.ts`) never import `@/server` or `@/integrations`; they call Server Functions. … `app/_components/` holds shared visitor-facing UI … Every change goes on a branch with a PR. … `npm run validate` (= `next typegen && tsc --noEmit`, then `eslint`), `npm run test:run`, `npm run build:offline` … All three pass with `DATABASE_URL` unset and no `.env*` file"
- **Justification:** The hook/meter/panel are page-specific, so they stay in `app/share/` rather than `app/_components/`; `use-*.ts` is added to the documented convention in the same PR that extends the lint glob `[C26]`.

### [C28] — Repo rule (AGENTS.md): Cache Components — `await connection()` first
- **Relevant File(s):** `app/m/[claimToken]/page.tsx`
- **Change Summary:** The duration line is added inside the existing media loop; the page's first statement stays `await connection()`.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/main/AGENTS.md
- **Verbatim Quote:**
  > "The **first** thing a dynamic page component does is `await connection()` (then `params`/`searchParams`/`headers()` as needed); a `GET` handler reads `request.headers` or `request.nextUrl` first. Only then touch Prisma or env."
- **Justification:** The change is render-only and must not reorder the page's data access, which previously broke the `/m/[claimToken]` prerender (2026-11-03).

### [C29] — Apple: control access to the microphone on Mac
- **Relevant File(s):** `lib/recorder-help.ts` (mac-chrome, mac-safari, mac-firefox `silent`/`not-allowed` steps)
- **Change Summary:** macOS help steps quote Apple's path.
- **Source URL:** https://support.apple.com/guide/mac-help/control-access-to-the-microphone-on-mac-mchla1b1e1fe/mac
- **Verbatim Quote:**
  > "Choose Apple menu > System Settings, then click Privacy & Security in the sidebar. Click Microphone. Turn access to the microphone on or off for each app in the list."
- **Justification:** This is the setting whose denial produces the silent stream `[C1]`; the copy reproduces Apple's wording so a non-technical contributor can follow it.

### [C30] — Apple: control access to hardware features on iPhone
- **Relevant File(s):** `lib/recorder-help.ts` (ios steps)
- **Change Summary:** iOS help steps quote Apple's path.
- **Source URL:** https://support.apple.com/guide/iphone/control-access-to-hardware-features-iph168c4bbd5/ios
- **Verbatim Quote:**
  > "Go to Settings > Privacy & Security. Tap a hardware feature, such as Camera, Bluetooth, Local Network, or Microphone. The list shows the apps that requested access. You can turn access on or off for any app on the list."
- **Justification:** On iPhone the browser app (Safari/Chrome) must be allowed here before any per-site prompt works.

### [C31] — Apple: per-website Microphone setting in Safari on Mac
- **Relevant File(s):** `lib/recorder-help.ts` (mac-safari steps)
- **Change Summary:** Safari help names the Websites → Microphone setting.
- **Source URL:** https://support.apple.com/guide/safari/customize-settings-per-website-ibrw7f78f7fe/mac
- **Verbatim Quote:**
  > "Microphone: Choose whether the website can use the microphone."
- **Justification:** A previous "Deny" for jowray.com in Safari produces `NotAllowedError` `[C8]`; the fix is this per-website setting, separate from the OS setting `[C29]`.

### [C32] — Google: camera and microphone in Chrome (computer)
- **Relevant File(s):** `lib/recorder-help.ts` (mac-chrome, windows-chromium steps)
- **Change Summary:** Desktop Chrome/Edge site-permission steps quote Google's path.
- **Source URL:** https://support.google.com/chrome/answer/2693767?hl=en&co=GENIE.Platform%3DDesktop
- **Verbatim Quote:**
  > "Change a site's camera and microphone access: On your computer, open Chrome. At the top right, select More and then Settings. Select Privacy and security and then Site settings. Under \"Permissions,\" select Camera or Microphone."
- **Justification:** Covers the `NotAllowedError` case on desktop Chromium; paired with the OS step `[C29]`/`[C35]` for the silent case.

### [C33] — Google: camera and microphone in Chrome (Android)
- **Relevant File(s):** `lib/recorder-help.ts` (android steps)
- **Change Summary:** Android help steps quote Google's path.
- **Source URL:** https://support.google.com/chrome/answer/2693767?hl=en&co=GENIE.Platform%3DAndroid
- **Verbatim Quote:**
  > "On your Android device, open Chrome. To the right of the address bar, tap More and then Settings. Tap Site settings and then Microphone or Camera. … If you find the site you want to use under Blocked, tap the site and then Allow."
- **Justification:** The "Blocked → Allow" path is the one an Android contributor who tapped "Block" once needs.

### [C34] — Mozilla: manage camera and microphone permissions in Firefox
- **Relevant File(s):** `lib/recorder-help.ts` (mac-firefox, windows-firefox steps)
- **Change Summary:** Firefox help steps quote Mozilla's path and the address-bar icon.
- **Source URL:** https://support.mozilla.org/en-US/kb/how-manage-your-camera-and-microphone-permissions
- **Verbatim Quote:**
  > "Click the Settings… button for the Microphone option. … Use the Allow/Block selector to change permission for the website. … Click the permissions icon that displays in the address bar on the left. … Click the X next to Allowed, Allowed Temporarily, Blocked or Blocked Temporarily to clear the status so that Firefox will ask again for permission when you next visit the site."
- **Justification:** Firefox's "Blocked Temporarily" state is a common way a contributor ends up with `NotAllowedError`; clearing it from the address bar is the shortest fix.

### [C35] — Microsoft: turn on app permissions for your microphone in Windows
- **Relevant File(s):** `lib/recorder-help.ts` (windows-chromium, windows-firefox `silent`/`not-allowed` steps)
- **Change Summary:** Windows help steps quote Microsoft's path, including the desktop-apps toggle.
- **Source URL:** https://support.microsoft.com/en-us/windows/turn-on-app-permissions-for-your-microphone-in-windows-94991183-f69d-b4cf-4679-c98ca45f577a
- **Verbatim Quote:**
  > "Select Start > Settings > Privacy & security. Then look for Microphone under App permissions and make sure Microphone access is turned on. Then, allow apps access to your microphone. In Microphone settings, go to Let apps access your microphone and make sure it's turned On. … For desktop apps, make sure that Let desktop apps access your microphone is turned on."
- **Justification:** Browsers are desktop apps on Windows; the "Let desktop apps" toggle is the Windows analogue of the macOS silent-stream case.

## Premortem rulings (Oscar / Codex gpt-6-astra, 2026-11-03; log `~/Downloads/review-anything-20261103-142524-file-fa67b62.md`)

Each finding was checked against source before ruling. Baseline correction: `main` moved to `636ddfd` (PR #16 merged) before the branch was cut; `feat/recorder-feedback` starts there, not `b1e1afa`.

| # | Finding | Verified? | Ruling |
|---|---|---|---|
| P1 | Deleting a "silent" clip on sparse meter evidence can destroy a real memory (analyser sees ~43 ms per 100 ms tick) | Yes | **Adopt (Rob to confirm):** Decision 3 becomes *warn, never delete*. A suspected-silent clip stays playable; Send shows "This recording sounds silent — Send anyway / Record again"; `analysisUnavailable` (context never ran) is shown as "we couldn't check" and never treated as silent. |
| P2 | Screen lock / phone call may not fire `stop`; UI could claim "recording" forever | Yes (C7 covers stream end only) | **Adopt:** handle track `mute`/`unmute`/`ended`, `AudioContext` `statechange`, `visibilitychange`; new `interrupted` status ("Recording paused by your phone"); elapsed time from wall clock, not the analyser; finalize on `ended`. Device test on iPhone is a gate. |
| P3 | `devicechange` listener dies with the capture session, so the idle picker goes stale | Yes | **Adopt:** device list is owned by the hook for the panel's lifetime (after first grant); re-enumerate on `devicechange`, on `visibilitychange`→visible and before each start; show "Your chosen microphone was unplugged" and fall back visibly. |
| P4 | "Quit and reopen the browser" help erases the typed story | Yes | **Adopt (Rob to confirm scope):** autosave the five text fields to `localStorage` (debounced, cleared on successful send); help copy mentions the draft is kept. |
| P5 | `Float32Array` inside the "immutable" snapshot breaks the `useSyncExternalStore` contract | Yes | **Adopt:** levels leave the React snapshot; engine exposes `readLevels(target: Float32Array): number` (copies ring, returns head) and `onLevel(cb)` for the reduced-motion redraw. Snapshot = `{ status, inputs, activeInput }` only. |
| P6 | Pending `getUserMedia` resolving after unmount leaks a live mic | Yes | **Adopt:** session id captured before every await and checked after; streams for an obsolete session are stopped immediately; `cancel()` works while `requesting`. |
| P7 | `onerror → finish()` finalizes before the final `dataavailable`; reducer has no `failed` from `recording`/`finishing` | Yes (spec order error→dataavailable→stop) | **Adopt:** `onerror` records the error; `onstop` finalizes once; partial data → clip with `warning`, no data → `error`. `failed` allowed from `requesting`, `recording`, `finishing`. |
| P8 | `Math.round(400/1000) = 0` + `.positive()` rejects the whole memory | Yes | **Adopt:** one `durationSecondsFor(ms)` = `Math.max(1, Math.round(ms/1000))` on the client; schema `int().min(0).max(86_400)`; server maps `0` → `null`; tests at 1/199/400/499/500/999 ms. |
| P9 | `fix-webm-duration` swallows failures and resolves the original blob; UI must not claim "repaired" | Yes (source lines 492–505) | **Adopt (no UI claim exists):** keep try/catch for the FileReader path; smoke asserts `audio.duration` finite and seeking works; wall-clock vs media duration recorded as a known limitation. |
| P10 | Form busy must compose upload `phase` with recorder status; attachment precedence undefined | Yes | **Adopt:** `busy = phase.kind === "saving" || status ∈ {requesting, recording, finishing}` enforced in handlers too; file input cleared when a clip exists; a failed re-record keeps the previous accepted clip. |
| P11 | Chromium 41437397 is **Fixed (M73)**: modern Chrome throws `NotAllowedError` on OS denial | Yes (status Fixed, "Fail with NotAllowedError") | **Adopt — Context corrected:** the production silent clip's cause is **unconfirmed**; likeliest on current Chrome: macOS *Sound → Input* volume at zero, or the system default input being an idle/virtual device. Help for `silent` leads with input volume + "pick another microphone", then the OS permission. C1 becomes precedent, not proof. |
| P12 | iOS path is Settings → Apps → Safari → Microphone (+ Page Menu → Website Settings); Edge needs Edge wording | Yes (Apple page) | **Adopt:** copy updated; `windows-edge` platform added. Silence never diagnosed as permission denial. |
| P13 | Safari 18.4+ records WebM/Opus, so "Mac Safari = audio/mp4" is wrong | Yes | **Adopt:** verification tests both Safari paths and records browser/OS versions + `recorder.mimeType`. |
| P14 | Engine lifecycle can be tested in Node with injected factories | Yes | **Adopt:** `AudioRecorder` takes `{ mediaDevices, createAudioContext, createMediaRecorder, now }` with browser defaults; `__tests__/app/recorder.test.ts` covers cancel-before-grant, error→data→stop, double stop, stale finalize, cleanup. |
| P15 | ESLint: name both arrays | Yes | **Adopt:** `files` at `eslint.config.mjs:108` and `ignores` at `:131`. |
| P16 | Headless smoke not reproducible; env-file handling; release/rollback; a11y live region; CSS vars only emitted when used | Yes | **Adopt:** smoke script + fixture WAV committed under `scripts/`; offline checks run in a scratch worktree (never delete `.env*`); release = Vercel on merge, revert = Vercel rollback, old silent rows out of scope; timer outside `aria-live`; canvas colours have hex fallbacks. |
| P17 | Audio-level time semantics undefined | Yes | **Adopt:** `performance.now()`; `observedMs` counts analysed ticks only; gaps > 500 ms set `coverageGap = true` which downgrades "silent" to "unsure". |

## Verification record

| Check | Commit | Result | Evidence |
|---|---|---|---|
| `npm run validate` | a6839f2 | PASS | type-check + eslint clean in `jowray_wt_recorder` (no `.env*` present) |
| `npm run test:run` | a6839f2 | PASS | 24 files, 436 tests |
| `npm run build:offline` | a6839f2 | PASS | all routes built behind `scripts/no-network.mjs`; `/share` static, `/m/[claimToken]` partial prerender |
| Headless smoke, hearing | a6839f2 + smoke script | PASS | `node scripts/recorder-smoke.mjs --url http://localhost:3101/share --expect hearing` → status "Hearing you", timer 0:05, "Using: Fake Default Audio Input", player duration 5.137 s (WebM header patched), no verdict line |
| Headless smoke, silent mic (the incident) | same | PASS | `… --expect silent --audio-file scripts/fixtures/silence-1s.wav` → "We're not hearing anything" at 3 s, clip kept with "This recording sounds silent", help steps rendered, player duration 5.062 s |
| Astra W1 / W2 independent checks | run 20261103T195132Z-c4f37024 | PASS | vitest 308 / 151, type-check, eslint — see `tasks/*/checks-*/validation.json` |
| Engine lifecycle tests (W3) | run 20261103T200307Z-c8a76180 | pending | |
| Device matrix (Mac Chrome denied mic, headset picker, Mac Safari, iPhone Safari, Android, Firefox, Windows) | — | NOT RUN | needs Rob's devices; the smoke covers only Chromium with fake inputs |

Smoke prerequisites: Google Chrome at `/Applications/Google Chrome.app` (tested 156.0.8078.80), `npx next dev -p 3101` in a checkout, Node 22 (global `WebSocket`). Flags used: `--headless=new --use-fake-ui-for-media-stream --use-fake-device-for-media-stream --autoplay-policy=no-user-gesture-required [--use-file-for-fake-audio-capture=<16-bit PCM WAV>]`; `--screenshot-dir` writes `<expect>-recording.png` / `<expect>-clip.png`.
