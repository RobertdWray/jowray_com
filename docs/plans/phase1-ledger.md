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
