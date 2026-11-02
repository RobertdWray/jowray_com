# Bootstrap completion report (2026-11-02)

This is the **authoritative final record** of the jowray_com bootstrap. It supersedes the STATUS and ledger in [2026-11-02-bootstrap.md](2026-11-02-bootstrap.md), which is a snapshot taken at step P7, before the initial commit. That snapshot's ledger timestamps for P0–P7 were estimates; the timeline below uses the actual times (EST), taken from file mtimes, the commit time, and the deployment time.

No secret values appear in this file. The Sentry DSN and the Neon project ID (`icy-scene-20351172`) are included because neither is a secret: a DSN is public by design, and the project ID is a resource identifier that also appears in dashboard URLs.

## Resources

| Resource | Details |
|---|---|
| GitHub | https://github.com/RobertdWray/jowray_com · **private** · default branch `main` |
| Vercel project | https://vercel.com/rob-wrays-projects/jowray.com · project ID `prj_UWoR1IGnShoagieZphn2aXOnGSfm` · team `rob-wrays-projects` (`team_KcheaXYZlslwXKrG5iksYEhL`) · framework Next.js · Node 26.x · function region `iad1` |
| Vercel ↔ GitHub | Connected to `RobertdWray/jowray_com` (repoId 1443406794), production branch `main`. `vercel link` connected it automatically. |
| Production | **https://jowraycom.vercel.app** · first production deployment `dpl_CkUXmx1QW9ri7gRsGEkmA9MEUScd` (https://jowray-230mfosjc-rob-wrays-projects.vercel.app), Ready, 21s build |
| Neon | Project `icy-scene-20351172` ("jowray_com") · org `org-dark-band-75525913` (Vercel-managed) · `aws-us-east-1` · Postgres 18.6 · database `neondb` · default branch `main` (`br-restless-king-bbmkh5zd`) · Vercel store `store_KzH45pGPheSIkff4`, installation `icfg_M8cvXcej62HPfgUntjEVAbX6`, billing plan Scale (`scale_v3`) |
| Neon state | **Empty**: 0 user tables. **Neon Auth off**: the API returns "not enabled" and there's no `neon_auth` schema. Realtime is off. |
| Neon env in Vercel | 16 variables in Production, Preview, and Development: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`, `NEON_PROJECT_ID`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_DATABASE` |
| Sentry | https://med3ai.sentry.io/projects/jowray_com/ · slug `jowray_com` · id `4512363870158848` · platform `javascript-nextjs` · team `med3ai` · default alert rules on · API host `https://us.sentry.io` |
| Sentry DSN | `https://7a83f406f32f8a009d1980828d01c565@o4508092137865216.ingest.us.sentry.io/4512363870158848` (stored in `.env` as `NEXT_PUBLIC_SENTRY_DSN`) |

## Commits

| Item | Value |
|---|---|
| Initial commit | `f0cd5aa9e280e5d85804f7c95fae67b688f5feba`: "Initial commit: Next.js 16 scaffold, Neon driver, project docs" |
| Tree | `9a9a8a21eb525b0f254577cd4ba119c684761184` |
| File-list hash of `f0cd5aa` | `796b9063e61a4bc414f9dea5e9bfe7099402e255cb3ac6dc5ea7fde18048ecca` (20 files). Reproduce with `git ls-tree -r --name-only f0cd5aa \| shasum -a 256`; this works after later commits too. |
| `package-lock.json` sha256 | `784f51b9290e050688f0a14cc97c14bfb6c01b057253f0e6ef98a8687ee07bf5`. The committed file matches the one installed in P4. |
| Local vs. remote | At push time (P16), `git ls-remote origin refs/heads/main` = local `main` = `f0cd5aa9…` |

## Checks

- `npm run lint`: exit 0.
- `npm run build`: exit 0. "Next.js 16.4.4 (Turbopack)", Cache Components and Partial Prefetching enabled, `/` and `/_not-found` static.
- Production deployment: **Ready**. `curl https://jowraycom.vercel.app/` returned **200**, page title "Create Next App". The per-deployment URL returns 302, from Vercel Deployment Protection (expected).
- Dependencies: `next@16.4.4`, `react@19.3.0`, `@neondatabase/serverless@1.2.0` (exact).
- `npm audit`: 16 moderate, all in dev-only ESLint tooling, from one transitive `minimatch` advisory. `npm audit --omit=dev` gives **0**. See remaining task 8.

## Secret hygiene

- `.env` is gitignored and untracked (`git ls-files -- '.env*'` is empty, and `git check-ignore .env` passes). `.env.local` (holding only `VERCEL_OIDC_TOKEN`) and `.vercel/` are ignored as well.
- Before the initial commit, every `.env` value of 8+ characters was grepped against the staged files, compared without printing, along with common token patterns: **0 hits**.
- `.env`: **37 keys, 0 duplicates, mode 600**. That's 17 pre-existing keys, plus 16 Neon integration keys, plus 4 more: `NEXT_PUBLIC_SENTRY_DSN` (set) and the empty placeholders `GEMINI_API_KEY`, `SENTRY_AUTH_TOKEN`, `AUTH_SECRET`. The 17 pre-existing keys were fingerprinted before and after the merge, and the fingerprints match (`259f18b6c8dc6fd8`), so their values are unchanged.
- The merge was append-only, under an explicit ownership handoff from the VoIP.ms agent. It used an exact allowlist of the 16 integration keys, so `VERCEL_OIDC_TOKEN` and any other system variables were skipped.
- The Sentry project was created with a personal admin token read from its existing file, used once, and unset. It was never copied into this repo or this `.env`. `SENTRY_AUTH_TOKEN` here is an empty placeholder.
- No temp files remain: the scaffold temp folder and the pulled-env temp file were both deleted and verified.

## Doc preservation

`docs/Memorial Memories Site initial thinking.md` sha256 is `8634015b4af3870d4930c7507193a6494b8774c6a68990751e63a5b70716d49b`. It's unchanged from before the move.

## CLI versions

node v26.13.0 · npm 11.20.0 · vercel 65.9.0 (pnpm global; upgraded from 65.2.0) · neon 8.16.0 (Homebrew; already current) · gh 2.103.3 · git 2.56.0 · create-next-app 16.4.4

## Preview branching

**State: verified.** Neon's documented test was run on this PR: push a feature branch, then check the Vercel deployments and the Neon branches.

- PR #1's push of `docs/bootstrap-report` triggered Vercel Preview deployment `dpl_5LUDrXQyJwZEh8DY6LxuRqQiiccG` (https://jowray-t00nujlvl-rob-wrays-projects.vercel.app, alias `jowraycom-git-docs-bootstrap-report-rob-wrays-projects.vercel.app`). It was created at 15:17:47 and is **Ready**. The GitHub "Vercel" check passed.
- Neon created branch **`preview/docs/bootstrap-report`** (`br-orange-rice-bbil7ivy`) in `icy-scene-20351172` at 15:17:48, with `creation_source: vercel`, parent `main` (`br-restless-king-bbmkh5zd`), state `ready`.
- Later pushes to the same Git branch **reused** that Neon branch instead of creating a new one. For example, `6a0117b` produced preview deployment `dpl_89BC32kp9ckpgKM8fotRtSf9Zt3m` (Ready at 15:27:18), and Neon still lists exactly one `preview/` branch.
- **Cleanup caveat:** with the Vercel-managed integration, a preview branch is deleted only when Vercel deletes its deployments. Merging or closing the PR doesn't do it. Vercel's retention exceptions keep the last 10 deployments, the last 20 Ready previews, and so on, and [Neon's cleanup guide](https://neon.com/docs/guides/vercel-branch-cleanup) warns that "a project with fewer than about 20 preview deployments may never auto-delete any preview branch." That applies to this project, so see remaining task 10.

- **How it was enabled:** at 15:15, through the Vercel dashboard (Claude-in-Chrome automation, approved by Rob). Path: Storage → `jowray_com` store → Projects → ⋮ `jowray.com` → **Update Project Connection** → "Create Database Branch For Deployment" → **Preview** ticked, **Production** unticked.
- **Why not the CLI or API:** no CLI or REST path can change deployment actions on an existing connection. `vercel integration resource connect` only takes `--environment`/`--prefix`. `POST /v1/integrations/installations/{id}/resources/{id}/connections` only accepts `projectId`, `envVarEnvironments`, and `makeEnvVarsSensitive`, and using it would be a reconnect. The Neon CLI has no Vercel commands.
- **Extra toggle:** this project's form greys out Preview until **"Require Active Resource Before Deploy"** is switched on. Neon's guide doesn't mention it. Rob approved enabling it. It may also make production deploys wait for the Neon resource to be active; that's inferred, not documented.
- **Stored state:** connection `spc_vG0lQJrfXKx8rFkh` has `deployments` = `{"actions":[{"environments":["preview"],"slug":"Neon"}],"required":true}`. Before, the key was absent. Same connection ID, so the update was in place. Environments are still production, preview, and development, the prefix is still none, and there are still 16 env vars.
- **Side effect:** Vercel's save rewrote the 16 database env var records (new timestamps). The values were re-pulled and compared with `.env`: **16/16 identical**.

## Timeline (actual, EST)

| Step | Time | Result |
|---|---|---|
| P0 cold start | 14:31 | All remote resources confirmed absent. `.env` has no duplicates. |
| P1 CLIs | 14:33 | vercel 65.9.0 |
| P2–P4 doc move, scaffold, deps | 14:34–14:38 | Verified |
| P5–P7 docs | 14:38–14:39 | Verified |
| P8 lint and build | 14:40 | Pass |
| P9 initial commit | 14:40 | `f0cd5aa` |
| P10 GitHub repo | 14:41 | Created, private |
| P11 Vercel project | 14:41 | Created and linked to GitHub |
| P12 Neon | 14:42 | Provisioned, empty |
| P14 Sentry | 14:43 | Created |
| P15 `.env` merge | 14:44–14:46 | Verified, `.env` released |
| P16 push and deploy | 14:46–14:47 | Ready, 200 |
| P13 preview branching | 14:44–15:15 | Enabled in the dashboard (Preview only) |
| P17 report PR and preview test | 15:17–15:27 | PR #1. Preview Ready, Neon branch `preview/docs/bootstrap-report` created |

## Decisions made during execution

Each entry gives what was decided, why, and the cost if it's wrong. Decisions 1–3 and 6 also appear in the runbook snapshot. Decisions 4, 5, and 7 were made after that snapshot was taken (step P7), so they're recorded only here.
1. **Node** now resolves to Homebrew v26.13.0 (the nvm v22 folder on PATH no longer exists). It meets every minimum, and the build passed. *Cost if wrong:* a Node 26 incompatibility, which lint and build would have caught.
2. **The Vercel CLI was upgraded with `pnpm add -g`**, because that's how it was installed. `npm i -g` would have added a second binary that shadows it on PATH. *Cost if wrong:* none; `which -a vercel` shows a single binary.
3. **There's no `postcss.config.mjs`.** The 16.4.4 template wires Tailwind through `@tailwindcss/turbopack` in `next.config.ts`. *Cost if wrong:* none; the allowlist permits paths but doesn't require them.
4. **`docs/voip_ms_262980_jowray-subaccount-settings.md` was kept out of the initial commit.** The concurrent VoIP.ms agent wrote it during the run. It contains no password, but it's someone else's work in progress. *Cost if wrong:* a one-file follow-up. Rob then asked for it to be added, and this PR does that (remaining task 9).
5. **The `.env` merge used an exact allowlist** of the 16 integration keys, instead of the plan's `VERCEL_*` skip. That skip wouldn't have caught other system variables such as `VERCEL`, `TURBO_*`, and `NX_DAEMON`. *Cost if wrong:* none; it's strictly narrower than the plan.
6. **`npm audit fix --force` was not run.** Its only "fix" downgrades to eslint@4, and the advisory is dev-only. *Cost if wrong:* a moderate ReDoS stays in lint tooling that only runs on trusted input (remaining task 8).
7. **The secret-value scan for this PR excludes `NEON_PROJECT_ID` and `NEXT_PUBLIC_SENTRY_DSN`**, because both are public identifiers. Every other `.env` value is still scanned. *Cost if wrong:* none; neither grants access.

## Remaining tasks (candidate issues: Bucket 4, plus anything not done)

1. Local development env vars point at the production (default) Neon branch. Adopt a branch-first dev flow, such as a `dev` Neon branch for local work.
2. Sentry SDK setup (`@sentry/nextjs` via the wizard), plus an **organization** auth token (`org:ci`) in Vercel for source-map uploads.
3. Protect `main` by requiring PRs and status checks.
4. A GitHub Actions CI workflow: lint, typecheck, build.
5. ~~Rename the `CLOUDFLARE_ACCOUNTT_ID` typo.~~ **Done in this PR, at Rob's request.**
   - The local `.env` key is now `CLOUDFLARE_ACCOUNT_ID`. The rename was atomic: the value hash and every other line are unchanged, the mode is still 600, there are still 37 keys and no duplicates.
   - `docs/environment.md` is updated.
   - The Vercel project never had this key. Nothing else under `~/Documents/active_work` references the old name, apart from the frozen P7 snapshot, which keeps it as history.
6. ~~Update the design doc's Twilio references to VoIP.ms.~~ **Done in this PR, at Rob's request.**
   - The voice-line, SMS-sequence, and tech-stack diagrams now name VoIP.ms: the SMS/MMS URL callback, `sendSMS`/`sendMMS`, and voicemail fetch.
   - A new "VoIP.ms" tech-stack note covers callback variables, the `ok` retry contract, voicemail retrieval, and one open question: API calls from Vercel versus the account's IP whitelist.
7. Optional upstream issue: the Next.js docs list `--turbopack`/`--webpack` for create-next-app, but 16.4.4 doesn't have them.
8. Track the dev-only `minimatch` advisory ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)) through an upstream `eslint-config-next`/`typescript-eslint` bump, or an `overrides` pin once that's compatible.
9. ~~Commit `docs/voip_ms_262980_jowray-subaccount-settings.md` through its own PR.~~ **Done in this PR, at Rob's request.** The file is added unchanged (sha256 `1e2dcad7…`, no password), and `docs/environment.md` links to it from `DID_JOWRAY`.
10. Clean up Neon preview branches when PRs close: add a GitHub Action using `neondatabase/delete-branch-action` on `pull_request: closed`, as [Neon's cleanup guide](https://neon.com/docs/guides/vercel-branch-cleanup) recommends. Otherwise, delete a PR's preview deployments after merge. Until then, `preview/docs/bootstrap-report` will persist.
11. Rob reviews and merges this PR.

## What we're not doing, and why (Bucket 3)

1. **Hand-listing files to stage in the initial commit.** A list of generated files breaks when the generator changes. A top-level allowlist plus index and secret checks gives the same protection.
2. **`--turbopack`/`--webpack` flags.** They don't exist in create-next-app 16.4.4, and unknown flags are silently ignored. Turbopack is the default, and the build output confirms it.
3. **An `npm ci` policy.** There were no later installs in the bootstrap. Vercel installs from the committed lockfile.
4. **Rewriting Rob's design doc beyond what he asks for.** It's Rob's "initial thinking" doc. He asked for the Twilio → VoIP.ms update, and that was made in this PR (remaining task 6). Nothing else in it was changed.
