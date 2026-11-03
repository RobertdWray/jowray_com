# jowray.com Phase 1 Implementation Plan — Database, Core Infrastructure, Web Memory Collection

> **For the executing agent:** orchestrator steps run only in Rob's Mac checkout, `/Users/rob/Documents/active_work/jowray_com/`. **If that `cd` fails, you are not the orchestrator:** either you are a worker (start from your brief's base SHA and skip §0.1) or you must stop. Start with §0.1 (cold start) every time you pick this file up as the orchestrator, including after a context compaction. The execution model (who does what, waves, PRs, hand-back) is §0.2. Every change carries a citation tag `[C#]`; the tags resolve in the Citations section. Project rules in `AGENTS.md` apply to every task: every change goes on a branch with a PR, never commit `.env*`, never hide an error `[C4]`.

**Revision 4 (2026-11-03).** Revision 2 reduced the scope: **SMS/MMS collection and the phone line (VoIP.ms voicemail) are deferred** because they are too complex for now; Rob keeps the VoIP.ms sub-account and keys for a later phase. Phase 1 collects memories through the web only. Gemini has no runtime use in Phase 1; Rob will provision a **billed** Google Cloud project before Phase 2 `[C65]`. Revision 3 applied the second premortem (SendGrid gate `[C71]`, ledger file, iPhone formats `[C72]`, seed env vars, email retries, non-interactive Sentry install, owners and worker/orchestrator checks). Revision 4 applies the four-lens review of revision 3 (§12 part C): offline worker builds, dependency waves, upload hardening and cost ceilings, token hashing, per-task ledger sections, stacked PR bases.

**Goal:** Build Phase 1 of the Memorial Memories site as designed in `docs/Memorial Memories Site initial thinking.md`, at the reduced scope: the database, the infrastructure the bootstrap left open, and memory collection by web upload (voice, video, photo, text). Every memory is stored untouched with who left it, an approximate date, and consent, and the contributor gets a claim link by email `[C1]`.

**Architecture:** The existing Next.js 16.4.4 App Router scaffold (`app/` at the repo root, no `src/`) on Vercel project `rob-wrays-projects/jowray.com`, with Neon project `icy-scene-20351172` (Vercel-managed, preview branching on), Sentry project `med3ai/jowray_com`, and the custom domain `https://www.jowray.com` (apex redirects 308 to `www`) `[C2, C57]`. Code follows the EmpathIQ house layout adapted to the root-level `app/` directory: `features/ → services/ → integrations/`, integrations import `"server-only"`, Pino logging, zod validation `[C5]`, with one deliberate exception: under Cache Components, no route exports `dynamic` or `runtime` `[C58, C59]`. Prisma 7 with `@prisma/adapter-neon` sits on the existing `@neondatabase/serverless` driver `[C22, C61]`. Files go browser → private Vercel Blob store via client upload; the app finalizes each upload server-side and sends one confirmation email through SendGrid `[C31, C35]`.

**Tech Stack:** Next.js 16.4.4 | React 19.3 | TypeScript 5 | Tailwind 4 | Prisma 7 + `@prisma/adapter-neon` (Neon Postgres 18) | `@sentry/nextjs` 11 | `@sendgrid/mail` | `@vercel/blob` (private store) | Vercel Cron (one reconcile job) | Cloudflare DNS API | Vitest | GitHub Actions

**Branch / PRs:** four stacked PRs (§0.2): A `feat/phase1-foundation` (Tasks 1–2), B `feat/phase1-data-observability` (Tasks 3–4), C `feat/phase1-storage-email-dns` (Tasks 5–6), D `feat/phase1-web-collection` (Tasks 7–9 + the Task 10 record), plus a final `docs/phase1-close` PR for post-merge ledger rows. `main` requires PRs `[C4]`.

---

## 0. Read this first: what was verified, what is assumed, what changed

**Repository state (verified 2026-11-03, `main` at `3e9d619`).** Fresh `create-next-app` 16.4.4 scaffold: `app/layout.tsx` (imports `Geist`/`Geist_Mono` from `next/font/google`, which downloads font files at build time `[C76]`, and uses the generated global type `LayoutProps<"/">` `[C74]`), `app/page.tsx`, `app/globals.css`, `next.config.ts` (`cacheComponents: true`, `partialPrefetching: true`, Tailwind through `@tailwindcss/turbopack`), ESLint 9 with `globalIgnores` for `.next/**`, `out/**`, `build/**`, `next-env.d.ts` only, `@neondatabase/serverless@1.2.0`, `@types/node ^20`, no `src/`, no tests, no Prisma, no Sentry SDK, no `.github/` `[C2]`. Docs on `main`: the design doc, `docs/environment.md`, `docs/plans/2026-11-02-bootstrap.md` (frozen), `docs/plans/2026-11-02-bootstrap-report.md` (authoritative), `docs/voip_ms_262980_jowray-subaccount-settings.md`.

**Open branches that matter:**

- `docs/custom-domain` (`3d75559`): adds `docs/domain.md`: `https://www.jowray.com` is primary, the apex 308s to it, the Vercel domains and Cloudflare `A`/`CNAME` records already exist, the zone id is `dad5b9fdb1ece5afc4a4224f61a51770`, the Cloudflare token is account-owned, email DNS is not done `[C57]`. **This plan depends on it. Merge it first (Task 0).**
- `docs/phase1-plan`: this file. The ledger `docs/plans/phase1-ledger.md` does not exist yet; Task 0 creates it from Appendix A on this branch.

**What PR #1 (merged) already did, which this plan builds on rather than repeats `[C2]`:** Vercel project connected to GitHub (production branch `main`, Node 26.x, `iad1`); Neon project `icy-scene-20351172`, database `neondb`, empty, preview branching verified, 16 database env vars in all three environments; Sentry project created, DSN in `.env` as `NEXT_PUBLIC_SENTRY_DSN`, SDK not installed; `.env` with 37 keys (mode 600) including empty placeholders `GEMINI_API_KEY`, `SENTRY_AUTH_TOKEN`, `AUTH_SECRET` `[C3]`; preview deployment URLs return 302 from Deployment Protection.

**PR #1 follow-ups this plan absorbs** (report "Remaining tasks") `[C2]`: #1 Neon `dev` branch (Task 1); #2 Sentry SDK + org token (Task 4); #3 protect `main` (Task 1); #4 CI (Task 1); #10 preview-branch cleanup (Task 1); #14 `.env.local` mode after `vercel env pull` (Tasks 1, 5). **#12 (VoIP.ms egress) is deferred with the phone line** (§9, §11). Not in scope: #7, #8, #13, #15.

**Verified live on 2026-11-02/03:** `docs/domain.md` (repo); `next@16.4.4` bundled docs `[C58, C59, C73, C74, C75, C76, C77]`; Sentry v10→v11 migration guide `[C60]`; Prisma v7 generators and config reference `[C61, C62]`; `@vercel/blob@2.8.2` source `[C63, C78]`; Vercel system env var docs `[C64]`; Gemini API Additional Terms and Interactions API docs `[C65, C66]`; VoIP.ms wiki (kept for later phases) `[C67, C68]`; SendGrid free-plan retirement `[C71]`; iOS `MediaRecorder` support `[C72]`; npm `dist-tags` for `next`, `@sentry/nextjs`, `prisma`, `@prisma/client`, `@vercel/blob`.

**Could not be verified:** the EmpathIQ docs site (404); the EmpathIQ **source repository** is the house-convention source `[C5–C12]`. `[C69]` is a third-party mirror of the VoIP.ms API reference and is marked unverified. A presigned-GET API in `@vercel/blob` 2.8.2 was suggested by a reviewer but is not in the package's type definitions; Task 5 verifies before relying on it. `dotenv` multi-path precedence was not verified; the plan uses `@next/env` instead `[C16]`. The exact `dataCollection` key set beyond the four documented in `[C60]` is checked against the installed types in Task 4.

**Assumptions (say so if any is wrong):**

1. One memorial in Phase 1; name and slug come from `MEMORIAL_NAME` / `MEMORIAL_SLUG` and are seeded `[C1]`.
2. Vercel team `rob-wrays-projects` is on **Pro**: the 10-minute reconcile cron (Task 9), the WAF rate-limit rule and Spend Management (Task 10) need it; on Hobby the cron must be daily `[C29]`.
3. Cloudflare holds the `jowray.com` zone and `CLOUDFLARE_DNS_ONLY_API_TOKEN` can edit its records `[C57]`.
4. Consent on the web path is an explicit checkbox; `CONSENT_VERSION` is stored on every memory and its exact text is committed under `docs/consent/` `[C1]`.
5. Email is the only confirmation channel in Phase 1; contributors without an email see the claim link on screen and nothing is sent.
6. The SendGrid account can send (verified in Task 0, because free plans were retired in 2025 `[C71]`).
7. The orchestrator's main checkout has a warm npm cache for the committed lockfile, so `npm ci --offline` works in worker worktrees (§0.2).

---

## 0.1 Cold start, ledger, locked decisions

**Why this section exists.** A context compaction or a hand-off to another agent must not cause a re-run of a non-idempotent external command (`neon branches create`, `vercel blob create-store`, Cloudflare record creation, GitHub ruleset creation). The ledger is the only source of truth for "what has already happened". It lives in its own file, `docs/plans/phase1-ledger.md` (initial content: Appendix A), organised as **one section per task** so that parallel branches never touch adjacent lines.

### Cold-start protocol (orchestrator only; run first, every time)

```bash
cd /Users/rob/Documents/active_work/jowray_com || { echo "not the orchestrator checkout; stop"; exit 1; }
git fetch --all --prune && git status --short && git branch -a && git log --oneline -8
gh pr list --state all --limit 20
# Every copy of the ledger: main, every open PR branch, and any commit anywhere that touched it
git show origin/main:docs/plans/phase1-ledger.md 2>/dev/null || echo "no ledger on main yet"
for b in $(gh pr list --state open --json headRefName --jq '.[].headRefName'); do
  echo "== $b"; git show "origin/$b:docs/plans/phase1-ledger.md" 2>/dev/null | sed -n '/^## Task/,$p'
done
git log --all --oneline -- docs/plans/phase1-ledger.md
git status --short docs/plans/phase1-ledger.md        # uncommitted edits from an interrupted session
git worktree list                                      # live worker worktrees (wip/task-N)
ls app docs prisma generated integrations features services lib server scripts .github 2>/dev/null
sed -E 's/=.*/=<set>/' .env .env.local | sort          # key names only, never values
neon projects list >/dev/null && neon branches list --project-id icy-scene-20351172
```

Rules:

1. Read every copy of the ledger before any external mutation. If an ID is recorded anywhere, the resource exists: verify it, do not create it again.
2. **Open a draft PR the moment a task branch is created**, so the cold-start loop sees the branch. **Immediately after any external mutation** (Neon branch, Blob store, Vercel env var, Cloudflare record, GitHub ruleset or secret, SendGrid domain, WAF rule), write the ID into the task's ledger section and `git commit -m "ledger: <what>" && git push` on the task branch, before doing anything else.
3. A mutation made after its PR merged (the `main` ruleset after PR A, the WAF rule after PR D) is recorded on the next open task branch, or on the final `docs/phase1-close` PR.
4. A task is `[x]` only when its worker checks and orchestrator checks both passed and the ledger section says so with a date.
5. If a task is `[~]` and you cannot tell how far it got, run its checks first; they are safe to repeat.
6. Never print `.env` values. Show keys with `sed -E 's/=.*/=<hidden>/' .env` `[C4]`.
7. Workers never edit the ledger; the orchestrator writes it from the worker's hand-back (§0.2).
8. Record every decision Rob makes in the decisions section of the ledger with the date, in the PR where it first matters.

### Locked decisions and human approvals (authoritative copy in `docs/plans/phase1-ledger.md`; this is the state at revision 4)

| Decision                                                     | Ruling                                                       | Date       | Who            |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ---------- | -------------- |
| SMS/MMS collection                                           | Deferred: too complex for now; candidate for Phase 3 (§9, §11 #5) | 2026-11-02 | Rob            |
| Phone line (VoIP.ms voicemail)                               | Deferred: too complex for now (§9, §11 #5)                   | 2026-11-03 | Rob            |
| VoIP.ms sub-account `262980_jowray`, DID, `voipms_*` keys    | **Kept**; unused in Phase 1                                  | 2026-11-03 | Rob            |
| Gemini in Phase 1                                            | None. Phase 2 uses a key from a Cloud project with **active billing** `[C65]` | 2026-11-02 | Rob            |
| Canonical site URL                                           | `https://www.jowray.com` in Production; previews use their branch URL (`getSiteUrl()`, Task 2) `[C57]` | 2026-11-02 | docs/domain.md |
| Next.js segment config                                       | No `dynamic`/`runtime` exports (Cache Components) `[C58, C59]` | 2026-11-03 | plan           |
| Sentry SDK major and install                                 | 11, manual install (no interactive wizard), explicit restrictive `dataCollection` on server and client `[C60]` | 2026-11-03 | plan           |
| Prisma generator                                             | `prisma-client`, `output = "../generated/prisma"` (gitignored) `[C61]` | 2026-11-03 | plan           |
| Upload checksum                                              | `READY` after `head()` verifies size/type; SHA-256 inline in `after()` only for files ≤ 50 MB, otherwise by the cron | 2026-11-03 | Rob            |
| Sharing `/share` publicly                                    | **Blocked** until the Vercel WAF rate-limit rule and Spend Management (Task 10) are on | 2026-11-03 | Rob            |
| Execution model                                              | Orchestrator + workers without network; waves and four stacked PRs (§0.2) | 2026-11-03 | Rob            |
| Scaffold font                                                | `next/font/google` replaced by the `geist` package so offline worker builds pass `[C76]` | 2026-11-03 | plan           |
| Claim tokens                                                 | Stored as SHA-256 hashes; the raw token exists only in the link and the email | 2026-11-03 | plan           |
| `MEMORIAL_NAME` / `MEMORIAL_SLUG`                            | TBD (Task 0)                                                 |            | Rob            |
| `SENDGRID_FROM_EMAIL`                                        | TBD (Task 0; on the authenticated domain)                    |            | Rob            |
| SendGrid plan status, sender-auth status (not started / pending / verified), key scope | TBD (Task 0) `[C71]`                                         |            | Rob            |
| Consent wording (storage checkbox, optional contact checkbox, email sentence) | TBD (Task 0; committed as `docs/consent/<CONSENT_VERSION>.md`) |            | Rob            |
| `CONSENT_VERSION`                                            | TBD, e.g. `2026-11-v1` (Task 0)                              |            | Rob            |
| Rob's test email(s) for `OUTBOUND_ALLOWLIST`                 | TBD (Task 0)                                                 |            | Rob            |
| Vercel Protection Bypass for Automation secret               | TBD (Task 0; Rob creates it, orchestrator uses it for preview checks) `[C70]` |            | Rob            |

---

## 0.2 Execution model: owners, worktrees, waves, PRs, file ownership, hand-back

Three roles. **Rob** does anything interactive or that only he can authorize (accounts, dashboards, approvals). The **orchestrator** (the agent with network and CLIs, working in the main checkout) does every step that touches Neon, Vercel, GitHub, Cloudflare or SendGrid, installs dependencies, owns the shared files, provisions worker worktrees, merges worker branches, writes the ledger, and verifies deployments. **Workers** (agents in isolated worktrees, **no network, no `.env`**) write code and tests against the base commit named in their brief and run only local checks. Workers skip §0.1.

### Owner per task

| Task                           | Owner                                             | What a worker can take                                       | What stays with the orchestrator or Rob                      |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 0 Inventory, decisions         | Rob + orchestrator                                | —                                                            | decisions, SendGrid check, bypass secret, merging `docs/custom-domain`, ledger creation |
| 1 Infra follow-ups             | Orchestrator + Rob (`NEON_API_KEY`)               | —                                                            | `neon`, GitHub secrets/variables, ruleset                    |
| 2a Pre-flight                  | Orchestrator                                      | —                                                            | installs, `package.json` scripts, `next.config.ts`, `ci.yml`, `AGENTS.md`, font swap commit base |
| 2b Conventions, logging, tests | Worker (1)                                        | ESLint groups, `env.ts`, logger, `after-flush`, Vitest config + stubs, `app/layout.tsx` font swap, smoke tests | —                                                            |
| 3 Database                     | Orchestrator                                      | optionally `seed.ts`, `server/db/client.ts`                  | schema (the contract), migrations against Neon, `vercel env add`, `vercel.json`, `eslint.config.mjs` ignore |
| 4 Sentry                       | Orchestrator (+ Rob: org token, Sentry UI checks) | `instrumentation.ts`, `instrumentation-client.ts`, `global-error.tsx` after the install | `next.config.ts`, Vercel env, verification                   |
| 5 Storage + email services     | Split                                             | storage and email services, template, media route, `lib/claim-token.ts`, `lib/media-types.ts`, `scripts/send-test-email.ts`, tests | store creation, env merge, Vercel env                        |
| 6 DNS for SendGrid             | Orchestrator + Rob                                | writing `scripts/dns-setup.ts`                               | running it; SendGrid UI                                      |
| 7 Web upload                   | Worker (TDD)                                      | form, recorder, Server Functions, upload route, `ingest-upload`, tests | preview-deploy checks, Vercel env                            |
| 8 Claim + confirm              | Worker                                            | `confirm.ts`, `claim.ts`, claim page, actions, the one-line `confirm` call in `app/share/actions.ts`, tests | real-email check                                             |
| 9 Reconcile cron               | Worker                                            | cron route and tests                                         | `vercel.json`, `CRON_SECRET`, live check after PR D merges   |
| 10 Verification + gates        | Orchestrator + Rob                                | —                                                            | preview deploys, real email, iPhone tests, WAF rule, Spend Management |

### Worker worktree provisioning (orchestrator, before every worker launch)

```bash
git worktree add ../jowray_wt_task-N -b wip/task-N <PR-branch-tip-SHA>
cd ../jowray_wt_task-N
npm ci --offline                 # warm cache from the main checkout's install of the same lockfile; runs postinstall (prisma generate) from Task 3 on
npx next typegen                 # writes next-env.d.ts and route types so tsc works without a build [C74]
mkdir -p .reference && cp <listed EmpathIQ files> .reference/    # /.reference/ is gitignored (Task 1)
```

Record the worktree path and base SHA in the task's ledger section. Workers run `npm run validate && npm run test:run && npm run build` **with the network disabled** (the orchestrator's Task 2 check proves this passes on the base before any worker starts).

### Worker checks vs orchestrator checks

Every task's **Done-check** is split. *Worker checks* run with no network and no `.env`: `npm run validate` (= `type-check` + `lint`), `npm run test:run`, `npm run build`. The build is database-free by construction (Tasks 2–3) and network-free after the font swap (Task 2). *Orchestrator checks* are anything that calls `neon`, `vercel`, `gh`, `curl`, uses a preview deployment (always with the `x-vercel-protection-bypass` header `[C70]`), or sends real email.

### Installs: one lockfile change per PR, never two in a parallel wave

- **PR A (Task 2a):** `npm i zod pino pino-pretty server-only geist @sentry/nextjs@^11 @vercel/blob @sendgrid/mail && npm i -D vitest @types/node@26`. Everything non-Prisma is installed here, so `lib/sentry/after-flush.ts` (Task 2b) and the services (Task 5) resolve, and PR C never touches the lockfile.
- **PR B (Task 3, start of W3):** `npm i @prisma/client@7 @prisma/adapter-neon@7 && npm i -D prisma@7 tsx` (installed only once the schema exists, because `postinstall` runs `prisma generate`).
- PRs C and D add no dependencies. If a worker needs one, it says so in the hand-back and the orchestrator adds it on the PR branch before the worker continues.

### One owner per shared file

| File                                       | Owner                                                        | Why                                                          |
| ------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `docs/environment.md`                      | Orchestrator                                                 | listed by Tasks 1, 3, 4, 5, 6, 7, 9; workers report new keys in the hand-back |
| `package.json`, `package-lock.json`        | Orchestrator                                                 | installs and scripts                                         |
| `.github/workflows/ci.yml`                 | Orchestrator                                                 | Tasks 1, 2a                                                  |
| `next.config.ts`                           | Orchestrator                                                 | Tasks 2a, 4                                                  |
| `vercel.json`                              | Orchestrator                                                 | Tasks 3, 9                                                   |
| `AGENTS.md`                                | Orchestrator                                                 | the worker drafts the "Code layout" text in `docs/code-layout.md`; the orchestrator appends it |
| `server/config/env.ts`                     | Each task's worker adds **only its own** sub-schema; orchestrator reviews at merge | Tasks 2b, 5, 7, 9                                            |
| `app/share/actions.ts`                     | Task 7 creates; Task 8 adds the one-line `confirm` call      |                                                              |
| `lib/claim-token.ts`, `lib/media-types.ts` | Task 5 worker                                                | Tasks 7 and 8 import them                                    |
| `docs/plans/phase1-ledger.md`              | Orchestrator only                                            | §0.1 rule 7                                                  |

### Reference code for workers

Tasks 2b, 4, 5, 9 say "port EmpathIQ's …" `[C5–C11]`. Before W2 the orchestrator clones `RobertdWray/empathiq` at `ac902c9` into `/Users/rob/Documents/active_work/_reference/empathiq` (outside this repo). At provisioning it copies the files the brief names into the worktree's `.reference/`: `CLAUDE.md`, `eslint.config.mjs`, `src/lib/logger/*`, `src/lib/sentry/after-flush.ts`, `src/integrations/vercel-blob/index.ts`, `src/integrations/sendgrid/*`, `instrumentation.ts`, `src/server/db/client.ts`, `src/app/api/cron/stale-sessions/route.ts`.

Every worker brief restates: base SHA and PR branch; the file list the worker may touch; the rules a worker will not load from this repo's agent settings (no `eslint-disable` without Rob's all-caps "YES"; no band-aids, fix root causes; no submodules; never print secrets; the Cache Components rule, Task 2b step 1; the import direction; TDD for Tasks 7–9); and the hand-back template below.

### Hand-back (worker → orchestrator, at the end of every worker task)

```
Task: N        Worktree: ../jowray_wt_task-N        Branch: wip/task-N        Head: <sha>
Files added/changed: …
New env keys (name, which Vercel environments, example shape, never a value): …
Dependencies requested (not installed): …
Checks run (exact commands) and results: …
Left for orchestrator checks: …
Proposed ledger text for this task: …
Open questions / deviations from the plan: …
```

The orchestrator merges `wip/task-N` into the PR branch, re-runs the worker checks in the main checkout, applies env keys with `vercel env add`, writes the ledger section, pushes, and removes the worktree.

### Waves

| Wave | Work                                                         | Parallel?  |
| ---- | ------------------------------------------------------------ | ---------- |
| W0   | Rob merges `docs/custom-domain`; Task 0 (ledger created on `docs/phase1-plan`) | —          |
| W1   | Task 1 (orchestrator)                                        | —          |
| W2   | Task 2a (orchestrator pre-flight, committed on A) then Task 2b (one worker) | sequential |
| W3   | Task 3 (orchestrator)                                        | —          |
| W4   | Task 5 worker (branch C from B's tip) ‖ Task 4 orchestrator + Rob (branch B); neither changes the lockfile | yes        |
| W5   | Task 7 worker (branch D from C's tip) ‖ Task 6 orchestrator + Rob (branch C; start early, DNS verification can take 48 h) | yes        |
| W6   | Task 8 (worker), then Task 9 (worker)                        | —          |
| W7   | Task 10 (orchestrator + Rob); `docs/phase1-close` PR         | —          |

### PRs (stacked)

| PR    | Branch                           | Base                                       | Tasks                              | Merge notes                                                  |
| ----- | -------------------------------- | ------------------------------------------ | ---------------------------------- | ------------------------------------------------------------ |
| A     | `feat/phase1-foundation`         | `main`                                     | 1–2                                | the `main` ruleset goes on after this merges                 |
| B     | `feat/phase1-data-observability` | `main` after A merges                      | 3–4                                | seed env vars exist before the first push containing `vercel.json` |
| C     | `feat/phase1-storage-email-dns`  | B's tip; rebase onto `main` after B merges | 5–6                                | DNS verification may still be pending at merge; Task 6 `[~]` is acceptable |
| D     | `feat/phase1-web-collection`     | C's tip; rebase onto `main` after C merges | 7–9 + Task 10 record               | Task 9's live checks run after merge; nothing is shared publicly until the Task 10 gates are on |
| close | `docs/phase1-close`              | `main`                                     | ledger rows for post-merge actions | —                                                            |

A worktree is always created from the PR branch's current tip, never from `main`. After a lower PR merges, the orchestrator rebases the stacked branch and re-provisions any live worktree before its worker continues. Each PR description copies §10 and §11. Each PR gets a first-pass review (four fresh-context lenses: cold-start dry run, platform correctness, security/privacy/abuse, orchestration readiness) and then the cross-family Team Code Review before Rob's go-ahead.

**Rob-side setup for the loop (not doable from a cloud session):** copy the TrayVerify workflow prompts (`premortem`, `citations`, `friend-buckets-*`, `bucket-*-sorting`, `document-issue`) into `docs/workflows/` and `.github/ISSUE_TEMPLATE/`, replacing `account_name/reponame` with `RobertdWray/jowray_com`, and adapt the citations' approved-sources list to Next.js (bundled docs first), Prisma, Neon, Vercel, Sentry, SendGrid, Cloudflare.

---

## 1. Scope

**In (Phase 1):** PR #1 follow-ups (dev branch, CI, branch protection, preview cleanup); Prisma 7 schema for the web-collection subset of the design doc's Phase 1 tables plus `WebhookEvent` and `EmailLog`; Sentry 11 + Pino; private Vercel Blob storage with a token-gated media route; SendGrid email with `EmailLog`; Cloudflare DNS records for SendGrid; the `/share` upload form (voice, video, photo, text; in-browser audio recording that works on iPhones; "add another file" from the claim page); claim links; email confirmation with retries; a reconcile cron; cost ceilings (daily budget, WAF rule, Spend Management) before public sharing; verification.

**Out:** SMS/MMS collection and any VoIP.ms integration (deferred, §9); the phone line (deferred, §9); Gemini or any AI call (Phase 2); Auth.js login and admin pages (Phase 3 `[C1]`); transcription, image description, tags, embeddings, search (Phase 2 `[C1]`); video transcoding. See §10 for non-goals with reasons.

---

## 2. Architecture and data flow

```
 Contributor browser                       Vercel: www.jowray.com (Next.js 16, Cache Components)
 ┌──────────────────┐  1. form POST        ┌────────────────────────────────────────────────────────────┐
 │ /share           │ ───────────────────▶ │ app/share/actions.ts  createMemory()                       │
 │  name, email,    │ ◀─── memoryId,       │   zod → budget check → Contributor + Memory(PENDING)        │
 │  date, note,     │      claimToken,     │   + Media(PENDING, storageKey) → signed ticket (HMAC)      │
 │  consent, file   │      pathname, ticket│                                                            │
 │  or recording    │  2. token exchange   │ app/api/upload/route.ts  handleUpload()                    │
 │                  │ ───────────────────▶ │   onBeforeGenerateToken: verify ticket → scoped client token│
 │                  │  3. upload file ─────┼──────────────▶ Vercel Blob (private)                        │
 │                  │  4. finalize         │                     │ 5. onUploadCompleted (backstop)       │
 │                  │ ───────────────────▶ │ app/share/actions.ts  finalizeUpload()  ◀───────────────────┘│
 │                  │ ◀── claim link       │   head(pathname) size/type → Media(READY) → confirm.ts     │
 └──────────────────┘                      │   after(): sha256 if ≤ 50 MB; else the cron                │
                                           │ app/m/[claimToken]  edit page, "add another file"          │
                                           │ app/api/media/[id]?t=…  token-gated, WAF-covered           │
                                           │ app/api/cron/reconcile-uploads (10 min): orphan PENDING,   │
                                           │   checksum backfill, failed/stale emails, unprocessed events│
                                           └──────────┬──────────────────┬───────────────┬──────────────┘
                                                   Neon (Prisma)     Vercel Blob      Sentry / SendGrid
```

**Web upload flow `[C1, C31, C63]`.** `createMemory()` validates who/when/consent, checks the daily budget, creates `Contributor` + `Memory(status PENDING, source WEB_UPLOAD)` with a fresh claim token (stored hashed) and a `Media(status PENDING, storageKey, mimeType, maxBytes)` row inside one transaction, and returns `{ memoryId, claimToken, pathname, ticket }`. The browser calls `upload()` from `@vercel/blob/client` against `/api/upload` with `contentType` set `[C78]`; `onBeforeGenerateToken` verifies the ticket and issues a client token scoped to that one pathname, MIME type and size. When `upload()` resolves, the browser calls `finalizeUpload()`, which verifies the ticket again, calls `head()` **for the ticketed pathname** (never a client-supplied URL), checks size and type against the `PENDING` row, marks it `READY`, sends the confirmation email, and hashes the file in `after()` only when it is small enough to finish inside the page's `maxDuration` `[C73]`; larger files are hashed by the cron. `onUploadCompleted` performs the same `READY` transition from the signed `tokenPayload` (which carries the `Media.id`), so a tab closed after the upload still ends `READY`; the reconcile cron sweeps `PENDING` rows that never completed (Task 9).

**Why finalize server-side instead of relying on the callback:** in production `@vercel/blob` derives the callback URL from `VERCEL_PROJECT_PRODUCTION_URL`, which Vercel defines as the *shortest* production custom domain, here the 308-redirecting apex; on previews it uses `VERCEL_BRANCH_URL`, which sits behind Deployment Protection; locally it issues no callback at all `[C63, C64]`. `onBeforeGenerateToken` therefore returns `callbackUrl: \`${getSiteUrl()}/api/upload\`` explicitly (no `VERCEL_BLOB_CALLBACK_URL` env var needed), and the Server Function path makes the callback a backstop rather than a dependency.

**Claim link `[C1]`.** `https://www.jowray.com/m/<claimToken>` shows what was received and lets the contributor edit name, relationship, approximate date, place, note and visibility, and add up to 9 more files to the same memory. Every edit appends a `MemoryRevision`. The page sends `Referrer-Policy: same-origin` and loads no third-party assets, so the token never leaks through `Referer`. Media is served only through `/api/media/[id]?t=<claimToken>`; types the browser cannot render (HEIC outside Safari) get a download link.

---

## 3. Repository layout (files this plan creates or edits)

The scaffold has no `src/`, and `@/*` maps to the repo root, so the house folders sit beside `app/` `[C2, C5]`.

```
jowray_com/
├── .env.local                          # gitignored; dev Neon branch + local-only values  [C16, C3]
├── .github/workflows/ci.yml            # job "ci": lint, type-check, test, build  [C26]
├── .github/workflows/neon-cleanup.yml  # delete preview/<branch> on PR close  [C25]
├── vercel.json                         # buildCommand (migrate + seed + build), crons  [C38, C10]
├── next.config.ts                      # withSentryConfig (from @sentry/nextjs/config), headers() for /m/*  [C60]
├── instrumentation.ts                  # Sentry.init in register(); dataCollection; onRequestError  [C7, C17, C60]
├── instrumentation-client.ts, app/global-error.tsx          # browser Sentry init with the same data controls  [C20, C60]
├── prisma.config.ts                    # @next/env loadEnvConfig; process.env.DATABASE_URL_UNPOOLED  [C16, C23, C62]
├── prisma/schema.prisma, prisma/migrations/, prisma/seed.ts  [C22, C61, C1]
├── generated/prisma/                   # gitignored; `prisma generate` output  [C61]
├── .reference/                         # gitignored; EmpathIQ files copied into worker worktrees
├── vitest.config.ts, __tests__/ (incl. __tests__/stubs/server-only.ts)  [C5]
├── scripts/dns-setup.ts, scripts/send-test-email.ts          # run with `npx tsx --env-file=.env …`  [C33, C36, C57]
├── docs/plans/phase1-ledger.md         # per-task ledger sections, decisions, resource ids (Appendix A)
├── docs/consent/<CONSENT_VERSION>.md   # the exact consent sentences in force
├── docs/code-layout.md                 # worker-drafted house rules, appended to AGENTS.md by the orchestrator
├── app/
│   ├── layout.tsx                      # font swap: geist package instead of next/font/google  [C76]
│   ├── share/page.tsx (maxDuration), share/share-form.tsx, share/recorder.ts, share/actions.ts   [C31, C56, C72, C73]
│   ├── m/[claimToken]/page.tsx, claim-form.tsx, actions.ts      # claim link edit page, add-file ticket  [C1, C56, C58]
│   ├── api/upload/route.ts                                       # Blob client-upload handler  [C31]
│   ├── api/media/[id]/route.ts                                   # token-gated private media  [C9]
│   └── api/cron/reconcile-uploads/route.ts                       # Task 9  [C10, C28]
├── server/db/client.ts                 # getDb(): lazy PrismaNeon singleton  [C6, C22]
├── server/config/env.ts                # per-feature zod sub-schemas, lazy  [C5, C3]
├── lib/logger/ (Pino with redact), lib/sentry/after-flush.ts, lib/validations/, lib/claim-token.ts, lib/upload-ticket.ts, lib/media-types.ts, lib/site-url.ts  [C5, C21]
├── services/{storage,email}/           # interfaces + factories  [C5]
├── integrations/vercel-blob/, integrations/sendgrid/            [C9, C8]
└── features/memories/{ingest-upload.ts,confirm.ts,claim.ts}     [C5, C1]
```

---

## 4. Tasks

Every task names its **Owner**, any **Install** the orchestrator runs before the wave, any **Vercel env** lines (always non-interactive: `printf '%s' "$VALUE" | vercel env add NAME production`, repeated for `preview` where listed, value read from `.env`, never typed), and ends with **Worker checks** (no network, no `.env`), **Orchestrator checks** (CLIs, deployments with the bypass header, real email), and **Rollback**. Ledger per §0.1.

### Task 0 — Inventory, decisions, inputs (no code)

**Owner:** Rob + orchestrator. **Branch:** `docs/phase1-plan` (the open plan PR). **Files:** `docs/plans/phase1-ledger.md` (create from Appendix A, then only ever edit), `docs/plans/2026-11-02-phase1-findings.md` (findings log), `docs/consent/<CONSENT_VERSION>.md`.

1. Rob merges `docs/custom-domain`. Then run the cold-start protocol (§0.1); confirm `main` contains `docs/domain.md` `[C57]`. Confirm the Neon CLI works for the Vercel-managed org (`neon projects list`); if it does not, Rob creates `NEON_API_KEY` now (Task 1 step 1) and the orchestrator records the auth method in the ledger.
2. Re-check the domain: `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.jowray.com/` → `200`; `https://jowray.com/` → `308 https://www.jowray.com/` `[C57]`.
3. Confirm the Vercel plan is Pro (10-minute cron, WAF rate limiting, Spend Management); if Hobby, set Task 9 to daily and find another gate for Task 10 `[C29]`.
4. **SendGrid readiness gate** `[C71]`: Rob confirms in the SendGrid dashboard (a) the plan name and, if it is a trial, the end date; (b) Sender Authentication status for `jowray.com`: *not started* (acceptable now; Task 6 starts it), pending, or verified; (c) that `SENDGRID_API_KEY` has Mail Send permission. Record all three in the ledger decisions section. Free plans were retired on 2025-05-27; an ended trial cannot send.
5. **Protection Bypass for Automation:** Rob creates the secret in the Vercel project (Deployment Protection settings) `[C70]`; the orchestrator stores it in `.env` as `VERCEL_AUTOMATION_BYPASS_SECRET` (documented in `docs/environment.md`) and sends it as `x-vercel-protection-bypass` on every preview check.
6. Get from Rob and record in the ledger: `MEMORIAL_NAME`, `MEMORIAL_SLUG`, `SENDGRID_FROM_EMAIL` (on `jowray.com`), the storage-consent sentence, the optional contact-consent sentence, the email's "how memories are used" sentence, `CONSENT_VERSION`, the test email(s) for `OUTBOUND_ALLOWLIST`. Commit the three sentences verbatim as `docs/consent/<CONSENT_VERSION>.md`.
7. Record the Phase 2 Gemini decision (billed Cloud project id when known) `[C65]`.
8. Orchestrator clones EmpathIQ at `ac902c9` into `/Users/rob/Documents/active_work/_reference/empathiq` (§0.2).
9. Create `docs/plans/phase1-ledger.md` from Appendix A with the §0.1 decisions table pasted in full; commit and push on `docs/phase1-plan`.

**Worker checks:** none. **Orchestrator checks:** `git log --oneline -1 origin/main -- docs/domain.md` returns a commit; `grep -c TBD docs/plans/phase1-ledger.md` → `0`; the SendGrid decision row has plan, auth status and key scope; `ls docs/consent/*.md`; `ls /Users/rob/Documents/active_work/_reference/empathiq/CLAUDE.md`; `grep -c VERCEL_AUTOMATION_BYPASS_SECRET .env` → `1`.
**Rollback:** none (no external mutations).

### Task 1 — Core infrastructure left open by PR #1

**Owner:** orchestrator + Rob (`NEON_API_KEY`). **Files:** `.github/workflows/ci.yml`, `.github/workflows/neon-cleanup.yml`, `.gitignore`, `.env.local`, `docs/environment.md`. **PR A** (draft PR opened at branch creation).

1. **Neon `dev` branch (PR #1 task #1).** `neon branches create --project-id icy-scene-20351172 --name dev --no-secrets`; ledger + push. Then append, without printing values:
   ```bash
   { printf 'DATABASE_URL=';          neon connection-string dev --project-id icy-scene-20351172 --pooled; } >> .env.local
   { printf 'DATABASE_URL_UNPOOLED='; neon connection-string dev --project-id icy-scene-20351172;          } >> .env.local
   chmod 600 .env.local
   ```
   `.env.local` keeps its existing `VERCEL_OIDC_TOKEN` line and overrides `.env`, so local work never touches `main` `[C24, C16, C3]`.
   *`NEON_API_KEY` for the Vercel-managed org (Rob):* Vercel → Storage → `jowray_com` → "Open in Neon" → Account settings → API keys → create; store it in `.env` as `NEON_API_KEY`; pass `--api-key "$NEON_API_KEY"` to the `neon` CLI if `neon auth` does not work for this org; add it as the GitHub secret `NEON_API_KEY` (`gh secret set NEON_API_KEY < <(grep '^NEON_API_KEY=' .env | cut -d= -f2-)`).
2. **CI (PR #1 task #4).** `.github/workflows/ci.yml` on `pull_request` and `push` to `main`, `permissions: contents: read`, `concurrency: ci-${{ github.ref }}`, **job id and name `ci`** (the ruleset's required check context): `actions/checkout@v4`, `actions/setup-node@v7` (`node-version: 26`, `cache: npm`), `npm ci`, `npm run lint`, `npm run build` `[C26]`. **Only scripts that exist at this point.** `type-check` and `test:run` are added in Task 2a (same PR A). `build` must never need a database or the network `[C62, C76]`.
3. **Preview-branch cleanup (PR #1 task #10).** `.github/workflows/neon-cleanup.yml` on `pull_request: types: [closed]` with `neondatabase/delete-branch-action@v3`, `project_id: ${{ vars.NEON_PROJECT_ID }}`, `branch: preview/${{ github.head_ref }}`, `api_key: ${{ secrets.NEON_API_KEY }}`; `gh variable set NEON_PROJECT_ID --body icy-scene-20351172` `[C25]`. Delete the stale `preview/docs/bootstrap-report` branch once by hand; ledger ("one-off actions").
4. `.gitignore`: add `/generated/` and `/.reference/`.
5. **Protect `main` (PR #1 task #3) — after PR A has merged and `ci` has run green on `main` once:** create a ruleset on `main` requiring a pull request and the `ci` status check `[C2, C4]`; ledger on the next open branch (§0.1 rule 3).
6. `docs/environment.md`: `NEON_API_KEY`, `VERCEL_AUTOMATION_BYPASS_SECRET` `[C3, C4]`.

**Worker checks:** none. **Orchestrator checks:** `neon branches list --project-id icy-scene-20351172` shows `main` and `dev`; `stat -f %Lp .env.local` → `600`; `grep -c '^DATABASE_URL' .env.local` → `2`; `grep -c VERCEL_OIDC_TOKEN .env.local` → `1`; `gh run list --workflow ci.yml --branch main --limit 1` → `success`; `gh api repos/RobertdWray/jowray_com/rulesets --jq '.[].name'` lists the `main` ruleset; `gh variable list` shows `NEON_PROJECT_ID`; `gh secret list` shows `NEON_API_KEY`.
**Rollback:** `neon branches delete dev --project-id icy-scene-20351172`; `gh api -X DELETE repos/RobertdWray/jowray_com/rulesets/<id>`; revert the workflow files.

### Task 2a — Pre-flight (orchestrator)

**Owner:** orchestrator. **Install:** `npm i zod pino pino-pretty server-only geist @sentry/nextjs@^11 @vercel/blob @sendgrid/mail && npm i -D vitest @types/node@26` (one lockfile change for PR A; see §0.2). **Files:** `package.json`, `next.config.ts`, `.github/workflows/ci.yml`. **PR A.**

1. Scripts: `"type-check": "next typegen && tsc --noEmit"` (`tsc` alone fails on a fresh checkout because `next-env.d.ts` and the `LayoutProps` global are generated `[C74]`), `"validate": "npm run type-check && npm run lint"`, `"test": "vitest"`, `"test:run": "vitest run"`.
2. `ci.yml`: append `npm run type-check` and `npm run test:run` after `npm run lint`.
3. `next.config.ts`: keep `cacheComponents`, `partialPrefetching`, the Tailwind Turbopack rule. Do **not** add `serverExternalPackages` for Pino: `pino` and `pino-pretty` are already in Next 16.4.4's default list `[C77]`. Add `async headers()` returning `Referrer-Policy: same-origin` for `/m/:path*`. (The Sentry wrap comes in Task 4.)
4. Commit on branch A; this commit's SHA is the Task 2b worker's base. Prove the base offline: provision a scratch worktree per §0.2 and run `npm run validate && npm run test:run && npm run build` with the network disabled; the font swap (Task 2b step 1) is required for `build`, so this check is re-run after 2b lands and before any other worker starts.

**Orchestrator checks:** `npm ls @sentry/nextjs geist @vercel/blob @sendgrid/mail zod pino` resolve; `grep -c typegen package.json` → `1`.
**Rollback:** revert the commit.

### Task 2b — Conventions, config, logging, test harness (worker)

**Owner:** worker (one), base = Task 2a commit. **Files (worker):** `app/layout.tsx`, `docs/code-layout.md`, `eslint.config.mjs`, `server/config/env.ts`, `lib/site-url.ts`, `lib/logger/*`, `lib/sentry/after-flush.ts`, `vitest.config.ts`, `__tests__/stubs/server-only.ts`, `__tests__/smoke.test.ts`, `__tests__/lib/logger.test.ts`, `__tests__/lib/env.test.ts`. **PR A.**

1. **Font swap:** replace `import { Geist, Geist_Mono } from "next/font/google"` with `import { GeistSans } from "geist/font/sans"` and `import { GeistMono } from "geist/font/mono"` (local font files, no build-time download `[C76]`); keep the CSS variables.
2. **House rules** (drafted in `docs/code-layout.md`; the orchestrator appends them to `AGENTS.md`): `features/ → services/ → integrations/`; `integrations/*` and `server/*` start with `import "server-only"`; no `console.log` on the server (Pino); route handlers validate with zod from `lib/validations` and answer `{ success, data }` / `{ error: { code, message } }` `[C5]`. **Cache Components rule (replaces EmpathIQ's `force-dynamic` rule):** never export `dynamic`, `runtime`, `revalidate` or `fetchCache`; the **first** thing a dynamic component or `GET` handler does is a request-time read (`await params`, `searchParams`, `cookies()`, `request.headers`) or `await io()`/`await connection()`, and only then Prisma `[C58, C59, C75]`; `maxDuration` is allowed and, for Server Functions, is set on the page that hosts them `[C73]`; never construct a `PrismaClient` or parse env at module scope. Enforce import direction with `no-restricted-imports` groups in `eslint.config.mjs` (port from `.reference/eslint.config.mjs`).
3. **`server/config/env.ts`:** per-feature sub-schemas, each a memoized function that parses on first call and never at module top level: `getDbEnv()`, `getSentryEnv()`, `getBlobEnv()`, `getEmailEnv()`, `getUploadEnv()`, `getCronEnv()`, `getSiteEnv()`. Task 2b ships only the sub-schemas whose keys exist at PR A time; later tasks add their own (§0.2 ownership). Booleans parse strictly (`z.enum(["true","false"]).transform(...)`); lists are split, trimmed and lower-cased `[C3, C5]`.
4. **`lib/site-url.ts`:** `getSiteUrl()` = `NEXT_PUBLIC_SITE_URL` if set, else `https://${VERCEL_BRANCH_URL}` when `VERCEL_ENV === "preview"`, else `http://localhost:3000`. Production sets `NEXT_PUBLIC_SITE_URL=https://www.jowray.com` (Task 5); previews link to themselves `[C57, C64]`.
5. **Logger:** port `.reference/src/lib/logger/*` (Pino, `createLogger`, `logError`, categories `api | upload | email | db | cron`) with `redact: ["email", "recipientEmail", "name", "phone", "*.email", "req.headers.cookie", "req.headers.authorization"]`; test: the serialized output of a sample object contains no `@`. Port `.reference/src/lib/sentry/after-flush.ts` (`afterWithFlush`) `[C5, C21]`.
6. **Vitest:** `vitest.config.ts` with `environment: "node"`, the `@/` alias, and `resolve.alias: { "server-only": "./__tests__/stubs/server-only.ts" }` (an empty module) so modules guarded by `server-only` can be imported in tests; `__tests__/smoke.test.ts` imports one such module to prove the alias.

**Worker checks:** `npm run validate && npm run test:run && npm run build` exit 0 with `DATABASE_URL` unset and the network disabled. **Orchestrator checks:** CI green on PR A; `AGENTS.md` updated from `docs/code-layout.md`.
**Rollback:** revert the PR.

### Task 3 — Database: Prisma 7 on the existing Neon project

**Owner:** orchestrator (the schema is the contract for everything after it). **Install:** `npm i @prisma/client@7 @prisma/adapter-neon@7 && npm i -D prisma@7 tsx` (the `latest` tag is a Prisma 8 prerelease) `[C22, C61]`. **Files:** `prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations/*`, `prisma/seed.ts`, `server/db/client.ts`, `package.json`, `vercel.json`, `eslint.config.mjs`, `docs/environment.md`. **Vercel env (before the first push containing `vercel.json`):** `MEMORIAL_NAME`, `MEMORIAL_SLUG`, `CONSENT_VERSION` → production + preview; also add the three to local `.env`. **PR B.**

1. **`prisma.config.ts`:** `import { loadEnvConfig } from "@next/env"; loadEnvConfig(process.cwd());` (same precedence as Next: `.env.local` over `.env` `[C16]`), `schema: "prisma/schema.prisma"`, `migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" }`, `datasource: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "" }`. Use `process.env`, **not** the `env()` helper: `env()` throws when the variable is missing, which breaks `prisma generate` in CI and in worker worktrees `[C23, C62]`.
2. **Generator** (multi-line, one assignment per line as the docs show `[C61]`):
   ```prisma
   generator client {
     provider = "prisma-client"
     output   = "../generated/prisma"
   }
   datasource db {
     provider = "postgresql"
   }
   ```
   `output` is required by the default generator; `prisma-client-js` is deprecated. `"postinstall": "prisma generate"`. App code imports `@/generated/prisma/client`; `prisma/seed.ts` uses the relative `../generated/prisma/client`. If `tsx` fails with `Cannot find module './internal/class.js'`, set `importFileExtension = "ts"` `[C61]`. `eslint.config.mjs`: add `generated/**` to `globalIgnores` (the generated code is otherwise linted after every `npm ci`).
3. **`server/db/client.ts`:** `"server-only"`; `export function getDb()` lazily constructs `new PrismaClient({ adapter: new PrismaNeon({ connectionString: getDbEnv().DATABASE_URL }) })` on first call and caches it on `globalThis`; **no `PrismaClient` at module scope** `[C6, C22]`. No `url` in the schema datasource `[C22]`.
4. **Schema** (web-collection subset of the design doc's Phase 1 model, plus `WebhookEvent` and `EmailLog`) `[C1, C8, C28]`:

```prisma
enum Visibility     { PUBLIC FAMILY PRIVATE }
enum UserRole       { FAMILY_ADMIN CONTRIBUTOR }
enum MemoryType     { VOICE VIDEO PHOTO TEXT }
enum MemorySource   { PHONE_CALL SMS WEB_UPLOAD }   // all design-doc values kept; only WEB_UPLOAD is written in Phase 1
enum MemoryStatus   { PENDING APPROVED HIDDEN }
enum AnalysisStatus { NOT_STARTED QUEUED DONE FAILED }
enum ChangedVia     { WEB SMS CLAIM_LINK ADMIN }
enum MediaStatus    { PENDING READY FAILED }
enum EmailType      { MEMORY_CONFIRMATION }
enum EmailStatus    { PENDING SENT FAILED }

model Memorial {
  id                String      @id @default(uuid())
  name              String
  slug              String      @unique
  born              DateTime?   @db.Date
  died              DateTime?   @db.Date
  defaultVisibility Visibility  @default(FAMILY)
  createdAt         DateTime    @default(now())
  contributors      Contributor[]
  memories          Memory[]
  people            Person[]
}

model User {                              // Phase 3 fills this in (magic-link login) [C1]
  id          String   @id @default(uuid())
  email       String?  @unique
  phone       String?  @unique
  role        UserRole @default(CONTRIBUTOR)
  createdAt   DateTime @default(now())
  contributor Contributor?
  revisions   MemoryRevision[]
}

model Contributor {                       // one row per submission in Phase 1; merging by verified email is Phase 3
  id            String    @id @default(uuid())
  memorialId    String
  userId        String?   @unique
  name          String?
  phone         String?                    // column kept for the design doc; not collected by the Phase 1 form
  email         String?                    // unverified; used only to send the confirmation
  relationship  String?
  contactOptIn  Boolean   @default(false)  // the OPTIONAL "you may contact me" checkbox, not the storage consent
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  memorial      Memorial  @relation(fields: [memorialId], references: [id])
  user          User?     @relation(fields: [userId], references: [id])
  memories      Memory[]
  @@index([memorialId, email])
}

model Memory {
  id              String         @id @default(uuid())
  memorialId      String
  contributorId   String?
  type            MemoryType
  source          MemorySource
  approxDateText  String?        // as given: "Summer 1998"
  approxYear      Int?
  approxMonth     Int?
  place           String?
  contributorNote String?        // exactly as typed; never rewritten
  language        String         @default("en")
  visibility      Visibility     @default(FAMILY)
  consentVersion  String
  consentedAt     DateTime       // required: web submissions always carry it
  status          MemoryStatus   @default(PENDING)
  analysisStatus  AnalysisStatus @default(NOT_STARTED)
  claimTokenHash  String         @unique     // sha256 of the 32-byte base64url token; the raw token is never stored [C1]
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  deletedAt       DateTime?
  memorial        Memorial       @relation(fields: [memorialId], references: [id])
  contributor     Contributor?   @relation(fields: [contributorId], references: [id])
  media           Media[]
  revisions       MemoryRevision[]
  emails          EmailLog[]
  @@index([memorialId, status, createdAt])
  @@index([contributorId])
  @@index([createdAt])                       // daily budget count
}

model Media {
  id               String      @id @default(uuid())
  memoryId         String
  storageKey       String      @unique      // Blob pathname: originals/<memoryId>/<uuid>.<ext>; write-once [C1, C9]
  blobUrl          String?                  // set from head() at READY; served only through /api/media/[id]
  status           MediaStatus @default(PENDING)
  originalFilename String?
  checksumSha256   String?                  // null until the background hash or the cron runs
  mimeType         String                   // normalized, no parameters (lib/media-types.ts)
  maxBytes         Int                      // ticketed limit; summed for the daily byte budget
  sizeBytes        Int?
  durationSeconds  Int?
  width            Int?
  height           Int?
  capturedAt       DateTime?                // from EXIF when present
  exif             Json?
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt
  memory           Memory      @relation(fields: [memoryId], references: [id])
  @@index([checksumSha256])
  @@index([status, createdAt])
  @@index([createdAt])
}

model Person {
  id                     String   @id @default(uuid())
  memorialId             String
  name                   String
  relationshipToDeceased String?
  isTheDeceased          Boolean  @default(false)
  createdAt              DateTime @default(now())
  memorial               Memorial @relation(fields: [memorialId], references: [id])
  @@unique([memorialId, name])
}

model MemoryRevision {
  id              String     @id @default(uuid())
  memoryId        String
  changedByUserId String?
  changedVia      ChangedVia
  before          Json
  after           Json
  createdAt       DateTime   @default(now())
  memory          Memory     @relation(fields: [memoryId], references: [id])
  changedBy       User?      @relation(fields: [changedByUserId], references: [id])
  @@index([memoryId])
}

model WebhookEvent {                        // raw audit; insert first, process after [C28]
  id          String    @id @default(uuid())
  provider    String    // "vercel-blob"
  kind        String    // "upload_completed"
  payload     Json
  receivedAt  DateTime  @default(now())
  processedAt DateTime?
  attempts    Int       @default(0)
  error       String?
  @@index([processedAt, receivedAt])
}

model EmailLog {                            // mirrors EmpathIQ, keyed per memory and type [C8]
  id                String      @id @default(uuid())
  memoryId          String
  recipientEmail    String
  emailType         EmailType
  status            EmailStatus @default(PENDING)
  sendgridMessageId String?     @unique
  errorMessage      String?
  attempts          Int         @default(0)
  nextAttemptAt     DateTime?                // set by the cron for retries
  sentAt            DateTime?
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
  memory            Memory      @relation(fields: [memoryId], references: [id])
  @@unique([memoryId, emailType])          // confirmation idempotency by constraint
  @@index([status, nextAttemptAt])
  @@index([recipientEmail, createdAt])     // per-recipient cap
}
```

   Not included on purpose: `Call`, `SmsConversation`, `SmsMessage`, `SyncState` (§10).
5. `npx prisma migrate dev --name phase1_init` against the `dev` branch, then `npx prisma generate` `[C22]`.
6. **`prisma/seed.ts`:** builds its own `PrismaClient` with `PrismaNeon` from `process.env.DATABASE_URL_UNPOOLED` (it runs under `tsx`, so it must not import `server/*` or anything guarded by `server-only`); idempotent and non-destructive: `upsert` the `Memorial` by `slug` with `create: { name: MEMORIAL_NAME, slug: MEMORIAL_SLUG }` and **`update: {}`**, so later edits in Prisma Studio survive redeploys; `upsert` the `Person` with `name = MEMORIAL_NAME`, `isTheDeceased = true` by `(memorialId, name)`, also `update: {}`; nothing else `[C1]`.
7. **Env vars for the build, before the first push of a commit containing `vercel.json`:** `MEMORIAL_NAME`, `MEMORIAL_SLUG`, `CONSENT_VERSION` → production + preview (values from the ledger; non-interactive form from the §4 preamble); ledger + push. Confirm no `NODE_ENV=production` is set in Vercel env (it would skip devDependencies and `tsx`).
8. **Scripts and deploy:** `"build": "prisma generate && next build"`, `"db:migrate": "prisma migrate dev"`, `"db:migrate:prod": "prisma migrate deploy"`, `"db:seed": "prisma db seed"`, `"db:studio": "prisma studio"`. `vercel.json`: `"buildCommand": "npx prisma migrate deploy && npx prisma db seed && npm run build"` (the client already exists from `postinstall`), so every deployment migrates and seeds its own Neon branch `[C38, C22, C2]`. **Migration rule:** every migration after `phase1_init` must be backward-compatible with the previous deployment (expand-and-contract).
9. `docs/environment.md`: `MEMORIAL_NAME`, `MEMORIAL_SLUG`, `CONSENT_VERSION`.

**Worker checks** (if `seed.ts`/`client.ts` were delegated): `npm run validate && npm run test:run && npm run build` with `DATABASE_URL` unset. **Orchestrator checks:** `npx prisma migrate deploy` twice → second run prints "No pending migrations"; `npx prisma db seed` twice → one `Memorial`, one `Person`; after a manual edit to `Memorial.born` in Studio, a third seed run leaves it unchanged; `vercel env ls` lists `MEMORIAL_NAME`, `MEMORIAL_SLUG`, `CONSENT_VERSION` for Production and Preview and no `NODE_ENV`; the PR B preview build log shows `migrate deploy` and the seed against the `preview/<branch>` Neon host, not `main`'s; `npm run lint` passes with `generated/` present; CI green with no database secrets.
**Rollback:** `dev`: `neon branches reset dev --project-id icy-scene-20351172 --parent`. Production: no down-migration; `phase1_init` is additive on an empty database, so dropping the tables is the only rollback, by hand and only before real data exists. Env vars: `vercel env rm <name> <environment>`.

### Task 4 — Sentry 11 and source maps (PR #1 task #2)

**Owner:** orchestrator (+ Rob: org token, Sentry UI checks). **Install:** none (done in Task 2a). **Files:** `instrumentation.ts`, `instrumentation-client.ts`, `app/global-error.tsx` (worker may write these three), `next.config.ts`, `docs/environment.md`. **Vercel env:** `SENTRY_AUTH_TOKEN` → production + preview (Vercel only; **not** copied into local `.env`, so local builds never upload source maps). **PR B** (W4, in parallel with the Task 5 worker on branch C; no lockfile change).

1. **Manual install, no wizard.** `npx @sentry/wizard` is an interactive terminal UI that an agent cannot drive; follow the manual-setup docs `[C20]`: `instrumentation-client.ts` (browser init, `dsn: process.env.NEXT_PUBLIC_SENTRY_DSN`), `app/global-error.tsx` (`'use client'`, renders its own `<html>`/`<body>`, calls `Sentry.captureException(error)` in a `useEffect`), and the server init in step 2. No `sentry.edge.config.ts` (nothing runs on the deprecated edge runtime `[C59]`). If Rob prefers the wizard, he runs it himself and the orchestrator reconciles the output; either way `git ls-files` must not list `.env.sentry-build-plugin`.
2. **`instrumentation.ts`:** `Sentry.init` **inside** `register()` for `process.env.NEXT_RUNTIME === "nodejs"` `[C7, C17]`, with `prismaIntegration()`, `pinoIntegration()`, `enableLogs: true`, and an explicit `dataCollection` because v11's defaults collect query strings, cookies and database query data `[C60]`: at minimum `{ userInfo: false, cookies: false, urlQueryParams: false, databaseQueryData: false }`; add `httpBodies` and `genAI` keys only if the installed types define them (the worker's `type-check` decides). `beforeSend`/`beforeSendSpan`/`beforeBreadcrumb` rewrite `/m/<token>` to `/m/[claimToken]` and drop any `t=` query in URLs and span attributes. `export const onRequestError = Sentry.captureRequestError` `[C21]`.
3. **`instrumentation-client.ts`:** the **same** `dataCollection` and scrubbing hooks as the server (page-load transactions, breadcrumbs and errors on `/m/<token>` otherwise carry the URL and `?t=` fetches); Session Replay off; `tracesSampleRate` low.
4. **`next.config.ts`:** `import { withSentryConfig } from "@sentry/nextjs/config"` (v11 moved it off the package root `[C60]`); `withSentryConfig(nextConfig, { org: "med3ai", project: "jowray_com", tunnelRoute: "/monitoring", telemetry: false, silent: !process.env.CI, sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN } })` so offline worker builds stay quiet and deterministic `[C21]`.
5. Rob creates a Sentry **organization** token (`org:ci`); the orchestrator adds it to Vercel (Production + Preview) and the ledger `[C2, C3]`.
6. Verify (Rob, in the Sentry UI; the orchestrator triggers): throw from a temporary route on the PR B preview (with the bypass header); the event in `med3ai/jowray_com` has no query string and no cookies in its request context; a Pino `warn` appears in Sentry Logs; the Vercel build log shows source maps uploaded `[C21]`.

**Worker checks** (for the three init files if delegated): `npm run validate && npm run build` ("No auth token" warnings are expected offline). **Orchestrator checks:** the three confirmations in step 6, noted in the findings file with event ids; `npm ls @sentry/nextjs` shows `11.x`; `git ls-files | grep -c sentry-build-plugin` → `0`; `vercel env ls` shows `SENTRY_AUTH_TOKEN` in Production and Preview.
**Rollback:** remove `SENTRY_AUTH_TOKEN` from Vercel; revoke the org token in Sentry; revert the PR.

### Task 5 — Storage and email services

**Owner:** split (orchestrator: store, env; worker: code). **Install:** none (Task 2a). **Files (worker):** `services/storage/{index,types}.ts`, `integrations/vercel-blob/index.ts`, `services/email/{index,types}.ts`, `integrations/sendgrid/{client,index}.ts`, `services/email/templates/memory-confirmation.ts`, `app/api/media/[id]/route.ts`, `lib/claim-token.ts`, `lib/media-types.ts`, `server/config/env.ts` (adds `getBlobEnv`, `getEmailEnv`, `getSiteEnv`), `scripts/send-test-email.ts`, `__tests__/api/media.test.ts`, `__tests__/services/email.test.ts`, `__tests__/lib/media-types.test.ts`. **Files (orchestrator):** Vercel env, `.env`, `docs/environment.md`. **Vercel env:** `SENDGRID_FROM_EMAIL` → production + preview; `OUTBOUND_ENABLED=true` → production only; `OUTBOUND_ALLOWLIST` → production + preview; `NEXT_PUBLIC_SITE_URL=https://www.jowray.com` → production only. **PR C** (branch from B's tip).

1. **Private Blob store (orchestrator):** `vercel blob create-store jowray-media --access private --yes` `[C30]`; ledger + push. Then pull the new keys **without touching `.env.local`**:
   ```bash
   ( umask 077; trap 'rm -f .env.vercel.tmp' EXIT; vercel env pull .env.vercel.tmp --environment=development \
     && grep -E '^(BLOB_READ_WRITE_TOKEN|BLOB_STORE_ID)=' .env.vercel.tmp >> .env )
   grep -c '^DATABASE_URL' .env.local   # still 2, still the dev host
   ```
   `vercel env pull .env.local` would overwrite the dev override with the production branch's credentials `[C3, C2]`. Add the four Vercel env lines above; ledger + push.
2. **`lib/media-types.ts` (worker):** the single MIME allowlist and normalizer used by the form, the ticket, the upload route and the media route: strip parameters (`audio/webm;codecs=opus` → `audio/webm`), lower-case, map an empty `File.type` from the extension (`.heic`, `.heif`, `.mov`, `.m4a`, `.mp4`, `.webm`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.wav`, `.ogg`, `.mp3`). Allowed: images `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`, `image/gif`; audio `audio/mp4`, `audio/x-m4a`, `audio/mpeg`, `audio/webm`, `audio/ogg`, `audio/wav`; video `video/mp4`, `video/quicktime`, `video/webm`. No SVG, no text/HTML. iPhones default to HEIC photos, `.mov` video and `audio/mp4` recordings `[C72]`. Per-type size limits: images 25 MB, audio 100 MB, video 500 MB. Exposes `extensionFor(mime)` and `isRenderableIn(mime, userAgent)`.
3. **`lib/claim-token.ts`:** `newClaimToken()` (32 random bytes, base64url), `hashClaimToken(token)` (SHA-256 hex), `safeEqualHex(a, b)` (compares hashes of both inputs with `crypto.timingSafeEqual`, so unequal lengths never throw). Memories are looked up by `claimTokenHash`.
4. **Storage service:** port `.reference/src/integrations/vercel-blob/index.ts` with `put(pathname, body, { access: "private", contentType, addRandomSuffix: false, allowOverwrite: false })` (originals are write-once), `head(pathnameOrUrl)`, `get(url, { access: "private" })` streaming, and `del()` `[C9, C30]`. Verify whether the installed SDK offers a presigned GET; if it does, the media route may `302` to a 60-second presigned URL instead of streaming (reviewer suggestion, unverified in the type definitions); otherwise stream with the caps below.
5. **`GET /api/media/[id]`:** reads `request.nextUrl` first (dynamic by nature), then serves a `Media` row's private blob only when `t` hashes to the owning memory's `claimTokenHash`, the memory is not soft-deleted, and `Media.status = READY`; otherwise 404. Headers: `Content-Type` from `Media.mimeType` (allowlist only), `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition: inline; filename*=UTF-8''<percent-encoded>` with an ASCII fallback built from `[A-Za-z0-9._-]` only (or `attachment` when `?download=1`). `maxDuration = 60`. No `dynamic`/`runtime` exports `[C58]`. Phase 3 adds admin access `[C9, C1]`.
6. **Email service:** port `.reference/src/integrations/sendgrid/*` (3 inline retries, linear backoff, non-retryable 400/401/403, `x-message-id` capture) with `EmailLog` keyed by `(memoryId, emailType)`: `upsert` the row on the unique key, send only if `status != SENT`; on failure set `FAILED`, `attempts += 1`, `nextAttemptAt = now + 15 min × attempts`, `errorMessage` `[C8, C35]`. **Outbound guard:** send only if `OUTBOUND_ENABLED` is `true` or the lower-cased recipient is in `OUTBOUND_ALLOWLIST`; otherwise return `skipped: outbound_disabled` without a row and log only `memoryId`. **Per-recipient cap:** at most 3 confirmations per address per 24 h (`recipientEmail, createdAt` index) → `skipped: recipient_capped`, counted for the cron's summary. **Template** `memory-confirmation` (text + HTML): fixed subject with no user text; every interpolated field HTML-entity-encoded in the HTML part and stripped of control characters in the text part; `name` truncated to 60 characters; the note and relationship are **not** echoed; body: thanks, what was received (type and count), the claim link from `getSiteUrl()`, how memories are used (the sentence from `docs/consent/`), how to add more. A 202 means accepted `[C35]`. `from` must be on the authenticated domain (Task 6) `[C36]`.
7. **`scripts/send-test-email.ts`:** sends the template to one allowlisted address; run with `npx tsx --env-file=.env scripts/send-test-email.ts <address>` (Task 6 and Task 10 use it).
8. **`docs/environment.md` (orchestrator):** `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`, `SENDGRID_FROM_EMAIL`, `OUTBOUND_ENABLED`, `OUTBOUND_ALLOWLIST`, `NEXT_PUBLIC_SITE_URL`.

**Worker checks:** `npm run validate && npm run test:run && npm run build`; tests cover: wrong token → 404, deleted memory → 404, `PENDING` media → 404, headers present, filename with `"\r\n` sanitized, `media-types` normalization (`audio/webm;codecs=opus`, empty type + `.heic`), email: second call for the same memory sends nothing, failure sets `FAILED` + `nextAttemptAt`, non-allowlisted recipient → `skipped`, fourth email to one address in a day → `skipped: recipient_capped`, HTML part escapes `<a href>` in a name. **Orchestrator checks:** `vercel blob list --limit 1` works; `.env.vercel.tmp` does not exist; `.env.local` host is the `dev` branch; `vercel env ls` shows the four keys in the listed environments.
**Rollback:** delete the store in the Vercel dashboard (Storage → `jowray-media` → Settings → Delete) and remove the `BLOB_*` keys from Vercel and `.env`; `vercel env rm` the four keys; revert the PR.

### Task 6 — Cloudflare DNS for SendGrid (the Vercel records already exist)

**Owner:** orchestrator + Rob (SendGrid UI). **Files:** `scripts/dns-setup.ts` (worker may write it), `.env` (`CLOUDFLARE_ZONE_ID`), `docs/environment.md`, `docs/domain.md` (append the email records). **PR C** (W5, in parallel with the Task 7 worker on branch D).

1. **Verify, do not recreate, the Vercel records** per `docs/domain.md`: `dig +noall +answer A jowray.com @1.1.1.1`, `dig +noall +answer www.jowray.com @1.1.1.1`, and the two `curl` checks from Task 0 `[C57]`. Keep them DNS-only.
2. Rob starts Domain Authentication for `jowray.com` in SendGrid with automated security on; it yields one `CNAME` for SPF/DKIM, two `CNAME`s for link branding, and one `TXT` for DMARC `[C36]`. He pastes the four records into the findings file.
3. **`scripts/dns-setup.ts`** (idempotent: list first, create only what is missing), run as `npx tsx --env-file=.env scripts/dns-setup.ts`: creates those records through `POST /zones/{zone_id}/dns_records` with `CLOUDFLARE_DNS_ONLY_API_TOKEN` and `CLOUDFLARE_ZONE_ID=dad5b9fdb1ece5afc4a4224f61a51770`; `proxied: false`; host label only (`em1234`, `s1._domainkey`), never the full name `[C33, C36, C57]`. Verifies the token with `GET /accounts/{CLOUDFLARE_ACCOUNT_ID}/tokens/verify` (account-owned; `/user/tokens/verify` rejects it) `[C57]`. Prints the created record ids; ledger + push.
4. Rob clicks **Verify** in SendGrid; DNS verification can take up to 48 hours `[C36]`. Append the records to `docs/domain.md`'s table. **Interim for W6 only:** if verification is still pending when Task 8's checks are due, Rob adds a SendGrid Single Sender Verification for `SENDGRID_FROM_EMAIL` (recorded in the ledger, removed after domain verification); `dkim=pass` is not expected until the domain verifies.

**Worker checks** (script only): `npm run validate`. **Orchestrator checks:** `dig +short CNAME <em-label>.jowray.com @1.1.1.1` returns SendGrid's target; SendGrid shows **Verified**; `npx tsx --env-file=.env scripts/send-test-email.ts <allowlisted address>` arrives with `dkim=pass` in `Authentication-Results`.
**Rollback:** `DELETE /zones/{zone_id}/dns_records/{id}` for each ledger id; remove the domain in SendGrid.

### Task 7 — Web upload form

**Owner:** worker (TDD), base = C's tip on branch D. **Install:** none. **Files (worker):** `app/share/page.tsx`, `app/share/share-form.tsx` (client), `app/share/recorder.ts` (client), `app/share/actions.ts`, `app/api/upload/route.ts`, `features/memories/ingest-upload.ts`, `lib/validations/memory.ts`, `lib/upload-ticket.ts`, `server/config/env.ts` (adds `getUploadEnv`), `__tests__/api/upload.test.ts`, `__tests__/features/ingest-upload.test.ts`, `__tests__/lib/upload-ticket.test.ts`. **Orchestrator:** `docs/environment.md` (`UPLOAD_TICKET_SECRET`, `DAILY_MEMORY_BUDGET`, `DAILY_BYTE_BUDGET`). **Vercel env:** `UPLOAD_TICKET_SECRET` → production + preview (different random values); `DAILY_MEMORY_BUDGET` (default 200) and `DAILY_BYTE_BUDGET` (default 20 GB) → production + preview. **PR D.**

**TDD (house rule for critical paths `[C5]`), tests first:** ticket tamper → `403`; ticket expired → `403`; pathname outside `originals/<memoryId>/` → `403`; MIME not allowed → `400`; MIME with parameters normalizes before ticketing; `createMemory()` beyond the daily memory or byte budget → `429`-style error; eleventh file for a memory → refused at ticket time; happy path → client token with `allowedContentTypes = [mimeType]`, `maximumSizeInBytes`, `validUntil === expiresAt` (epoch ms); `recordMedia()` twice for the same `storageKey` → one row; `finalizeUpload()` after `onUploadCompleted` → still one row, `READY`; `head()` size over `maxBytes` or type mismatch → `FAILED` and `del()`; concurrent `finalizeUpload` + callback (`Promise.all`) → one row, no throw (`P2002` caught); a signed `onUploadCompleted` body posted to the route → `READY` (this replaces any need for a tunnel in the worker).

1. **`/share` form** (design doc: "voice, video, photo; record audio in browser") `[C1]`: fields name, relationship, email (optional; required for a confirmation), approximate date (free text), note (text memories need no file), visibility (default `FAMILY`), **storage consent checkbox** (required; the sentence from `docs/consent/`; stores `CONSENT_VERSION` and `consentedAt`), **optional contact checkbox** (`contactOptIn`), one file input (`accept` from `lib/media-types.ts`) or in-browser recording. No phone field in Phase 1. Page shell is static and exports `maxDuration = 120` (its Server Functions inherit it `[C73]`); the form is a Client Component. `share-form.tsx` and `recorder.ts` are verified by the orchestrator's preview and iPhone checks, not by unit tests.
2. **`recorder.ts`:** feature-detect with `MediaRecorder.isTypeSupported()` in order `audio/webm;codecs=opus`, `audio/mp4`, `audio/webm`; iOS Safari before 18.4 supports only `audio/mp4` `[C72]`. Use the recorder's actual `mimeType` for the Blob and, normalized, for the ticket; derive the extension from it. If no type is supported, hide the record button and leave file upload.
3. **`createMemory()` Server Function:** zod validation; normalizes the MIME type; in one transaction: checks the daily budget (`count(Memory where createdAt > now - 24h) < DAILY_MEMORY_BUDGET` and `sum(Media.maxBytes where createdAt > now - 24h) < DAILY_BYTE_BUDGET`, else a friendly "try again later"), creates a **new** `Contributor` for this submission (never matches or updates an existing row by unverified email), `Memory(type from MIME or TEXT, source WEB_UPLOAD, status PENDING, claimTokenHash, consentedAt = now())`, and, when a file is attached, `Media(status PENDING, storageKey = "originals/<memoryId>/<uuid>.<ext>", mimeType, maxBytes)`. Returns `{ memoryId, claimToken, pathname, ticket }`. `ticket` = HMAC-SHA256 with `UPLOAD_TICKET_SECRET` over the canonical JSON `{ mediaId, memoryId, pathname, mimeType, maxBytes, expiresAt }` (fixed key order; `expiresAt` = epoch milliseconds, now + 15 min), plus those fields in clear. **`createUploadTicket(claimToken)`** (same file) mints a ticket for an additional file on an existing memory, enforcing the per-memory cap of 10 `Media` rows inside the transaction. Authorization is verified inside the Server Functions, not in a proxy `[C56]`.
4. **Client:** `upload(pathname, file, { access: "private", handleUploadUrl: "/api/upload", multipart: true, contentType: ticket.mimeType, clientPayload: JSON.stringify(ticket) })` from `@vercel/blob/client`. `contentType` is required: the SDK sends `x-content-type` only when it is set and otherwise derives the type from the extension, which would fail the exact `allowedContentTypes` match for audio recordings `[C78, C31]`. On resolve, call `finalizeUpload({ ticket })`. Show "Saved" and the claim link only after `READY`.
5. **`app/api/upload/route.ts`** with `handleUpload` `[C31]`: reads the request body first (dynamic by nature); `onBeforeGenerateToken` verifies the ticket (`safeEqualHex`), expiry, that `pathname` equals the ticketed one, and that the `Media` row is still `PENDING`; returns `{ allowedContentTypes: [mimeType], maximumSizeInBytes: maxBytes, validUntil: expiresAt, addRandomSuffix: false, allowOverwrite: false, callbackUrl: \`${getSiteUrl()}/api/upload\`, tokenPayload: JSON.stringify({ mediaId }) }`. `onUploadCompleted` inserts `WebhookEvent` then calls `recordMedia({ mediaId })` inside `afterWithFlush()`; the callback is the backstop (§2). `maxDuration = 60`; no `dynamic`/`runtime` exports `[C58]`.
6. **`features/memories/ingest-upload.ts`:** `recordMedia({ mediaId })` loads the `PENDING` row (its `storageKey`, `mimeType`, `maxBytes` are the expectations for both paths), ignores soft-deleted memories, calls `head(storageKey)` **by pathname** (never a client URL); on a 404 → leave `PENDING` for the cron; if `size > maxBytes` or `contentType !== mimeType` → `FAILED` + `del()`; otherwise update to `READY` with `sizeBytes` and `blobUrl` from the head result. Idempotent: a `READY` row returns as is; `P2002` from a concurrent writer is caught and the row re-read. `finalizeUpload({ ticket })` verifies the ticket, calls `recordMedia()`, returns `{ status, claimLink }`, and in `afterWithFlush()` streams `get()` through `crypto.createHash("sha256")` **only if `sizeBytes ≤ 50 MB`** (the page's `maxDuration` bounds `after()` `[C73]`); larger files get their checksum from the cron. (Task 8 adds the `confirm.ts` call here.)
7. **Local callback testing (orchestrator, optional):** `onUploadCompleted` cannot reach localhost; the orchestrator may run `cloudflared tunnel --url http://localhost:3000` and point `callbackUrl` at it for a session `[C31, C34]`; the Server-Function path and the signed-callback unit test cover the worker.

**Worker checks:** `npm run validate && npm run test:run && npm run build` (Blob and Prisma stubbed; Cache Components validation clean; build with no `.env`). **Orchestrator checks (PR D preview, bypass header):** upload a 20 MB `.mp4` → one `Media` row `READY` with `sizeBytes` equal to the file and a 64-hex checksum within a minute; repeat `finalizeUpload` by hand → still one row; a text-only memory creates no `Media` row and still returns a claim link; from an iPhone: a HEIC photo, a `.mov` video, and an in-browser recording each reach `READY` (record the iOS version; the recording's `mimeType` is `audio/mp4` below 18.4); 21 rapid `createMemory` calls from one IP with the budget set to 20 → the 21st is refused; `vercel env ls` shows the three keys.
**Rollback:** revert the PR; delete test blobs with `del()` or `vercel blob del <url>`; `vercel env rm` the three keys; test rows live on the preview branch, which the cleanup action deletes.

### Task 8 — Claim links and email confirmation

**Owner:** worker, base = D's tip. **Files:** `features/memories/confirm.ts`, `features/memories/claim.ts`, `app/m/[claimToken]/page.tsx`, `app/m/[claimToken]/claim-form.tsx`, `app/m/[claimToken]/actions.ts`, `app/share/actions.ts` (adds the one-line `confirm` call after `READY`), `__tests__/features/confirm.test.ts`, `__tests__/features/claim.test.ts`. Imports `lib/claim-token.ts`, `lib/media-types.ts` from Task 5. **PR D.**

1. **Claim link:** `${getSiteUrl()}/m/<claimToken>`; the raw token exists only in the link and the email; the row holds `claimTokenHash` `[C1, C57]`.
2. **`confirm.ts`:** sends the `memory-confirmation` email when `contributor.email` is set, the memory is not soft-deleted, and at least one `Media` row is `READY` (or the memory is `TEXT`); idempotent through the `(memoryId, emailType)` unique key; respects the outbound guard and the per-recipient cap `[C8, C35]`. Returns `{ sent | skipped: reason }` so the UI says "we emailed you" only when true. The email is transactional and does not depend on `contactOptIn`.
3. **`/m/[claimToken]`:** the page shell is static (`<meta name="referrer" content="same-origin">` in addition to the header from Task 2a; no third-party assets); a child component wrapped in `<Suspense>` first does `const { claimToken } = await params`, then looks up the memory by `hashClaimToken(claimToken)` (`notFound()` if missing or soft-deleted), and renders what was received (note; each `READY` media via `/api/media/[id]?t=…`, with a download link when `isRenderableIn()` is false, e.g. HEIC outside Safari; audio/video player) plus the edit form and an "add another file" control that calls `createUploadTicket(claimToken)` (Task 7) and reuses the upload flow `[C58, C1]`. The Server Function in `actions.ts` re-validates the token, ignores soft-deleted memories, writes the change, and appends `MemoryRevision(changedVia CLAIM_LINK, before, after)`; the first revision also records `consentVersion` `[C56, C5]`. No `dynamic`/`runtime` exports.

**Worker checks:** `npm run validate && npm run test:run && npm run build`; tests: second `confirm` for the same memory → `skipped: already_sent`; non-allowlisted recipient → `skipped: outbound_disabled`, no `EmailLog` row; `TEXT` memory with email → sent; soft-deleted memory → `skipped: deleted`; finalize path triggers `confirm` once; wrong token → not found. **Orchestrator checks (PR D preview, bypass header; waits on the Task 6 ledger section or the interim single-sender step):** an edit through the claim page creates one `MemoryRevision`; a wrong token → 404; the confirmation email to an allowlisted address contains a link to the preview host that opens (with the bypass header) and, after PR D merges, a `www` link in production; a HEIC memory shows a download link in Chrome and renders in Safari; adding a second file from the claim page reaches `READY`.
**Rollback:** revert the PR.

### Task 9 — Reconcile cron (uploads, checksums, emails that never completed)

**Owner:** worker (route + tests), base = D's tip; orchestrator (`vercel.json`, `CRON_SECRET`, live checks after merge). **Files:** `vercel.json` (crons), `app/api/cron/reconcile-uploads/route.ts`, `server/config/env.ts` (adds `getCronEnv`), `__tests__/api/reconcile.test.ts`, `docs/environment.md`. **Vercel env:** `CRON_SECRET` → production + preview. **PR D.**

1. `vercel.json`: `{ "path": "/api/cron/reconcile-uploads", "schedule": "*/10 * * * *" }` (Pro; `0 3 * * *` on Hobby) `[C27, C29, C38]`.
2. The route **first** reads `request.headers.get("authorization")` (so Cache Components never prerenders a static error response for a build without the secret `[C58]`), then fails closed when `CRON_SECRET` is unset, then compares with `safeEqualHex` `[C10, C28]`. Steps, each idempotent because cron delivery can duplicate or skip runs and Vercel does not retry `[C28]`: (a) `Media.status = PENDING` older than 1 hour → `recordMedia()`; if `head()` still 404s after 24 hours → `FAILED` (orphan sweep); (b) `Media.status = READY` with `checksumSha256 IS NULL` → compute and store (oldest first, bounded per run); (c) `WebhookEvent.processedAt IS NULL` with `attempts < 3` → re-run the handler, increment `attempts`, set `error` + a Sentry event at the third failure; (d) `EmailLog` rows that are `FAILED` with `attempts < 5` and `nextAttemptAt <= now()`, or `PENDING` older than 15 minutes → retry through the email service (updates the existing row); (e) `READY` memories with a contributor email, not soft-deleted, and no `EmailLog` → `confirm.ts`; (f) blobs of soft-deleted memories → `del()`. Every query filters `deletedAt IS NULL` except (f). `maxDuration = 60`; returns counts per step plus the day's `recipient_capped` and budget refusals.
3. `docs/environment.md`: `CRON_SECRET`.

**Worker checks:** `npm run validate && npm run test:run && npm run build`; tests: missing/wrong bearer → 401; each step with stubbed services is a no-op on a second run; `.next/server/app/api/cron/reconcile-uploads` is not emitted as a static body. **Orchestrator checks (after PR D merges and deploys):** `curl -H "Authorization: Bearer $CRON_SECRET" https://www.jowray.com/api/cron/reconcile-uploads` → `200` with counts; without the header → `401`; Vercel dashboard shows the cron scheduled; on the preview (manual `curl` with both headers) a deliberately failed email is retried and its `attempts` increments. PR D may merge with Task 9 at `[~]`; the ledger row closes on the `docs/phase1-close` PR.
**Rollback:** remove the `crons` entry; `vercel env rm CRON_SECRET`.

### Task 10 — Verification, pre-launch gates, acceptance

**Owner:** orchestrator + Rob. Results recorded in the `docs/phase1-close` PR.

Pre-launch gates (all must be on before `/share` is shared beyond Rob's test group; the decisions row "Sharing `/share` publicly" stays **Blocked** until then):
- [ ] **Vercel WAF rate-limit rule** covering `/share`, `/api/upload`, `/api/media/*` and `/m/*` (e.g. 20 requests per IP per 10 minutes, action: challenge or deny) created in the project's Firewall settings; ledger.
- [ ] **Vercel Spend Management** with a hard pause at Rob's chosen monthly amount; ledger.
- [ ] `DAILY_MEMORY_BUDGET` and `DAILY_BYTE_BUDGET` set to the values Rob wants for launch.
- [ ] SendGrid domain authentication **Verified** and the account can send (Task 0 gate re-checked on launch day) `[C71]`.

Acceptance:
- [ ] `npm run validate`, `npm run test:run`, `npm run build` pass locally and in CI with no database secrets and (locally) with the network disabled `[C26, C62, C76]`.
- [ ] `npx prisma migrate deploy` is a no-op on a second run; Neon `dev`, `main`, and the PR's `preview/<branch>` show the 9 application tables (10 in `public` including `_prisma_migrations`) and one `Memorial` + one `Person` row each `[C22, C24]`.
- [ ] Closing a PR deletes its `preview/<branch>` Neon branch within a minute `[C25]`.
- [ ] Sentry shows the test error without query strings or cookies, and a Pino log line; a browser error on `/m/<token>` shows `/m/[claimToken]` `[C60, C21]`.
- [ ] `/share` accepts a 20 MB video through the client upload; `Media.sizeBytes` matches; the checksum appears within a minute; the "Saved" screen shows the claim link `[C31]`.
- [ ] A 100 MB video reaches `READY` immediately and gets its checksum from the cron within 10 minutes.
- [ ] From an iPhone: a HEIC photo, a `.mov` video, and an in-browser recording all reach `READY`; the recording plays back on the claim page in Safari (if seeking fails, §11 #7) `[C72]`.
- [ ] A text-only memory produces a claim link and, with an email, a confirmation.
- [ ] The confirmation email arrives at an allowlisted address with `dkim=pass` and a working `https://www.jowray.com/m/…` link; the claim-page edit creates a `MemoryRevision`; a name containing `<a href>` arrives escaped `[C35, C36]`.
- [ ] A preview deployment never emails a non-allowlisted address; a fourth email to one address in a day is skipped.
- [ ] A forced email failure is retried by the cron and ends `SENT` once the cause is removed.
- [ ] `https://www.jowray.com` → 200 and `https://jowray.com` → 308 still hold `[C57]`.
- [ ] `/api/media/[id]` without `t` → 404; with the token → correct `Content-Type`, `Cache-Control: private, no-store`, CSP sandbox.
- [ ] Budget refusal works (temporarily set `DAILY_MEMORY_BUDGET=1` on preview).
- [ ] `git ls-files -- '.env*'` is empty; `git ls-files | grep -c sentry-build-plugin` → 0; no secret value appears in any diff `[C4]`.
- [ ] `docs/plans/phase1-ledger.md` shows every task `[x]` with a date; `docs/environment.md` lists every key in §7; `docs/consent/<CONSENT_VERSION>.md` matches the live form and email.

---

## 5. Sequencing

See §0.2 waves and PR bases. Dependencies: Task 0 ← `docs/custom-domain` merged; 1 ← 0; 2a ← 1; 2b ← 2a; 3 ← 2b; 4 ← 3 (same branch); 5 ← 3 (schema; branch C from B's tip); 6 ← 5 (from address) and Rob (SendGrid records); 7 ← 5 (branch D from C's tip); 8 ← 7; 9 ← 8; 10 ← all. Inputs from Rob: Task 0 (decisions, SendGrid status, bypass secret, merge), Task 1 (`NEON_API_KEY`), Task 4 (Sentry org token, UI checks), Task 6 (SendGrid records, Verify click, interim single sender), Task 10 (WAF rule, Spend Management, iPhone tests).

---

## 6. Database runbook (condensed)

```bash
npm i @prisma/client@7 @prisma/adapter-neon@7 && npm i -D prisma@7 tsx      # Task 3 only; other deps in Task 2a
neon branches create --project-id icy-scene-20351172 --name dev --no-secrets
# .env.local: DATABASE_URL (pooled, dev branch), DATABASE_URL_UNPOOLED (direct, dev branch), appended as in Task 1; chmod 600
npx prisma migrate dev --name phase1_init   # CLI reads DATABASE_URL_UNPOOLED via prisma.config.ts (@next/env)
npx prisma generate                          # → generated/prisma (gitignored)
npx prisma db seed                           # one Memorial + one Person, idempotent, update: {}
printf '%s' "$MEMORIAL_NAME" | vercel env add MEMORIAL_NAME production   # and preview; likewise MEMORIAL_SLUG, CONSENT_VERSION
```

`[C16, C22, C23, C24, C61, C62]`

---

## 7. Environment variables

Existing keys keep their names from `docs/environment.md`; new keys are added to `.env` and to Vercel in the task that introduces them, with explicit non-interactive `vercel env add` lines, and documented in the same PR `[C3, C4]`.

| Variable                                                 | Status                             | Used by                     | Vercel environments, added in                                | Notes                                                        |
| -------------------------------------------------------- | ---------------------------------- | --------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED`                  | existing (Vercel–Neon)             | Prisma                      | all (integration)                                            | `.env.local` points both at `dev` `[C22, C24]`               |
| `NEON_API_KEY`                                           | **new**                            | `neon` CLI, cleanup action  | — (GitHub secret), Task 1                                    | from the Neon console `[C25]`                                |
| `VERCEL_AUTOMATION_BYPASS_SECRET`                        | **new**                            | orchestrator preview checks | — (`.env` only), Task 0                                      | `x-vercel-protection-bypass` `[C70]`                         |
| `NEXT_PUBLIC_SENTRY_DSN`                                 | existing                           | Sentry                      | all                                                          | `[C3]`                                                       |
| `SENTRY_AUTH_TOKEN`                                      | placeholder → org token            | Sentry builds               | production + preview, Task 4                                 | Vercel only; never in local `.env` `[C21]`                   |
| `SENDGRID_API_KEY`                                       | existing                           | email                       | all                                                          | Mail Send scope; account must be able to send `[C35, C71]`   |
| `SENDGRID_FROM_EMAIL`                                    | **new**                            | email                       | production + preview, Task 5                                 | on the authenticated domain `[C36]`                          |
| `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`                 | **new** (store creation)           | Blob                        | all (store creation), Task 5                                 | copied from a temp env pull, never via `.env.local` `[C30, C31]` |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DNS_ONLY_API_TOKEN` | existing                           | `scripts/dns-setup.ts`      | —                                                            | account-owned token `[C57]`                                  |
| `CLOUDFLARE_ZONE_ID`                                     | **new**                            | `scripts/dns-setup.ts`      | — (`.env`), Task 6                                           | `dad5b9fdb1ece5afc4a4224f61a51770` `[C57]`                   |
| `NEXT_PUBLIC_SITE_URL`                                   | **new**                            | `getSiteUrl()`              | production only, Task 5                                      | previews derive their own host `[C57, C64]`                  |
| `UPLOAD_TICKET_SECRET`                                   | **new**                            | `/share`, `/api/upload`     | production + preview (different values), Task 7              | 32+ random bytes `[C31]`                                     |
| `DAILY_MEMORY_BUDGET`, `DAILY_BYTE_BUDGET`               | **new**                            | `createMemory()`            | production + preview, Task 7                                 | cost ceiling; launch values set in Task 10                   |
| `CRON_SECRET`                                            | **new**                            | reconcile cron              | production + preview, Task 9                                 | `Authorization: Bearer` `[C28]`                              |
| `OUTBOUND_ENABLED`                                       | **new**                            | email service               | production only (`true`), Task 5                             | strict `"true"` parse                                        |
| `OUTBOUND_ALLOWLIST`                                     | **new**                            | email service               | production + preview, Task 5                                 | comma-separated, lower-cased                                 |
| `MEMORIAL_NAME`, `MEMORIAL_SLUG`, `CONSENT_VERSION`      | **new**                            | seed, form, email           | production + preview, Task 3 (before the first push with `vercel.json`) | e.g. `Jo`, `jo`, `2026-11-v1` `[C1]`                         |
| `GEMINI_API_KEY`                                         | placeholder, **unused in Phase 1** | Phase 2                     | —                                                            | must come from a billed Cloud project `[C65]`                |
| `voipms_*`, `VOIPMS_*`, `DID_JOWRAY`                     | existing, **unused in Phase 1**    | later phase                 | —                                                            | SMS and phone line deferred; account kept (§9)               |
| `ELEVENLABS_API_KEY`                                     | existing, **unused**               | —                           | —                                                            | Phase 2 transcribes with Gemini; retire the key then         |
| `AUTH_SECRET`                                            | placeholder                        | —                           | —                                                            | unused until Phase 3 `[C1]`                                  |

---

## 8. Risks and open questions

- **Cache Components validation.** A page or `GET` handler that reads Prisma or env before a request-time read is prerendered at build time (against nothing, or against the build's database). The house rule in Task 2b, the lazy `getDb()`/`getXEnv()` pattern, and the "build with no `.env`" worker check are the guard `[C58, C75]`.
- **Offline worker builds.** Anything that reaches the network at build time (Google fonts, Sentry uploads, telemetry) breaks a worker. The font swap and the Sentry build options handle the known cases; Task 2a proves the base offline before workers start `[C76]`.
- **Build-time migrations.** `migrate deploy` runs before `next build`; a failed build leaves the previous deployment on the new schema. Expand-and-contract (Task 3 step 8) keeps that safe.
- **Blob callback host.** Explicit `callbackUrl` from `getSiteUrl()`; preview callbacks stay behind Deployment Protection and are covered by the Server-Function path and the cron's orphan sweep `[C63, C70]`.
- **Shared Blob store across environments.** Preview uploads land in the same private store under `originals/<memoryId>/`; ids differ per branch, so nothing collides, but the production write token is present in preview builds and local `.env`. Accepted for Phase 1; a second store for previews is §11 #9.
- **Data in Neon branches.** `preview/<branch>` and `dev` branches copy the parent's data. With tokens stored hashed, a copied branch cannot yield working claim links, but it still holds contributor emails and notes. Schema-only preview branching once real data exists is §11 #10.
- **SendGrid account state.** Free plans no longer exist; a lapsed trial silently stops sending `[C71]`. Task 0 and Task 10 check it.
- **PII.** Private Blob, token-gated media route, Sentry `dataCollection` off for query strings/cookies/DB data on server and client, URL scrubbing, Pino redaction `[C60, C9]`. Vercel request logs still record `/m/<token>` URLs (§11 #3).
- **Abuse and cost.** `/share` is anonymous. Layers: daily memory and byte budgets in `createMemory()`, per-recipient email cap, WAF rule on all public paths, Spend Management hard pause, function `maxDuration` on the media route. Public sharing stays blocked until the Task 10 gates are on.
- **Consent.** Storage consent is a required checkbox; contact consent is a separate optional checkbox; the sentences in force are committed under `docs/consent/`.
- **Cron frequency, WAF and Spend Management** need Pro; Hobby caps crons at daily `[C29]`.

---

## 9. Deferred phases: verified facts to carry forward

These are inputs for the later SMS and phone-line phases (deferred as too complex for now; VoIP.ms account kept). Re-verify against the official VoIP.ms API reference (interactive login required) before building; the wiki and a third-party mirror are what could be reached from here.

**SMS/MMS (deferred; candidate for Phase 3).** VoIP.ms delivers inbound texts by `GET` to a URL callback with documented variables `{ID}`, `{TIMESTAMP}`, `{FROM}`, `{TO}`, `{MESSAGE}`, `{MEDIA}` (comma-separated media files) per the wiki `[C67]`; the API-reference copy in `AvaTinCan/docs/2026-10-30-voipms-api-documentation.md` lists only `{FROM}`, `{TO}`, `{MESSAGE}`, so the sources conflict and a live test is required. With URL Callback Retry on, VoIP.ms expects the body `ok` and otherwise resends every 30 minutes, so handlers must be idempotent on the message id `[C67]`. The API requires `api_username` + `api_password` **and** an enabled source IP; there is no bearer scheme `[C68]`; Vercel has no fixed egress IP by default, so sending replies needs a relay, Vercel Static IPs ($100/month per project), or another provider. Vendor-neutral requirements for any SMS implementation: idempotent inbound handling; `STOP`/`END`/`CANCEL`/`QUIT`/`UNSUBSCRIBE`/`HELP` handled deterministically before any LLM; model output advisory only; an outbox with an atomic `SENDING` claim (`FOR UPDATE SKIP LOCKED`); A2P 10DLC registration and daily caps.

**Phone line (deferred).** Voicemail retrieval through the VoIP.ms API has the same IP constraint `[C68]`. `markListenedVoicemailMessage(listened=yes)` reportedly moves a message from `INBOX` to `Old` `[C69, unverified mirror]`, so a stored identity must never use `folder`/`message_num`; use mailbox + date + caller id + duration + an audio hash. The cheapest transport without API egress is VoIP.ms voicemail-to-email with the recording attached, received by SendGrid Inbound Parse at an `MX` on `jowray.com` (not set up; `docs/domain.md` lists email DNS as not done `[C57]`).

**Gemini (Phase 2).** Keys from AI Studio without a billed Cloud project are **Unpaid Services**: Google may use prompts and files to improve products and human reviewers may read them; "Do not submit sensitive, confidential, or personal information". Paid treatment applies only through a Cloud project with active billing. API Clients must not be directed at or likely accessed by under-18s. The Interactions API stores requests by default (`store=true`, 55 days on paid tiers); pass `store: false` `[C65, C66]`.

---

## 10. Non-goals (what this plan deliberately does not do, and why)

- **Keeping `Call`, `SmsConversation`, `SmsMessage`, `SyncState`, and VoIP.ms / Gemini code wiring "for later".** A table is a one-line migration when its phase arrives; empty tables, unused enums and dead code add review noise and false signals about what the code does. The `MemorySource` and `MemoryType` enums keep every design-doc value because that is free. The VoIP.ms **keys and sub-account stay** (Rob's decision); only code is omitted.
- **Recording "VoIP.ms is the wrong vendor".** Rob's ruling is "deferred, too complex for now"; the account is kept. A vendor change is a later decision (§11 #5).
- **SMS callback dedupe, STOP/HELP handling, LLM output hardening, conversation lifecycle and race controls.** Moot while SMS is deferred; the verified facts are in §9.
- **Voicemail identity keys, `createVoicemail` parameters, DID routing rollback, a Mac worker runbook, Vercel Static IPs, base64 audio transport.** Moot while the phone line is deferred; facts in §9.
- **A durable job system (stages, attempt schedules, terminal-error alerts) for upload completion.** One memorial. `WebhookEvent` rows, the reconcile cron and a Sentry alert give the same guarantee in a few dozen lines.
- **An "ambiguous outcome" state for email sends.** A lost DB write after a SendGrid 202 is a crash between two statements. The unique `(memoryId, emailType)` constraint plus the cron's retry produces at worst one duplicate email, which is acceptable.
- **Inline SHA-256 of every upload before "Saved".** Hashing 500 MB inside a Server Function needs minutes and a large page-level `maxDuration` `[C73]`; size/type verification at `head()` is immediate, small files are hashed in `after()`, large ones by the cron (Rob's decision).
- **Matching submissions to existing `Contributor` rows by unverified email.** It would let anyone attach memories to, or rewrite, someone else's contributor record. One row per submission; merging happens in Phase 3 behind a verified login.
- **A phone field on the Phase 1 form.** PII with no Phase 1 use; the column stays for the design doc and returns with the SMS phase.
- **Redirecting `jowraycom.vercel.app` to `www`.** Harmless now (`docs/domain.md`). Not Phase 1.
- **Auth.js login and admin pages.** Phase 3 per the design doc. Rob reviews rows in Prisma Studio or the Neon console; claim links give contributors edit access to their own memory.
- **Transcription, image description, tags, embeddings, search.** Phase 2.
- **`export const dynamic = "force-dynamic"` / `export const runtime = "nodejs"`.** Forbidden under Cache Components in Next.js 16.4.4 (bundled docs). Request-time reads come first, then data. The EmpathIQ house rule that adds these exports is superseded here.
- **`serverExternalPackages` for Pino.** Already in Next 16.4.4's default list `[C77]`; adding it is noise.
- **`vercel env pull .env.local`.** It overwrites the Neon dev-branch override with production credentials. Pull to a temp file under `umask 077` and merge, as `docs/environment.md` says.
- **The interactive Sentry wizard as an agent step, or pinning `@sentry/nextjs` 10.** The wizard needs a human at a terminal; v11 is current and its `dataCollection` defaults collect query strings. Manual install with explicit `dataCollection` on server and client.
- **`dotenv` in `prisma.config.ts`.** Its multi-file precedence was not verifiable; `@next/env` follows the documented Next.js order `[C16]` and is already a dependency.
- **Application-level rate limiting in Phase 1.** The daily budgets in `createMemory()`, the WAF rule on all public paths and Spend Management are the gates; per-IP in-app limiting is §11 #2 if those prove insufficient.
- **A presigned-GET redirect for media.** Suggested by a reviewer but not present in `@vercel/blob@2.8.2`'s type definitions; Task 5 checks the installed package and streams with caps otherwise.
- **A second Blob store for previews.** Doubles the setup for one memorial's test uploads; recorded as §11 #9 instead.
- **Unit tests for `share-form.tsx` and `recorder.ts`.** They need jsdom and a DOM testing library for little assurance; the orchestrator's preview and iPhone checks cover them.
- **Copying the TrayVerify orchestration prompts and issue template from a cloud session.** They live on Rob's Mac; §0.2 lists it as Rob-side setup.

---

## 11. Follow-up issues (out of scope for this PR; file after merge)

| #    | Severity           | Title                                                        | What to do                                                   | Where / evidence                                             |
| ---- | ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 1    | Medium             | Gemini API terms: 18+ API-client clause and Unpaid vs Paid data use | Decide Gemini API (billed project) vs Vertex AI before Phase 2 processes any family media. Record the decision and which data-use terms apply. | Gemini API Additional Terms eff. 2026-03-23; Interactions API `store=true`, 55 days on paid `[C65, C66]`. |
| 2    | Medium             | In-app rate limiting if the budgets and WAF rule are insufficient | Add `@upstash/ratelimit` keyed by IP on `createMemory`/`/api/upload`, plus a per-memorial daily cap, if abuse gets past the daily budgets and the WAF rule. | Task 7 budgets; Task 10 gates.                               |
| 3    | Low                | Vercel request logs record `/m/<claimToken>` URLs            | Set a log retention / drain policy. In Phase 3, consider moving the token to a POST body or cookie. | Vercel project logs; claim links at `https://www.jowray.com/m/<token>`. |
| 4    | Low                | VoIP.ms recurring cost while deferred                        | Rob reviews whether to keep sub-account `262980_jowray` and DID `2349569729` until the SMS/phone phase is scheduled. | `docs/voip_ms_262980_jowray-subaccount-settings.md`; §0.1 decision "kept". |
| 5    | High (later phase) | Decide whether SMS and the phone line return, and how        | Re-plan from §9: live-test the callback variables, choose the egress transport (voicemail-to-email via SendGrid Inbound Parse, a relay, or Static IPs), and meet the vendor-neutral requirements list. | §9; `[C67, C68]`; `[C69]` unverified.                        |
| 6    | Low                | Bootstrap leftovers #7, #8, #13, #15                         | Keep open: create-next-app flags doc note, `minimatch` advisory, "Require Active Resource Before Deploy" effect on production, Neon retention doc discrepancy. | `docs/plans/2026-11-02-bootstrap-report.md`, "Remaining tasks". |
| 7    | Low                | Safari media playback                                        | If `<audio>`/`<video>` seeking fails on iOS, add Range / 206 support to `/api/media/[id]`. Verify in Task 10. | `/api/media/[id]`; Safari requires byte-range responses for seeking. |
| 8    | Low                | HEIC display outside Safari                                  | If families mostly use Android/Chrome, add a server-side JPEG derivative for HEIC in Phase 2 (`DERIVED_MEDIA` in the design doc). | Task 8 shows a download link today.                          |
| 9    | Low                | Production Blob write token in preview builds and local `.env` | Create a second private store (or a `preview/` prefix with its own token) for Preview and Development so PR code never holds the production write token. | Task 5 step 1; §8.                                           |
| 10   | Medium             | Contributor data copied into `preview/<branch>` and `dev` Neon branches | Once real memories exist, switch the Vercel–Neon integration to branch previews from a schema-only parent and reset `dev` from an empty seed branch; tokens are already hashed, so copies cannot yield claim links. | Neon branching docs; §8.                                     |
| 11   | Low                | Claim-link rotation and `UPLOAD_TICKET_SECRET` rotation      | Add a "send me a new link" Server Function that rotates `claimTokenHash` and re-sends the email; accept `UPLOAD_TICKET_SECRET_PREVIOUS` for 15 minutes during a secret rotation. | Task 8; Task 7 step 3.                                       |

---

## 12. Review findings disposition

### Part A — revision 1 review (2026-11-02; George #1–12, Oscar #13–43)

| #    | Disposition                                                  | Where                            |
| ---- | ------------------------------------------------------------ | -------------------------------- |
| 1    | Done: `www` canonical URL via `getSiteUrl()`, explicit `callbackUrl`, Task 6 verifies instead of recreating, `docs/domain.md` in §0 | §2, Tasks 2b, 5, 6, 8, §7        |
| 2    | Sources conflict on `{ID}`/`{MEDIA}` (API copy: three variables; wiki: six `[C67]`); bearer auth removed; moot while SMS is deferred | §9                               |
| 3    | Done: temp-file env pull under `umask 077` with a trap       | Task 5 step 1                    |
| 4    | Done: no `dynamic`/`runtime`; request-time-read-first rule   | Task 2b step 2, Tasks 5, 7, 8, 9 |
| 5    | Deferred with the phone line; identity rule recorded         | §9, §11 #5                       |
| 6    | Done: `prisma-client` + `output`, `@next/env`, `process.env` in config, expand-and-contract, preview-build check | Task 3                           |
| 7    | Outbox deferred with SMS; cron idempotency kept for the reconcile job | Task 9, §9                       |
| 8    | Gemini/SMS deferred; billed project recorded; `store:false` and 18+ clause recorded | §0.1, §9, §11 #1                 |
| 9    | Done: Sentry 11 + `dataCollection` on server and client, URL scrubbing, media headers; Range → follow-up | Task 4, Task 5, §11 #7           |
| 10   | Done: `checksumSha256?` + `Media.status`, ticket binding, reconcile pass, `safeEqualHex` | Tasks 3, 5, 7, 9                 |
| 11   | Done: docs rows, `NEON_API_KEY` how-to, table-count wording  | Tasks 1, 3, 10, §7               |
| 12   | Done: ledger file with per-task sections, decisions, cold start, Task 1 ordering, checks and rollbacks | §0.1, §0.2, Task 1, all tasks    |
| 13   | = 3                                                          | Task 5                           |
| 14   | = 1                                                          | —                                |
| 15   | = 4                                                          | —                                |
| 16   | Moot: D1 removed with the phone line                         | §9                               |
| 17   | Deferred with SMS                                            | §9                               |
| 18   | Done at Phase 1 size: Server-Function finalize + backstop callback + reconcile cron; full job system is a non-goal | §2, Tasks 7, 9, §10              |
| 19   | Deferred with SMS                                            | §9                               |
| 20   | Deferred with SMS                                            | §9                               |
| 21   | Done: `(memoryId, emailType)` unique + cron retries; ambiguous-outcome state is a non-goal; SMS part deferred | Tasks 3, 5, 9, §10               |
| 22   | Deferred with the phone line                                 | §9                               |
| 23   | Deferred with SMS                                            | §9                               |
| 24   | Moot (no live routing change in Phase 1); principle kept: public pieces go live after their checks; `/share` gated | Tasks 6, 10                      |
| 25   | Deferred with the phone line                                 | §9                               |
| 26   | Deferred with the phone line                                 | §9                               |
| 27   | Deferred (Gemini Phase 2); billed project recorded           | §0.1, §11 #1                     |
| 28   | Deferred with SMS                                            | §9                               |
| 29   | Deferred with SMS; principle kept: `contributorNote` stored as typed, files write-once | Task 3 schema                    |
| 30   | Deferred with SMS                                            | §9                               |
| 31   | Done: storage consent vs contact opt-in split, outbound guard; SendGrid readiness is a Task 0 gate | Tasks 0, 5, 7                    |
| 32   | Done: `dataCollection`, URL scrubbing, Pino redaction; platform logs → follow-up | Tasks 2b, 4, §11 #3              |
| 33   | Done: media route contract incl. CSP sandbox; Range → follow-up | Task 5, §11 #7                   |
| 34   | Done: per-memory cap at ticket time, daily budgets, `validUntil`, MIME/size limits, WAF gate; in-app limiting → follow-up | Tasks 7, 10, §11 #2              |
| 35   | Done: `Media.status`, `PENDING` row at ticket time, idempotent `recordMedia`, finalize before "Saved" | Task 7                           |
| 36   | Done: outbound guard + allowlist; DB branches per env; shared Blob store documented and follow-up filed | Task 5, §8, §11 #9               |
| 37   | Done: expand-and-contract rule, preview-branch build check   | Task 3                           |
| 38   | Done: seed in `buildCommand`, env vars added before the first push with `vercel.json`, rows verified | Task 3, Task 10                  |
| 39   | = 6                                                          | —                                |
| 40   | = 9                                                          | —                                |
| 41   | Deferred with the phone line                                 | §9, §11 #5                       |
| 42   | Done: provenance fixed, ledger file, cold start              | header, §0.1                     |
| 43   | Done: `docs/environment.md` rows, design-doc scope note, decisions table | §0.1, §7, Task 0                 |

### Part B — revision 2 review (2026-11-03; friend's premortem F1–F11 and §3, §5, §6)

| #    | Disposition                                                  | Where                                                   |
| ---- | ------------------------------------------------------------ | ------------------------------------------------------- |
| F1   | Done: SendGrid readiness is a Task 0 gate (not-started acceptable) and a Task 10 pre-launch check `[C71]` | Task 0 step 4, Task 10                                  |
| F2   | Done: ledger in `docs/plans/phase1-ledger.md` as per-task sections; push after every external mutation; draft PR at branch creation; cold start reads `main` + open PRs + `git log --all`; Owner and worktree columns | §0.1, Appendix A                                        |
| F3   | Done: `MediaRecorder` feature detection, explicit allowlist with iPhone types, normalization, extension fallback, `contentType` in `upload()`, download link, iPhone acceptance tests `[C72, C78]` | Task 5 step 2, Task 7 steps 2–4, Task 8 step 3, Task 10 |
| F4   | Done: `vercel env add` (non-interactive) before the first push with `vercel.json`; `vercel env ls` and `NODE_ENV` checks | Task 3 step 7                                           |
| F5   | Done: cron retries `FAILED` (< 5 attempts) and stale `PENDING` emails; `nextAttemptAt` | Task 3 schema, Task 5 step 6, Task 9 step 2(d)          |
| F6   | Done: manual Sentry install; wizard optional and Rob-run; `.env.sentry-build-plugin` check | Task 4 step 1                                           |
| F7   | Done, option (b) refined: `READY` after `head()`; hash in `after()` for ≤ 50 MB, cron for larger (page `maxDuration` bounds `after()` `[C73]`) | Task 7 steps 1, 6; Task 9 step 2(b)                     |
| F8   | Done: WAF rule on all public paths + Spend Management + daily budgets are pre-launch gates; decisions row "Blocked" | Task 10, §0.1, Task 7                                   |
| F9   | Done: all non-Prisma installs in Task 2a, Prisma in Task 3; never two lockfile changes in a parallel wave | §0.2, Tasks 2a, 3                                       |
| F10  | Done: seed `update: {}`; third-run check                     | Task 3 step 6                                           |
| F11  | Done: separate optional contact checkbox feeds `contactOptIn`; confirmation is transactional | Task 7 step 1, Task 8 step 2                            |
| §3   | Partly: §12 #2 reworded "sources conflict"; `[C69]` marked unverified; vendor-neutral requirements in §9. **Not** recording "wrong vendor": Rob chose "deferred, too complex; keep account and keys" | §9, §10, §11 #4–#5                                      |
| §5   | Done: owner column, worker/orchestrator check split, worktree provisioning, installs per PR, shared-file owners, reference folder copied into worktrees, waves, stacked PRs with bases, hand-back template; TrayVerify prompt copying is Rob-side | §0.2                                                    |
| §6   | Adopted: four fresh-context lenses ran on revision 3 (part C); same per PR, then the cross-family review | §0.2 PRs, §12 part C                                    |

### Part C — revision 3 review (2026-11-03; four fresh-context lenses: cold-start dry run C1–C22, platform correctness P1–P14, security/privacy/abuse S1–S22, orchestration readiness O1–O23; 81 raw, 60 distinct)

| Finding(s)    | Verified?                                                    | Disposition                                                  | Where                                       |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------- |
| C1            | yes (no `.env` in this checkout)                             | Done: orchestrator-only `cd` guard; workers skip §0.1        | header, §0.1                                |
| C2, O1        | yes (`/node_modules`, `/generated/` gitignored)              | Done: worktree provisioning (`npm ci --offline`, `next typegen`, `.reference/`) | §0.2                                        |
| C3, P1, O4    | yes (`LayoutProps<"/">` in `app/layout.tsx`; `next typegen` in CLI docs `[C74]`) | Done: `type-check: next typegen && tsc --noEmit`             | Task 2a step 1                              |
| O2            | yes (`next/font/google` downloads at build `[C76]`)          | Done: `geist` package, font swap, offline build proof        | Tasks 2a, 2b step 1                         |
| O3            | yes (`afterWithFlush` needs Sentry)                          | Done: `@sentry/nextjs` installed in Task 2a                  | §0.2 installs                               |
| C4, O5        | yes (`server-only` throws outside RSC)                       | Done: Vitest alias stub; seed builds its own client          | Task 2b step 6, Task 3 step 6               |
| C5            | yes (`eslint.config.mjs` ignores)                            | Done: `generated/**` ignored in Task 3                       | Task 3 step 2                               |
| C6            | plausible (`vercel env add` prompts)                         | Done: non-interactive stdin form in the §4 preamble          | §4                                          |
| C7, O14       | yes (missing `vercel env add` lines)                         | Done: explicit env lines per task; §7 column; ledger sections | Tasks 3, 4, 5, 7, 9; §7                     |
| C8, O15       | yes                                                          | Done: per-feature lazy sub-schemas; each worker adds its own | Task 2b step 3; §0.2 ownership              |
| O7            | yes                                                          | Done: `getDb()` lazy; no module-scope `PrismaClient`; rule in house rules | Task 3 step 3, Task 2b step 2               |
| C9            | yes (bootstrap report: previews 302)                         | Done: Protection Bypass secret from Rob in Task 0; header on every preview check | Task 0 step 5, §0.2                         |
| C10           | yes                                                          | Done: `getSiteUrl()` per environment; `NEXT_PUBLIC_SITE_URL` production only; link check split pre/post merge | Task 2b step 4, Task 8 checks               |
| C11           | yes (`[C27]` production only)                                | Done: Task 9 live checks after merge; PR D may merge with Task 9 `[~]` | Task 9 checks, §0.2 PRs                     |
| C12, O8, O9   | yes                                                          | Done: PR base column (stacked), rebase rule, one lockfile change per PR, no two in a parallel wave | §0.2                                        |
| C13, O16, O17 | yes (no ledger file on the branch)                           | Done: Task 0 creates the ledger on the plan PR branch; §0 corrected; per-task sections; draft PR at branch creation; `git log --all` and `git status` in cold start | §0, §0.1, Task 0 step 9, Appendix A         |
| C14           | yes                                                          | Done: exact append commands for `.env.local`                 | Task 1 step 1                               |
| C15, O19      | yes                                                          | Done: `neon projects list` in Task 0; Task 1 owner + Rob; workers skip §0.1 | Task 0 step 1, Task 1, §0.2                 |
| C16           | yes                                                          | Done: CI job named `ci`; scripts in Task 2a                  | Task 1 step 2, Task 2a                      |
| C17           | yes                                                          | Done: "not started" acceptable at Task 0                     | Task 0 step 4                               |
| C18           | yes                                                          | Done: `Person.name = MEMORIAL_NAME`; Appendix A gets the real decisions table | Task 3 step 6, Task 0 step 9                |
| C19           | yes                                                          | Done: `npx tsx --env-file=.env …`; `scripts/send-test-email.ts` | Tasks 5, 6                                  |
| C20           | yes                                                          | Done: Sentry UI checks assigned to Rob                       | Task 4 step 6                               |
| C21           | yes                                                          | Done: "before the first push containing `vercel.json`"       | Task 3 step 7                               |
| C22           | yes                                                          | Done: one file per submission, "add another file" from the claim page via `createUploadTicket`; cap at ticket time; return shape aligned | Tasks 7, 8                                  |
| P2, S21       | yes (`x-content-type` only with `contentType` `[C78]`)       | Done: `contentType` in `upload()`                            | Task 7 step 4                               |
| P3            | yes (`[C58]` prerender bail-out by throwing)                 | Done: read headers before the env check; static-body test    | Task 9 step 2                               |
| P4            | yes (`after()` runs within the route's `maxDuration`)        | Done: page `maxDuration = 120`; inline hash only ≤ 50 MB; §10 reworded | Task 7 steps 1, 6; §10                      |
| P5            | yes (`[C77]`)                                                | Done: no `serverExternalPackages`                            | Task 2a step 3, §10                         |
| P6            | yes (`io()` in docs `[C75]`)                                 | Done: "request-time read first, then data" rule; `io()` mentioned | Task 2b step 2                              |
| P7            | yes                                                          | Done: `'use client'`, own `<html>`/`<body>`, `useEffect` capture | Task 4 step 1                               |
| P8            | yes (`validUntil` is epoch ms)                               | Done: `expiresAt` epoch ms, test asserts pass-through        | Task 7 step 3, TDD list                     |
| P9            | yes                                                          | Done: explicit `callbackUrl` from `onBeforeGenerateToken`; `VERCEL_BLOB_CALLBACK_URL` dropped | Task 7 step 5, §2                           |
| P10           | reasonable                                                   | Done: multi-line generator block                             | Task 3 step 2                               |
| P11           | reasonable                                                   | Done: relative import in the seed; `postinstall` note        | Task 3 steps 2, 8                           |
| P12           | yes (`@types/node ^20`)                                      | Done: `@types/node@26` in Task 2a                            | §0.2 installs                               |
| P13           | yes (unverified `dotenv`)                                    | Done: `@next/env` `loadEnvConfig`                            | Task 3 step 1, §10                          |
| P14           | yes (keys beyond `[C60]` unverified)                         | Done: four documented keys required; extras only if the installed types define them | Task 4 step 2                               |
| S1            | yes                                                          | Done: daily memory and byte budgets in `createMemory()`; Spend Management gate; WAF as second layer | Task 7 step 3, Task 10                      |
| S2            | yes                                                          | Done: escaping, fixed subject, no echo of note/relationship, 60-char name, per-recipient cap, skip counts | Task 5 step 6, Task 9                       |
| S3            | partly (presign not in types)                                | Done: WAF covers `/api/media/*` and `/m/*`; `maxDuration = 60` on the media route; presign verified at Task 5 | Task 5 steps 4–5, Task 10                   |
| S4            | yes                                                          | Done: `head()` by ticketed pathname; `blobUrl` from the head result | Task 7 step 6                               |
| S5, S11       | yes                                                          | Done: `Media(PENDING)` created at ticket time in a transaction; cap and cron rely on it; `tokenPayload` carries `mediaId` | Task 7 steps 3, 5, 6; Task 9 step 2(a)      |
| S6            | yes                                                          | Done: `claimTokenHash`; follow-up for schema-only preview branches | Task 3 schema, Task 5 step 3, §11 #10       |
| S7            | yes                                                          | Done: client init mirrors `dataCollection` and scrubbing; Replay off | Task 4 step 3                               |
| S8            | yes                                                          | Done: `Referrer-Policy: same-origin` on `/m/*` via `headers()` + meta; no third-party assets | Task 2a step 3, Task 8 step 3               |
| S9            | yes                                                          | Done: new `Contributor` per submission; non-goal recorded    | Task 7 step 3, §10                          |
| S10           | yes                                                          | Done: Pino `redact`; logger test                             | Task 2b step 5                              |
| S12           | yes                                                          | Done: `P2002` caught; concurrent test                        | Task 7 step 6, TDD list                     |
| S13           | reasonable                                                   | Done: canonical JSON HMAC; rotation → follow-up              | Task 7 step 3, §11 #11                      |
| S14           | yes                                                          | Done: `umask 077` + trap; `SENTRY_AUTH_TOKEN` Vercel only; second store → follow-up | Task 5 step 1, Task 4, §11 #9               |
| S15           | yes                                                          | Done: `safeEqualHex` hashes both sides                       | Task 5 step 3                               |
| S16           | yes                                                          | Done: CSP sandbox; filename sanitization                     | Task 5 step 5                               |
| S17           | yes                                                          | Done: `consentedAt` required; `docs/consent/<version>.md`; version in the first revision | Task 0 step 6, Task 3 schema, Task 8 step 3 |
| S18           | judgment                                                     | Done: no phone field in the form; column kept                | Task 7 step 1, §10                          |
| S19           | yes                                                          | Done: `deletedAt` filters in `recordMedia`, `confirm`, cron; blob deletion step | Tasks 7, 8, 9                               |
| S20           | reasonable                                                   | Follow-up                                                    | §11 #11                                     |
| S22           | yes                                                          | Done: strict boolean and list parsing with tests             | Task 2b step 3                              |
| O6            | yes                                                          | Done: Task 2 split into 2a (orchestrator) and 2b (worker)    | Tasks 2a, 2b                                |
| O10           | yes                                                          | Done: Task 7 ships without the email call; Task 8 adds it; ownership row | Tasks 7, 8; §0.2                            |
| O11           | yes                                                          | Done: tunnel step moved to orchestrator-optional; signed-callback unit test | Task 7 step 7, TDD list                     |
| O12           | yes                                                          | Done: reference files copied into `.reference/` (gitignored); EmpathIQ `eslint.config.mjs` added | §0.2, Task 1 step 4                         |
| O13           | yes                                                          | Done: hand-back template; workers never edit the ledger; orchestrator merges `wip/task-N` | §0.2, §0.1 rule 7                           |
| O18           | yes                                                          | Done: decisions rows for SendGrid details; "one-off actions" in the ledger; post-merge rows on the next branch or the close PR | §0.1 rule 3, Appendix A                     |
| O20           | yes                                                          | Done: `AGENTS.md` orchestrator-owned; worker drafts `docs/code-layout.md` | §0.2, Task 2b step 2                        |
| O21           | reasonable                                                   | Done: `telemetry: false`, `silent`, `sourcemaps.disable` without a token | Task 4 step 4                               |
| O22           | yes                                                          | Done: Task 8/9 checks wait on Task 6; interim single-sender verification | Task 6 step 4, Task 8 checks                |
| O23           | yes                                                          | Done: form and recorder verified by orchestrator checks; non-goal recorded | Task 7 step 1, §10                          |

---

## Appendix A — initial `docs/plans/phase1-ledger.md`

```markdown
# Phase 1 execution ledger

Authoritative record of what has already happened. Read every copy (main, open PR branches, `git log --all -- docs/plans/phase1-ledger.md`) before any external mutation (plan §0.1). The orchestrator commits and pushes a section immediately after each external change; workers never edit this file. One section per task so parallel branches never touch adjacent lines.

## Decisions and approvals

(the full table from plan §0.1 is pasted here verbatim in Task 0 and updated in place afterwards)

## One-off actions

- [ ] `preview/docs/bootstrap-report` Neon branch deleted by hand (Task 1): date
- [ ] `main` ruleset created after PR A merged (Task 1 step 5): ruleset id, date, recorded on branch …
- [ ] WAF rate-limit rule created (Task 10): rule id, date
- [ ] Spend Management hard pause set (Task 10): amount, date
- [ ] SendGrid interim single-sender verification added / removed (Task 6): dates

## Task 0 — Inventory, decisions
- Status: [ ]   Owner: Rob + orchestrator   Branch/PR: docs/phase1-plan
- Checks passed: —
- Notes: SendGrid plan / sender-auth status / key scope: …; Neon CLI auth method: …; EmpathIQ reference cloned at: …

## Task 1 — Infra follow-ups
- Status: [ ]   Owner: orchestrator + Rob   Branch/PR: A
- External IDs: Neon dev branch …; GitHub variable NEON_PROJECT_ID; GitHub secret NEON_API_KEY; ruleset (see one-off actions)
- Checks passed: —

## Task 2a — Pre-flight
- Status: [ ]   Owner: orchestrator   Branch/PR: A   Base commit for 2b: …
- Checks passed: offline build on the base: —

## Task 2b — Conventions, logging, tests
- Status: [ ]   Owner: worker   Branch/PR: A   Worktree: …   wip branch: wip/task-2b   Head: …
- Hand-back received: —   Merged into A at: —
- Checks passed: —

## Task 3 — Database
- Status: [ ]   Owner: orchestrator   Branch/PR: B
- External IDs: migration phase1_init; Vercel env MEMORIAL_NAME / MEMORIAL_SLUG / CONSENT_VERSION (production, preview)
- Checks passed: —

## Task 4 — Sentry 11
- Status: [ ]   Owner: orchestrator + Rob   Branch/PR: B
- External IDs: Sentry org token (name) …; Vercel env SENTRY_AUTH_TOKEN (production, preview)
- Checks passed: —

## Task 5 — Storage + email services
- Status: [ ]   Owner: split   Branch/PR: C   Worktree: …   Head: …
- External IDs: BLOB_STORE_ID …; Vercel env SENDGRID_FROM_EMAIL, OUTBOUND_ENABLED (production), OUTBOUND_ALLOWLIST, NEXT_PUBLIC_SITE_URL (production)
- Checks passed: —

## Task 6 — DNS for SendGrid
- Status: [ ]   Owner: orchestrator + Rob   Branch/PR: C
- External IDs: Cloudflare record ids …; SendGrid domain authentication id …; verified on: …
- Checks passed: —

## Task 7 — Web upload
- Status: [ ]   Owner: worker   Branch/PR: D   Worktree: …   Head: …
- External IDs: Vercel env UPLOAD_TICKET_SECRET, DAILY_MEMORY_BUDGET, DAILY_BYTE_BUDGET (production, preview)
- Checks passed: —

## Task 8 — Claim links + email
- Status: [ ]   Owner: worker   Branch/PR: D   Worktree: …   Head: …
- Checks passed: —

## Task 9 — Reconcile cron
- Status: [ ]   Owner: worker + orchestrator   Branch/PR: D (live checks after merge)
- External IDs: Vercel env CRON_SECRET (production, preview)
- Checks passed: —

## Task 10 — Verification + gates
- Status: [ ]   Owner: orchestrator + Rob   Branch/PR: docs/phase1-close
- Gates: WAF rule …; Spend Management …; budgets …; SendGrid verified …
- Acceptance results: —

## Provisioned resources (reference)

| Resource | Identifier | Created in |
|---|---|---|
| Vercel project | prj_UWoR1IGnShoagieZphn2aXOnGSfm (team team_KcheaXYZlslwXKrG5iksYEhL) | bootstrap |
| Neon project / main branch | icy-scene-20351172 / br-restless-king-bbmkh5zd | bootstrap |
| Sentry project | med3ai/jowray_com (4512363870158848) | bootstrap |
| Cloudflare zone | dad5b9fdb1ece5afc4a4224f61a51770 | docs/domain.md |
```

---

## Citations

Project sources are this repository and Rob's other repositories. External quotes were taken from the live pages on 2026-11-02/03. Citations `[C13]–[C15]`, `[C18]`, `[C37]`, `[C39]–[C55]` from revision 1 are retired (VoIP.ms, Gemini, segment config); their numbers are not reused.

### [C1] — jowray_com design doc: phases, data model, Phase 3 auth

- **Relevant File(s):** `prisma/schema.prisma`, `features/memories/*`, `app/share/*`, `app/m/[claimToken]/*`, §0–§2, §9
- **Change Summary:** Build the web-collection subset of Phase 1 (collect, capture who/when/consent, store originals, send a claim link); defer Auth.js and admin to Phase 3.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/main/docs/Memorial%20Memories%20Site%20initial%20thinking.md
- **Verbatim Quote:**

  > "A place for family and friends to leave voice, video, photo and text memories by phone, text message or the web. Phase 1 only collects. Later phases transcribe and analyze what was collected, then show it back as a tag cloud, a timeline and search." "- Web upload: voice, video, photo … - Capture who, approximate date, consent - Store originals untouched; send a claim link" "Originals are write-once; derived files live under a separate prefix. Keep the storage key in MEDIA, never a public URL." "Phase 3. Magic-link sign-in by email or SMS; link USER to CONTRIBUTOR by the verified email or phone. Until then, claim links give contributors edit access."
- **Justification:** The design doc is the product spec; §1 scope and the Task 3 schema follow it.

### [C2] — jowray_com bootstrap completion report (PR #1): resources, state, remaining tasks

- **Relevant File(s):** §0, §0.1, Tasks 1, 3, 4, 5
- **Change Summary:** Reuse the provisioned Vercel, Neon, and Sentry resources; absorb remaining tasks #1, #2, #3, #4, #10, #14.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/main/docs/plans/2026-11-02-bootstrap-report.md
- **Verbatim Quote:**

  > "| Vercel project | https://vercel.com/rob-wrays-projects/jowray.com · project ID `prj_UWoR1IGnShoagieZphn2aXOnGSfm` · team `rob-wrays-projects` (`team_KcheaXYZlslwXKrG5iksYEhL`) · framework Next.js · Node 26.x · function region `iad1` |" "| Neon | Project `icy-scene-20351172` ("jowray_com") · org `org-dark-band-75525913` (Vercel-managed) · … default branch `main` (`br-restless-king-bbmkh5zd`) · … billing plan Scale (`scale_v3`) |" "**State: verified.** Neon's documented test was run on this PR: push a feature branch, then check the Vercel deployments and the Neon branches." "1. **[Medium]** Local development env vars point at the production (default) Neon branch. Adopt a branch-first dev flow, such as a `dev` Neon branch for local work." "14. **[Low]** Re-check that `.env.local` is still mode 600 after any `vercel link` or `vercel env pull`, which write to that file."
- **Justification:** §0 states what exists so the executor does not recreate it; Task 1 closes the open items.

### [C3] — jowray_com `docs/environment.md`: existing key names, load order, env pull rule

- **Relevant File(s):** `server/config/env.ts`, `.env.local`, Task 5 step 1, §7
- **Change Summary:** Read existing key names unchanged; keep every project key in `.env`; pull Vercel values into a temp file and merge.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/main/docs/environment.md
- **Verbatim Quote:**

  > "**Every project key lives in `.env`.** The one exception is `VERCEL_OIDC_TOKEN`: `vercel link` writes it to `.env.local`, and it stays only there." "The Neon values come from the Vercel project. To see the current values, run `vercel env pull <tmpfile> --environment=development` and merge in only the keys that are missing. Don't let the tool overwrite `.env`, because other tooling edits that file too." "| `GEMINI_API_KEY` | Google Gemini for photo and video analysis (phase 2). …"
- **Justification:** Task 5 step 1 follows the documented pull rule; §7 uses the names verbatim.

### [C4] — jowray_com `AGENTS.md`: project rules

- **Relevant File(s):** every task
- **Change Summary:** Work on branches with PRs, never commit `.env*`, never hide errors, document keys in `docs/environment.md`.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/main/AGENTS.md
- **Verbatim Quote:**

  > "- After the bootstrap commit, every change goes on a branch with a PR, including critical fixes." "- Never add an ESLint suppression (`eslint-disable…`) unless Rob approves with an all-caps "YES" after being asked." "- Never hide an error to keep moving. Fix the root cause with best-practice code." "- Never commit secrets. `.env*` files are gitignored; key names and purposes are in `docs/environment.md`."
- **Justification:** Governs how every task is executed and verified; restated in every worker brief (§0.2).

### [C5] — empathiq `CLAUDE.md`: layering, logging, `afterWithFlush`, TDD for critical paths

- **Relevant File(s):** `AGENTS.md` (code layout), `eslint.config.mjs`, `lib/logger/*`, `lib/sentry/after-flush.ts`, route handlers
- **Change Summary:** Adopt the house conventions adapted to a root-level `app/`. The `force-dynamic` rule quoted below is **superseded** under Cache Components `[C58]`.
- **Source URL:** https://github.com/RobertdWray/empathiq/blob/main/CLAUDE.md (commit `ac902c9`; local copy per §0.2)
- **Verbatim Quote:**

  > "Features -> Services -> Integrations -> External APIs" "Services define interfaces; integrations implement with `\"server-only\"` guard" "Pages with user data MUST export `dynamic = \"force-dynamic\"` (Next.js 15+ caches aggressively - symptom: data only updates after redeploy)" "All integration files MUST import `\"server-only\"` as first line" "`after()` callbacks in API routes: Use `afterWithFlush()` from `@/lib/sentry/after-flush` instead of raw `after()` when the callback calls `logError()` or captures Sentry events — serverless functions terminate before Sentry's async transport flushes" "**TDD Required (Critical Paths)** - RED-GREEN-REFACTOR: - Auth flows … - Webhook handlers …"
- **Justification:** Tasks 2, 7, 8, 9 copy these conventions, except the segment-config rule.

### [C6] — empathiq `src/server/db/client.ts`: Prisma 7 client singleton over a driver adapter

- **Relevant File(s):** `server/db/client.ts`
- **Change Summary:** Same lazy `globalThis` singleton, with `PrismaNeon` instead of `PrismaPg`.
- **Source URL:** https://github.com/RobertdWray/empathiq/blob/main/src/server/db/client.ts
- **Verbatim Quote:**

  > "Uses @prisma/adapter-pg for Prisma v7 compatibility. Uses globalThis to prevent multiple instances during hot reloading." "const adapter = new PrismaPg({ connectionString: databaseUrl, }); return new PrismaClient({ adapter, log: logConfig, });"
- **Justification:** Task 3 step 3.

### [C7] — empathiq `instrumentation.ts`: Sentry server init in `register()`

- **Relevant File(s):** `instrumentation.ts`
- **Change Summary:** Initialize Sentry inside `register()` with Pino and Prisma integrations; v11 data controls come from `[C60]`.
- **Source URL:** https://github.com/RobertdWray/empathiq/blob/main/instrumentation.ts
- **Verbatim Quote:**

  > "Initialize Sentry server SDK directly in register() rather than importing from sentry.server.config.ts. The dynamic import pattern fails silently on Vercel Lambda" "Sentry.prismaIntegration(), // Forward Pino logs to Sentry Logs dashboard Sentry.pinoIntegration()," "export const onRequestError = Sentry.captureRequestError;"
- **Justification:** Task 4 step 2.

### [C8] — empathiq SendGrid integration: EmailLog and retries

- **Relevant File(s):** `integrations/sendgrid/index.ts`, `prisma/schema.prisma` (`EmailLog`)
- **Change Summary:** Reuse the retrying email service with pre-send `EmailLog` rows, keyed per memory and type, extended with cron retries.
- **Source URL:** https://github.com/RobertdWray/empathiq/blob/main/src/integrations/sendgrid/index.ts
- **Verbatim Quote:**

  > "Implements EmailService interface using SendGrid with retry logic and EmailLog database tracking." "const MAX_RETRIES = 3; /** Base delay in ms for linear backoff (1s, 2s, 3s). */ const BASE_DELAY_MS = 1000;" "const NON_RETRYABLE_CODES = new Set([400, 401, 403]);" "// Create EmailLog record before attempting to send"
- **Justification:** Task 5 step 5, Task 8 step 2, Task 9 step 2(d).

### [C9] — empathiq Vercel Blob storage service

- **Relevant File(s):** `integrations/vercel-blob/index.ts`, `app/api/media/[id]/route.ts`, `features/memories/ingest-upload.ts`
- **Change Summary:** Private uploads with deterministic pathnames and streamed private reads; overwrite disabled for originals.
- **Source URL:** https://github.com/RobertdWray/empathiq/blob/main/src/integrations/vercel-blob/index.ts
- **Verbatim Quote:**

  > "const blob = await put(pathname, body, { access: "private", contentType, addRandomSuffix: false, allowOverwrite: true, });" "// PutBlobResult doesn't include size — fetch it via head()" "const result = await get(url, { access: "private" }); if (!result || result.statusCode === 304) return null;"
- **Justification:** Task 5 steps 3–4, Task 7 step 6.

### [C10] — empathiq `vercel.json` crons and `CRON_SECRET` route pattern

- **Relevant File(s):** `vercel.json`, `app/api/cron/reconcile-uploads/route.ts`
- **Change Summary:** Define the cron in `vercel.json` and fail closed on a missing or wrong `CRON_SECRET`.
- **Source URL:** https://github.com/RobertdWray/empathiq/blob/main/vercel.json and https://github.com/RobertdWray/empathiq/blob/main/src/app/api/cron/stale-sessions/route.ts
- **Verbatim Quote:**

  > ""crons": [ { "path": "/api/cron/stale-sessions", "schedule": "*/30 * * * *" }," "// 1. Authenticate via CRON_SECRET — fail closed if env var is missing const cronSecret = process.env.CRON_SECRET; if (!cronSecret) {" "if (authHeader !== `Bearer ${cronSecret}`) { return NextResponse.json( { error: { code: "UNAUTHORIZED", message: "Invalid or missing CRON_SECRET" } }, { status: 401 } ); }"
- **Justification:** Task 9 (with a constant-time compare instead of `!==`).

### [C11] — empathiq `next.config.ts`: externalize native packages for Turbopack

- **Relevant File(s):** `next.config.ts`
- **Change Summary:** Add `serverExternalPackages` for Pino.
- **Source URL:** https://github.com/RobertdWray/empathiq/blob/main/next.config.ts
- **Verbatim Quote:**

  > "// Externalize native Node.js packages that can't be bundled by Turbopack serverExternalPackages: ["pino", "pino-pretty", "@boundaryml/baml"],"
- **Justification:** Task 2 step 3.

### [C12] — empathiq `docs/plans/` task format

- **Relevant File(s):** this plan
- **Change Summary:** Use the house plan structure (Goal / Architecture / Tech Stack / Branch / Tasks with Files and Steps).
- **Source URL:** https://github.com/RobertdWray/empathiq/blob/main/docs/plans/2026-02-26-audio-data-retention.md
- **Verbatim Quote:**

  > "**Goal:** … **Architecture:** … **Tech Stack:** Prisma 7 (migration) | Next.js 16 App Router | React 19 | Zod | TailwindCSS 4 | Vitest **Worktree:** Yes — create isolated worktree before starting. **Branch:** `feat/audio-data-retention` **PR at end:** Yes." "## Task 1: Prisma Schema — Add `AudioRetentionPolicy` enum and `User.audioRetentionPolicy` field **Files:** - Modify: `prisma/schema.prisma` (add enum + field)"
- **Justification:** The executing agent already consumes plans in this shape.

### [C16] — Next.js: environment variable load order

- **Relevant File(s):** `.env.local`, `prisma.config.ts`, `server/config/env.ts`
- **Change Summary:** `.env.local` (dev Neon branch) overrides `.env`; both are gitignored.
- **Source URL:** https://nextjs.org/docs/app/guides/environment-variables#environment-variable-load-order
- **Verbatim Quote:**

  > "Environment variables are looked up in the following places, in order, stopping once the variable is found. 1. `process.env` 2. `.env.$(NODE_ENV).local` 3. `.env.local` (Not checked when `NODE_ENV` is `test`.) 4. `.env.$(NODE_ENV)` 5. `.env`"
- **Justification:** Task 1 step 1, Task 3 step 1, §6.

### [C17] — Next.js: `instrumentation.ts` `register()` semantics

- **Relevant File(s):** `instrumentation.ts`
- **Change Summary:** Sentry is initialized once per server start, gated on `NEXT_RUNTIME`.
- **Source URL:** https://nextjs.org/docs/app/guides/instrumentation#convention
- **Verbatim Quote:**

  > "Then, export a `register` function in the file. This function will be called **once** when a new Next.js server instance is initiated, and must complete before the server is ready to handle requests." "Next.js calls `register` in all environments, so it's important to conditionally import any code that doesn't support specific runtimes (e.g. Edge or Node.js). You can use the `NEXT_RUNTIME` environment variable to get the current environment:"
- **Justification:** Task 4 step 2.

### [C19] — Next.js: Route Handlers, query params, async `params`

- **Relevant File(s):** `app/api/upload/route.ts`, `app/api/media/[id]/route.ts`, `app/api/cron/*`
- **Change Summary:** Read the route segment and query through `NextRequest`; `params` is a promise.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/route#url-query-parameters
- **Verbatim Quote:**

  > "The request object passed to the Route Handler is a `NextRequest` instance, which includes some additional convenience methods, such as those for more easily handling query parameters." "`params`: a promise that resolves to an object containing the dynamic route parameters for the current route."
- **Justification:** Tasks 5, 7, 9.

### [C20] — Sentry: Next.js setup (manual setup, init files)

- **Relevant File(s):** `instrumentation-client.ts`, `app/global-error.tsx`, `instrumentation.ts`
- **Change Summary:** Install manually (the wizard is interactive); create the init files the docs describe.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/ and https://docs.sentry.io/platforms/javascript/guides/nextjs/#install
- **Verbatim Quote:**

  > "npx @sentry/wizard@latest -i nextjs" "You need: A Next.js application on version 14 or higher Node.js 20.19.0 or higher" "`instrumentation-client.ts`: runs in the browser `sentry.server.config.ts`: runs in the Node.js runtime `sentry.edge.config.ts`: runs in the Edge runtime"
- **Justification:** Task 4 step 1 (manual path; the wizard quote documents the alternative Rob may run).

### [C21] — Sentry: `withSentryConfig`, `onRequestError`, logs

- **Relevant File(s):** `next.config.ts`, `instrumentation.ts`, `lib/logger/*`, `lib/sentry/after-flush.ts`
- **Change Summary:** Wrap the Next config, keep `onRequestError`, forward Pino logs, upload source maps with an org token.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/#apply-instrumentation-to-your-app
- **Verbatim Quote:**

  > "The wizard wraps your Next.js configuration with `withSentryConfig`. This instruments your app at build time, uploads source maps, and, if you said yes in the wizard, routes browser requests to Sentry through your server to avoid ad blockers." "It loads your server and edge configurations, and exports `onRequestError` to capture errors from Server Components, route handlers, and middleware." "If you're already logging with another library, use an integration to capture those logs as Sentry Logs automatically: … Pino"
- **Justification:** Task 2 step 3, Task 4.

### [C22] — Neon: Prisma ORM 7 setup (pinned versions, two connection strings, no `url` in schema)

- **Relevant File(s):** `prisma/schema.prisma`, `prisma.config.ts`, `server/db/client.ts`, `package.json`
- **Change Summary:** Pin Prisma 7 with `@prisma/adapter-neon`, use pooled + direct strings, keep the URL out of the schema.
- **Source URL:** https://neon.com/docs/guides/prisma#step-1-install-dependencies
- **Verbatim Quote:**

  > "This guide uses Prisma ORM 7. Install the `prisma` CLI, `@prisma/client`, and `@prisma/adapter-neon` at the same major version (`@7`). The `prisma` package's `latest` npm tag currently points to a Prisma 8 prerelease, so an unpinned `npm install prisma` installs a CLI that doesn't match the rest of this setup." "In Prisma 7+, do not include a `url` property in the datasource block. The connection is configured via `prisma.config.ts` and the adapter." "**Direct (unpooled) connection (`DATABASE_URL_UNPOOLED`)**: Prisma CLI commands like `prisma migrate` and `prisma db push` need a direct connection for schema operations."
- **Justification:** Task 3, §6, §7.

### [C23] — Prisma 7 config reference: `datasource.url`, `migrations.seed`, `directUrl` removed

- **Relevant File(s):** `prisma.config.ts`, `package.json`
- **Change Summary:** Configure migrations path, seed command, and the CLI datasource URL in `prisma.config.ts`.
- **Source URL:** https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference#datasourceurl
- **Verbatim Quote:**

  > "export default defineConfig({ schema: "prisma/schema.prisma", migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts", }, datasource: { url: env("DATABASE_URL"), }, });" "The `datasource.directUrl` property has been removed in Prisma ORM v7 in favor of the `url` property." "Environment variables from `.env` files need to be loaded explicitly."
- **Justification:** Task 3 step 1 (with `process.env` instead of `env()`, see `[C62]`).

### [C24] — Neon CLI: `neon branches create` and `list`

- **Relevant File(s):** Task 1 step 1, §6, Task 10
- **Change Summary:** Create the `dev` branch without printing its connection string.
- **Source URL:** https://neon.com/docs/cli/branches#create
- **Verbatim Quote:**

  > "Creates a branch in a Neon project. neon branches create [options]" "Omit the connection string from the output, keeping it out of terminal scrollback and CI logs: neon branches create --no-secrets"
- **Justification:** PR #1 remaining task #1.

### [C25] — Neon: Vercel preview branch cleanup via GitHub Action

- **Relevant File(s):** `.github/workflows/neon-cleanup.yml`
- **Change Summary:** Delete `preview/<branch>` when a PR closes; low-activity projects never auto-clean.
- **Source URL:** https://neon.com/docs/guides/vercel-branch-cleanup#github-action-on-pr-close-recommended
- **Verbatim Quote:**

  > "Neon's [`delete-branch-action`](https://github.com/neondatabase/delete-branch-action) deletes a Neon branch by name. Add this workflow to your repository to clean up the preview branch as soon as a PR is closed or merged:" `- uses: neondatabase/delete-branch-action@v3 with: project_id: ${{ vars.NEON_PROJECT_ID }} branch: preview/${{ github.head_ref }} api_key: ${{ secrets.NEON_API_KEY }}` "This workflow requires a `NEON_PROJECT_ID` repository variable and a `NEON_API_KEY` repository secret." "In particular, a project with fewer than about 20 preview deployments may never auto-delete any preview branch, because every preview stays within the last-20 set."
- **Justification:** Task 1 step 3.

### [C26] — GitHub Actions `actions/setup-node`: usage

- **Relevant File(s):** `.github/workflows/ci.yml`
- **Change Summary:** Pin Node 26 in CI with npm caching.
- **Source URL:** https://github.com/actions/setup-node#usage
- **Verbatim Quote:**

  > "- uses: actions/setup-node@v7 with: # Version Spec of the version to use in SemVer notation. … node-version: ''"
- **Justification:** Task 1 step 2.

### [C27] — Vercel: how cron jobs are triggered

- **Relevant File(s):** `vercel.json`, `app/api/cron/reconcile-uploads/route.ts`
- **Change Summary:** Define the schedule in `vercel.json`; Vercel issues GET requests to the production URL.
- **Source URL:** https://vercel.com/docs/cron-jobs#how-cron-jobs-work
- **Verbatim Quote:**

  > "To trigger a cron job, Vercel makes an HTTP GET request to your project's production deployment URL, using the `path` provided in your project's `vercel.json` file." "The timezone is always UTC"
- **Justification:** Task 9.

### [C28] — Vercel: securing cron jobs, idempotency, no retries

- **Relevant File(s):** `app/api/cron/reconcile-uploads/route.ts`, `WebhookEvent`
- **Change Summary:** Bearer `CRON_SECRET` check; every reconcile step idempotent.
- **Source URL:** https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
- **Verbatim Quote:**

  > "It is possible to secure your cron job invocations by adding an environment variable called `CRON_SECRET` to your Vercel project. … The value of the variable will be automatically sent as an `Authorization` header when Vercel invokes your cron job." "Cron delivery can also occasionally invoke the same scheduled run more than once. Because of this, cron jobs should be resilient to both missed runs and duplicate runs." "Vercel will not retry an invocation if a cron job fails."
- **Justification:** Task 9 step 2.

### [C29] — Vercel: cron frequency limits by plan

- **Relevant File(s):** `vercel.json`, Task 0 step 3
- **Change Summary:** A 10-minute cron needs Pro; Hobby allows once per day.
- **Source URL:** https://vercel.com/docs/cron-jobs/usage-and-pricing#hobby-scheduling-limits
- **Verbatim Quote:**

  > "| Hobby | 100 cron jobs | Once per day | Per-hour (±59 min) | | Pro | 100 cron jobs | Once per minute | Per-minute |" "Hobby accounts are limited to cron jobs that run once per day. Cron expressions that would run more frequently will fail during deployment."
- **Justification:** §0 assumption 2, Task 9.

### [C30] — Vercel Blob: private stores, server uploads, size limit

- **Relevant File(s):** `integrations/vercel-blob/index.ts`, Task 5 step 1
- **Change Summary:** Private store; function body limit is why uploads go browser → Blob.
- **Source URL:** https://vercel.com/docs/vercel-blob/server-upload#create-a-blob-store
- **Verbatim Quote:**

  > "vercel blob create-store Images --access private --yes" "Vercel has a 4.5 MB request body size limit on Vercel Functions. If you need to upload larger files, use client uploads." "`BLOB_READ_WRITE_TOKEN`: A long-lived static read-write token … To use these Environment Variables locally, we recommend pulling them with the Vercel CLI: vercel env pull"
- **Justification:** Task 5 step 1 (pull to a temp file, see `[C3]`).

### [C31] — Vercel Blob: client uploads (browser → Blob, token exchange, callback)

- **Relevant File(s):** `app/share/*`, `app/api/upload/route.ts`, `lib/upload-ticket.ts`
- **Change Summary:** Upload large files directly from the browser; authorize in `onBeforeGenerateToken`; record in `onUploadCompleted` as a backstop; tunnel for local callback testing.
- **Source URL:** https://vercel.com/docs/vercel-blob/client-upload#create-a-client-upload-route
- **Verbatim Quote:**

  > "When you need to upload files larger than 4.5 MB, you can use client uploads. The file goes directly from the browser to Vercel Blob, secured by a token exchange between your server and Vercel Blob." "You must authenticate and authorize users in the `onBeforeGenerateToken` callback of your server route before generating a client token. Without authentication, anyone can upload files to your Blob store." "When running your application locally, the `onUploadCompleted` callback will not work as Vercel Blob cannot contact your localhost. Instead, we recommend you run your local application through a tunneling service like [ngrok](https://ngrok.com/) … `VERCEL_BLOB_CALLBACK_URL=https://abc123.ngrok-free.app`"
- **Justification:** Task 7 steps 4–7.

### [C33] — Cloudflare: creating DNS records via the API

- **Relevant File(s):** `scripts/dns-setup.ts`
- **Change Summary:** Create the SendGrid records programmatically with the DNS-only token.
- **Source URL:** https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/#create-dns-records
- **Verbatim Quote:**

  > "To create records with the API, use a POST request. For field definitions, select a record type under the request body specification." "**Proxy status**: For `A`, `AAAA`, and `CNAME` records, decide whether hostname traffic is proxied through Cloudflare."
- **Justification:** Task 6 step 3.

### [C34] — Cloudflare Tunnel: Quick Tunnels for local callback testing only

- **Relevant File(s):** Task 7 step 7
- **Change Summary:** Temporary public URL for the Blob callback against `next dev`; never stored persistently.
- **Source URL:** https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/#limitations
- **Verbatim Quote:**

  > "Quick Tunnels are for testing and development. For production, create a Cloudflare Tunnel." "The hostname changes each time you create a Quick Tunnel."
- **Justification:** Local testing only.

### [C35] — SendGrid: Node.js quickstart (key scope, sender identity, `@sendgrid/mail`, 202)

- **Relevant File(s):** `integrations/sendgrid/client.ts`
- **Change Summary:** Mail Send-only key, authenticated sender, SDK usage.
- **Source URL:** https://www.twilio.com/docs/sendgrid/for-developers/sending-email/quickstart-nodejs#create-and-store-a-sendgrid-api-key
- **Verbatim Quote:**

  > "For this tutorial, create a Restricted Access API key with **Mail Send** > **Full Access** permissions only." "we require customers to verify their Sender Identities by completing Domain Authentication." "npm install --save @sendgrid/mail" "If you receive a `202` status code printed to the console, your message was sent successfully."
- **Justification:** Task 5 step 5, Task 8 step 2.

### [C36] — SendGrid: domain authentication DNS records

- **Relevant File(s):** `scripts/dns-setup.ts`
- **Change Summary:** Add the four generated records at Cloudflare using host labels only.
- **Source URL:** https://www.twilio.com/docs/sendgrid/ui/account-and-settings/how-to-set-up-domain-authentication#dns-resource-records-that-twilio-sendgrid-generates
- **Verbatim Quote:**

  > "If you turned on **Use automated security**, the first step on the **Install DNS Records** page displays four DNS resource records. - One `CNAME` record that points mail from your branded URL to the Twilio SendGrid email service and supports SPF and DKIM. … - Two `CNAME` records that point servers that support link branding. … - One `TXT` record that provides the DMARC record." "If you see this incorrect `CNAME` value, type only the *hostname* value into your DNS provider `CNAME` field. In this example, the host value is `em123`." "DNS verification can take *up to 48 hours after upload*."
- **Justification:** Task 6 steps 2–4.

### [C38] — Vercel `vercel.json`: `buildCommand` and `crons`

- **Relevant File(s):** `vercel.json`, `package.json`
- **Change Summary:** Run `prisma migrate deploy` and the seed in the Vercel build while `npm run build` stays database-free for CI; define the reconcile cron.
- **Source URL:** https://vercel.com/docs/project-configuration/vercel-json#buildcommand
- **Verbatim Quote:**

  > "The `buildCommand` property can be used to override the Build Command in the Project Settings dashboard, and the `build` script from the `package.json` file for a given deployment." "Used to configure [cron jobs](https://vercel.com/docs/cron-jobs) for the production deployment of a project."
- **Justification:** Task 3 step 8, Task 9.

### [C56] — Next.js: verify authorization inside Server Functions

- **Relevant File(s):** `app/share/actions.ts`, `app/m/[claimToken]/actions.ts`
- **Change Summary:** The upload ticket and claim token are checked inside each Server Function, not in a proxy.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/proxy#execution-order
- **Verbatim Quote:**

  > "Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone."
- **Justification:** Task 7 step 3, Task 8 step 3.

### [C57] — jowray_com `docs/domain.md` (branch `docs/custom-domain`, `3d75559`): primary host, redirects, existing records, token scope

- **Relevant File(s):** §0, §0.1, §2, Tasks 0, 5, 6, 8, §7
- **Change Summary:** Use `https://www.jowray.com` for every absolute URL; verify rather than recreate the Vercel records; take the zone id from here; add only email records.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/docs/custom-domain/docs/domain.md
- **Verbatim Quote:**

  > "| `https://www.jowray.com` | **Primary.** Serves the `jowray.com` Vercel project's production deployment. | | `https://jowray.com` | 308 to `https://www.jowray.com`, with the path and query string kept. |" "The `jowray.com` zone (`dad5b9fdb1ece5afc4a4224f61a51770`) uses the `beth`/`koa.ns.cloudflare.com` nameservers." "**Keep these records DNS only (grey cloud).**" "`CLOUDFLARE_DNS_ONLY_API_TOKEN` in `.env` is an **account-owned** token: - `GET /accounts/{CLOUDFLARE_ACCOUNT_ID}/tokens/verify` succeeds, but the user-token endpoint `/user/tokens/verify` rejects it." "- **Email DNS.** The zone has no MX, SPF, DKIM, or DMARC records. Add them when SendGrid sending is set up" "- **Absolute URLs in code.** … When it does (Open Graph `metadataBase`, magic-link callbacks, SMS reply links), use `https://www.jowray.com`."
- **Justification:** Closes review findings #1 and #14; Task 6 scope.

### [C58] — Next.js 16.4.4 bundled docs: migrating to Cache Components (`dynamic = "force-dynamic"`, request-time data)

- **Relevant File(s):** `AGENTS.md` code-layout rule, `app/m/[claimToken]/page.tsx`, all route handlers
- **Change Summary:** Remove segment config exports; wrap request-time reads in `<Suspense>`.
- **Source URL:** `node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md` (next@16.4.4)
- **Verbatim Quote:**

  > "## `dynamic = \"force-dynamic\"` **Remove the config.** Without Cache Components, `dynamic = 'force-dynamic'` rendered the entire route for every request and made its `fetch` requests uncached. With Cache Components, uncached data and [Request-time APIs] already run at request time. Next.js prerenders any static or cached UI around them." "## `cookies`, `headers`, and `searchParams` **Wrap runtime data access in `<Suspense>`.** … Move the access into a component wrapped in `<Suspense>` so the rest of the page prerenders as a static shell and the dynamic part streams in at request time." "Fix synchronous IO. It can't be deferred. Calls like `new Date()`, `Date.now()`, `Math.random()`, and `crypto.randomUUID()` during prerender throw a build error … wrap the part that needs it in [`<Suspense>`] and call [`connection()`] before the call"
- **Justification:** Task 2 step 1; closes review findings #4 and #15.

### [C59] — Next.js 16.4.4 bundled docs: `runtime` segment config under Cache Components

- **Relevant File(s):** all route handlers, Task 4 step 1
- **Change Summary:** No `runtime` export, including `'nodejs'`; the Edge runtime is deprecated, so no `sentry.edge.config.ts`.
- **Source URL:** `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/runtime.md` (next@16.4.4)
- **Verbatim Quote:**

  > "- The Edge Runtime is deprecated. Remove the `runtime` export from your route files." "- When [Cache Components] is enabled, remove the `runtime` export, including `runtime = 'nodejs'`. Cache Components uses the default Node.js runtime and does not support the `runtime` route segment config."
- **Justification:** Task 2 step 1, Task 4 step 1.

### [C60] — Sentry JavaScript SDK: migrate from 10.x to 11.x

- **Relevant File(s):** `instrumentation.ts`, `next.config.ts`, `package.json`
- **Change Summary:** Target v11; set `dataCollection` explicitly; import `withSentryConfig` from `@sentry/nextjs/config`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/migration/v10-to-v11/ and https://github.com/getsentry/sentry-javascript/blob/develop/MIGRATION.md
- **Verbatim Quote:**

  > "**Data collection:** `sendDefaultPii` is replaced by `dataCollection`, which controls each category of data separately and collects more by default" "This is a behavior change, not a rename. In v10, an unset `sendDefaultPii` was restrictive. | Category | v10 default (`sendDefaultPii` off) | v11 default | | `userInfo` | `false` | `true` | | `cookies` | not collected | `true` | | `urlQueryParams` | `true` | `true` | | `databaseQueryData` | `false` | `true` |" "Set the baseline explicitly. **Don't leave `dataCollection` unset** — that now enables broader collection." "`withSentryConfig` and the `SentryBuildOptions` type moved to the `@sentry/nextjs/config` entry point and are no longer exported from `@sentry/nextjs`"
- **Justification:** Task 4; closes review findings #9, #32, #40. npm `dist-tags.latest` for `@sentry/nextjs` was `11.10.0` on 2026-11-02.

### [C61] — Prisma ORM v7: generators (`prisma-client` default, `output` required, `prisma-client-js` deprecated)

- **Relevant File(s):** `prisma/schema.prisma`, `server/db/client.ts`, `.gitignore`, `package.json`
- **Change Summary:** Use the default generator with an explicit output path and `dotenv`.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators
- **Verbatim Quote:**

  > "The default generator for Prisma Client is `prisma-client`, which outputs plain TypeScript code and _requires_ a custom `output` path" "- Requires an `output` path; no "magic" generation into `node_modules` any more - Doesn't load `.env` at runtime; use `dotenv` or set environment variables manually instead" "import { PrismaClient } from \"./generated/prisma/client\";" "**If you use `tsx` as your TypeScript runner** and see `Cannot find module './internal/class.js'` errors at runtime, set `importFileExtension = \"ts\"` in your generator block" "The `prisma-client-js` generator is deprecated."
- **Justification:** Task 3 steps 1–2; closes review findings #6 and #39. npm: `@prisma/client@7.10.1`, `prisma@8.0.0-rc.29` is `latest` on 2026-11-02.

### [C62] — Prisma ORM v7 config reference: optional environment variables and `prisma generate`

- **Relevant File(s):** `prisma.config.ts`, `.github/workflows/ci.yml`
- **Change Summary:** Use `process.env` in `prisma.config.ts` so `prisma generate` works without a database URL.
- **Source URL:** https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference (section "Handling optional environment variables")
- **Verbatim Quote:**

  > "- Commands like `prisma generate` don't need a database URL, but will still fail if `env()` throws an error when loading the config file"
- **Justification:** Task 1 step 2 ("build must never need a database"), Task 3 step 1.

### [C63] — `@vercel/blob@2.8.2` source: how the `onUploadCompleted` callback URL is chosen

- **Relevant File(s):** `app/api/upload/route.ts`, Task 5 step 1, §2
- **Change Summary:** Set `VERCEL_BLOB_CALLBACK_URL` in Production; treat the callback as a backstop.
- **Source URL:** npm `@vercel/blob@2.8.2`, `dist/client.js`, function `getCallbackUrl`
- **Verbatim Quote:**

  > `if (process.env.VERCEL_BLOB_CALLBACK_URL) { return \`${process.env.VERCEL_BLOB_CALLBACK_URL}${reqPath}\`; }` … `if (process.env.VERCEL_ENV === "preview") { if (process.env.VERCEL_BRANCH_URL) { return \`https://${process.env.VERCEL_BRANCH_URL}${reqPath}\`; } … }` `if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) { return \`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}${reqPath}\`; }`
- **Justification:** §2 rationale; closes the Blob half of review finding #1.

### [C64] — Vercel: `VERCEL_PROJECT_PRODUCTION_URL`

- **Relevant File(s):** Task 5 step 1, §2
- **Change Summary:** The default callback host is the shortest custom domain, i.e. the redirecting apex.
- **Source URL:** https://vercel.com/docs/environment-variables/system-environment-variables#VERCEL_PROJECT_PRODUCTION_URL
- **Verbatim Quote:**

  > "A production domain name of the project. We select the shortest production custom domain, or vercel.app domain if no custom domain is available."
- **Justification:** With `jowray.com` and `www.jowray.com` both attached, the shortest is the apex `[C57]`.

### [C65] — Gemini API Additional Terms of Service (effective 2026-03-23): Unpaid vs Paid Services, age requirement

- **Relevant File(s):** §0.1 decisions, §9, §11 #1, `docs/environment.md`
- **Change Summary:** Phase 2 must use a key from a Cloud project with active billing; the 18+ clause is a Phase 2 decision.
- **Source URL:** https://ai.google.dev/gemini-api/terms (redirects to https://aistudio.google.com/docs/terms)
- **Verbatim Quote:**

  > "You must be 18 years of age or older to use the APIs. You also will not use the Services as part of a website, application, or other service (collectively, "**API Clients**") that is directed towards or is likely to be accessed by individuals under the age of 18." "When you use Unpaid Services, including, for example, Google AI Studio and the unpaid quota on Gemini API, Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services and machine learning technologies" "**Do not submit sensitive, confidential, or personal information to the Unpaid Services.**" "Your access to Gemini API is a "Paid Service" only when accessing the API through a Cloud Project associated with an active billing account." "When you use Paid Services, … Google doesn't use your prompts … or responses to improve our products"
- **Justification:** Rob's decision of 2026-11-02 to provision a billed project; §11 #1.

### [C66] — Gemini Interactions API: data storage and retention

- **Relevant File(s):** §9, §11 #1
- **Change Summary:** Phase 2 passes `store: false`.
- **Source URL:** https://ai.google.dev/gemini-api/docs/interactions-overview
- **Verbatim Quote:**

  > "By default, the Interactions API stores requests so you can leverage the server-side state management features by using `previous_interaction_id`." "By default, the API stores all Interaction objects (`store=true`) in order to simplify use of server-side state management features (with `previous_interaction_id`), background execution (using `background=true`) and observability purposes."
- **Justification:** Recorded for Phase 2.

### [C67] — VoIP.ms wiki: SMS/MMS URL callback variables and retry (deferred phase)

- **Relevant File(s):** §9, §11 #5
- **Change Summary:** Facts for a later SMS phase; conflicts with the API-reference copy in `AvaTinCan/docs`.
- **Source URL:** https://wiki.voip.ms/article/SMS-MMS
- **Verbatim Quote:**

  > "**Example**: https://YourDomainName.tld/sms.php?to={TO}&from={FROM}&message={MESSAGE}&id={ID}&date={TIMESTAMP} **{ID}** = The ID of the SMS message. **{TIMESTAMP}** = The date and time the message was received. **{FROM}** = The phone number that sent you the message. **{TO}** = The DID Number that received the message. **{MESSAGE}** = The content of the message. **{MEDIA}** = Comma-separated list of media files." "- **URL Callback Retry**: When selected, we will be expecting an "ok" output (without quotes) from your URL callback page as an indicator that you have received the message correctly. If we don't received the "ok" (without quotes) from your callback page, we will keep sending you the same message every 30 minutes."
- **Justification:** §9.

### [C68] — VoIP.ms wiki: API authentication (deferred phases)

- **Relevant File(s):** §9, §11 #5
- **Change Summary:** No bearer scheme; IP enablement is mandatory.
- **Source URL:** https://wiki.voip.ms/article/API_Overview
- **Verbatim Quote:**

  > "Every API request requires two parameters: - `api_username` — the email address used to log in to your VoIP.ms account - `api_password` — the API-specific password set in the portal (not your portal login password) Requests must also originate from a whitelisted IP address. **Both conditions must be met for a request to succeed.**"
- **Justification:** Removes revision 1's D1 option (a); §9.

### [C69] — VoIP.ms API reference (third-party mirror, **unverified**): `markListenedVoicemailMessage` moves messages between folders (deferred phase)

- **Relevant File(s):** §9, §11 #5
- **Change Summary:** Voicemail identity must not use `folder`/`message_num`. Confirm against the official reference before use.
- **Source URL:** https://ixiteam.com/voip/ (mirror; the official `voip.ms/m/apidocs.php` needs an interactive session)
- **Verbatim Quote:**

  > "markListenedVoicemailMessage - Mark a Voicemail Message as Listened or Unlistened. - If value is 'yes', the voicemail message will be marked as listened and will be moved to the Old Folder. - If value is 'no', the voicemail message will be marked as not-listened and will be moved to the INBOX Folder."
- **Justification:** §9; reconcile when the phone-line phase starts.

### [C70] — Vercel: Protection Bypass for Automation

- **Relevant File(s):** §8 (preview callbacks)
- **Change Summary:** Preview Blob callbacks are behind Deployment Protection; the plan does not depend on them, but the bypass header exists if ever needed.
- **Source URL:** https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
- **Verbatim Quote:**

  > "x-vercel-protection-bypass: your-generated-secret"
- **Justification:** §8 risk note.

### [C71] — Twilio SendGrid: retirement of the Free plan; 60-day trial for new accounts

- **Relevant File(s):** Task 0 step 4, Task 10 gates, §7, §8
- **Change Summary:** SendGrid readiness is a Task 0 gate, because an account without a paid plan or inside an ended trial cannot send.
- **Source URL:** https://www.twilio.com/en-us/changelog/sendgrid-free-plan and https://support.sendgrid.com/hc/en-us/articles/35270136965403-Overview-of-60-Day-Free-Trial-Plans-for-New-SendGrid-Accounts
- **Verbatim Quote:**

  > "Twilio SendGrid will be retiring its Free Email API and Free Marketing Campaigns plan starting May 27, 2025." "After the 60 day trial period, email send via any web API or SMTP integration for the account will stop unless an appropriate "Email API" plan …"
- **Justification:** Closes revision 2 review finding F1.

### [C72] — iOS Safari `MediaRecorder` formats (WebM/Opus from 18.4; `audio/mp4` before)

- **Relevant File(s):** `app/share/recorder.ts`, `lib/media-types.ts`, Task 10
- **Change Summary:** Feature-detect the recording MIME type and allow iPhone defaults.
- **Source URL:** https://www.testmuai.com/learning-hub/mediarecorder-browser-support/ and https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static
- **Verbatim Quote:**

  > "WebKit shipped WebM recording in Safari 18.4 on macOS Sequoia 15.4, iOS 18.4, and iPadOS 18.4, all released in March 2025, using the Opus audio codec with VP8 or VP9 for video. On those versions, _MediaRecorder.isTypeSupported('audio/webm;codecs=opus')_ returns true." "MediaRecorder.isTypeSupported(mimeType)"
- **Justification:** Closes revision 2 review finding F3; before 18.4, Safari's recorder produced `audio/mp4` only.

### [C73] — Next.js 16.4.4 bundled docs: `maxDuration` and Server Actions

- **Relevant File(s):** Task 2 step 1, Task 7 step 6, §10
- **Change Summary:** Server Functions inherit the hosting page's `maxDuration`; keep `finalizeUpload()` short and hash in the background.
- **Source URL:** `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md` (next@16.4.4)
- **Verbatim Quote:**

  > "The `maxDuration` option allows you to set the maximum execution time (in seconds) for server-side logic in a route segment." "If using [Server Actions], set the `maxDuration` at the page level to change the default timeout of all Server Actions used on the page."
- **Justification:** Revision 2 review finding F7; Rob chose the background checksum.

### [C74] — Next.js 16.4.4 CLI docs: `next typegen` before `tsc --noEmit`

- **Relevant File(s):** `package.json` (`type-check`), §0.2 worktree provisioning, Task 2a step 1
- **Change Summary:** Type-check in fresh worktrees and CI without a build; the scaffold already depends on the generated `LayoutProps` global and on the gitignored `next-env.d.ts`.
- **Source URL:** `node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md` (next@16.4.4), section "`next typegen` options"
- **Verbatim Quote:**

  > "`next typegen` generates TypeScript definitions for your application's routes without performing a full build. This is useful for IDE autocomplete and CI type-checking of route usage." "next typegen && tsc --noEmit"
- **Justification:** Closes revision 3 review findings C3, P1, O4; repo evidence: `app/layout.tsx` uses `LayoutProps<"/">`, `.gitignore` lists `next-env.d.ts`, `tsconfig.json` includes `.next/types/**/*.ts`.

### [C75] — Next.js 16.4.4 bundled docs: `io()` and `connection()` under Cache Components

- **Relevant File(s):** Task 2b step 2 (house rule), Tasks 8, 9
- **Change Summary:** Request-time reads (or `await io()`) come before any data access in dynamic components and `GET` handlers.
- **Source URL:** `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/connection.md` and `io.md` (next@16.4.4)
- **Verbatim Quote:**

  > "With Cache Components, prefer `io()` for excluding content from the static shell. It works the same way but can also be cached and prefetched. Reach for `connection()` only when rendering should wait for a real user request."
- **Justification:** Revision 3 review finding P6.

### [C76] — Next.js 16.4.4 bundled docs: `next/font/google` downloads at build time

- **Relevant File(s):** `app/layout.tsx`, Task 2a install (`geist`), Task 2b step 1, §0.2 worker checks
- **Change Summary:** Offline worker builds fail on the scaffold's Google-hosted font; swap to the `geist` package.
- **Source URL:** `node_modules/next/dist/docs/01-app/03-api-reference/02-components/font.md` (next@16.4.4)
- **Verbatim Quote:**

  > "You can also conveniently use all [Google Fonts](https://fonts.google.com/). CSS and font files are downloaded at build time and self-hosted with the rest of your static assets. **No requests are sent to Google by the browser.**"
- **Justification:** Revision 3 review finding O2; repo evidence: `app/layout.tsx` imports `Geist, Geist_Mono` from `next/font/google`.

### [C77] — Next.js 16.4.4 bundled docs: default `serverExternalPackages`

- **Relevant File(s):** `next.config.ts`, Task 2a step 3, §10
- **Change Summary:** No `serverExternalPackages` entry for Pino; it is already externalized by default.
- **Source URL:** `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md` (next@16.4.4)
- **Verbatim Quote:**

  > "- `pino` - `pino-pretty` - `pino-roll`" (in the list of packages Next.js externalizes by default)
- **Justification:** Revision 3 review finding P5.

### [C78] — `@vercel/blob@2.8.2` source: `x-content-type` is sent only when `contentType` is passed

- **Relevant File(s):** Task 7 step 4 (`upload()` call), TDD list
- **Change Summary:** Pass `contentType: ticket.mimeType` to `upload()`; otherwise the store derives the type from the pathname's extension and the exact `allowedContentTypes` match fails for audio recordings.
- **Source URL:** npm `@vercel/blob@2.8.2`, `dist/chunk-XKVPKJPO.js` (`createPutHeaders`) and `dist/client.d.ts` (`upload` options)
- **Verbatim Quote:**

  > `contentType: "x-content-type",` (header map; the header is added only when `options.contentType` is set) "contentType - (Optional) … By default, it's extracted from the pathname's extension."
- **Justification:** Revision 3 review findings P2 and S21.