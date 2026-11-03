# Phase 1 execution ledger

Authoritative record of what has already happened. Read every copy (main, open PR branches, `git log --all -- docs/plans/phase1-ledger.md`) before any external mutation (plan §0.1). The orchestrator commits and pushes a section immediately after each external change; workers never edit this file. One section per task so parallel branches never touch adjacent lines.

## Decisions and approvals

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
| SendGrid plan status, sender-auth status (not started / pending / verified), key scope | Paid account; `jowray.com` sender auth **not started**; key has `mail.send` (read via API) `[C71]` | 2026-11-02 | orchestrator   |
| Consent wording (storage checkbox, optional contact checkbox, email sentence) | TBD (Task 0; committed as `docs/consent/<CONSENT_VERSION>.md`) |            | Rob            |
| `CONSENT_VERSION`                                            | TBD, e.g. `2026-11-v1` (Task 0)                              |            | Rob            |
| Rob's test email(s) for `OUTBOUND_ALLOWLIST`                 | TBD (Task 0)                                                 |            | Rob            |
| Vercel Protection Bypass for Automation secret               | TBD (Task 0; Rob creates it, orchestrator uses it for preview checks) `[C70]` |            | Rob            |

## One-off actions

- [ ] `preview/docs/bootstrap-report` Neon branch deleted by hand (Task 1): date
- [ ] `main` ruleset created after PR A merged (Task 1 step 5): ruleset id, date, recorded on branch …
- [ ] WAF rate-limit rule created (Task 10): rule id, date
- [ ] Spend Management hard pause set (Task 10): amount, date
- [ ] SendGrid interim single-sender verification added / removed (Task 6): dates

## Task 0 — Inventory, decisions
- Status: [~]   Owner: Rob + orchestrator   Branch/PR: docs/phase1-plan (PR #3)
- Checks passed (2026-11-02): `docs/custom-domain` merged (PR #2, main `19081c2`, `docs/domain.md` on main); `https://www.jowray.com/` → 200, `https://jowray.com/` → 308 to www; Vercel team `rob-wrays-projects` plan = **pro** (`vercel teams ls`); EmpathIQ cloned at `ac902c9` into `/Users/rob/Documents/active_work/_reference/empathiq`.
- SendGrid (read via API with the existing key, 2026-11-02): account type **paid** (reputation 100, 500,000 credits/month, hard limit); key has **`mail.send`** plus `whitelabel.*` and `sender_verification_eligible`; `jowray.com` domain authentication **not started** (existing authenticated domains: empathiq.dev, sopheva.com, tray-verify.com, zto1ai.com); `robwray@gmail.com` is an already-verified single sender (usable as the Task 6 interim sender if needed).
- Neon CLI: `neon` 2.4.0 installed, **not authenticated** (`neonctl auth` needed, or `NEON_API_KEY` in `.env`); auth method: pending Rob.
- Waiting on Rob: `MEMORIAL_NAME`, `MEMORIAL_SLUG`, `SENDGRID_FROM_EMAIL`, consent sentences + `CONSENT_VERSION`, `OUTBOUND_ALLOWLIST` emails, Vercel Protection Bypass secret, Neon auth.

## Task 1 — Infra follow-ups
- Status: [~]   Owner: orchestrator + Rob   Branch/PR: A `feat/phase1-foundation` (PR #4, draft, stacked on #3)
- Done 2026-11-02: `.github/workflows/ci.yml` (job `ci`: lint, type-check, test:run, build on PRs and main), `.github/workflows/neon-cleanup.yml`, `.gitignore` (`/generated/`, `/.reference/`), `docs/environment.md` rows for `NEON_API_KEY` and `VERCEL_AUTOMATION_BYPASS_SECRET`; GitHub variable `NEON_PROJECT_ID=icy-scene-20351172` set (2026-11-03T01:54Z).
- External IDs: Neon `dev` branch **`br-holy-rice-bbz4t50l`** (parent `main` `br-restless-king-bbmkh5zd`, created 2026-11-03T02:05Z through the Neon MCP connector because the `neon` CLI is not authenticated); GitHub variable `NEON_PROJECT_ID`.
- Waiting on Rob: `NEON_API_KEY` (GitHub secret for the cleanup action; `.env` for the CLI); approval to delete the stale `preview/docs/bootstrap-report` (`br-orange-rice-bbil7ivy`) and `preview/docs/custom-domain` (`br-weathered-queen-bb8o0zd5`) branches (both PRs are closed; the cleanup action did not exist yet); `main` ruleset after PR A merges and `ci` is green on main once.
- Checks passed: `gh variable list` shows `NEON_PROJECT_ID`. Pending: `neon branches list`, `.env.local` checks, CI green on main, ruleset, `gh secret list`.

## Task 2a — Pre-flight
- Status: [x] 2026-11-02   Owner: orchestrator   Branch/PR: A   Base commit for 2b: `24974eb`
- Installed (one lockfile change): zod, pino, pino-pretty, server-only, geist, @sentry/nextjs 11.10.0, @vercel/blob 2.8.2, @sendgrid/mail 8.1.6; dev: vitest 5.1.0, @types/node 26. (Task 2b added @opentelemetry/api and @opentelemetry/core as explicit deps for `afterWithFlush`, same PR.) `npm audit`: transitive advisories only (deepmerge via @sendgrid/mail; glob/minimatch via @sentry/bundler-plugins); the offered fixes are breaking downgrades and were not applied.
- Checks passed: `npm ls` resolves all; `grep -c typegen package.json` → 1; `npm run validate` and `npm run build` green on the base (network on). Offline proof on the base: `npm ci --offline` ok in a scratch worktree; the pre-font-swap build fails on `fonts.googleapis.com` as expected (recorded in the findings file).

## Task 2b — Conventions, logging, tests
- Status: [x] 2026-11-02   Owner: worker (executed inline by the orchestrator session)   Branch/PR: A   Worktree: `../jowray_wt_task-2b` (removed after merge)   wip branch: wip/task-2b   Head: `bc4bd05`
- Hand-back received: inline   Merged into A at: `c13784c`
- Checks passed: `npm run validate`, `npm run test:run` (12/12), `npm run build` with `DATABASE_URL` unset and remote network blocked (Node-level `dns.lookup`/`net.connect` blocker via `NODE_OPTIONS`; `sandbox-exec` is unusable because Turbopack's loader IPC port binding fails under any profile). Only blocked hosts during the build: `registry.npmjs.org` (npm update check) and `telemetry.nextjs.org`, both non-fatal. `AGENTS.md` updated from `docs/code-layout.md`.

## Task 3 — Database
- Status: [~]   Owner: orchestrator   Branch/PR: B `feat/phase1-data-observability` (stacked on A)
- External IDs: migration `20261103022414_phase1_init` applied to Neon `dev` (`br-holy-rice-bbz4t50l`) on 2026-11-03; Vercel env MEMORIAL_NAME / MEMORIAL_SLUG / CONSENT_VERSION: **pending Rob's values** (not yet added; `vercel.json` is therefore not yet committed, per Task 3 step 7).
- Checks passed (2026-11-03): `npx prisma migrate deploy` twice → "No pending migrations to apply."; seed three times with placeholder values (`Seed Test` / `seed-test`) → one Memorial + one Person, a manual `born` edit survives the third run; 10 tables in `public`; `npm run validate`, `npm run test:run` (12/12), `npm run build` with `DATABASE_URL` unset and remote network blocked; `npm run lint` passes with `generated/` present. The placeholder Memorial and Person rows were deleted afterwards (0 rows of each on `dev`; the migration stays applied).
- Plan deviation: the plan's single-line enum blocks (`enum X { A B }`) are not valid Prisma; written one value per line (same values).

## Task 4 — Sentry 11
- Status: [~]   Owner: orchestrator + Rob   Branch/PR: B
- Done 2026-11-03: manual install (no wizard): `instrumentation.ts` (init inside `register()` for `nodejs` only, `prismaIntegration` + `pinoIntegration`, explicit `dataCollection`, URL scrubbing hooks, `onRequestError`), `instrumentation-client.ts` (same `dataCollection` and scrubbing, no Replay, `onRouterTransitionStart`), `app/global-error.tsx`, `next.config.ts` wrapped with `withSentryConfig` from `@sentry/nextjs/config` (`tunnelRoute: "/monitoring"`, `telemetry: false`, `silent: !CI`, `sourcemaps.disable` without `SENTRY_AUTH_TOKEN`), `lib/sentry/scrub.ts` + `lib/sentry/data-collection.ts` with tests.
- Plan deviations: SDK v11 has no `enableLogs` option (logs are on by default; the v10 option was removed), so it is not set. `dataCollection` keys used: `userInfo`, `cookies`, `urlQueryParams`, `databaseQueryData`, `httpBodies`, `httpHeaders`, `genAI`, `stackFrameVariables` (all present in the installed `@sentry/core@11.10.0` types).
- Waiting on Rob: Sentry **organization** token (`org:ci`) → orchestrator adds `SENTRY_AUTH_TOKEN` to Vercel Production + Preview; step 6 UI checks (test error without query string/cookies, Pino warn in Logs, source maps in the build log).
- Checks passed: `npm ls @sentry/nextjs` → 11.10.0; `git ls-files | grep -c sentry-build-plugin` → 0; validate, 17/17 tests, offline build without `SENTRY_AUTH_TOKEN` is quiet. Pending: `vercel env ls` shows `SENTRY_AUTH_TOKEN`; step 6 confirmations.

## Task 5 — Storage + email services
- Status: [~]   Owner: split   Branch/PR: C `feat/phase1-storage-email-dns` (stacked on B)   Worktree: inline   Head: …
- External IDs: private Blob store **jowray-media** = `store_tyOGMmElrZZu69is` (created 2026-11-03 with `vercel blob create-store jowray-media --access private --yes`, connected to Production, Preview, Development; `BLOB_READ_WRITE_TOKEN` set by Vercel in all three and merged into local `.env` with `BLOB_STORE_ID`). Vercel env SENDGRID_FROM_EMAIL, OUTBOUND_ENABLED (production), OUTBOUND_ALLOWLIST, NEXT_PUBLIC_SITE_URL (production): **pending Rob's values**.
- Incident: `vercel blob create-store --yes` ran its own `vercel env pull` into `.env.local`, replacing the Neon `dev`-branch override with the Development environment's values (see the findings file). `.env.local` was restored to `VERCEL_OIDC_TOKEN` + the two `dev`-branch URLs; verified host `ep-solitary-tree-bbnwysvl`.
- Code done 2026-11-03 (inline): `lib/media-types.ts`, `lib/claim-token.ts`, `services/storage/*`, `integrations/vercel-blob/index.ts`, `services/email/*` (`sendMemoryConfirmation`, template), `integrations/sendgrid/*`, `app/api/media/[id]/route.ts`, `scripts/send-test-email.ts`, `getBlobEnv`/`getEmailEnv` sub-schemas, tests (`__tests__/lib/media-types`, `claim-token`, `__tests__/services/email`, `__tests__/api/media`).
- Ruling: `@vercel/blob@2.8.2` exports `issueSignedToken` + `presignUrl`, so inline media views **302 to a 60-second presigned URL** (the blob host serves Range requests, so a 500 MB video is not streamed through a 60 s function); `?download=1` streams through the route with `Content-Disposition: attachment` and the protective headers (HEIC downloads are ≤ 25 MB). Cost if wrong: the content response's headers come from the blob host, not this route; the 302 itself carries `Cache-Control: private, no-store`, nosniff, CSP sandbox and `Referrer-Policy`.
- Ruling: integrations may import *types* from `services/*/types` (ESLint `allowTypeImports`), as EmpathIQ's pattern requires.
- Checks passed: `vercel blob list --limit 1 --rw-token …` → "No blobs in this store" (the plain command needs `BLOB_STORE_ID` next to `VERCEL_OIDC_TOKEN` in the same env file, so `--rw-token` is used); no `.env.vercel.tmp`; `.env.local` host is the `dev` branch; `npm run validate`, `npm run test:run` (40/40), offline build without `DATABASE_URL`/`BLOB_READ_WRITE_TOKEN`/`SENDGRID_API_KEY`. Pending: `vercel env ls` shows the four keys (Rob's values).

## Task 6 — DNS for SendGrid
- Status: [~]   Owner: orchestrator + Rob   Branch/PR: C
- External IDs (created 2026-11-03 by `scripts/dns-setup.ts`, run with `npx tsx --env-file=.env scripts/dns-setup.ts`): SendGrid domain authentication **id 33798852** (`jowray.com`, subdomain `em4653`, automated security, not default); Cloudflare records (zone `dad5b9fdb1ece5afc4a4224f61a51770`, all DNS-only): CNAME `em4653` → `u46785377.wl128.sendgrid.net` (`496f00c07369a141a68fde36ead9cd71`), CNAME `s1._domainkey` → `s1.domainkey.u46785377.wl128.sendgrid.net` (`ac50b464b68b2414420ea3276500e738`), CNAME `s2._domainkey` → `s2.domainkey.u46785377.wl128.sendgrid.net` (`8931d1c589ebf61c67c588090494d13c`), TXT `_dmarc` → `v=DMARC1; p=none; rua=mailto:dmarc@jowray.com` (`c726c35b037f8ab93d2c9d23f1c827a1`). Verified on: pending (SendGrid validation returned pending for all three CNAMEs right after creation).
- Ruling: the domain authentication was created through the SendGrid API (the key has `whitelabel.create`) instead of Rob clicking through the UI, and the script reads the records from the API instead of a pasted findings entry; link branding was not set up (click tracking is disabled in the transport). Cost if wrong: one `DELETE /v3/whitelabel/domains/33798852` and four Cloudflare record deletions.
- Checks passed: Vercel `A`/`CNAME` records verified present and DNS-only before any change; Cloudflare token `active` via `/accounts/{id}/tokens/verify`. Pending: `dig +short CNAME em4653.jowray.com @1.1.1.1`; SendGrid **Verified**; test email with `dkim=pass` (needs `SENDGRID_FROM_EMAIL` and `OUTBOUND_ALLOWLIST` from Rob).

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
