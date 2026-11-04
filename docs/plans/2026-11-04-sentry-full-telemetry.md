# Sentry: turn on every feature for the family alpha (jowray.com)

Plan v2, 2026-11-04. Supersedes v1 (same day) after an external review; the review's disposition is in §17.

## 0. Cold start (read this first; it must be enough after a compaction or a hand-off)

1. **Repo and base.** `/Users/rob/Documents/active_work/jowray_com`, remote `origin` = `https://github.com/RobertdWray/jowray_com.git` (derive it with `git remote -v`; never trust a memorised repo). The primary checkout's local `main` is stale (f13c390) and dirty (untracked `docs/memory-drafter.md`, keep it). **Do not pull there.** Run `git fetch origin`, then work in a worktree: `git worktree add ../jowray_wt_sentry-<pr> origin/main -b feat/sentry-<pr>`. Pin the base: this plan was verified against **`origin/main` = `3f437eb42add510ae8cf2202b577e548500830f0`**; PR 1 was built on **`6210009`** (PR #30 merged) after re-running the §4 coverage check (see §16). If `origin/main` has moved, re-run the §4 coverage check (one `git grep`) before touching code and update the SHA here.
2. **Read before coding:** `AGENTS.md` (house rules: branch + PR for everything, no `eslint-disable` without Rob's "YES", no band-aids, Cache Components rule), `docs/code-layout.md`, `docs/environment.md`, `docs/plans/2026-11-02-bootstrap-report.md` (Sentry project `med3ai/jowray_com`, id `4512363870158848`), `node_modules/next/dist/docs/` for anything Next.js. Install with `npm ci` (lockfile). Versions verified: `@sentry/nextjs` 11.10.0 (= npm `latest`), Next 16.4.4, Pino 10.4.0, Prisma 7.10.1, Vercel Node 26.x, CI Node 26.
3. **Checks that must pass before any PR is opened:** `npm run validate`, `npm run test:run`, `npm run build:offline` (no `.env`, no `DATABASE_URL`).
4. **Durable copy.** The orchestrator commits this plan verbatim to `docs/plans/2026-11-04-sentry-full-telemetry.md` on the PR 1 integration branch **before** preparing any worker task (workers cite it by section; the `p1-tunnel-docs` task then only appends the ledger). The home-directory copy (`~/.claude-work/plans/can-you-please-check-serene-peacock.md`) is a draft only.
5. **Where you are:** read §16 (resume ledger) for the last recorded state, then continue from its "next action".
6. **How the work is run:** the plan-to-ship loop in `/Users/rob/Documents/active_work/TrayVerify/sales-mid-market-scoring/docs/workflows/orchestration.md` (prompts in the same folder: `premortum.md`, `friend-buckets-*.md`, `bucket-*-sorting.md`, `document-issue.md`, `final pr review instrucionts.md`). §6a says who does what: Astra workers (`/astra-work`, Codex, no network, two at a time, one owner per file) build every offline code, test and docs change; the orchestrator (Rob's pick of model, Opus 5.5 by default) writes briefs, reads every diff, runs every step that needs the network (installs, `gh`, previews, Sentry UI, curl), and Team Code Review (George + Oscar) reviews each PR. Nothing merges without Rob.

## 1. Context

Rob asked whether Sentry is fully turned on and, since the users are family alpha testers who approved full tracking, to enable every Sentry feature (100 % Session Replay, the "report a bug" widget, user identification by email) so vibe-coded bugs can be diagnosed from Sentry alone.

**Verified 2026-11-04 against the live site, the installed SDK and the current docs:**

| Area | State on `origin/main` 3f437eb / production | Verdict |
|---|---|---|
| SDK init | `instrumentation.ts` (server, Node only) + `instrumentation-client.ts`; production bundle carries the real DSN, `environment:"production"` (fetched the chunk) | Working |
| Errors | `onRequestError = captureRequestError`; `app/global-error.tsx` captures; `logError` → `captureException` | Working |
| Tracing | `tracesSampleRate: 0.1` both runtimes; Server Functions not wrapped | Partial |
| Logs | `pinoIntegration()` on the server; nothing on the client | Partial |
| Data policy | `lib/sentry/data-collection.ts` turns **off** user info, cookies, query params, DB query data, bodies, headers, stack variables | Restrictive by design (2026-11-02 plan, review item S7) |
| Session Replay / User Feedback / `setUser` / profiling / cron monitors / metrics / React annotation | none | Off |
| Tunnel | `tunnelRoute: "/monitoring"` in **rewrite** mode; production proxies (Sentry answers 401 to a junk envelope) | Works in production, **drops browser events on protected previews** on SDK ≥ 11.9 [C30] |
| Source maps | Uploaded on Vercel (`SENTRY_AUTH_TOKEN` in Production + Preview); `widenClientFileUpload` off | Partial |

So Sentry is installed and healthy; about half of its features are off, and the data policy strips the context Rob now wants. This plan flips the policy for the alpha while keeping **bearer secrets** (claim tokens, upload tickets, the Vercel bypass header) out of Sentry.

## 2. Decision provenance

| Decision | Ruling | Date | Who | Status |
|---|---|---|---|---|
| Full tracking for the alpha; 100 % replay; feedback widget; capture contributor email | Yes | 2026-11-04 | Rob (chat) | Approved |
| Standing authorization for aggressive tracking over privacy (family-only alpha); to be quoted in code and every PR | Yes; wording in §2a | 2026-11-04 | Rob (chat, verbatim) | Approved |
| Replay masking | Unmask everything: text, inputs, media | 2026-11-04 | Rob (AskUserQuestion) | Approved |
| Feedback entry point | Sentry's auto-injected floating button, bottom-right | 2026-11-04 | Rob | Approved |
| Node (server) profiling | Skip for now; Vercel runs Node 26.x, no prebuilt profiler binary [C26] | 2026-11-04 | Rob | Approved |
| Request bodies, headers, query strings, DB query data | Collect, with scrubbing | 2026-11-04 | Rob | Approved |
| Supersedes "Session Replay off; traces low" (2026-11-02 plan, item S7) | Yes | 2026-11-04 | Rob (chat) | Approved |
| Bearer secrets never reach Sentry | Kept from Phase 1; enforced by SDK denylist + repo scrubber + DOM blocks + tests | 2026-11-04 | plan | Assumed from house rule; Rob has not contradicted it |
| Replay on `/m/<token>` pages | **Recorded.** rrweb's meta event stores the page URL (token included) and no SDK hook or server-side rule can scrub it [C47][C49]; Rob accepts that one residual inside replay recordings. Everything that *can* be scrubbed still is (§5). | 2026-11-04 | Rob (AskUserQuestion) | Approved |
| Feedback screenshots | **On** (SDK default `enableScreenshot: true` [C50]); a thank-you-page screenshot may carry private links as pixels. Rob accepts that residual. | 2026-11-04 | Rob (AskUserQuestion) | Approved |
| DOM blocking (`data-sentry-block`) on link lists and media cards | **Not added**: with the two residuals above accepted, blocking would hide exactly the UI Rob wants to watch while protecting nothing the recording does not already contain (§14) | 2026-11-04 | plan | Follows from the rows above |
| Cron monitor semantics | Check-in `error` when any item failed or the run threw; production only | 2026-11-04 | plan | Proposed |
| Identity contract | `user.email` is the key; `user.username` = name; `user.id` = contributor id when known; memory/submission/media ids are **tags**, never `user.id` | 2026-11-04 | plan | Proposed |
| Who ends the alpha settings | Rob, when the alpha ends; §13 lists the exact reverts | 2026-11-04 | plan | Proposed |

## 2a. Standing authorization (Rob, 2026-11-04) — copy verbatim into code and PR notes

Rob's words, recorded so that no reviewer or later agent treats the data policy as an oversight:

> I have deliberately authorized and pushed for 100 % tracking and error data collection. The family has approved these aggressive tracking measures since it is an alpha, vibe-coded website and only family will be using it. Intensive logging to rapidly fix errors is more important than security and privacy.

Where it must appear, word for word:

1. **`lib/sentry/data-collection.ts`** — file header comment, above `DATA_COLLECTION`, followed by: "Bearer secrets (claim tokens, upload tickets, Vercel bypass header) are still scrubbed; see lib/sentry/scrub.ts and docs/plans/2026-11-04-sentry-full-telemetry.md §3."
2. **`instrumentation-client.ts`** — header comment above `Sentry.init` (this is where 100 % replay, unmasking, screenshots and profiling live).
3. **`instrumentation.ts`** — one-line pointer: "Data policy and Rob's authorization: lib/sentry/data-collection.ts."
4. **Every PR description** (PR 1, 2, 3) — a section headed `## Tracking authorization` containing the quote, the date, and the line "Residuals Rob accepted on 2026-11-04: the claim-page URL inside replay recordings and user-taken feedback screenshots." Reviewers (George/Oscar/team-code-review) are to be pointed at it when they raise privacy findings; such findings go to the Don't bucket with this section as the reason.
5. **`docs/code-layout.md`** — replace the Phase 1 "restrictive dataCollection / Replay off" wording with the quote and the §3 rulings.
6. **`docs/plans/2026-11-04-sentry-full-telemetry.md`** (the committed copy of this plan) — this section, unchanged.

When the alpha ends, the revert in §13 removes the configuration but **keeps the comments** with an added "Ended on <date>" line, so history stays readable.

## 3. Rulings (so later agents do not re-litigate)

1. **Allowed in Sentry from now on:** contributor email and name as user context; Server Function inputs and outputs; headers (minus secrets); Prisma query data; stack-frame locals (minus secrets); unmasked replays of `/`, `/share`, `/obituary` and the thank-you state.
2. **Still forbidden in events, spans, logs, contexts, breadcrumbs, replay metadata and replay network/console data:** claim tokens in any form (`/m/<token>` paths, `?t=` queries, `claimToken`, `claimTokens[]`, `claimLink`), upload tickets (`ticket`, `clientPayload`, `sig`), and the values of `cookie`, `authorization`, `x-vercel-protection-bypass`, `x-vercel-signature`. **Two accepted residuals (Rob, 2026-11-04):** the page URL inside replay DOM recordings of `/m/<token>` (rrweb meta event, unscrubbable) and user-taken feedback screenshots. Nothing else may carry a token; the envelope test (§7.4) is the gate.
3. The Pino logger's `[Redacted]` behaviour for log **lines** is unchanged. Sentry Logs still get `user.email` automatically once the user is set [C22].
4. Cron monitoring uses the stable check-in API, not `_experimental.vercelCronsMonitoring` [C29].
5. Tunnel moves to handler mode at `app/sentry-tunnel/route.ts` [C30][C31].
6. Identity is set only where the contributor row is already loaded (no extra queries for telemetry); elsewhere ids go on tags.

## 4. Operation map (verified at 3f437eb; re-verify with `git grep -n "^export async function" origin/main -- 'app/**/actions.ts' app/api features/memories`)

| Operation (file:export) | Feature | Client failure path | Identity (PR 2) | Tags | Metric | Tests touched |
|---|---|---|---|---|---|---|
| `app/share/actions.ts:createSubmission` | `features/memories/create-submission.ts:createSubmission` | `lib/submission-pipeline.ts` `runSubmission` catch → `unreachable` | after `safeParse` (email, name); after `tx.contributor.create` (id) | `submission_id` | `memory.created` ×n | `__tests__/features/create-submission.test.ts`, `__tests__/lib/submission-pipeline.test.ts` |
| `app/share/actions.ts:issueUploadTicket` | `features/memories/issue-upload-ticket.ts` | pipeline `attempt` → `no_ticket` | none (contributor not loaded) | `memory_id`, `media_id` | — | `__tests__/features/issue-upload-ticket.test.ts` |
| `app/share/actions.ts:finalizeUpload`, `app/m/[claimToken]/actions.ts:finalizeAddedFile` | `features/memories/ingest-upload.ts:finalizeUpload` | pipeline `attempt` catch; `media-list-client.tsx` catches | none | `memory_id`, `media_id` | `upload.finalized{status}` | `__tests__/features/ingest-upload.test.ts` |
| `app/share/actions.ts:completeSubmission` | `features/memories/complete-submission.ts:completeSubmission` | pipeline `finally` catch | after `loadSubmission` (contributor email, name) | `submission_id` | `confirmation.sent{skipped}` | `__tests__/features/complete-submission.test.ts` |
| `app/m/[claimToken]/page.tsx` render | `features/memories/claim.ts:getMemoryForClaim` | n/a | after load (`ClaimView.contributor`) | `memory_id` | — | `__tests__/features/claim.test.ts` |
| `app/m/[claimToken]/actions.ts:updateMemory` | `claim.ts:updateMemoryFromClaim` | `claim-form.tsx` catch | after load (add `email: true` to the contributor `select`) | `memory_id` | — | `__tests__/features/claim.test.ts` |
| `…actions.ts:removeFile`, `cancelReservation`, `updateMediaWords` | `claim.ts:removeMediaFromClaim`, `cancelReservation`, `updateMediaFromClaim` | `media-list-client.tsx` catches | none | `memory_id`, `media_id` | — | `__tests__/features/claim.test.ts` |
| `…actions.ts:addFileTicket`, `replaceFileTicket`, `retryUploadTicket` | `create-memory.ts:createUploadTicket`, `createReplacementTicket`; `issue-upload-ticket.ts` | `media-list-client.tsx` catches | none | `memory_id`, `media_id` | — | `__tests__/features/create-memory.test.ts` |
| `app/api/upload/route.ts:POST` (Blob callback) | `ingest-upload.ts:recordMedia` | n/a | none | `media_id` | — | `__tests__/api/upload.test.ts` |
| `app/api/media/[id]/route.ts:GET` | — | n/a | none | `media_id` | — | `__tests__/api/media.test.ts` |
| `app/api/cron/reconcile-uploads/route.ts:GET` | `confirmMemory`, `confirmSubmission`, `recordMedia`, `computeChecksum`, … | n/a | **never** (each item runs in `withIsolationScope`) | per item | `reconcile.run{errors}` | `__tests__/api/reconcile.test.ts` |
| Deferred work (`afterWithFlush`) | `app/api/upload/route.ts:86`, `complete-submission.ts:299`, `ingest-upload.ts:219,223` | n/a | inherits request | inherits | — | the four suites that mock `@/lib/sentry/after-flush` |
| Browser-only swallowed errors | `app/share/use-recorder.ts` (3), `app/share/recorder.ts` (3), `app/share/use-share-draft.ts` (3), `app/m/[claimToken]/claim-form.tsx` (1), `app/m/[claimToken]/media-list-client.tsx` (3), `lib/submission-pipeline.ts` (4) | `reportClientError` (PR 2) | browser `identifyContributor` | `surface`, `step` | — | `__tests__/lib/submission-pipeline.test.ts`, `__tests__/app/recorder.test.ts` |

## 5. Secret-surface matrix (what carries a secret, and what removes it)

| Surface | Secret that can appear | Defence | Verified by |
|---|---|---|---|
| Error/message events: `request.url`, `transaction`, breadcrumbs, spans | `/m/<token>`, `?t=` | `scrubEvent`/`scrubBreadcrumb`/`scrubSpan` (exists) | `__tests__/lib/sentry-scrub.test.ts` (exists) |
| `request.data`, `contexts`, `extra`, Server Action input/response contexts | `claimToken`, `claimTokens[]`, `ticket{…}`, `claimLink`, serialized JSON strings | `scrubSecrets` (PR 1) + SDK denylist for `token`/`auth` [C20] | PR 1 unit tests + **envelope test** (`createTransport` capture) [C53] |
| `request.headers` | `authorization`, `cookie`, `x-vercel-*` | `httpHeaders: { request: { deny: SECRET_HEADER_KEYS } }` [C19] + `scrubHeaders` | envelope test |
| Stack-frame locals | `claimToken`, `ticket` variables | `stackFrameVariables: { deny: SECRET_FIELD_KEYS }` [C19] | envelope test with a thrown error inside a function holding a token local |
| Streamed spans (`beforeSendSpan`) | `url.full`, `url.query`, `http.request.body?` | `scrubSpan` + `scrubSecrets` on `attributes` (PR 1) | unit tests |
| Logs (`beforeSendLog`) | messages/attributes with URLs or tokens | `scrubLog` + `scrubSecrets` (PR 1) | unit tests |
| Replay **metadata** event (`replay_event.urls`) | `/m/<token>` | `scrubReplayEvent` event processor [C11] | unit test |
| Replay **custom** events (network bodies, console, breadcrumbs) | `claimToken` in Server Function payloads, `?t=` media URLs | `beforeAddRecordingEvent: scrubRecordingEvent` (only custom events pass through this hook; verified in SDK source) [C10] | unit test |
| Replay **DOM** snapshots (text + attributes) and rrweb meta `href` | thank-you link text and `href`; `/api/media/…?t=` in `src`/`href` on `/m/*`; the `/m/<token>` page URL | **Accepted residual** (Rob, 2026-11-04). No SDK option scrubs the meta `href` (verified in `@sentry/replay` source) and server-side rules do not cover recordings [C49]; `data-sentry-block` would only hide the UI Rob wants to see [C47]. | listed in §14 so reviewers do not re-raise it |
| Feedback form text | whatever the user types | accepted (user-authored) | — |
| Feedback screenshot | thank-you links as pixels | **Accepted residual** (Rob, 2026-11-04); SDK default `enableScreenshot: true` [C50] | — |
| Crash-report dialog | none (free text) | — | — |
| Signed media URLs (`/api/media` → 60 s presigned redirect) | the redirect URL in network breadcrumbs | redirect target is a Blob URL with a short-lived signature; URL recorded only as a breadcrumb; acceptable, noted in §14 | — |

## 6. PR contract (stacked, in this order)

| PR | Branch | Owns | Prerequisite | Merge gate | Still unavailable after it |
|---|---|---|---|---|---|
| **PR 1 — Transport + scrubbing foundation** | `feat/sentry-1-foundation` | `app/sentry-tunnel/route.ts`, `next.config.ts` (tunnel only), `lib/sentry/secrets.ts`, `lib/sentry/scrub.ts`, `lib/sentry/data-collection.ts` (policy flip), `lib/logger/logger.ts` (import), `__tests__/lib/sentry-scrub.test.ts`, `__tests__/lib/sentry-envelope.test.ts`, `docs/plans/2026-11-04-sentry-full-telemetry.md` | none | checks green; build log shows the tunnel handler line [C31]; envelope test proves no synthetic token leaves the server SDK; preview: a forced error arrives in Sentry from a **protected** preview | replay, feedback, identity, profiling, cron monitors |
| **PR 2 — Identity, tracing, Server Function spans, client error reports, cron monitor, metrics** | `feat/sentry-2-identity` | `lib/sentry/user.ts`, `lib/sentry/server-action.ts`, `lib/sentry/report.ts`, `lib/sentry/metrics.ts`, `lib/sentry/after-flush.ts`, both `actions.ts`, listed features, `instrumentation*.ts` (traces 1.0, console logs, Pino error level), cron route, client catch sites, tests | PR 1 merged | checks green; preview: Issues show `user.email`; Traces show a `createSubmission` span linked to a browser pageload; Crons (production only, after merge) | replay, feedback, profiling |
| **PR 3 — Replay, feedback, profiling, annotation** | `feat/sentry-3-replay` | `instrumentation-client.ts`, `next.config.ts` (headers, widen, annotation, applicationKey), `app/globals.css`, `app/global-error.tsx`, docs | PR 2 merged | checks green; preview: replay unmasked on `/share` and `/m/*` (photos visible), replay `urls` list shows `/m/[claimToken]`, network bodies show `"claimToken":"[Filtered]"`; feedback with pre-filled email and a screenshot; profiles from Chrome; `Document-Policy` header present | Node profiling (§14) |

Each PR description carries the `## Tracking authorization` section (§2a item 4) and ends with the §15 follow-ups that touch its files. Each PR: built by Astra workers in waves (§6a), draft PR published by the `/astra-work` helper, verified by the orchestrator on the PR's own preview deployment (Deployment Protection stays on; use `x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET` for curl), reviewed by Team Code Review, repaired through the §6b loop, evidence in the ledger, then marked ready for Rob. After PR 3 merges: production smoke check (§11.4).

## 6a. Who does what (Astra workers vs the orchestrator)

**Fixed rules for every wave** (from the `astra-work` skill and the prior runs on this repo):
- Two workers at a time, one owner per file, briefs cite the committed plan copy by section (`docs/plans/2026-11-04-sentry-full-telemetry.md §…`), never the home-directory draft.
- Worker shells have no network, and the Codex config loads MCP servers (Sentry, Neon, a browser). Every brief forbids MCP use, `gh`, `vercel`, `sentry` CLI and any outbound call; the orchestrator audits each attempt's `events.jsonl` for them before `accept`.
- Workers cannot run `next build` inside the sandbox (loopback IPC refused, 2026-11-03). Worker self-checks are `npm run validate` and `npm run test:run`; `npm run build:offline` is the helper's unsandboxed `check`, launched by the orchestrator. `tsx` CLI fails in the sandbox; briefs say `node --import tsx <file>` if a script is ever needed.
- Tests for risky code are written by a **different** worker, in the **next** wave, from the plan's contract (signatures and assertions in §7–§9), with the instruction "do not read the implementation; write from the contract". Failures then expose contract gaps, which become repair tasks from the integrated SHA, never a resumed worker.
- The orchestrator installs `node_modules` (`npm ci`) in every helper worktree including the integration one, reads every `inspection.diff` against the spec before `accept`, keeps the §16 ledger, and runs everything in §10–§11.
- No real names or emails in fixtures (`sentry-test@jowray.com`, `Sentry Test`); the `SENTRYTEST_` token prefix.

| PR / wave | Task id | Owned paths (literal) | Plan sections | Self-checks | Orchestrator afterwards |
|---|---|---|---|---|---|
| PR 1 · wave 1 | `p1-scrub` | `lib/sentry/secrets.ts`, `lib/sentry/scrub.ts`, `lib/sentry/data-collection.ts`, `lib/logger/logger.ts` | §7.2, §7.3 (code only), §7.5, §2a item 1 | `validate`, `test:run` (existing scrub tests must still pass) | helper `check` incl. `build:offline`; integrate |
| PR 1 · wave 1 | `p1-tunnel-docs` | `app/sentry-tunnel/route.ts`, `next.config.ts`, `docs/plans/2026-11-04-sentry-full-telemetry.md`, `docs/code-layout.md`, `AGENTS.md` (code-layout copy) | §7.1, §7.6, §2a items 5–6 | `validate`, `test:run` | helper `check`; confirm the tunnel line in the build log; integrate |
| PR 1 · wave 2 | `p1-tests` | `__tests__/lib/sentry-scrub.test.ts`, `__tests__/lib/sentry-envelope.test.ts` | §7.3 test list, §7.4 (from the contract, not the code) | `validate`, `test:run` | if red: repair task on `p1-scrub` paths from the integrated SHA; combined `check`; `publish` draft PR; §11.1 preview gate; TCR |
| PR 2 · wave 1 | `p2-lib` | `lib/sentry/user.ts`, `lib/sentry/server-action.ts`, `lib/sentry/report.ts`, `lib/sentry/metrics.ts`, `lib/sentry/after-flush.ts` | §8.1, §8.5 helper, §8.6 helper, §8.7, §8.9 | `validate`, `test:run` | integrate (wave 2 imports these) |
| PR 2 · wave 2 | `p2-server` | `features/memories/create-submission.ts`, `features/memories/complete-submission.ts`, `features/memories/claim.ts`, `features/memories/ingest-upload.ts`, `features/memories/issue-upload-ticket.ts`, `features/memories/create-memory.ts`, `app/share/actions.ts`, `app/m/[claimToken]/actions.ts`, `app/api/upload/route.ts`, `app/api/cron/reconcile-uploads/route.ts`, `instrumentation.ts`, the four existing suites that mock `@/lib/sentry/after-flush` (`__tests__/api/upload.test.ts`, `__tests__/features/complete-submission.test.ts`, `__tests__/features/ingest-upload.test.ts`, `__tests__/features/create-submission.test.ts`; mock-signature change only) | §8.2, §8.4 server, §8.5 call sites, §8.7 callers, §8.8, §8.9 callers | `validate`, `test:run` | integrate |
| PR 2 · wave 2 | `p2-client` | `instrumentation-client.ts`, `app/share/share-form.tsx`, `app/m/[claimToken]/claim-form.tsx`, `app/m/[claimToken]/media-list-client.tsx`, `app/share/use-recorder.ts`, `app/share/recorder.ts`, `app/share/use-share-draft.ts`, `lib/submission-pipeline.ts` | §8.3, §8.4 client, §8.6 call sites | `validate`, `test:run` | integrate |
| PR 2 · wave 3 | `p2-tests` | `__tests__/lib/sentry-user.test.ts`, `__tests__/api/reconcile.test.ts`, `__tests__/lib/submission-pipeline.test.ts`, `__tests__/lib/sentry-envelope.test.ts` (add the `instrumentedAction` case) | §8.1 test, §8.2 cron isolation test, §8.6 pipeline hook assertions, §8.8 tests, §8.5 envelope case | `validate`, `test:run` | repairs if red; combined `check`; `publish`; §11.2 preview gate; TCR |
| PR 3 · wave 1 | `p3-client` | `instrumentation-client.ts`, `app/globals.css`, `app/global-error.tsx` | §9.1, §9.4, §9.5, §2a item 2 | `validate`, `test:run` | integrate |
| PR 3 · wave 1 | `p3-config-docs` | `next.config.ts`, `docs/environment.md`, `docs/code-layout.md`, `docs/plans/2026-11-04-sentry-full-telemetry.md` (ledger + §14/§15 copy into PR notes) | §9.3, §14, §15 | `validate`, `test:run` | combined `check`; `publish`; §11.3 preview gate; TCR; after merge §11.4 |

Deep-context work that stays with the orchestrator (needs the network, the browser, or judgement over live data): every item in §10 and §11, the `events.jsonl` audit, diff acceptance, the four-bucket sort of review findings, and all Sentry/Vercel UI checks.

**Brief template** (one per task; the helper's `prepare` takes it as JSON with `owned_paths` and `checks`):
```
# Task <id> — <title>
## Objective — implement <plan §…> of docs/plans/2026-11-04-sentry-full-telemetry.md; read §0–§3 first, then the sections named, then the [C…] citations they reference.
## Exactly what to build — <the plan section's code blocks and tests, copied, not summarised>
## Rules — AGENTS.md; no eslint-disable / ts-ignore / band-aids; Pino not console on the server; Client Components never import @/server or @/integrations; no network, no MCP servers, no gh/vercel/sentry CLI; do not stage/commit/push; edit only the owned paths; do not read <implementation file> when writing tests from the contract.
## Checks — npm run validate; npm run test:run (expect N passed; state the number from the integrated SHA).
## Report — outcome, files changed, checks with results, every deviation from the plan with its reason.
```

## 6b. Review-and-repair loop (per PR, one to three cycles)

1. **Premortem on the committed plan (once, before PR 1 workers launch):** `/team-code-review` on `docs/plans/2026-11-04-sentry-full-telemetry.md` with `premortum.md`. The 2026-11-04 external review (§17) is round 1; this is round 2. Sort with `friend-buckets-plan-review.md`, act with `bucket-plan-sorting.md`, Rob confirms.
2. **PR review:** `/team-code-review` on the draft PR (George + Oscar; both must succeed). Sort with `friend-buckets-issue-review.md`; **Rob confirms the buckets.**
3. **Issues:** buckets 1 + 2 bundled and written as cited GitHub issues by issue-writer subagents (Rob's pick of model; `document-issue.md` template; `gh issue create --repo RobertdWray/jowray_com`). Bucket 3 goes into the PR notes under "Deliberately not done"; bucket 4 into "Follow-ups" (§15 format).
4. **Repair:** fresh Astra tasks from the reviewed integrated SHA (never a resumed worker), orchestrator inspects every repair, repair commits go back through `/team-code-review`.
5. **Regression gate and ship:** a Fable 5.1 subagent looks for regressions (step 5 of `final pr review instrucionts.md`); Rob gives the go-ahead; merge when CI is green. Stop when nothing severe is left, Rob says stop, or the goals are met.

---

## 7. PR 1 — Transport + scrubbing foundation

### 7.1 `app/sentry-tunnel/route.ts` (new) and `next.config.ts` `tunnelRoute: "/sentry-tunnel"`

```ts
export { POST } from "@sentry/nextjs/tunnel";
```
Handler mode forwards only the envelope body, accepts only this project's DSN and works behind Vercel Deployment Protection, which rewrite mode no longer does on 11.9+ [C30][C31]. Exact path, not in a route group; `tsconfig.json` already uses `moduleResolution: "bundler"` [C31]. A `POST`-only handler is never prerendered (Cache Components rule holds). No `proxy.ts` exists, so no matcher change. The build must print `[@sentry/nextjs] The tunnel route sends events through app/sentry-tunnel/route.ts.` [C31].

### 7.2 `lib/sentry/secrets.ts` (new)

```ts
/** Keys whose values are bearer secrets; matched case-insensitively as whole keys. */
export const SECRET_FIELD_KEYS = ["claimToken", "claimTokens", "claimLink", "ticket", "clientPayload", "sig"] as const;
/** Key fragments: any key containing one of these is a secret (covers future `*Token*` fields). */
export const SECRET_KEY_FRAGMENTS = ["token", "ticket"] as const;
export const SECRET_HEADER_KEYS = ["cookie", "authorization", "x-vercel-protection-bypass", "x-vercel-signature"] as const;
```
Pure constants, no `server-only`, usable in the browser. `lib/logger/logger.ts` imports `SECRET_HEADER_KEYS` from here (its local copy goes away; behaviour pinned by `__tests__/lib/logger.test.ts`). The SDK denylist already matches `token`/`auth` by partial key [C20]; `ticket`, `clientPayload`, `sig`, `claimLink` and the two `x-vercel-*` headers are not on it. `[C20, C21]`

### 7.3 `lib/sentry/scrub.ts` — scrubber v2 (TDD; extend `__tests__/lib/sentry-scrub.test.ts`)

Keep `scrubUrl`, `scrubBreadcrumb`, `scrubSpan`, `scrubLog`. Add:

- `scrubSecrets(value: unknown): unknown` — recursive over objects/arrays; a key matching `SECRET_FIELD_KEYS` or containing a `SECRET_KEY_FRAGMENTS` fragment (case-insensitive) becomes `"[Filtered]"` whatever its type (string, array, object); strings pass through `scrubUrl` **and** a JSON-text pass that replaces `"claimToken(s)?"\s*:\s*(\[[^\]]*\]|"[^"]*")`, `"ticket"\s*:\s*\{…\}` and `"claimLink"\s*:\s*"[^"]*"` with filtered forms (Server Function wire format is serialized text in recorded bodies and in `recordResponse`). Depth cap 20 (same as `redactPii`).
- `scrubHeaders(headers)` — drops the values of `SECRET_HEADER_KEYS` (case-insensitive).
- `scrubEvent` additionally applies `scrubSecrets` to `event.request.data`, `event.contexts`, `event.extra`, every `event.exception.values[*].stacktrace.frames[*].vars`, and `scrubHeaders` to `event.request.headers`. It must **not** touch `event.user` (ruling 1). `[C21]`
- `scrubSpan`/`scrubLog`/`scrubBreadcrumb` also run `scrubSecrets` over `attributes`/`data`.
- `scrubReplayEvent(event)` — for `event.type === "replay_event"`, map `event.urls` through `scrubUrl`; otherwise return unchanged [C11].
- `scrubRecordingEvent(event)` — for `beforeAddRecordingEvent`; runs `scrubSecrets` over `event.data.payload` and returns the event [C10].

Tests (all with a synthetic token `TEST_TOKEN = "SENTRYTEST_" + 32 chars` that also appears in the envelope test): the current `completeSubmission` input `{ claimTokens: [t1, t2] }` → `"[Filtered]"`; a `createSubmission` response `{ memories: [{ claimToken }] }` as object **and** as JSON text; `{ ticket: { sig, pathname } }`; nested arrays; a truncated JSON string (`…"claimToken":"abc`) still loses the token; `x-vercel-protection-bypass` dropped, `content-type` kept; `user.email` preserved; replay `urls` scrubbed; recording payload with `?t=` scrubbed; frame `vars` scrubbed.

### 7.4 `__tests__/lib/sentry-envelope.test.ts` (new) — the decisive gate

Initialise the **server** SDK in the test with a capturing transport and the production hooks:

```ts
import * as Sentry from "@sentry/nextjs";
const sent: string[] = [];
Sentry.init({
  dsn: "https://public@o0.ingest.sentry.io/0",
  dataCollection: DATA_COLLECTION,
  transport: (options) => Sentry.createTransport(options, async (request) => { sent.push(String(request.body)); return { statusCode: 200 }; }),
  beforeSend: scrubEvent, beforeSendSpan: scrubSpan, beforeBreadcrumb: scrubBreadcrumb, beforeSendLog: scrubLog,
});
```
Then: `Sentry.setUser({ email: "sentry-test@jowray.com" })`, `setContext("server_action_input", { claimTokens: [TEST_TOKEN] })`, throw from a function with a local `const claimToken = TEST_TOKEN`, `captureException`, `Sentry.logger.info(\`/m/${TEST_TOKEN}\`)`, `await Sentry.flush()`. Assert every captured envelope string **does not contain** `TEST_TOKEN` and **does contain** `sentry-test@jowray.com`. `transport` is the documented injection point [C53]; `createTransport` is exported by `@sentry/nextjs` (verified). This runs under Vitest's `node` environment with the `server-only` stub, like the other suites.

### 7.5 `lib/sentry/data-collection.ts` — flip the policy, keep the denylists

```ts
export const DATA_COLLECTION: DataCollection = {
  userInfo: true,                                        // [C19]
  cookies: false,                                        // the site sets no cookies
  urlQueryParams: true,                                  // `t=` removed by scrubUrl before send
  databaseQueryData: true,                               // [C19]
  httpBodies: ["incomingRequest", "outgoingResponse"],   // request body in; Server Action responses are *outgoing* (SDK checks `outgoingResponse`) [C19]
  httpHeaders: { request: { deny: [...SECRET_HEADER_KEYS] }, response: true },
  genAI: { inputs: true, outputs: true },
  stackFrameVariables: { deny: [...SECRET_FIELD_KEYS, ...SECRET_KEY_FRAGMENTS] },
};
```
Verified in the installed SDK: `withServerActionInstrumentation` records the response only when `httpBodies` includes `"outgoingResponse"`; the inbound body size follows `"incomingRequest"`. The file header carries Rob's authorization verbatim (§2a item 1) and cites §3. The policy flip ships in PR 1 **because** the envelope test is what proves it safe; nothing else in PR 1 adds data.

### 7.6 Durable plan

Commit this document to `docs/plans/2026-11-04-sentry-full-telemetry.md` with the §16 ledger started. `docs/code-layout.md` gets one paragraph: tunnel handler line is part of a healthy build log; Rob's authorization (§2a) and the Sentry data rulings (§3).

---

## 8. PR 2 — Identity, tracing, Server Function spans, client error reports, cron monitor, metrics

### 8.1 `lib/sentry/user.ts` (new)

```ts
export interface ContributorIdentity { id?: string | null; email?: string | null; name?: string | null }
/** Browser and server. `email` is the key; without it nothing is set (ruling 6). */
export function identifyContributor(c: ContributorIdentity): void {
  if (!c.email) { return; }
  Sentry.setUser({ email: c.email, username: c.name ?? undefined, ...(c.id ? { id: c.id } : {}) });
}
export function clearContributor(): void { Sentry.setUser(null); }
```
`setUser` applies to the current request on the server [C18]; in the browser it applies to the page session. Test: `__tests__/lib/sentry-user.test.ts` with `vi.mock("@sentry/nextjs")` (pattern from `__tests__/lib/logger.test.ts`).

### 8.2 Server call sites (per §4 "Identity" column)

- `features/memories/create-submission.ts`: after `createSubmissionInputSchema.safeParse` → `identifyContributor({ email, name })`; after `tx.contributor.create` → again with `id`; `Sentry.setTag("submission_id", submissionId)` [C54].
- `features/memories/complete-submission.ts`: after `loadSubmission` (first memory's `contributor`).
- `features/memories/claim.ts`: `getMemoryForClaim` and `updateMemoryFromClaim` (add `email: true` to the contributor `select` in the transaction query); `setTag("memory_id", …)` in every claim feature.
- `features/memories/ingest-upload.ts` `finalizeUpload`, `issue-upload-ticket.ts`, `create-memory.ts` ticket functions: tags only (`memory_id`, `media_id`); no identity (contributor not loaded; ruling 6).
- **Cron** (`app/api/cron/reconcile-uploads/route.ts`): wrap each per-item call in `Sentry.withIsolationScope(() => …)` so an identity set by a shared feature (e.g. `confirmMemory`) cannot leak to the next item [C55]. Test: two sequential items with different contributors → `setUser` calls observed on different scopes (mock `withIsolationScope` to assert it wraps each item).

### 8.3 Client call sites

- `app/share/share-form.tsx`: `useEffect` on `remembered` → `identifyContributor(remembered)`; in the submit handler, before `runSubmission`, `identifyContributor({ email, name })` from the typed fields. No `user.id` in the browser (the contributor id is not returned to the client); `submission_id` becomes a tag after success.
- `app/m/[claimToken]/claim-form.tsx`: `useEffect` → `identifyContributor({ id: undefined, ...memory.contributor })`; `setTag("memory_id", memory.id)`.
- Feedback (PR 3) then pre-fills name/email from this user [C15].

### 8.4 `instrumentation-client.ts` and `instrumentation.ts`

- Both: `tracesSampleRate: 1.0` [C5].
- Client: `integrations: [Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] })]` [C22].
- Server: `pinoIntegration({ error: { levels: ["fatal"] } })` [C23]; keep `prismaIntegration()` [C40].

### 8.5 `lib/sentry/server-action.ts` (new) + both `actions.ts`

```ts
export async function instrumentedAction<T>(name: string, input: unknown, run: () => Promise<T>): Promise<T> {
  Sentry.setContext("server_action_input", scrubSecrets(input) as Record<string, unknown>);   // [C41b]
  return Sentry.withServerActionInstrumentation(name, { headers: await headers(), recordResponse: true }, run);   // [C3][C4]
}
```
Apply to every export in `app/share/actions.ts` (`createSubmission`, `issueUploadTicket`, `completeSubmission`, `finalizeUpload`) and `app/m/[claimToken]/actions.ts` (`updateMemory`, `addFileTicket`, `replaceFileTicket`, `finalizeAddedFile`, `removeFile`, `cancelReservation`, `retryUploadTicket`, `updateMediaWords`). The recorded response passes through `scrubEvent` (PR 1), so `claimToken(s)` in results are filtered; the envelope test gains a case that calls `instrumentedAction` with a result containing `TEST_TOKEN`.

### 8.6 `lib/sentry/report.ts` (new) — swallowed browser errors

`reportClientError(error: unknown, context: { surface: string; step: string; [k: string]: unknown })` → `Sentry.captureException(error, { tags: { surface, step }, extra: scrubSecrets(rest) })` [C41]. Call it in every bare `catch {}` listed in §4's last row; the user-facing messages stay unchanged. `lib/submission-pipeline.ts` is dependency-injected and tested in Node, so `reportClientError` is passed in through `PipelineHooks` (`onError?`) rather than imported, and `__tests__/lib/submission-pipeline.test.ts` asserts it is called with `step` = `create` / `upload` / `cancel` / `complete`.

### 8.7 `lib/sentry/metrics.ts` (new)

Thin wrappers over `Sentry.metrics.*` [C24]: `memoryCreated(count)`, `uploadFinalized(status)`, `confirmationSent(outcome)`, `reconcileRun(durationMs, errors)`. Called per §4. Tests mock the module.

### 8.8 Cron monitor — `app/api/cron/reconcile-uploads/route.ts`

Replace the return with explicit check-ins (not `withMonitor`, which reports `ok` whenever the callback resolves — verified in `@sentry/core/monitor.js` — while this job swallows per-item failures into `counts.errors`):

```ts
export const RECONCILE_SCHEDULE = "*/10 * * * *";
const MONITOR = { schedule: { type: "crontab", value: RECONCILE_SCHEDULE }, checkinMargin: 5, maxRuntime: 2, timezone: "UTC", failureIssueThreshold: 2, recoveryThreshold: 1 } as const;
const monitored = process.env.VERCEL_ENV === "production";      // previews and manual runs never create or miss a monitor
const checkInId = monitored ? Sentry.captureCheckIn({ monitorSlug: "reconcile-uploads", status: "in_progress" }, MONITOR) : null;
try { …existing body unchanged… ; finish(counts.errors > 0 ? "error" : "ok"); return NextResponse.json({ success: true, data: counts }); }
catch (error) { finish("error"); throw error; }
```
Semantics: **ok** = every item succeeded or nothing was due; **error** = any item failed (`counts.errors > 0`), the run threw, or it overran `maxRuntime` (Sentry side) [C28][C52]. Items that are deliberately deferred (`leased`, `not_ready`, `in_submission`) are not errors today and stay that way. Tests in `__tests__/api/reconcile.test.ts`: healthy run → `ok`; one failing item → `error`; thrown → `error` + rethrow; `VERCEL_ENV=preview` → no check-ins; and `RECONCILE_SCHEDULE === JSON.parse(vercel.json).crons[0].schedule`.

### 8.9 `lib/sentry/after-flush.ts`

Add a `name` parameter and wrap the callback: `after(async () => { try { await Sentry.startSpan({ name, op: "task" }, callback); } catch (error) { logError(…) } finally { await Sentry.flush(5000) … } })` — the existing catch and the `finally` flush are kept verbatim; only the span wrapper is added [C46]. Update the four callers (§4) and the four test mocks of `@/lib/sentry/after-flush`.

---

## 9. PR 3 — Replay, feedback, profiling, annotation

### 9.1 `instrumentation-client.ts` (final shape)

```ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 1.0,
  profileSessionSampleRate: 1.0, profileLifecycle: "trace",            // [C25][C27]
  replaysSessionSampleRate: 1.0,                                       // [C6]
  replaysOnErrorSampleRate: 1.0,                                       // [C14]
  dataCollection: DATA_COLLECTION,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: false, maskAllInputs: false, blockAllMedia: false,   // [C8]
      networkDetailAllowUrls: [window.location.origin], networkCaptureBodies: true,   // [C9]
      beforeAddRecordingEvent: scrubRecordingEvent,                     // [C10]
    }),
    Sentry.feedbackIntegration({
      colorScheme: "system", showBranding: false,                       // screenshots stay on (SDK default) [C13][C50]
      triggerLabel: "Report a problem", formTitle: "Report a problem", submitButtonLabel: "Send",
      messagePlaceholder: "What happened? What did you expect?", successMessageText: "Thank you. Rob will take a look.",
      isEmailRequired: false, tags: { surface: "feedback-widget" },     // [C15][C16]
    }),
    Sentry.browserProfilingIntegration(),                               // [C25]
    Sentry.thirdPartyErrorFilterIntegration({ filterKeys: ["jowray_com"], behaviour: "apply-tag-if-contains-third-party-frames" }),   // [C34]
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),   // [C22]
  ],
  beforeSend: scrubEvent, beforeSendSpan: scrubSpan, beforeBreadcrumb: scrubBreadcrumb, beforeSendLog: scrubLog,
});
Sentry.addEventProcessor(scrubReplayEvent);                            // [C11]
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;   // [C36]
```
Replay is client-only [C7]; everything here is synchronous top-level code as the Next.js convention requires [C36]. The 16 ms dev-init warning is expected [C36].

### 9.2 What is deliberately *not* masked or blocked

No `data-sentry-block` / `data-sentry-mask` attributes are added anywhere (Rob, 2026-11-04: record `/m/*`, keep screenshots). The thank-you link list and the claim-page media are therefore visible in replays, and the `/m/<token>` URL is inside the recording's meta event. The scrubbing that still applies on these pages: replay `urls` metadata (`scrubReplayEvent`), network request/response bodies and console args (`scrubRecordingEvent`), and every error/span/log/context (`scrub*`). If this ruling is ever reversed, the mechanism is `data-sentry-block` on the `<ul>` in `app/share/thank-you-client.tsx` and on each card in `app/m/[claimToken]/media-list-client.tsx` [C47][C48], plus `replaysSessionSampleRate: 0` on `/m/*` at init time.

### 9.3 `next.config.ts`

```ts
async headers() {
  return [
    { source: "/:path*", headers: [{ key: "Document-Policy", value: "js-profiling" }] },   // [C25][C35]
    { source: "/m/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },  // unchanged
  ];
}
…
withSentryConfig(nextConfig, {
  org: "med3ai", project: "jowray_com",
  tunnelRoute: "/sentry-tunnel",                 // PR 1
  widenClientFileUpload: true,                   // [C32]
  reactComponentAnnotation: { enabled: true },   // [C33]
  applicationKey: "jowray_com",                  // [C34]
  telemetry: false, silent: !process.env.CI,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
```

### 9.4 `app/globals.css`

`#sentry-feedback { --accent-background: <site red token>; --font-family: <body font token>; }` so the floating button matches the design [C16]. No React code.

### 9.5 `app/global-error.tsx`

```ts
useEffect(() => {
  const eventId = Sentry.captureException(error);
  Sentry.showReportDialog({ eventId, title: "Something went wrong", subtitle: "Rob has been notified.",
    subtitle2: "If you can, tell us what you were doing.", labelSubmit: "Send",
    onError: (dialogError) => Sentry.captureException(dialogError) });
}, [error]);
```
The error boundary is the documented place for this [C17]; it stays a Client Component with its own `<html>`/`<body>` [C38].

---

## 10. Manual checklist (sentry.io and Vercel; no code)

1. Connect GitHub + Seer for `RobertdWray/jowray_com` [C39].
2. Alerts: keep the default issue alert; add "User Feedback received" and "Replay with error" notifications to Rob.
3. Security & Privacy: leave "Prevent Storing of IP Addresses" **off** [C18]; keep default scrubbers. Do **not** rely on Advanced Data Scrubbing for replays: its sources cover events, logs and attachments, not replay recordings [C49].
4. Quotas: 100 % replay/traces is fine for a family alpha; glance at usage after week one.
5. Vercel: nothing to add (`SENTRY_AUTH_TOKEN` Production + Preview; `NEXT_PUBLIC_SENTRY_DSN` all three; system env exposed, bundle shows `environment:"production"`).

## 11. Verification and evidence

Record each item in the ledger as **configured** (code), **emitted** (seen leaving the browser/server), **received** (visible in Sentry), **usable** (readable, linked, attributed).

### 11.1 PR 1 gate
- `npm run validate && npm run test:run && npm run build:offline` green; build log contains the tunnel handler line [C31].
- Preview (protected): `curl -X POST https://<preview>/api/upload -H 'content-type: application/json' --data 'not json' -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET"` → Issue appears (`captureRequestError`), its request headers show the bypass header as `[Filtered]`.
- Browser on the same preview: DevTools → Network → `POST /sentry-tunnel` → request body (plain JSON envelope for errors) contains no `/m/`, `claimToken` or `ticket` strings after submitting a test memory. **This is the browser envelope check** (manual; automated version is §15 F2).

### 11.2 PR 2 gate
- Preview: submit a memory as `robwray@gmail.com` (the only `OUTBOUND_ALLOWLIST` address; §12). Issues → user shows the email; Traces → browser pageload linked to `createSubmission` server span with `server_action_input` context showing `"claimTokens": "[Filtered]"` where applicable; Logs → Pino lines carry `user.email`; Metrics → `memory.created`.
- Cron: cannot be verified on a preview (production-only by design); verify after merge: Crons shows `reconcile-uploads` with `ok` check-ins every 10 min; force one `error` by leaving a `FAILED`-prone row? **No** — do not fabricate data in production; the unit tests cover the status mapping, production confirms `ok` cadence.

### 11.3 PR 3 gate
- Preview: Replays shows the `/share` session unmasked (text, inputs, photo thumbnails) and the thank-you links readable; opening a claim link produces a replay of `/m/*` with the photo visible; the replay's `urls` list shows `/m/[claimToken]` and its network tab shows `"claimToken":"[Filtered]"` in the `completeSubmission` body; feedback button pre-fills email, a screenshot attaches, submission appears under User Feedback with the replay attached; `curl -I https://<preview>/share | grep -i document-policy` → `js-profiling`; Profiles shows a Chrome session; an Issue's breadcrumb names the React component (annotation); a stack frame inside Next internals resolves (widened upload).

### 11.4 Production smoke (after PR 3 merge)
- Load `/` and `/share`, submit nothing; Replays shows one production session; Crons shows `ok` within 10 minutes; `npm run build` log on Vercel shows the tunnel line and `Successfully uploaded source maps`.

## 12. Safe test fixtures

- Contributor email for previews and production smoke: `robwray@gmail.com` (in `OUTBOUND_ALLOWLIST`; previews have `OUTBOUND_ENABLED=false`). Name: `Sentry Test`. Note: `logger.ts` pins `OUTBOUND_ALLOWLIST` matching as exact lower-case, so plus-addressing does not pass.
- Preview data lives on the PR's own Neon branch (`preview/<branch>`), deleted by `.github/workflows/neon-cleanup.yml` on PR close; Blob objects use the preview `storagePrefix()`, cleaned by cron step (f). No manual cleanup.
- Monitors: created only from production (§8.8). If a stray monitor ever appears, delete it in Sentry → Crons.
- Synthetic tokens in tests start with `SENTRYTEST_` so a leak is greppable.

## 13. Rollback and ending the alpha

- **Disable expanded collection in one commit:** restore `lib/sentry/data-collection.ts` to the Phase 1 values (all `false`/`[]`), set `replaysSessionSampleRate: 0.1`, `replaysOnErrorSampleRate: 1.0`, remove `maskAllText/maskAllInputs/blockAllMedia: false`, `tracesSampleRate: 0.2`. Nothing else needs to change; the scrubbers and identity stay correct at any rate.
- **Instant stop without a deploy:** Sentry → Project Settings → Client Keys → disable the DSN (all SDKs go silent) or set a Replay/Transaction quota of 0 in Stats → Spike Protection.
- **Previous deployment:** Vercel → Deployments → Promote the last good production deployment.
- **Observed secret leak:** (1) delete the affected events/replays in Sentry; (2) rotate the affected claim token (`confirmMemory` without `claimToken` rotates; or soft-delete the memory); (3) add the pattern to `scrub.ts` with a test; (4) note it in the ledger.
- Rob decides when the alpha settings end; the revert list above is the whole job. The §2a comments stay in the code with an "Ended on <date>" line.

## 14. Non-goals and rejected suggestions (so reviewers do not re-raise them)

| Item | Why not |
|---|---|
| Node (server) profiling | No prebuilt `@sentry/profiling-node` binary for Node 26 [C26]; Rob chose not to pin Vercel to 24 (2026-11-04). Revisit when binaries ship (§15 F3). |
| `_experimental.vercelCronsMonitoring` | Experimental API [C29]; explicit check-ins give correct error semantics (§8.8). |
| Content-Security-Policy | None exists on pages; adding one is a separate security task. If added, it needs `worker-src 'self' blob:` for replay [C12] and `connect-src 'self'` for the tunnel. |
| Lazy-loading Replay/Feedback | Bundle size is not a concern for a family alpha; synchronous init is simpler and what the Next.js convention wants [C36]. |
| `replayCanvasIntegration` | The app has no `<canvas>` (verified by grep). |
| Turning replay off on `/m/<token>` pages | Rob chose to record them (2026-11-04) knowing rrweb's meta event stores `window.location.href` and nothing scrubs it [C47][C49]. Token-free claim URLs (§15 F1) would remove the residual without losing replays. |
| Disabling feedback screenshots | Rob chose to keep them (2026-11-04) knowing a thank-you-page screenshot can contain private links [C50]. |
| `data-sentry-block` / `data-sentry-mask` on the thank-you links and claim media cards | With the two residuals above accepted, blocking hides the UI under test and protects nothing the recording does not already carry [C47]. The attributes are the documented mechanism if the ruling is reversed (§9.2). |
| Server-side Advanced Data Scrubbing as the token defence | Its sources are event fields, logs and attachments; replay recordings are not listed [C49]. Client-side scrubbing stays authoritative [C21]. |
| Automated browser envelope test (jsdom + replay worker) | rrweb and the compression worker do not run under jsdom reliably; the manual tunnel inspection (§11.1) plus the server envelope test (§7.4) cover the risk. Follow-up §15 F2. |
| `tracesSampler` per route | 100 % is the goal; nothing to sample out. |
| Sentry agent plugin, Vercel Drains, Vercel Marketplace integration | Not needed; SDK-native features cover everything requested. |
| `app/error.tsx` segment boundaries | Separate UX work (§15 F4). |
| Emailing claim links from the admin alert | Unrelated; checked only to understand who already holds tokens. |

## 15. Follow-ups (file as issues after merge; not in these PRs)

| Id | Severity | What a pick-up agent needs to know |
|---|---|---|
| F1 | Low | **Token-free claim URLs** would remove the one accepted residual (the token inside `/m/*` replay recordings) and the `Referrer-Policy` dance: `/m/<token>` sets an `HttpOnly` cookie scoped to `/m` and 302s to `/m/edit`; media routes read the cookie instead of `?t=`. Touches `app/m/[claimToken]/page.tsx`, `app/api/media/[id]/route.ts`, `lib/claim-token.ts`, emails. Only worth doing if the alpha outgrows "family only". |
| F2 | Low | Automated browser-side envelope test: Playwright against `next dev` with the tunnel route intercepted, asserting no `SENTRYTEST_` string leaves. Replaces the manual §11.1 check. |
| F3 | Low | Node profiling: when `@sentry/profiling-node` ships Node 26 binaries (or Vercel is pinned to 24), add `nodeProfilingIntegration()` + `profileSessionSampleRate: 1.0`, `profileLifecycle: "trace"` to `instrumentation.ts` [C26]. |
| F4 | Low | Per-segment `app/share/error.tsx` and `app/m/[claimToken]/error.tsx` so a render error does not replace the whole layout; each would call `reportClientError` and offer `retry()`. ESLint already has the `app/**/error.tsx` pattern. |
| F5 | Low | Cron partial-failure alerting: today an `error` check-in needs two consecutive failures (`failureIssueThreshold: 2`); consider a metric alert on `reconcile.run{errors>0}` for one-off failures. |
| F6 | Info | Presigned Blob redirect URLs appear in replay network breadcrumbs (60 s lifetime). Acceptable now; revisit with F1. |

## 16. Resume ledger (update in `docs/plans/2026-11-04-sentry-full-telemetry.md`; one row per state change)

| When (UTC) | PR / branch / head SHA | Astra run dir / tasks | State | Checks | Open findings | External changes made | Next action |
|---|---|---|---|---|---|---|---|
| 2026-11-04 | — | — | Plan v2 written; Rob confirmed replay on `/m/*` and screenshots on (§2); Astra split added (§6a–§6b); awaiting plan approval | — | — | none | `git fetch origin`; `/astra-work` `init` from `origin/main` 3f437eb; `npm ci` in the integration worktree; prepare `p1-scrub` + `p1-tunnel-docs` (§6a); TCR premortem on the committed plan (§6b.1) |
| 2026-11-04 16:40 | PR 1 `feat/sentry-1-foundation` (worktree `../jowray_wt_sentry`, base `6210009`) | none: Rob asked for the plan to be executed inline in one worktree (ruling R1, below) | PR 1 code complete: `lib/sentry/secrets.ts`, scrubber v2, policy flip with the §2a header, tunnel handler, logger import, envelope test, docs | `validate` green; `test:run` 914/914 (48 files); `build:offline` green; `CI=1 npm run build:offline` prints `[@sentry/nextjs] The tunnel route sends events through app/sentry-tunnel/route.ts.` (the plain run is `silent`) | §4 rerun on `6210009`: same 12 Server Functions; new `app/api/admin/memories/**` POST routes (bearer `ADMIN_API_SECRET`; `authorization` already on `SECRET_HEADER_KEYS`) and `features/memories/draft-memory.ts` — PR 2 tags them. Open PR #31 (`feat/admin-page`) also edits `scrub.ts` (`key=` fragment in `scrubUrl`), its test, `next.config.ts` and the cron route; PR 1 is additive, the merge is a comment/regex union. PR #31's `enterAdmin` Server Function takes the admin entry key as its argument: PR 2 must keep that input out of `server_action_input` (add `key` to the exact-match field keys, not the fragments). | none | open PR 1 as draft; §11.1 preview gate (needs the network); Team Code Review; then PR 2 from the merged base |
| 2026-11-04 17:05 | PR 2 `feat/sentry-2-identity` (stacked on PR 1 `f6a3295`) | none (inline, R1) | PR 2 code complete: `lib/sentry/user.ts` (`identifyContributor`, `clearContributor`, `tagIds`), `server-action.ts`, `report.ts`, `metrics.ts`, `after-flush.ts` (name + task span), both `actions.ts` wrapped, identity/tags/metrics in the six features and the Blob callback, cron check-ins + per-item isolation scopes + run metric, traces 1.0 + `normalizeDepth: 6` + console logs (client) + Pino `fatal` issues (server), `onError` pipeline hook, `reportClientError` in every listed browser catch, `key` on the secret field keys | `validate` green; `test:run` 966/966 (53 files); `build:offline` (see the PR) | none | none | open PR 2 as draft on top of PR 1; §11.2 preview gate (needs the network); Team Code Review; then PR 3 |
| 2026-11-04 17:20 | PR 3 `feat/sentry-3-replay` (stacked on PR 2 `e6655ce`) | none (inline, R1) | PR 3 code complete: `instrumentation-client.ts` final shape (replay 100 % unmasked with network bodies + `scrubRecordingEvent`, feedback widget, browser profiling, third-party filter in tag mode, console logs, `scrubReplayEvent` processor, §2a header), `next.config.ts` (`Document-Policy` header, `widenClientFileUpload`, `reactComponentAnnotation`, `applicationKey`), `#sentry-feedback` CSS, crash-report dialog in `global-error.tsx`, `__tests__/next-config.test.ts`, docs (code-layout + AGENTS mirror, environment.md) | `validate` green; `test:run` (see the PR); `CI=1 build:offline` (see the PR) | none | none | open PR 3 as draft on top of PR 2; §11.3 preview gate and §10 manual checklist (need the network and the Sentry UI); Team Code Review; after merge §11.4 |

Rulings made while executing (R-numbers continue in later rows):
- **R1** Execute inline (one agent, TDD per step, final whole-branch review) instead of §6a Astra workers: Rob's instruction was "execute this plan in a new worktree"; the Astra skill activates only on an explicit request. Cost if wrong: no per-task fresh reviewer; mitigated by Team Code Review on each PR.
- **R2** `docs/code-layout.md` contained no Sentry wording to replace (the Phase 1 "Replay off" text lives in the frozen 2026-11-02 plan and `phase1-ledger.md`), so a new "Sentry (alpha data policy)" section was added to it and to the AGENTS.md mirror; the frozen records are untouched.
- **R3** The envelope test's frame-locals case is covered by the `scrubEvent` unit test (`frames[*].vars`); the SDK's `LocalVariablesAsync` integration only attaches locals through the inspector for uncaught exceptions, so the envelope test cannot exercise that surface offline. The `stackFrameVariables` deny list is the SDK-side guard.
- **R4** `normalizeDepth: 6` on both inits (and the envelope test): the SDK default of 3 turns Server Function inputs/results (cards → files) into `"[Object]"`, which defeats the point of recording them. Cost if wrong: larger events.
- **R5** The SDK's `withServerActionInstrumentation` forks the isolation scope, so `extra.server_action_result` is visible only to events captured inside the action (and its `after()` work), never to a later capture. The envelope test proves the scrubbed `server_action_input` context and the `serverAction/<name>` transaction from inside the action; result scrubbing is pinned by the `scrubEvent` unit test (`extra`). Cost if wrong: none at runtime.
- **R6** `completeSubmission` never loads the contributor (it selects ids only); `confirmSubmission` does (`loadSubmission`), so identity is set there, which also covers the cron path inside its isolation scope. `completeSubmission` tags `submission_id` and `memory_id` (the anchor). The `confirmation.sent` metric is recorded once per `confirmSubmission` call with `sent` or the skip reason. Cost if wrong: an identity set one call later than the plan's wording.
- **R7** Ids go through `tagIds()` in `lib/sentry/user.ts` rather than direct `Sentry.setTag` calls, so features import one Sentry helper module and tests mock one module. Pipeline `onError` steps are `create` / `upload` / `file` / `complete` (`cancel` belongs to the claim page's media list, which reports it directly). Six test files mock `afterWithFlush`, not the four the plan counted (`confirm.test.ts`, `create-memory.test.ts` too). Cost if wrong: naming only.
- **R8** `key` added to `SECRET_FIELD_KEYS` (exact match only, so `storageKey` is untouched): PR #31's `enterAdmin` takes the admin entry key as its Server Function argument and PR 2 records inputs. Cost if wrong: one over-filtered field named `key`.

Resume rule: the Astra run directory under `~/.local/state/astra-work/` is the recovery key; on resume use `/astra-work resume <run-directory>` and read its recorded state before any action.

Evidence manifest fields to fill per PR: commit SHA, preview URL, test command output (pass counts), browser + device, tunnel request body hash (sanitised), Sentry event id / replay id / trace id, and the configured → emitted → received → usable status per feature.

## 17. External review disposition (2026-11-04)

Every claim was checked against `origin/main` 3f437eb and the installed SDK before sorting; all six findings and both corrections were accurate.

- **Must do (done in this v2):** refreshed operation map on 3f437eb (§4); the replay DOM/meta-URL and screenshot residuals surfaced to Rob, who ruled to accept both (§2, §5, §9.2); `claimTokens[]`, key-fragment matching, secret-surface matrix, envelope test gate (§5, §7.3–7.4); PR reorder with stacked prerequisites and per-PR gates (§6); cron check-in semantics with error on partial failure and production-only (§8.8); identity contract and `withIsolationScope` in the cron (§2, §8.1–8.2); `outgoingResponse` (§7.5); `after-flush` keeps its catch/finally (§8.9); cold start, durable copy, decision provenance, PR contract, fixtures, ledger, rollback (§0, §2, §6, §12, §13, §16).
- **Nice to do (done):** evidence manifest with configured/emitted/received/usable (§11, §16); review loop made runnable (§0.6).
- **Don't do:** automated browser-envelope harness in this work (§14, reason given); any pull of the dirty primary checkout (§0.1).
- **Out of scope, kept as follow-ups:** F1–F6 (§15).

---

## Citations

### [C1] — Client init file and public DSN
- **Relevant File(s):** `instrumentation-client.ts`
- **Change Summary:** All browser-side changes land in this one file, which reads the public DSN env var.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#initialize-sentry-sdks
- **Verbatim Quote:**
  > "Create the following files in your application's root directory (or `src` folder if you have one): - `instrumentation-client.ts` - Client-side SDK initialization … Include your DSN directly in these files, or use a _public_ environment variable like `NEXT_PUBLIC_SENTRY_DSN`."
- **Justification:** Confirms the file and the env var the repo already uses are the current convention.

### [C2] — Server init inside `register()` and `onRequestError`
- **Relevant File(s):** `instrumentation.ts`
- **Change Summary:** Server options change inside the existing `register()` init; `onRequestError` stays.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#register-server-side-sdk
- **Verbatim Quote:**
  > "This file imports your server and edge configurations and exports `onRequestError` to capture server-side errors. The `onRequestError` hook requires `@sentry/nextjs` version `8.28.0` or higher and Next.js 15."
- **Justification:** The hook and placement are the documented mechanism, so PR 2 only edits options.

### [C3] — Wrap Server Actions
- **Relevant File(s):** `lib/sentry/server-action.ts`, `app/share/actions.ts`, `app/m/[claimToken]/actions.ts`
- **Change Summary:** Every Server Function is wrapped with `withServerActionInstrumentation`, passing `headers` and `recordResponse`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#server-actions
- **Verbatim Quote:**
  > "Wrap your Server Actions with `Sentry.withServerActionInstrumentation()`."
  > "headers: await headers(), // Connect client and server traces formData, // Attach form data to events recordResponse: true, // Include response data"
- **Justification:** Maps to `instrumentedAction`'s options; `formData` is omitted because inputs are JSON objects, which go into a scrubbed context.

### [C4] — Server Actions are not auto-instrumented
- **Relevant File(s):** `app/share/actions.ts`, `app/m/[claimToken]/actions.ts`
- **Change Summary:** Justifies wrapping all twelve Server Functions.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/tracing/#why-manual-instrumentation
- **Verbatim Quote:**
  > "Server Actions are **not** automatically instrumented. Without wrapping, they appear as anonymous server operations with no timing or context."
- **Justification:** Without the wrapper the most bug-prone paths would be anonymous in traces.

### [C5] — `tracesSampleRate`
- **Relevant File(s):** `instrumentation-client.ts`, `instrumentation.ts`
- **Change Summary:** Raise from 0.1 to 1.0 in both runtimes.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#tracesSampleRate and https://docs.sentry.io/platforms/javascript/guides/nextjs/tracing/#configure-sample-rate
- **Verbatim Quote:**
  > "A number between `0` and `1`, controlling the percentage chance a given trace will be sent to Sentry. (`0` represents 0% while `1` represents 100%.) Applies equally to all traces started in the app."
  > "Add `tracesSampleRate` to your Sentry configuration in all three runtime files. **Start with 100% in development, and 10-20% in production.** Adjust based on traffic volume and budget."
- **Justification:** `1.0` is 100 %; the production guideline is a budget concern that does not apply to a family alpha.

### [C6] — 100 % replay sampling
- **Relevant File(s):** `instrumentation-client.ts`
- **Change Summary:** `replaysSessionSampleRate: 1.0`, `replaysOnErrorSampleRate: 1.0` (0 on `/m/*`).
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/session-replay/#verify
- **Verbatim Quote:**
  > "While you're testing, we recommend that you set `replaysSessionSampleRate` to `1.0`. This ensures that every user session will be sent to Sentry. Once testing is complete, **we recommend lowering this value in production**. We still recommend keeping `replaysOnErrorSampleRate` set to `1.0`."
- **Justification:** The alpha is a testing period; Rob asked for 100 %. §13 holds the lower-later values.

### [C7] — Replay is client-only
- **Relevant File(s):** `instrumentation-client.ts`, `instrumentation.ts`
- **Change Summary:** Replay options only in the client init.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/session-replay/#set-up
- **Verbatim Quote:**
  > "Session Replay only runs in the browser, so you only need to configure it in `instrumentation-client.ts`. The server (`sentry.server.config.ts`) and edge (`sentry.edge.config.ts`) entry points run in Node.js and Edge runtimes where Replay is not available."
- **Justification:** Prevents an invalid replay option on the server init.

### [C8] — Unmasking text, inputs and media
- **Relevant File(s):** `instrumentation-client.ts`
- **Change Summary:** `maskAllText: false`, `maskAllInputs: false`, `blockAllMedia: false`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/session-replay/privacy/#privacy-configuration
- **Verbatim Quote:**
  > "If you're working on a static website that's free of personal identifiable or other type of private data, you can opt out of the default text masking and image blocking by configuring the `maskAllText` and `blockAllMedia` configuration options respectively"
  > "| maskAllInputs | `boolean` | `true` | Mask values of `<input>` elements. Passes input values through `maskFn` before sending to server. |"
- **Justification:** The three documented switches; the "no sensitive data" precondition is met by consent plus the token defences in §5.

### [C9] — Network bodies are opt-in via allow-list
- **Relevant File(s):** `instrumentation-client.ts`
- **Change Summary:** `networkDetailAllowUrls: [window.location.origin]`, `networkCaptureBodies: true`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/session-replay/configuration/#network-details
- **Verbatim Quote:**
  > "To capture additional information such as request and response headers or bodies, you'll need to opt-in via `networkDetailAllowUrls` (requires SDK version >= 7.50.0). This will make it possible for you to elect to only add URLs that are safe for capturing bodies and avoid any endpoints that may contain Personal Identifiable Information, (PII)."
  > "replayIntegration({ networkDetailAllowUrls: [window.location.origin], });"
- **Justification:** Same-origin only, so Vercel Blob uploads are not captured; bodies are then scrubbed by [C10].

### [C10] — Scrub recording events (custom events only)
- **Relevant File(s):** `lib/sentry/scrub.ts` (`scrubRecordingEvent`), `instrumentation-client.ts`
- **Change Summary:** `beforeAddRecordingEvent` filters tokens out of network bodies, URLs and console args.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/session-replay/privacy/#custom-scrubbing
- **Verbatim Quote:**
  > "The `beforeAddRecordingEvent` has been added starting with SDK version 7.53.0. It allows you to modify, scrub the recordings to remove PII, or ignore recording events before they leave the browser. These events include console logs, network requests, and response data."
- **Justification:** The hook sees only these custom events (confirmed in `@sentry/replay` source: `maybeApplyCallback` runs the callback only when `isCustomEvent(event)`), which is why DOM protection needs [C47] and the `/m/*` exclusion.

### [C11] — Scrub URLs in replay events
- **Relevant File(s):** `lib/sentry/scrub.ts` (`scrubReplayEvent`), `instrumentation-client.ts`
- **Change Summary:** Event processor that maps `event.urls` through `scrubUrl` for `replay_event`s.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/session-replay/privacy/#example-scrubbing-urls
- **Verbatim Quote:**
  > "To scrub the URL in a replay event, use `addEventProcessor`: … if (event.type !== \"replay_event\") { // Return the event, otherwise the event will be dropped return event; } … event.urls = event.urls && event.urls.map(urlScrubber);"
- **Justification:** `beforeSend` does not see replay events; this processor keeps `/m/<token>` out of the replay metadata.

### [C12] — Replay worker and CSP
- **Relevant File(s):** `docs/code-layout.md` (note only)
- **Change Summary:** Records what a future CSP must allow.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/session-replay/#content-security-policy-csp
- **Verbatim Quote:**
  > "Session Replay uses a WebWorker for compression off the main UI thread. Add these CSP entries to allow workers to load. … worker-src 'self' blob: child-src 'self' blob:"
- **Justification:** No CSP exists on pages today; §14 explains why none is added here.

### [C13] — Feedback widget auto-injects bottom-right
- **Relevant File(s):** `instrumentation-client.ts`
- **Change Summary:** `feedbackIntegration({...})` with default `autoInject`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/user-feedback/#set-up
- **Verbatim Quote:**
  > "By default, this will insert the widget into the bottom right corner of your website. You're free to customize nearly every aspect of the widget, including replacing it completely with your own UI."
- **Justification:** No custom button code is needed (Rob's choice).

### [C14] — Feedback links to Replay when `replaysOnErrorSampleRate > 0`
- **Relevant File(s):** `instrumentation-client.ts`
- **Change Summary:** Keep `replaysOnErrorSampleRate: 1.0` so feedback carries a replay.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/user-feedback/#session-replay
- **Verbatim Quote:**
  > "First, make sure that the Session Replay integration is configured correctly and that `replaysOnErrorSampleRate` is greater than 0. When this is done, the Replay SDK will buffer up to 30 seconds of the user's session until the user _opens_ the User Feedback widget. If the user submits feedback, you'll be able to view the feedback (including the replay), in sentry.io."
- **Justification:** Ties replay and feedback together.

### [C15] — Feedback pre-fills name/email from `setUser`
- **Relevant File(s):** `lib/sentry/user.ts`, `app/share/share-form.tsx`, `app/m/[claimToken]/claim-form.tsx`, `instrumentation-client.ts`
- **Change Summary:** Identify the contributor in the browser so the form is pre-filled; default `useSentryUser` mapping.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/user-feedback/configuration/#user-context
- **Verbatim Quote:**
  > "If you've set a user context by calling `Sentry.setUser()`, those values will be used as defaults for the `name` and `email` fields. If those fields are hidden from the user, the default values will still be sent along with the feedback message."
  > "| `useSentryUser` | `Record<string, string>` | `{ email: 'email', name: 'username'}` | Sets the `email` and `name` fields to the corresponding Sentry SDK user fields that were called with `Sentry.setUser`. |"
- **Justification:** `identifyContributor` sets `email` and `username`, matching the default mapping.

### [C16] — Widget text and CSS variables
- **Relevant File(s):** `instrumentation-client.ts`, `app/globals.css`
- **Change Summary:** Label overrides and a `#sentry-feedback` CSS block.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/user-feedback/configuration/#text-customization and https://docs.sentry.io/platforms/javascript/guides/nextjs/user-feedback/configuration/#css-customization
- **Verbatim Quote:**
  > "| `triggerLabel` | `\"Report a Bug\"` | The label of the injected button that opens up the feedback form when clicked. |"
  > "In all cases, you can set CSS variables to override any value. By default, the `<div>` container has the attribute `id=\"sentry-feedback\"`, so you can use the `#sentry-feedback` selector to define CSS variables to override defaults."
- **Justification:** Renames the button and themes it from `globals.css` without React code.

### [C17] — Crash-report dialog belongs in the error component
- **Relevant File(s):** `app/global-error.tsx`
- **Change Summary:** `Sentry.showReportDialog({ eventId })` after `captureException`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/user-feedback/#crash-report-modal
- **Verbatim Quote:**
  > "To collect feedback, the Crash-Report modal requests and collects the user's name, email address, and a description of what occurred. When feedback is provided, Sentry pairs the feedback with the original event, giving you additional insights into issues."
  > "If you're using a framework like React or Angular, the best place to collect user feedback is in your error-handling component."
- **Justification:** The global error boundary is that component.

### [C18] — `setUser` semantics and request scope
- **Relevant File(s):** `lib/sentry/user.ts`, `features/memories/create-submission.ts`, `features/memories/claim.ts`, `features/memories/complete-submission.ts`
- **Change Summary:** `identifyContributor` wraps `Sentry.setUser`; server call sites set it per request.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/apis/#setUser
- **Verbatim Quote:**
  > "Set a user to be sent with Sentry events. Set to `null` to unset the user. In addition to the specified properties of the `User` object, you can also add additional arbitrary key/value pairs."
  > "`Sentry.setUser()` will set the user for the currently active request - see Request Isolation for more information."
  > "To ensure your users' IP addresses are never stored in your event data, you can go to your project settings, click on \"Security & Privacy\", and enable \"Prevent Storing of IP Addresses\""
- **Justification:** Per-request isolation makes per-Server-Function identity safe; the cron needs [C55] because one request handles many items.

### [C19] — `dataCollection` keys and `CollectBehavior` deny lists
- **Relevant File(s):** `lib/sentry/data-collection.ts`
- **Change Summary:** Turn on user info, query params, DB query data, bodies (`incomingRequest`, `outgoingResponse`), headers and stack variables with `{ deny: [...] }`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
- **Verbatim Quote:**
  > "| `userInfo` | `boolean` | `true` | Populate `user.*` fields (`id`, `email`, `username`, `ip_address`) from instrumentation. For example, the SDK infers the IP address from an incoming HTTP request. Data you set with `Sentry.setUser()` is always sent. |"
  > "| `httpHeaders` | `CollectBehavior | { request?, response? }` | both `true` | Collect HTTP request and response headers. Pass one `CollectBehavior` for both directions, or use `{ request, response }` to control each direction. Header names are always included. |"
  > "| `httpBodies` | `HttpBodyCollectionTarget[]` | all types | Body types to collect: `\"incomingRequest\"`, `\"outgoingRequest\"`, `\"incomingResponse\"`, `\"outgoingResponse\"`. Set to `[]` to disable. |"
  > "| `databaseQueryData` | `boolean` | `true` | Collect the data associated with database queries: bound query parameters, data payloads for write operations, and returned result data. |"
  > "| `stackFrameVariables` | `CollectBehavior` | `true` | Capture local variable values in stack frames. Allow/deny lists match variable names. |"
  > "type CollectBehavior = boolean | { allow: string[] } | { deny: string[] }; // true → collect all (sensitive denylist still scrubs values) // false → collect nothing // { deny: [] } → collect all, extending the denylist with the given terms"
- **Justification:** Each key maps to a documented row; the installed SDK's `withServerActionInstrumentation` checks `httpBodies.includes("outgoingResponse")` before recording a response.

### [C20] — Built-in sensitive denylist (partial key match)
- **Relevant File(s):** `lib/sentry/secrets.ts`, `lib/sentry/data-collection.ts`
- **Change Summary:** Rely on the SDK for `token`/`auth`-named keys; name the rest explicitly.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
- **Verbatim Quote:**
  > "By default the SDK collects rich debugging context (including user identity, request/response bodies, and generative AI content) and scrubs values whose keys match the built-in sensitive denylist (`auth`, `token`, `password`, and similar)."
  > "The SDK matches denylist terms against key names. The match is partial"
- **Justification:** `claimToken(s)` and `authorization` are caught by the SDK; `ticket`, `clientPayload`, `sig`, `claimLink`, `x-vercel-*` need the repo lists.

### [C21] — `beforeSend*` hooks are the place to scrub
- **Relevant File(s):** `lib/sentry/scrub.ts`, `instrumentation.ts`, `instrumentation-client.ts`
- **Change Summary:** Scrubber v2 runs in every `before*` hook.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/data-management/sensitive-data/#scrubbing-in-beforesend-sdk-hooks
- **Verbatim Quote:**
  > "SDKs provide various `beforeSend*` hooks, which are invoked before errors, messages, spans, logs, or metrics are sent and can be used to modify event data to remove sensitive information."
  > "We recommend using these hooks in the SDKs to **scrub any data before it is sent**, to ensure that sensitive data never leaves the local environment."
- **Justification:** Client-side scrubbing keeps tokens out of Sentry entirely.

### [C22] — Logs carry `user.email`; console integration
- **Relevant File(s):** `instrumentation-client.ts`, `lib/logger/logger.ts` (redaction unchanged)
- **Change Summary:** `consoleLoggingIntegration({ levels: ["warn", "error"] })`; rely on automatic `user.*` log attributes.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/logs/#default-attributes and https://docs.sentry.io/platforms/javascript/guides/nextjs/logs/#console
- **Verbatim Quote:**
  > "// User (if set via Sentry.setUser) \"user.id\": \"user_456\", \"user.email\": \"jane@example.com\", \"user.name\": \"Jane\","
  > "Capture `console.log`, `console.warn`, and `console.error` calls as structured logs. … Sentry.consoleLoggingIntegration({ levels: [\"log\", \"warn\", \"error\"], }),"
- **Justification:** "Apply bug logs to user names" is satisfied by `setUser` without changing Pino's redaction; ESLint allows only `warn`/`error`.

### [C23] — Pino integration options and supported versions
- **Relevant File(s):** `instrumentation.ts`
- **Change Summary:** `pinoIntegration({ error: { levels: ["fatal"] } })`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/integrations/pino/#options
- **Verbatim Quote:**
  > "Levels that trigger capturing of events. When a pino log message is logged at one of these levels, it will be captured as a Sentry error event."
  > "- `pino`: `>=8.0.0 <11`"
- **Justification:** Pino 10.4.0 is in range; `fatal` becomes an issue while all levels keep flowing as logs.

### [C24] — Metrics need no setup; user attributes attach automatically
- **Relevant File(s):** `lib/sentry/metrics.ts` and its callers (§4)
- **Change Summary:** Add counters and a distribution through a thin wrapper.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/metrics/#metric-types and https://docs.sentry.io/platforms/javascript/guides/nextjs/metrics/#default-attributes
- **Verbatim Quote:**
  > "No setup required beyond SDK initialization. Metrics are captured whenever you call `Sentry.metrics.*`."
  > "| `user.id`, `user.name`, `user.email` | User identifiers | If user set |"
- **Justification:** No init option; metrics are attributable to the identified contributor.

### [C25] — Browser profiling: header, integration, trace mode
- **Relevant File(s):** `next.config.ts` (`headers()`), `instrumentation-client.ts`
- **Change Summary:** `Document-Policy: js-profiling` on every response; `browserProfilingIntegration()`, `profileSessionSampleRate: 1.0`, `profileLifecycle: "trace"`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/profiling/browser/#2-add-the-document-policy-header and https://docs.sentry.io/platforms/javascript/guides/nextjs/profiling/browser/#trace-mode
- **Verbatim Quote:**
  > "Your server must return `Document-Policy: js-profiling` in response headers. In Next.js you can configure document response headers via the `headers` option in `next.config.js`"
  > "Profiles automatically attach to spans. Enable by setting `profileLifecycle: \"trace\"`: … tracesSampleRate: 1.0, profileSessionSampleRate: 1.0, profileLifecycle: \"trace\","
  > "Browser Profiling uses the JS Self-Profiling API, currently only available in Chromium-based browsers (Chrome, Edge). Profiles will only include data from these browsers."
- **Justification:** Exact options and the one header added; Safari testers produce no profiles.

### [C26] — Node profiling binaries stop at Node 24 (deferred)
- **Relevant File(s):** none (§14, §15 F3)
- **Change Summary:** Server profiling out of scope while Vercel runs Node 26.x.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/profiling/node/#precompiled-binaries
- **Verbatim Quote:**
  > "Currently, we ship prebuilt binaries for the following architectures and Node versions: - macOS x64: Node v18, v20, v22, v24 - Linux ARM64 (musl): Node v18, v20, v22, v24 - Linux x64 (glibc): Node v18, v20, v22, v24 - Windows x64: Node v18, v20, v22, v24"
- **Justification:** No Node 26 binary; Rob chose to skip rather than pin Node 24.

### [C27] — `profileLifecycle`
- **Relevant File(s):** `instrumentation-client.ts`
- **Change Summary:** `profileLifecycle: "trace"` with `profileSessionSampleRate: 1.0`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#profileLifecycle
- **Verbatim Quote:**
  > "`'trace'`: Profiling starts and stops automatically with root spans, as long as tracing is enabled. The profiler runs while there is at least one active, sampled root span, up to a maximum of 5 minutes per root span. In this mode, profiling is affected by both `profileSessionSampleRate` and your tracing sample rate (`tracesSampleRate` or `tracesSampler`)."
- **Justification:** With traces and sessions at 1.0, every page load and interaction is profiled.

### [C28] — Monitor semantics (missed, failed, overrun)
- **Relevant File(s):** `app/api/cron/reconcile-uploads/route.ts`
- **Change Summary:** Monitor config (`schedule`, `checkinMargin`, `maxRuntime`, thresholds) passed with the first check-in.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/crons/#job-monitoring
- **Verbatim Quote:**
  > "Use the `Sentry.withMonitor()` API to monitor a callback and notify you if your periodic task is missed (or doesn't start when expected), if it fails due to a problem in the runtime (such as an error), or if it fails by exceeding its maximum runtime."
  > "Pass a monitor configuration as the third argument so Sentry creates or updates the monitor from your code"
  > "Cron monitoring is only supported in Server and Edge runtimes for Next.js"
- **Justification:** The route runs on the Node runtime; the monitor is created from code. `withMonitor` itself is not used because it reports `ok` on any resolved promise (verified in `@sentry/core/build/esm/monitor.js`); [C52] gives the explicit API.

### [C29] — Experimental Vercel cron flag (rejected)
- **Relevant File(s):** `next.config.ts` (not added)
- **Change Summary:** Why `_experimental.vercelCronsMonitoring` is not set.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/build/#_experimental.vercelCronsMonitoring
- **Verbatim Quote:**
  > "These options are experimental. Their API may change in future releases."
  > "If you enable both, the SDK uses this one and warns that the other is redundant."
- **Justification:** Ruling 4.

### [C30] — Rewrite-mode tunnel breaks behind Deployment Protection
- **Relevant File(s):** `next.config.ts`, `app/sentry-tunnel/route.ts`
- **Change Summary:** Switch to handler mode in PR 1.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/build/#tunnelRoute
- **Verbatim Quote:**
  > "Starting with versions `10.77.1` (v10) and `11.9.0` (v11), the browser sends tunnel requests in rewrite mode with `credentials: \"omit\"`. If a layer in front of your app requires credentials (for example, Vercel Deployment Protection or HTTP Basic authentication), it rejects these requests. Use handler mode in this case."
- **Justification:** The repo is on 11.10.0 and previews are protected, so preview browser events are dropped today; every later PR's preview verification depends on this fix, hence PR 1.

### [C31] — Handler mode file, build line, limits
- **Relevant File(s):** `app/sentry-tunnel/route.ts`, `next.config.ts`, `docs/code-layout.md`
- **Change Summary:** Add the route file, keep `tunnelRoute`, verify the build message.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/build/#tunnelRoute
- **Verbatim Quote:**
  > "Keep `tunnelRoute` and add this file. If your app uses a `src` directory, add it at `src/app/sentry-tunnel/route.ts`: … export { POST } from \"@sentry/nextjs/tunnel\";"
  > "This works with any `tunnelRoute` value, including `true`. When the SDK finds the file, the build prints this line: [@sentry/nextjs] The tunnel route sends events through app/sentry-tunnel/route.ts. Only the event payload goes to Sentry."
  > "- Handler mode works only with the App Router. - The SDK doesn't find the file in a route group, such as `app/(group)/sentry-tunnel/`. - With `\"moduleResolution\": \"node\"` in `tsconfig.json`, the type check fails with `Cannot find module '@sentry/nextjs/tunnel'`. Set `moduleResolution` to `bundler`, `node16`, or `nodenext`."
- **Justification:** Exact location and the verification string; `tsconfig.json` already uses `bundler`.

### [C32] — `widenClientFileUpload`
- **Relevant File(s):** `next.config.ts`
- **Change Summary:** `widenClientFileUpload: true`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/build/#widenClientFileUpload
- **Verbatim Quote:**
  > "Include Next.js-internal code and code from dependencies when uploading source maps. … To upload all of the files and source maps, including ones from third-party packages, set the `widenClientFileUpload` option to `true`. Note: Enabling this option can lead to longer build times."
- **Justification:** Readable frames inside Next/React internals.

### [C33] — React component annotation
- **Relevant File(s):** `next.config.ts`
- **Change Summary:** `reactComponentAnnotation: { enabled: true }`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/build/#reactComponentAnnotation
- **Verbatim Quote:**
  > "Annotates your React components with `data-sentry-component`, `data-sentry-element`, and `data-sentry-source-file` attributes at build time, so Sentry can identify which component a user interacted with in Session Replay and breadcrumbs. Disabled unless you set a value. Set `enabled: true` to turn it on"
  > "This option drives both Webpack and Turbopack builds. On Turbopack it requires **Next.js 16+**"
- **Justification:** Turbopack on Next 16.4.4.

### [C34] — `applicationKey` and the third-party error filter
- **Relevant File(s):** `next.config.ts`, `instrumentation-client.ts`
- **Change Summary:** `applicationKey: "jowray_com"` + `thirdPartyErrorFilterIntegration` in tag mode.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/build/#applicationKey
- **Verbatim Quote:**
  > "Application key used by `thirdPartyErrorFilterIntegration` to tell your code apart from third-party code, so you can drop errors coming from browser extensions, injected scripts, and third-party widgets. The value must match an entry in the `filterKeys` array of your `thirdPartyErrorFilterIntegration` configuration. This option works for both Webpack and Turbopack builds."
- **Justification:** Family browsers carry extensions; tagging keeps the signal but makes noise filterable.

### [C35] — Next.js `headers()` shape and override rule
- **Relevant File(s):** `next.config.ts`
- **Change Summary:** Add a `/:path*` entry for `Document-Policy` beside the existing `/m/:path*` `Referrer-Policy` entry.
- **Source URL:** https://nextjs.org/docs/app/api-reference/config/next-config-js/headers
- **Verbatim Quote:**
  > "`headers` can be defined as a synchronous or async function. It should return, or resolve to, an array of objects with `source` and `headers` properties"
  > "If two headers match the same path and set the same header key, the last header key will override the first."
- **Justification:** Different keys on overlapping sources coexist.

### [C36] — `instrumentation-client` timing and router hook
- **Relevant File(s):** `instrumentation-client.ts`
- **Change Summary:** Synchronous top-level init; keep `onRouterTransitionStart`.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client
- **Verbatim Quote:**
  > "You can export `onRouterTransitionStart` to observe the start of App Router navigations"
  > "Only synchronous, top-level code is guaranteed to complete before hydration."
  > "Next.js monitors initialization time in development and will log warnings if it takes longer than 16ms, which could impact smooth page loading."
- **Justification:** Integrations are added synchronously; the dev warning is expected; lazy loading is a non-goal (§14).

### [C37] — `instrumentation.ts` `register` runs once per server
- **Relevant File(s):** `instrumentation.ts`
- **Change Summary:** Server options change inside `register()`.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation#register-optional
- **Verbatim Quote:**
  > "The file exports a `register` function that is called **once** when a new Next.js server instance is initiated, and must complete before the server is ready to handle requests."
- **Justification:** Init placement is correct; check-ins and `setUser` in routes run after the SDK is ready.

### [C38] — `global-error` must be a Client Component with its own document
- **Relevant File(s):** `app/global-error.tsx`
- **Change Summary:** Add the report dialog inside the existing effect.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/error#global-error
- **Verbatim Quote:**
  > "Global error UI must define its own `<html>` and `<body>` tags, global styles, fonts, or other dependencies that your error page requires. This file replaces the root layout or template when active."
  > "Error boundaries must be Client Components"
- **Justification:** The dialog is a browser call inside a Client Component effect.

### [C39] — GitHub + Seer (manual checklist)
- **Relevant File(s):** none
- **Change Summary:** §10 item 1.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#next-steps
- **Verbatim Quote:**
  > "Connect GitHub + Seer - Enable AI-powered root cause analysis by connecting your GitHub repository"
- **Justification:** Suspect commits and Seer need the repo link.

### [C40] — Prisma integration stays
- **Relevant File(s):** `instrumentation.ts`
- **Change Summary:** Keep `Sentry.prismaIntegration()`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/integrations/prisma/
- **Verbatim Quote:**
  > "This integration is enabled by default and supports Prisma versions 5, 6, 7 & 8. In Prisma v5, you need to follow the instructions below to enable tracing."
- **Justification:** No change for query spans; `databaseQueryData: true` adds bound parameters.

### [C41] — `captureException` with tags/extra
- **Relevant File(s):** `lib/sentry/report.ts`, the client catch sites in §4
- **Change Summary:** Report swallowed client errors with tags and scrubbed extra.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/apis/#captureException
- **Verbatim Quote:**
  > "function captureException( exception: unknown, captureContext?: CaptureContext ): EventId"
  > "// Additional data that should be sent with the exception. extra?: Record<string, unknown>, // Additional tags that should be sent with the exception. tags?: Record<string, string>,"
- **Justification:** Signature used by `reportClientError`; the returned `EventId` feeds the report dialog.

### [C41b] — `setContext` for the Server Function input
- **Relevant File(s):** `lib/sentry/server-action.ts`
- **Change Summary:** Attach the scrubbed JSON input as context `server_action_input`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/apis/#setContext
- **Verbatim Quote:**
  > "Set a context to be sent with Sentry events. Custom contexts allow you to attach arbitrary data to an event. You cannot search these, but they are viewable on the issue page"
- **Justification:** The `formData` option does not fit JSON inputs.

### [C46] — Group `after()` work into one trace
- **Relevant File(s):** `lib/sentry/after-flush.ts` and its four callers
- **Change Summary:** Wrap the deferred callback in `Sentry.startSpan`, keeping the catch and `finally` flush.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/tracing/#detached-spans-with-after-or-waituntil
- **Verbatim Quote:**
  > "If you're using Next.js's `after()` or `waitUntil` and you see multiple root spans (like individual `db` spans) instead of one cohesive trace, your spans are becoming detached. … Wrap your deferred work with `startSpan` inside the `after()` or `waitUntil()` callback to group all background spans into a single transaction"
- **Justification:** Completion emails, admin alerts and hashing run in `after()`; at 100 % tracing they would otherwise be orphan spans.

### [C47] — Blocking DOM elements by attribute (documented, not applied)
- **Relevant File(s):** none applied (§9.2, §14); would be `app/share/thank-you-client.tsx`, `app/m/[claimToken]/media-list-client.tsx`
- **Change Summary:** Records the mechanism that would hide tokens in DOM recordings, and why it is not used after Rob's ruling.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/session-replay/privacy/#blocking
- **Verbatim Quote:**
  > "Blocking replaces the element with a placeholder that has the same dimensions. The recording will show an empty space in place of the content. Elements with class name `sentry-block` or the attribute `data-sentry-block` will be blocked."
  > "By default, the Session Replay SDK will mask all text content with `*` and block all media elements … It's also possible to add the following CSS classes to specific DOM elements to prevent recording their contents: `sentry-block`, `sentry-ignore`, and `sentry-mask`."
- **Justification:** Masking only rewrites text; blocking removes the element (including `href`/`src` attributes) from the snapshot. The page URL in rrweb's meta event (`href: window.location.href`, verified in `@sentry/replay` source) has no such control, so blocking alone could never make `/m/*` recordings token-free; Rob therefore accepted the residual rather than lose the replay.

### [C48] — Put privacy attributes on the components, not pages (documented, not applied)
- **Relevant File(s):** none applied (§9.2)
- **Change Summary:** Where the attribute would live if the ruling is reversed.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/session-replay/privacy/#make-privacy-explicit-in-shared-react-components
- **Verbatim Quote:**
  > "Rather than auditing individual pages, add `data-sentry-mask`, `data-sentry-block`, or `data-sentry-unmask` to the low-level components your app is built from, so every consumer inherits the right behavior for free"
- **Justification:** Matches where the attribute is placed in §9.2 and the render test that pins it.

### [C49] — Server-side Advanced Data Scrubbing does not cover replay recordings
- **Relevant File(s):** none (§10 item 3, §14)
- **Change Summary:** Explains why server-side rules are not the token defence.
- **Source URL:** https://docs.sentry.io/security-legal-pii/scrubbing/advanced-datascrubbing/#sources and https://docs.sentry.io/security-legal-pii/scrubbing/advanced-datascrubbing/#data-scrubbing-for-logs
- **Verbatim Quote:**
  > "Data scrubbing always works on the raw event payload."
  > "When using `**` selectors in scrubbing rules, be aware that they only apply to the default event PII fields. Fields not on that list will **not** be scrubbed automatically, even if matched by a `**` selector."
  > "Logs will honor the default Server-Side Data Scrubbing rules applied to your projects. To add advanced data scrubbing rules for Logs, start by choosing the dataset."
- **Justification:** The documented datasets are events, logs and attachments; replay recordings are not among them, so client-side blocking and exclusion are required.

### [C50] — Feedback screenshots option
- **Relevant File(s):** `instrumentation-client.ts`
- **Change Summary:** Keep the SDK default (`enableScreenshot: true`) per Rob's ruling; the option is named here so a reviewer can see it was a deliberate choice.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/user-feedback/configuration/#user-and-form
- **Verbatim Quote:**
  > "| `enableScreenshot` | `boolean` | `true` | Allows the user to send a screenshot attachment with their feedback. For self-hosted, release 24.4.2 is also required. |"
- **Justification:** Screenshot pixels of the thank-you page can carry private links; Rob accepted that residual on 2026-11-04 (§2, §14).

### [C52] — Explicit check-ins with `error` status
- **Relevant File(s):** `app/api/cron/reconcile-uploads/route.ts`
- **Change Summary:** `captureCheckIn` `in_progress` → `ok`/`error`, with `error` when any item failed.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/crons/#check-ins
- **Verbatim Quote:**
  > "Check-in monitoring allows you to track a job's progress by completing two check-ins: one at the start of your job and another at the end of your job. This two-step process allows Sentry to notify you if your job didn't start when expected (missed) or if it exceeded its maximum runtime (failed)."
  > "// 🔴 Notify Sentry your job has failed: Sentry.captureCheckIn({ // Make sure this variable is named `checkInId` checkInId, monitorSlug: \"<monitor-slug>\", status: \"error\", });"
- **Justification:** Lets the route report partial failure, which `withMonitor` cannot.

### [C53] — Custom `transport` for the envelope test
- **Relevant File(s):** `__tests__/lib/sentry-envelope.test.ts`
- **Change Summary:** Capture outgoing envelopes in Vitest and assert no synthetic token appears.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#transport
- **Verbatim Quote:**
  > "The JavaScript SDK uses a transport to send events to Sentry. Transports will drop an event if it fails to send due to a lack of connection. In the browser, a `fetch`-based transport is used by default. On the server, a `https`-based transport is used by default."
- **Justification:** `transport` is the documented injection point; `createTransport` is exported by `@sentry/nextjs` (verified), so the test needs no network and runs under the offline rules.

### [C54] — Tags for ids
- **Relevant File(s):** features listed in §4, `app/m/[claimToken]/claim-form.tsx`
- **Change Summary:** `memory_id`, `media_id`, `submission_id` as tags, never as `user.id`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/apis/#setTag
- **Verbatim Quote:**
  > "Set a tag to be sent with Sentry events. - Tag keys have a maximum length of 200 characters and can contain only letters (`a-zA-Z`), numbers (`0-9`), underscores (`_`), periods (`.`), colons (`:`), and dashes (`-`)."
- **Justification:** Tags are searchable and keep `user.id` reserved for the person.

### [C55] — `withIsolationScope` per cron item
- **Relevant File(s):** `app/api/cron/reconcile-uploads/route.ts`
- **Change Summary:** Each per-item call runs in a forked isolation scope so identity set by a shared feature cannot leak.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/apis/#withIsolationScope
- **Verbatim Quote:**
  > "function withIsolationScope(callback: (scope: Scope) => void): void — Forks the current isolation scope and calls the callback with the forked scope."
- **Justification:** `setUser` binds to the isolation scope [C18]; one cron request processes many contributors' items.
- **R9** No render test for `app/global-error.tsx` or the browser init (no DOM test harness in the repo; adding one is out of scope). `__tests__/next-config.test.ts` pins the `Document-Policy` header; the build pins the rest of the config; the browser behaviour is the §11.3 preview gate. Cost if wrong: a browser-only regression reaches the preview before a test.
