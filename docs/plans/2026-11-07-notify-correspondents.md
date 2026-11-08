# Notify Jo's correspondents: harvest, invite links, Sentry unmasking, and send readiness (issue #59)

> **Design and rulings record.** §4 Ledger is a frozen snapshot; the live Ledger is `/Users/rob/.claude/plans/can-you-please-build-gleaming-sonnet.md`. Ledger frozen at F0 (2026-11-07). Never resume execution from this copy's Ledger.

| | |
|---|---|
| Plan revision | **v2**, 2026-11-07. v1 was reviewed by A3 (premortem: `/team-code-review` on this file: George 1–16, Oscar 17–37, Claude 38–44). Every finding was checked against the source and sorted into four buckets (§15); Buckets 1+2 are applied here, Bucket 3 is in §16, Bucket 4 in §17 |
| Approval state | **Approved 2026-11-07** (Rob: "In a new worktree, Execute this plan please."). Rob ruled R1–R14 in session on 2026-11-07, and R1 and R12 were amended in v2 (§2). The planner made calls D1–D30; they stand unless Rob vetoes one |
| **Live Ledger (single source of execution state)** | **`/Users/rob/.claude/plans/can-you-please-build-gleaming-sonnet.md` §4** (this file). The repo copy committed in F0 (`docs/plans/2026-11-07-notify-correspondents.md`) is the **design and rulings** record. Its §4 is a frozen snapshot, and its banner says so. Never resume from the repo copy's Ledger |
| Memory pointer | `/Users/rob/.claude/projects/-Users-rob-Documents-active-work-jowray-com/memory/notify-correspondents-plan-state.md` |
| A3 review log | `/Users/rob/Downloads/team-review-20261107-181951-jowray_com-plan-notify-f909f7b.md` |
| Repo | `RobertdWray/jowray_com` (`--repo` derived from `git remote -v`). Main checkout: `/Users/rob/Documents/active_work/jowray_com` (never work in it) |
| Baseline | `origin/main` = **`7bbd54a`** (PR #88), 2026-11-07. `git diff --stat 4f0a9a2 7bbd54a` over every path this plan cites is empty, so line numbers from `4f0a9a2` hold. Issue #59 was written at `982a141` |
| Source issue | [#59](https://github.com/RobertdWray/jowray_com/issues/59). Its §4 excerpts, §5 checks and §7.4 alternatives still apply, except where §1.2 or §2 says otherwise |

## 0. Cold start (a new agent or a compacted session starts here)

1. **Read, in this order:**
   1. §4 Ledger: find the first row that isn't ✅ and read its "Next action".
   2. §2 Rulings and calls.
   3. §16 Non-goals: don't re-open these.
   4. `AGENTS.md` [C39–C42].
   5. `docs/code-layout.md`.
   6. Issue #59.
   7. The section of this plan for that row.
2. **Check reality before trusting the Ledger.** For each ✅ row, re-check its evidence:
   - **Branches:** `git ls-remote origin <branch>`.
   - **PRs:** `gh pr view <n> --repo RobertdWray/jowray_com --json state,mergeCommit,headRefOid`.
   - **Production deploy:** list Production deployments with `gh api 'repos/RobertdWray/jowray_com/deployments?environment=Production&per_page=5' --jq '.[] | {id,sha,created_at}'`, then require `gh api repos/RobertdWray/jowray_com/deployments/<id>/statuses --jq '.[0].state'` = `success` for the expected SHA [review #31].
   - **Migration:** `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = '20261107120000_invites'` must show `finished_at` set and `rolled_back_at` null. Run it read-only through the claude.ai Neon connector `run_sql`; its project ID is `NEON_PROJECT_ID` in the main checkout's `.env` (not a secret, but don't paste it into the repo). The production branch is the project's default branch (`get_default_branch`).
   - **Sentry settings:** `sentry api /projects/med3ai/jowray_com/` (fields `dataScrubber`, `dataScrubberDefaults`, `relayPiiConfig`) and `sentry api /organizations/med3ai/`.
   - **Private files** in `~/jo-mail-review/`: names, modes and row counts only, **never their contents**.
   - **Thunderbird add-ons:** `ls ~/Library/Thunderbird/Profiles/itl33f39.default-release/extensions`.

   **Drift rule** [review #15, #32]:
   - If reality is **ahead** of the Ledger and has evidence, mark the row ✅ with that evidence.
   - If reality is **behind** a ✅ row, or shows an unexpected SHA or setting, **stop and ask Rob** before changing any remote state. Every row that depends on a drifted row loses its ✅ until re-checked.
3. **Runtime.**
   - **Node:** prefix commands with `export PATH=/opt/homebrew/bin:$PATH` to get Node 26, as CI does; the default is nvm v22.
   - **Python:** run the harvester suite under `/usr/bin/python3` (3.9.6, the floor) **and** `python3` (3.11.10).
   - **Local DB:**
     - Start it: `docker run --rm -d --name jowray-pg -p 55432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jowray_test postgres:18-alpine` [C44].
     - Always pass `DATABASE_URL_UNPOOLED=postgresql://postgres:postgres@localhost:55432/jowray_test` explicitly. `prisma.config.ts` otherwise loads `.env.local`, which points at the Neon dev branch.
     - Use the same URL for `TEST_DATABASE_URL`.
4. **Worktrees and branches** [review #39]:
   - **WT** = `/Users/rob/Documents/active_work/jowray_wt_notify`, the one source worktree. "W1–W5" are *task* names, never the worktree.
   - Local branches `notify/pr1` and `notify/pr2` are **only the starting points for Astra `init`**. They are never pushed and never PR'd.
   - Each Astra run's PR is opened by `publish` from **`astra-work/<run>/integration`**, which lives under `~/.local/state/astra-work/<repo-hash>/<run>/integration`.
   - **The orchestrator's own commits after `init`** go **on the run's integration worktree**: L-W, L-P, plan snapshots, and evidence summaries safe for a public repo. Then re-run the combined checks before `publish`. This is the #69 precedent (`edb574d`).
   - **Recovery key:** the run dir in the Ledger; resume with `/astra-work resume <run-dir>`.
5. **Checks** [C39]:
   - Run `npm run validate`, `npm run test:run` and `npm run build:offline` with **no `.env*` in the worktree** and `DATABASE_URL` unset.
   - Python: `/usr/bin/python3 -m unittest discover -s scripts/notify -p "test_*.py"` (and the same with `python3`).
   - Integration suites run only where `TEST_DATABASE_URL` is set, meaning the orchestrator and CI. Astra marks them "not run", never as passed.
6. **Secrets, private values and evidence** [review #14, #16, #35]:
   - **Private parameters** live in **`~/jo-mail-review/notify.env`** (mode 0600, outside git), written once by the orchestrator from Rob's answers:
     - `PRIMARY_HOTMAIL`, `SECOND_HOTMAIL`, `ROB_GMAIL`, `REHEARSAL_TO` (a Rob address other than Gmail);
     - `HOUSEHOLD_NAMES` (`|`-separated);
     - `EXCLUDE_FILE=~/jo-mail-review/exclude.txt`.

     Commands use them inside a subshell, `( set -a; . ~/jo-mail-review/notify.env; set +a; <command using "$PRIMARY_HOTMAIL"> )`, and never `echo` them. If the file is missing, ask Rob; never guess.
   - **Never print or commit:**
     - a secret value;
     - an invite token or share URL;
     - a correspondent's name or email;
     - any value from `notify.env`.

     The repo is public. Repo docs use the placeholders `<PRIMARY_HOTMAIL>`, `<SECOND_HOTMAIL>`, `<ROB_GMAIL>` and `<REHEARSAL_TO>`.
   - **Evidence has two homes:**
     - **Private:** `~/jo-mail-review/evidence/` (0700). Raw outputs, screenshots and anything that has names in it.
     - **Public-safe:** counts, SHAs and settings only, committed in the PR-3 docs PR (§10 D10) under `docs/plans/evidence/2026-11-notify/`.

     A worktree is never deleted while it holds uncommitted evidence.
   - **The harvester's console output is counts-only (D8).** The orchestrator never `cat`s or `Read`s `correspondents.csv`, the send lists, the ledgers or `mail.sqlite` rows; Rob opens them himself.
   - **`.env`:** scripts use `--env-file=/Users/rob/Documents/active_work/jowray_com/.env` (an absolute path to the main checkout). Never copy `.env*` into a worktree.
   - **`vercel`:** never run it inside a repo checkout (it overwrites `.env.local`). Firewall commands run from the scratchpad with `--project jowray-com --scope rob-wrays-projects`; confirm the project slug first with `vercel project ls --scope rob-wrays-projects` from the scratchpad.
7. **Don'ts** [C39]:
   - no force-push;
   - no `eslint-disable` without Rob's all-caps "YES";
   - no band-aids;
   - no destructive Neon, Blob, Vercel or Sentry action outside a step Rob approved;
   - every change goes on a branch with a PR (the `main` ruleset requires `ci`);
   - **nothing is ever queued in Send Later for a correspondent under this plan (R1).**
8. **Worker budget:** the runner enforces ≤ 2 workers **per run** only. Before each launch, the orchestrator checks `status` for **both** runs and keeps the total at ≤ 2 (R2).
9. **Astra mechanics** (skill `astra-work`, `/Users/rob/.claude/skills/astra-work/SKILL.md`; runner reference `…/references/runner.md`; memory "astra-launch-command-alone"):
   - After `prepare`, run `npm ci` and `npx prisma generate` in each TS task worktree (workers have no network).
   - The background `astra_work.py run`/`check` command must be **alone** in its Bash call.
   - Briefs carry R1–R14, the relevant D-calls, §16 (so workers don't "fix" non-goals), and the personal-data rule.
10. **Workflow templates** (full paths) [review #13, #34]. Directory: `/Users/rob/Documents/active_work/TrayVerify/sales-mid-market-scoring/docs/workflows/`. Files:
    - `premortum.md` (sic);
    - `friend-buckets-plan-review.md`, `bucket-plan-sorting.md`;
    - `friend-buckets-issue-review.md`, `bucket-work-sorting.md`;
    - `document-issue.md`;
    - `final pr review instrucionts.md` (sic, with spaces). Open it **only** at merge-readiness.

    **Buckets:**
    1. Must do.
    2. Nice to do.
    3. Don't do, with the reason, recorded in §16 or a PR comment.
    4. Real but out of scope, recorded in §17 and the PR notes with severity.
11. **If a tool or reviewer is unavailable** [review #34]:
    - **Reviewers:** TCR is complete only when George **and** Oscar both succeed. If one fails, retry once. If it still fails, record that in the Ledger and ask Rob whether to proceed with a partial review. Never call a partial review complete.
    - **Neon connector failure:** use `psql` with a read-only role Rob provides, or ask Rob.
    - **Sentry CLI auth failure:** ask Rob to run `! sentry auth login`.
12. **After every step,** update its Ledger row: status, SHA, PR, run dir, evidence path, and next action.

## 1. Context

### 1.1 Why

Jo Wray died on 2026-11-02. Rob will email the people the household corresponded with: one personal note each, from the Hotmail account that person knew, with the obituary link and a personal `/s/<token>` link that opens the memory form already filled in.

Issue #59 has three parts:
1. **Harvest:** the Python script over the Thunderbird mbox files.
2. **Paced send:** Mail Merge + Send Later.
3. **Invite link:** `/s/<token>` prefill.

Rob added a fourth: **replays mask form entries; fix it in this PR** (R12, R13).

**Outcome: a "Ready" report (§10 D9), then STOP (R1).** Ready means:
- PR-2 and PR-1 are merged and live, and the Invite migration has finished on production.
- `/s/` is verified on production: headers, read-only GET, token scrubbing, WAF, and a working prefill for Rob's own invite.
- Replays show form placeholders and entries unmasked.
- The harvest is done and reviewed by the family.
- Invites are imported and every approved row has a `share_url` in the private ledger.
- Add-ons are installed with the **hold** on; there is one OAuth test send per account; the dress rehearsal (two messages to Rob's own addresses only) has passed; the per-account templates are saved; Send Later's queue and the Outbox are empty.

The go-day steps are written down but **not executed**.

### 1.2 What changed or was found (verified 2026-11-07)

| Area | Finding | Effect |
|---|---|---|
| Harvester | `~/Downloads/rank_correspondents (1).py`: sha256 `762a80ca…bd1d04`, 1,221 lines, **matches the issue**. `~/Downloads/rank_correspondents.py` (1,120 lines) is an older copy and is ignored. No tests. `kay@aol.com` in the docstring is made up (R14) | R7 |
| **Mail Merge 11.6.1 (shipped XPI, sha256 `b0645b89d7891dee…`)** | `dialog.js`:<br>• :419 shows the **"At" field only when Deliver Mode = Save As Draft** and Send Later is active.<br>• :1150 and :1195–1197 add `X-Send-Later-At/-Uuid/-Recur` **only** in Save As Draft.<br>• :777: Deliver Mode "Send Later" calls Thunderbird's native `sendMessage(id, { mode: "sendLater" })`, which puts **unscheduled** mail in the Outbox.<br>• :202: "SendLater" is the **default**.<br>• :1199: header errors are caught with `console.warn` only [C50, C51] | D10 (review #1, #17, #23) |
| Send Later | "Check every 0" holds every scheduled draft [C52]. "Don't deliver messages more than # minutes late" blocks bursts of overdue messages [C53]. 10.7.8 supports Thunderbird 126–160 [C11] | D19 |
| Thunderbird | 159.0. Mail Merge 11.6.1 supports 128.0a1–160.* [C7]. Neither add-on is installed yet | Issue §5.6 resolved |
| Mail on disk | `ImapMail/outlook.office365.com` (5.7 GB) and `ImapMail/outlook.office365-1.com` (12 GB), each with INBOX, Sent and Archive; no empty mbox. About 17.7 GB is read in D3 | D3 runs in the background (review #44) |
| **Replay masking (Rob saw it)** | `@sentry/replay` 11.11.0 (`node_modules/@sentry/replay/build/npm/esm/index.js`):<br>• :8333 defaults `maskAttributes = ["title", "placeholder", "aria-label"]`;<br>• :8264–8281 `maskAttribute` stars those attributes **regardless of `maskAllText`**;<br>• typed values are masked only for `password` (`maskInputOptions: { password: true }`).<br>The share form's placeholders ("Jane Doe", "your@email.com", …, `share-form.tsx` :426/:449/:472) replay as `****`. Server-side scrubbing covers replay **metadata** ("console.log entries, network requests, …"), not the recorded page [C48] | **Corrected root cause:** `maskAttributes: []` in code (D20). v1's claim that the server scrubber was the cause was wrong (review #2, #19) |
| Sentry server-side scrubbing | Project `jowray_com`: `dataScrubber: true`, `dataScrubberDefaults: true`; org: both false. It blanks event values containing `auth`, `secret`, `token`, … [C47]. For example, a Server Function input with a story about an "author" becomes `[Filtered]` | R12 (amended): an **event-data** policy change, applied after PR-2 is live (S1) |
| Sentry SDK bodies | `httpBodies` includes `outgoingResponse`, but `@sentry/nextjs` records a response body **only for Server Functions** (`server_action_result`, `withServerActionInstrumentation.js`), never for route handlers [C55]. Router params travel as bare tuples `["claimToken","<token>","d"]` (`__tests__/lib/sentry-envelope.test.ts` :18); the request header copy is dropped whole (`SECRET_HEADER_KEYS` includes `next-router-state-tree`) | D21 (review #3, #20) |
| Vercel firewall CLI 65.9.0 | `rules update/edit --condition` **replaces** all conditions; `publish` ships **all** draft changes; `diff` shows the drafts [C56, C57] | D2 procedure (review #4, #21) |
| Validation | `contributorNameSchema` is `.trim().min(1)` (`lib/validations/memory.ts` :62), so an empty `lastName` would fail the batch [C59] | D22 |
| Outbound mail | `OUTBOUND_ENABLED: strictBoolean.default(false)` (`server/config/env.ts` :86) [C58] | E2E sets it explicitly (review #30) |
| Sentry SDK collection | `lib/sentry/data-collection.ts` :36–39: `databaseQueryData: true`, `httpBodies: ["incomingRequest","outgoingResponse"]` | R10 |
| Pino | `lib/logger/logger.ts` :10–26 redacts contributor fields **and** bearer keys; only `__tests__/lib/logger.test.ts` asserts `[Redacted]` | R13 |
| Share form | `ShareForm` :95, identify effect :151–155, name :427, email :450, relationship :473, `resetForm` :239–253. The **draft stores name and relationship, never the email** (`lib/share-draft.ts` :9–10) | D3, D4 |
| `/share` page | Prerendered, `maxDuration` :7; `Intro` isn't exported | D5 |
| Admin API + script | `unauthorized(request, realm = "admin")` + `errorResponse()` (`_auth.ts` :25–36). `scripts/draft-memory.ts` exports `resolveTarget` :52, `callAdmin` :80, `redactSecret` :110 | D15 |
| Analytics | `scrubPageView` already rewrites `url` with `scrubUrl` (`analytics-client.tsx` :44); the `dp` route can't be rewritten [C34] | D7 (review #10: one assertion added) |
| Migrations | The last is `20261107000000_media_admin_upload`; the build runs `prisma migrate deploy && prisma db seed && next build` (`vercel.json`) | D9 |
| MCP | The tool list is pinned at `__tests__/api/mcp.test.ts` :136, with `toHaveLength(12)` at :1204 | §16 |
| Launch gates (#38) | WAF rule `rule_public_paths_rate_limit_CLONBI` covers `/share`, `/api/upload`, `/api/media/`, `/m/`, but not `/s/`. Spend Management is not set. The "November 10th" promise is at `thank-you-client.tsx` :61 [C43] | R8, R6 |
| Docs | `privacy.md` has no invitee row; the root README `erDiagram` is at :147 | W5, L-W |
| Models | No Fable credits | R9 |

## 2. Rulings and calls

**Rob's rulings (2026-11-07):**

| # | Ruling |
|---|---|
| R1 | **Stop line: everything but scheduling.** Code merged and live; Invite migration on prod; harvest done and reviewed by the family; invites imported; add-ons installed; one test send per account; templates saved. **Nothing queued in Send Later for any correspondent.** ("I don't want to start sending, but I'd like to get everything ready.") **v2 amendment (review #22), the only exception:** the D8 rehearsal may schedule **exactly two** messages, To `<REHEARSAL_TO>` with Cc `<ROB_GMAIL>`, under the D19 hold procedure. READY requires Send Later's scheduled list and the Outbox to be empty again |
| R2 | Astra workers **two at a time** (the total across runs), "to help us pair code to avoid bugs and optimize quality" |
| R3 | Token: **12 characters, 72 bits**, `randomBytes(9)` base64url; only the SHA-256 is stored |
| R4 | Pace: **per account, ~10/day each**. Random 30–90 min gaps, 09:00–19:00 local, each account on its own clock. With the Cc that is ~20 recipients a day per account, an operational choice; Microsoft publishes no free-account numbers [C12] |
| R5 | The Replay DOM residual on `/s/<token>` is **accepted**, the same as for `/m/` |
| R6 | The "On November 10th…" copy gets an **undated placeholder now**; Rob writes the final copy later. Placeholder: "Once we have some stories, photos and videos collected, we'll share them with everyone and email an update to all who have contributed." |
| R7 | Harvester: **harden, don't rewrite.** The baseline `rank_correspondents (1).py` (sha256 `762a80ca0565c5c60193b0b84a4754f70c134b7e2fe0d4f3ac0ea83e2dbd1d04`) is committed unchanged. Characterization tests come first, then the changes. Reviewers read **the whole file** |
| R8 | `/s/` is added to the WAF rule **before "ready"**. Spend Management is Rob's separate go-day call |
| R9 | No Fable: **Opus 5.5** is the planner, orchestrator, pre-acceptance reviewer, citation refresher and bucket sorter. Astra writes the code; `/team-code-review` (George + Oscar) reviews |
| R10 | **Invitee names and emails fall under the 100% Sentry policy** (no suppression). **Invite tokens and share URLs stay forbidden** in Sentry, logs and analytics |
| R11 | `/s/<token>` appearing in **Vercel request logs** is **accepted**, the same as for `/m/` |
| R12 | Rob saw masked form entries **in Replays**: "Sentry should not be masking any form entries." He approved turning off the project's server-side Data Scrubber and Default Scrubbers. **v2 amendment:** the replay masking is caused by the SDK's default `maskAttributes`, fixed in code (D20). The scrubber switch is now an **event-data** change (e.g. `[Filtered]` story text in Server Function inputs). It is applied **after PR-2 is live and its token checks pass** (S1, review #18). Rob's approval was given on v1's wrong diagnosis, so the orchestrator **asks Rob once more in one line** before S1 |
| R13 | **Pino: remove contributor-field redaction everywhere** (Vercel logs and Sentry Logs). Bearer credentials stay redacted |
| R14 | `kay@aol.com` in the harvester docstring is made up; the baseline is committed byte for byte |

**Planner's calls (Rob may veto):**

| # | Call | Why |
|---|---|---|
| D1 | One shared plan commit **F0**, then two **init** branches: `notify/pr1` = F0 + the harvester baseline (run P → PR-1), and `notify/pr2` = F0 + schema and migration (run W → PR-2). **PR-2 merges first.** Order: **A3 (done) → A4 (this v2) → Rob approves → F0 → F-P / F-W**, so both branches share one F0 SHA and the plan file is never edited on those branches (review #12, #33) | Each PR carries only its own foundation. PR-2's merge is the production migration [C17] |
| D2 | **Token ledger** `~/jo-mail-review/invites.csv`: append-only, atomic, 0600. Its first line is a header comment `# target=https://www.jowray.com memorial=<MEMORIAL_SLUG>` (light version of review #26). The importer refuses a ledger whose header or existing `share_url` prefixes don't match the target, and posts only emails missing from it. `send-list` is safe to re-run. Go-day `schedule` joins with the ledger and refuses rows with no entry. `--gap/--hours/--start` on `send-list` become an error ("use `schedule`"). `--rotate-missing` exists only for recovery **before** anything is sent. Every read, write and join normalizes email with `.strip().lower()` / `.trim().toLowerCase()` (review #9) | The DB keeps only hashes; a re-import answers `exists` with no token [C19, C46] |
| D3 | **Prefill decision table** in the pure `lib/share-prefill.ts` (review #7, #29). See §8.6 | A shared device must never pair one person's name or relationship with another's email |
| D4 | **Identify:** skip the mount identify when the identity source is the invite and the remembered email differs. `getInvitePrefill` never identifies. A `sentOnce` flag stops `resetForm` re-applying the prefill, and the "Not you?" line shows only when `prefill && !sentOnce` | A forwarded link mustn't label someone else's session |
| D5 | The page lives at `app/s/[inviteToken]/page.tsx`, so Sentry and the analytics `dp` read `/s/[inviteToken]`. It follows the `/m/` shape: static shell, no-referrer meta, a `<Suspense>` fallback that **never renders `ShareForm`**, `await connection()` first, and its own `maxDuration = 120`. `Intro` moves to `app/share/intro.tsx` (with a `greeting` prop) and `/share` stays prerendered | [C25, C26, C39, C49] |
| D6 | **GET never writes.** `Invite` has no opened or used column; resolve is `findUnique` only; a zero-writes test | [C27, C28] |
| D7 | **Token privacy** (§8.7): headers, `scrubUrl` (`/s/` is case-insensitive and needs 12+ characters, plus full `https://…/s/<token>` URLs), router-state **tuple** scrubbing (D21), secret keys, analytics (keep/drop + one `url` assertion), logger bearer keys | R10 keeps tokens forbidden |
| D8 | **Harvester console output is counts-only.** Per-person lines (`--top`, address warnings) need `--verbose`. Household display-name counts go to a private `~/jo-mail-review/evidence/household-names.txt` (0600), with only the number of distinct names printed (review #35) | Third-party data stays out of the chat |
| D9 | The migration `20261107120000_invites` is generated offline: `prisma migrate diff --from-schema <origin/main schema> --to-schema prisma/schema.prisma --script -o …` [C18]. It's proven by `migrate deploy` on postgres:18, the integration suite and CI | Workers have no DB [C16] |
| D10 | **Mail Merge Deliver Mode = Save As Draft**, Send Later active, **At = `{{send_at}}`** (review #1, #17). Never "Send Later" mode [C50, C51] | Only Save As Draft writes per-row `X-Send-Later-*` headers; "Send Later" mode queues unscheduled mail in the Outbox |
| D11 | Send lists are written **UTF-8 without a BOM**; `correspondents.csv` keeps its BOM for Excel. Reviewed CSVs must be re-exported as **"CSV UTF-8"**, and the reader strips a BOM and the leading `'` formula guard (review #11) | A BOM breaks `{{email}}` [C8] |
| D12 | A **fresh Opus 5.5 subagent** pre-reviews P2, W1, W2 and W4; the orchestrator alone accepts P1, W3 (plus browser E2E) and W5 | R9 |
| D13 | The Python suite stays **out of CI** (F1) | `ci.yml` is a required, Node-only check |
| D14 | `createManyAndReturn({ skipDuplicates: true })`. Results are mapped back to input rows **by `tokenHash`**: each input index keeps the hash it was given, and returned rows are matched by `tokenHash`, **never by array position** (review #25). Rows not returned get `exists` (or `revoked`). Results carry `{ index, status, token?, shareUrl? }`, never emails | `skipDuplicates` drops rows, so positions shift [C46] |
| D15 | `scripts/import-invites.ts` imports `resolveTarget`, `callAdmin`, `redactSecret` from `scripts/draft-memory.ts`. It also: <br>• checks every `shareUrl` starts with `${target}/s/`;<br>• rejects duplicate, missing or out-of-range result indices;<br>• stops on `revoked`, reporting the 1-based row number;<br>• parses CSV with BOM, CRLF and quotes;<br>• writes atomically with mode 0600;<br>• refuses git work trees;<br>• prints counts only (tested) | [C23] |
| D16 | **Replay fix by root cause:** record where the mask shows (DOM vs Network vs Breadcrumbs) and the marker (`*` = SDK, `[Filtered]` = scrubber), with the deployed release, **before** changing anything (review #2, #19) | CLAUDE.md "fix the root cause" |
| D17 | Neon preview branches copy production rows, so Invite rows appear in new preview DBs (documented; F8) | Honest record |
| D18 | The route prefix stays `/s/` | Free |
| D19 | **Send Later hold procedure** (review #1, #22, #24):<br>• Install Send Later with **"Check every # minutes" = 0** (the hold [C52]).<br>• Turn on **"Don't deliver messages more than 60 minutes late"** [C53].<br>• Each account's drafts go to **Local Folders → Drafts** (Account Settings → Copies & Folders) so Exchange IMAP can't drop `X-Send-Later-*`.<br>• Turn off any Send Later option that triggers sending of unsent Outbox mail (D8 records its exact name).<br>• After **every** merge: Send Later's scheduled count = input rows; no merged draft without `X-Send-Later-At` (check a sample per account in View → Message Source); Outbox = 0.<br>• Only then set "Check every" to 1 (rehearsal or go-day) | Proves scheduling, prevents a burst |
| D20 | **Replay options move to `lib/sentry/replay-options.ts`** (pure, tested) with `maskAllText: false`, `maskAllInputs: false`, `blockAllMedia: false` and **`maskAttributes: []`**. `instrumentation-client.ts` uses it. W2 owns both files | [C54]; makes R12's wish testable |
| D21 | **Tuple scrubbing:** `scrubString` scrubs `["inviteToken","<v>"` and `["claimToken","<v>"` (any whitespace and escaping) to `"[Filtered]"`. This covers Replay network bodies (RSC payloads) and log text for `/m/` too. Positive-control tests prove each path *carries* the fixture without scrubbing and drops the token with it (review #3, #20) | Text scrubbing can't see bare tuples |
| D22 | **Names:** an empty or whitespace `lastName` becomes `undefined` (in the zod preprocess and in the importer). `name = [firstName, lastName].filter(Boolean).join(" ")` (review #8) | [C59] |
| D23 | Per-account files get neutral names: `send_list_primary.csv` and `send_list_second.csv` (review #35) | Jo's addresses never appear in paths |
| D24 | **Account attribution order** (review #11, #37):<br>1. household-sent: the From address;<br>2. else the household address in **To** (if both are in To, the `--self` order);<br>3. else in **Cc** (same tie rule);<br>4. else in `Delivered-To` / `X-Original-To`;<br>5. else the account of the **folder** the kept copy came from.<br>An `account_basis` column (`from|to|cc|delivered|folder`) lets Rob privately review the folder-based cases | Deterministic and reviewable |
| D25 | **Critical path:** D3 and D4 (harvest + family review) start as soon as **P2 is integrated** (run the integration worktree's script, outside git output dirs), overlapping PR-2's review cycles. D5 needs the final `send-list`, and D6 needs PR-2 live (review #41) | The family review is the slowest step |
| D26 | **Rob's prod-prefill proof = D1:** create **one** invite for `<REHEARSAL_TO>` in a separate rehearsal ledger (`~/jo-mail-review/invites_rehearsal.csv`) to prove production prefill (review #31). D8 reuses it. Rob's own addresses are in `exclude.txt`, so they never collide with the real list (review #44) | One synthetic invite, Rob's own |
| D27 | **After the first real send, fix forward only**; never revert PR-2 (delivered links would 404). Before go-day, a revert is safe (review #43) | |
| D28 | **PR-3 docs** after D8: the runbook's "what scheduled looks like", the exact Send Later option names, the public-safe evidence, and a plan snapshot (review #42) | The runbook ships in PR-1 before D8 |
| D29 | E2E safety: start `next dev` with `OUTBOUND_ENABLED=false` in the process env [C58], assert the DB host matches the `e2e-invites` branch before testing, use an isolated chrome-devtools browser context, and record zero outbound sends (review #30) | |
| D30 | D3 runs as a **background** Bash task (17.7 GB can exceed 10 minutes) with Thunderbird **quit**, so folders aren't being compacted during the read (review #44) | |

## 3. Execution model

This follows Rob's "Plan-to-ship loop, simplified" (`/Users/rob/Documents/active_work/TrayVerify/sales-mid-market-scoring/docs/workflows/orchestration.md`), with Opus 5.5 in every Fable slot (R9).

| Role | Who | Does |
|---|---|---|
| Planner + orchestrator | This session (Opus 5.5) | Owns the context and the Ledger. Does every network, DB, `gh`, Sentry and E2E step, the foundations, L-W and L-P, the evidence, and every `inspect` → `check` → `accept` → `integrate` |
| Workers | `/astra-work` (GPT Astra via Codex; no network, DB or `.env`; ≤ 2 total) | Literal owned paths, red-first tests |
| Pre-acceptance reviewer | A fresh Opus 5.5 subagent per critical task (D12) | Brief + `inspection.diff` + new files + plan section; blocking findings with `file:line`. For P2, the whole harvester |
| Citation refresh | An Opus 5.5 subagent, once per PR before `publish` | Re-fetches that PR's citations live |
| PR review | `/team-code-review` via the astra handoff | Buckets (§0.10) → **Rob confirms** → Opus issue writers (`document-issue.md`) for Buckets 1+2 → Astra repair → inspection → TCR again. At most 3 cycles, **but blockers must be fixed before merge regardless of the cap** (review #34) |
| Ship | Rob | Go-ahead for each merge |

**Who does what.**
- **Combined checks, run W:** `["npm","run","validate"]`, `["npm","run","test:run"]`, `["npm","run","build:offline"]`.
- **Combined checks, run P:** PY = `["python3","-m","unittest","discover","-s","scripts/notify","-p","test_*.py"]`, PY39 = the same with `/usr/bin/python3`, plus `["npm","run","validate"]`.

| PR | Step | Owner | Owned paths (literal) | Depends on | Task checks |
|---|---|---|---|---|---|
| — | **F0** plan commit (on a local base from `origin/main`) | orchestrator | `docs/plans/2026-11-07-notify-correspondents.md` | A4 applied + Rob approves | the file has the banner "Ledger frozen; live Ledger at ~/.claude/plans/…" |
| 1 | **F-P** harvester baseline on `notify/pr1` | orchestrator | `scripts/notify/rank_correspondents.py` (byte for byte) | F0 | `shasum -a 256` = `762a80ca…` |
| 2 | **F-W** schema + migration on `notify/pr2` | orchestrator | `prisma/schema.prisma`, `prisma/migrations/20261107120000_invites/migration.sql` | F0 | `npx prisma validate`; `migrate deploy` on postgres:18 |
| 1 | **P1** characterization tests (§7.2a) | Astra, run P | `scripts/notify/test_rank_correspondents.py` | F-P | PY, PY39 against the unchanged baseline |
| 2 | **W1** invite core (§8.2–8.4) | Astra, run W | `lib/invite-token.ts`, `lib/validations/invite.ts`, `features/invites/`, `__tests__/lib/invite-token.test.ts`, `__tests__/features/invites.test.ts`, `__tests__/integration/invites.test.ts` | F-W | `["npx","vitest","run","__tests__/lib/invite-token.test.ts","__tests__/features/invites.test.ts"]`; validate. The orchestrator runs integration locally |
| 1 | **P2** harden harvester (§7.1, §7.2b) | Astra, run P | `scripts/notify/rank_correspondents.py`, `scripts/notify/test_rank_correspondents.py` | P1 integrated | PY, PY39 |
| 2 | **W2** token privacy, replay options, Pino (§8.7, D20, D21, R13) | Astra, run W | `next.config.ts`, `instrumentation-client.ts`, `lib/sentry/replay-options.ts`, `lib/sentry/scrub.ts`, `lib/sentry/secrets.ts`, `app/_components/analytics-client.tsx`, `lib/logger/logger.ts`, `__tests__/lib/replay-options.test.ts`, `__tests__/lib/sentry-scrub.test.ts`, `__tests__/lib/sentry-scrub-differential.test.ts`, `__tests__/lib/sentry-scrub-timing.test.ts`, `__tests__/lib/sentry-envelope.test.ts`, `__tests__/next-config.test.ts`, `__tests__/app/analytics-client.test.ts`, `__tests__/lib/logger.test.ts` | F-W (independent of W1) | vitest on those 8 test files; validate. The timing (ReDoS) suite stays green |
| 2 | **W3** page + form (§8.6, R6) | Astra, run W | `app/s/`, `app/share/share-form.tsx`, `app/share/page.tsx`, `app/share/intro.tsx`, `app/share/thank-you-client.tsx`, `lib/share-prefill.ts`, `__tests__/lib/share-prefill.test.ts` | W1 integrated | vitest `share-prefill`, `__tests__/lib/share-draft.test.ts`, `__tests__/lib/remembered-contributor.test.ts`; validate; `build:offline` |
| 2 | **W4** admin route + import script (§8.5) | Astra, run W | `app/api/admin/invites/`, `scripts/import-invites.ts`, `__tests__/api/admin-invites.test.ts`, `__tests__/scripts/import-invites.test.ts` | W1 integrated | those + `__tests__/scripts/draft-memory.test.ts` + `__tests__/api/admin-auth.test.ts`; validate |
| 2 | **W5** docs (§8.8) | Astra, run W | `docs/features/invite-links.md`, `docs/features/share-form.md`, `docs/features/README.md`, `docs/features/privacy.md`, `docs/features/analytics.md`, `docs/features/sentry-telemetry.md` | W1–W4 integrated | validate; test:run |
| 2 | **L-W** AGENTS.md, code-layout, root README (§8.9) | orchestrator, on run W's integration worktree | `AGENTS.md`, `docs/code-layout.md`, `README.md`, `public/diagrams/` | W5 | `npx tsx scripts/make-readme-diagrams.ts`; test:run |
| 1 | **L-P** runbook `docs/notify-friends.md` (§7.3) | orchestrator, on run P's integration worktree | `docs/notify-friends.md` | P2 integrated, W4 interface final | read-through against [C6–C15, C50–C53] |
| both | **E2E + preview** (§11) | orchestrator | evidence only | combined checks | §11 |
| 3 | **PR-3 docs** (D28) | orchestrator, branch `notify/pr3-docs` from `origin/main` after D8 | `docs/notify-friends.md`, `docs/plans/evidence/2026-11-notify/`, `docs/plans/2026-11-07-notify-correspondents.md` (snapshot) | D8 | validate; test:run |

**Slots (≤ 2 total):**
1. P1 + W1.
2. Then P2 and W2 as slots free.
3. Then W3 and W4 (both need W1 integrated).
4. Then W5.

**Every brief contains:**
- the objective and plan section, and literal owned paths ("touch nothing else");
- the interfaces from §7/§8 and red-first test names;
- the AGENTS.md rules (layers, `server-only`, Pino, zod in `lib/validations`, no `eslint-disable`, no band-aids);
- R1–R14 and the relevant D-calls, plus §16;
- the personal-data rule (synthetic `example.com` data);
- "integration not run here";
- the exact checks.

**Acceptance per task:**
1. `status` → `inspect` (read the diff and every new file; reject unowned edits).
2. Background `check --task`.
3. The Opus pre-review (D12).
4. `acceptance.json` addressing every flag.
5. `accept` → `integrate`.

W1 and W4 also need the local integration suite to pass before `accept`.

## 4. Ledger (LIVE here only; one row per resumable step)

| Step | Owner | Status | Branch @ SHA | Run dir | PR | Evidence | Next action |
|---|---|---|---|---|---|---|---|
| A1 plan v1 + citations | orchestrator | ✅ | — | — | — | v1 in this file's history | — |
| A3 premortem (TCR on this file) | TCR | ✅ 2026-11-07 | — | — | — | `/Users/rob/Downloads/team-review-20261107-181951-jowray_com-plan-notify-f909f7b.md` | — |
| A4 buckets → plan v2 | orchestrator | ✅ v2 approved by Rob 2026-11-07 | — | — | — | §15–§17 | — |
| F0 plan commit | orchestrator | ⬜ | | | | banner check | create WT from `origin/main`; commit this file (with the frozen-Ledger banner); `git branch notify/pr1`, `git branch notify/pr2` at F0 |
| notify.env | orchestrator + Rob | ⬜ | — | — | — | file exists, 0600 (no contents shown) | ask Rob for the 4 addresses, household names and exclude list; write `~/jo-mail-review/notify.env` and `exclude.txt` |
| F-P | orchestrator | ⬜ | `notify/pr1` | | | sha256 | copy the baseline; check the hash; commit |
| F-W | orchestrator | ⬜ | `notify/pr2` | | | migrate log | schema + migration diff; Docker deploy; commit |
| init run P | orchestrator | ⬜ | | | | `run.json` | `init` from WT with `notify/pr1` checked out |
| init run W | orchestrator | ⬜ | | | | | `init` from WT with `notify/pr2` checked out |
| P1 | Astra | ⬜ | | | | | prepare + launch (slot 1) |
| W1 | Astra | ⬜ | | | | | prepare + launch (slot 2); `npm ci` first |
| P2 | Astra | ⬜ | | | | | after P1 is integrated |
| W2 | Astra | ⬜ | | | | | when a slot frees |
| W3 | Astra | ⬜ | | | | | after W1 is integrated |
| W4 | Astra | ⬜ | | | | | after W1 is integrated |
| W5 | Astra | ⬜ | | | | | after W1–W4 |
| D3 + D4 early (D25) | orchestrator + Rob | ⬜ | | | | private | after P2 is integrated |
| L-P runbook | orchestrator | ⬜ | | | | | after P2 + W4 |
| L-W sync | orchestrator | ⬜ | | | | | after W5 |
| E2E run P (§11.1) | orchestrator | ⬜ | | | | | |
| E2E run W (§11.2) | orchestrator | ⬜ | | | | | |
| PR-2 publish + preview checks (§11.3) | orchestrator | ⬜ | | | | | combined checks → citation refresh → `publish` |
| PR-1 publish | orchestrator | ⬜ | | | | | same |
| C-PR2 TCR cycles | TCR + Rob | ⬜ | | | | | |
| C-PR1 TCR cycles | TCR + Rob | ⬜ | | | | | |
| Merge PR-2 | Rob | ⬜ | | | | Production deploy success | final-review file at merge-readiness |
| S1 Sentry scrubber (R12) | orchestrator | ⬜ | | | | `s1-sentry-settings.md` | after PR-2 is live + D1; one-line re-confirm with Rob |
| Merge PR-1 | Rob | ⬜ | | | | | |
| D1–D9 (§10) | orchestrator + Rob | ⬜ | | | | | one row each, added when started |
| PR-3 docs (D28) | orchestrator | ⬜ | | | | | after D8 |
| **READY (stop)** | | ⬜ | | | | `ready.md` | Rob picks go-day |

## 5. Environment manifest (names only)

- **Production, already set:** `ADMIN_API_SECRET`, `NEXT_PUBLIC_SITE_URL`, `MEMORIAL_SLUG`. **No new variable.**
- **Local:**
  - `TEST_DATABASE_URL` and `DATABASE_URL_UNPOOLED` point at Docker postgres:18 (§0.3).
  - E2E: `DATABASE_URL`/`DATABASE_URL_UNPOOLED` point at the Neon child branch `e2e-invites` (claude.ai Neon connector; record its branch ID in the Ledger).
  - E2E also sets a throwaway `ADMIN_API_SECRET` and `OUTBOUND_ENABLED=false` in the process env, which beats `.env` [C23, C58].
- **Sentry API:** the `sentry` CLI's stored auth.
- **Private:** `~/jo-mail-review/notify.env` (§0.6).

## 6. Phase A: plan, premortem, buckets

- **A1** ✅ v1.
- **A3** ✅: `/team-code-review` on this file with `premortum.md`; 44 findings.
- **A4** ✅: buckets in §15, v2 applied.
- **F0** (after approval):
  1. `git -C /Users/rob/Documents/active_work/jowray_com fetch origin && git -C /Users/rob/Documents/active_work/jowray_com worktree add -b notify/base /Users/rob/Documents/active_work/jowray_wt_notify origin/main`, then `npm ci` in WT.
  2. Copy this file to `docs/plans/2026-11-07-notify-correspondents.md` with a top banner: "Design and rulings record. §4 Ledger is a frozen snapshot; the live Ledger is `/Users/rob/.claude/plans/can-you-please-build-gleaming-sonnet.md`."
  3. Commit `docs(plans): notify correspondents plan v2`.
  4. `git -C WT branch notify/pr1 && git -C WT branch notify/pr2`.
- **F-P:** `git -C WT switch notify/pr1`; `cp "/Users/rob/Downloads/rank_correspondents (1).py" scripts/notify/rank_correspondents.py`; check the hash; commit `chore(notify): add Rob's harvester unchanged`; then `init` run P.
- **F-W:** `git -C WT switch notify/pr2`; §8.1; commit `feat(invites): Invite model and migration`; then `init` run W.

## 7. PR-1: notify tooling (Python + runbook)

### 7.1 Harvester changes (P2) [C1–C5, C8, C12, C13]

Baseline line numbers (1,221-line copy):
- `CSV_COLUMNS` :153–157; `first_name_of` :237–253; `name_key` :229–231; `parse_addrs` :263;
- the message insert :551–576; dedupe :626; `resolve_self` :642;
- `AddrStats`/`score_addresses` :670–761; `build_people` :837–929; `guard_git` :940; `private` :972;
- `rank_main` :979 (`--top` :996, print :1057–1062); the schedule helpers :1074–1122 (`make_schedule` :1106); `send_list_main` :1125–1210.

1. **Columns, exactly** [review #11]: `rank, notify, first_name, last_name, email, name, account, account_basis, score, she_wrote, she_wrote_direct, they_wrote, first_year, last_year, years_active, other_addresses, names_seen, recent_subjects, flags`.
   - Rename `send_to` → `email`; the reader still accepts `send_to`.
   - `last_name_of`:
     - "Last, First" → the text before the comma;
     - otherwise the last token, keeping particles (`van von de da del der du la le st`, multi-word like "de la") and dropping suffixes (`Jr Sr II III IV`);
     - empty for one-word names and lists.
   - Fix ", Jr." becoming the first name. P1 pins the bug; P2 flips that test.
2. **Accounts:**
   - `--self` keeps its **order**: the first is the primary.
   - `messages.account` is attributed per D24, stored with `account_basis`.
   - Per-account weighted scores in `AddrStats`; `build_people` picks the higher, and a tie goes to the `--self` order.
   - `--household-name` (repeatable) adds to `own_keys` (:1027–1029). Household display-name counts go to `~/jo-mail-review/evidence/household-names.txt` (D8), which answers issue §5.3 H1/H2/H3.
3. **`send-list`** (D11):
   - Reads the reviewed CSV after stripping a BOM; strips a leading `'` from every cell.
   - Accepts `notify` marks case-insensitively: `y, yes, x, 1, true, ✓, ✔`. Ignores blank trailing rows.
   - Writes **one** combined `send_list.csv` in rank order: `email, first_name, last_name, name, account`. Emails are lower-cased; no BOM; 0600.
   - **Refuses** an empty `first_name`, an invalid address or an unknown `account`, reporting **ranks** only.
   - `--gap/--hours/--start` → error "use `schedule`".
4. **New `schedule`** (D2, R4, D23):
   - Inputs: `send_list.csv` + `--ledger ~/jo-mail-review/invites.csv`.
   - Refuses: a ledger whose header doesn't match `--target`; rows with no ledger entry (except `--allow-missing-share-url`, for tests only); a start in the past; or `--start` more than 30 minutes before **now** at run time (re-run `schedule` right before each merge, review #24).
   - Options: `--gap 30-90 --hours 9-19 --start "YYYY-MM-DD HH:MM" [--seed N] [--pace per-account|combined]`, default `per-account`.
   - Uses `random.Random(f"{seed}:{account}")`.
   - Records the local timezone name in a comment line of a private `schedule.log`.
   - Writes `send_list_primary.csv` / `send_list_second.csv`: all columns + `share_url` + `send_at` (`%Y-%m-%d %H:%M` local), no BOM, 0600, `guard_git`. Never edits its inputs.
5. **Console (D8):** counts and neutral paths only; per-person lines need `--verbose`.
6. **Kept:**
   - headers only, read-only mail, `guard_git`, files 0600 and dirs 0700, `--out ~/jo-mail-review`, standard library only;
   - Python 3.9+: avoid `match`, `zip(strict=)`, `itertools.pairwise`, `enterContext`, `TemporaryDirectory(ignore_cleanup_errors)`;
   - `getaddresses(strict=)` exists on 3.11 and not on 3.9, so test both paths.

### 7.2 Tests `scripts/notify/test_rank_correspondents.py` [C3, C5]

- **Style:** `unittest` only; synthetic mbox in temp dirs; `HOME` pointed at a temp dir; `--out` always passed.
- **Guard tests** create their own temp roots outside any git tree.
- **Data:** `example.com` only.

**(a) P1, characterization of the unchanged baseline (all green):**
- `canon`: dots, `+tags`, googlemail, `mailto:`.
- `clean_name`, `name_key`, `first_name_of` (the ", Jr." bug pinned).
- `norm_subject`, `looks_automated`, `is_bulk`.
- Date bounds and envelope time zones.
- `folder_kind`/`folder_label` (`.sbd`, Junk, Drafts); `sniff` (an empty file with a large `.msf`).
- `read_mbox`: CRLF; a `From ` line in a body; the header cap.
- `parse_message`: Message-ID vs SHA-1; deleted flags; RFC 2047 and cp1252; the Date → Received → envelope fallback.
- `parse_addrs` on both code paths [C4].
- Scoring: weight tiers, Bcc-only, decay, two-way bonus, bulk ignored, cross-account duplicates counted once.
- `build_people`: grouping, exclusions, contacts, lists, `min_received`, own names.
- `rank_main` end to end: header, BOM, formula guard, 0600/0700, SQLite views, git guard.
- `send-list` today: order, dedupe, window, gaps, rollover, `--seed`.

**(b) P2, red first:**
- Last names: "Smith, Margaret A.", "Ludwig van Beethoven", "John Smith Jr.", "Maria de la Cruz", one-word, list.
- The ", Jr." fix.
- Ordered `--self`.
- Every branch of the D24 rule, including both addresses in To and in Cc; `account_basis`.
- `--household-name` writes the private file and prints only a count.
- `send-list`: refusals; mark variants; `'` and BOM stripping; no-BOM output; the `--gap` error.
- `schedule`:
  - per-account clocks: 30–90 min gaps, 09:00–19:00, overnight carry-over;
  - refuses a past or stale start;
  - refuses a missing or mismatched ledger;
  - leaves its inputs untouched;
  - writes neutral file names.
- The counts-only console (no `@` and no fixture names without `--verbose`), including on error paths.

### 7.3 Runbook `docs/notify-friends.md` (L-P) [C1, C2, C6–C15, C45, C50–C53]

1. **Order:** §10 D1–D9, then go-day.
2. **Prerequisites:** issue §5.1–§5.6, §5.9, §5.10, with today's facts.
3. **Data flow:** harvest → review (re-export as "CSV UTF-8") → `send-list` → `import-invites` (ledger) → go-day `schedule`.
4. **Thunderbird:**
   - Add-on versions. **Send Later preferences per D19:** Check every = 0 (hold), "Don't deliver messages more than 60 minutes late", Outbox-trigger off.
   - Each account's drafts go to Local Folders → Drafts.
   - An OAuth test send per account [C15]. Record each account's SMTP host and OAuth2 setting in private evidence, and **who holds the recovery methods** for both Microsoft accounts (review #36).
   - Per-account template: From = that account, To `{{email}}`, Cc `<ROB_GMAIL>` (canary + log; ~20 recipients/day/account, R4), Subject `{{first_name}} - …` (Rob's words), plain text, at most two full `https://www.jowray.com/` links.
   - **Mail Merge dialog: Deliver Mode = Save As Draft**, Send Later at **At = `{{send_at}}`**, CSV UTF-8 [C50, C51, C7, C8].
5. **Post-merge gate (D19):** scheduled count = rows; `X-Send-Later-At` present on a sample per account; Outbox = 0. Only then set Check every = 1.
6. **Keep Thunderbird open with a main window,** and run `caffeinate -is` [C10].
7. **Emergency stop:** set Check every = 0. **Overdue messages:** Send Later warns and leaves them [C53]. Reschedule by hand only after reconciling the Sent folder (F10).
8. **Monitor:** Cc copies, bounces, replies (→ draft on behalf).
9. **Deliverability:** [C12–C14].
10. **Before go-day:** revoke an invite (`revokedAt`); `--rotate-missing` only **before** sending. **After the first send, fix forward only (D27).**
11. **Go-day morning:** a fresh OAuth test send per account before turning the hold off (review #36).

Placeholders only [C45].

## 8. PR-2: invite links, token privacy, Sentry unmasking

### 8.1 Data (F-W) [C16–C19, C27]

```prisma
model Invite {                              // personal /s/<token> link that prefills the share form
  id         String    @id @default(uuid())
  memorialId String
  tokenHash  String    @unique              // sha256 hex of the 12-char token; the raw token is never stored
  firstName  String
  lastName   String?
  email      String                         // trimmed, lower-cased
  createdAt  DateTime  @default(now())
  revokedAt  DateTime?                      // stops the link prefilling
  memorial   Memorial  @relation(fields: [memorialId], references: [id])
  @@unique([memorialId, email])
}
```

- Add `invites Invite[]` to `Memorial` (:79–90).
- Generate: `git show origin/main:prisma/schema.prisma > <scratchpad>/old.prisma && npx prisma migrate diff --from-schema <scratchpad>/old.prisma --to-schema prisma/schema.prisma --script -o prisma/migrations/20261107120000_invites/migration.sql`.
- Prove: `DATABASE_URL_UNPOOLED=<docker> npx prisma migrate deploy` from empty, then the integration suite.
- No foreign key to `Contributor` or `Memory` (keeps it clear of #73).

### 8.2 Token `lib/invite-token.ts` [C21, C22]

- `newInviteToken()` = `randomBytes(9).toString("base64url")`.
- `INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{12}$/`.
- `hashInviteToken` → `hashClaimToken` (`lib/claim-token.ts` :13).
- Tests: length, alphabet, uniqueness over 10k, hash parity.

### 8.3 Validation `lib/validations/invite.ts` [C37, C59]

- `{ invites: z.array({ firstName, lastName?, email }).min(1).max(200), rotate?: boolean }`.
- `firstName` uses `contributorNameSchema`; `lastName` is preprocessed so blank → `undefined`, then `contributorNameSchema.optional()` (D22); `email` uses `contributorEmailSchema` (trims and lower-cases).
- Duplicate emails within one batch are rejected.

### 8.4 Features `features/invites/` (`server-only`) [C20, C27, C41, C42, C46]

- **`createInvites(input)`:**
  - Memorial by `getMemorialEnv().MEMORIAL_SLUG` (`create-submission.ts` :109–120).
  - Generate a token and hash per input index; `createManyAndReturn({ skipDuplicates: true })`; **map returned rows by `tokenHash`** to their index (D14).
  - For indexes not inserted, look up the existing row by `(memorialId, email)`: `revokedAt` set → `revoked` (always); else with `rotate` → update the hash → `rotated` with token + `shareUrl`; else `exists`.
  - `shareUrl = getSiteUrl() + "/s/" + token`. Log counts and ids.
- **`getInvitePrefill(token)`:** `null` on a pattern miss. Otherwise `findUnique({ where: { tokenHash } })` → `{ firstName, name: [firstName, lastName].filter(Boolean).join(" "), email }` if not revoked, else `null`. Read-only; no identify.
- **Tests:**
  - **Unit (mocked `getDb`):** created/exists/rotated/revoked; **a batch with an existing row in the middle and returned rows in a shuffled order maps correctly**; the batch limit and duplicates; blank `lastName`; resolve null cases; zero writes on resolve.
  - **Integration (rollback pattern of `__tests__/integration/share-draft.test.ts` :22–48):** uniqueness, `skipDuplicates`, the mapping by hash, the row count unchanged by resolve.

### 8.5 Admin route + import script (W4) [C15, C23, C24]

- **`app/api/admin/invites/route.ts`** (POST, `maxDuration = 30`): `unauthorized(request)` → `request.json()` → `createInvites` → `{ success: true, data: { results } }` / `errorResponse(…)`. Copies `app/api/admin/memories/route.ts`.
- **`scripts/import-invites.ts`** (D2, D15):
  - Usage: `npx tsx --env-file=/Users/rob/Documents/active_work/jowray_com/.env scripts/import-invites.ts --prod --in <send_list.csv> --ledger <invites.csv> [--rotate-missing]`, or a loopback `ADMIN_API_URL` (target `http://localhost:3000`).
  - Creates the ledger with the header line if it's absent. Refuses a mismatched header or an existing entry with the wrong prefix.
  - Posts emails missing from the ledger in batches of ≤ 200; omits a blank `lastName`.
  - Validates indices; appends `email, share_url` atomically.
  - `exists` without a ledger entry → "row N needs `--rotate-missing` (only before any send)". `revoked` → stop with the row number.
  - Done-check: **every approved row has a ledger entry** (review #27; not `created = rows`).
- **Tests:**
  - **Route:** 401 / 400 / 200, `exists`, `revoked`, no emails in the response.
  - **Script:** target rules, redirect refusal, ledger header + prefix checks, the index checks, atomic append, BOM/CRLF/quotes, email normalization, git-tree refusal, counts-only output.

### 8.6 Page and form (W3) [C20, C25–C28, C32, C36, C39, C49]

- **`app/s/[inviteToken]/page.tsx`** (D5): `<Suspense fallback={…not ShareForm…}>` → `await connection()` → `await params` → `getInvitePrefill(inviteToken)` → `<ShareForm intro={<Intro greeting={prefill ? \`Hi ${prefill.firstName},\` : undefined} />} prefill={…} />`. Unknown or revoked tokens render the plain form.
- **`app/share/intro.tsx`:** the current intro copy (`page.tsx` :14–16) + an optional `greeting`. `app/share/page.tsx` imports it (update the :3–6 comment); it stays static.
- **`lib/share-prefill.ts`:** `initialContributor({ draft, prefill, remembered })` → `{ name, email, relationship, source }`. **Decision table** (emails compared trimmed and case-insensitively; names trimmed and case-insensitively):

| Prefill | Remembered | Identity (name, email, source) | Relationship | Draft name/relationship used? |
|---|---|---|---|---|
| none | none | draft name or "", "" , `draft`/`none` | draft's | yes (today's behaviour) |
| none | R | draft name or R.name, R.email, `remembered` | draft's or R's | yes (today's behaviour) |
| P | none or R with R.email ≠ P.email | P.name, P.email, `invite` | draft's **only if** draft name = P.name, else "" | name never; relationship only on a name match |
| P | R with R.email = P.email | R.name (or P.name if blank), P.email, `remembered` | draft's if draft name = R.name, else R's | relationship only on a name match |

  A blank draft name never overrides an identity name. Tests cover every row, plus the Oscar case: invite B with a remembered A **and** a draft A → B's name and email, blank relationship.
- **`share-form.tsx`:**
  - Uses the helper for :427/:450/:473, with an optional `prefill` prop at :95.
  - D4: skip the mount identify when `source === "invite"` and the remembered email differs; `sentOnce`; "Not you?" only when `prefill && !sentOnce`: "This form was filled in from your personal link. Not you? Change the name and email above."
- **R6:** the `thank-you-client.tsx` :61 placeholder.

### 8.7 Token privacy, replay options, Pino (W2) [C29–C31, C33–C35, C40, C42, C54, C55]

| File | Change |
|---|---|
| `next.config.ts` | `/s/:path*` → `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow` (next to `/m/` at :36–41) |
| `lib/sentry/scrub.ts` | `INVITE_PATH = /\/s\/[A-Za-z0-9_-]{12,}/gi` → `/s/[inviteToken]` in `scrubUrl` (:38–51); this also covers full `https://…/s/<token>` URLs in free text. **Tuple rule (D21):** `["inviteToken","<v>"` and `["claimToken","<v>"` → `"[Filtered]"` in `scrubString`, covering escaped JSON too |
| `lib/sentry/secrets.ts` | `SECRET_FIELD_KEYS` += `shareUrl`, `inviteToken` |
| `app/_components/analytics-client.tsx` | keep exactly `/s/<one segment>`; drop any other path with an `s` segment (mirrors :8–10, :40–42). `url` is already scrubbed (:44); the test asserts it |
| `lib/sentry/replay-options.ts` (new) + `instrumentation-client.ts` | D20: `REPLAY_OPTIONS` = the current options (:43–50) + `maskAttributes: []`; the init spreads them in |
| `lib/logger/logger.ts` (R13) | Contributor fields **removed** from redaction (`email, recipientEmail, name, phone, note, contributorNote, relationship, place, approxDateText, originalFilename, latitude, longitude`). **Bearer keys kept:** `claimLink, presignedUrl` + new `shareUrl, token, inviteToken`, plus `SECRET_HEADER_KEYS` |

**Tests with positive controls (D21):** each case puts a synthetic email (`sentry-test@jowray.com`) **and** `SENTRYTEST_x` (12 characters) into the same payload and asserts the email **is present** (proving the transport carries it) while the token is absent or `/s/[inviteToken]`. Cases:
- (a) `instrumentedAction` input and `server_action_result` containing a `/s/` URL and a `shareUrl` key;
- (b) an incoming request body with `invites[]`;
- (c) a `next-router-state-tree` header **and** a plain-text body containing `["inviteToken","SENTRYTEST_x","d"]`, plus the same for `claimToken`;
- (d) a Replay network `responseBody` through `scrubRecordingEvent`;
- (e) a Pino log line routed to Sentry Logs.

The route-handler response body is **not** tested, because the SDK never captures it [C55].

Also: the scrub, differential and timing suites; next-config; analytics keep/drop + the `url` assertion; `replay-options` (`maskAttributes` empty, the three mask flags false); logger (contributor fields pass, bearer keys redacted).

### 8.8 Docs (W5) [C45]

- `invite-links.md` (new, from the template; D17, D27).
- `share-form.md`: the decision table, :122, R6.
- `docs/features/README.md`: an index row.
- `privacy.md`: an invitee row (R10), replay unmasking (D20), the S1 plan (R12), Pino (R13).
- `analytics.md`: the `/s/` rule.
- `sentry-telemetry.md`: R10, R12 amended, R13, D20, D21.

### 8.9 Sync (L-W) [C40–C42]

- **`AGENTS.md`:**
  - :57 forbidden list += invite tokens (`/s/<token>`, `inviteToken`, `shareUrl`), and the residuals += `/s/` replay DOM (R5) and Vercel logs (R11);
  - :41 logger rule rewritten for R13;
  - the Sentry section: replay `maskAttributes: []` and the server-scrubber state after S1;
  - the layers += `features/invites`, `lib/invite-token.ts`, `lib/share-prefill.ts`, `lib/sentry/replay-options.ts`.
- **`docs/code-layout.md`:** the same text.
- **Root `README.md`:** a Features row + `Invite` in the `erDiagram` (:147); regenerate `public/diagrams/` with `npx tsx scripts/make-readme-diagrams.ts`.

### 8.10 Replay unmasking (D16, D20) and the scrubber switch (S1, R12) [C47, C48, C54]

1. **Before, on production:** open `/share` in a fresh session, type synthetic text, **don't send**. Find the replay (`sentry api "/organizations/med3ai/replays/?project=<id>&statsPeriod=1h"`) and record, privately: the release, where the masking shows (DOM / Network / Breadcrumbs), and the marker (`*` vs `[Filtered]`). Expected: the placeholders show as `*`.
2. **After, on the PR-2 preview** (protection bypass): repeat; the placeholders and typed text render. That proves D20.
3. **S1 (after PR-2 is live and D1 passes):**
   1. Re-confirm with Rob in one line (R12 amendment).
   2. Save "before": project `dataScrubber`, `dataScrubberDefaults`, `sensitiveFields`, `safeFields`, `scrubIPAddresses`, `relayPiiConfig`, plus the same org fields.
   3. `sentry api /projects/med3ai/jowray_com/ --method PUT` with `{"dataScrubber": false, "dataScrubberDefaults": false}`.
   4. Read back "after".
   5. **Wait ≥ 6 minutes** (Relay's config cache).
   6. Run one production Server Function with story text containing "author": the event shows the text, not `[Filtered]`, and the D1 token checks still pass.

Evidence goes to `~/jo-mail-review/evidence/s1/`, with a public-safe summary in PR-3. Rollback: set both flags back to `true`.

## 9. Phase C: review, repair, merge

1. For each draft PR, `/team-code-review` via the astra handoff (`begin-review` … `record-review`); **both** reviewers must succeed (§0.11).
2. Sort the findings with `friend-buckets-issue-review.md` → **Rob confirms** → `bucket-work-sorting.md` (paths in §0.10):
   - Buckets 1+2 go to Opus issue writers (`document-issue.md`), then Astra repair from the reviewed SHA, inspection and TCR.
   - Bucket 3 goes in a PR comment and §16.
   - Bucket 4 goes in the PR notes and §17.
   - At most 3 cycles; **blockers are fixed regardless**.
3. **At merge-readiness only,** follow `…/workflows/final pr review instrucionts.md` and paste its waiting rule into the TCR subagent brief.
4. Rob merges **PR-2 first** [C17], then PR-1. Copy §16/§17 items into each PR's notes.

## 10. Phase D: readiness operations (stop line R1)

| # | Step | Owner | Done when |
|---|---|---|---|
| D1 | **Production `/s/` check** (D26): Production deployment `success` for the merge SHA (§0.2); the migration `finished_at` is set; `curl -sI https://www.jowray.com/s/AAAAAAAAAAAA` → 200 + `Referrer-Policy: no-referrer` + `X-Robots-Tag: noindex, nofollow`; an unknown token gives the plain form; create Rob's rehearsal invite (`import-invites --prod --in <1-row CSV for $REHEARSAL_TO> --ledger ~/jo-mail-review/invites_rehearsal.csv`); open it and see the prefill; check the row count before and after a `curl` GET of it; the Sentry pageload reads `/s/[inviteToken]` with no bare token | orchestrator | all pass; private evidence `d1/` |
| D2 | **WAF** (review #4, #21). From the scratchpad:<br>1. `vercel firewall diff --project jowray-com --scope rob-wrays-projects` must show **no** staged drafts (if it does, stop and ask Rob).<br>2. `vercel firewall rules inspect rule_public_paths_rate_limit_CLONBI --json …` saved as "before".<br>3. Update with **all five** path-prefix groups (`/share`, `/api/upload`, `/api/media/`, `/m/`, `/s/`), by round-tripping the JSON (`--data`) or by the dashboard.<br>4. `diff` shows only this change.<br>5. `publish --yes` (with Rob's OK).<br>6. Inspect "after" | Rob approves; orchestrator or Rob runs it | "after" shows all five prefixes, action `rate_limit` (429), 1200 per 600 s, fixed window, IP key, everything else unchanged; `/share` and `/s/…` return 200 |
| D3 | **Harvest** (D25, D30), as a background task, with Thunderbird quit: `( set -a; . ~/jo-mail-review/notify.env; set +a; python3 scripts/notify/rank_correspondents.py --self "$PRIMARY_HOTMAIL" --self "$SECOND_HOTMAIL" --household-name … --exclude "$EXCLUDE_FILE" ~/Library/Thunderbird/Profiles/itl33f39.default-release/ImapMail/outlook.office365.com ~/Library/Thunderbird/Profiles/itl33f39.default-release/ImapMail/outlook.office365-1.com )`. Per-account counts confirm issue §5.2 (which folder is which address); Rob reviews `account_basis = folder` rows privately (review #37) | orchestrator | `correspondents.csv` exists, 0600; counts recorded |
| D4 | **Family review:** mark `notify`, fix names, drop businesses and lists, add people; **re-export as "CSV UTF-8"** | Rob + Richard | Rob says done |
| D5 | `send-list` → `send_list.csv` | orchestrator | exit 0; rows = marked |
| D6 | **`import-invites --prod --in ~/jo-mail-review/send_list.csv --ledger ~/jo-mail-review/invites.csv`** (personal data into prod) | orchestrator, **after Rob's explicit "go" for D6** | every row has a ledger entry; the Neon count read-back matches |
| D7 | **Thunderbird** (D19): install Mail Merge 11.6.1 + Send Later 10.7.8 (record the versions); set **Check every = 0**, **late limit 60 min**, Outbox-trigger off, drafts → Local Folders; record the SMTP host, the OAuth2 setting and the recovery-method holder per account; one OAuth test send per account to `<ROB_GMAIL>` [C15]; **Save as Template** per account | Rob (orchestrator guides) | 2 test mails arrive; 2 templates saved; settings recorded privately |
| D8 | **Dress rehearsal (R1 exception):**<br>1. A 2-row CSV (one row per account, To `<REHEARSAL_TO>`), with `share_url` from `invites_rehearsal.csv`.<br>2. `schedule --start <now+15m>`.<br>3. Mail Merge per account: **Save As Draft, At = `{{send_at}}`**.<br>4. Post-merge gate (D19): 2 scheduled, headers present, Outbox 0.<br>5. Check every = 1.<br>6. Both arrive (Gmail **inbox** for the Cc canary, issue §5.10); subject, links and `/s/` prefill checked.<br>7. **Check every = 0 again** | Rob + orchestrator | all of that; Send Later's list and the Outbox are empty afterwards |
| D9 | **Ready report:** `~/jo-mail-review/evidence/ready.md` (private) + a public-safe counts summary. It attests: no correspondent message is queued, the Send Later list is empty, the Outbox is empty, the hold is on | orchestrator | every row ✅ → **STOP** |
| D10 | **PR-3 docs** (D28) | orchestrator | merged |

**Go-day (NOT executed here):**
1. Rob: Spend Management (R8), the final copy (R6), a fresh OAuth send per account.
2. `schedule --start "<day> 09:00" --ledger ~/jo-mail-review/invites.csv`, immediately before the merge.
3. Mail Merge per account (Save As Draft, At).
4. The post-merge gate.
5. Check every = 1.
6. Thunderbird open with a main window, and `caffeinate -is`.
7. Monitor.

The campaign journal is F9.

## 11. Verification (before `publish`)

1. **Run P:**
   - PY + PY39.
   - Synthetic end to end, in a temp dir outside git: fixtures → rank → `send-list` → a hand-made ledger with a header → `schedule`. Assert the neutral per-account files, windows, gaps, no BOM, the counts-only console, refusals of a mismatched ledger and a stale start.
   - The git-tree refusal.
2. **Run W, locally:**
   - The three checks + integration on postgres:18.
   - E2E (D29) on the `e2e-invites` branch with `next dev`, a throwaway `ADMIN_API_SECRET` and `OUTBOUND_ENABLED=false`, in an isolated browser context:
     - `import-invites` against `ADMIN_API_URL=http://localhost:3000` on a synthetic CSV fills the ledger; a re-run posts nothing; a blank last name works.
     - `/s/<token>`: prefill + greeting + "Not you?"; **every decision-table row** set up with `localStorage` fixtures; after one send, "Tell another one" keeps what was typed and the "Not you?" line is hidden.
     - Unknown and malformed tokens show the plain form.
     - A `curl` GET leaves the row count unchanged.
     - Headers OK.
     - One full submission; zero outbound sends logged.
3. **PR-2 preview** (protection bypass):
   - §8.10 step 2 (replay unmasked).
   - `/s/<fake>` pageload → `/s/[inviteToken]`.
   - **A Server Function POST and a client navigation on `/s/<token>`; the replay's network bodies and the trace contain no bare token** (search for the token string), while the user email does appear (R10).
4. Combined checks per run → Opus citation refresh → `publish`.

## 12. Release, rollback, cleanup

- **Release:** the PR-2 merge deploys + migrates (additive) and changes logging (R13) and replay masking (D20); S1 follows. The PR-1 merge ships scripts only.
- **Rollback:**
  - **Before go-day:** revert PR-2 (the `Invite` table stays, harmlessly); set the Sentry flags back to `true`; revoke an invite by setting `revokedAt` (SQL with Rob's OK; F3).
  - **After the first send: fix forward only (D27).**
- **Cleanup (Rob's OK):** the Neon branch `e2e-invites`, the Astra run dirs and worktrees, WT (only after confirming no uncommitted evidence), the Docker container.

## 13. Rob-owned steps

- Approve v2.
- Provide the private values (`notify.env`).
- Confirm the TCR buckets for each PR.
- Merge PR-2, then PR-1.
- Re-confirm S1.
- The WAF publish (D2).
- The family review with Richard (D4).
- "Go" for D6.
- D7 add-ons, settings, test sends, templates, copy.
- The D8 rehearsal.
- R6 copy.
- Go-day: Spend Management.
- Deleting the Neon branch.

## 14. Pre-mortem (v2)

| Failure | Guard |
|---|---|
| Mail Merge queues unscheduled mail in the Outbox and it flushes at once | D10 Save As Draft; D19 hold + post-merge gate (Outbox 0); D8 proves it |
| Exchange IMAP drops `X-Send-Later-*` | Drafts in Local Folders; header sample per account |
| A bad `send_at` silently becomes a plain draft | One fixed format; gate: scheduled count = rows |
| A burst of overdue messages after sleep | Late limit 60 min [C53]; `schedule` refuses a stale start; hold until the gate passes |
| Links lost or crossed | D2 ledger + header; D14 mapping by hash; D15 index checks |
| Prefill mixes people | D3 decision table + the Oscar-case test; D4 |
| The replay "fix" changes the wrong layer | D16 diagnosis first; D20 tested; S1 separate and re-confirmed |
| A token leaks (Sentry, replay network, logs, analytics, Referer) | D7 + D21 positive-control tests; a preview search for the bare token |
| A WAF edit removes existing protection | D2 diff-first, all five groups, before/after inspect |
| An E2E sends real mail | D29 `OUTBOUND_ENABLED=false` + DB assert + zero-send evidence |
| Private values lost on compaction | `notify.env` (0600) |
| The wrong deploy or a failed migration is taken as success | §0.2 Production + `success` + `finished_at` |
| Revoked or blank-name rows break the import | D15 stop on `revoked`; D22 |
| The family review delays readiness | D25 starts D3/D4 after P2 |

## 15. Review triage (A3 → A4, 2026-11-07)

Each finding was checked against the source: the shipped Mail Merge 11.6.1 XPI, `@sentry/replay` 11.11.0, `@sentry/nextjs` `withServerActionInstrumentation`, Vercel CLI 65.9.0 help, the Send Later and Sentry docs, and the repo at `7bbd54a`.

| Bucket | Findings | Where applied |
|---|---|---|
| 1 Must do | #1, #17, #23, #24 (Mail Merge mode, hold, gate, late limit) | D10, D19, §7.3, §10 D7–D8 |
| | #2, #19 (replay root cause), #18 (S1 timing) | R12 amendment, D16, D20, §8.10, Ledger |
| | #3, #20 (positive controls, tuples, preview check) | D21, §8.7, §11.3 |
| | #4, #21 (WAF procedure) | §10 D2 |
| | #7, #29 (prefill identity) | D3 decision table, D4 |
| | #8 (blank last name, name built) | D22, §8.3–8.5 |
| | #9 (revoked, email normalization) | D2, D15, §8.4–8.5 |
| | #11 (columns, attribution, CSV quirks) | §7.1, D11, D24 |
| | #12, #32, #33 (one live Ledger, acyclic order, no "B0") | header, §0.1, §4, §6, D1 |
| | #13, #34 (template paths, bucket definitions, unavailable reviewer, blockers) | §0.10, §0.11, §3, §9 |
| | #14 (`notify.env`), #15 (per-step rows, drift rule, Neon IDs), #16 (evidence homes, absolute `.env`) | §0.2, §0.6, §4 |
| | #22 (rehearsal exception) | R1 amendment, D8, D9 |
| | #25 (map by `tokenHash`) | D14, §8.4 |
| | #30 (`OUTBOUND_ENABLED`) | D29 |
| | #31 (deploy/migration checks, prod prefill proof) | §0.2, D26, D1 |
| | #35 (neutral names, private household names) | D8, D23 |
| | #37 (attribution tie) | D24 |
| | #38 (baseline `7bbd54a`) | header |
| | #39 (PR branches, orchestrator commits, WT rename) | §0.4 |
| | #42 (PR-3 docs) | D28, D10 |
| | #43 (fix forward after send) | D27, §12 |
| | #44 (D3 in background, `REHEARSAL_TO`, Rob excluded) | D30, §0.6, D26 |
| 2 Nice to do | #26 light (ledger header + prefix check) | D2 |
| | #36 (go-day OAuth, recovery owner, SMTP record) | §7.3, D7 |
| | #40 (memory pointer, already written) | header |
| | #41 (critical path) | D25; a target date is an open question for Rob in the Ledger |
| 3 Don't do | #5, #6 (drop the Cc), #10 (rewrite), #26 heavy, #27, #11 domain disambiguation | §16 |
| 4 Out of scope | #28 (go-day campaign journal); overdue-reconciliation procedure | §17 F9, F10 |

## 16. Non-goals (what we aren't doing, and why)

Reviewers: please don't raise these again unless you have new evidence. Each was decided by a Rob ruling, by scope, or by checking the source. (Drafted by a subagent from the A4 Bucket 3 list.)

### Settled by Rob's rulings or scope

- **No sending, scheduling or queuing to correspondents.** The plan ends when the paced Mail Merge + Send Later batch is ready but not queued. The only messages sent are the two rehearsal messages to Rob's own addresses. (R1 + amendment)
- **No link from a memory to its invite.** It would touch `createSubmission`, a TDD critical path, for little gain now. (follow-up F2)
- **No "opened" or "used" tracking on invites.** A GET must never write: link scanners and Next.js prefetch load pages without a person there, so counts would be wrong and the route would stop being safe to fetch. (issue #59; same rule as `/m/`; [C27, C28])
- **No Sentry suppression of invitee names or emails.** They fall under the 100% Sentry policy like other contributor data. Tokens stay forbidden. (R10)
- **No cookie or redirect scheme to keep `/s/<token>` out of Vercel request logs.** This is accepted, the same as `/m/`, as is the replay DOM residual on `/s/`. (R11, R5)
- **No Pino redaction of contributor fields.** That redaction is removed everywhere; bearer keys stay redacted. (R13)
- **No MCP tool for invites.** It would pass ~100 names and emails through a chat and break the pinned tool list; the local script keeps that data on Rob's Mac. (`__tests__/api/mcp.test.ts` :136 tool list, :1204 `toHaveLength(12)`)
- **No SendGrid or Gmail API sending, no TypeScript port of the harvester, no automated reminders.** We harden the existing Python harvester rather than rewriting it. (issue #59 §7.4; R7)
- **No Spend Management change.** That's Rob's go-day call. (R8)
- **No Python test suite in CI.** `ci.yml` is a required Node-only check; the harvester tests run locally under 3.9 and 3.11. (`.github/workflows/ci.yml`; follow-up F1)
- **No `prisma migrate diff --from-migrations` drift check.** It needs a shadow database and trips on hand-written CHECK constraints. The proof is `migrate deploy` on postgres:18 + the integration suite + CI. (D9)
- **No change to other people's unsent draft cards on a shared device.** That's existing `/share` behaviour, out of scope here. (follow-up F7)

### Review suggestions we declined (plan v2 review, 2026-11-07)

- **Two parent worktrees for the two Astra runs (review #5).** One source worktree can't cross-contaminate the runs. Astra `init` puts each run's integration branch and task worktrees under `~/.local/state/astra-work/`, outside the checkout, and `integrate` cherry-picks onto that integration branch, never onto the checkout's HEAD. The real problem, "W1" naming both the worktree and a task, is fixed by renaming the worktree "WT". (astra-work runner `init`/`integrate`; review #39)
- **Dropping the Cc to Rob's Gmail (review #6, that part only).** The Cc is the deliverability canary and Rob's live send log. Ten notes a day per account plus one Cc is 20 recipients a day per account, far below the published subscriber limits (5,000 daily recipients; 1,000 non-relationship), though Microsoft publishes no free-account numbers. The rest of #6 was adopted: a fresh go-day OAuth send and a named recovery-method owner. (issue #59 §5.10; [C12])
- **Rewriting analytics-client to scrub `event.url` (review #10).** The premise is wrong: `scrubPageView` already returns `{ ...event, url: scrubUrl(event.url) }`, so adding the `/s/` pattern to `scrubUrl` covers `url`. One assertion on `url` is added to the existing analytics test instead. (`app/_components/analytics-client.tsx` :44)
- **Exclusive importer ownership, per-batch checkpoints and a lost-response protocol (review #27).** Too much machinery for a one-time import of ~100 rows by one operator. The DB unique constraint makes re-runs idempotent (`exists`), the ledger is written atomically, and a lost response is recovered with `--rotate-missing` before anything is sent, never after. Its done-check fix was adopted: every approved row must have a ledger entry, rather than `created = rows`. (D15)
- **Binding each ledger to an environment plus a format version (review #26, heavy version).** The light version was adopted: a target/memorial header line, and a URL-prefix check of existing entries before import or scheduling. (D2)
- **Disambiguating colliding `<account-local-part>` file names with the domain (review #11, that part only).** Superseded: per-account files have neutral names, `send_list_primary.csv` / `send_list_second.csv`, which also keeps Jo's addresses out of printed paths. (review #35; D23)
- **A go-day campaign journal (review #28).** Not rejected as a design. It belongs to go-day, past this plan's stop line. (R1; follow-up F9)

## 17. Follow-ups (candidates; copy into the PR notes)

| # | Item | Severity | What a picker-upper needs |
|---|---|---|---|
| F1 | Python suite in CI | low | add `python3 -m unittest discover -s scripts/notify -p "test_*.py"` to `.github/workflows/ci.yml` |
| F2 | Link a memory to its invite | medium | `Contributor.inviteId` set server-side from the token in the form; `createSubmission` is TDD-critical |
| F3 | Invite revoke button | low | `revokedAt`; an admin Server Function + row; pattern in #75 |
| F4 | Spend Management for jowray.com only | medium | the phase1-ledger row; #43 §7.3 |
| F5 | Final thank-you copy | low | R6; `thank-you-client.tsx` :61 |
| F6 | `/m/` scrub pattern case-insensitive | low | `analytics.md` :77; `lib/sentry/scrub.ts` `CLAIM_PATH` |
| F7 | Someone else's unsent draft cards on a shared device | low | the `lib/share-draft.ts` key is shared; key it by contributor |
| F8 | Invite rows copied into Neon preview branches | low | D17; consider scrubbing preview branches |
| F9 | **Go-day campaign journal** (review #28) | medium | a private `~/jo-mail-review/campaign.csv` per row (account, `send_at`, merged / scheduled / sent / failed / unknown), reconciled against the Send Later list, Outbox and Sent before any re-merge; unknown outcomes never auto-retry |
| F10 | **Overdue-message reconciliation procedure** (review #24, the go-day part) | medium | when Send Later's late warning fires: check Sent for each overdue row, reschedule only the unsent ones, and record them in F9's journal |
| F11 | Org-level Sentry scrubbing policy for other projects | low | the org has scrubbing off; the project had it on; decide a consistent stance across `med3ai` projects |

## 18. Citations

(Fetched live on 2026-11-07 unless marked "repo" or "package". Repo sources are pinned to `origin/main` `7bbd54a`; the cited files are unchanged since `4f0a9a2`.)

### [C1] — Thunderbird profile location on macOS
- **Relevant File(s):** `scripts/notify/rank_correspondents.py` (docstring paths), `docs/notify-friends.md`
- **Change Summary:** The harvest reads `~/Library/Thunderbird/Profiles/itl33f39.default-release/ImapMail/<server>` for both accounts.
- **Source URL:** https://support.mozilla.org/en-US/kb/profiles-where-thunderbird-stores-user-data#w_moving-a-profile
- **Verbatim Quote:**
  > "~/Library/Thunderbird/ for Mac OS X."
- **Justification:** It names the macOS profile root that D3 and the runbook point into.

### [C2] — Thunderbird IMAP offline storage
- **Relevant File(s):** `docs/notify-friends.md`, `scripts/notify/rank_correspondents.py`
- **Change Summary:** Full local copies are required before harvesting.
- **Source URL:** https://support.mozilla.org/en-US/kb/imap-synchronization#w_configuring-synchronization-and-disk-space-usage
- **Verbatim Quote:**
  > "At the top of the page, Keep messages for this account on this computer should be checked if you want to synchronize messages between your local system and your mail server."
- **Justification:** This setting fills the mbox files the harvester reads.

### [C3] — mbox format
- **Relevant File(s):** `scripts/notify/rank_correspondents.py` (`read_mbox`), `scripts/notify/test_rank_correspondents.py`
- **Change Summary:** Fixtures write `From `-separated messages.
- **Source URL:** https://docs.python.org/3/library/mailbox.html#mailbox.mbox
- **Verbatim Quote:**
  > "All messages in an mbox mailbox are stored in a single file with the beginning of each message indicated by a line whose first five characters are “From “."
- **Justification:** The fixtures must emit this separator so the tests exercise the real reader.

### [C4] — Non-strict address parsing
- **Relevant File(s):** `scripts/notify/rank_correspondents.py` (`parse_addrs`, `last_name_of`)
- **Change Summary:** Non-strict parsing is pinned on both code paths.
- **Source URL:** https://docs.python.org/3/library/email.utils.html#email.utils.getaddresses
- **Verbatim Quote:**
  > "If strict is true, use a strict parser which rejects malformed inputs."
- **Justification:** Strict mode would drop whole recipient lists over one bad address.

### [C5] — unittest discovery
- **Relevant File(s):** `scripts/notify/test_rank_correspondents.py`
- **Change Summary:** A standard-library suite run by discovery.
- **Source URL:** https://docs.python.org/3/library/unittest.html#unittest-test-discovery
- **Verbatim Quote:**
  > "Unittest supports simple test discovery."
- **Justification:** It backs the PY/PY39 checks with no new dependency.

### [C6] — Mail Merge's own recommendation (context only)
- **Relevant File(s):** `docs/notify-friends.md`
- **Change Summary:** Explains why v1 got the mode wrong. The add-on page's recommendation is about reviewing merged mail in the Outbox, not about per-row scheduling.
- **Source URL:** https://addons.thunderbird.net/en-US/thunderbird/addon/mail-merge/#addon-description
- **Verbatim Quote:**
  > "It is strongly recommended to use "Send Later" as "Deliver Mode" and to check the individual and personalized messages in the folder "Local Folders -> Outbox"."
- **Justification:** "Send Later" here is Thunderbird's native Outbox mode, so it doesn't schedule per row [C50, C51]. The runbook quotes this to warn against it, and the plan uses Save As Draft (D10).

### [C7] — Mail Merge: variables in "At"; compatibility
- **Relevant File(s):** `docs/notify-friends.md`, `scripts/notify/rank_correspondents.py` (`schedule` writes `send_at`)
- **Change Summary:** `At = {{send_at}}` per row (in Save As Draft mode); 11.6.1 runs on Thunderbird 159.
- **Source URL:** https://addons.thunderbird.net/en-US/thunderbird/addon/mail-merge/#addon-description
- **Verbatim Quote:**
  > "Variables are supported in the fields From, To, Cc, Bcc, ReplyTo, Subject, Body and Custom Headers in the compose window as well as the field "Attachments" and "At" in the Mail Merge Dialog."
- **Justification:** Per-row times work because "At" takes variables. The listing says "Works with Thunderbird 128.0a1 - 160.*".

### [C8] — Mail Merge: CSV header names become variables
- **Relevant File(s):** `scripts/notify/rank_correspondents.py` (`schedule` header, no BOM)
- **Change Summary:** The header row is the template contract, written without a BOM (D11).
- **Source URL:** https://addons.thunderbird.net/en-US/thunderbird/addon/mail-merge/#addon-description
- **Verbatim Quote:**
  > "If you use Mail Merge with a spreadsheet, e.g. a CSV, JSON, ODS or XLSX, then the column names can be used as variables."
- **Justification:** A BOM would rename the first column to `﻿email`, so `{{email}}` would break.

### [C9] — Send Later's purpose
- **Relevant File(s):** `docs/notify-friends.md`
- **Change Summary:** Send Later holds each draft until its time.
- **Source URL:** https://github.com/Extended-Thunder/send-later#user-content-schedule-email-messages-to-be-sent-later
- **Verbatim Quote:**
  > "Schedule email messages to be sent later"
- **Justification:** The paced send depends on this.

### [C10] — Send Later needs a main window open
- **Relevant File(s):** `docs/notify-friends.md`; go-day
- **Change Summary:** Keep a main window open, and run `caffeinate -is`.
- **Source URL:** https://extended-thunder.github.io/send-later/#thunderbird-must-be-running-for-scheduled-messages-to-be-sent
- **Verbatim Quote:**
  > "You need to keep Thunderbird running (and your computer turned on!) for Send Later to be able to send scheduled messages (note that on Mac OS, "running" means there must be at least one main Thunderbird window open; Send Later will not work if the Thunderbird app is running but doesn't have any open windows)."
- **Justification:** It adds the macOS main-window condition.

### [C11] — Send Later compatibility
- **Relevant File(s):** `docs/notify-friends.md`; D7
- **Change Summary:** Install 10.7.8 on Thunderbird 159.0.
- **Source URL:** https://addons.thunderbird.net/en-US/thunderbird/addon/send-later-3/
- **Verbatim Quote:**
  > "Version 10.7.8  Released Nov. 7, 2025    639.8 KiB    Works with  Thunderbird 126.0 - 160.*"
- **Justification:** The installed version is in range.

### [C12] — Outlook.com limits depend on history
- **Relevant File(s):** `docs/notify-friends.md`, `scripts/notify/rank_correspondents.py` (`--pace per-account`)
- **Change Summary:** A gentle per-account clock (R4).
- **Source URL:** https://support.microsoft.com/en-us/outlook/sending-limits-in-outlook-com#what-are-the-outlookcom-email-limits
- **Verbatim Quote:**
  > "Limits may vary based on usage history and will be lower for non-subscribers."
- **Justification:** Limits are per account and depend on history, with no free-account numbers published, so the pace is a cautious operational choice.

### [C13] — Outlook.com "non-relationship recipient"
- **Relevant File(s):** `scripts/notify/rank_correspondents.py` (`account`), `docs/notify-friends.md`
- **Change Summary:** Send from the account the person knew.
- **Source URL:** https://support.microsoft.com/en-us/outlook/sending-limits-in-outlook-com#what-are-the-outlookcom-email-limits
- **Verbatim Quote:**
  > "A “non-relationship recipient” is someone you've never sent email to before."
- **Justification:** Per-account attribution keeps most recipients relationship recipients.

### [C14] — Gmail: start low, to engaged recipients
- **Relevant File(s):** `docs/notify-friends.md`
- **Change Summary:** Low volume, plain text, at most two links.
- **Source URL:** https://support.google.com/mail/answer/81126?hl=en#increase-volume-slowly
- **Verbatim Quote:**
  > "Start with a low sending volume to engaged users, and slowly increase the volume over time."
- **Justification:** Gmail is the canary inbox and a common host.

### [C15] — Microsoft accounts need OAuth in Thunderbird
- **Relevant File(s):** `docs/notify-friends.md`; D7; go-day
- **Change Summary:** Test sends at D7 and again on go-day morning.
- **Source URL:** https://support.mozilla.org/en-US/kb/microsoft-oauth-authentication-and-thunderbird-202#w_changes-to-authentication
- **Verbatim Quote:**
  > "Deprecated basic authentication (username/password), now requiring OAuth authentication."
- **Justification:** OAuth sending must be proven, and re-proven before go-day.

### [C16] — Prisma `migrate dev` is for development
- **Relevant File(s):** `prisma/migrations/20261107120000_invites/migration.sql`
- **Change Summary:** The migration is generated offline instead (D9).
- **Source URL:** https://docs.prisma.io/docs/cli/v7/migrate/dev
- **Verbatim Quote:**
  > "The prisma migrate dev command creates and applies migrations during development."
- **Justification:** It needs a dev DB and a shadow DB, and neither Astra nor the offline build has one.

### [C17] — Prisma `migrate deploy`
- **Relevant File(s):** `prisma/migrations/20261107120000_invites/migration.sql`; §12; D1
- **Change Summary:** The PR-2 merge migrates production; Docker and CI prove it first.
- **Source URL:** https://docs.prisma.io/docs/cli/v7/migrate/deploy
- **Verbatim Quote:**
  > "The prisma migrate deploy command applies all pending migrations and creates the database if it doesn't exist. Primarily used in non-development environments."
- **Justification:** `vercel.json` runs it in the build, so PR-2 merges first (D1).

### [C18] — Prisma `migrate diff`
- **Relevant File(s):** `prisma/migrations/20261107120000_invites/migration.sql`
- **Change Summary:** `--from-schema <old> --to-schema prisma/schema.prisma --script -o …`.
- **Source URL:** https://docs.prisma.io/docs/cli/v7/migrate/diff
- **Verbatim Quote:**
  > "The prisma migrate diff command compares two database schema sources and outputs a description of the migration needed to transform the first into the second."
- **Justification:** The options table lists `--from-schema`/`--to-schema` ("Path to a Prisma schema file"), `--script` and `-o`, which makes offline generation possible.

### [C19] — Prisma compound unique
- **Relevant File(s):** `prisma/schema.prisma`
- **Change Summary:** `@@unique([memorialId, email])`.
- **Source URL:** https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference#unique-1
- **Verbatim Quote:**
  > "Defines a compound unique constraint for the specified fields."
- **Justification:** It makes re-imports idempotent (`exists`).

### [C20] — Prisma create
- **Relevant File(s):** `features/invites/create-invites.ts`
- **Change Summary:** Only the required fields are passed.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/queries/crud#create-a-single-record
- **Verbatim Quote:**
  > "The id is auto-generated. Your schema determines which fields are mandatory."
- **Justification:** It relies on `@default(uuid())`.

### [C21] — Node `crypto.randomBytes`
- **Relevant File(s):** `lib/invite-token.ts`
- **Change Summary:** `randomBytes(9)`.
- **Source URL:** https://nodejs.org/api/crypto.html#cryptorandombytessize-callback
- **Verbatim Quote:**
  > "Generates cryptographically strong pseudorandom data."
- **Justification:** Unguessable tokens need a CSPRNG.

### [C22] — Node `base64url`
- **Relevant File(s):** `lib/invite-token.ts`
- **Change Summary:** 9 bytes → 12 URL-safe characters.
- **Source URL:** https://nodejs.org/api/buffer.html#buffers-and-character-encodings
- **Verbatim Quote:**
  > "'base64url': base64url encoding as specified in RFC 4648, Section 5."
- **Justification:** The RFC 4648 §5 alphabet is exactly `INVITE_TOKEN_PATTERN`.

### [C23] — Node `--env-file`
- **Relevant File(s):** `scripts/import-invites.ts`; §0.6, §5
- **Change Summary:** `--env-file=<absolute main-checkout .env>`; a process-env override for E2E.
- **Source URL:** https://nodejs.org/api/cli.html#--env-filefile
- **Verbatim Quote:**
  > "Loads environment variables from a file relative to the current directory, making them available to applications on process.env."
- **Justification:** "Relative to the current directory" is why the plan passes an **absolute** path from worktrees (review #16).

### [C24] — Next.js Route Handlers
- **Relevant File(s):** `app/api/admin/invites/route.ts`
- **Change Summary:** A POST handler.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/route (local: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md:6`, Next 16.4.4)
- **Verbatim Quote:**
  > "Route Handlers allow you to create custom request handlers for a given route using the Web Request and Response APIs."
- **Justification:** It copies `app/api/admin/memories/route.ts`.

### [C25] — Next.js `connection()`
- **Relevant File(s):** `app/s/[inviteToken]/page.tsx`
- **Change Summary:** `await connection()` comes first.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/connection (local: `…/04-functions/connection.md:6`)
- **Verbatim Quote:**
  > "The connection() function allows you to indicate rendering should wait for an incoming user request before continuing."
- **Justification:** It keeps the Neon driver out of prerender [C39].

### [C26] — Next.js page `params`
- **Relevant File(s):** `app/s/[inviteToken]/page.tsx`
- **Change Summary:** `await params` inside `<Suspense>`.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/page#params-optional (local: `…/03-file-conventions/page.md:64`)
- **Verbatim Quote:**
  > "Since the params prop is a promise, you must use async/await or React's use function to access the values."
- **Justification:** Same as `app/m/[claimToken]/page.tsx` :32–35.

### [C27] — Next.js: no side effects in render
- **Relevant File(s):** `features/invites/resolve-invite.ts`, `app/s/[inviteToken]/page.tsx`, `prisma/schema.prisma`
- **Change Summary:** A read-only lookup (D6).
- **Source URL:** https://nextjs.org/docs/app/guides/data-security#avoiding-side-effects-during-rendering (local: `…/02-guides/data-security.md:569`)
- **Verbatim Quote:**
  > "Mutations (e.g. logging out users, updating databases, invalidating caches) should never be a side-effect, either in Server or Client Components."
- **Justification:** The zero-writes test enforces it.

### [C28] — Next.js prefetch
- **Relevant File(s):** `app/s/[inviteToken]/page.tsx`, `features/invites/resolve-invite.ts`
- **Change Summary:** Renders must be safe without a person present.
- **Source URL:** https://nextjs.org/docs/app/api-reference/components/link#prefetch (local: `…/02-components/link.md:298`)
- **Verbatim Quote:**
  > "Prefetching happens when a <Link /> component enters the user's viewport (initially or through scroll)."
- **Justification:** Automatic renders are why D6 exists.

### [C29] — Next.js `headers`
- **Relevant File(s):** `next.config.ts`
- **Change Summary:** `/s/:path*` headers.
- **Source URL:** https://nextjs.org/docs/app/api-reference/config/next-config-js/headers (local: `…/01-next-config-js/headers.md:8`)
- **Verbatim Quote:**
  > "Headers allow you to set custom HTTP headers on the response to an incoming request on a given path."
- **Justification:** The same mechanism `/m/` uses.

### [C30] — `Referrer-Policy: no-referrer`
- **Relevant File(s):** `next.config.ts`, `app/s/[inviteToken]/page.tsx`
- **Change Summary:** Header + meta.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy#no-referrer
- **Verbatim Quote:**
  > "The Referer header will be omitted: sent requests do not include any referrer information."
- **Justification:** The token is in the path.

### [C31] — `X-Robots-Tag`
- **Relevant File(s):** `next.config.ts`
- **Change Summary:** `noindex, nofollow`.
- **Source URL:** https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag#xrobotstag
- **Verbatim Quote:**
  > "The X-Robots-Tag can be used as an element of the HTTP header response for a given URL. Any rule that can be used in a robots meta tag can also be specified as an X-Robots-Tag."
- **Justification:** Invite links must never be indexed.

### [C32] — React `defaultValue`
- **Relevant File(s):** `app/share/share-form.tsx`, `lib/share-prefill.ts`
- **Change Summary:** The prefill feeds the uncontrolled inputs.
- **Source URL:** https://react.dev/reference/react-dom/components/input#props
- **Verbatim Quote:**
  > "defaultValue: A string. Specifies the initial value for a text input."
- **Justification:** An initial value the person can still change.

### [C33] — Sentry `beforeSend*` scrubbing
- **Relevant File(s):** `lib/sentry/scrub.ts`, `lib/sentry/secrets.ts`, `__tests__/lib/sentry-scrub*.test.ts`, `__tests__/lib/sentry-envelope.test.ts`
- **Change Summary:** `INVITE_PATH`, the tuple rule, secret keys, positive-control tests.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/data-management/sensitive-data/#scrubbing-in-beforesend-sdk-hooks
- **Verbatim Quote:**
  > "SDKs provide various beforeSend* hooks, which are invoked before errors, messages, spans, logs, or metrics are sent and can be used to modify event data to remove sensitive information."
- **Justification:** The repo's scrubber runs in those hooks. It's the token control, and after S1 the only one.

### [C34] — Vercel Analytics `beforeSend`
- **Relevant File(s):** `app/_components/analytics-client.tsx`, `__tests__/app/analytics-client.test.ts`
- **Change Summary:** Drop odd `/s/` paths; assert `url` is scrubbed.
- **Source URL:** https://vercel.com/docs/analytics/package#beforesend
- **Verbatim Quote:**
  > "Returning null will ignore the event and no data will be sent. You can also modify the URL and check our docs about redacting sensitive data."
- **Justification:** `url` is modified (already at :44); `dp` can't be, so non-route `/s/` paths return `null`.

### [C35] — Pino redaction
- **Relevant File(s):** `lib/logger/logger.ts`, `__tests__/lib/logger.test.ts`
- **Change Summary:** Redact paths = bearer keys + headers only (R13).
- **Source URL:** https://getpino.io/#/docs/redaction?id=redaction
- **Verbatim Quote:**
  > "To redact sensitive information, supply paths to keys that hold sensitive data using the redact option."
- **Justification:** The path list *is* the policy; R13 shrinks it to bearer keys.

### [C36] — Vitest naming
- **Relevant File(s):** new `__tests__/**/*.test.ts`; `lib/share-prefill.ts`, `lib/sentry/replay-options.ts`
- **Change Summary:** `.tsx`/init logic is extracted into tested `.ts` modules.
- **Source URL:** https://vitest.dev/guide/#writing-tests
- **Verbatim Quote:**
  > "By default, tests must contain .test. or .spec. in their file name."
- **Justification:** With `include: ["__tests__/**/*.test.ts"]`, only `.ts` suites run.

### [C37] — Zod array bounds
- **Relevant File(s):** `lib/validations/invite.ts`
- **Change Summary:** `.min(1).max(200)`.
- **Source URL:** https://zod.dev/api#arrays
- **Verbatim Quote:**
  > "Zod implements a number of array-specific validations:"
- **Justification:** The next line shows `.max(5)`, the bound used here at 200.

### [C38] — Vercel WAF rate limiting
- **Relevant File(s):** none in the repo (D2); public-safe summary in PR-3
- **Change Summary:** Add `/s/` to the existing rule.
- **Source URL:** https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting
- **Verbatim Quote:**
  > "Rate limiting allows you to control the number of times that a request from the same source can hit your application within a specific timeframe."
- **Justification:** `/s/` is public, DB-backed and takes form POSTs.

### [C39] — repo: AGENTS.md Cache Components rule
- **Relevant File(s):** `app/s/[inviteToken]/page.tsx`; TS briefs
- **Change Summary:** `connection()` first.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/7bbd54a/AGENTS.md (line 49)
- **Verbatim Quote:**
  > "The **first** thing a dynamic page component does is `await connection()` (then `params`/`searchParams`/`headers()` as needed); a `GET` handler reads `request.headers` or `request.nextUrl` first. Only then touch Prisma or env."
- **Justification:** `/s/` copies `/m/`'s shape.

### [C40] — repo: AGENTS.md Sentry forbidden list
- **Relevant File(s):** `lib/sentry/scrub.ts`, `lib/sentry/secrets.ts`, `AGENTS.md`, `docs/code-layout.md`, `app/share/share-form.tsx`
- **Change Summary:** Invite tokens join the forbidden list; `/s/` joins the residuals.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/7bbd54a/AGENTS.md (line 57)
- **Verbatim Quote:**
  > "Still forbidden everywhere: claim tokens in any form (`/m/<token>`, `?t=`, `claimToken(s)`, `claimLink`), upload tickets (`ticket`, `clientPayload`, `sig`) and the values of `cookie`, `authorization`, `x-vercel-protection-bypass`, `x-vercel-signature`."
- **Justification:** Invite tokens are the same kind of bearer value (R10).

### [C41] — repo: AGENTS.md layers
- **Relevant File(s):** `features/invites/*`, `lib/invite-token.ts`, `lib/share-prefill.ts`, `lib/sentry/replay-options.ts`, `app/api/admin/invites/route.ts`, `app/s/[inviteToken]/page.tsx`
- **Change Summary:** Each file sits in its layer.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/7bbd54a/AGENTS.md (line 37)
- **Verbatim Quote:**
  > "`app/ → features/ → services/ → integrations/`. A layer imports only from layers below it plus `lib/` and `server/`."
- **Justification:** `eslint.config.mjs` enforces it.

### [C42] — repo: AGENTS.md logger rule
- **Relevant File(s):** `lib/logger/logger.ts`, `AGENTS.md`, `docs/code-layout.md`, `features/invites/create-invites.ts`
- **Change Summary:** The rule is rewritten for R13; the feature logs counts and ids.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/7bbd54a/AGENTS.md (line 41)
- **Verbatim Quote:**
  > "Server code logs with Pino (`lib/logger`), never `console.log`."
- **Justification:** The redacted-key list that follows this sentence is what R13 changes, so the text and the code change together.

### [C43] — repo: issue #38 §1.4
- **Relevant File(s):** `app/share/thank-you-client.tsx`
- **Change Summary:** The R6 placeholder.
- **Source URL:** https://github.com/RobertdWray/jowray_com/issues/38 (§1.4)
- **Verbatim Quote:**
  > "`app/share/thank-you-client.tsx:61` tells every contributor: "On November 10th … we'll be sharing them with everyone and will email an update to all who have contributed." With Phase 2 not being built, the site cannot keep that date, and no update email type exists."
- **Justification:** Invitees arrive after November 10.

### [C44] — repo: CI integration DB
- **Relevant File(s):** `__tests__/integration/invites.test.ts`; §0.3, §11
- **Change Summary:** postgres:18-alpine + `TEST_DATABASE_URL`.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/7bbd54a/.github/workflows/ci.yml (lines 19–48)
- **Verbatim Quote:**
  > "# A throwaway Postgres for `__tests__/integration/*` (issue #44, D7): the budget race is an
  >     # isolation property the in-memory mocks cannot show. The app's DATABASE_URL stays unset."
- **Justification:** The local Docker run mirrors CI.

### [C45] — repo: feature-doc template
- **Relevant File(s):** `docs/features/invite-links.md`, `docs/features/README.md`, `README.md`, `docs/notify-friends.md`
- **Change Summary:** Template + index; no private details.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/7bbd54a/docs/features/template.md
- **Verbatim Quote:**
  > "**Public repo.** No private family details: no sender names, addresses, emails or message text. Use placeholders (`<memoryId>`, `<sender email>`)."
- **Justification:** It governs both new docs.

### [C46] — Prisma `createManyAndReturn` / `skipDuplicates`
- **Relevant File(s):** `features/invites/create-invites.ts`
- **Change Summary:** A batch insert that skips duplicates; results mapped by `tokenHash` (D14).
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/queries/crud#create-and-return-multiple-records
- **Verbatim Quote:**
  > "Supported by PostgreSQL, CockroachDB, and SQLite."
- **Justification:** Production is Postgres. The same page says "skipDuplicates is not supported on MongoDB, SQLServer, or SQLite", so it works here. Skipped rows shift positions, hence mapping by the unique hash.

### [C47] — Sentry server-side Data Scrubbing defaults
- **Relevant File(s):** none in code (S1); `docs/features/sentry-telemetry.md`, `docs/features/privacy.md`
- **Change Summary:** Turn off `dataScrubber`/`dataScrubberDefaults` for `jowray_com` **for event data** (R12 amended).
- **Source URL:** https://docs.sentry.io/security-legal-pii/scrubbing/server-side-scrubbing/
- **Verbatim Quote:**
  > "If you can't or don't want to scrub data within the SDK, you can choose from several data scrubbing options in the Sentry app on either an organization-wide or a project level."
- **Justification:** The page lists what is removed: values that "contain, or whose keynames contain" `password`, `secret`, `auth`, `token`, `bearer`…, so story text is blanked in events. The SDK scrubber stays the token control [C33].

### [C48] — Sentry Replay: what server-side scrubbing covers
- **Relevant File(s):** none in code; `docs/features/sentry-telemetry.md`; corrects v1
- **Change Summary:** Server scrubbing covers replay **metadata**, not the recorded page, so it isn't the cause of the masked fields.
- **Source URL:** https://docs.sentry.io/security-legal-pii/scrubbing/protecting-user-privacy/
- **Verbatim Quote:**
  > "To assist in debugging, Session Replay captures additional metadata like console.log entries, network requests, browser, operating system, and more. By default, Sentry scans this data on the server and automatically removes potentially sensitive strings like credit card numbers, social security numbers, API tokens, and more."
- **Justification:** "This data" is the metadata, so the masked DOM fields come from the SDK [C54] (review #2, #19).

### [C49] — Next.js colocation
- **Relevant File(s):** `app/share/intro.tsx`, `app/share/page.tsx`
- **Change Summary:** A shared, non-route `Intro` module.
- **Source URL:** https://nextjs.org/docs/app/getting-started/project-structure#colocation (local: `node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md:245`)
- **Verbatim Quote:**
  > "This means that **project files** can be **safely colocated** inside route segments in the `app` directory without accidentally being routable."
- **Justification:** Both pages import it; nothing imports from a page module.

### [C50] — package: Mail Merge 11.6.1 "Send Later" mode = native Outbox
- **Relevant File(s):** `docs/notify-friends.md`; D10, D19
- **Change Summary:** Never use Deliver Mode "Send Later".
- **Source URL:** https://addons.thunderbird.net/thunderbird/downloads/latest/mail-merge/addon-mail-merge-latest.xpi (version 11.6.1, sha256 `b0645b89d7891dee…`, `content/dialog.js:777`)
- **Verbatim Quote:**
  > "await messenger.compose.sendMessage(popup.id, { mode: "sendLater" });"
- **Justification:** Thunderbird's native send-later mode queues mail in the Outbox with no per-row time; a later "send unsent" would flush it all (review #1).

### [C51] — package: Mail Merge "At" only in Save As Draft
- **Relevant File(s):** `docs/notify-friends.md`; D10
- **Change Summary:** Deliver Mode = Save As Draft, At = `{{send_at}}`.
- **Source URL:** same XPI, `content/dialog.js:419` (and :1150, :1196)
- **Verbatim Quote:**
  > "document.getElementById("mailmerge-dialog-sendlater-container").hidden = !(document.getElementById("mailmerge-dialog-delivermode").value === "SaveAsDraft""
- **Justification:** The At control (and the `X-Send-Later-At` header at :1196) only exists in Save As Draft mode.

### [C52] — Send Later hold: "Check every" = 0
- **Relevant File(s):** `docs/notify-friends.md`; D19, D7–D9
- **Change Summary:** The hold during setup, after the rehearsal, and until the go-day gate passes.
- **Source URL:** https://extended-thunder.github.io/send-later/
- **Verbatim Quote:**
  > "If you set the "Check every # minutes" option to "0", then Send Later won't deliver scheduled drafts when their time comes; it'll just leave them in your Drafts folder as if their delivery time has not yet arrived."
- **Justification:** A documented, reversible hold. READY requires it on.

### [C53] — Send Later late-message limit
- **Relevant File(s):** `docs/notify-friends.md`; D19, go-day
- **Change Summary:** "Don't deliver messages more than 60 minutes late".
- **Source URL:** https://extended-thunder.github.io/send-later/
- **Verbatim Quote:**
  > "If this option is enabled, then Send Later will pop up a warning about any such messages and leave them for you to reschedule by editing the relevant draft message by hand."
- **Justification:** It prevents a burst of overdue messages after sleep or restart (review #24).

### [C54] — Sentry Replay masking defaults
- **Relevant File(s):** `lib/sentry/replay-options.ts`, `instrumentation-client.ts`, `__tests__/lib/replay-options.test.ts`
- **Change Summary:** `maskAttributes: []` alongside the existing unmasked flags (D20).
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/session-replay/privacy/#privacy-configuration (package: `node_modules/@sentry/replay/build/npm/esm/index.js:8333`, v11.11.0)
- **Verbatim Quote:**
  > "maskAllInputs | boolean | true | Mask values of <input> elements. Passes input values through maskFn before sending to server."

  Package line: `maskAttributes = ["title", "placeholder", "aria-label"],`
- **Justification:** The repo already turns `maskAllText` and `maskAllInputs` off, but the package's `maskAttribute` (:8264–8281) still stars placeholders. That's what Rob saw, and an empty `maskAttributes` removes it.

### [C55] — package: `@sentry/nextjs` records response bodies only for Server Functions
- **Relevant File(s):** `__tests__/lib/sentry-envelope.test.ts` (test design)
- **Change Summary:** No route-handler response test; positive controls on the transports that do carry data (D21).
- **Source URL:** https://www.npmjs.com/package/@sentry/nextjs (installed `node_modules/@sentry/nextjs/build/cjs/common/withServerActionInstrumentation.js:21`)
- **Verbatim Quote:**
  > "const shouldRecordResponse = core.getClient()?.getDataCollectionOptions().httpBodies.includes("outgoingResponse");"
- **Justification:** That flag is read only in the Server Action wrapper, which sets `server_action_result`. A route-handler response assertion could never fail (review #3, #20).

### [C56] — Vercel CLI: `firewall diff`
- **Relevant File(s):** none (D2)
- **Change Summary:** Diff before and after editing; stop on unrelated drafts.
- **Source URL:** https://vercel.com/docs/cli/firewall#diff
- **Verbatim Quote:**
  > "Review draft changes before publishing to production. Shows what was added, removed, modified, enabled, or disabled, with field-level details for modified rules."
- **Justification:** It proves only the `/s/` change is staged before `publish` (review #4).

### [C57] — package: Vercel CLI 65.9.0 help, `--condition` replaces; `publish` ships all
- **Relevant File(s):** none (D2)
- **Change Summary:** Send all five path groups or round-trip the JSON; never a single `/s/` condition.
- **Source URL:** https://vercel.com/docs/cli/firewall (installed CLI 65.9.0: `vercel firewall rules edit --help`, `vercel firewall publish --help`)
- **Verbatim Quote:**
  > "--condition                 Replace conditions as JSON (repeatable). Example:"

  and

  > "Publish all draft firewall changes to production, making them live immediately"
- **Justification:** A one-condition edit would delete `/share`, `/api/upload`, `/api/media/` and `/m/` from the rule (review #4, #21).

### [C58] — repo: outbound email switch
- **Relevant File(s):** none changed; E2E procedure (D29)
- **Change Summary:** Set `OUTBOUND_ENABLED=false` explicitly in the E2E process env.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/7bbd54a/server/config/env.ts (line 86)
- **Verbatim Quote:**
  > "OUTBOUND_ENABLED: strictBoolean.default(false),"
- **Justification:** The `.env` may set it to `true`, and the process env wins [C23]. Setting it explicitly makes E2E safe (review #30).

### [C59] — repo: `contributorNameSchema` requires at least one character
- **Relevant File(s):** `lib/validations/invite.ts`, `scripts/import-invites.ts`
- **Change Summary:** A blank `lastName` becomes `undefined` before validation (D22).
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/7bbd54a/lib/validations/memory.ts (line 62)
- **Verbatim Quote:**
  > "export const contributorNameSchema = requiredString(NAME_REQUIRED_MESSAGE).min(1, NAME_REQUIRED_MESSAGE).max(120, NAME_TOO_LONG_MESSAGE);"
- **Justification:** An empty string would fail `.min(1)` and 400 the whole batch (review #8).

**File → citations:**

| File | Citations |
|---|---|
| `scripts/notify/rank_correspondents.py` | C1, C2, C3, C4, C7, C8, C12, C13 |
| `scripts/notify/test_rank_correspondents.py` | C3, C5 |
| `docs/notify-friends.md` | C1, C2, C6–C15, C45, C50–C53 |
| `prisma/schema.prisma` | C19, C27 |
| `prisma/migrations/20261107120000_invites/migration.sql` | C16, C17, C18 |
| `lib/invite-token.ts` | C21, C22 |
| `lib/validations/invite.ts` | C37, C59 |
| `features/invites/create-invites.ts` | C20, C41, C42, C46 |
| `features/invites/resolve-invite.ts` | C27, C28 |
| `app/api/admin/invites/route.ts` | C24, C41 |
| `scripts/import-invites.ts` | C23, C59 |
| `app/s/[inviteToken]/page.tsx` | C25, C26, C27, C28, C30, C39, C41 |
| `app/share/intro.tsx`, `app/share/page.tsx` | C49 |
| `app/share/share-form.tsx`, `lib/share-prefill.ts` | C32, C36, C40 |
| `app/share/thank-you-client.tsx` | C43 |
| `next.config.ts` | C29, C30, C31 |
| `lib/sentry/scrub.ts`, `lib/sentry/secrets.ts` | C33, C40, C55 |
| `lib/sentry/replay-options.ts`, `instrumentation-client.ts` | C36, C48, C54 |
| `app/_components/analytics-client.tsx` | C34 |
| `lib/logger/logger.ts` | C35, C42 |
| `__tests__/**` | C36, C44, C55 |
| `docs/features/*` | C45, C47, C48 |
| `AGENTS.md`, `docs/code-layout.md`, `README.md` | C40, C41, C42, C45 |
| Sentry project setting (S1) | C47, C48 |
| WAF (D2) | C38, C56, C57 |
| E2E procedure | C23, C58 |
