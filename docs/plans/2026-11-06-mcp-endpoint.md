# Execution plan: bearer-protected MCP endpoint (`/api/mcp`) with admin memory CRUD and memory coordinates

**Plan v2, 2026-11-06.** Supersedes v1 (same day) after a review round sorted in §10.
**Branch:** `claude/affectionate-cannon-an6o5d` off `origin/main` at `982a141` (merge of PR #53; the plan was written at `95f4df4`, see the drift note in §3). Worktree on Rob's Mac: `/Users/rob/Documents/active_work/jowray_wt_mcp`. One PR, commits in the order of §4.
**Authoritative copy:** this file, `docs/plans/2026-11-06-mcp-endpoint.md` on the branch, is the plan and the ledger (commit 0 done). The untracked copy in the main checkout is stale. Never keep two ledgers.
**Source issue:** `docs/plans/2026-11-06-mcp-endpoint-issue.md` (severity medium, feature), copied in commit 0 from Rob's upload (Mac copy `~/Downloads/jowray-mcp-endpoint-issue.md`; one personal sentence shortened for the public repo).

**Decisions (do not re-ask):**
1. `place` edits leave coordinates alone (Rob, 2026-11-06). `features/memories/claim.ts` and `features/admin/update-memory.ts` are not touched.
2. Rate limiting: the 32+ character secret, logged refusals and the daily memory budget. A Vercel WAF rule is a follow-up (§8.1), not code in this PR.
3. One PR with ordered commits (Rob, 2026-11-06).
4. Agent's calls, flagged for veto: `draft_memory` accepts only `sourceInput`; no server-side rounding of coordinates; the privacy guard is the tool description plus the skill asking Rob before saving; a named community or facility campus (Broadmead) is a place, a residence or unit inside it is not.
5. From the review round (§10): every tool runs inside one error boundary that reports to Sentry and returns `{ code: "internal", eventId }`; `wrapMcpServerWithSentry` is called explicitly; versions are pinned exactly; a single builder replaces the four lanes.
6. A place phrase that names a home (a street address such as "12 Elm Road, Towson", or "her apartment at Broadmead") gets no coordinates at all, not even for the town or campus it sits in; the Where text still follows the skill's existing street/unit rule. Orchestrator's call, 2026-11-06, from the §6.4 skill micro-tests; **flagged for Rob's veto**.

---

## 0. Cold start (read first; works after a compaction or a handoff)

**0.1 Where am I?**
- **Cloud container (this session's kind):** repo at `/home/user/jowray_com`, `node_modules` absent until `npm ci`. Uploads under `/root/.claude/uploads/...` exist only in the session that received them.
- **Rob's Mac:** the main checkout `/Users/rob/Documents/active_work/jowray_com` is shared with other agents and may be on another branch. Never edit there. Use a worktree: `git -C <main> fetch origin && git -C <main> worktree add ../jowray_wt_mcp claude/affectionate-cannon-an6o5d` (add `-b` off `origin/main` if the branch is still missing). Node: CI runs 26; use `nvm use 26` or the Homebrew node. The 2026-11-05 plan's cold start has the same recipe.

**0.2 First five minutes, in order**
1. `git fetch origin main claude/affectionate-cannon-an6o5d` (the second ref may not exist yet). If the branch is missing: `git checkout -B claude/affectionate-cannon-an6o5d origin/main`. If it exists: check it out and read `docs/plans/2026-11-06-mcp-endpoint.md` there; that ledger wins over this file.
2. `npm ci`. Then read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` and `.../02-route-segment-config/maxDuration.md` before touching the route (AGENTS.md rule). The Next.js quotes in §Citations are from nextjs.org on 2026-11-06; record any drift in the ledger.
3. Read `AGENTS.md`, this plan's §1.2 (what the issue got wrong) and §1.4 (verified package facts). Do not re-derive them.
4. **Resume check before any work:** `git log --oneline origin/main..HEAD` and match subjects against the §4 commit list; run `npm run validate && npm run test:run`; then continue from the first ledger row (§3) whose done-check fails. Never redo a step whose done-check passes.
5. Read the **Next action** line at the top of §3.

**0.3 Rules that hold throughout**
- Checks: `npm run validate`, `npm run test:run`, `npm run build:offline`, all with no `.env*` and `DATABASE_URL` unset. CI additionally runs `prisma migrate deploy` against Postgres 18 and `__tests__/integration/*` with `TEST_DATABASE_URL` (`.github/workflows/ci.yml:19-49`).
- Never print `ADMIN_API_SECRET`, `MCP_API_SECRET`, a `claimToken` or a `claimLink`. Tests use `"a".repeat(40)` and `SENTRYTEST_`-prefixed tokens.
- `MCP_API_SECRET` goes in Vercel **Production only**. Never Preview. A cold agent who sees 401s from a preview deploy must not add the secret there (§6.2 has the local path).
- **STOP points** (ask Rob, do not proceed on your own): any Vercel env change; adding or removing the connector; `reissue_claim_link`; any force-push; creating the production test draft (§6.3).
- Package versions verified on npm 2026-11-06: `mcp-handler` 2.3.1 (published 2026-11-05), `@modelcontextprotocol/server` 2.4.0, `@sentry/nextjs` 11.10.0 (already installed). Install with `--save-exact` (§4.4).

## 1. Context

### 1.1 Why
The `jowray-draft-memory` skill saves a condolence note as a DRAFT memory and drafts Rob's reply with the sender's claim link. Today the save step runs only on Rob's Mac: it needs the local checkout, `.env` with `ADMIN_API_SECRET`, and the cloud container's egress proxy refuses `jowray.com`. On 2026-11-05 a reply to Joyce Gilley sat unsent with a placeholder because a claude.ai session could not save the memory. A Claude custom connector at `https://www.jowray.com/api/mcp` fixes all three failures because Anthropic's infrastructure calls the site directly [C12]. Rob also wants each memory to carry optional WGS 84 coordinates for a future map, captured while the place is fresh [C26].

### 1.2 Issue claims that did not match the code at `95f4df4`
| Issue claim | Reality | Effect on plan |
|---|---|---|
| `isoDate` and `optionalText` are reusable exports | Module-local in `lib/validations/admin.ts:8-15, :37` and `memory.ts:19-26` | `adminCoordinatesSchema` lives in `admin.ts` so it can use `isoDate`; `lib/validations/mcp.ts` re-exports (§4.3) |
| `set-status.ts` has a stale check to copy | It has an `unchanged` short-circuit only; the `memoryVersion` stale pattern is in `update-memory.ts` | `set-coordinates.ts` combines both [C34] |
| Lock and revision helpers live in `features/admin/` | `lockMemory`: `features/memories/lock.ts:15`; `appendRevision`: `features/memories/media-state.ts:86-112` | Use both; never `tx.memoryRevision.create` in the new feature |
| `withinBudget` is in `draft-memory.ts` | Imported from `features/memories/create-memory.ts:158` | None |
| CHECK constraints testable in a feature test | Feature tests mock `getDb()`; only `__tests__/integration/budget-concurrency.test.ts` touches SQL | Constraint test goes in `__tests__/integration/memory-coordinates.test.ts` (§4.2) |
| `docs/environment.md` `ADMIN_API_SECRET` row says "never Preview" | Only the `ADMIN_PAGE_SECRET` row (line 92) does | The new row copies that wording [C36] |

Also confirmed: `getMemoryForAdmin` uses `include` but maps the view field by field (`get-memory.ts:102-151`); `eslint.config.mjs` lets `app/api/**` import `features/`, `services/`, `lib/`, `server/` and forbids only `integrations/` [C42]; `__tests__/scripts/draft-memory.test.ts:4` imports `prepareInput` from `../../scripts/draft-memory` with relative paths.

### 1.3 Scope
Eight tools as thin adapters over existing features, one new feature (`setMemoryCoordinatesAsAdmin`), two nullable columns with three CHECK constraints, a new `MCP_API_SECRET`, the `sourceInput` derivation moved to `lib/`, Sentry wiring for the route, and the skill rewritten to prefer the connector. Out of scope: §8 and §9.

### 1.4 Verified package facts (read the unpacked sources once; do not rediscover)
Checked on 2026-11-06 by unpacking the npm tarballs. Line numbers are in the published `dist` files.
| Fact | Where | Consequence |
|---|---|---|
| The SDK wraps `validateToolInput` and `executeToolHandler` in one `try`; any throw becomes `createToolError(error.message)`, a 200 `isError` result. Nothing propagates to the route or to `onRequestError`. | `@modelcontextprotocol/server` 2.4.0 `dist/mcp-oHn3ureC.mjs:1604-1616` [C43] | Every tool runs inside our own boundary (§4.5) so a Prisma or Neon message, or a file path, never reaches the model, and Sentry gets the exception. Schema rejections are also 200 `isError`; tests assert that, not a 400. |
| `mcp-handler` builds `new McpServer(serverInfo, mcpServerOptions)` and calls `initializeServer` inside the factory it hands to the SDK; the SDK calls that factory **per request** on both the modern and the legacy path. | `mcp-handler` 2.3.1 `dist/index.js:197-207`; SDK `dist/index.mjs` (`createLegacyStatelessFallback`, `serveModern`) [C44, C51] | `registerTools` must be cheap and pure: no env reads, no schema construction, no Prisma inside it. Schemas and the Sentry wrap are module-scope or idempotent. |
| `maxSubscriptions` is accepted by `mcp-handler` and passed to the SDK; the SDK refuses `subscriptions/listen` when `open.size >= maxSubscriptions` (default 1024). | `mcp-handler` `dist/index.js:174,206`; SDK `dist/listenRouter-*.mjs:164-169` [C52] | Set `maxSubscriptions: 0`; this server has no subscribable resources, and an SSE listen would otherwise hold a Vercel function open. |
| The legacy stateless path answers `GET` with a JSON-RPC 405. | SDK `dist/index.mjs` `createLegacyStatelessFallback` [C51] | The exported `GET` is for protocol completeness; the gate still runs first on it. |
| `originValidationResponse` is **not** exported by `mcp-handler`; it is in the SDK and is for localhost DNS-rebinding protection. | `mcp-handler` `dist/index.d.ts:371`; SDK `dist/index.mjs:1441` [C50] | Not used (§9). |
| `@sentry/nextjs` 11.10.0 contains no reference to the MCP package. `@sentry/node` exports `wrapMcpServerWithSentry` and `mcpServerIntegration`. The wrapper records tool result text into span attributes when outputs are recorded (`recordOutputs ?? genAI.outputs`, which this repo sets `true`), and captures an exception only when the tool handler **throws** (`"tool_execution"`). | `@sentry/core` 11.10.0 `build/cjs/integrations/mcp-server/{transport,resultExtraction,handlers}.js` [C45, C46] | We call `wrapMcpServerWithSentry(server)` ourselves in `registerTools` (idempotent via its WeakMap). Because our boundary catches first, the exception is reported once, by us. The envelope test must cover the span attribute carrier. After `npm ci`, check whether `mcpServerIntegration` is among `getTracingIntegrations()`; either way the explicit wrap is correct. |

## 2. Orchestration

**One builder, one reviewer.** A single builder works through §4 in commit order in one worktree, running the three checks before each commit. This gives the ordered commits for free and removes stubs, rebases and lane merges. After commit 7 the orchestrator runs `/code-review` at high effort (a separate subagent, given the diff and not this plan's conclusions), applies confirmed findings as fix-up commits, re-runs the checks, then opens the PR with §8 and §9 pasted into the description. The `Workflow` tool is not used unless Rob asks for it in his own words.

**Builder contract per commit:** tests first and red; code; `npm run validate && npm run test:run`; `npm run build:offline` on commits 4, 5 and 6; ledger row updated with the SHA; push after every commit so a compaction loses nothing.

**STOP points** are listed in §0.3. The orchestrator owns the ledger; the builder updates only the rows for its commits.

## 3. Progress ledger

**Next action:** Rob reviews and merges PR #60, then the Rob rows below (Vercel secret, connector, tool approvals, smoke draft, skill delivery). The agent deletes Neon branch `mcp-e2e-20261106` once Rob approves.

**Drift since `95f4df4` (2026-11-06):** `main` gained PRs #53, #54 and #57 (`982a141`). Of the files this plan cites, `AGENTS.md`, `README.md`, `docs/environment.md` and `docs/code-layout.md` changed, so their line numbers may differ: re-read before editing. `features/`, `lib/validations/`, `lib/sentry/`, `scripts/draft-memory.ts`, `prisma/`, `server/config/env.ts`, `app/api/admin/` and `docs/skills/` are unchanged.

| Step | Owner | Status | Evidence (SHA, id, URL) | Done-check |
|---|---|---|---|---|
| Plan v2 approved | Rob | done | Rob, 2026-11-06: "Execute this plan in a new worktree" | |
| Commit 0: plan + issue copied into `docs/plans/`, branch pushed | agent | done | first commit on the branch (`docs(plans): add the MCP endpoint plan and its source issue`) | `git ls-remote --heads origin claude/affectionate-cannon-an6o5d` lists it; both files on the branch |
| `npm ci`; Next.js docs re-read; citation drift recorded here | agent | done | Node 26.13.0. **No drift**: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (HTTP methods, `NextRequest`, `new Headers(request.headers)`), `02-route-segment-config/maxDuration.md`, `02-route-segment-config/index.md` (v16.0.0 row: `dynamic`, `dynamicParams`, `revalidate`, `fetchCache` removed under Cache Components) and `01-getting-started/08-caching.md` / `15-route-handlers.md` (`GET` Route Handlers follow the prerendering model of pages) say what [C6]–[C9] quote | "no drift" or the diff noted |
| Commit 1 schema + migration | agent | done | `f92da47`, pushed. `prisma validate` ok; `prisma generate` adds `latitude`/`longitude: number \| null`; `migrate deploy` applied all 17 migrations to a throwaway Postgres 18.6 cluster (Homebrew, TCP port 55432, scratchpad); `\d "Memory"` shows the three CHECKs; `prisma migrate diff --from-config-datasource --to-schema` against it prints "This is an empty migration" (schema and SQL agree) | `npx prisma validate` ok; folder `20261106120000_memory_coordinates` present |
| Commit 2 coordinates features + tests | agent | done | `910bb78`, pushed. Red first (16 failures, all missing exports or behaviour), then green: `test:run` 70 files / 1288 passed, 2 integration files skipped without `TEST_DATABASE_URL`; `validate` green. `__tests__/integration/memory-coordinates.test.ts` (8 cases) and `budget-concurrency.test.ts` green together against the local Postgres 18.6 cluster with `TEST_DATABASE_URL` set on that command only. Sensitivity: on a second database with `Memory_longitude_range` dropped, exactly the 3 longitude cases fail. Prisma 7 reports a CHECK violation as `P2039` with `meta.driverAdapterError.cause.code = "23514"` and the constraint name in `cause.message`; the test asserts both. Every case runs in a transaction that is always rolled back, so nothing is committed while vitest runs the budget suite in a parallel worker against the same database (it counts today's memories and truncates). **Deviations:** (a) `listMemoriesForAdmin` keeps its `include`, which already fetches every scalar (as it does `claimTokenHash`); the explicit mapper adds `coordinates` only on opt-in, instead of selecting the two columns conditionally (a non-literal `omit` would type the columns as always present). (b) Small additions: `coordinatesOf(row)` in `lib/validations/memory.ts` (one null-unless-both reader shared by the feature and both views) and `.describe()` on `latitude`/`longitude` for the tool schema. (c) Stripping drops a revision only when it held a `coordinates` key and both snapshots are empty afterwards; a revision that was already `{}`/`{}` is left as it was. | `test:run` green incl. new files; integration test green locally against Postgres or in CI |
| Commit 3 `lib/source-input.ts` | agent | done | `747d442`, pushed. Red first (module missing), then green: `__tests__/scripts/draft-memory.test.ts` unchanged (`git diff` empty) and green; new `__tests__/lib/source-input.test.ts` (5 cases, including `scriptPrepareInput === prepareInput`); `test:run` 71 files / 1293 passed; `validate` green; `npx tsx scripts/draft-memory.ts` still loads under tsx and prints its usage line. **Deviation:** `SourceInput` is now `z.infer<typeof sourceInputSchema>` instead of the hand-written union (it was exported but used nowhere); the only difference is `other.email` optional, which is what `prepareInput` already accepted. The doc comment moved with it and now says the MCP tool accepts only `sourceInput`. | script test green with assertions unchanged |
| Commit 4 deps, env, auth | agent | done | `1c1217e`, pushed. `package.json` pins `mcp-handler` **2.3.1** and `@modelcontextprotocol/server` **2.4.0** exactly (lock adds `@modelcontextprotocol/core` 2.4.0, `chalk`, `commander`; `zod` stays one deduped 4.6.7; `npm audit` shows no finding in any new package, the 20 listed are pre-existing). Module scope checked: `mcp-handler/dist/index.{js,mjs}` only defines functions (its one `fetch` is inside the generated WebMCP browser script string) and neither it nor the SDK `dist` reads `process.env`; the SDK's `createMcpHandler` constructor builds an `InMemoryServerEventBus` and a listen router with no timer or socket. §1.4 re-checked against the installed files: [C43] at `mcp-oHn3ureC.mjs:1607-1616`; [C44] factory in `mcp-handler/dist/index.mjs` `initializeMcpApiHandler`; [C51]/[C52] as quoted; new fact: the success path runs `projectCallToolResult`, which leaves an object `structuredContent` unchanged in both eras (only non-object values get wrapped). **§5.5 answer: yes.** `@sentry/node` 11.10.0 `getAutoPerformanceIntegrations()` returns `@sentry/server-utils` `getTracingIntegrations()`, whose last entry is `mcpServerIntegration()`; it subscribes to Orchestrion constructor channels for `@modelcontextprotocol/server` `>=2.0.0 <3` (`dist/mcp-*.mjs`) and calls `wrapMcpServerWithSentry(self)`. Whether that hook fires inside the Next.js server bundle is not proven; the explicit wrap is a no-op if it did (`wrappedMcpServerOptions` WeakMap in `@sentry/core` `integrations/mcp-server/index.js`). `wrapMcpServerWithSentry` is reachable as `Sentry.wrapMcpServerWithSentry` from `@sentry/nextjs` (server types re-export `@sentry/node`). Tests: new `__tests__/api/admin-auth.test.ts` (6 cases: realms independent, fail closed, no `WWW-Authenticate`, `mcp_unauthorized` log without the header, header read before env parse) and 4 `getMcpEnv` cases, red then green; `__tests__/api/admin-memories.test.ts` unchanged and green; `test:run` 72 files / 1303 passed; `validate` green; `build:offline` green. | pinned versions in `package.json`; `build:offline` green |
| Commit 5 route + tools | agent | done | `69920f5`, pushed. Red first (route missing), then green: first 6 cases of `__tests__/api/mcp.test.ts` (gate, `tools/list` names, boundary, one success); `test:run` 73 files / 1309 passed; `validate` green; `build:offline` green with `/api/mcp` listed as `ƒ` (dynamic, not prerendered). `next dev -p 3123` with a throwaway `MCP_API_SECRET` in that shell only: no header 401, wrong bearer 401, `GET` without header 401, no `WWW-Authenticate` on the 401, right bearer 200; `/.well-known/oauth-protected-resource/api/mcp` and `/.well-known/oauth-protected-resource` both 404; the secret does not appear in the dev log. **§5.2 answer:** `build:offline` passes; the gate reads `request.headers` before any env or Prisma (unit test in `admin-auth.test.ts` proves the order, and the build reports the route dynamic); `mcp-handler` and the SDK open no socket and read no env at import (source read in commit 4; the module-scope `createMcpHandler` only builds an in-memory bus and router). Both eras call `server.connect(transport)` (legacy: `WebStandardStreamableHTTPServerTransport`; modern: `invoke` with a `PerRequestHTTPServerTransport`), so Sentry's transport instrumentation applies to each. **Deviations:** (a) `runTool` calls `tagIds({ memoryId })` and then `Sentry.captureException(error, { mechanism: { type: "mcp.tool", handled: true }, captureContext: { tags: { tool } } })`: `tagIds` returns `void` (it sets tags on the scope), and Sentry 11's `ExclusiveEventHintOrCaptureContext` forbids `tags` beside `mechanism`, so the tag travels in `EventHint.captureContext`. (b) `mcpListInputSchema` and `mcpDraftInputSchema` are `.strict()`, so a `source`/`sourceRef` (or any unknown key) is refused instead of silently stripped; the list fields and `sourceInput` carry `.describe()` text. (c) Tool configs are one module constant (`TOOLS`), so `registerTools` constructs nothing but the handler closures. (d) `toolResult` round-trips through `JSON.stringify`, so `structuredContent` and the text block are byte-identical (Dates become ISO strings in both). (e) Every feature `ok: false` goes through one `refusal()` that drops only `ok`, so each code keeps exactly the feature's extra fields; success payloads are mapped field by field (no `claimToken`). | `build:offline` green; `curl` to `next dev` returns 401 without header |
| Commit 6 route tests + Sentry case | agent | done | `616d8d0`, pushed. `__tests__/api/mcp.test.ts` now 53 cases: gate (case 1), `tools/list` inline snapshot of name, title, description, annotations and input schema for all eight tools (case 2; passes with `CI=true`, so it is committed, not written on CI), all 28 rows of the §4.5 table in `structuredContent` and the parsed text block (case 3) plus argument mapping for every tool, the boundary on all eight tools (case 4), schema refusals as 200 `isError` with no feature call, including `source` + `sourceRef` with and without `sourceInput`, and `prepareInput` refusals as `invalid` with their messages (case 5), `claimToken` and the raw token absent from every `tools/call` body (case 6, asserted in the shared helper), and the modern era (case 7). **Case 7 requirements, from `@modelcontextprotocol/server` 2.4.0 source** (`dist/src-DdvbAHrR.mjs` `classifyRequestBody`, `validateStandardRequestHeaders`, the 2026 codec's `RequestMetaEnvelopeSchema`; `dist/index.mjs` `serveModern`, `standardHeadersOf`): header `MCP-Protocol-Version: 2026-07-28`; header `Mcp-Method` equal to the body method; header `Mcp-Name` equal to `params.name` for `tools/call`; body `params._meta` with `io.modelcontextprotocol/protocolVersion: "2026-07-28"` and `io.modelcontextprotocol/clientCapabilities` (`{}` is valid); `REQUIRED_CLIENT_CAPABILITIES_BY_METHOD` is empty. The fixture lists eight tools and calls `get_memory`; dropping `Mcp-Method` or `Mcp-Name` answers 400, which proves the modern path ran; `subscriptions/listen` answers "Subscription limit reached" (`maxSubscriptions: 0`). Which era each real client uses is §5.3, not recorded here. `__tests__/lib/sentry-envelope.test.ts`: new case builds an `McpServer`, runs `registerTools`, connects `InMemoryTransport`, calls `draft_memory` whose mocked result carries `https://preview.test/m/SENTRYTEST_…`; the envelopes carry `mcp.tool.name` = `draft_memory` and `mcp.tool.result.content`, and none contains `SENTRYTEST_`. Sensitivity: a throwaway copy with `beforeSendSpan` returning the span unscrubbed fails exactly this case on the token, so the span-attribute carrier is what the scrubber protects; no scrubber change needed. `test:run` 73 files / 1357 passed; `validate` green; `build:offline` green. | `test:run` green; snapshot committed |
| Commit 7 docs + skill | agent | done | `e2f9a86`, pushed. `docs/environment.md`: `MCP_API_SECRET` row (Production only, never Preview, not in local `.env`; `openssl rand -hex 32`; `vercel env add MCP_API_SECRET production` then redeploy; organisation's credential) and a new "MCP connector (`/api/mcp`)" section (www URL and why, No sign-in, `authorization: Bearer <secret>` with the scheme, approval on the five data-changing tools and again after any re-add, plain 401 means a connection error not a sign-in, rotation ending in remove-and-re-add, the beta-withdrawal fallback). `docs/skills/jowray-draft-memory/SKILL.md` (174 lines): connector first with the script as fallback; preflight skipped with the connector (and the fallback's diff list now includes `lib/source-input.ts`, where the script's derivation lives); coordinates proposed in step 2 with the phrase and the numbers' source, never for a residence or unit; a `Coordinates` question in 2b; `draft_memory` sends `coordinates` only on Rob's choice and reads `originalNoteRecorded`; `internal` gives the `eventId` and one safe retry; the duplicate branch reads the row with `get_memory`, carries the plan's lost-response sentence, reissues only on an explicit yes, and edits through `update_memory` under the stale rule. `README.md` unchanged: its feature table has no admin-API row (only the architecture diagram's route-handler node names `/api/admin`). §6.4: desk-checked, each of the seven scenarios has an explicit instruction; the live micro-tests need the connector (§6.2, orchestrator). Secret scan of `git diff origin/main` (64-hex, long bearer values, credentialed Postgres URLs): none. `validate` green; `test:run` 73 files / 1357 passed. | §6.4 micro-tests pass; no secret value in the diff |
| Builder's final checks (commits 1–7) | agent | done | At `e2f9a86`, no `.env*`, `DATABASE_URL` unset: `validate` green; `test:run` 73 files / 1357 passed (2 integration files skipped without `TEST_DATABASE_URL`); `CI=true TEST_DATABASE_URL=<local Postgres 18.6> npm run test:run` 75 files / 1372 passed (both integration suites ran); `build:offline` green. The throwaway cluster was stopped and deleted afterwards. | |
| `/code-review` high; findings applied | agent | done | Round 1 at `34fbf0e` (separate subagent, given the diff only): 7 findings, each checked against source. **Must (fix-ups):** R1 `mcp-handler` drops SDK `onerror` errors when there is no `onEvent` and `verboseLogs` is off (`dist/index.js:184-197`), so add an `onEvent` that reports `ERROR` events; R2 `contributor` inside `mcpDraftInputSchema` is not strict, so a mistyped key is silently dropped; R3 `set_coordinates` success returns no new `memoryVersion` although its write moves `updatedAt`; R4 the skill finds the creation revision as "oldest ADMIN" inside `get_memory`'s 25-revision window, so on a long-edited draft it could misread a later edit as the unrecorded-rewrite defect; R5 comments say coordinates are "set and read only through /api/mcp", but `POST /api/admin/memories` also writes them (`migration.sql` comment left as is: the file is already applied on the preview and e2e branches). **Don't:** R6 derive `mcpListInputSchema` from `adminListQuerySchema` (the feature re-parses with the admin schema, so drift can only refuse earlier; its `q` transform cannot be expressed in a tool's JSON Schema); R7 drop the duplicated text block (MCP spec SHOULD [C19]; Rob's telemetry ruling covers the span attribute).  Fix-ups: R1 `0263152`, R2 `2af5344`, R3 `cc8d3e0`, R4 `b509f7b`, R5 `d16212c`. **Round 2** (same reviewer, `dbc978b..d16212c`): R1–R5 closed, no new bugs; one new finding, R8: the SDK advertises `tools.listChanged: true` by default (`mcp-oHn3ureC.mjs:1588`) while `maxSubscriptions: 0` refuses every listen, so since R1 each refusal would be a Sentry error. Fixed in `48d7621` (`capabilities: { tools: { listChanged: false } }`, asserted in the legacy `initialize` and the modern `server/discover` results). Declined: report client rejections at `warning` by matching message text (brittle; after R8 only a misbehaving authenticated client reaches them). **Round 3** (`d16212c..48d7621`): closed, no findings. Builder checks at `48d7621`: `validate` green, `test:run` 74 files / 1365 passed, `build:offline` green. | fix-up commits listed |
| §6.4 skill micro-tests (role-play, separate agent, SKILL.md only, mocked tools) | agent | done | Round 1 at `48d7621`: scenarios 1, 4, 5, 7 PASS; 2 (fallback vs "connector errors" contradiction), 3 (Gmail check used `get_thread`, which omits drafts, so an unsent draft with a link was invisible) and 6-street (a home address could still get its town's coordinates) FAIL; plus a classification defect (a verbatim draft later edited by the sender read as the unrecorded-rewrite defect). Fixed in `18ba4dd` (ten items, incl. resume check by `sourceRef`, `list_drafts` with `DRAFT_VIEW_FULL`, decision 6). Round 2: all PASS except (ii) an unsent in-thread draft still offered a reissue; fixed in `c227994` with the other-memory-link edge, the L58 ordering and the script retry. Round 3 at `c227994`: all PASS; two last edges (same-thread attribution with several notes from one sender; keep the script's JSON file for its re-run) applied by the orchestrator in `57e59aa`. SKILL.md 175 lines. | §6.4 micro-tests pass |
| PR opened; CI green; §8 + §9 in the description | agent | done (CI on the final head: see the PR) | https://github.com/RobertdWray/jowray_com/pull/60 (opened as draft at `dbc978b`; `ci` green at `d16212c`, including `migrate deploy` on Postgres 18 and the integration suites; Vercel preview deployed) | `ci` check green |
| Local end-to-end on a Neon dev branch (§6.2) | agent | done at `34fbf0e`; branch delete awaits Rob | Neon branch `mcp-e2e-20261106` (`br-noisy-leaf-bbfrve7a`, child of `dev`; the connection string was built locally from the `dev` URL so no password entered the transcript); `migrate deploy` applied the pending migrations including `20261106120000_memory_coordinates`. `next dev -p 3107` with throwaway `MCP_API_SECRET`/`ADMIN_PAGE_SECRET` in the process env only, `OUTBOUND_ENABLED=false`, Sentry DSN empty. Driven by a JSON-RPC script (not `claude mcp add`, which would edit Rob's Claude config). Results: no header 401, wrong bearer 401, `GET` 401 without and 405 with the header, no `WWW-Authenticate`; `tools/list` 8 tools in the legacy and the 2026-07-28 era; `list_memories`; `draft_memory` (`other`, Broadmead coordinates) → memoryId `f993365e-dbe5-4c0a-a337-39da14eb6dc1`; `get_memory` coordinates match, no `claimToken`/`claimTokenHash`/`blobUrl`/`storageKey`; `set_coordinates` stale → `current`, same pair → `changed:false`, `null` → cleared; half pair and lat 91 → 200 `isError` plain-text schema refusal; `update_memory` place edit keeps coordinates (decision 1), stale → `current`; `set_status` on the DRAFT → `draft`; `set_deleted` true/false; `reissue_claim_link`; second `draft_memory` → `duplicate` with the same memoryId and `DRAFT`; `source`+`sourceRef` → schema refusal; `other` email mismatch → `invalid` with the `prepareInput` message; modern-era `get_memory` ok; unknown id → `not_found`. Text block equals `structuredContent` on every JSON result. `/admin/memories/<id>` (throwaway key, isolated browser context): no latitude, longitude, coordinates or coordinate values in the page or the History; the two coordinates-only revisions are dropped; the creation revision keeps its other keys. A first, aborted script run left draft `d6d6f81c-1a74-45d1-a49c-d7c90c5378d3` (coordinates cleared) on the same branch; both rows go with the branch. | every §6.2 step done; branch deleted |
| Merge | Rob | no | merge SHA | |
| `MCP_API_SECRET` in Vercel Production only; production redeployed | Rob | no | deployment id | `vercel env ls` shows Production only; `curl` 401 without header, 200 with it |
| Connector added (No sign-in, header); `list_memories` from the phone | Rob | no | | list returned |
| Six tools set to require approval: `draft_memory` and the five destructive ones (Team Code Review, G1) | Rob | no | | prompt appears before each |
| Production smoke draft created, recorded, then `set_deleted` (§6.3) | agent + Rob | no | memoryId | row shows deleted on `/admin` |
| Skill delivered to every surface: Mac symlink after `git pull`; claude.ai skill store updated with the merged SKILL.md | Rob | no | | `/jowray-draft-memory` on web shows the connector path; diff against `origin/main` empty |
| First real run from a cloud session | Rob | no | memoryId only | reply carries a real `/m/` link |
| Follow-up issues filed (§8) | Rob | no | issue URLs | |

Separate states, never conflated: implemented → tested → merged → deployed → exercised with a real note.

## 4. Design, in commit order

### 4.0 Commit 0: durable plan
Copy this file to `docs/plans/2026-11-06-mcp-endpoint.md` and the uploaded issue to `docs/plans/2026-11-06-mcp-endpoint-issue.md`. Push. From here on edit the repo copy only.

### 4.1 Commit 1: schema and migration
- `prisma/schema.prisma`, `model Memory`: `latitude Float?` and `longitude Float?` after `place`, with the comment `// WGS 84 decimal degrees; set and read only through /api/mcp (lib/validations/memory.ts coordinatesSchema)` [C23, C26].
- `prisma/migrations/20261106120000_memory_coordinates/migration.sql`, hand-named and hand-written like `20261104070100_consent_check` (two existing folders already share the prefix `20261105140000`, so the new name sorts last) [C24, C25]:
  ```sql
  -- Coordinates for a future map (WGS 84 decimal degrees). Set and read only through /api/mcp.
  -- Expand-only: nullable columns, no backfill; the running app ignores them.
  ALTER TABLE "Memory" ADD COLUMN "latitude" DOUBLE PRECISION, ADD COLUMN "longitude" DOUBLE PRECISION;
  ALTER TABLE "Memory" ADD CONSTRAINT "Memory_coordinates_pair" CHECK (("latitude" IS NULL) = ("longitude" IS NULL));
  ALTER TABLE "Memory" ADD CONSTRAINT "Memory_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90);
  ALTER TABLE "Memory" ADD CONSTRAINT "Memory_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180);
  ```
  No database is needed to write it. Then `npx prisma generate` so the two fields exist in the client types. If a Neon dev branch is reachable, `npx prisma migrate dev --create-only` may be used instead to generate the first two lines, with the CHECKs added by hand; the result must be the same SQL. CI's `prisma migrate deploy` on Postgres 18 and the integration test (§4.2) are the proof. `vercel.json` runs `migrate deploy` in every build [C39] and previews read production rows, so expand-only is mandatory.

### 4.2 Commit 2: validation, features and tests for coordinates
- `lib/validations/memory.ts`: export `coordinatesSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict()` [C26]. Export the pre-refine object as `draftMemoryObjectSchema` and build `draftMemoryInputSchema` from it with the existing refines, so the MCP schema can derive from the same fields (§4.5). Add `coordinates: coordinatesSchema.nullable().optional()` to the object. The REST draft API then accepts it too; harmless.
- `lib/validations/admin.ts`: add `.describe("ISO-8601 timestamp exactly as get_memory returned it")` to `isoDate` [C48] and export `adminCoordinatesSchema = z.object({ memoryId: z.uuid(), memoryVersion: isoDate, coordinates: coordinatesSchema.nullable() })` next to `adminStatusSchema`.
- `features/memories/draft-memory.ts`: write `latitude`/`longitude` from `input.coordinates` (null when absent) in `tx.memory.create` (lines 87-104) and add `coordinates: input.coordinates ?? null` to the `after` snapshot (lines 106-116).
- `features/admin/set-coordinates.ts` (new): `setMemoryCoordinatesAsAdmin(raw: unknown): Promise<AdminCoordinatesResult>`, where
  `AdminCoordinatesResult = { ok: true; changed: boolean; memoryVersion: string } | { ok: false; code: "invalid" | "not_found" } | { ok: false; code: "stale"; current: { memoryVersion: string; coordinates: Coordinates | null } }`. (`memoryVersion` added by review round 1, R3: the committed `updatedAt`, selected from the update, or the unchanged version when `changed: false`, as `update_memory` returns its committed versions.)
  Body: parse with `adminCoordinatesSchema`; `getDb().$transaction(async (tx) => { await lockMemory(tx, memoryId); re-read id, deletedAt, updatedAt, latitude, longitude, consentVersion; not_found if missing or deleted; stale if updatedAt.toISOString() !== memoryVersion (as update-memory.ts does); changed:false if the pair is equal; else update both columns and appendRevision(tx, { memoryId, changedVia: "ADMIN", before: { coordinates: old }, after: { coordinates: new }, consentVersion }) }, TX_OPTIONS)` [C34]. Log `{ action: "admin_coordinates_set", memoryId }` only.
- `features/admin/get-memory.ts`: `getMemoryForAdmin(id, options?: { includeCoordinates?: boolean })`. With the flag, the view gains `coordinates: { latitude, longitude } | null`, mapped explicitly from the row. Without it, the view has no `coordinates` key and every revision's `before`/`after` has its `coordinates` key removed; a revision whose two snapshots are both empty after stripping is dropped. The admin page passes nothing, so `app/admin/history.tsx` is unchanged [C37].
- `features/admin/list-memories.ts`: the same opt-in; `AdminListRow.coordinates` present only when requested; select the columns only then.
- Tests:
  - `__tests__/features/set-coordinates.test.ts` (new; stub pattern from `__tests__/features/admin-memories.test.ts:7-80`): lock order, `not_found`, `stale` with `current`, `changed: false` writes no revision, `changed: true` writes exactly one ADMIN revision with both snapshots, `null` clears.
  - `__tests__/features/draft-memory.test.ts`: with and without coordinates; `after.coordinates` present in both cases.
  - `__tests__/features/admin-memories.test.ts`: default view has no `coordinates` anywhere, including revisions; a coordinates-only revision is dropped; the creation revision keeps its other keys; opt-in view has `coordinates`.
  - `__tests__/integration/memory-coordinates.test.ts` (new; `TEST_DATABASE_URL` pattern from `budget-concurrency.test.ts:23-29`). Each case starts from a **complete valid pair** so the range check is the only constraint in play: `latitude = 91` with `longitude = 0` fails; `longitude = 181` with `latitude = 0` fails; `latitude` set with `longitude` null fails on the pair check. Assert SQLSTATE `23514` **and** the constraint name in the error (`Memory_latitude_range`, `Memory_longitude_range`, `Memory_coordinates_pair`) [C47]. A valid pair and a null pair succeed.

### 4.3 Commit 3: shared `sourceInput` derivation
- `lib/source-input.ts` (new, pure, no `server-only`): move `SourceInput` (script :112-115), `stringField` (:117-123), `sourceFor` (:125-145) and `prepareInput` (:156-177) verbatim; import the builders from `@/lib/source-ref` [C31, C35]. Add and export `sourceInputSchema`, a `z.discriminatedUnion("kind", [...])` of three strict objects (`gmail: { messageId }`, `sms: { number, sentAt, text }`, `other: { email?, originalText }`) with `.describe()` text for each field. `redactSecret` stays in the script.
- `scripts/draft-memory.ts`: `import { prepareInput } from "../lib/source-input"` (the script uses relative paths, line 20) and re-export `SourceInput` and `prepareInput` so `__tests__/scripts/draft-memory.test.ts:4` keeps its imports and assertions unchanged.
- `__tests__/lib/source-input.test.ts` (new, small): `sourceInputSchema` accepts the three kinds, rejects an unknown `kind` and an extra key; `prepareInput` still throws its existing messages for the `other` email mismatch (these become `invalid` tool errors in §4.5).

### 4.4 Commit 4: dependencies, env and auth
- `npm install --save-exact mcp-handler@2.3.1 @modelcontextprotocol/server@2.4.0` [C2]. Exact pins because `mcp-handler` changed its options API inside the 2.x line and 2.3.1 is a day old. Record the versions in the ledger. Confirm in `node_modules/mcp-handler/dist/index.js` that nothing at module scope touches the network or `process.env` (§1.4 says it does not; `scripts/no-network.mjs` would fail the build otherwise).
- `server/config/env.ts`: `mcpSchema` with `MCP_API_SECRET` in exactly the `adminSchema` shape (`:130-133`, empty means unset, min 32), `export type McpEnv`, `export const getMcpEnv = memoized("mcp", mcpSchema)` [C32].
- `app/api/admin/_auth.ts`: `unauthorized(request, realm: "admin" | "mcp" = "admin")`. Reads the `authorization` header first, then picks `getAdminEnv().ADMIN_API_SECRET` or `getMcpEnv().MCP_API_SECRET`, keeps `safeEqualHex` and the fail-closed `!secret` branch, logs `{ action: \`${realm}_unauthorized\`, path, configured }` [C7, C10, C14]. Existing callers unchanged; `__tests__/api/admin-memories.test.ts` stays green.

### 4.5 Commit 5: the route and the tools
- `app/api/mcp/route.ts` (new) [C1, C6, C8]:
  ```ts
  export const maxDuration = 30;
  // Module scope: built once per instance. registerTools itself runs once per request (see §1.4), so it stays pure.
  const handler = createMcpHandler(registerTools, { serverInfo: { name: "jowray", version: "1" }, maxSubscriptions: 0 });
  async function gated(request: NextRequest): Promise<Response> {
    const denied = unauthorized(request, "mcp"); // reads request.headers before any env or Prisma access
    if (denied) return denied;
    return handler(request);
  }
  export { gated as GET, gated as POST };
  ```
  No `dynamic`, `runtime` or `revalidate` export [C8]. Header read first because a `GET` Route Handler is prerendered under Cache Components [C9, C32]. Our own gate, not `withMcpAuth`, because that answers with an RFC 9728 challenge that would steer Claude into an OAuth discovery with no authorization server behind it [C5, C14]. The plain `401` carries no `WWW-Authenticate` header, so Claude shows a connection error, not a sign-in prompt [C14]; §5.1 verifies.
- `app/api/mcp/tools.ts` (new). Structure:
  - `registerTools(server)`: first `wrapMcpServerWithSentry(server)` [C45], then eight `server.registerTool(name, { title, description, inputSchema, annotations }, handler)` calls [C4]. Schemas are imported module-scope constants; nothing is constructed inside this function (§1.4).
  - `toolResult(data, isError = false)` returns `{ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, ...(isError && { isError: true }) }` [C19].
  - `runTool(tool, memoryId, fn)`: the single error boundary. `try { return toolResult(...) } catch (error) { const eventId = Sentry.captureException(error, { tags: { tool, ...tagIds({ memoryId }) }, mechanism: { type: "mcp.tool", handled: true } }); log.error({ action: "mcp_tool_failed", tool, memoryId, eventId }, "MCP tool threw"); return toolResult({ code: "internal", eventId }, true); }`. The SDK would otherwise return the raw message to the model [C43]; because we catch first, Sentry's wrapper never sees a throw and the exception is reported exactly once [C46]. `tagIds` is `lib/sentry/user.ts`.
  - Every feature `ok: false` becomes `toolResult({ code, ...extra }, true)` [C18]. Never include `claimToken`, `claimTokenHash`, `blobUrl` or `storageKey` [C20, C33].

  **Complete result contract** (the test in §4.6 asserts every row):

  | Tool | Calls | `ok` payload | `isError` codes and extra fields | Annotations [C22] |
  |---|---|---|---|---|
  | `list_memories` | `listMemoriesForAdmin({ status, q, deleted: deleted ? "true" : undefined }, { includeCoordinates: true })` and `adminStatusCounts()` | `{ query, rows, shown, total, counts }` | `invalid` | `readOnlyHint: true` |
  | `get_memory` | `getMemoryForAdmin(memoryId, { includeCoordinates: true })` | the view | `not_found` | `readOnlyHint: true` |
  | `draft_memory` | `prepareInput(args)` then `draftMemory(prepared)` | `{ memoryId, claimLink, originalNoteRecorded }` | `invalid { message }` (also for any `prepareInput` throw, caught and mapped before the boundary); `duplicate { memoryId, status }`; `budget_exceeded` | `destructiveHint: false, idempotentHint: true` |
  | `set_coordinates` | `setMemoryCoordinatesAsAdmin` | `{ changed, memoryVersion }` (R3) | `invalid`; `not_found`; `stale { current: { memoryVersion, coordinates } }` | `destructiveHint: true, idempotentHint: true` |
  | `update_memory` | `updateMemoryAsAdmin` | `{ written, current }` | `invalid`; `not_found`; `last_words`; `stale { current }` | `destructiveHint: true` |
  | `set_status` | `setMemoryStatusAsAdmin` | `{}` | `invalid`; `not_found`; `draft` | `destructiveHint: true, idempotentHint: true` |
  | `set_deleted` | `setMemoryDeletedAsAdmin` | `{ purgedFiles }` | `invalid`; `not_found` | `destructiveHint: true, idempotentHint: true` |
  | `reissue_claim_link` | `reissueDraftClaimLink` | `{ memoryId, claimLink }` | `invalid`; `not_found`; `not_draft` | `destructiveHint: true, idempotentHint: false` |
  | all | | | `internal { eventId }` from the boundary | |

  **Descriptions, written for the model.** `draft_memory`: "Pass `sourceInput`, never `sourceRef`. A `duplicate` error means nothing was saved. `coordinates` are for the named place (a town, facility or community campus, church, park, lake), never a residence or unit." `set_coordinates`: the same privacy sentence, plus "call `get_memory` first for `memoryVersion`; `null` clears both; `changed: false` means the pair was already equal", and (R3) that it returns the new `memoryVersion` to pass to a following `update_memory` or `set_coordinates`. `update_memory`: "read `memoryVersion` and `contributor.contributorVersion` from `get_memory` first. On `stale`, compare every editable field in `current` with the value you read before this edit: if any differs, including a field you are changing, show Rob what changed and ask before retrying; retry from `current` without asking only when none differs (only the versions moved)." (**Changed by the Team Code Review, O2:** the first rule retried silently when only a field being edited had moved, which overwrote a concurrent edit of that same field, for example the sender saving new words while Rob edits them.) `reissue_claim_link`: "revokes the link already sent; only on explicit confirmation."
- `lib/validations/mcp.ts` (new): `mcpListInputSchema = z.object({ status: z.enum(MEMORY_STATUSES).optional(), q: z.string().trim().max(100).optional(), deleted: z.boolean().optional() })` (all optional, still an object schema [C21]); `mcpDraftInputSchema = draftMemoryObjectSchema.omit({ source: true, sourceRef: true }).extend({ sourceInput: sourceInputSchema })` (the source↔prefix refines do not apply because the server derives both; `draftMemory` re-validates the prepared input with the full schema); re-exports of `adminMemoryIdSchema`, `adminMemoryChangesSchema`, `adminStatusSchema`, `adminDeletedSchema`, `adminCoordinatesSchema` [C4].
- Logging: `verboseLogs` off; the features already log ids; the adapter logs only `tool`, `memoryId`, `eventId` [C33]. **Changed by review round 1, R1:** the plan said "no `onEvent` logger", but mcp-handler drops every error the SDK reports through `onerror` unless `verboseLogs` or `onEvent` is set (`mcp-handler/dist/index.js` `emitError`). The route now passes a module-scope `onEvent` that ignores `REQUEST_RECEIVED`/`REQUEST_COMPLETED` (they carry request parameters) and sends each `ERROR` to Sentry once (`mechanism: { type: "mcp.handler", handled: true }`, level from `severity`, tag `mcp_source`), then logs `{ action: "mcp_handler_error", source, severity, eventId }` with no message text. A rethrown Error is not reported twice: `@sentry/core` `Client.captureException` marks it `__sentry_captured__` and skips it on the second call (`build/cjs/client.js`, `utils/misc.js` `checkOrSetAlreadyCaught`).

### 4.6 Commit 6: tests for the route
- `__tests__/api/mcp.test.ts` (new), modelled on `__tests__/api/admin-memories.test.ts:1-29` [C38]: mock the six feature modules; `process.env.MCP_API_SECRET = "a".repeat(40)` and `resetEnvCache()` in `beforeEach`; `NextRequest` with `content-type: application/json` and `accept: application/json, text/event-stream`; JSON-RPC bodies in the shape of the Claude docs' curl example [C15]; a helper that parses the body by `content-type` (JSON, or the first `data:` line of SSE) [C3]. Cases:
  1. no header, wrong bearer, unset secret, empty secret: transport `401`, no feature called.
  2. `tools/list`: eight tools; `expect(tools).toMatchInlineSnapshot()` over names, annotations and `inputSchema` JSON, so the model-facing contract (`isoDate` description, `sourceInput` union, nullable `coordinates`) is reviewed in the diff [C49].
  3. every row of the §4.5 table: success payload and each `isError` code with its extra fields, in both `structuredContent` and parsed `content[0].text`.
  4. a feature mock that throws `new Error("ECONNREFUSED /var/task/node_modules/@prisma/client")`: `200`, `isError: true`, `code: "internal"`, an `eventId` string, and the body contains neither `/var/task` nor `ECONNREFUSED`.
  5. `draft_memory` with `source` + `sourceRef`: `200` with `isError: true` from the schema (not a 400) [C43]; `draft_memory` with `kind: "other"` and a mismatched email: `isError` with `code: "invalid"` and the `prepareInput` message.
  6. no response body ever contains `claimToken`.
  7. one modern-era fixture: `MCP-Protocol-Version: 2026-07-28` plus the headers the SDK's `validateStandardRequestHeaders` demands, `tools/list`, expect `200` and eight tools; derive the exact requirements from `node_modules/@modelcontextprotocol/server/dist/index.mjs` (`serveModern`) rather than guessing. Record in the ledger which era each real client used (§5.3).
- `__tests__/lib/sentry-envelope.test.ts`: add a case that builds an `McpServer`, calls `registerTools` on it (which wraps it), connects an in-memory transport, runs a `tools/call` whose mocked `draft_memory` returns `claimLink: "https://preview.test/m/SENTRYTEST_…"`, flushes, then asserts at least one envelope contains an MCP span (`mcp.tool.name` or the `op`) and no envelope contains `SENTRYTEST_` [C27, C45, C40]. This exercises `scrubSpan` on `span.attributes` (`lib/sentry/scrub.ts:339-341`), which is where `mcp.tool.result.content` lands. Keep the existing `setSDKProcessingMetadata` case too for the request-body carrier. No scrubber change is expected; the test proves it.

### 4.7 Commit 7: docs and skill
- `docs/environment.md`: new `MCP_API_SECRET` row, wording copied from the `ADMIN_PAGE_SECRET` row [C36]: bearer secret for `/api/mcp`; 32+ characters; 401 to everything when unset or empty; **Production only, never Preview**; `openssl rand -hex 32`; `vercel env add MCP_API_SECRET production`, then redeploy [C28]; rotation = generate, replace, redeploy, then remove and re-add the connector [C17]; if Anthropic withdraws the request-headers beta, the laptop script path is the fallback. Connector recipe: URL `https://www.jowray.com/api/mcp` (the apex 308s to www and a cross-origin redirect drops `Authorization`), **No sign-in**, Request header `authorization` = `Bearer <secret>` with the scheme [C16]. It is the organisation's credential [C11]. After any re-add, re-apply the per-tool approval setting for the six tools that write (the five destructive ones and `draft_memory`; Team Code Review, G1).
- `docs/skills/jowray-draft-memory/SKILL.md` [C41, C12]: Prerequisites become "the jowray connector's tools (`list_memories`, `get_memory`, `draft_memory`, `set_coordinates`, `reissue_claim_link`), or as fallback the local checkout and `.env`". Preflight: with the connector present, skip the git check. Step 2: after "where", propose coordinates for the named place with the source phrase; a community or facility campus such as Broadmead is a place, a residence or unit inside it never is. Step 2b: a `Coordinates` question (proposed value / Leave blank). Step 3: call `draft_memory` with the same JSON plus `coordinates` only when Rob chose a value; read `originalNoteRecorded`; the script command stays as fallback. New sentence under the 409 branch: "A lost response after `draft_memory` committed (timeout, dead session) shows up as `duplicate` with no link on retry; the existing recovery applies: check Gmail, then `reissue_claim_link` on Rob's yes, which is safe because the link was never sent." 409 branch reads the row with `get_memory(memoryId)` instead of sending Rob to `/admin`; Gmail checks unchanged; reissue only on an explicit yes. `update_memory` stale rule as in §4.5. Keep under 500 lines.
- `README.md`: if the feature table lists the admin API, add the MCP endpoint in the same style; otherwise no change.

## 5. Investigations folded into the build (answers go in the ledger)
1. **Wrong header in Claude.** With a scratch connector and a wrong header, confirm a connection error, not a sign-in prompt [C14]. Also `curl -si https://www.jowray.com/.well-known/oauth-protected-resource/api/mcp` and the un-suffixed path: both must stay `404`; a future catch-all route would break "No sign-in".
2. **Build.** `build:offline` passes; the gate reads headers first [C9, C32]; `mcp-handler` opens no socket at import.
3. **Protocol generation.** `tools/list` and `tools/call` from a claude.ai connector and from `claude mcp add --transport http jowray https://www.jowray.com/api/mcp --header "Authorization: Bearer …"` [C30, C3]. Record which era each used (the SDK logs nothing; read it from the test fixture that matches, or add a one-line debug log behind `verboseLogs` only locally).
4. **Tool approval.** **Six** tools require approval under Customize > Connectors: the five destructive ones (`set_coordinates`, `update_memory`, `set_status`, `set_deleted`, `reissue_claim_link`) and `draft_memory` (Team Code Review, G1: its non-destructive annotations stay, but it writes and returns a live claim link, and the read tools bring visitor text into the same session); confirm the prompt before each; repeat after any connector re-add.
5. **Sentry integration list.** After `npm ci`, check whether `mcpServerIntegration` is in `@sentry/node`'s `getTracingIntegrations()`; note the answer. The explicit wrap is idempotent either way.
6. **Revision count.** Stripping happens after `take: 25`, so the admin History may show fewer than 25 rows for a memory with many coordinate edits. Accepted; see §8.3.

## 6. Verification

### 6.1 Automated
`npm run validate`, `npm run test:run`, `npm run build:offline` with no `.env*` and `DATABASE_URL` unset. `__tests__/integration/memory-coordinates.test.ts` runs when `TEST_DATABASE_URL` is set (CI always; locally against a Neon dev branch or a Docker Postgres 18 after `prisma migrate deploy`). `__tests__/scripts/draft-memory.test.ts` green with unchanged assertions.

### 6.2 Local end-to-end (the only pre-merge environment; never Preview)
1. Create a Neon branch off `dev` through the Neon connector (as the 2026-11-03 plans did), write its pooled and unpooled URLs into the worktree's `.env.local` only, run `npx prisma migrate deploy`. Delete the branch after the ledger row is done.
2. `MCP_API_SECRET=<throwaway 64 hex> npm run dev` (the value lives only in the shell).
3. `claude mcp add --transport http jowray-local http://localhost:3000/api/mcp --header "Authorization: Bearer <throwaway>"` [C30]. Then: `tools/list` shows eight tools; `list_memories`; `draft_memory` with a test `sourceInput` of kind `other` and `coordinates: { latitude: 39.4815, longitude: -76.6447 }`; `get_memory` returns them; `set_coordinates` with a stale `memoryVersion` returns `stale`, with the fresh one and `null` clears both; `update_memory`, `set_status`, `set_deleted` and restore; `reissue_claim_link` on the test draft; a second `draft_memory` with the same `sourceInput` returns `duplicate` with `memoryId` and `status`.
4. `curl -si http://localhost:3000/api/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` without a header is `401`; with a wrong bearer `401`; with the right one `200`.
5. Open the test memory on `/admin` (throwaway `ADMIN_PAGE_SECRET` on the dev process) and confirm the page shows no `latitude`, `longitude` or `coordinates`, in the row or the History. The unit test in §4.2 is the real proof; this is a spot check.

### 6.3 Production, after merge and Rob's env step (STOP points apply)
1. The `curl` trio from 6.2.4 against `https://www.jowray.com/api/mcp`. The secret is never removed from Production to test the unset case; the unit tests cover it.
2. Rob adds the connector (§4.7 recipe) and sets approval on the six tools (§5.4). From the phone: "list the draft memories" returns the list.
3. One smoke draft, agreed with Rob first: `draft_memory` with `kind: "other"`, contributor email a family address, note `MCP smoke test 2026-11-06, delete me`, visibility `PRIVATE`, coordinates for Broadmead's campus. Record the `memoryId` in the ledger. `get_memory` shows the coordinates. Then `set_deleted` and confirm on `/admin` that it is deleted. Never leave it live.
4. The wrong-header and well-known checks from §5.1.

### 6.4 Skill micro-tests (with the connector tools mocked, or against 6.2)
1. Connector present, new Gmail note: `draft_memory` called once; the reply carries the real link.
2. Connector absent: the script path with the git preflight.
3. 409 duplicate: `get_memory` read, Gmail checked, no reissue without an explicit yes.
4. Lost response after a commit: retry returns `duplicate`; the skill checks Gmail, finds no link, offers reissue, proceeds only on yes.
5. Place "Broadmead, Cockeysville": campus coordinates proposed with the phrase; "Leave blank" sends no `coordinates`.
6. Place is a street address or "her apartment at Broadmead": no coordinates proposed; the skill says why.
7. `update_memory` returns `stale` with a field Rob did not touch changed: the skill stops and asks.

## 7. Rollback
The migration is expand-only, so rolling back the code leaves two unused nullable columns and three CHECKs that every row satisfies. Removing the route removes the attack surface. Removing `MCP_API_SECRET` from Production and redeploying makes the route answer 401 without a code change [C28]. If the request-headers beta disappears, the laptop script path still works.

## 8. Follow-ups (out of scope for this PR; paste into the PR description; file as issues after merge)
| # | Item | Severity | What the next agent needs |
|---|---|---|---|
| 8.1 | **Vercel WAF rate-limit rule on `/api/mcp`.** Owner Rob. | medium | Dashboard: Firewall → custom rule, condition path equals `/api/mcp`, action Rate Limit, Fixed Window 60 s, 60 requests, key IP, start in **Log** mode for a week, then switch to the default 429 [C29]. Check the project's Vercel plan tier first (Hobby allows one rule). Verify with a 70-request `curl` loop that expects 429s at the end. Satisfies the MCP spec's "Rate limit tool invocations" [C20]. |
| 8.2 | **OAuth (CIMD) per-person sign-in** if the request-headers beta is withdrawn or more admins join. | low | `withMcpAuth` + `protectedResourceHandler` from `mcp-handler` [C5]; an authorization server is the real cost; the laptop script remains the interim fallback. |
| 8.3 | **Admin History shows fewer than 25 rows** when coordinate-only revisions are stripped after `take: 25`. | low | Exclude coordinate-only revisions in the Prisma query (JSON path filter on `before`/`after` keys) or over-fetch and trim; one test in `__tests__/features/admin-memories.test.ts`. |
| 8.4 | **Per-media coordinates.** `Media` rows have `place` but no coordinates. | low | Same column pair, pair and range CHECKs, and an MCP tool; wait until the map exists. |
| 8.5 | **Retire `scripts/draft-memory.ts`** once the connector has carried real traffic for a few weeks. | low | Remove the script, its test and the SKILL fallback; keep `lib/source-input.ts`. |
| 8.6 | **Future map must emit GeoJSON `[longitude, latitude]`** and choose its own display precision. | note | [C26]; nothing to build now. |

## 9. Not doing (reviewed and declined, 2026-11-06)

- **Origin-header allow-list on `/api/mcp`.** The reviewer proposed validating the `Origin` header with `originValidationResponse`. That function is not exported by `mcp-handler` 2.3.1; it lives in `@modelcontextprotocol/server` and exists to stop DNS-rebinding attacks on localhost servers, which cannot reach a public endpoint that refuses every request without `Authorization: Bearer`, a header browsers cannot attach cross-origin [C50]. Anthropic's connector backend sends an undocumented `Origin` value, so an allow-list of `www.jowray.com` could lock out the connector itself. Revisit if the endpoint ever accepts cookie or no-auth requests.
- **Turning off Sentry MCP output recording.** The reviewer proposed `dataCollection.mcp: { outputs: false }` so tool results stay out of Sentry. Rob's 2026-11-04 ruling in `lib/sentry/data-collection.ts` authorises 100 % telemetry, and `genAI: { inputs: true, outputs: true }` is on deliberately for the same reason. The guard against leaks is scrubbing, which `scrubSpan` in `lib/sentry/scrub.ts` applies to `span.attributes` and `__tests__/lib/sentry-envelope.test.ts` proves against the real SDK, not switching telemetry off.
- **Rounding coordinates server-side to four decimal places.** Rounding to 4 dp still identifies a home to about 11 m, so it does not make a private address safe, while it discards precision a facility pin may legitimately want. Display precision is a decision for the future map, not for what the store keeps. The real guard is the tool description plus the skill asking Rob before saving, with the rule "coordinates of the named place, never a residence or unit".
- **Clearing coordinates when `place` changes.** The reviewer proposed nulling `latitude` and `longitude` whenever `place` is edited. Rob decided on 2026-11-06 to leave them alone, and `features/memories/claim.ts` and `features/admin/update-memory.ts` are critical write paths that this plan does not touch. `get_memory` returns `place`, `coordinates` and the revision history together, so a mismatch is detectable later rather than silently erased now.
- **Four parallel build lanes with stubs and rebases.** One builder working through the commits in order in a single worktree, plus a separate review subagent, replaces it: the shared `sourceInput` move is about 70 lines and the critical path is sequential anyway, so parallel lanes would add coordination without saving time.
- **`withMcpAuth` from `mcp-handler` and OAuth metadata routes.** `withMcpAuth` answers 401 with an RFC 9728 `WWW-Authenticate` challenge pointing at protected-resource metadata, which only makes sense with an authorization server behind it [C5]. We have none, so the challenge would steer Claude into a sign-in flow that cannot succeed. The connector is configured with a static header and "No sign-in". Revisit if per-person identity is ever wanted (§8.2).
- **Reusing `ADMIN_API_SECRET` for the MCP endpoint.** Rob rejected sharing it: rotating one value would break both the laptop script and the connector at once, and connector headers cannot be edited in place, only removed and re-added [C17]. The rotation runbook in `docs/environment.md` stays specific to each secret.
- **Accepting a hand-built `source` + `sourceRef` replay form in `draft_memory`.** The laptop script accepts a payload that already carries `source` and `sourceRef` as a replay of an earlier run. The MCP tool accepts only `sourceInput` and derives `sourceRef` on the server with the code moved from `scripts/draft-memory.ts` into `lib/source-input.ts`, honouring the comment at `scripts/draft-memory.ts:106-111` that the skill never reproduces the hashing by hand [C35]. Letting a model supply its own hash would defeat that rule.
- **Restricting `/api/mcp` to Anthropic's egress range 160.79.104.0/21.** An IP allow-list on the route would also block Claude Code on Rob's Mac, which connects to the endpoint directly rather than through Anthropic's backend [C13]. The bearer secret is the access control for both callers.
- **Code-level rate limiting inside the route.** The reviewer proposed an in-memory token bucket or a Postgres request counter. Vercel functions are stateless, so an in-memory limiter forgets its state between invocations, and a Postgres counter adds a write per request on a family-only endpoint. The agreed path is a Vercel WAF rule configured in the dashboard (§8.1).
- **Two PRs (coordinates first, then MCP).** Rob chose one PR with ordered commits on 2026-11-06.

### Reviewer claims that were checked and found not to apply
- **"`draftMemory` returns an `issues` array."** It does not. On invalid input it returns `{ ok: false, code: "invalid", message }` with the first zod issue's message (`features/memories/draft-memory.ts:54`), and the tool passes that shape through unchanged.
- **"Sentry wraps `McpServer` at build time in the Next.js SDK."** `@sentry/nextjs` 11.10.0 contains no reference to the MCP package. MCP spans exist only when the app calls `wrapMcpServerWithSentry` itself, which §4.5 does in the tools module [C45].
- **"`optionalText` parses twice incorrectly."** `optionalText` wraps its transform in `.nullable().optional()` (`lib/validations/admin.ts:8-15`), so re-parsing a `null` succeeds; `draftMemory` re-validating a prepared input is safe. No change.

## 10. Review disposition (friend's round of 2026-11-06, every item checked against source)

| # | Finding | Bucket | Where |
|---|---|---|---|
| 1 / 11 | Tool exceptions become raw 200 `isError` text; nothing reaches Sentry | **1 Must** (confirmed in SDK source) | §1.4, §4.5 boundary, §4.6 case 4 |
| 2 / 12 | Envelope test misses the span carrier | **1 Must** (test); `outputs: false` → **3** | §4.6 Sentry case; §9 |
| 3 | `maxSubscriptions`, per-request `registerTools`, Origin | **1** (note + `maxSubscriptions: 0`); Origin → **3** | §1.4, §4.5; §9 |
| 4 / 14 | Unpinned `^2`; schema rejections are 200 | **1 Must** | §4.4, §4.6 case 5 |
| 5 / 20 | `isoDate` has no format hint; `tools/list` not asserted | **1 Must** | §4.2, §4.6 case 2 |
| 6 | Lane B/C handoff; `prepareInput` throws; schema location | **1 Must** | §4.3 (`sourceInputSchema` in `lib/source-input.ts`), §4.5 |
| 7 | Incomplete result-code table; `set_coordinates` unchanged case | **1 Must** | §4.5 table, `{ changed }` |
| 8 | Migration generation needs a database; duplicate timestamp prefix | **1 Must** | §4.1 hand-named folder, `prisma generate` |
| 9 | Well-known 404 check; beta withdrawal fallback | **2 Nice** (done) | §5.1, §4.7, §7 |
| 10 | Revision stripping ("both" already); rounding | stripping fine; rounding → **3** | §4.2; §9 |
| 13 | Origin validation | **3 Don't** | §9 |
| 15 | Modern protocol never exercised | **2 Nice** (done) | §4.6 case 7, §5.3 |
| 16 | Blind retry on `stale` | **2 Nice** (done) | §4.5 description, §6.4 test 7 |
| 17 | "Four" destructive tools; there are five | **1 Must** | §5.4, §4.7 |
| 18 | Rate limit deferred without a durable follow-up | **4 Follow-up** | §8.1 |
| 19 | CHECK test can pass without proving the range | **1 Must** | §4.2 integration test |
| 21 | Manual check removes the production secret | **1 Must** (step removed) | §6.3 |
| 22 | Lost response after commit | **2 Nice** (done) | §4.7 sentence, §6.4 test 4 |
| 23 / 24 | Handoff depends on this session; branch missing; two ledgers | **1 Must** | §0, §3 Owner column, §4.0 |
| 25 | Skill never reaches claude.ai surfaces | **1 Must** (ledger row, Rob) | §3 |
| 26 | Verification environments ambiguous; test draft left in production | **1 Must** | §6.2, §6.3 |
| 27 | Four lanes buy little | **1 Must** (single builder) | §2, §9 |
| 28 | Broadmead is a retirement community | **2 Nice** (rule clarified; decision 4) | §4.7, §6.4 tests 5-6 |

---

## Citations

Live pages were fetched on 2026-11-06. Repository citations are at commit `95f4df4`. Package-source citations are from the published npm tarballs unpacked on 2026-11-06 (`mcp-handler` 2.3.1, `@modelcontextprotocol/server` 2.4.0, `@sentry/core` 11.10.0). The Next.js quotes come from nextjs.org; re-verify against `node_modules/next/dist/docs/` after `npm ci` (§0.2).

### [C1] — mcp-handler mounts as a Next.js Route Handler

- **Relevant File(s):** `app/api/mcp/route.ts`
- **Change Summary:** The route exports the handler returned by `createMcpHandler` as `GET` and `POST`, behind the bearer gate.
- **Source URL:** https://github.com/vercel-labs/mcp-handler#framework-compatibility and https://github.com/vercel-labs/mcp-handler#quick-start-nextjs
- **Verbatim Quote:**
  > "`createMcpHandler` returns a Web-standard request handler, so the package is not tied to Vercel or any particular framework. It can be mounted in: - Next.js Route Handlers" and, from the Quick Start, "`export { handler as GET, handler as POST };`" and "`/api/mcp` is a convention, not a required path. `mcp-handler` does not inspect the request pathname, so you can place this handler at any framework route and give clients that route's complete URL."
- **Justification:** The handler is a plain `(Request) => Promise<Response>`, so the gate can run before it and `maxDuration` applies as on the admin routes.

### [C2] — mcp-handler 2.x dependency set

- **Relevant File(s):** `package.json`, `package-lock.json`
- **Change Summary:** Add `mcp-handler` 2.3.1 and `@modelcontextprotocol/server` 2.4.0, pinned exactly; no `@modelcontextprotocol/sdk`, no Redis.
- **Source URL:** https://github.com/vercel-labs/mcp-handler#installation
- **Verbatim Quote:**
  > "`npm install mcp-handler@^2 @modelcontextprotocol/server@^2 zod@^4`" and "**Note**: `mcp-handler` 2.x requires the MCP SDK v2 packages (`@modelcontextprotocol/server` ^2.0.0), zod ^4.2.0, and Node.js 20+. If you're on `@modelcontextprotocol/sdk` 1.x, use `mcp-handler` 1.x."
- **Justification:** The repo already has `zod ^4.6.7`, `next 16.4.4` and Node 20+. The README's caret ranges are replaced by exact pins because the options API changed inside 2.x (README "Migrating from 1.x" and the 2.1 changelog) and 2.3.1 is a day old.

### [C3] — Protocol generations served from one stateless handler

- **Relevant File(s):** `app/api/mcp/route.ts`, `__tests__/api/mcp.test.ts`
- **Change Summary:** One route serves both protocol generations; tests parse JSON or SSE by content type and include one modern-era fixture.
- **Source URL:** https://github.com/vercel-labs/mcp-handler#protocol-support
- **Verbatim Quote:**
  > "**2026-07-28** (current): served natively — stateless, no sessions, per-request `_meta` envelope, `server/discover`." and "**2025-era Streamable HTTP**: served via the SDK's stateless legacy fallback from the same handler. GET/DELETE session operations answer `405` (serving is stateless)."
- **Justification:** Stateless serving fits Vercel functions; the two real clients may negotiate different generations against the same route (§5.3).

### [C4] — 2.x registration API and full-schema inputs

- **Relevant File(s):** `app/api/mcp/tools.ts`, `lib/validations/mcp.ts`
- **Change Summary:** Tools are registered with `registerTool` and full `z.object` input schemas; `createMcpHandler` takes one options object.
- **Source URL:** https://github.com/vercel-labs/mcp-handler#migrating-from-1x
- **Verbatim Quote:**
  > "`inputSchema`/`argsSchema` take a full Standard Schema (e.g. `z.object({ ... })`) instead of a raw zod shape." and "Variadic `server.tool(...)` / `.prompt(...)` / `.resource(...)` are removed — use `registerTool` / `registerPrompt` / `registerResource`." and "`createMcpHandler(initialize, serverOptions, config)` is now `createMcpHandler(initialize, options)` — one options object combining the SDK's server options with `serverInfo`, `verboseLogs`, and `onEvent`."
- **Justification:** The repo's exported `z.object` schemas pass straight through; `serverInfo` and `maxSubscriptions` go in the single options object; `verboseLogs` stays off.

### [C5] — Why `withMcpAuth` is not used

- **Relevant File(s):** `app/api/mcp/route.ts`
- **Change Summary:** The route uses its own plain-401 gate instead of the package's OAuth-flavoured helper.
- **Source URL:** https://github.com/vercel-labs/mcp-handler#authorization-cimd-era
- **Verbatim Quote:**
  > "`withMcpAuth` verifies bearer tokens and answers `401`/`403` with RFC 9728-compliant `WWW-Authenticate` challenges pointing at your protected resource metadata."
- **Justification:** A challenge pointing at protected-resource metadata would send Claude into an OAuth discovery with no authorization server behind it; the static-credential connector needs a bare 401 (see [C14]).

### [C6] — Route Handler contract and supported methods

- **Relevant File(s):** `app/api/mcp/route.ts`
- **Change Summary:** New `route.ts` exporting `GET` and `POST`.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/route#http-methods
- **Verbatim Quote:**
  > "Route Handlers allow you to create custom request handlers for a given route using the Web Request and Response APIs." and "A **route** file allows you to create custom request handlers for a given route. The following HTTP methods are supported: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`."
- **Justification:** The mcp-handler function takes and returns Web `Request`/`Response`, exactly the Route Handler contract.

### [C7] — Reading headers from `NextRequest`

- **Relevant File(s):** `app/api/admin/_auth.ts`, `app/api/mcp/route.ts`
- **Change Summary:** The gate reads `request.headers.get("authorization")` before anything else.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/route#headers
- **Verbatim Quote:**
  > "The `request` object is a NextRequest object, which is an extension of the Web Request API." and "You can also use the underlying Web APIs to read headers from the request (`NextRequest`): … `const requestHeaders = new Headers(request.headers)`"
- **Justification:** The existing `unauthorized()` already reads the header this way; adding a `realm` keeps that first read in place.

### [C8] — Segment config under Cache Components; `maxDuration`

- **Relevant File(s):** `app/api/mcp/route.ts`
- **Change Summary:** Export only `maxDuration = 30`; never `dynamic`, `runtime`, `revalidate` or `fetchCache`.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#version-history
- **Verbatim Quote:**
  > "`v16.0.0` | `dynamic`, `dynamicParams`, `revalidate`, and `fetchCache` removed when Cache Components is enabled." and, from the options table, "`maxDuration` | `number` | Set by deployment platform" and "`runtime` | `'nodejs' | 'edge' (deprecated)`"
- **Justification:** The repo runs `cacheComponents: true`, so the removed options must not be exported; `maxDuration` remains valid.

### [C9] — `GET` Route Handlers are prerendered; headers are a runtime API

- **Relevant File(s):** `app/api/mcp/route.ts`
- **Change Summary:** The header read happens before any env or Prisma access.
- **Source URL:** https://nextjs.org/docs/app/getting-started/caching#enabling-cache-components and https://nextjs.org/docs/app/getting-started/caching#working-with-runtime-apis
- **Verbatim Quote:**
  > "When Cache Components is enabled, `GET` Route Handlers follow the same prerendering model as pages." and "Runtime APIs require information that is only available when a user makes a request. These include: … `headers` - Request headers"
- **Justification:** Without the early header read, a build-time prerender of `GET /api/mcp` would reach env parsing or the Neon driver with no database.

### [C10] — Static credential rules for connectors

- **Relevant File(s):** `app/api/admin/_auth.ts`, `app/api/mcp/route.ts`
- **Change Summary:** The secret is read only from the `authorization` header, never from the URL.
- **Source URL:** https://claude.com/docs/connectors/building/authentication#static-credentials-in-request-headers
- **Verbatim Quote:**
  > "**Read the credential from a request header**: standard authentication header names such as `authorization`, `x-api-key`, and `x-auth-token` work for every connector." and "**Never accept it in the URL**: don't read tokens from query parameters such as `?token=` or `?apiKey=`. URLs end up in server logs, proxies, and browser history"
- **Justification:** `authorization` needs no Anthropic approval and is what `unauthorized()` already reads.

### [C11] — The secret is the organisation's credential; the beta Request headers section

- **Relevant File(s):** `server/config/env.ts`, `docs/environment.md`
- **Change Summary:** `MCP_API_SECRET` is one shared secret; the docs tell Owners what to enter.
- **Source URL:** https://claude.com/docs/connectors/building/authentication#static-credentials-in-request-headers
- **Verbatim Quote:**
  > "**Treat it as the organization's credential, not a person's**: every member's requests carry the same key, so don't use it to identify which user is calling." and "This type is in beta and available to a limited set of organizations. Owners whose organization doesn't have access don't see the **Request headers** section when they add a connector."
- **Justification:** Revisions keep `changedVia: "ADMIN"` with no person attached; the beta status is why §7 and §8.2 name a fallback.

### [C12] — One connector serves every Claude surface

- **Relevant File(s):** `docs/skills/jowray-draft-memory/SKILL.md`
- **Change Summary:** The skill's primary path becomes the connector, with the script as fallback.
- **Source URL:** https://claude.com/docs/connectors/building/authentication
- **Verbatim Quote:**
  > "The same authentication infrastructure backs claude.ai, Claude Desktop, Claude mobile, Claude Code, and Cowork, so the requirements here apply to all of them."
- **Justification:** One configuration serves web, phone, desktop and cloud sessions, which is the point of the change.

### [C13] — Anthropic's egress range (rate-limit option not chosen)

- **Relevant File(s):** none (decision record, §1 decision 2, §9)
- **Change Summary:** IP restriction was rejected because it would block Claude Code on the Mac.
- **Source URL:** https://claude.com/docs/connectors/building/authentication#network-reference
- **Verbatim Quote:**
  > "Anthropic's outbound traffic to your server originates from `160.79.104.0/21`."
- **Justification:** Records the allowlist that option would have needed, and why it was not taken.

### [C14] — The 401 must come from the HTTP handler, before the SDK

- **Relevant File(s):** `app/api/mcp/route.ts`
- **Change Summary:** The bearer check runs in the Route Handler and returns before the SDK handler is invoked; no `WWW-Authenticate` header is sent.
- **Source URL:** https://claude.com/docs/connectors/building/lazy-authentication#answer-a-protected-call-with-401-before-the-mcp-sdk-runs
- **Verbatim Quote:**
  > "Claude starts sign-in only when the HTTP request itself fails with `401 Unauthorized` and a `WWW-Authenticate` header. A tool handler can't produce that response: once the MCP SDK is running a tool, whatever the handler returns is wrapped in a `200`. The check has to run in your HTTP handler, on the parsed JSON-RPC body, before the request reaches the SDK."
- **Justification:** A bad secret must be a transport-level 401; omitting `WWW-Authenticate` keeps Claude from offering an OAuth flow that cannot succeed (§5.1 verifies).

### [C15] — Transport 401 versus `isError` 200; the test body shape

- **Relevant File(s):** `__tests__/api/mcp.test.ts`
- **Change Summary:** Tests assert a transport `401` for a bad secret and use the documented JSON-RPC `tools/call` body.
- **Source URL:** https://claude.com/docs/connectors/building/lazy-authentication#test-the-lazy-auth-path
- **Verbatim Quote:**
  > "A `200` with `isError: true` is an application-level tool failure. Claude passes the error text to the model as the tool result and moves on, and there is no auth prompt." and "`-d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_products","arguments":{}}}'`" and "If you see `200` with `isError: true` instead, your server is returning a tool error rather than failing the HTTP request."
- **Justification:** Gives the request shape for the tests and the distinction they assert: auth failures are HTTP 401, business failures are `isError: true`.

### [C16] — Connector configuration: No sign-in, header entered with its scheme

- **Relevant File(s):** `docs/environment.md`
- **Change Summary:** The docs give the exact connector recipe.
- **Source URL:** https://claude.com/docs/connectors/custom/add-unlisted#choose-authentication-settings and https://claude.com/docs/connectors/custom/add-unlisted#authenticate-with-request-headers
- **Verbatim Quote:**
  > "**No sign-in**: anyone with access to the server URL can use the connector. If the server uses an API key, choose **No sign-in** and add the key under **Request headers**. Claude stores the key as the connector's credential" and "Claude sends the value exactly as you enter it. It doesn't add an authentication scheme or any other prefix. For an `Authorization` header, include the scheme in the value, as this table shows."
- **Justification:** Entering `Bearer <secret>` matches `safeEqualHex(authorization, \`Bearer ${secret}\`)` byte for byte.

### [C17] — Rotation means removing and re-adding the connector

- **Relevant File(s):** `docs/environment.md`
- **Change Summary:** The rotation procedure ends with remove-and-re-add; a reason `MCP_API_SECRET` is separate from `ADMIN_API_SECRET`.
- **Source URL:** https://claude.com/docs/connectors/custom/add-unlisted#edit-or-remove-a-connector
- **Verbatim Quote:**
  > "You can't change authentication settings after you add a connector. That covers OAuth credentials and request headers. To change them, remove the connector and add it again with the new details. Members then need to reconnect."
- **Justification:** Rotating the admin secret must not force a connector rebuild; after a re-add the per-tool approvals must be set again (§4.7).

### [C18] — Business outcomes are tool execution errors

- **Relevant File(s):** `app/api/mcp/tools.ts`
- **Change Summary:** Every feature `ok: false` becomes `isError: true` with its `code` and extra fields.
- **Source URL:** https://modelcontextprotocol.io/specification/2025-11-25/server/tools#error-handling
- **Verbatim Quote:**
  > "**Tool Execution Errors**: Reported in tool results with `isError: true`: - API failures - Input validation errors (e.g., date in wrong format, value out of range) - Business logic errors" and "**Tool Execution Errors** contain actionable feedback that language models can use to self-correct and retry with adjusted parameters."
- **Justification:** `duplicate`, `stale`, `not_draft`, `last_words`, `budget_exceeded` and `internal` are outcomes the skill acts on.

### [C19] — Structured content plus serialized text

- **Relevant File(s):** `app/api/mcp/tools.ts`
- **Change Summary:** Each result carries `structuredContent` and the same JSON in a text block.
- **Source URL:** https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content
- **Verbatim Quote:**
  > "**Structured** content is returned as a JSON object in the `structuredContent` field of a result. For backwards compatibility, a tool that returns structured content SHOULD also return the serialized JSON in a TextContent block."
- **Justification:** Both shapes are produced, which is why the Sentry test covers a claim link in both ([C27], [C45]).

### [C20] — Server security obligations

- **Relevant File(s):** `app/api/mcp/tools.ts`, `app/api/mcp/route.ts`
- **Change Summary:** Input validation via zod, access control via the bearer gate, output sanitising by the boundary and by never returning tokens; rate limiting deferred to §8.1.
- **Source URL:** https://modelcontextprotocol.io/specification/2025-11-25/server/tools#security-considerations
- **Verbatim Quote:**
  > "Servers **MUST**: - Validate all tool inputs - Implement proper access controls - Rate limit tool invocations - Sanitize tool outputs"
- **Justification:** Maps each obligation to a concrete part of the design; the rate-limit line is why §8.1 is a tracked follow-up.

### [C21] — `inputSchema` must be a JSON Schema object even with no parameters

- **Relevant File(s):** `lib/validations/mcp.ts`
- **Change Summary:** `list_memories` gets an all-optional `z.object`, never `undefined`.
- **Source URL:** https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool
- **Verbatim Quote:**
  > "`inputSchema`: JSON Schema defining expected parameters … **MUST** be a valid JSON Schema object (not `null`) - For tools with no parameters, use one of these valid approaches: - `{ "type": "object", "additionalProperties": false }` - **Recommended**: explicitly accepts only empty objects - `{ "type": "object" }` - accepts any object (including with properties)"
- **Justification:** Guarantees every tool advertises an object schema.

### [C22] — Tool annotations are hints

- **Relevant File(s):** `app/api/mcp/tools.ts`
- **Change Summary:** Reads are `readOnlyHint: true`; mutations are `destructiveHint: true`, with `idempotentHint` where a repeat is a no-op.
- **Source URL:** https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2025-11-25/schema.ts (interface `ToolAnnotations`)
- **Verbatim Quote:**
  > "If true, the tool does not modify its environment." (`readOnlyHint`) and "If true, the tool may perform destructive updates to its environment. If false, the tool performs only additive updates." (`destructiveHint`) and "If true, calling the tool repeatedly with the same arguments will have no additional effect on its environment." (`idempotentHint`)
- **Justification:** Sets each tool's annotations from the definitions; because they are hints, Rob also sets per-tool approval in Claude (§5.4).

### [C23] — Prisma `Float` maps to `double precision`

- **Relevant File(s):** `prisma/schema.prisma`
- **Change Summary:** `latitude Float?` and `longitude Float?` on `Memory`.
- **Source URL:** https://www.prisma.io/docs/orm/reference/prisma-schema-reference#float
- **Verbatim Quote:**
  > "Floating point number." and "| PostgreSQL | double precision |"
- **Justification:** The schema type and the hand-written migration SQL (`DOUBLE PRECISION`) agree.

### [C24] — CHECK constraints go in a customised migration

- **Relevant File(s):** `prisma/migrations/20261106120000_memory_coordinates/migration.sql`
- **Change Summary:** The migration SQL is written by hand, as `20261104070100_consent_check` was.
- **Source URL:** https://www.prisma.io/docs/orm/prisma-migrate/workflows/unsupported-database-features#customize-a-migration-to-include-an-unsupported-feature
- **Verbatim Quote:**
  > "However, some database features cannot be represented in the Prisma schema" and "To add an unsupported feature to your database, you must customize a migration to include that feature before you apply it." and "`--create-only` flag to generate a new migration without applying it"
- **Justification:** Prisma's schema has no CHECK syntax; whether the folder is generated with `--create-only` or named by hand, the SQL is the same and is hand-reviewed.

### [C25] — Null satisfies a CHECK; the pair check always evaluates

- **Relevant File(s):** `prisma/migrations/20261106120000_memory_coordinates/migration.sql`, `__tests__/integration/memory-coordinates.test.ts`
- **Change Summary:** Range checks need no `IS NULL OR`; existing rows pass; a half pair is refused.
- **Source URL:** https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-CHECK-CONSTRAINTS
- **Verbatim Quote:**
  > "A check constraint is the most generic constraint type. It allows you to specify that the value in a certain column must satisfy a Boolean (truth-value) expression." and "It should be noted that a check constraint is satisfied if the check expression evaluates to true or the null value."
- **Justification:** `"latitude" BETWEEN -90 AND 90` is null for rows with no coordinates and passes; `("latitude" IS NULL) = ("longitude" IS NULL)` is never null. This is also why the integration test starts each range case from a complete pair: with a null partner, the pair check would fire first and mask a missing range check.

### [C26] — WGS 84 decimal degrees; GeoJSON order is `[longitude, latitude]`

- **Relevant File(s):** `lib/validations/memory.ts`, `app/api/mcp/tools.ts`
- **Change Summary:** Named `latitude`/`longitude` fields in decimal degrees with range validation; the future map must emit `[lon, lat]`.
- **Source URL:** https://www.rfc-editor.org/rfc/rfc7946#section-4 and https://www.rfc-editor.org/rfc/rfc7946#section-3.1.1
- **Verbatim Quote:**
  > "The coordinate reference system for all GeoJSON coordinates is a geographic coordinate reference system, using the World Geodetic System 1984 (WGS 84) [WGS84] datum, with longitude and latitude units of decimal degrees." and "The first two elements are longitude and latitude, or easting and northing, precisely in that order and using decimal numbers."
- **Justification:** Storing WGS 84 decimal degrees means no conversion later; named fields avoid the lat/lon swap.

### [C27] — Scrub in `beforeSend*` hooks so sensitive data never leaves

- **Relevant File(s):** `__tests__/lib/sentry-envelope.test.ts`, `lib/sentry/scrub.ts` (verify only)
- **Change Summary:** New envelope cases prove a claim link inside an MCP tool result is scrubbed from events and from span attributes.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/data-management/sensitive-data/#scrubbing-in-beforesend-sdk-hooks
- **Verbatim Quote:**
  > "SDKs provide various `beforeSend*` hooks, which are invoked before errors, messages, spans, logs, or metrics are sent and can be used to modify event data to remove sensitive information." and "We recommend using these hooks in the SDKs to **scrub any data before it is sent**, to ensure that sensitive data never leaves the local environment."
- **Justification:** The repo's scrubber is wired into exactly these hooks; the test runs the real SDK with them.

### [C28] — Production-only env var; redeploy to apply

- **Relevant File(s):** `docs/environment.md`
- **Change Summary:** `MCP_API_SECRET` is set for Production only and a redeploy follows every change.
- **Source URL:** https://vercel.com/docs/environment-variables
- **Verbatim Quote:**
  > "Production | When selected, the Environment Variable will be applied to your next Production Deployment." and "A change in the dashboard has no effect | Environment variable changes apply only to new deployments. The running deployment keeps the values it was built with. | Redeploy the project."
- **Justification:** Explains the `vercel env add MCP_API_SECRET production` step and why rotation and removal require a redeploy.

### [C29] — Vercel WAF rate limiting (follow-up §8.1)

- **Relevant File(s):** none in the repo
- **Change Summary:** A rate-limit rule on `/api/mcp` is added in the Firewall tab later, starting in Log mode.
- **Source URL:** https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting
- **Verbatim Quote:**
  > "Rate limiting allows you to control the number of times that a request from the same source can hit your application within a specific timeframe." and "For the Then action, select Rate Limit" and "The Log action will not perform any blocks. You can use it to first monitor the effect before applying a rate limit or block action."
- **Justification:** Records how to satisfy the MCP rate-limit obligation ([C20]) without touching the repo.

### [C30] — Claude Code connects with `claude mcp add --transport http` and a header

- **Relevant File(s):** none (verification §5.3, §6.2)
- **Change Summary:** The second client used to confirm both protocol generations, and the local end-to-end client.
- **Source URL:** https://code.claude.com/docs/en/mcp
- **Verbatim Quote:**
  > "`claude mcp add --transport http <name> <url>`" and "`# Example with Bearer token` `claude mcp add --transport http secure-api https://api.example.com/mcp \ --header "Authorization: Bearer your-token"`"
- **Justification:** Gives the exact command for the laptop-side and local checks.

### [C31] — Layering rule: `app/` imports `lib/`, never `scripts/`

- **Relevant File(s):** `lib/source-input.ts`, `scripts/draft-memory.ts`, `app/api/mcp/tools.ts`
- **Change Summary:** The `sourceInput` derivation and its schema move to `lib/`.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/95f4df4c42280952688048c16f1195a9c3e1685b/AGENTS.md?plain=1#L37
- **Verbatim Quote:**
  > "`app/ → features/ → services/ → integrations/`. A layer imports only from layers below it plus `lib/` and `server/`. Nothing imports from `app/`."
- **Justification:** `app/api/mcp/tools.ts` may import `lib/`; one canonical derivation serves both the script and the tool.

### [C32] — Cache Components rule: headers first, lazy env

- **Relevant File(s):** `app/api/mcp/route.ts`, `server/config/env.ts`
- **Change Summary:** The gate reads `request.headers` first; `getMcpEnv()` is a lazy `memoized` accessor.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/95f4df4c42280952688048c16f1195a9c3e1685b/AGENTS.md?plain=1#L46-L52
- **Verbatim Quote:**
  > "Never export `dynamic`, `runtime`, `revalidate` or `fetchCache` from a route file." and "a `GET` handler reads `request.headers` or `request.nextUrl` first. Only then touch Prisma or env." and "Never construct a `PrismaClient` or parse env at module scope. Use `getDb()` and the lazy `getXEnv()` accessors in `server/config/env.ts`, each of which parses on first call."
- **Justification:** Keeps `build:offline` passing with no database and no `.env`.

### [C33] — Claim links are forbidden in telemetry and logs

- **Relevant File(s):** `app/api/mcp/tools.ts`, `__tests__/lib/sentry-envelope.test.ts`
- **Change Summary:** Results never carry `claimToken`; the adapter logs only ids; the Sentry test re-proves the scrubber for this route.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/95f4df4c42280952688048c16f1195a9c3e1685b/AGENTS.md?plain=1#L57
- **Verbatim Quote:**
  > "Still forbidden everywhere: claim tokens in any form (`/m/<token>`, `?t=`, `claimToken(s)`, `claimLink`), upload tickets (`ticket`, `clientPayload`, `sig`) and the values of `cookie`, `authorization`, `x-vercel-protection-bypass`, `x-vercel-signature`."
- **Justification:** Two tools return claim links in response bodies, so the guarantee must hold for the new serializer and for MCP span attributes.

### [C34] — Feature shape to copy: lock, re-read, revision

- **Relevant File(s):** `features/admin/set-coordinates.ts`
- **Change Summary:** The new feature takes the lock and revision pattern from `set-status.ts` and the stale check from `update-memory.ts`.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/95f4df4c42280952688048c16f1195a9c3e1685b/features/memories/lock.ts#L15-L17 and https://github.com/RobertdWray/jowray_com/blob/95f4df4c42280952688048c16f1195a9c3e1685b/features/admin/set-status.ts
- **Verbatim Quote:**
  > "export async function lockMemory(tx: Tx, memoryId: string): Promise<void> { await tx.$queryRaw`SELECT "id" FROM "Memory" WHERE "id" = ${memoryId} FOR UPDATE`; }" and, from `set-status.ts`, "await lockMemory(tx, memoryId); const fresh = await tx.memory.findUnique({ where: { id: memoryId }, select: { status: true, deletedAt: true, consentVersion: true } }); if (!fresh || fresh.deletedAt !== null) { return "not_found" as const; }" and "await appendRevision(tx, { memoryId, changedVia: "ADMIN", before: { status: fresh.status }, after: { status }, consentVersion: fresh.consentVersion });"
- **Justification:** The MCP layer must not reimplement locking or revisions.

### [C35] — The script's promise that `sourceRef` is never hand-built

- **Relevant File(s):** `lib/source-input.ts`, `app/api/mcp/tools.ts`
- **Change Summary:** `draft_memory` accepts only `sourceInput` and derives `sourceRef` server-side with the moved code.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/95f4df4c42280952688048c16f1195a9c3e1685b/scripts/draft-memory.ts#L106-L111
- **Verbatim Quote:**
  > "Where the words came from, in the input JSON. The script turns this into `source` + `sourceRef` through the canonical builders in lib/source-ref.ts, so the skill never reproduces the hashing by hand."
- **Justification:** Moving `sourceFor`/`prepareInput` keeps that promise for the connector path.

### [C36] — Wording for a Production-only secret

- **Relevant File(s):** `docs/environment.md`
- **Change Summary:** The `MCP_API_SECRET` row copies the `ADMIN_PAGE_SECRET` row's Preview rule.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/95f4df4c42280952688048c16f1195a9c3e1685b/docs/environment.md?plain=1#L92
- **Verbatim Quote:**
  > "Separate from `ADMIN_API_SECRET` so each rotates on its own. Production + local `.env` (same value in both); **never Preview** (Preview deploys read a copy of production rows). Generate with `openssl rand -hex 32`."
- **Justification:** The new secret has the same exposure and the same rotation independence.

### [C37] — The admin History renders every revision key

- **Relevant File(s):** `features/admin/get-memory.ts`
- **Change Summary:** `coordinates` keys are stripped from revision snapshots in the feature, by default.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/95f4df4c42280952688048c16f1195a9c3e1685b/app/admin/format.ts#L40-L51
- **Verbatim Quote:**
  > "/** The keys a revision touched: everything in `before` or `after`, in a stable order. */ export function changedKeys(before: unknown, after: unknown): string[] {"
- **Justification:** `app/admin/history.tsx` renders whatever `changedKeys` returns, so stripping in the feature keeps the component unchanged.

### [C38] — Route test pattern to copy

- **Relevant File(s):** `__tests__/api/mcp.test.ts`
- **Change Summary:** The new test mocks features, sets and resets the secret, and builds `NextRequest`s like the admin route test.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/95f4df4c42280952688048c16f1195a9c3e1685b/__tests__/api/admin-memories.test.ts#L1-L29
- **Verbatim Quote:**
  > "const SECRET = "a".repeat(40);" and "beforeEach(() => { process.env.ADMIN_API_SECRET = SECRET; resetEnvCache(); draftMock.mockClear(); reissueMock.mockClear(); });"
- **Justification:** The same setup with `MCP_API_SECRET` exercises the real `_auth.ts` and env code.

### [C39] — Every Vercel build runs the migrations

- **Relevant File(s):** `prisma/migrations/20261106120000_memory_coordinates/migration.sql`
- **Change Summary:** The migration must be expand-only because it runs on Preview and Production builds alike.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/95f4df4c42280952688048c16f1195a9c3e1685b/vercel.json
- **Verbatim Quote:**
  > ""buildCommand": "npx prisma migrate deploy && npx prisma db seed && npm run build""
- **Justification:** Nullable columns, CHECKs every row satisfies and no backfill keep the deployed code working during the deploy.

### [C40] — Existing path-based claim scrubbing

- **Relevant File(s):** `lib/sentry/scrub.ts` (verify only), `__tests__/lib/sentry-envelope.test.ts`
- **Change Summary:** The test's synthetic link uses the `/m/<token>` shape the scrubber already recognises.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/95f4df4c42280952688048c16f1195a9c3e1685b/lib/sentry/scrub.ts#L27-L29
- **Verbatim Quote:**
  > "// A claim path is `/m/` followed by a base64url token (16+ chars); the token // may be followed by anything (slash, query, whitespace in a log message). const CLAIM_PATH = /\/m\/[A-Za-z0-9_-]{16,}/g;"
- **Justification:** Both the key-based (`claimLink`) and path-based (`/m/…`) rules must fire on MCP bodies and span attributes.

### [C41] — The skill's laptop dependency being replaced

- **Relevant File(s):** `docs/skills/jowray-draft-memory/SKILL.md`
- **Change Summary:** Prerequisites and Preflight change from the local checkout to the connector tools, with the checkout as fallback.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/95f4df4c42280952688048c16f1195a9c3e1685b/docs/skills/jowray-draft-memory/SKILL.md?plain=1#L15-L16
- **Verbatim Quote:**
  > "- The repo at `/Users/rob/Documents/active_work/jowray_com` with `node_modules` installed (Node 20+)." and "- `/Users/rob/Documents/active_work/jowray_com/.env` holding `ADMIN_API_SECRET` (never print it). Real runs pass `--prod`; a local test sets `ADMIN_API_URL=http://localhost:3000` instead. There is no default target."
- **Justification:** These two lines are what failed on 2026-11-05 from a cloud session.

### [C42] — Lint already permits the new route's imports

- **Relevant File(s):** `eslint.config.mjs` (verify only), `app/api/mcp/tools.ts`
- **Change Summary:** No lint change; `app/api/**` may import `features/` and `lib/`.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/95f4df4c42280952688048c16f1195a9c3e1685b/eslint.config.mjs
- **Verbatim Quote:**
  > "Route handlers are the HTTP adapter layer: features/ and services/ are both fine there, integrations/ never"
- **Justification:** The new adapter files import nothing the rule forbids.

### [C43] — The SDK turns every tool exception into a 200 `isError` result

- **Relevant File(s):** `app/api/mcp/tools.ts` (`runTool` boundary), `__tests__/api/mcp.test.ts` (cases 4 and 5)
- **Change Summary:** Our boundary catches first, reports to Sentry and returns `{ code: "internal", eventId }`; tests assert schema rejections are 200 `isError`, not 400.
- **Source URL:** https://www.npmjs.com/package/@modelcontextprotocol/server/v/2.4.0, file `dist/mcp-oHn3ureC.mjs` lines 1604-1616 (unpacked 2026-11-06)
- **Verbatim Quote:**
  > "try { const args = await this.validateToolInput(tool, request.params.arguments, request.params.name); const result = await this.executeToolHandler(tool, args, ctx); await this.validateToolOutput(tool, result, request.params.name); … } catch (error) { if (error instanceof ProtocolError && error.code === ProtocolErrorCode.UrlElicitationRequired) throw error; return this.createToolError(error instanceof Error ? error.message : String(error)); }"
- **Justification:** Without our boundary, a Prisma or Neon error message, including file paths, would be handed to the model verbatim and never reach Sentry or the route.

### [C44] — mcp-handler constructs the server and runs `initializeServer` inside the per-request factory

- **Relevant File(s):** `app/api/mcp/tools.ts`, `app/api/mcp/route.ts`
- **Change Summary:** `registerTools` stays pure; schemas and the handler are module-scope.
- **Source URL:** https://www.npmjs.com/package/mcp-handler/v/2.3.1, file `dist/index.js` lines 197-207 (unpacked 2026-11-06)
- **Verbatim Quote:**
  > "const sdkHandler = server.createMcpHandler( async () => { const server$1 = new server.McpServer(serverInfo, mcpServerOptions); await initializeServer(server$1); return server$1; }, { legacy: "stateless", onerror: emitError, maxSubscriptions } );"
- **Justification:** The factory is invoked by the SDK for each request ([C51]), so anything inside `registerTools` runs per request; env reads or schema construction there would be a hidden per-request cost and a Cache Components hazard.

### [C45] — Sentry's MCP wrapper records tool result text into span attributes when outputs are recorded

- **Relevant File(s):** `app/api/mcp/tools.ts`, `__tests__/lib/sentry-envelope.test.ts`
- **Change Summary:** `wrapMcpServerWithSentry(server)` is called explicitly; the envelope test asserts an MCP span exists and carries no `SENTRYTEST_` token.
- **Source URL:** https://www.npmjs.com/package/@sentry/core/v/11.10.0, files `build/cjs/integrations/mcp-server/transport.js` lines 24-27 and `resultExtraction.js` lines 32-35 (unpacked 2026-11-06)
- **Verbatim Quote:**
  > "recordOutputs: options.recordOutputs ?? userMcp?.outputs ?? genAI?.outputs ?? true" and "if (typeof item.text === "string") { const attrName = single ? attributes.MCP_TOOL_RESULT_CONTENT : attributes.MCP_TOOL_RESULT_KEY_CONTENT.replace("<key>", index); attributes$1[attrName] = item.text; }"
- **Justification:** With `genAI.outputs: true` in `lib/sentry/data-collection.ts`, the serialized tool result (which can contain a `claimLink`) lands in a span attribute; `scrubSpan` scrubs `span.attributes`, and the test proves it on the real SDK. `@sentry/nextjs` 11.10.0 does not wrap `McpServer` on its own, so the wrap is explicit.

### [C46] — Sentry's MCP wrapper captures an exception only when the handler throws

- **Relevant File(s):** `app/api/mcp/tools.ts`
- **Change Summary:** Because `runTool` catches first, our `Sentry.captureException` is the single report; no double capture.
- **Source URL:** https://www.npmjs.com/package/@sentry/core/v/11.10.0, file `build/cjs/integrations/mcp-server/handlers.js` lines 42-46 (unpacked 2026-11-06)
- **Verbatim Quote:**
  > "errorCapture.captureError(error, "validation", extraData);" … "errorCapture.captureError(error, "timeout", extraData);" … "errorCapture.captureError(error, "tool_execution", extraData);"
- **Justification:** These calls sit in the wrapper's catch path for a thrown handler. A handler that returns an `isError` result does not throw, so only our boundary reports, with the `tool` tag and `memoryId`.

### [C47] — Postgres reports a CHECK failure as SQLSTATE 23514

- **Relevant File(s):** `__tests__/integration/memory-coordinates.test.ts`
- **Change Summary:** The integration test asserts code `23514` and the constraint name for each of the three constraints.
- **Source URL:** https://www.postgresql.org/docs/current/errcodes-appendix.html
- **Verbatim Quote:**
  > "Class 23 — Integrity Constraint Violation" … "23514 | check_violation"
- **Justification:** All three CHECKs share this code, which is why the test also asserts the constraint name; otherwise a missing range check would be masked by the pair check ([C25]).

### [C48] — zod `.describe()` attaches a description that JSON Schema conversion carries

- **Relevant File(s):** `lib/validations/admin.ts` (`isoDate`), `lib/source-input.ts` (`sourceInputSchema`)
- **Change Summary:** Version timestamps and `sourceInput` fields get descriptions so the model sees the expected format in `tools/list`.
- **Source URL:** https://zod.dev/metadata
- **Verbatim Quote:**
  > "The `.describe()` method is a shorthand for registering a schema in `z.globalRegistry` with just a `description` field." and "The `.describe()` method remains available, but `.meta()` is the recommended approach."
- **Justification:** `memoryVersion` and `contributorVersion` would otherwise appear as bare `{ "type": "string" }` in the tool schema; the description tells the model to pass the value exactly as `get_memory` returned it. `.describe()` is used because the repo's existing schemas use plain zod chains and a single description is all that is needed.

### [C49] — Vitest inline snapshots for the `tools/list` contract

- **Relevant File(s):** `__tests__/api/mcp.test.ts` (case 2)
- **Change Summary:** The eight tools' names, annotations and input schemas are pinned with `toMatchInlineSnapshot`, so any contract change shows in the PR diff.
- **Source URL:** https://vitest.dev/guide/snapshot
- **Verbatim Quote:**
  > "Similarly, you can use the toMatchInlineSnapshot() to store the snapshot inline within the test file." and "Or you can use the --update or -u flag in the CLI to make Vitest update snapshots."
- **Justification:** The model-facing schema is the API of this feature; an inline snapshot makes reviewers read it and makes accidental changes fail the build.

### [C50] — `originValidationResponse` lives in the SDK, for localhost DNS-rebinding protection

- **Relevant File(s):** none (§9 record)
- **Change Summary:** Not used; the proposal named a function `mcp-handler` does not export.
- **Source URL:** https://www.npmjs.com/package/@modelcontextprotocol/server/v/2.4.0, file `dist/index.mjs` lines 1082-1088 and 1441 (unpacked 2026-11-06)
- **Verbatim Quote:**
  > "import { hostHeaderValidationResponse, originValidationResponse, localhostAllowedHostnames, localhostAllowedOrigins } from '@modelcontextprotocol/server';" … "originValidationResponse(request, localhostAllowedOrigins());" and "function originValidationResponse(req, allowedOriginHostnames) {"
- **Justification:** The helper's own example pairs it with `localhostAllowedOrigins()`; it addresses browsers reaching a local server, not a bearer-gated public endpoint.

### [C51] — The legacy stateless path is per request and answers `GET` with 405

- **Relevant File(s):** `app/api/mcp/route.ts`, `__tests__/api/mcp.test.ts`
- **Change Summary:** `GET` is exported for completeness and gated; the factory runs per request.
- **Source URL:** https://www.npmjs.com/package/@modelcontextprotocol/server/v/2.4.0, file `dist/index.mjs`, function `createLegacyStatelessFallback` (unpacked 2026-11-06)
- **Verbatim Quote:**
  > "if (request.method.toUpperCase() !== "POST") return jsonRpcErrorResponse(405, -32e3, "Method not allowed."); try { const product = await factory({ era: "legacy", ...options?.authInfo !== void 0 && { authInfo: options.authInfo }, requestInfo: request }); const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: void 0, …"
- **Justification:** Confirms both the per-request factory call and that an unauthenticated `GET` never reaches the SDK (the gate answers first) while an authenticated one gets the SDK's 405.

### [C52] — `maxSubscriptions` semantics

- **Relevant File(s):** `app/api/mcp/route.ts`
- **Change Summary:** `maxSubscriptions: 0` refuses `subscriptions/listen`, which this tools-only server never needs.
- **Source URL:** https://www.npmjs.com/package/@modelcontextprotocol/server/v/2.4.0, file `dist/listenRouter-Bartj63y.mjs` lines 164-169 (unpacked 2026-11-06)
- **Verbatim Quote:**
  > "const maxSubscriptions = options.maxSubscriptions ?? DEFAULT_MAX_SUBSCRIPTIONS;" … "if (open.size >= maxSubscriptions) { onerror?.(new Error(`subscriptions/listen refused: subscription limit reached (${maxSubscriptions})`));"
- **Justification:** With no subscribable resources, an open SSE listen would only hold a Vercel function until `maxDuration`; refusing it costs nothing.