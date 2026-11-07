# MCP: attach photos and videos, read video location, share drafts on the sender's behalf

| | |
|---|---|
| Plan revision | **v2**, 2026-11-06. v1 (same file, earlier the same day) is superseded; v2 folds in the builder check and the external review (§ Review triage) |
| Approval state | **v2, approved 2026-11-06** (Rob: "Execute … plan"). Rulings R1–R7 approved by Rob in session; calls D1–D14 are the planner's and stand unless Rob vetoes. Rob, 2026-11-06 at S0.1: file Appendix A verbatim (names as written); start from the latest `main` on GitHub; the agent creates the Neon E2E branch (S0.4) through the Neon CLI or connector; Rob does the Cowork check (S0.3) and the iPhone clip (S0.5) later |
| Canonical copy | After approval, S0.1 commits this file to the repo as `docs/plans/2026-11-06-mcp-attach-media.md` in the new worktree W1, branch `mcp-attach/pr1`, **before** the Astra run starts, so the plan rides in PR 1 and every worker can read it. From then on the repo copy is canonical for design and rulings, and this file stays the live Ledger (§0.9) |
| Repo | `RobertdWray/jowray_com` (derive `--repo` from `git remote -v`), main checkout `/Users/rob/Documents/active_work/jowray_com` |
| Baseline | Planned at `origin/main` = `84f7d60` (PR #68). **Moved at S0.2 to `f909f7b`** (PR #69 merged: feature docs, `docs/features/mcp.md` rewritten; no code change). Citations stay pinned to `84f7d60` |

## 0. Cold start (read this first; a new agent or a compacted session starts here)

1. **Read, in order:** this plan's § Ledger (what is done, evidence, next action) → § Rulings → `AGENTS.md` (project rules; it overrides defaults) [C5] → `docs/code-layout.md` → `docs/features/mcp.md` → `docs/skills/jowray-draft-memory/SKILL.md`.
2. **Reconcile reality before trusting the Ledger.** A ✅ is not authority to skip. For every step marked done, re-check its evidence:
   - the branch head SHA (`git ls-remote origin <branch>`);
   - `gh pr view <n> --json state,mergeCommit,headRefOid`;
   - the production deploy (`gh api repos/RobertdWray/jowray_com/deployments --jq '.[0].sha'`);
   - the migration (`_prisma_migrations`, read with the read-back script);
   - the files under `docs/plans/evidence/2026-11-mcp-attach/`.

   Record any drift as a new Ledger row before continuing.
3. **Runtime.** CI uses Node 26 [C29]; the shell's default `node` is nvm v22. Prefix every command with `export PATH=/opt/homebrew/bin:$PATH` (gives `node` v26.13.0, plus `ffmpeg` and `exiftool`).
4. **Never work in the main checkout** (other agents share it).
   - **One new source worktree, W1:** `/Users/rob/Documents/active_work/jowray_wt_mcp_attach`. Create it with `git -C /Users/rob/Documents/active_work/jowray_com fetch origin && git -C /Users/rob/Documents/active_work/jowray_com worktree add -b mcp-attach/pr1 /Users/rob/Documents/active_work/jowray_wt_mcp_attach origin/main`, then run `npm ci` inside it. The main checkout's `node_modules` lacks the MCP packages.
   - **Before each later PR,** W1 starts a fresh local branch from the new `origin/main`: `git -C W1 switch -c mcp-attach/pr2 origin/main`.
   - **Astra makes its own worktrees.** Each run's integration branch and per-task worktrees live outside the repo, under `~/.local/state/astra-work/<repo-hash>/<run>/`. Its PR branch is `astra-work/<run>/integration`.
   - **Recovery key:** the run directory, recorded in the Ledger. Resume with `/astra-work resume <run-dir>`.
5. **Checks** (no `.env*`, `DATABASE_URL` unset) [C5]: `npm run validate`, `npm run test:run`, `npm run build:offline`.
6. **Secrets and environment.**
   - The main checkout's `.env` holds `BLOB_READ_WRITE_TOKEN`, `MCP_API_SECRET`, the SendGrid key, `OUTBOUND_*` and `ADMIN_ALERT_EMAILS`.
   - `.env.local` holds only `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and `VERCEL_OIDC_TOKEN`.
   - Never copy either file into a worktree. Never print a value, a claim link or a presigned URL.
   - Never run a `vercel` CLI command: it overwrites `.env.local`.
   - The process environment beats `.env` files [C26], which is how § Environment manifest switches outbound email off.
7. **Don'ts** [C5]:
   - no force-push;
   - no `eslint-disable` without Rob's all-caps "YES";
   - no band-aids;
   - no destructive Neon or Blob action without Rob's OK;
   - every change goes on a branch with a PR (the `main` ruleset requires `ci`).
8. **Coordination.** Open PR #69 (astra-work) rewrites `docs/features/mcp.md`. If it merges first, rebase the docs hunks; they are docs-only conflicts.
9. **After every step,** update the Ledger row: status, head SHA, PR URL, Astra run directory, evidence path, next action.
   - **Live copy:** this file, `/Users/rob/.claude-work/plans/pasted-content-id-08a8-severity-medium-gleaming-anchor.md`. It is always writable and outside the repo.
   - **Snapshots:** it is copied into the repo's `docs/plans/2026-11-06-mcp-attach-media.md` with each foundation commit (§3) and in the final docs PR.
   - **Which copy wins:** the repo copy for design and rulings, this file for ledger status.
10. **Astra rules** (skill `astra-work`; memory "astra-launch-command-alone"):
    - workers have no network, so after `prepare` the orchestrator runs `npm ci` in each task worktree;
    - at most **two** workers at once;
    - one owner per file;
    - the background `astra_work.py run/check` command is **alone** in its Bash call: `attach` reads the first output line;
    - integration suites (`__tests__/integration/*`) run only in CI (`TEST_DATABASE_URL`). Locally they count as "not run", not as a pass.

## 1. Context

On 2026-11-06 Claude drafted 18 memories from Tracy's 21 iPhone files (16 photos HEIC/JPG, 5 MOVs, two of them Live Photo clips) through the jowray connector.
- Every draft came back `type: "TEXT"`, `media: []`. None of the nine MCP tools accepts a file (Appendix A, the issue verbatim).
- `suggest_places` reads GPS only from photos [C35], and the site reads no location from videos at all.
- Rob also asked (mid-session) to share drafts on the sender's behalf and publish them. Today `set_status` refuses a DRAFT [C1].

**Outcome.** From a session that has the original files on disk (D14), Claude can:
1. attach HEIC/JPG/MOV files to any memory that hasn't been deleted, through the claim page's own pipeline, with no claim page opened;
2. get place names for photos **and videos**;
3. on Rob's instruction, move a DRAFT to PENDING or APPROVED with consent stamped on the sender's behalf. APPROVED publishes nothing public yet (R4a).

## 2. Rulings and calls

**Rob's rulings (2026-11-06, this session):**

| # | Ruling |
|---|---|
| R1 | Connector uploads accept **any memory not deleted** (DRAFT, PENDING, APPROVED, HIDDEN). One narrow exception is D7 |
| R2 | Video location (MOV/MP4) **in scope**, as PR 3 |
| R3 | **No** laptop script. Fallback: run the same tool steps from Claude Code on the Mac |
| R4 | New tool `share_draft`: approve a draft on the sender's behalf |
| R4a | "Publish" means status **APPROVED**. The admin page already says approving publishes nothing because the public memorial pages aren't built [C25]. Public pages are a follow-up (§ Follow-ups F1) |
| R5 | **No** admin alert for an on-behalf share, ever, including after later activity by the sender (made durable by D11) |
| R6 | Consent is recorded as a **stamp only**: the same `consentedAt` + `consentVersion` a Share press writes [C2], plus an ADMIN revision. No note, no new column |
| R7 | `share_draft` takes `status: "PENDING" \| "APPROVED"` per call |

**Planner's calls (Rob may veto any):**

| # | Call | Why / where |
|---|---|---|
| D1 | Upload via a presigned PUT URL (`issueSignedToken` + `presignUrl`); the shell uses plain `curl` | Documented for "a CLI or a server-to-server job", "safe to hand to a client" [C3]. Uses the existing read-write token, no new secret [C6]. Bytes never pass through a Function (4.5 MB body cap [C33]) |
| D2 | No HMAC ticket in the admin flow; `finalize_upload` takes `memoryId` + `mediaId` | The bearer `MCP_API_SECRET` already authenticates. The only credential the model sees is a single-path, write-once, 60-minute URL |
| D3 | An admin row reserves the declared size exactly (`maxBytes = size`) and must arrive at exactly that size | The CDN enforces the maximum [C3]; `recordMedia` enforces equality (D10). Limits as the claim page [C9] |
| D4 | File identity: `declaredSha256` (the session's claim) vs `checksumSha256` (server-computed, verified). A verified checksum always wins | See PR 2 § Identity and dedupe [C16, C38] |
| D5 | No `onUploadCompleted` callback | It would need a new `BLOB_WEBHOOK_PUBLIC_KEY` [C3]. Explicit finalize plus cron step (a) run the same completion path (D10) |
| D6 | A single PUT up to the 500 MB site limit | Multipart is a recommendation above 100 MB [C4]; follow-up F2 |
| D7 | No emails from admin uploads. An upload to a **non-DRAFT memory that is not yet "ready"** (no words, no READY file) is refused with `not_ready` | Otherwise that file would trigger the cron's first confirmation to the sender (which rotates their link) and the admin alert [C34] |
| D8 | `share_draft` leaves `contactOptIn` and `notifyWhenPosted` as they are; the claim link keeps working | An admin never opts someone into contact |
| D9 | `/api/mcp` keeps `maxDuration = 30`; `finalize_upload` works inside a 25 s budget | `after()` shares the route's duration [C19]; misses are backfilled by cron steps (g)/(h) |
| D10 | **One completion path** for every way an admin upload reaches READY (finalize, cron step (a)), keyed on a new `Media.addedVia = ADMIN`. Validation comes before READY, and READY plus the ADMIN revision commit in one transaction | `recordMedia` commits READY inside `transition()`, and the cron calls `recordMedia` directly [C16] |
| D11 | Durable alert suppression: a `SKIPPED` row with the terminal reason `admin_shared`, which `deliver()` and `claimableWhere` never reclaim. It is inserted inside the share transaction | `SKIPPED` is claimable today [C15]; every alert creator skips a DRAFT [C7] |
| D12 | Transaction ownership: only the top-level feature function opens a transaction. Helpers take `tx`. Lock order: lease → memory → budget. No network call while a lock is held | Existing lock order [C23]; Prisma transactions don't nest [C24] |
| D13 | Range reads for video: strict `Content-Range` contract and bounded work. Transient failures are retried; only a fully parsed "no location" is stamped as absent | `readPrefix` tolerates an ignored range, but a nonzero offset can't [C20, C21]; the GPS outcome semantics already exist [C22] |
| D14 | The supported route has the original files on disk: Cowork with the folder mounted, or Claude Code on the Mac. Files pasted into a claude.ai chat may be re-encoded or size-capped, so that route is not supported. S0.3 checks reachability from Cowork | Builder check Q1 |

## 3. Execution model: worktree, Astra workers, Fable reviewers

This follows Rob's plan-to-ship loop (`/Users/rob/Documents/active_work/TrayVerify/sales-mid-market-scoring/docs/workflows/orchestration.md`, "Plan-to-ship loop, simplified"), cut to what this work needs.

**Roles:**

| Role | Who | Does |
|---|---|---|
| Orchestrator | This Claude Code session (Opus 5.5) | Owns context and the Ledger. Runs every network step (spike, `npm ci`, E2E, `gh`), the deep-context **foundation** commits in W1, and every `inspect` → `accept` → `integrate` |
| Workers | `/astra-work` (GPT-6 Astra via Codex CLI, fixed by the skill; no network; at most 2 at once) | Independent tasks with literal owned paths, red tests first [C5] |
| Pre-acceptance reviewer | A Fable 5.1 subagent (Agent tool, `model: "fable"`), fresh for each task | Reads the task brief, `inspection.diff`, the new files and the plan sections and acceptance ids the brief names. Reports blocking findings with `file:line` |
| Citation refresh | A Fable 5.1 subagent, once per PR before `publish` | Re-fetches that PR's citations live and reports any quote that changed |
| PR review | `/team-code-review` (George + Oscar), chained by `astra-work` after `publish` | Findings → four buckets (a Fable 5.1 subagent drafts the sort, the orchestrator checks it against the source, **Rob confirms**) → selected fixes become fresh Astra repair tasks → the orchestrator inspects → TCR on the repair head. 1–3 cycles |
| Ship | Rob | Merges each PR |

**How Astra fits.** Astra starts each run from W1's **committed** HEAD (runner `init`). So each PR is built in this order:
1. **Foundation:** the orchestrator commits the deep-context work in W1, with tests green.
2. `init --repo /Users/rob/Documents/active_work/jowray_wt_mcp_attach --base-branch main`.
3. **Waves** of at most two Astra tasks. A dependent task is prepared only after its prerequisites integrate.
4. Combined checks.
5. **The orchestrator's E2E** against the integration worktree. Evidence goes in a PR comment now and is committed in the final docs PR.
6. `publish` (draft PR) → TCR → buckets → repairs → Rob merges.

PR 2 starts after PR 1 merges, and PR 3 after PR 2 merges, from the new `origin/main` each time. All three edit `app/api/mcp/tools.ts`, `docs/features/mcp.md` and `SKILL.md`, and PR 3 also edits the PR 2 storage files. Sequential runs mean no Astra base ever goes stale.

**Who does what** (Astra combined checks every time: `["npm","run","validate"]`, `["npm","run","test:run"]`, `["npm","run","build:offline"]`):

| PR | Step | Owner | Owned paths (literal) | Depends on | Task checks |
|---|---|---|---|---|---|
| 1 | F1 foundation: commit the plan (S0.1) | orchestrator | `docs/plans/2026-11-06-mcp-attach-media.md` | — | — |
| 1 | P1-A `share-draft` (§7) | Astra | `features/admin/share-draft.ts`, `services/email/index.ts`, `lib/validations/admin.ts`, `lib/validations/mcp.ts`, `app/api/mcp/tools.ts`, `__tests__/features/share-draft.test.ts`, the existing `deliver()` test file (the orchestrator finds its path before `prepare`), `__tests__/api/mcp.test.ts`, `__tests__/api/reconcile.test.ts`, `__tests__/features/ingest-upload.test.ts`, `__tests__/integration/share-draft.test.ts` | F1 | `npx vitest run` on those test files; `npm run validate` |
| 1 | P1-B `share-docs` (§7 docs) | Astra, parallel with P1-A | `docs/features/mcp.md`, `docs/skills/jowray-draft-memory/SKILL.md` | F1 | `npx prettier --check` if configured, else none. The orchestrator reads the consent wording line by line |
| 2 | F2 foundation (§8.1, §8.3): migration, shared completion path in `recordMedia`/`transition`, `computeChecksum` signal, cron (a) signal, cron (b) warning, tests A11–A16. Plus S0.3 spike results | orchestrator | `prisma/**`, `features/memories/ingest-upload.ts`, `features/memories/media-state.ts`, `app/api/cron/reconcile-uploads/route.ts`, matching tests, `scripts/e2e/mcp-attach/spike-presign.ts`, `docs/plans/evidence/2026-11-mcp-attach/s03-spike.md` | PR 1 merged | the three checks |
| 2 | P2-A1 `refactor-reservation` (§8.2; behaviour-preserving) | Astra wave 1 | `features/memories/create-memory.ts`, `features/memories/issue-upload-ticket.ts`, `features/memories/ingest-upload.ts` (only the `scheduleReadyFollowUps` extraction) | F2 | the existing `create-memory`, `issue-upload-ticket`, `ingest-upload`, `upload` and `budget-concurrency` suites, **unchanged** |
| 2 | P2-A2 `presign-put` (§8.6) | Astra wave 1 | `services/storage/types.ts`, `integrations/vercel-blob/index.ts`, `__tests__/integrations/vercel-blob.test.ts` | F2 | that test; `npm run validate` |
| 2 | P2-A3 `scrub-presigned` (§8.6) | Astra wave 2 | `lib/sentry/secrets.ts`, `lib/sentry/scrub.ts`, `lib/logger/logger.ts`, their tests | F2 | the scrub and logger tests |
| 2 | P2-A4 `e2e-harness` (§8.6) | Astra wave 2 | `scripts/e2e/mcp-attach/` (except the spike) | F2 | `npm run validate` |
| 2 | P2-A5 `attach-media` (§8.4, §8.5, tools) | Astra wave 3 | `features/admin/attach-media.ts`, `lib/validations/admin.ts`, `lib/validations/mcp.ts`, `app/api/mcp/tools.ts`, `__tests__/features/attach-media.test.ts`, `__tests__/integration/attach-media.test.ts`, `__tests__/api/mcp.test.ts`, `__tests__/lib/sentry-envelope.test.ts` | A1, A2, A3 integrated | those tests; `npm run validate` |
| 2 | P2-A6 `attach-docs` (§8.6 docs) | Astra wave 3 | `docs/features/mcp.md`, `docs/skills/jowray-draft-memory/SKILL.md` | F2 | — |
| 2 | E2E photo items (§11.2) | orchestrator | — | combined checks pass | the harness |
| 3 | F3 foundation: fixtures from Rob's clip (privacy-sensitive: local only until sanitized), the ffmpeg MP4, `scripts/fixtures/shrink-mdat.mjs`, `__tests__/fixtures/README.md` | orchestrator | those paths | PR 2 merged, S0.5 | exiftool readback |
| 3 | P3-A1 `video-gps-parser` (§9) | Astra wave 1 | `lib/video-gps.ts`, `__tests__/lib/video-gps.test.ts` | F3 | that test |
| 3 | P3-A2 `read-range` (§9) | Astra wave 1 | `services/storage/types.ts`, `integrations/vercel-blob/index.ts`, `__tests__/integrations/vercel-blob.test.ts` | F3 | that test |
| 3 | P3-A3 `video-gps-wiring` (§9) | Astra wave 2 | `lib/media-location.ts`, `features/media/extract-photo-gps.ts`, `features/places/suggest-for-memory.ts`, `features/memories/ingest-upload.ts`, `app/api/upload/route.ts`, `app/api/cron/reconcile-uploads/route.ts`, their tests | A1, A2 integrated | those tests |
| 3 | P3-A4 `video-docs` | Astra wave 2 | `docs/features/mcp.md`, `docs/skills/jowray-draft-memory/SKILL.md` | F3 | — |
| 3 | E2E video items (§11.2) | orchestrator | — | combined checks pass | the harness |

**Every Astra brief contains:**
- the plan section(s) and acceptance ids (§10) it implements;
- the citations [C#] those sections use;
- the literal owned paths;
- the rule that the worker reads `docs/plans/2026-11-06-mcp-attach-media.md` in its worktree (committed in F1);
- the conversation-only rules: no secrets; no `eslint-disable` without Rob's "YES"; no band-aids; red test first; never touch an unowned path.

Briefs carry no `.env` content and no URLs with credentials.

**Acceptance of every Astra task:**
1. Run `inspect`.
2. Get the Fable 5.1 subagent's review.
3. The orchestrator reads the diff and the new files, and runs `check --task`, launched alone.
4. Write the acceptance JSON, which addresses every flag and every Fable finding.
5. Run `accept`, then `integrate`.

A Fable finding that's rejected gets a one-line reason in the acceptance JSON.

**Ideas from the orchestration doc not used, and why:**
- **A second premortem (TCR) on plan v2.** The external review and the builder check already served as premortems. Rob can ask for one.
- **Issue-writer subagents for each repair bundle.** Repairs stay as Astra task briefs inside the run, and only Follow-ups (Bucket 4) become GitHub issues after merge.
- **More than two workers at once.** The skill requires Rob's explicit OK, and the waves above don't need it.

## 4. Ledger (evidence-bearing; update after every step)

Columns: step · owner · status · branch @ head SHA · Astra run directory · PR · evidence path · open decisions · next action.

| Step | Owner | Status | Branch @ SHA | Astra run dir | PR | Evidence | Open decisions | Next action |
|---|---|---|---|---|---|---|---|---|
| S0.1 F1: commit the canonical plan in W1; file the issues (Appendix A, B) | orchestrator | ✅ 2026-11-06 | `mcp-attach/pr1` @ F1 commit (see `git log`) | — | — | Appendix A → [#70](https://github.com/RobertdWray/jowray_com/issues/70) (`bug`, `severity:medium`, label created); Appendix B → [#71](https://github.com/RobertdWray/jowray_com/issues/71) (`enhancement`) | Rob OK'd the names verbatim | — |
| S0.2 W1 + `npm ci` + baseline checks | orchestrator | ✅ 2026-11-07 | W1 `/Users/rob/Documents/active_work/jowray_wt_mcp_attach` from `f909f7b` (upstream unset) | — | — | baseline `f909f7b`: validate ✅, test:run 86 files / 1653 tests ✅ (5 integration files skipped locally), build:offline ✅ | — | — |
| S0.3 presign spike + Cowork reachability | orchestrator + Rob (Cowork) | spike ✅ 2026-11-07; Cowork check open (Rob, later) | W1 untracked: `scripts/e2e/mcp-attach/spike-presign.ts`, `docs/plans/evidence/2026-11-mcp-attach/s03-spike.md` (commit in F2) | — | — | `s03-spike.md`: host `vercel.com`; `content-type` alone works; **plain `content-type` NOT enforced, `x-content-type` is (403)** → return both headers; write-once 400; oversize 403; curl -K ok; 0 blobs left | Cowork `curl -sI` before/after allowlist (Rob) | carry both files into PR 2 F2 |
| S0.4 Neon schema-only E2E branch | orchestrator (Rob, 2026-11-06: use the Neon CLI or MCP) | ✅ 2026-11-07: `mcp-attach-e2e-20261107` = `branch id kept out of the public repo` (endpoint `endpoint id kept out of the public repo`), from `dev`; Rob OK'd (2026-11-07) TRUNCATE of its data tables (RESTRICT, Memorial `jo-wray` kept); all migrations applied incl. `20261107000000_media_admin_upload` | — | — | — | connection details in a mode-600 scratchpad file, never in the repo | delete the branch after E2E: **Rob's OK needed** | E2E |
| S0.5 iPhone fixture clip (≈1 s, Location on) | Rob | ✅ waived 2026-11-07: Rob's clip had no location key; web search found no suitable clip; Rob: "I'm fine with a synthetic version. Let's just check this off." Synthetic ffmpeg/ExifTool fixtures instead | — | — | — | `__tests__/fixtures/README.md` | real-clip check moves to Rob's device pass | — |
| PR 1: init → P1-A ∥ P1-B (+ P1-C docs) → combined checks → citation refresh → publish → TCR → buckets → repairs → merge | orchestrator / Astra / Fable / Rob | ✅ **merged 2026-11-07 08:44Z as `59942b2`** (Rob's final-review process: one TCR round, buckets, repair `c8255ff`, Fable regression review NO SERIOUS REGRESSIONS, orchestrator approval, `ci` pass incl. 8 real-Postgres share-draft tests) | `astra-work/20261107T030729Z-00b82d37/integration` @ `c8255ff` | `/Users/rob/.local/state/astra-work/888f1417a12a/20261107T030729Z-00b82d37` | [#72](https://github.com/RobertdWray/jowray_com/pull/72) | combined checks c8255ff: validate ✅, 87 files/1712 ✅, build:offline ✅; bucket-3 comment 6704457024; follow-ups #73 (CI deadlock), #74 (F1), #75 (F5); #71 closed | Rob: connector refresh + approval on `share_draft`, skill upload | release checks |
| PR 2 F2 foundation | orchestrator | ✅ rebased onto `59942b2` (`ec28c29`) + plan snapshot commit | `mcp-attach/pr2` | — | — | validate/test/build to re-run before init | — | Astra init for PR 2 |
| PR 2: F2 → init → waves 1-3 → combined checks → E2E → citation refresh → publish → TCR → repairs → merge | orchestrator / Astra / Fable / Rob | ✅ **merged 2026-11-07 13:23Z as `4f0a9a2`** (head `06b3f3e`). Rob's final-review process: one TCR round (complete, cross-family), buckets B1 #1/#10 #3 #6 #8, B2 #4 #7 #9, B3 #5 + B4 #2 (comment 6707209802); repairs `tcr-fixes` (3 attempts; SDK AbortError root cause, withSdkSignal) + `cron-deadline-floor`; Fable regression review NO SERIOUS REGRESSIONS (2007 tests on PG 18); combined ✅ (92 files/1985, build ✅); E2E 13/13 on 3900a0b and on 06b3f3e; `ci` ✅ incl. attach-media/budget/share-draft integration | integration @ `06b3f3e` | `/Users/rob/.local/state/astra-work/888f1417a12a/20261107T084621Z-bd3070f9` | [#76](https://github.com/RobertdWray/jowray_com/pull/76) | prod deploy success; prod tools/list = 12; `_prisma_migrations` 20261107000000 finished; follow-ups #77-#81; evidence in scratchpad `e2e-run/` | Rob: vercel.com allowlist + Cowork curl, connector refresh, approvals (upload tools his choice), skill upload, production smoke; Neon E2E branch kept for PR 3 | PR 3 when the iPhone clip (S0.5) arrives |
| PR 3: F3 → init → wave 1 (A1 ∥ A2) → wave 2 (A3 ∥ A4) → combined checks → E2E video → citation refresh → publish → TCR → repairs → merge | orchestrator / Astra / Fable / Rob | ✅ **merged 2026-11-07 16:52Z as `e7601b6`** (head `3f3827f`). F3 synthetic fixtures `d362676` (Rob waived the iPhone clip); 5 tasks + repair ingest-test-video-gps; TCR round 1 complete + cross-family, B1 #1 #6, B2 #2 #3 #4 → `tcr-fixes` `a37cfa1`; B3 #5 (comment 6709930245); Fable regression NO SERIOUS REGRESSIONS; first `ci` failed A11 (real-Postgres fake lacked readRange; old photo-only gps) → repair `a11-video-gps` `3f3827f`, reproduced 159/160 then 160/160 on local PG 18; combined ✅ 95 files / 2234; E2E video 8/8 on `f6a773a` and `a37cfa1`; `ci` ✅; #70 closed | integration @ `3f3827f` | `/Users/rob/.local/state/astra-work/888f1417a12a/20261107T154222Z-2c03a240` | [#82](https://github.com/RobertdWray/jowray_com/pull/82) | scratchpad `e2e-run/e2e-video-results*.json`; TCR log `~/Downloads/team-review-20261107-111222-jowray_com-pr82-f6a773a.md`; follow-ups #83–#87 (comment 6710205056) | Rob: device pass with a real iPhone/Android clip | final docs PR |
| Release checks per merge (§ Release) | orchestrator | PR 1 ✅ (`59942b2`, 10 tools); PR 2 ✅ (`4f0a9a2` deploy success; 12 tools incl. request_upload/finalize_upload; migration finished); PR 3 ✅ (`e7601b6` deploy success; 12 tools; suggest_places title "Suggest places from photos and videos"; unauth 401; no migration) | | | | `release.md` (PR 1 committed in `7599da0`; PR 2 entry → final docs PR) | | PR 3 after merge |
| Rob: allowlist, connector refresh, skill upload, production smoke | Rob | todo | | | | `smoke.md` | | |
| Cleanup (§ Cleanup) + docs PR (evidence, ledger snapshot) + memory file | orchestrator | todo | | | | `cleanup.json` | | |

**Session-side recovery manifest** (the real batch, after release; Bucket 2): the skill keeps `jowray-attach-manifest.json` in the session's working folder. One entry per file: local path, `sha256`, `sizeBytes`, `mimeType`, `memoryId`, `mediaId`, `stage` (`requested | uploaded | finalized | failed`), last result code. It never holds a URL. To resume, call `request_upload` again for every file that isn't `finalized` (idempotent by `sha256`) and follow the answer.

## 5. Environment manifest (names and sources only, never values)

| What | Value / source |
|---|---|
| Neon project | The Vercel-managed jowray project. The ID is in `docs/plans/2026-11-02-bootstrap-report.md`. The Neon connector reaches it (memory "neon-mcp-reaches-vercel-managed-project"); confirm before relying on it |
| E2E database | **Schema-only** branch `mcp-attach-e2e-YYYYMMDD` from the dev branch. Console or API only; the CLI can't make schema-only branches [C28]. App: pooled `DATABASE_URL`; migrations: `DATABASE_URL_UNPOOLED`. Apply with `npx prisma migrate deploy` |
| Blob | One store shared by every environment. Prefixes: `originals/` (prod), `preview/originals/`, `dev/originals/` (local) [C38]. E2E writes only under `dev/originals/<testMemoryId>/`; the spike only under `dev/spike/` |
| Credential sources | `.env` (main checkout) for `BLOB_READ_WRITE_TOKEN`. Neon API or Console for the E2E connection strings. A throwaway `MCP_API_SECRET` and `CRON_SECRET` (≥32 chars, generated with `openssl rand -hex 32`, never written to disk) |
| `next dev` process env for E2E (overrides `.env` [C26]) | `OUTBOUND_ENABLED=false`, `OUTBOUND_ALLOWLIST=` (empty), `ADMIN_ALERT_EMAILS=e2e-alerts@example.invalid` (every alert attempt becomes a visible SKIPPED `outbound_disabled` row, never a send), `PLACES_PROVIDER=stub` [C27], the SendGrid key set to a non-working dummy if the schema requires one, plus the E2E `DATABASE_URL`s and the throwaway secrets |
| Production | `www.jowray.com/api/mcp`, `MCP_API_SECRET` already set in Production (PR #68). `PLACES_PROVIDER=nominatim` |

## 6. Step 0

- **S0.1.**
  - In W1 (`/Users/rob/Documents/active_work/jowray_wt_mcp_attach`, branch `mcp-attach/pr1`), commit this plan as `docs/plans/2026-11-06-mcp-attach-media.md` with the header "v2, approved <date>". This is foundation F1, and it has to be committed before Astra `init` [C46].
  - File Appendix A verbatim (labels `bug` and `severity:medium`; create the label if it's missing) and Appendix B. **First ask Rob to OK** the personal names: the repo is public.
  - Record both issue numbers in the Ledger, and reference them as `Refs #N` in commits.
- **S0.2.** Create W1 per §0.4, run `npm ci`, and run the three checks on the untouched baseline. Record the baseline SHA. Resolve the default branch with `gh repo view RobertdWray/jowray_com --json defaultBranchRef` before `init` [C46].
- **S0.3. Spike** (script committed as `scripts/e2e/mcp-attach/spike-presign.ts`; notes in `s03-spike.md`):
  - **Run:** `npx tsx --env-file=/Users/rob/Documents/active_work/jowray_com/.env scripts/e2e/mcp-attach/spike-presign.ts`. The script:
    1. mints `issueSignedToken({ pathname: "dev/spike/<uuid>.jpg", operations: ["put"], allowedContentTypes: ["image/jpeg"], maximumSizeInBytes: <size>, validUntil })`;
    2. calls `presignUrl(…, { operation: "put", access: "private", addRandomSuffix: false, allowOverwrite: false })` [C3, C6];
    3. prints only the host and the query-parameter **names**;
    4. writes the URL to a mode-600 temp file that `scripts/e2e/mcp-attach/upload.sh` reads and then deletes.
  - **Record:**
    - the minimal working header set: only `content-type` [C3], or with `x-vercel-blob-access: private` as well;
    - that a wrong `content-type` is rejected;
    - that a body over the size is rejected;
    - that a second PUT is refused (write-once);
    - that `head()` sees the blob;
    - that the host is `vercel.com` [C6].
  - **Clean up:** `del` the spike blob and confirm `list({ prefix: "dev/spike/" })` is empty.
  - **Rob, in Cowork,** checks that `curl -sI https://vercel.com/api/blob` gets an HTTP answer rather than a proxy refusal, before and after adding `vercel.com` to the allowed domains [C14].
- **S0.4.** Create the schema-only E2E branch and `migrate deploy` the PR branch's migrations to it when PR 2 is ready.
- **S0.5.** Rob records an iPhone clip of about 1 s with Location on, anywhere, and AirDrops it to the Mac. PR 3 builds the committed fixture from it (§ PR 3).

## 7. PR 1: `share_draft`

**Feature** `features/admin/share-draft.ts`, `shareDraftAsAdmin(raw)`. It is modelled on `features/admin/set-status.ts` [C1].
- **Input** (`lib/validations/admin.ts` + a strict copy in `lib/validations/mcp.ts` [C42]): `{ memoryId: uuid, memoryVersion: isoDate, status: "PENDING" | "APPROVED" }`.
- **One transaction,** owned here (D12):
  1. `lockMemory`, then re-read the memory.
  2. Refuse with `not_found` (missing or deleted), `not_draft`, or `stale` (the shape of `update-memory.ts:28`).
  3. Write `status`, `consentedAt: new Date()` and `consentVersion: getMemorialEnv().CONSENT_VERSION`, the same stamp as Share [C2].
  4. `appendRevision(tx, { changedVia: "ADMIN", before: { status: "DRAFT", consentedAt: null }, after: { status, consentedAt }, consentVersion })`.
  5. In the same transaction, call `suppressAdminAlertForDraftShare(tx, memoryId)` from `services/email` (D11). It inserts `EmailLog { emailType: "ADMIN_NEW_MEMORY", status: "SKIPPED", errorMessage: "admin_shared", recipientEmail: "" }` if no row exists (unique `[memoryId, emailType]`).
     - **Precondition:** the caller holds the memory lock and the memory is still a DRAFT.
     - **Why it's race-free without the outbound lock:** every alert creator skips a DRAFT [C7], and the row commits together with the status.
     - **Doc comment:** must say why this is the one row creation outside the outbound lock [C40].
     - **Fail closed (TCR round 1, #4; 2026-11-07):** if a row already exists and is not the terminal `admin_shared` skip (any status, including SENT or SENDING), the helper throws, so the whole share rolls back and the tool answers `internal { eventId }`. No legitimate path creates such a row for a DRAFT; this surfaces a broken invariant instead of committing a share that could still alert.
- **Returns** `{ ok: true, status, memoryVersion }`. Log `{ action: "admin_draft_shared", memoryId, status }` (ids only [C10]).
- **Confirmations:** drafts never get one (source ≠ `WEB_UPLOAD`) [C7]. The cron still skips them, so the link Rob sent is never rotated.

**Email service** (`services/email/index.ts`) [C15]:
- Add `TERMINAL_SKIP_REASONS = ["admin_shared"] as const`.
- `claimableWhere` excludes `{ status: "SKIPPED", errorMessage: { in: TERMINAL_SKIP_REASONS } }`.
- Before trying to claim, `deliver()` answers a terminal row with `{ sent: false, skipped: "admin_shared" }`. It never reports `in_progress`, and never calls SendGrid.
- Other skip reasons keep their reclaim behaviour.

**MCP** (`app/api/mcp/tools.ts`) [C1, C32]:
- Register `share_draft` with `{ destructiveHint: true, idempotentHint: true }`, so Claude asks for approval.
- Its description says:
  - use it only when Rob says in this conversation that the named sender agreed; never infer consent;
  - APPROVED publishes nothing public yet [C25].
- Update `set_status`'s description: "A DRAFT is refused (`draft`); use `share_draft`."

**Docs:**
- `docs/features/mcp.md` [C39]: 10 tools, seven approvals, the R4a sentence.
- `SKILL.md` [C8]: rewrite lines 42 and 46. Claude calls `share_draft` only on Rob's explicit word that the sender said yes. Nobody but the sender presses Share on a claim page.

**Tests (red first; acceptance items A1–A3):**
- `__tests__/features/share-draft.test.ts`: every refusal; the PENDING and APPROVED targets; the stamp and version; the revision; the suppression row; preferences unchanged; a second call returns `not_draft`.
- `__tests__/services/email*.test.ts` (whichever file covers `deliver`):
  - a terminal row is never claimed and never sent;
  - `outbound_disabled`, `recipient_capped` and `admin_capped` rows are still reclaimable.
- **A3** in `__tests__/api/reconcile.test.ts` + `ingest-upload.test.ts`: `share_draft`, then the sender adds a file (`finalizeUpload` → `notifyAdminsQuietly`), then the cron runs. No alert and no SendGrid call.
- `__tests__/api/mcp.test.ts`: the `tools/list` snapshot and the 10-name list.
- `__tests__/integration/share-draft.test.ts` (real Postgres; CI sets `TEST_DATABASE_URL`): the `consentedAt` CHECK holds for both targets, and the suppression row is unique.

## 8. PR 2: `request_upload` + `finalize_upload`

### 8.1 Migration `prisma/migrations/2026110700xxxx_media_admin_upload` [C38]
- `Media.addedVia ChangedVia?`: null for site uploads (claim page, `/share`); `ADMIN` for connector uploads (provenance used by D10).
- `Media.declaredSha256 String?`.
- CHECK `"declaredSha256" ~ '^[0-9a-f]{64}$'`.
- CHECK `("addedVia" = 'ADMIN') = ("declaredSha256" IS NOT NULL)` (null-safe form).
- The change is additive: old code ignores both columns.

### 8.2 Refactor first (behaviour-preserving; existing suites green and unchanged before any new feature commit) [C23, C24]
- `features/memories/create-memory.ts`:
  - Extract `reservePendingMedia(tx, { memoryId, file, maxBytes, addedVia?, declaredSha256? })`: the 10-file cap, `withinBudget` (takes the budget lock) and `createPendingMedia`.
  - **Precondition** (documented): the caller holds the lease and the memory lock.
  - `createUploadTicket` keeps owning its transaction and lock order (lease → memory, `create-memory.ts:250-251`).
- `features/memories/issue-upload-ticket.ts` [C23]:
  - Extract `renewPendingReservation(tx, row, now)`: the 24 h `expired` check, the window, `budgetHasRoom`, and the conditional `reservedUntil` stamp. It takes the budget lock.
  - **Precondition:** the caller holds the lease.
- `features/memories/ingest-upload.ts`: extract `scheduleReadyFollowUps({ mediaId, mimeType, deadlineAt })` (checksum and derive, GPS) from `finalizeUpload` (`:259-272`).

### 8.3 Shared completion path (D10) [C16, C17, C18]
Inside `recordMedia` (`ingest-upload.ts:51`), every caller gets this, including cron step (a) (`route.ts:218`). Signature: `recordMedia({ mediaId, signal? })`. For a row with `addedVia = ADMIN`, after the existing size, label and prefix checks and **before** `transition(READY)`:
1. **Exact size:** if `head.size !== row.maxBytes`, reject as `size_mismatch` (delete the blob, FAILED), using the existing `reject` shape.
2. **Hash, up to `INLINE_HASH_MAX_BYTES`:** stream the blob through `sha256` with `signal`.
   - An abort or timeout returns `PENDING` with nothing written.
   - A digest ≠ `declaredSha256` rejects as `checksum_mismatch` (delete the blob, FAILED).
   - Otherwise pass `checksumSha256` into the transition.
   - `computeChecksum` gains the same `{ signal }` option [C18].
3. **`transition(row, { status: "READY", …, checksumSha256?, adminRevision: true })`.** Inside the existing locked transaction:
   - `before = readyLiveMediaIds(tx, memoryId)`: status READY, `deletedAt` null, `replacesMediaId` null, excluding this row. Not `visibleMediaIds`, which also counts PENDING rows [C17].
   - Update the row.
   - `appendRevision(tx, { changedVia: "ADMIN", before: { readyMediaIds: before }, after: { readyMediaIds: [...before, id], addedMediaId: id } })`.
   - A lost race (P2025) writes nothing, so the revision exists exactly once, whoever wins.
   **Cron step (a) callers pass a signal too:** `AbortSignal.timeout(min(15 s, the cron's remaining budget − 5 s))` per item, and the loop's existing `outOfTime()` check runs before each item. An aborted hash leaves the row PENDING for the next run, never FAILED.
4. **Cron step (b)** (`route.ts:455`): after computing a checksum for a row with a `declaredSha256` that differs, send a Sentry warning (`captureMessage`, tags `media_id` and `memory_id`) and log ids only. The precedence rule in § 8.4 already makes the declaration inert.

The `FailedReason` union gains `size_mismatch | checksum_mismatch`. FAILED rows don't store a reason, so a **repeat** finalize of a FAILED row answers `{ status: "FAILED" }` without one (follow-up F9).

### 8.4 Identity and dedupe (D4)
In `request_upload`, under the memory lock, a live (`deletedAt` null) row on the same memory matches `sha256 = X` when:
- **READY** and (`checksumSha256 = X` or (`checksumSha256` IS NULL and `declaredSha256 = X`)). A verified checksum always wins, so a contradicted declaration never answers `alreadyAttached` once the cron has hashed the file. A sender's own upload of the same photo matches by checksum.
- **PENDING** and `declaredSha256 = X` and `createdAt > now − RESERVATION_MAX_AGE_MS` (24 h).
- **FAILED rows never match.**

If the match's `maxBytes` (declared size) or kind differs from the new declaration, refuse with `conflict` (`{ mediaId }`). On PENDING reuse, `caption`, `approxDateText` and `place` are overwritten with the newest values (the file isn't visible yet). On READY they are ignored (`metadataIgnored: true`).

### 8.5 Feature `features/admin/attach-media.ts`

`requestUploadAsAdmin(raw)`:
- **Input** `{ memoryId, file: { name, type, size, sha256 }, caption?, approxDateText?, place?, durationSeconds? }`:
  - the type goes through `normalizeMime`, falling back to the extension;
  - `size` must be at most `MAX_BYTES[kind]` [C9];
  - `sha256` is 64 lowercase hex.
- **One transaction** (D12), in this order:
  1. Find the memory: `not_found` if deleted; `not_ready` if non-DRAFT and not ready (D7) [C34].
  2. `renewUploadLease`, then `lockMemory`.
  3. The § 8.4 match:
     - READY: return `alreadyAttached`;
     - PENDING: `renewPendingReservation`, which takes the budget lock;
     - none: `reservePendingMedia` with `addedVia: "ADMIN"`, `declaredSha256`, `maxBytes = size`.
- **After commit,** with no lock held:
  - for a reused PENDING row, `head(storageKey)`: if the blob exists, return `{ status: "PENDING", mediaId, uploaded: true }` (call finalize);
  - otherwise `presignPut`.
- **Returns** `{ mediaId, status: "PENDING", upload: { method: "PUT", presignedUrl, headers, expiresAt } }`, with the headers from S0.3.
- **Refusals:** `invalid | not_found | not_ready | unsupported_type | too_large | too_many_files | budget_exceeded | conflict`.
- **A lost response** (presign or the reply fails after commit) is safe: the retry matches the PENDING row by `declaredSha256`.

`finalizeUploadAsAdmin(raw)`:
- **Input** `{ memoryId, mediaId }`. The row must belong to the memory, and neither may be deleted (`not_found`).
- **Budget** (D9) [C19]:
  - `deadlineAt = callStart + 25 s`;
  - the hash gets `AbortSignal.timeout(min(15 s, remaining − 5 s))`;
  - inline GPS (images now; videos after PR 3) uses `extractPhotoGps({ mediaId, deadlineMs: min(5 s, remaining − 3 s) })`;
  - `scheduleReadyFollowUps` gives derive `min(DERIVE_DEADLINE_FINALIZE_MS, remaining − 3 s)`, and skips it if under 5 s (cron step (g)).
- **Calls** `recordMedia({ mediaId, signal })`.
- **Returns:**
  - `{ status: "PENDING", uploaded: false | true, verifying? }`;
  - `{ status: "FAILED", reason? }`;
  - `{ mediaId, status: "READY", memoryType, gps: "found" | "none" | "pending" | "not_applicable" }`.
- Idempotent.
- Never calls `confirmQuietly` or `notifyAdminsQuietly`, and never touches `status` or `consentedAt` (D7).

### 8.6 Storage, MCP, secrets, docs
- **`presignPut`.** Add `presignPut({ pathname, contentType, maxBytes, validUntil }) → { url, expiresAt }` to `services/storage/types.ts` [C41] and `integrations/vercel-blob/index.ts`, mirroring `presignGet` (`:130`) [C3, C6]:
  - `issueSignedToken({ pathname, operations: ["put"], allowedContentTypes: [contentType], maximumSizeInBytes: maxBytes, validUntil, token })`;
  - `presignUrl(…, { operation: "put", pathname, access: "private", allowedContentTypes, maximumSizeInBytes, addRandomSuffix: false, allowOverwrite: false, validUntil })`;
  - `validUntil = now + BLOB_TOKEN_LIFETIME_MS` (60 min), inside `UPLOAD_WINDOW_MS` (75 min).
- **MCP** (`app/api/mcp/tools.ts`) [C32]:
  - Register both tools with `{ destructiveHint: false, idempotentHint: true }` (additive). The schemas are strict copies [C42].
  - The descriptions spell out the steps:
    1. `shasum -a 256`, size and type locally.
    2. `request_upload`.
    3. `curl -sS --fail -X PUT` with exactly the returned headers and `--data-binary @file`, the URL passed through an environment variable and never echoed.
    4. `finalize_upload`.
  - They also say: never write the URL into chat or files; the host is `vercel.com`; if it's blocked, run from Claude Code on the Mac (R3, D14).
- **Secrets** [C10, C30, C31]. MCP inputs and outputs are collected on spans by default, and `beforeSendSpan` is where the repo scrubs them:
  - `lib/sentry/secrets.ts`: add `presignedUrl` to `SECRET_FIELD_KEYS`.
  - `lib/sentry/scrub.ts`: extend `TOKEN_QUERY` (`:32`) with `vercel-blob-signature` and `vercel-blob-delegation`. This also covers the existing GET presign URLs.
  - `lib/logger/logger.ts`: add `presignedUrl` to the redacted keys.
- **Docs:**
  - `docs/features/mcp.md` [C39]: 12 tools; the upload flow; `vercel.com` egress; the scrub additions.
  - `SKILL.md` [C8]: replace "The connector has no file upload" with the procedure. It covers the manifest (§4); a Live Photo means attaching both the HEIC and the MOV to one memory; the 10-file cap; `suggest_places` after finalize. Also resolve the line 46 vs line 74 conflict.
- **E2E harness,** committed, typed and linted, in `scripts/e2e/mcp-attach/`:
  - `mcp-call.ts`: a JSON-RPC client; `MCP_URL` + `MCP_API_SECRET` from the environment; `--prod`; redacts `presignedUrl` from its output.
  - `upload.sh`: curl from a URL file, which it then deletes.
  - `readback.ts`: tsx + Prisma, ids, statuses, revisions and EmailLog rows, rounded points.
  - `cleanup.ts`: lists and deletes `dev/originals/<testMemoryId>/` objects, then reads back.
  - Evidence goes in `docs/plans/evidence/2026-11-mcp-attach/`, following the 2026-11-photo-gps convention [C44].

### 8.7 Tests (red first; critical path [C5])
`__tests__/features/attach-media.test.ts` (db stub, `vi.mock("@/services/storage")`, collected `afterWithFlush`), `ingest-upload.test.ts`, `vercel-blob.test.ts`, the scrub and envelope tests, and `mcp.test.ts` cover A4–A16 in § Acceptance gate. The `__tests__/integration/attach-media.test.ts` run on real Postgres covers A9–A11. The existing `create-memory`, `issue-upload-ticket`, `ingest-upload`, `upload`, `reconcile` and `budget-concurrency` suites stay green.

## 9. PR 3: video location (R2)

- **`lib/video-gps.ts`,** a pure parser with no dependency. ExifReader reads images only [C11]. Signature: `readVideoLocation(read, size, limits) → { status: "found", coordinates } | { status: "absent" } | { status: "failed", error }`.
  - **Box walk:** top-level ISO-BMFF boxes. A size of 1 means a 64-bit size; 0 means "to end of file". `moov` may sit before or after `mdat` (iPhone puts it after).
  - **Lookup:**
    1. `moov/meta` with an `mdta` handler: the `keys` entry `com.apple.quicktime.location.ISO6709`, then its `ilst` item's `data` value [C12].
    2. Then `moov/udta/©xyz` [C13].
  - **Parse ISO 6709** (`+27.5916+086.5640+8850/` [C12]). A value out of range counts as `absent`, with a logged reason.
  - **Limits** (Bucket 1): at most 64 top-level boxes, depth 6, 16 range requests, 16 MiB `moov`, 16.5 MiB total bytes, and the caller's deadline.
  - **Deterministic vs transient:** hitting a structural limit is deterministic, so it's `absent` with a logged reason. A timeout, a range not honoured, a short read or a network error is transient, so it's `failed` (D13).
- **`readRange(pathname, offset, length, { signal })`** on `StorageService` and the Blob wrapper [C20, C21, C41]:
  - It uses SDK `get` with `Range: bytes=o-e`.
  - It requires `result.headers.get("content-range")` to match `bytes o-e'/total` with `e' ≤ e`. Otherwise it cancels the stream and throws `RangeNotHonouredError`.
  - It reads at most `length` bytes, then cancels.
  - Fewer bytes than the header promised throws `ShortReadError`; a missing object throws the existing `OriginalMissingError`.
  - The `signal` aborts both the request and the body.
- **`features/media/extract-photo-gps.ts`** [C22]:
  - The gate becomes `hasLocationReader(mimeType)` (a new `lib/media-location.ts`): `image/*`, `video/quicktime`, `video/mp4`.
  - Videos use `readVideoLocation` over `readRange`.
  - `found`/`absent` stamp `gpsCheckedAt`; `failed` leaves it null and counts an attempt (at most 3), as photos already do. Never a permanent "absent" from a transient error.
- **The predicate replaces the `image/` checks** in:
  - `scheduleReadyFollowUps` (from `ingest-upload.ts:268`);
  - `app/api/upload/route.ts:113` [C37];
  - `features/places/suggest-for-memory.ts:44` [C35];
  - cron step (h) `route.ts:667-676` [C36], which then backfills existing READY videos, 10 per run.

  Cron step (g) (derive) stays image-only.
- **Fixtures** (repo is public; follow `gps.heic`'s policy [C44, C45]):
  1. A **real iPhone clip** from S0.5, sanitized:
     - `exiftool -all= -tagsfromfile @ -Keys:all --Keys:Make --Keys:Model --Keys:Software --Keys:CreationDate`, then `exiftool -Keys:GPSCoordinates="40.689247, -74.044502"` (Statue of Liberty);
     - shrink the `mdat` payload with a committed script, `scripts/fixtures/shrink-mdat.mjs` (box headers stay; payload zeroed and shortened);
     - verify with `exiftool -ee -G1 -a` that only the location key remains.

     Commands and tool versions go in `__tests__/fixtures/README.md`.
  2. An ffmpeg MP4 carrying `©xyz` (`-metadata location=+40.6892-074.0445/`), checked with exiftool.
  3. Hand-built boxes in `__tests__/lib/video-gps.test.ts` for the edge cases.

  PR 3 doesn't merge without fixture 1.
- **Tests:** A17–A22 in § Acceptance gate, plus the extended `extract-photo-gps`, `suggest-for-memory`, `reconcile` and `upload` suites.

## 10. Acceptance gate (each item has a named test; the reviewer checks the list)

| # | Scenario | Expected |
|---|---|---|
| A1 | `share_draft` PENDING / APPROVED | stamp + version, ADMIN revision, terminal SKIPPED alert row, preferences unchanged |
| A2 | `share_draft` on non-DRAFT / stale / deleted | `not_draft` / `stale` / `not_found`; nothing written |
| A3 | `share_draft` → sender adds file via claim page → finalize + cron | no admin alert, no SendGrid call, row still `SKIPPED/admin_shared` |
| A4 | request (new) | PENDING row `addedVia=ADMIN`, `maxBytes=size`; `presignPut` args exact (env prefix, type, size, validUntil) |
| A5 | request on READY match (checksum) / (declared, checksum null) | `alreadyAttached`, no row |
| A6 | request on READY row whose checksum ≠ X but declared = X | **new** row (contradicted declaration never matches) |
| A7 | request on PENDING match, blob absent / present | same row + fresh URL / `uploaded: true` |
| A8 | same hash, different size or kind | `conflict` |
| A9 | two concurrent requests, same hash (real Postgres) | one row |
| A10 | request concurrent with `set_deleted` | either `not_found` or a row the cron later fails; never a live row on a deleted memory |
| A11 | finalize concurrent with cron step (a) (real Postgres) | one READY transition, exactly one ADMIN revision |
| A12 | cron completes an admin upload first (lost response) | READY via `recordMedia` with hash check + revision; finalize then answers READY |
| A13 | wrong hash ≤50 MB / >50 MB | FAILED `checksum_mismatch`, blob deleted / READY + Sentry warning at cron (b), A6 applies |
| A14 | size ≠ declared | FAILED `size_mismatch` |
| A15 | slow stream (never ends) | abort at deadline → PENDING `verifying`, nothing written |
| A16 | throw after each durable write (reservation, READY commit, GPS stamp) | retry converges: same row, one revision, cron backfills |
| A17 | expired URL | request again → same row, fresh URL (≤24 h) |
| A18 | `not_ready` memory | refused, nothing written |
| A19 | presigned URL in tool result | absent from Sentry envelope (`SENTRYTEST_` marker), logs, scrubbed by `scrubUrl` |
| A20 | range ignored (200 / missing or mismatched `Content-Range`) | `failed`, not stamped |
| A21 | short read / missing object / timeout | `failed`, not stamped, attempt counted |
| A22 | iPhone fixture / ffmpeg `©xyz` / no location / structural limit | found / found / absent (stamped) / absent with reason |

## 11. Verification

1. **Per PR** in its worktree: the three checks in §0.5, and the `ci` check green (it runs the integration suites).
2. **E2E** on the schema-only branch (§5), harness from § 8.6, before PR 2's merge (photo items) and PR 3's merge (video items). Files: `__tests__/fixtures/gps.heic`, a Liberty JPEG made with exiftool, the sanitized iPhone MOV, and Rob's real iPhone MOV (local only, never committed).
   - ☐ `draft_memory`, then for each file: request → curl → finalize. All READY, the memory type is VIDEO.
   - ☐ GPS is saved on each row; `suggest_places` returns the **stub label** "Photo location found near {lat}, {lon} (test)" for each [C27]. Real place names are checked in production.
   - ☐ A repeat request answers `alreadyAttached`.
   - ☐ Kill the session between curl and finalize, then hit the cron route with the throwaway `CRON_SECRET`: READY, with the revision and the checksum.
   - ☐ The memory is still DRAFT with `consentedAt` null. EmailLog has no new rows, or only SKIPPED `outbound_disabled` ones.
   - ☐ Attach to an APPROVED memory: an ADMIN revision. Attach to a `not_ready` memory: refused.
   - ☐ `share_draft` APPROVED, then add a file through the claim page in a browser, then the cron: the alert row is still `SKIPPED/admin_shared`.
   - ☐ `grep -c "vercel-blob-signature" next-dev.log` gives 0.
   - Evidence goes to `e2e-results.json` (ids and rounded points only).
3. **Production** (Rob; after each merge, see § Release):
   - Add `vercel.com` to the allowlist; the S0.3 Cowork check passes.
   - In a session with the files on disk: test draft → HEIC + MOV attached → real place names → `share_draft` PENDING → `set_deleted`.
   - Record the `finalize_upload` span duration from Sentry for the largest file. It must be under 25 s.

## 12. Release, rollback, cleanup

- **Gates.** PR 1 merges after CI and review. PR 2 merges after its E2E items. PR 3 merges after the video E2E items and fixture 1.
- **After each merge,** record in `release.md`:
  - the production deploy SHA;
  - for PR 2, the `_prisma_migrations` row finished;
  - `tools/list` against prod via `mcp-call.ts --prod` (count and names);
  - Rob's connector refresh in claude.ai and his approval settings (`share_draft`: ask; `request_upload` / `finalize_upload`: his choice);
  - the `SKILL.md` version bump uploaded to the claude.ai skill store;
  - the smoke evidence.
- **Rollback:** a GitHub revert PR, never a force-push.
  - The schema is additive, so it stays.
  - Admin PENDING rows still in flight finish under the old `recordMedia` via cron step (a), without the hash check or revision (accepted, documented). Presigned URLs stay valid for at most 60 min.
  - After a PR 1 revert, the old `deliver()` would treat `admin_shared` rows as reclaimable, so a later alert is possible (accepted).
- **Cleanup** (owner: the executing agent; evidence in `cleanup.json`):
  - E2E blobs: `cleanup.ts` deletes every `dev/originals/<testMemoryId>/` object and reads back an empty listing.
  - The spike blob is deleted in S0.3.
  - The Neon E2E branch is deleted only on Rob's OK.
  - Production smoke memory: `set_deleted`. Cron step (f) purges its blobs after the 30-day grace; record the memory id (not the URLs) in `smoke.md`.

## 13. Rob-owned steps
- Approve this plan.
- OK the names in the public issue (S0.1).
- The Cowork reachability check and the allowlist (S0.3).
- Record the iPhone clip (S0.5).
- Merge PRs 1–3.
- Refresh the connector and set approvals.
- Upload the skill.
- Run the production smoke.
- OK deleting the Neon branch.

## 14. Pre-mortem (it shipped and failed: why?)
1. **The presigned PUT needs headers the docs don't show.** → S0.3 settles them before any code, and the server returns them.
2. **The egress allowlist is ignored** [C14]. → The Mac route (R3, D14).
3. **A 300 MB PUT stalls.** → The row stays PENDING, a retry gets a fresh URL, and F2 adds multipart.
4. **An admin upload completes through the cron without its checks.** → D10 puts them in `recordMedia` (A12).
5. **A wrong `sha256` claims "already attached".** → D4 precedence, the exact size, the hash before READY (A5, A6, A13, A14).
6. **The suppressed alert fires on sender activity.** → D11 terminal reason (A3).
7. **A timeout becomes a permanent "no location".** → D13 (A20, A21).
8. **Finalize exceeds 30 s in production.** → The 25 s budget, abort signals, cron backfill, and the measured span (§11.3).
9. **The refactor changes claim-page behaviour.** → Refactor commits come first, with the unchanged suites green.

## 15. Review triage (2026-11-06): external review + builder check, sorted

Each item below was checked against the source it cites.

**Bucket 1, must (applied in v2):**
- **Ext-1** completion path and audit across recovery → D10, § 8.3, A11, A12, A16.
- **Ext-2** dedupe identity, large-file mismatch, FAILED, expired and conflicting retries → D4, § 8.4, A5–A8, A13, A14, A17.
- **Ext-3** `SKIPPED` reclaimable by the request path [C15] → D11, A3.
- **Ext-4** range contract, limits, absent vs failed, a real iPhone fixture → D13, § 9, A20–A22.
- **Ext-5** duration budget, abort signals, slow-stream and interruption tests, production timing → D9, § 8.5, A15, A16, § 11.3.
- **Ext-6** transaction ownership and lock order, no network under lock, concurrency tests → D12, § 8.2, A9–A11.
- **Ext-7** "publish" means APPROVED, which isn't public [C25] → R4a.
- **Handoff contract:**
  - canonical plan committed first;
  - inputs embedded (Appendix A/B);
  - committed harness paths;
  - cold start;
  - environment manifest with outbound off and the places stub;
  - evidence-bearing ledger with reconcile;
  - release and rollback;
  - cleanup ownership

  → §0, §3, §4, §5, § 8.6, §12.
- **Rob, 2026-11-06:** work in a new worktree, and offload to Astra → §0.4 (W1 and Astra's own worktrees), §3 (execution model with Fable 5.1 reviewers) [C46, C47].
- **E2E corrections:** the stub label; a schema-only branch because the Blob store is shared [C28] → §5, §11.2.
- **Builder:**
  - Q1 originals on disk → D14 + S0.3.
  - Q2 → R5/D11.
  - Q3 → Appendix A.
  - Q4 cron completion → D10; unready memories → D7 `not_ready`.
  - Factual fixes: `markSkipped` and `skipDelivery` already write `SKIPPED` [C40]; the Blob token is in `.env`, not `.env.local`; outbound email must be off in E2E.

**Bucket 2, nice (applied):**
- The session-side recovery manifest (§4).
- Late-mismatch Sentry warning at cron step (b) (§ 8.3).
- Bounded box count and depth (§9).
- Committed fixture-generation commands (§9).

**Bucket 3, don't do:** see § Non-goals. **Bucket 4, out of scope:** see § Follow-ups.

## 16. Non-goals (what we are deliberately not doing, and why)

Drafted by a subagent from Bucket 3 (2026-11-06). The PR body repeats this list, so later review rounds don't suggest these again.

- **Hashing every connector upload before READY.**
  - Why not: `/api/mcp` has `maxDuration = 30` (`app/api/mcp/route.ts:12`), and `after()` shares that limit [C19]. A 500 MB stream can't be hashed reliably in that time.
  - Instead: every connector upload must match its declared size exactly (`maximumSizeInBytes` on the presigned URL plus the size check in `recordMedia`). Files up to 50 MB are hashed before READY; larger ones are hashed later by cron step (b). In dedupe, a verified checksum always beats the declared one, and a late mismatch raises a Sentry warning.
- **A new `EmailStatus` value (e.g. `SUPPRESSED`) for on-behalf shares.**
  - Why not: it needs an enum migration and new branches in the delivery code, for a case one terminal skip reason already covers.
  - Instead: `SKIPPED` with the terminal reason `"admin_shared"`, which `claimableWhere` excludes. Other skip reasons can still be picked up again later, as today (`services/email/index.ts:58-59`) [C15].
- **Suppressing the alert after the share commits, or taking the outbound lock inside the share transaction.**
  - Why not: calling `skipDelivery` after commit leaves a window in which the cron can send the alert first. No existing code holds the memory lock and the outbound lock together.
  - Instead: the share transaction itself inserts the terminal `SKIPPED` row, so it commits together with the status change. Nothing can race it, because every alert creator skips a DRAFT (`siteAlertsAdmins`, `features/memories/site-email.ts`) [C7, C40].
- **Raising `/api/mcp` `maxDuration` above 30 s.**
  - Why not: the GET path holds the function open until `maxDuration` (comment at `app/api/mcp/route.ts:45`). Time budgets plus the cron backfill already cover slow work.
  - Instead: finalize gets a 25 s budget, with `AbortSignal`s on every long read. Missed derivations and GPS reads are picked up by cron steps (g) and (h).
- **Running the full reconcile cron against a data-copy Neon branch for the end-to-end run.**
  - Why not: a cloned dev database shares the Blob store with dev, so its purge steps could delete files the dev database still points to.
  - Instead: a schema-only branch with no copied rows [C28]. Only test rows exist there.
- **Committing family photos or videos, or full-precision real coordinates, as fixtures.**
  - Why not: the repo is public.
  - Instead: the Statue of Liberty point with other metadata stripped, as in `__tests__/fixtures/gps.heic` [C44, C45]. PR 3 uses a sanitized ~1 s iPhone clip that Rob records.
- **A laptop batch-upload script.**
  - Why not: Rob chose to skip it (R3).
  - Instead: run the same three tool steps from Claude Code on the Mac.
- **A consent note or a "shared on behalf" column.**
  - Why not: Rob ruled stamp only (R6).
  - Instead: the ADMIN revision records that an admin moved the status.
- **Restricting connector uploads to DRAFTs.**
  - Why not: Rob ruled that any memory that hasn't been deleted accepts uploads (R1).
  - Instead: the status check is "not deleted", plus the `not_ready` refusal below.
- **Connector uploads to a non-DRAFT memory that has no words and no READY file yet.**
  - Why not: that file would make cron steps (e) and (e2) send the sender's first confirmation, which rotates their link, and the admin alert, for a file the sender never sent (`app/api/cron/reconcile-uploads/route.ts:322-372`) [C34].
  - Instead: refused with `not_ready`.
- **A Blob `onUploadCompleted` callback for presigned uploads.**
  - Why not: it needs a new `BLOB_WEBHOOK_PUBLIC_KEY` secret [C3].
  - Instead: an explicit `finalize_upload`, with cron step (a) as the safety net. Both run the same completion code (D10).
- **A server-side batch or manifest table.**
  - Why not: `request_upload` is idempotent by sha256, so a session can always find out where each file stands.
  - Instead: the skill describes a manifest file the session keeps (§4).
- **An ADMIN revision for PENDING reservations.**
  - Why not: a PENDING file isn't visible; the memory only changes when the file becomes READY.
  - Instead: the revision is written in the READY transition, whichever path completes the upload.
- **Separate tables for declared and verified file identity.**
  - Why not: it adds structure without behaviour that two columns can't express.
  - Instead: two nullable columns, `declaredSha256` and `checksumSha256`, with a precedence rule (§ 8.4).
- **Proving the deployed duration with local `next dev` alone.**
  - Why not: a local run doesn't show whether the deployed function stays within its limit.
  - Instead: the production smoke test records the finalize span duration from Sentry (§ 11.3).
- **Multipart upload in this PR.**
  - Why not: it's a recommendation above 100 MB, not a limit [C4], and the largest file in this batch is 28 MB.
  - Instead: a single PUT, and follow-up F2.

## 17. Follow-ups (Bucket 4: real, out of scope; file as issues after merge and list in the PR body)

| # | Severity | Issue | What a picker-upper needs |
|---|---|---|---|
| F1 | Medium | Public memorial pages: APPROVED publishes nothing | `app/admin/status-actions-client.tsx:185`; decide what APPROVED shows, and to whom (`Visibility` PUBLIC/FAMILY/PRIVATE) |
| F2 | Medium | Multipart presigned upload for files over 100 MB | [C4]; `presignUrl` supports presigned multipart `POST` (SDK `PresignPutUrlOptions` doc); the tool would need part URLs + complete; the skill a split |
| F3 | Medium | Sentry `scrubEvent` doesn't scrub exception value/message (existing follow-up 8.8 of the MCP plan) | `lib/sentry/scrub.ts`; the presigned URL could surface in a thrown error's message |
| F4 | Low | A `MCP_API_SECRET` shorter than 32 chars gives a 500, not a 401 | `server/config/env.ts:139-142`, `app/api/admin/_auth.ts:25`; catch the env parse and answer 401 + log |
| F5 | Low | Admin-page buttons for `share_draft` and attach | `features/admin/*` already hold the logic; `app/admin/memory-detail.tsx` |
| F6 | Low | Video location in the browser (`/share` and the claim-page place hints) | `lib/photo-gps.ts` is browser-side for photos; `lib/video-gps.ts` is pure and can be reused |
| F7 | Low | WebM location; Live Photo pair shown as one item; 10-file cap = 5 pairs | `lib/media-types.ts:25`; `LIVE_MEDIA_ORDER` |
| F8 | Low | An admin attach within 30 min of a sender's own ready submission may appear in their first confirmation's file list | cron (e) `CONFIRM_MIN_AGE_MS`; D7 refuses only the not-ready case |
| F9 | Low | FAILED rows don't store a reason; a repeat finalize answers without one | `recordMedia` early return `ingest-upload.ts:63-65` |
| F10 | Low | Late checksum mismatch above 50 MB only warns; no quarantine | § 8.3 step 4 |
| F11 | Low (external) | claude.ai egress allowlist ignored in "Package managers only" mode | [C14]; recheck after Anthropic's fix, then drop D14's warning |

## 18. Citations

Repo permalinks are pinned to `84f7d60`. Web quotes were fetched live on 2026-11-06 (`maxAge: 0`). Installed-package quotes are from the versions in `package-lock.json` (`@vercel/blob` 2.8.2, `next` 16.4.4).

### [C1] — set_status refuses DRAFT
- **Relevant File(s):** `app/api/mcp/tools.ts`, `features/admin/share-draft.ts` (new), `features/admin/set-status.ts` (pattern)
- **Change Summary:** Adds `share_draft`, copying `set_status`'s lock → re-read → revision pattern, and updates `set_status`'s description.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/app/api/mcp/tools.ts#L78-L83 ; https://github.com/RobertdWray/jowray_com/blob/84f7d60/features/admin/set-status.ts#L26-L40
- **Verbatim Quote:**
  > "Moves a shared memory between PENDING, APPROVED and HIDDEN. A DRAFT is refused (`draft`): only the sender's Share leaves DRAFT."
  > `if (fresh.status === "DRAFT") { return "draft" as const; }`
- **Justification:** It shows the gap R4 fills, and the transaction shape `shareDraftAsAdmin` reuses.

### [C2] — Share stamps consent
- **Relevant File(s):** `features/admin/share-draft.ts`
- **Change Summary:** `share_draft` writes the same consent stamp as the sender's Share (R6).
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/features/memories/claim.ts#L170-L174 ; https://github.com/RobertdWray/jowray_com/blob/84f7d60/features/memories/claim.ts#L232 (refreshed 2026-11-07)
- **Verbatim Quote:**
  > "`share` on a DRAFT (a memory the family admin saved on this person's behalf) is the act of sharing: the memory becomes PENDING and `consentedAt` / `consentVersion` are stamped then, under the same lock."
  > `const consent = sharing ? { consentedAt: new Date(), consentVersion: getMemorialEnv().CONSENT_VERSION } : null;`
- **Justification:** It defines exactly which two fields the stamp writes, and that they're written under the memory lock.

### [C3] — Vercel presigned PUT URLs
- **Relevant File(s):** `integrations/vercel-blob/index.ts`, `features/admin/attach-media.ts`, `app/api/mcp/tools.ts`
- **Change Summary:** `presignPut`; the URL handed to the session; the CDN enforcing exact type and size; no callback.
- **Source URL:** https://vercel.com/docs/vercel-blob/vercel-signed-urls#put---upload-a-blob
- **Verbatim Quote:**
  > "Call presignUrl directly when you need a one-off upload URL outside of handleUploadPresigned, for example from a CLI or a server-to-server job. The PUT options enforce constraints on the upload at the CDN, so the URL is safe to hand to a client even if the client controls the request body"
  > "allowedContentTypes rejects requests whose Content-Type header is not in the list." … "maximumSizeInBytes rejects requests larger than the configured size."
  > "webhookPublicKey | No | The public key used to verify the onUploadCompleted callback. Defaults to process.env.BLOB_WEBHOOK_PUBLIC_KEY."
- **Justification:** It supports D1 (a CLI upload by URL), D3 (CDN-enforced type and size) and D5 (a callback needs a new key).
- **Correction (S0.3 spike, 2026-11-07, `docs/plans/evidence/2026-11-mcp-attach/s03-spike.md`):** the CDN checks `allowedContentTypes` against the SDK's `x-content-type` request header, not `Content-Type`; a wrong `content-type` alone was accepted (200) and the blob typed from the pathname extension. `request_upload` therefore returns both `content-type` and `x-content-type`.

### [C4] — Multipart above 100 MB
- **Relevant File(s):** tool descriptions in `app/api/mcp/tools.ts`; follow-up F2
- **Change Summary:** A single PUT now, multipart later (D6).
- **Source URL:** https://vercel.com/docs/vercel-blob/usage-and-pricing
- **Verbatim Quote:**
  > "For files larger than 100MB, we recommend using multipart uploads"
- **Justification:** It's a recommendation, not a limit, so a single PUT up to 500 MB is allowed and multipart is deferred.

### [C5] — Project rules
- **Relevant File(s):** all PRs (process); `docs/plans/2026-11-06-mcp-attach-media.md`
- **Change Summary:** Branch + PR per change; red-first tests on the critical paths; the three checks.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/AGENTS.md#rules-every-agent-follows ; https://github.com/RobertdWray/jowray_com/blob/84f7d60/AGENTS.md#checks (refreshed 2026-11-07)
- **Verbatim Quote:**
  > "Every change goes on a branch with a PR." … "TDD for critical paths (upload tickets, finalize, confirmation, cron)."
  > "`npm run validate` (= `next typegen && tsc --noEmit`, then `eslint`), `npm run test:run`, `npm run build:offline`"
- **Justification:** It's why PR 1 (confirmation and cron) and PR 2 (upload tickets, finalize, cron) are red-first, and why each PR has its own branch and checks.

### [C6] — Blob SDK: signed-token auth and the PUT host
- **Relevant File(s):** `integrations/vercel-blob/index.ts`
- **Change Summary:** `presignPut` uses the existing read-write token; the upload host is `vercel.com`.
- **Source URL:** `node_modules/@vercel/blob/dist/create-folder-BM6BTlko.d.ts` L366-372 and `dist/chunk-XKVPKJPO.js` L110, L2020-2023 (v2.8.2); mirrored at https://github.com/vercel/storage/tree/main/packages/blob
- **Verbatim Quote:**
  > "Requests short-lived signed-token material from the Blob control API (`POST /signed-token`). Use OIDC (`VERCEL_OIDC_TOKEN` + `storeId` / `BLOB_STORE_ID`) or a read–write token like other SDK control-plane calls."
  > `var defaultVercelBlobApiUrl = "https://vercel.com/api/blob";`
- **Justification:** No new environment variable is needed, and `vercel.com` is the one host to allowlist (S0.3).

### [C7] — Which memories the site emails
- **Relevant File(s):** `features/admin/share-draft.ts`, `services/email/index.ts`
- **Change Summary:** The alert would fire after a share, so it's suppressed inside the share transaction; drafted sources never get confirmations.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/features/memories/site-email.ts#L15-L27
- **Verbatim Quote:**
  > "The admin alert is skipped only while the memory is a DRAFT (the admin made it); once shared it is a new memory like any other."
  > `return memory.status !== "DRAFT" && memory.source === "WEB_UPLOAD";`
- **Justification:** It's why R5 needs an explicit row, and why inserting that row while the memory is still a DRAFT is race-free (no creator acts on a DRAFT).

### [C8] — Skill rules to rewrite
- **Relevant File(s):** `docs/skills/jowray-draft-memory/SKILL.md`
- **Change Summary:** The Share rules (PR 1) and the "no file upload" sentence (PR 2).
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/docs/skills/jowray-draft-memory/SKILL.md#L42-L46 ; …/SKILL.md#L169 (refreshed 2026-11-07)
- **Verbatim Quote:**
  > "**Nobody presses Share.** Only the sender does, on their own claim page."
  > "**Rob never presses Share, and never edits a draft on its page.** The only button on a draft's page is Share, and Share is the sender's consent."
  > "The connector has no file upload"
- **Justification:** These lines contradict R4 and PR 2, so they change in the same PRs.

### [C9] — Site limits
- **Relevant File(s):** `features/admin/attach-media.ts`, `lib/validations/admin.ts`
- **Change Summary:** `request_upload` enforces the claim page's size and count limits.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/lib/media-types.ts#L18-L25
- **Verbatim Quote:**
  > `export const MAX_BYTES: Record<MediaKind, number> = { PHOTO: 25 * MB, VOICE: 100 * MB, VIDEO: 500 * MB, };`
  > `export const MAX_FILES_PER_MEMORY = 10;`
- **Justification:** The issue requires "Uploads must follow the site's existing limits".

### [C10] — Secrets policy and the current URL scrubber
- **Relevant File(s):** `lib/sentry/secrets.ts`, `lib/sentry/scrub.ts`, `lib/logger/logger.ts`
- **Change Summary:** Scrub `presignedUrl` and the `vercel-blob-*` query parameters.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/AGENTS.md#sentry-alpha-data-policy-2026-11-04 ; https://github.com/RobertdWray/jowray_com/blob/84f7d60/lib/sentry/scrub.ts#L32
- **Verbatim Quote:**
  > "Still forbidden everywhere: claim tokens in any form (`/m/<token>`, `?t=`, `claimToken(s)`, `claimLink`), upload tickets (`ticket`, `clientPayload`, `sig`)"
  > `const TOKEN_QUERY = /(^|[?&#])(t|key)=[^&#\s]*(?=[&#\s]|$)/g;`
- **Justification:** A presigned PUT URL is an upload credential, and neither the key list nor the regex matches it today.

### [C11] — ExifReader formats
- **Relevant File(s):** `lib/video-gps.ts` (new)
- **Change Summary:** Write a box reader instead of using ExifReader.
- **Source URL:** https://github.com/mattiasw/ExifReader#readme
- **Verbatim Quote:**
  > "Supports JPEG, JPEG XL, TIFF, PNG, HEIC, AVIF, WebP, and GIF files with Exif, IPTC, XMP, ICC, MPF, and more metadata (depending on file type)."
- **Justification:** It doesn't support MOV or MP4.

### [C12] — QuickTime location key
- **Relevant File(s):** `lib/video-gps.ts`
- **Change Summary:** `mdta` `keys`/`ilst` lookup and ISO 6709 parsing.
- **Source URL:** https://developer.apple.com/documentation/quicktime-file-format/quicktime_metadata_keys#Overview ; https://developer.apple.com/documentation/quicktime-file-format/location_metadata
- **Verbatim Quote:**
  > "com.apple.quicktime.location.ISO6709 | 'mdta’ | Defined in ISO 6709:2008. | Geographic point location by coordinates as defined in ISO 6709:2008. For example, “+27.5916+086.5640+8850/”."
  > "For all the location metadata keys defined in this specification, the Metadata atom handler-type should be 'mdta'."
- **Justification:** It names the key, the handler check and the string format the parser reads.

### [C13] — Android `©xyz`
- **Relevant File(s):** `lib/video-gps.ts`
- **Change Summary:** The second lookup path.
- **Source URL:** https://stackoverflow.com/questions/28916329/mp4-video-file-with-gps-location (secondary; confirmed against the ffmpeg fixture)
- **Verbatim Quote:**
  > "Android phone stores it in the [©xyz] atom, which is a member of [udta] atom, which in turn is a member of the [moov] atom."
- **Justification:** It covers family members with Android phones. Fixture 2 proves the layout.

### [C14] — claude.ai egress allowlist bug
- **Relevant File(s):** `SKILL.md`, `docs/features/mcp.md`, tool descriptions
- **Change Summary:** Document the Mac route next to the allowlist step.
- **Source URL:** https://github.com/anthropics/claude-code/issues/51400#issue
- **Verbatim Quote:**
  > "The additional-domain list does not enforce entries when the top-level mode is set to "Package managers only.""
- **Justification:** It's why D14 and R3's Mac route are documented as the fallback.

### [C15] — SKIPPED is claimable
- **Relevant File(s):** `services/email/index.ts`
- **Change Summary:** Add the terminal skip reason `admin_shared`, excluded from claims.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/services/email/index.ts#L58-L59 ; https://github.com/RobertdWray/jowray_com/blob/84f7d60/services/email/index.ts#L330-L336
- **Verbatim Quote:**
  > `/** Statuses a new send may claim from; a SENDING row is reclaimed only once its claim is stale. */ const CLAIMABLE = ["PENDING", "FAILED", "SKIPPED"] as const;`
  > "Skips (outbound guard, per-inbox cap, admin cap) leave a terminal SKIPPED row with the reason, so the reconcile cron does not pick the memory up again and again; a later request-path call may still claim it."
- **Justification:** A plain SKIPPED row wouldn't stop a later alert, which breaks R5 (Ext-3, builder Q2).

### [C16] — READY commits inside recordMedia, and the cron calls it
- **Relevant File(s):** `features/memories/ingest-upload.ts`, `app/api/cron/reconcile-uploads/route.ts`
- **Change Summary:** The admin checks and revision live inside `recordMedia`/`transition` (D10); cron step (b) warns on a late mismatch.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/features/memories/ingest-upload.ts#L111 ; https://github.com/RobertdWray/jowray_com/blob/84f7d60/app/api/cron/reconcile-uploads/route.ts#L218
- **Verbatim Quote:**
  > `const updated = await transition(row, { status: "READY", sizeBytes: head.size, blobUrl: head.url, mimeType: actualType });`
  > `const outcome = await recordMedia({ mediaId: row.id });`
- **Justification:** Checks done after `recordMedia` would be skipped whenever the cron completes the upload (Ext-1).

### [C17] — visibleMediaIds counts PENDING
- **Relevant File(s):** `features/memories/media-state.ts`, `features/memories/ingest-upload.ts`
- **Change Summary:** The ADMIN revision snapshots READY ids through a new `readyLiveMediaIds`.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/features/memories/media-state.ts#L16-L23
- **Verbatim Quote:**
  > `where: { memoryId, deletedAt: null, replacesMediaId: null },`
- **Justification:** There's no status filter, so before and after a PENDING → READY transition the snapshots would be identical (Ext-1).

### [C18] — computeChecksum has no deadline
- **Relevant File(s):** `features/memories/ingest-upload.ts`
- **Change Summary:** Add `{ signal }` to the hash read.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/features/memories/ingest-upload.ts#L195-L202
- **Verbatim Quote:**
  > `const file = await createStorageService().get(row.storageKey);` … `for await (const chunk of file.stream as unknown as AsyncIterable<Uint8Array>) { hash.update(chunk); }`
- **Justification:** An unbounded read can't fit D9's 25 s budget (Ext-5).

### [C19] — after() duration
- **Relevant File(s):** `features/admin/attach-media.ts`, `features/memories/ingest-upload.ts` (`scheduleReadyFollowUps`), `app/api/mcp/route.ts` (unchanged `maxDuration`)
- **Change Summary:** The finalize budget counts `after()` work against the route's 30 s.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/after#duration (same text in `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`)
- **Verbatim Quote:**
  > "after will run for the platform's default or configured max duration of your route. If your platform supports it, you can configure the timeout limit using the maxDuration route segment config."
- **Justification:** Derivation scheduled in `after()` gets only what remains of the 30 s, so D9 computes deadlines from the call's start.

### [C20] — readPrefix tolerates an ignored range, and get() exposes headers
- **Relevant File(s):** `integrations/vercel-blob/index.ts`, `services/storage/types.ts`
- **Change Summary:** `readRange` requires a matching `Content-Range`.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/integrations/vercel-blob/index.ts#L103-L110 ; `node_modules/@vercel/blob/dist/index.d.ts` L174-185
- **Verbatim Quote:**
  > "should the host ever send the whole file, only `maxBytes` are read before the stream is cancelled, so the transfer stays bounded either way."
  > "/** The raw headers from the fetch response. */ headers: Headers;"
- **Justification:** At offset 0 an ignored range is harmless; at offset N it returns the wrong bytes. The headers are available to check (Ext-4).

### [C21] — 206 and Content-Range
- **Relevant File(s):** `integrations/vercel-blob/index.ts` (`readRange`)
- **Change Summary:** Accept only a single-range answer that carries `Content-Range`.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/206
- **Verbatim Quote:**
  > "If a single range is requested, the Content-Type of the entire response is set to the type of the document, and a Content-Range is provided."
- **Justification:** A missing or mismatched `Content-Range` means the range wasn't honoured, so the read is `failed` (A20).

### [C22] — GPS outcome is durable: decided vs not yet
- **Relevant File(s):** `features/media/extract-photo-gps.ts`
- **Change Summary:** Videos follow the same rule: only found or fully-parsed-absent is stamped.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/features/media/extract-photo-gps.ts#L51-L52
- **Verbatim Quote:**
  > "The outcome is durable on the row: `gpsCheckedAt` set means decided (found or absent), null means not yet, and `gpsAttempts` counts claimed reads up to MAX_GPS_ATTEMPTS (D3)."
- **Justification:** A transient range failure must leave `gpsCheckedAt` null (Ext-4).

### [C23] — Lock order and the renewal logic
- **Relevant File(s):** `features/memories/create-memory.ts`, `features/memories/issue-upload-ticket.ts`, `features/admin/attach-media.ts`
- **Change Summary:** Extract `reservePendingMedia` and `renewPendingReservation` as tx-taking helpers; admin request order lease → memory → budget.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/features/memories/create-memory.ts#L250-L258 ; https://github.com/RobertdWray/jowray_com/blob/84f7d60/features/memories/issue-upload-ticket.ts#L78-L97
- **Verbatim Quote:**
  > "// Anchor first, then this memory: the one lock order every multi-memory writer shares (C25)." `await renewUploadLease(tx, memory); await lockMemory(tx, memory.id);`
  > `await renewUploadLease(tx, memory); await lockBudget(tx);`
- **Justification:** The admin path keeps the global order, and the helpers assume the locks are held (Ext-6).

### [C24] — Prisma transactions don't nest
- **Relevant File(s):** `features/memories/create-memory.ts`, `features/memories/issue-upload-ticket.ts`, `features/admin/attach-media.ts`, `features/admin/share-draft.ts`
- **Change Summary:** Helpers take `tx`; only top-level feature functions open a transaction.
- **Source URL:** https://www.prisma.io/docs/orm/fundamentals/transactions
- **Verbatim Quote:**
  > "Do not open a second transaction inside the helper, because calling db.transaction(...) again inside a callback does not nest: the inner call is a separate transaction that commits or rolls back on its own, and the outer one cannot roll it back."
- **Justification:** It's the rule behind D12's "one owner" design.
- **Correction (PR #72 research, 2026-11-07):** this quote is from the Prisma ORM 8 docs. On the installed Prisma 7.10 (since 7.5.0), `tx.$transaction` inside a transaction nests as a savepoint (confirmed in the runtime and the captured SQL `SAVEPOINT prisma_sp_0`). D12's rule still stands for clarity and lock order: helpers take `tx`, only top-level features open a transaction, and a helper must never call `getDb()` inside one (that query would run outside the transaction and block on the held row lock until `P2028`).

### [C25] — Approving doesn't publish
- **Relevant File(s):** `app/api/mcp/tools.ts` (`share_draft` description), `SKILL.md`, `docs/features/mcp.md`
- **Change Summary:** R4a: say that APPROVED is not public.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/app/admin/status-actions-client.tsx#L185
- **Verbatim Quote:**
  > "Approving doesn&rsquo;t publish anything yet; the public memorial pages aren&rsquo;t built."
- **Justification:** "Publish drafts live" can only mean APPROVED today (Ext-7); F1 tracks the real publication.

### [C26] — Environment load order
- **Relevant File(s):** `scripts/e2e/mcp-attach/*`, the E2E run procedure (§5)
- **Change Summary:** Override outbound settings in the process environment.
- **Source URL:** https://nextjs.org/docs/app/guides/environment-variables#environment-variable-load-order
- **Verbatim Quote:**
  > "Environment variables are looked up in the following places, in order, stopping once the variable is found. process.env .env.$(NODE_ENV).local .env.local … .env.$(NODE_ENV) .env"
- **Justification:** Setting `OUTBOUND_ENABLED=false` in the process environment wins over `.env`, so the E2E run can't send real email.

### [C27] — Outbound and places settings
- **Relevant File(s):** E2E environment (§5), `scripts/e2e/mcp-attach/readback.ts` (stub-label assertion)
- **Change Summary:** Outbound off, empty allowlist, places stub.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/docs/environment.md#L85-L86 ; https://github.com/RobertdWray/jowray_com/blob/84f7d60/docs/environment.md#L119
- **Verbatim Quote:**
  > "`OUTBOUND_ENABLED` | Strict `"true"`/`"false"`. When false, email goes only to `OUTBOUND_ALLOWLIST`."
  > "Preview and local runs use `stub`, which answers "Photo location found near {lat}, {lon} (test)" without any network"
- **Justification:** `false` alone still mails allowlisted addresses, so the allowlist must be empty. The stub label is what the E2E run asserts.

### [C28] — Neon schema-only branches
- **Relevant File(s):** E2E environment (§5), S0.4
- **Change Summary:** The E2E database has no copied rows.
- **Source URL:** https://neon.com/docs/guides/branching-schema-only#creating-schema-only-branches
- **Verbatim Quote:**
  > "Neon supports creating schema-only branches, letting you create branches that replicate only the database schema from a source branch, without copying any of the actual data."
  > "You can create schema-only branches in the Neon Console or using the Neon API, in much the same way you create any Neon branch. Support for the Neon CLI will come in a future release."
- **Justification:** The cron then acts only on test rows, never on copied dev rows whose blobs share the store.

### [C29] — CI Node version
- **Relevant File(s):** cold-start procedure (§0)
- **Change Summary:** Use Node 26 locally.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/.github/workflows/ci.yml#L39
- **Verbatim Quote:**
  > `node-version: 26`
- **Justification:** The shell's default Node is 22; checks must match CI.

### [C30] — Sentry records MCP inputs and outputs
- **Relevant File(s):** `lib/sentry/secrets.ts`, `lib/sentry/scrub.ts`
- **Change Summary:** The presigned URL in a tool result reaches span attributes unless scrubbed.
- **Source URL:** https://docs.sentry.io/platforms/javascript/configuration/options/#dataCollection
- **Verbatim Quote:**
  > "`mcp` | `{ inputs?, outputs? }` | both `true` | … `outputs`: Collect the content of MCP responses, such as tool results and prompt result messages."
- **Justification:** Tool results are collected by default (and the repo sets `genAI` on), so `presignedUrl` must be scrubbed (A19).

### [C31] — beforeSendSpan scrubs spans
- **Relevant File(s):** `lib/sentry/scrub.ts` (`scrubSpan`, wired in `instrumentation.ts`)
- **Change Summary:** The new keys and parameters are removed where spans are scrubbed today.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#beforeSendSpan
- **Verbatim Quote:**
  > "Called for each finished span before it is sent to Sentry, including service spans and their child spans. Return the modified span to rename it or remove sensitive data."
- **Justification:** It confirms that extending `scrubSecrets`/`scrubUrl` covers MCP span attributes.

### [C32] — MCP: human in the loop; annotations are hints
- **Relevant File(s):** `app/api/mcp/tools.ts`
- **Change Summary:** `share_draft` is `destructiveHint: true` (approval prompt); the upload tools are additive.
- **Source URL:** https://modelcontextprotocol.io/specification/2025-11-25/server/tools#user-interaction-model
- **Verbatim Quote:**
  > "For trust & safety and security, there SHOULD always be a human in the loop with the ability to deny tool invocations."
  > "For trust & safety and security, clients MUST consider tool annotations to be untrusted unless they come from trusted servers."
- **Justification:** Consent on someone's behalf needs Rob's per-call approval. The annotations steer claude.ai's prompts but don't replace the server-side checks.

### [C33] — Function payload limit
- **Relevant File(s):** `features/admin/attach-media.ts` (design D1)
- **Change Summary:** Bytes go straight to Blob, never through a jowray.com route.
- **Source URL:** https://vercel.com/docs/functions/limitations#request-body-size
- **Verbatim Quote:**
  > "The maximum payload size for the request body or the response body of a Vercel Function is 4.5 MB."
- **Justification:** A 3 MB HEIC as base64 is about 4 MB, and videos are far larger.

### [C34] — The cron emails memories that become "ready"
- **Relevant File(s):** `features/admin/attach-media.ts` (`not_ready`)
- **Change Summary:** D7 refuses uploads that would flip a non-DRAFT memory to ready.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/app/api/cron/reconcile-uploads/route.ts#L322-L337
- **Verbatim Quote:**
  > "// (e) Memories with an address and something READY (or TEXT) that were never emailed and are old enough that no request-path confirm is still running."
  > `const ready = [{ type: "TEXT" as const }, { contributorNote: { not: null } }, { media: { some: { status: "READY" as const, deletedAt: null } } }];`
- **Justification:** An admin file must not trigger the sender's first confirmation or the alert (builder Q4).

### [C35] — Place suggestions read photos only
- **Relevant File(s):** `features/places/suggest-for-memory.ts`
- **Change Summary:** Use `hasLocationReader` instead of the `image/` filter.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/features/places/suggest-for-memory.ts#L44
- **Verbatim Quote:**
  > `where: { deletedAt: null, status: "READY", mimeType: { startsWith: "image/" }, latitude: { not: null }, longitude: { not: null } },`
- **Justification:** Without this, video coordinates would never produce suggestions (R2).

### [C36] — Cron GPS backfill is photo-only
- **Relevant File(s):** `app/api/cron/reconcile-uploads/route.ts`
- **Change Summary:** Step (h) uses `hasLocationReader`; step (g) stays image-only.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/app/api/cron/reconcile-uploads/route.ts#L667-L676
- **Verbatim Quote:**
  > "// (h) Photo GPS (plan 2026-11-06-photo-gps-places B3): READY photos of this environment whose GPS is not decided" … `mimeType: { startsWith: "image/" },`
- **Justification:** Retries and backfill must reach videos too.

### [C37] — Webhook GPS is photo-only
- **Relevant File(s):** `app/api/upload/route.ts`
- **Change Summary:** Schedule location for videos.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/app/api/upload/route.ts#L113-L115
- **Verbatim Quote:**
  > `if (blob.contentType.startsWith("image/")) {` … `await extractPhotoGps({ mediaId });`
- **Justification:** Claim-page videos get location the same way photos do.

### [C38] — Media columns and pathnames
- **Relevant File(s):** `prisma/schema.prisma`, the new migration
- **Change Summary:** Add `addedVia` and `declaredSha256`; `checksumSha256` stays the verified hash.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/prisma/schema.prisma#L159-L201
- **Verbatim Quote:**
  > `storageKey String @unique // Blob pathname: <env prefix><memoryId>/<uuid>.<ext> (originals/, preview/originals/, dev/originals/); write-once`
  > `checksumSha256 String? // null until the background hash or the cron runs`
  > `maxBytes Int // ticketed limit; summed for the daily byte budget`
- **Justification:** A verified hash already has a home; the declared hash needs its own, and `maxBytes` holds the exact declared size (D3).

### [C39] — MCP feature doc approvals
- **Relevant File(s):** `docs/features/mcp.md`
- **Change Summary:** The tool count, approvals, upload flow and R4a.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/f909f7b/docs/features/mcp.md#L16 (re-pinned 2026-11-07: PR #69 changed the file; the quoted sentence is unchanged, its suffix now reads "it writes cache, quota and throttle rows")
- **Verbatim Quote:**
  > "In Claude, Rob sets **requires approval** on the six tools that write, so Claude asks before each call: the five annotated `destructiveHint: true` and `draft_memory`."
- **Justification:** `share_draft` makes seven, and the doc must say so.

### [C40] — Row creation normally happens under the outbound lock
- **Relevant File(s):** `services/email/index.ts` (`suppressAdminAlertForDraftShare`)
- **Change Summary:** Document the one exception and why it's safe.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/services/email/index.ts#L497-L503
- **Verbatim Quote:**
  > "Record that there is nothing to send for this memory and type, as a terminal SKIPPED row, so the reconcile cron stops selecting it. … Taken under the outbound lock like every other row creation, so no creator ever races another"
- **Justification:** The new helper relies on the DRAFT guard instead [C7]. Its doc comment must state that precondition.

### [C41] — Storage interface
- **Relevant File(s):** `services/storage/types.ts`, `integrations/vercel-blob/index.ts`
- **Change Summary:** Add `presignPut` (PR 2) and `readRange` (PR 3) next to their siblings.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/services/storage/types.ts#L45-L48
- **Verbatim Quote:**
  > `readPrefix(pathname: string, maxBytes: number, options?: StorageGetOptions): Promise<Uint8Array | null>;` … `presignGet(options: PresignGetOptions): Promise<PresignGetResult>;`
- **Justification:** The new methods follow the existing shape and layer (services interface, integrations implementation).

### [C42] — Strict MCP schemas
- **Relevant File(s):** `lib/validations/mcp.ts`, `lib/validations/admin.ts`
- **Change Summary:** Strict schemas for `share_draft`, `request_upload` and `finalize_upload`.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/lib/validations/mcp.ts#L52 ; https://github.com/RobertdWray/jowray_com/blob/84f7d60/AGENTS.md#layers-and-import-direction
- **Verbatim Quote:**
  > `export const mcpMemoryIdSchema = adminMemoryIdSchema.strict();`
  > "Route handlers validate input with zod schemas from `lib/validations`"
- **Justification:** New tools follow the same strict admin-schema pattern.

### [C43] — Logger redaction rule
- **Relevant File(s):** `lib/logger/logger.ts`
- **Change Summary:** Add `presignedUrl` to the redacted keys.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/AGENTS.md#layers-and-import-direction
- **Verbatim Quote:**
  > "Server code logs with Pino (`lib/logger`), never `console.log`. The logger redacts … the bearer link (`claimLink`) … Log ids (`memoryId`, `mediaId`), never Prisma rows or people."
- **Justification:** A bearer upload URL gets the same treatment as the bearer claim link.

### [C44] — Evidence and fixture policy
- **Relevant File(s):** `docs/plans/evidence/2026-11-mcp-attach/*`, `__tests__/fixtures/*`
- **Change Summary:** The evidence folder convention; no family media or full-precision points.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/docs/plans/evidence/2026-11-photo-gps/README.md
- **Verbatim Quote:**
  > "Coordinates in this folder are rounded to 2 decimal places (about 1 km). No family photo, claim link or full-precision point is committed. Test fixtures use the Statue of Liberty (40.689247 N, 74.044502 W)"
- **Justification:** PR 2 and PR 3 evidence and the video fixtures follow the same rules.

### [C45] — Fixture generation precedent
- **Relevant File(s):** `__tests__/fixtures/README.md`, `__tests__/fixtures/iphone-location.mov` (new), `scripts/fixtures/shrink-mdat.mjs` (new)
- **Change Summary:** Document the exiftool/ffmpeg commands and tool versions for the video fixtures.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/84f7d60/__tests__/fixtures/README.md
- **Verbatim Quote:**
  > "`gps.heic`: `tiny.heic` with a GPS IFD added, at the plan's public fixture point (the Statue of Liberty, 40.689247 N, 74.044502 W) … It carries no other new tags (no make, model, date or owner)."
- **Justification:** The iPhone clip is sanitized the same way: Liberty point, no make, model or date.

### [C46] — Astra runs start from committed HEAD; workers have no network
- **Relevant File(s):** §3 Execution model, §0.4, §0.10, S0.1, S0.2 (process; no product file)
- **Change Summary:** Foundation work is committed in W1 before `init`; the orchestrator does every network step and installs dependencies; at most two workers at once.
- **Source URL:** `/Users/rob/.claude/skills/astra-work/references/runner.md` § Prepare (L10-L17); `/Users/rob/.claude/skills/astra-work/SKILL.md` § Establish the task (L33-L35, L41-L43)
- **Verbatim Quote:**
  > "The starting commit is the current checkout's HEAD, not uncommitted files."
  > "**More than two concurrent workers requires an explicit user reply approving the count.** Waiting is not approval."
  > "Worker shell networking is off; perform necessary network-dependent checks yourself."
- **Justification:** These rules are why the plan, F2 and F3 are committed in W1 before each run; why `npm ci`, the spike and E2E belong to the orchestrator; and why the waves pair tasks two at a time.

### [C47] — Rob's plan-to-ship loop
- **Relevant File(s):** §3 Execution model (roles, review loop, parking lot)
- **Change Summary:** Astra builds the independent tasks; deep-context tasks stay with the orchestrator; TCR reviews each PR; four buckets; 1–3 repair cycles; Rob ships.
- **Source URL:** `/Users/rob/Documents/active_work/TrayVerify/sales-mid-market-scoring/docs/workflows/orchestration.md` § Rules (L157-L167)
- **Verbatim Quote:**
  > "The plan marks each task Astra or linear. Deep-context tasks stay in the orchestrator and run one after another."
  > "Astra workers run two at a time, one owner per file, with no network, so the orchestrator runs every step that needs one."
  > "The orchestrator inspects every repair, then the repair commits go back through `/team-code-review`."
- **Justification:** The who-does-what table marks every task Astra or orchestrator, keeps the deep-context foundations (completion path, fixtures) with the orchestrator, and sends every repair head back through TCR.

## Appendix A — Issue to file (verbatim as given by Rob, 2026-11-06)

````markdown
<!-- severity:medium -->

# MCP connector can't attach photos or videos: `draft_memory` only makes text drafts, and no tool accepts a file

**Repo / branch:** `RobertdWray/jowray_com`, `main` at `84f7d60` (merge of PR #68, 2026-11-06)
**Type:** bug (gap in the MCP endpoint)
**Labels:** `severity:medium`, `bug`
**Severity:** medium. Nothing is broken and no data is at risk. But every photo or video memory drafted through the connector needs a manual upload, done on a device that has the files.

## What happened (2026-11-06)

Tracy gave Rob 21 iPhone files of Jo: 16 photos (HEIC and JPG) and 5 videos (MOV, two of them Live Photo clips). In a claude.ai session linked to Rob's Mac, Claude read each file's date and GPS, wrote a caption and saved 18 DRAFT memories through the jowray connector.

Every draft came back as `type: "TEXT"` with `media: []`, and the connector offered no way to add the photos. None of its nine tools accepts a file, a file URL or an upload request: `list_memories`, `get_memory`, `draft_memory`, `set_coordinates`, `update_memory`, `set_status`, `set_deleted`, `reissue_claim_link` and `suggest_places`. The skill doc already says this: "The connector has no file upload" (`docs/skills/jowray-draft-memory/SKILL.md`, line 169).

The only way to add the files is the claim page's **Add a photo, video or recording** control. For this batch, that means opening 18 links one at a time, by hand, on a device that has the files. The two Live Photo clips exist only on Rob's Mac, so Tracy can't add them from her phone.

## Steps to reproduce

1. From any Claude session with the jowray connector, call `draft_memory` with a note.
2. Call `get_memory` on the new id. It returns `type: "TEXT"` and `media: []` (`features/memories/draft-memory.ts`, line 91).
3. Look for a tool that adds a file to that memory. None exists.

## Expected

An admin can attach photos and videos to a memory (at least a DRAFT) through the connector. The file goes through the same pipeline as the claim page: ticket, Blob upload, finalize, GPS extraction and the web copy. No one has to open the claim page.

## Impact

- Most of what the family sends is photos and videos. Claude can't finish any of those memories. Each one needs its own manual upload, and someone has to match files to captions by filename.
- `suggest_places` returns nothing until a file is attached, because it reads GPS from the uploaded originals. For this batch Claude had to look up the places from the files itself.
- Tracy's review page shows a caption with no picture, so she has to find each photo herself before she can check the words.
- Browser automation on the claim page is not a safe substitute. Claude in Chrome uploads at most 10 MB per call, and one video here is 28 MB. It also puts an agent on a page whose main button is Share, which only the sender may press.

## Constraints a fix has to handle (seen in this session)

- The model can't pass file bytes as a tool argument. A 3 MB HEIC is about 4 MB of base64, and videos can be up to 500 MB. The bytes have to go from a shell to an upload URL.
- Neither Claude's cloud container nor the Linux VM on Rob's Mac could reach `www.jowray.com`, `vercel.com/api/blob` or `blob.vercel-storage.com`; the egress proxy refused all three. An upload URL works only after those hosts are added to the account's allowed domains (claude.ai, Settings → Capabilities), or if the upload goes to a host that is already allowed.
- A Vercel Function accepts at most a 4.5 MB request body. So the bytes should go straight to Blob, as `lib/upload-client.ts` does now, not through a jowray.com route.
- Uploads must follow the site's existing limits (`lib/media-types.ts`): photos up to 25 MB and videos up to 500 MB, with HEIC and QuickTime supported.

## Suggested direction (for the team to decide)

Two admin tools that reuse the claim page's parts, `issueUploadTicket` (`features/memories/issue-upload-ticket.ts`) and `finalizeUpload` (`features/memories/ingest-upload.ts`):

1. `request_upload(memoryId, file: { name, type, size })` returns the ticketed pathname and a short-lived upload URL or token.
2. The session uploads the bytes from its shell, with curl or a small script.
3. `finalize_upload(memoryId, ticket)` records the file, runs GPS extraction and derivation, and returns the media id and status.

A laptop fallback in the style of `scripts/draft-memory.ts` (for example `--attach <file>`) would cover sessions whose network can't reach Blob. Nice to have: attach a Live Photo pair (HEIC + MOV) to one memory.

## Done when

- From a claude.ai session, Claude can attach a HEIC, a JPG and a MOV to a DRAFT without opening its claim page.
- Each file reaches READY with its GPS saved, and `suggest_places` returns place names for it.
- The memory stays DRAFT, `consentedAt` stays null, and no email goes out.
- Attaching the same file twice doesn't add a second copy.
- No claim token or upload ticket appears in the new tools' logs or Sentry events (`lib/sentry/secrets.ts`).
- Tests cover the new tools. Upload tickets and finalize are TDD paths under `AGEN.md`.

**Workaround until then:** open each claim link in a browser on a device that has the files and use only **Add a photo, video or recording**. Only the sender presses Share.
````

Notes for whoever files it:
- **Labels:** `severity:medium` may not exist; create it.
- **"Done when" vs this plan:**
  - "From a claude.ai session" is met by a session with the files on disk (D14).
  - The suggested `finalize_upload(memoryId, ticket)` became `(memoryId, mediaId)` (D2).
  - The laptop fallback was declined (R3).
- **Typo:** `AGEN.md` in the issue means `AGENTS.md`.

## Appendix B — Second issue (share on behalf), short

**Title:** MCP: share a draft on the sender's behalf (`share_draft`), optionally straight to APPROVED

**Body:**
- `set_status` refuses DRAFT ("only the sender's Share leaves DRAFT").
- Rob needs to record a sender's consent, given in person or by message, from the connector: DRAFT → PENDING or APPROVED, with the same `consentedAt` / `consentVersion` stamp as Share and an ADMIN revision.
- No admin alert, ever (the admin did it).
- The sender's preferences are unchanged, and their claim link keeps working.
- APPROVED publishes nothing public yet (public pages are not built).

**Done when:** the tool exists with an approval prompt; tests cover stamp, revision, suppression, and sender activity after the share; the skill's Share rules are updated. Plan: `docs/plans/2026-11-06-mcp-attach-media.md`.
