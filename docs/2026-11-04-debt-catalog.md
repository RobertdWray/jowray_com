# Leftover-debt catalog, verified against main (2026-11-04)
**Priority**
**Must do (section 1)**
Built with claude session 
| Section | Catalog id | Item |
|---|---|---|
| 1.1 | M-A-05 | Set `ADMIN_PAGE_SECRET` in Vercel Production (the one true blocker) |
| 1.1 | M-A-04 | Set `ADMIN_API_SECRET` for the draft-on-behalf script |
| 1.1 | M-A-03 | Set `CONSENT_VERSION=2026-11-v2` in Vercel |
| 1.1 | M-C-15 | Consent record: env half of the same fix, mark v1 superseded |
| 1.1 | M-A-06 | Set `ADMIN_ALERT_EMAILS`; alert cutoff question is settled |
| 1.1 | M-A-08 | Admin page production smoke, record deployment id |
| 1.1 | M-A-10 | Send the admin entry link to the family |
| 1.2 | M-H-03 | Real iPhone and Android pass on production |
| 1.2 | M-H-04 | Recorder device matrix, folded into the phone pass |
| 1.2 | M-H-10 | Issue #17 production acceptance: real HEIC renders |
| 1.2 | M-B-02 | Measure 24 MP HEIC decode on Vercel |
| 1.2 | M-B-05 | Long video past the 60-second presigned URL on iOS |
| 1.2 | M-H-05 | VoiceOver pass, optional in the same sitting |
| 1.3 | M-H-01 | Vercel WAF rate-limit rule and Spend Management pause |
| 1.3 | M-K-07 | No in-app rate limiting; depends on the WAF being on |
| 1.3 | M-B-10 | Budget race; WAF is the stated mitigation |
| 1.4 | M-J-03 | Thank-you screen's November 10th promise, copy fix |
| 1.4 | M-D-06 | Same promise; the "posted" email does not exist |

**Nice to do (section 2)**

| Section | Catalog id | Item |
|---|---|---|
| 2.1 | M-H-08 | See the current receipt email in a real inbox |
| 2.1 | M-H-09 | Hotmail deliverability of the admin alert |
| 2.1 | M-D-02 | SendGrid event webhook; moot once 2.1 is checked |
| 2.2 | M-H-06 | One 100 MB video upload through the cron-hash path |
| 2.3 | M-H-11 | Sentry production smoke: replays, crons, source maps |
| 2.3 | M-F-01 | sentry.io checklist: feedback and replay-with-error notifications |
| 2.3 | M-F-10 | Cron partial-failure alerting decision |
| 2.4 | M-F-09 | Per-segment `error.tsx` for `/share` and `/m` |
| 2.5 | M-I-04 | Bump next and eslint-config-next to 16.4.5 |
| 2.5 | M-I-03 | npm audit: zod override under `@vercel/blob` chain |
| 2.5 | M-B-03 | libheif advisory check at the next bump |
| 2.6 | M-I-15 | One-page release and rollback sheet |
| 2.6 | M-A-09 | Rollback floors; fill the blank SHA placeholder |
| 2.6 | M-A-19 | Additive-only migrations rule, belongs in the runbook |
| 2.7 | M-A-07 | Vercel Deployment Protection = Standard |
| 2.7 | M-F-13 | Note Vercel request-log retention in `docs/admin.md` |
| 2.8 | M-E-13 | First real draft runs for Joyce and Bridget |
| 2.9 | M-F-03 | Cut the known Sentry noise from recorder and draft storage |
| 2.10 | M-C-18 | Delete the silent test recording on `/admin` |

**M-C-19** is "iOS has no `beforeunload`; drafts never hold media". It landed in section 4.2 (deliberately not doing): words survive via `visibilitychange` and `pagehide`, files cannot be persisted from the page on iOS, so a relative who leaves the tab re-picks the photo. Rated NOT-DEBT, LATER at worst.


**Status:** record of the 2026-11-04 debt review. The sorted, actionable view is the META issue on GitHub (linked from the PR that adds this file). This file is the evidence appendix: one block per merged item with where it came from, what was found on `main` at `ae9fb0b` (PRs #35 and #36 included), and the launch-impact rating.

**How it was produced.** Six agents harvested the descriptions, comments and linked plan sections of PRs #1–#36, closed issue #17 and every file under `docs/` and `docs/plans/` for deferred minors, follow-ups, non-goals, unchecked boxes and risks (706 raw notes). One agent merged them into 147 items (ids `M-<area>-<nn>`). Five agents verified each item read-only against the checkout, citing file:line, commit or ledger line, and rated launch impact for a 100-person collection-only family launch: **BLOCKER** (a family member will likely hit it or data/email is lost), **SHOULD** (real risk or visible rough edge, an hour or two), **LATER** (fine until it hurts), **NEVER** (deliberate non-goal or Phase 2). Verdicts: **DONE**, **OPEN**, **PARTIAL**, **NITPICK**, **NOT-DEBT**, **NEEDS-ROB** (lives in Vercel, Neon, sentry.io, SendGrid or on a phone; the repo's ledgers still say *todo*), **DONE-PER-LEDGER**.

**Limits of the check.** No Vercel, sentry.io or SendGrid access from the review session; the Neon MCP connection was scoped to a different project; `node_modules` was not installed in the checkout so the test suite was not re-run (the ledgers' last recorded counts are 1000/1000 and 1004/1004). Everything marked NEEDS-ROB may already be done without a ledger line saying so.

**Sources column.** `PR<n>-<k>` = the k-th note harvested from PR #n (body, comments, or its linked plan section); `DOC-<k>` = the k-th note from the docs sweep; `BOOT-*`, `LEDGER-*`, `I17-*` = bootstrap report, phase1 ledger, issue #17. The raw harvest files were working material and are not committed.


## A. Infra, Vercel, Neon, env, ops steps

### M-A-01: Delete stale Neon `preview/*` branches (Rob's approval)
- Sources: DOC-7, DOC-22, DOC-73, DOC-74, PR1-2, BOOT-R8, LEDGER-O1, LEDGER-T1-1, PR12-1, LEDGER-T0-1
- Kind: Ops step (Rob)
- What: The cleanup workflow (`.github/workflows/neon-cleanup.yml`, REST API via curl+jq because `neonctl` answers "project not found" with the org key, project `icy-scene-20351172`) handles new closures, but ten `preview/*` branches for already-closed PRs plus `preview/docs/bootstrap-report` still exist and need a one-time hand deletion. Ledger one-off box "`preview/docs/bootstrap-report` Neon branch deleted by hand" is unchecked.
- Why deferred / reasoning given: agents never delete Neon branches; Rob's approval required.
- Verdict: NEEDS-ROB
- Evidence: `docs/plans/phase1-ledger.md:39` one-off box still `[ ]`; `:56-57` "Still Rob's: approval to delete the stale `preview/*` branches (ten exist for closed PRs)". Neon MCP is scoped to another project, so the branch list could not be read. `neon-cleanup.yml` runs: every closure since the REST switch (`ci/neon-cleanup-rest`, 2026-11-03T11:38Z) is `success` (28 runs through #36 on 2026-11-04T20:17Z); the two `failure` runs are `feat/phase1-web-collection` and `docs/phase1-close` (2026-11-03T07:33/07:45Z, before the key).
- Remaining work: Rob (or an agent with his explicit approval and a Neon connection scoped to `icy-scene-20351172`) deletes `preview/docs/bootstrap-report`, `preview/feat/phase1-*`, `preview/docs/phase1-close` and the other pre-2026-11-03T11:38Z preview branches; tick ledger line 39.
- Launch impact: LATER — costs Neon storage only; no family-visible effect (org limit is 5000 branches).
- Merge with: M-A-02 (same "delete Neon branches with Rob's approval" session)

### M-A-02: Delete feature-verification Neon branches after merge
- Sources: DOC-91, DOC-161, PR26-7, PR30-3, LEDGER-X4
- Kind: Ops step (Rob)
- What: `br-cold-fire-bbsgvtlu` (`dev-admin-alert`, PR #26) and `br-misty-bird-bbu404uq` (`feat-draft-memory-verify`, endpoint `ep-tiny-credit-bb3uxpap`, PR #30) can be deleted now that both PRs merged. PR #30 also flagged that production `main` already had `20261103233000_media_words_lease` not on `origin/main`, and the verification branch applied this PR's two migrations in the opposite order to production (stated safe).
- Why deferred / reasoning given: "Rob's call; never by an agent".
- Verdict: PARTIAL (branch deletion NEEDS-ROB; the migration-drift half is DONE)
- Evidence: `docs/plans/2026-11-03-admin-new-memory-alert.md:15` and `docs/plans/2026-11-03-draft-memory-on-behalf.md:68` name `br-cold-fire-bbsgvtlu` and `br-misty-bird-bbu404uq` with "delete after merge (Rob's call)"; nothing records deletion; MCP cannot list the project. Drift: `prisma/migrations/` on main now contains `20261103233000_media_words_lease` (between `20261103220303_…` and `20261104000000_submissions`), so production and `origin/main` agree on the migration set.
- Remaining work: delete the two branches (and `ep-tiny-credit-bb3uxpap`) by hand; nothing else.
- Launch impact: LATER — verification branches are children of production/dev and cost storage only.
- Merge with: M-A-01

### M-A-03: Set `CONSENT_VERSION=2026-11-v2` in Vercel Production + Preview and `.env`
- Sources: DOC-121, DOC-160, PR16-3, PR30-1
- Kind: Ops step (Rob)
- What: `docs/consent/2026-11-v2.md` is the wording the live form shows, but `Memory.consentVersion` records `2026-11-v2` only once the env var is set in Vercel (Production and Preview) and local `.env`; memories shared before carry `2026-11-v1`. Done-check from the draft-memory ledger: `grep -c '^CONSENT_VERSION=2026-11-v2' .env` = 1.
- Why deferred / reasoning given: manual deploy step for Rob.
- Verdict: NEEDS-ROB
- Evidence: PR #30 body test-plan box 25 still `[ ]` ("Rob: … `CONSENT_VERSION=2026-11-v2` in Vercel Production and `.env`; then merge"); draft-memory ledger `:73` row "no"; `server/config/env.ts:73` requires any non-empty `CONSENT_VERSION` (no default to v2), and `docs/environment.md:64` says v2 is in force "since the draft-memory feature". No ledger line says Rob set it.
- Remaining work: `vercel env rm/add CONSENT_VERSION` = `2026-11-v2` in Production + Preview, same in `.env`, redeploy (env reaches new deployments only). Verify: newest `Memory.consentVersion` reads `2026-11-v2`.
- Launch impact: SHOULD — every memory shared before this is stamped `2026-11-v1` while the form shows the v2 wording; the consent record is wrong for the launch cohort and it is a two-minute fix.
- Merge with: M-A-11 (same `vercel env ls production` review); consent wording itself is M-C-17

### M-A-04: Set `ADMIN_API_SECRET` in Vercel Production and local `.env`
- Sources: DOC-160, PR30-1
- Kind: Ops step (Rob)
- What: PR #30's admin API (`POST /api/admin/memories`, draft skill) needs the same bearer value in Vercel Production and `.env` (never Preview). Done-checks: `vercel env ls production | grep -c ADMIN_API_SECRET` = 1; `grep -c '^ADMIN_API_SECRET=' .env` = 1. PR #30 test-plan box unchecked.
- Why deferred / reasoning given: secret; Rob only.
- Verdict: NEEDS-ROB
- Evidence: PR #30 box 25 `[ ]`; draft-memory ledger `:71-72` "no"; `server/config/env.ts:87-88` makes the admin API fail closed with 401 when unset, so the site is safe without it but `scripts/draft-memory.ts` / the `jowray-draft-memory` skill cannot work. Rows 78–79 (first real runs for Joyce and Bridget) also "no".
- Remaining work: `openssl rand -hex 32` → `vercel env add ADMIN_API_SECRET production < file` (never Preview), same line in `.env`, redeploy; probe: wrong bearer 401, right bearer 409/200.
- Launch impact: SHOULD — only Rob's drafting-on-behalf workflow is blocked; family submissions are unaffected. Do it before the first condolence-email draft, not before launch.
- Merge with: M-A-05 (both secrets, same `vercel env add` session), M-A-08

### M-A-05: Set `ADMIN_PAGE_SECRET` in Vercel Production and `.env` (admin-page L15)
- Sources: DOC-211, PR31-6
- Kind: Ops step (Rob)
- What: `openssl rand -hex 32` → `ADMIN_PAGE_SECRET` in Vercel Production and local `.env`, never Preview (Preview reads a copy of production rows).
- Why deferred / reasoning given: Rob's pre-merge step; PR merged without evidence.
- Verdict: NEEDS-ROB
- Evidence: `docs/plans/2026-11-04-admin-page.md:46` L15 "todo", empty Commit/Evidence; PR #31 body step 1 (line 36) asks for it; `server/config/env.ts:93-94`: unset/empty → every admin check fails closed → `/admin` renders the signed-out page for everyone. PR #31 merged as `9ffdb8e` with no evidence the secret exists.
- Remaining work: generate, `vercel env add ADMIN_PAGE_SECRET production` (never Preview), `.env`, redeploy; then L17 smoke (M-A-08) and L18 link (M-A-10).
- Launch impact: BLOCKER — for the stated launch goal "admin page for a few family admins": until it is set, the admins get the signed-out page and cannot see or tidy any memory. Five minutes of Rob's time; collection itself does not depend on it.
- Merge with: M-A-08, M-A-10 (one ordered sequence L15 → L17 → L18); M-A-04

### M-A-06: Set `ADMIN_ALERT_EMAILS` in Vercel; reconcile the `ADMIN_ALERT_SINCE` value
- Sources: DOC-91, LEDGER-X4, PR26-1, PR26-2
- Kind: Ops step (Rob)
- What: `ADMIN_ALERT_EMAILS=robwray@gmail.com,rjwray@hotmail.com` in Vercel Production + Preview (empty value writes no row; the cron catches up once set). PR #26 body says `ADMIN_ALERT_SINCE` = `2026-11-04T00:00:00Z`, the runbook ruling moved it to `2026-11-03T22:00:00Z`; confirm which value is deployed.
- Why deferred / reasoning given: env per AGENTS.md; before-merge step for Rob.
- Verdict: PARTIAL (env NEEDS-ROB; the `ADMIN_ALERT_SINCE` question is DONE)
- Evidence: PR #26 body line 24 "Rob: set `ADMIN_ALERT_EMAILS=…` in Vercel Production + Preview" with no confirmation anywhere (admin-alert plan `:18`, `:164`; phase1 ledger silent). `ADMIN_ALERT_SINCE`: the deployed value is the code constant `features/memories/notify-admins.ts:14` = `2026-11-03T22:00:00Z` (ruling R6, plan `:37`, `:153`); the PR body's `2026-11-04T00:00:00Z` (line 25) is the stale text. `env.ts:82` defaults the list to `[]` (= no alert row, cron catches up, R7).
- Remaining work: `vercel env add ADMIN_ALERT_EMAILS` = `robwray@gmail.com,rjwray@hotmail.com` in Production + Preview (+ `.env`), redeploy; verify the first `EmailLog` row with `emailType = 'ADMIN_NEW_MEMORY'`. Optionally fix the PR #26 body line 25.
- Launch impact: SHOULD — without it nobody is told a memory arrived; nothing is lost (the cron backfills every memory since the cutoff, 50 per run) but the admins would be blind during launch week.
- Merge with: M-A-11 (one `vercel env ls` pass)

### M-A-07: Vercel Deployment Protection = Standard Protection (admin-page L16)
- Sources: DOC-113, DOC-211, DOC-213, PR31-7
- Kind: Ops step (Rob)
- What: Without Standard Protection, older production deployment URLs stay reachable and keep the previous `ADMIN_PAGE_SECRET` after a rotation. Vercel → project → Settings → Deployment Protection. Evidence: screenshot or `vercel project inspect`.
- Why deferred / reasoning given: dashboard setting, Rob only.
- Verdict: NEEDS-ROB
- Evidence: admin-page plan `:47` L16 "todo"; `:294` and `:301` explain the rotation risk; `docs/environment.md:81` notes it. Preview deployments are already behind some protection (the Sentry tunnel and `VERCEL_AUTOMATION_BYPASS_SECRET` exist for "protected previews"), so the gap is old *production* deployment URLs only.
- Remaining work: Vercel → project → Settings → Deployment Protection → Standard Protection; confirm an old `*.vercel.app` production URL asks for Vercel login.
- Launch impact: LATER — it only matters after an `ADMIN_PAGE_SECRET` rotation (old deployments keep the old value); before any rotation the exposure is identical to the live site.
- Merge with: none (keep in the L15–L18 sequence for ordering only)

### M-A-08: Admin page production smoke and ledger record (L17)
- Sources: DOC-211, PR31-8
- Kind: Gate not run
- What: After merge: `https://www.jowray.com/admin` signed-out page; `curl -I https://www.jowray.com/admin` headers; entry link works for Rob; one harmless edit (date text on Rob's test memory) and revert; record deployment id and SHA in `docs/plans/2026-11-04-admin-page.md` ledger.
- Why deferred / reasoning given: post-merge step.
- Verdict: OPEN (gate not run)
- Evidence: admin-page plan `:48` L17 "todo"; `docs/plans/evidence/2026-11-admin-page/README.md` holds only the local walk B1–B15 (no `www.jowray.com` or deployment id); `:299` SHA placeholder blank. Merge SHA is `9ffdb8e` (git log, 2026-11-04 17:11Z).
- Remaining work: after M-A-05: open `https://www.jowray.com/admin` signed-out, `curl -I` headers (`Referrer-Policy: no-referrer`, `X-Robots-Tag`), enter via the link, one harmless edit + revert; write deployment id and `9ffdb8e` into L17 and §7.
- Launch impact: SHOULD — the first real check that the admin page works with production env; 30 minutes, before the link goes to the family.
- Merge with: M-A-05, M-A-10

### M-A-09: Rollback floors and roll-forward rules (DRAFT, admin delete, admin-alert cron, `Media.deletedAt`)
- Sources: DOC-116, DOC-133, DOC-167, DOC-194, DOC-213, PR30-46, PR31-9
- Kind: Risk/open question
- What: Four independent floors: (1) once a DRAFT row exists in production never roll back past PR #30 (old cron would email and rotate every draft within 30 min); (2) once any memory is deleted from `/admin` never roll back below PR #31's merge (older cron purges immediately, ignores `purgedAt`; disable Cron Jobs first if an older build must run); (3) admin-alert cron: roll back only to a build from `4ef66c6` on or confirm by hand; (4) issue #17 PR B: `Media.deletedAt` is fix-forward only; purged blobs are irreversible. The admin-page plan's "Record the merge SHA here: `________`" is still blank.
- Why deferred / reasoning given: operational rules, not code.
- Verdict: PARTIAL
- Evidence: rules are documented: `docs/admin.md:34` (admin-delete floor + Disable Cron Jobs procedure), admin-page plan `:299`, admin-alert plan `:20` (`4ef66c6` floor), PR #30 box 25 ("roll forward only once a DRAFT row exists"). The SHA placeholder at admin-page plan `:299` is still `________`. SHAs from git: PR #26 `1caf117`, PR #30 `6210009`, PR #31 `9ffdb8e` (all merges on main; a Vercel rollback target must be at or above `9ffdb8e` once anything has been deleted or drafted).
- Remaining work: fill `9ffdb8e` into admin-page plan §7; write the four floors in one place (see M-I-15). Practically: never Instant-Rollback below `9ffdb8e`, which is also the simplest rule to give Rob.
- Launch impact: LATER — operational knowledge; only bites during a rollback, and the single rule "never below 9ffdb8e" covers all four floors.
- Merge with: M-I-15 (the runbook is where these belong)

### M-A-10: Send the admin entry link to the family (L18)
- Sources: DOC-211, PR31-10
- Kind: Ops step (Rob)
- What: Send `https://www.jowray.com/admin/enter#key=<secret>` by a private channel; each person opens it once and bookmarks `/admin`.
- Why deferred / reasoning given: Rob's step after L15–L17.
- Verdict: NEEDS-ROB
- Evidence: admin-page plan `:49` L18 "todo"; depends on L15 (M-A-05).
- Remaining work: after M-A-05 and M-A-08, send `https://www.jowray.com/admin/enter#key=<secret>` privately to the admins; they open it once and bookmark `/admin`.
- Launch impact: SHOULD — last step of the admin sequence; nothing for the admins to use until it is done.
- Merge with: M-A-05, M-A-08

### M-A-11: Guessed MVP env values still awaiting Rob (memorial name/slug, from-address, allowlist)
- Sources: DOC-21, DOC-71, DOC-87, PR3-1, PR5-1, PR6-1, LEDGER-D1, LEDGER-T5-2, LEDGER-T6-2, PR10-1
- Kind: Ops step (Rob)
- What: `MEMORIAL_NAME`/`MEMORIAL_SLUG` = `Jo Wray` / `jo-wray` (change by editing Vercel env + `.env` and re-seeding), `SENDGRID_FROM_EMAIL` = `memories@jowray.com` (DKIM/SPF/DMARC pass; "a guess Rob may change"), `OUTBOUND_ALLOWLIST` = `robwray@gmail.com`, `CONSENT_VERSION` (see M-A-03) were guessed for the MVP. Ledger Task 5 "Pending: `vercel env ls` shows the four keys (Rob's values)"; Task 6 "Remaining for [x]: Rob's final `SENDGRID_FROM_EMAIL`". Consent wording is covered in M-C-17.
- Why deferred / reasoning given: values were Rob's to supply (Task 0 step 6); guessed to unblock.
- Verdict: NEEDS-ROB (values are set and working; confirmation is the open part)
- Evidence: phase1 ledger `:22-27` decisions table (guessed, 2026-11-03); `:71` and `:84` confirm the keys were added to Vercel Production/Preview; `:95` DKIM/SPF/DMARC pass from `memories@jowray.com`; `:89` "Pending: `vercel env ls` shows the four keys (Rob's values)". Name `Jo Wray` is confirmed by the obituary draft (`:50`).
- Remaining work: Rob says "keep" or changes `SENDGRID_FROM_EMAIL` / display name before the family receives mail; `OUTBOUND_ALLOWLIST` must be widened or `OUTBOUND_ENABLED`/allowlist semantics confirmed for 100 recipients (that gate is in area C/E; flag here only because the key is in this list).
- Launch impact: LATER — the guesses work (mail authenticates, slug seeds); changing the from-address later is a config edit, not a migration.
- Merge with: M-A-03, M-A-06 (one `vercel env ls production` review with Rob)

### M-A-12: Local `.env.local` hygiene after `vercel` commands (mode 600, never `env pull .env.local`)
- Sources: DOC-11, DOC-14, DOC-97, PR1-9, BOOT-R12, LEDGER-T5-1, PR3-N15
- Kind: Risk/open question
- What: `vercel link`, `vercel env pull` and `vercel blob create-store --yes` write `.env.local` (one incident replaced the Neon `dev`-branch override with Development values; restored). Rules: re-check `stat -f %Lp .env.local` = 600 and the Task 1 checks before running Prisma; pull to a temp file under `umask 077` and merge only missing keys; `BLOB_STORE_ID` is not pulled (derived from the token by hand).
- Why deferred / reasoning given: standing process rule, documented in `docs/environment.md`.
- Verdict: NOT-DEBT
- Evidence: `docs/environment.md:3-9` carries the rule (mode 600, pull to a temp file, merge only missing keys, `BLOB_STORE_ID` by hand `:74-75`); the incident was restored.
- Remaining work: none unless a guard script is wanted (M-A-13).
- Launch impact: NEVER — standing process rule on Rob's machine.
- Merge with: M-A-13

### M-A-13: One shared `.env.local` across worktrees migrates the same dev Neon branch (PR #30 F8)
- Sources: DOC-175, PR30-28, PR29-4
- Kind: Follow-up
- What: Worktrees share one `.env.local`, so any worktree's `prisma migrate` hits the same `dev` branch (PR #29 found five unapplied migrations there and applied them by hand). Fix: per-worktree `.env.local` from a template, or a `DATABASE_URL` guard in `prisma.config.ts` refusing branches not in an allowlist; document in `docs/environment.md`.
- Why deferred / reasoning given: repo-workflow fix, out of PR #30's scope (M).
- Verdict: OPEN
- Evidence: `prisma.config.ts` (full file read) has no `DATABASE_URL` allowlist guard; `docs/environment.md` has no worktree section; phase1 ledger `:237` records the quick-fix worktrees copying `.env`/`.env.local` from the main checkout by hand.
- Remaining work: either a per-worktree `.env.local` template or a guard in `prisma.config.ts` refusing hosts not on an allowlist, plus a paragraph in `docs/environment.md`.
- Launch impact: LATER — affects agents' dev branches only; production migrations run from `vercel.json`, never from a worktree.
- Merge with: M-A-12

### M-A-14: Contributor data copied into preview/dev Neon branches; schema-only preview branching (§11 #10)
- Sources: DOC-35, DOC-67, DOC-193, PR3-F10, PR3-R6, PR25-18
- Kind: Follow-up
- What: `preview/<branch>` and `dev` branches copy production rows (emails, notes; tokens are hashed so no claim links). Once real memories exist, switch the Vercel–Neon integration to branch previews from a schema-only parent and reset `dev` from an empty seed branch. Related: preview branches hold prod rows without derivatives (photos plan PM1 #10, Low).
- Why deferred / reasoning given: accepted for Phase 1 (Medium); `ADMIN_PAGE_SECRET` is never set in Preview as a mitigation.
- Verdict: OPEN
- Evidence: bootstrap report `:78` (connection `spc_vG0lQJrfXKx8rFkh`, preview branching from production); nothing since changes the parent; `docs/environment.md:81` keeps `ADMIN_PAGE_SECRET` out of Preview as the mitigation.
- Remaining work: once real memories exist, re-parent preview branches from a schema-only branch and reset `dev` from an empty seed; Vercel–Neon integration setting plus Neon console.
- Launch impact: LATER — the alpha data policy (AGENTS.md Sentry section) already accepts family data in telemetry; preview branches are visible only to Rob and agents. Revisit once the first dozen memories are in.
- Merge with: M-A-15 (same "isolate non-production from production data" theme)

### M-A-15: Production Blob write token present in preview builds and local `.env` (§11 #9)
- Sources: DOC-34, DOC-58, PR3-F9, PR3-R5, PR3-N20
- Kind: Follow-up
- What: One private store `jowray-media` for every environment; environment-scoped prefixes exist (`originals/`, `preview/originals/`, `dev/originals/`) but the token is shared. Create a second private store (or a `preview/` prefix with its own token) for Preview and Development.
- Why deferred / reasoning given: "doubles the setup for one memorial's test uploads" (Low).
- Verdict: OPEN
- Evidence: phase1 ledger `:84` one store `jowray-media` connected to all three environments with one `BLOB_READ_WRITE_TOKEN`; `docs/environment.md:74`; prefixes exist in `lib/` (site URL / derived prefixes) but no second store.
- Remaining work: second private store for Preview/Development, or accept.
- Launch impact: LATER — the token is only in Rob's `.env` and Vercel; a preview build cannot be made to delete production blobs without code that does so.
- Merge with: M-A-14

### M-A-16: Confirm "Require Active Resource Before Deploy" effect on production deploys
- Sources: DOC-10, DOC-64, PR1-8, BOOT-R11, PR1-C8, PR3-F6
- Kind: Risk/open question
- What: The toggle was required to enable Neon preview branching; whether it can block or delay production deploys is inferred, not documented. Confirm via Vercel/Neon docs or support. Turning it off was explicitly declined (preview branching needs it).
- Why deferred / reasoning given: Low; §11 #6 bootstrap leftover.
- Verdict: OPEN
- Evidence: bootstrap report `:77` and `:142` (item 13, Low); no later note. Production deploys have succeeded repeatedly since (every merged PR deployed), which is weak evidence the toggle does not block them.
- Remaining work: one line from Vercel/Neon support or docs; otherwise close as "observed harmless".
- Launch impact: LATER — ~30 production deploys have gone through with the toggle on.
- Merge with: none

### M-A-17: Upstream docs notes (create-next-app flags, Neon vs Vercel retention)
- Sources: DOC-5, DOC-12, DOC-18, DOC-64, PR1-10, BOOT-R6, BOOT-R13, PR3-F6
- Kind: Deferred minor
- What: Optional upstream issues: Next.js docs list `--turbopack`/`--webpack` for create-next-app but 16.4.4 lacks them; Neon's cleanup guide says Pro preview retention is 180 days while Vercel says 30 (Hobby and Pro).
- Why deferred / reasoning given: Low; not in Phase 1 scope (§11 #6).
- Verdict: NOT-DEBT
- Evidence: bootstrap report `:136` (item 7), `:144` (item 15), `:149`; both marked Low and optional; no issue filed.
- Remaining work: none; close as won't-do.
- Launch impact: NEVER — documentation nits in other people's docs.
- Merge with: none

### M-A-18: Email DNS gaps: no MX (DMARC reports go nowhere), CAA caveat
- Sources: DOC-102, DOC-105, DOC-106, PR2-1
- Kind: Risk/open question
- What: SendGrid domain-auth CNAMEs (`em4653`, `s1._domainkey`, `s2._domainkey`) and `_dmarc` TXT were added 2026-11-03 (DKIM/SPF/DMARC pass). No `MX` exists, so `jowray.com` receives no mail and `dmarc@jowray.com` reports are lost; an MX (SendGrid Inbound Parse) is also the voicemail-to-email transport if the phone line ever returns. No CAA record: if one is added later, allow `letsencrypt.org`; keep records DNS-only.
- Why deferred / reasoning given: not needed for sending.
- Verdict: OPEN
- Evidence: `docs/domain.md:84-86` (`_dmarc` `p=none; rua=mailto:dmarc@jowray.com`, "No `MX` record exists"); `:38` CAA note. Outbound auth passes (`phase1-ledger.md:95`).
- Remaining work: either point `rua=` at a mailbox that exists (e.g. Rob's Gmail) or add an MX; the CAA note is a reminder, not work.
- Launch impact: LATER — sending works; a lost DMARC aggregate report hurts nobody during a family launch. (Replies to `memories@jowray.com` also bounce; worth checking the email templates say "do not reply"/use a reply-to, but that is area E.)
- Merge with: none

### M-A-19: Build-time migrations risk and migration drift between production and `origin/main`
- Sources: DOC-32, PR3-R3, DOC-161, PR30-3
- Kind: Risk/open question
- What: `vercel.json` runs `prisma migrate deploy` before `next build`; a failed build leaves the previous deployment on the new schema, so every migration must be expand-and-contract. PR #30 found production had `20261103233000_media_words_lease` applied while `origin/main` lacked it at the time.
- Why deferred / reasoning given: house rule; no action unless a contracting migration is written.
- Verdict: PARTIAL (drift DONE; the expand-and-contract rule is NOT-DEBT)
- Evidence: `vercel.json` buildCommand `npx prisma migrate deploy && npx prisma db seed && npm run build`; `prisma/migrations/` on main lists `20261103233000_media_words_lease`, so the PR #30-era drift is closed. All 12 migrations so far are additive (enum values, columns, indexes, CHECK).
- Remaining work: none now; the rule applies the day someone writes a contracting migration.
- Launch impact: LATER — house rule; no contracting migration exists.
- Merge with: M-I-15 (belongs in the release runbook)

### M-A-20: Absolute URLs must use `https://www.jowray.com`
- Sources: DOC-104, PR2-3
- Kind: Deferred minor
- What: `metadataBase`, magic-link callbacks and SMS reply links must use the canonical host. `getSiteUrl()` with `NEXT_PUBLIC_SITE_URL` exists and throws in production when unset.
- Why deferred / reasoning given: rule for future code.
- Verdict: DONE (the rule stands as convention)
- Evidence: `lib/site-url.ts:13-24` returns `NEXT_PUBLIC_SITE_URL`, throws in production when unset; `server/config/env.ts:46-47` refines it to `https://` in production; phase1 ledger `:84` sets `NEXT_PUBLIC_SITE_URL=https://www.jowray.com` in Production.
- Remaining work: none.
- Launch impact: NEVER — implemented and enforced at env parse.
- Merge with: none

## B. Upload pipeline, storage, media derivation, cron

### M-B-01: POSTER flow for video not built (browser capture, `kind: "poster"` ticket, `attachPosterPreview`)
- Sources: DOC-70, DOC-89, DOC-156, DOC-158, DOC-189, DOC-192, LEDGER-D3, PR20-4, PR20-16, PR20-17, PR25-2, PR27-2, LEDGER-X2
- Kind: Follow-up
- What: Email plan Task 6 (browser half): `app/share/video-poster.ts` capture with one 8 s deadline, ticket `kind: "poster"` scoped to `image/jpeg` ≤ 2 MB and the exact staging key, `finalizeUpload({ posterTicket })`; the server writes a `DerivedMedia` `POSTER` row (enum, `posterStagingKeyFor`/`isStagingKey` key scheme and purge already exist from PR #25). Also F11 posters for files added from the claim page and F12 Playwright coverage of poster capture (depends on the browser harness, M-I-01). Audio/video keep presigning the original (P17).
- Why deferred / reasoning given: R3 ruling (posters captured in the browser) deferred with issue 17 PR A; "A–C create none".
- Verdict: OPEN
- Evidence: `app/share/video-poster.ts` does not exist; `grep -rn POSTER app features lib services` hits nothing outside `prisma/schema.prisma:53` (enum reserved) and the purge of `posterStagingKeyFor` in `app/api/cron/reconcile-uploads/route.ts`; email plan ledger `docs/plans/2026-11-03-confirmation-email-preview.md:63` still "T6 todo"; `features/memories/media-summary.ts:37` leaves `preview: null`.
- Remaining work (if any): the whole browser half plus the server POSTER row; video cards in both emails show a badge instead of a frame until then.
- Launch impact: LATER — videos upload, play on the claim page and are listed in the receipt; a missing poster is cosmetic in the email.
- Merge with: none (depends on M-I-01 for its Playwright half)

### M-B-02: Measure 24 MP / 48 MP HEIC decode on Vercel; `MAX_PIXELS`, function memory
- Sources: DOC-112, DOC-186, DOC-189, PR25-4, PR25-10, I17-2, DOC-159, PR20-5
- Kind: Gate not run
- What: Preview check used a 64×48 fixture only. Run a real 24 MP iPhone HEIC on a preview (plan V2/V13) and record decode time and memory (~0.8 GB locally); if it OOMs at 2 GB lower `MAX_PIXELS` from 30 MP to 20 MP or raise project memory in the Vercel dashboard (Fluid compute: no per-route memory; raise dashboard memory and the ceiling together if 48 MP must convert). Premortem items carried to PR A (worker `terminate()` deadline, staging-key/kind binding, finalize/callback convergence, cron (g) orphans, byte-measured sizes, unmocked HEIC verification) are mostly covered; the measurement is the open piece.
- Why deferred / reasoning given: "none block PR A"; needs a real phone photo.
- Verdict: NEEDS-ROB (gate not run; needs a real iPhone photo on a preview or production)
- Evidence: `services/images/index.ts:10` `maxPixels: 30_000_000`; `lib/heic-worker.ts:104` heap cap 512 MB default, hard deadline + `terminate()`; `docs/environment.md:101` says raise dashboard memory and the ceiling together; `docs/plans/2026-11-03-photos-derived-media.md:816` lists "24 MP memory measurement" as an open follow-up; no large-HEIC evidence under `docs/plans/evidence/`.
- Remaining work (if any): upload one real 24 MP HEIC from an iPhone to a preview, read the `derive-media` log line and function memory; if the worker is heap-killed or times out (error `decode_failed`/`timeout`, retried 3× by cron (g)) lower `maxPixels` or raise memory. The original is READY either way; only the inline photo and email thumbnail are missing.
- Launch impact: SHOULD — iPhone photos are the main input; a failing derive leaves the claim page without an inline photo for those files. No data loss.
- Merge with: M-H-03 (real-device pass covers it)

### M-B-03: Check libheif/libde265 advisories at every `libheif-js` upgrade (LGPL-3.0, HEVC patents noted)
- Sources: DOC-112, DOC-187, PR25-6, PR25-7
- Kind: Risk/open question
- What: Standing maintenance rule in `docs/environment.md`: check upstream advisories for the resolved `libheif-js` version on every upgrade; worker isolation, heap cap and deadline are the compensating controls. `libheif-js` is LGPL-3.0 (server-side use); HEVC decoding patents are a grey area shared by every HEIC tool.
- Why deferred / reasoning given: noted, not blocking.
- Verdict: OPEN (standing rule; new facts since it was written)
- Evidence: `package-lock.json:8312-8314` resolves `libheif-js` 1.23.5 (via `heic-decode` 2.1.0 `^1.19.8`); npm registry: 1.23.5 (2026-10-04) is still the newest `libheif-js`; upstream libheif is at **v1.23.7** (security release) with v1.23.6 and v1.23.7 fixing advisories that include ones "introduced with the coded-size check of v1.23.5" (OpenH264/AV1 plugin paths, not in the WASM build) and several CPU-exhaustion/grid-tile issues that may apply to the libde265 WASM build. Controls are in code: `lib/heic-worker.ts` heap cap + deadline + terminate, `maxPixels` checked before decode, bytes-match-type before libvips (`integrations/images/sharp-heic.ts:84-88`).
- Remaining work (if any): nothing upgradable today; when `libheif-js` ≥ 1.23.7 ships, bump and re-run `__tests__/integrations/images.test.ts` on the real fixtures.
- Launch impact: LATER — only invited family upload; a hostile HEIC can at worst burn one worker's deadline and fail that file's derive.
- Merge with: M-I-03 (dependency/advisory upgrade PR)

### M-B-04: Single shared raw decode for web + thumbnail on the sharp path
- Sources: PR25-5, DOC-189
- Kind: Follow-up
- What: Web and thumbnail each decode the original once; a single shared raw decode would halve CPU for JPEG/PNG/WebP at the cost of a 3-channel raw buffer up to 90 MB. Revisit with measured Vercel timings (M-B-02).
- Why deferred / reasoning given: low; needs measurements first.
- Verdict: OPEN
- Evidence: `integrations/images/sharp-heic.ts:95-96` builds `base` and `thumbSource` as two independent `sharp(input)` pipelines (GIF path lines 90-91 likewise); the HEIC path already decodes once in the worker (line 75-79).
- Remaining work (if any): pipe one `.raw()` decode into both encoders once Vercel timings exist (M-B-02).
- Launch impact: LATER — CPU only; finalize gives derive 20 s and cron (g) retries.
- Merge with: none

### M-B-05: Range/206 video seeking on iOS; 60 s presigned URL; Blob multipart `validUntil`/`maximumSizeInBytes` enforcement
- Sources: DOC-65, DOC-69, DOC-83, DOC-100, DOC-185, DOC-95, DOC-208, PR3-F7, LEDGER-FR-13, LEDGER-T5-3, PR16-15, PR25-16, PR28-16, LEDGER-X5
- Kind: Gate not run
- What: Inline media 302s to a 60-second presigned Blob URL (which serves Range) while `?download=1` streams through the route; whether long-video seeking works on iOS against the 60 s URL, and whether Blob enforces `validUntil`/`maximumSizeInBytes` on multipart parts, were "declined to judge" and left for the Task 10 preview/iPhone tests. If seeking fails, add Range/206 to `/api/media/[id]`. Cost noted: content headers come from the blob host, not the route.
- Why deferred / reasoning given: §11 #7 Low; repeatedly "unrelated, stays a Task 10 item".
- Verdict: PARTIAL (Blob-enforcement half moot; seeking half NEEDS-ROB)
- Evidence: `features/media/serve-media.ts:9` `PRESIGN_TTL_MS = 60_000`, inline views 302 to the blob host (line 108-109); `app/api/upload/route.ts:65-67` passes `allowedContentTypes`/`maximumSizeInBytes`/`validUntil`; whatever Blob enforces per part, `features/memories/ingest-upload.ts:69-77` re-checks size and content type from `head()` after the upload and deletes an offending blob, so enforcement on multipart parts no longer matters for correctness. Seeking on iOS against the 60 s URL has no evidence anywhere (`docs/plans/phase1-ledger.md:160` "remain to be checked"; `docs/plans/2026-11-02-phase1-findings.md:46` "Not yet tested").
- Remaining work (if any): on an iPhone, open a claim page with a >2 min video and scrub/let it play past 60 s; Safari issues fresh Range requests over time, and a request after the URL expires would 403 mid-playback. If it does, raise `PRESIGN_TTL_MS` (15 min is plenty) or add 206 to the route.
- Launch impact: SHOULD — cheap to test; playback only matters on the claim page (collection-only), but a video that stalls after a minute is exactly the kind of thing a grieving relative would report.
- Merge with: M-H-03

### M-B-06: Cron purge gaps: PENDING blobs on deleted memories; no per-row retry bound
- Sources: LEDGER-FR-6, PR22-4, DOC-82
- Kind: Deferred minor
- What: Step (f) never deletes blobs of PENDING media on deleted memories (`blobUrl` null); a row whose `storage.del` keeps throwing is re-selected first every run; add `purgeAttempts`/`lastPurgeError` if it ever happens (Blob `del` is idempotent, so it has not).
- Why deferred / reasoning given: low; PR #22 added purge logic but closure not confirmed.
- Verdict: OPEN (minor)
- Evidence: step (f) selector `app/api/cron/reconcile-uploads/route.ts:399-416` only takes rows with `blobUrl` set or derived rows; step (a) line 121 excludes `memory: { deletedAt: null }`, so a PENDING row on a deleted memory is never re-recorded or failed; `prisma/schema.prisma` has no `purgeAttempts`/`lastPurgeError`. Mitigation: `app/api/upload/route.ts:61` refuses a token once the memory is deleted, so only a blob that landed with neither callback nor finalize before the delete can be orphaned.
- Remaining work (if any): add `{ status: "PENDING", memory.deletedAt < grace }` to (f) with a `head()`-then-`del()`; add an attempts column only if a `del` ever keeps throwing.
- Launch impact: LATER — storage pennies, no family-visible effect.
- Merge with: none

### M-B-07: Cron step (a) marks FAILED without `status: PENDING` in the `where`
- Sources: LEDGER-FR-5, DOC-82
- Kind: Deferred minor
- What: A row that moved on between select and update could be flipped to FAILED. Add the status guard to the `where`.
- Why deferred / reasoning given: final-review minor.
- Verdict: NITPICK
- Evidence: `app/api/cron/reconcile-uploads/route.ts:135` `db.media.update({ where: { id: row.id }, data: { status: "FAILED" } })` after `recordMedia` answered PENDING for a row older than 24 h; the window is the few ms between that `head()` miss and the update, on a file that has been missing for a day.
- Remaining work (if any): one-line `where: { id, status: "PENDING" }` with P2025 tolerated.
- Launch impact: LATER — practically unreachable.
- Merge with: none

### M-B-08: Replaying finalize restarts the inline hash and can resend a FAILED email without backoff
- Sources: LEDGER-FR-11, DOC-82
- Kind: Deferred minor
- What: `finalizeUpload` replay while `checksumSha256` is null restarts hashing; a FAILED email can be resent with no backoff.
- Why deferred / reasoning given: final-review minor.
- Verdict: OPEN (minor)
- Evidence: `features/memories/ingest-upload.ts:216-232` runs `confirmQuietly` + the `after()` work again on a READY replay (`computeChecksum` early-returns once stored, line 160, so only an in-flight hash is duplicated); `services/email/index.ts:162-168` claims a FAILED row regardless of `nextAttemptAt` (only cron step (d) honours it). The browser retries finalize once (`lib/submission-pipeline.ts:186-188`), and for sends finalize never emails (line 219), so the resend case is confined to legacy single memories.
- Remaining work (if any): skip the `after()` block when `recordMedia` reports an already-READY row; have `deliver()` respect `nextAttemptAt` on the request path.
- Launch impact: LATER — no family-visible effect; at worst a duplicate SendGrid attempt on a legacy row.
- Merge with: none

### M-B-09: Server Functions do not zod-validate raw input shape; `/api/upload` parses JSON outside `try`
- Sources: LEDGER-FR-3, LEDGER-FR-4, DOC-82
- Kind: Deferred minor
- What: `finalizeUpload`, `updateMemory`, `finalizeAddedFile` take raw args (a non-string token is a 500); `/api/upload` parses the body outside the `try` (malformed body → unhandled 500).
- Why deferred / reasoning given: final-review minors.
- Verdict: PARTIAL
- Evidence: `app/api/upload/route.ts:37` still `await request.json()` before the `try`; `app/share/actions.ts:30` and `app/m/[claimToken]/actions.ts:57,69` take typed-but-unparsed `{ ticket, claimToken }` / `{ claimToken, changes }` (`changes` is zod-parsed in `features/memories/claim.ts:178`; the token is not); `lib/claim-token.ts:14` `hashClaimToken` throws on a non-string and `lib/sentry/server-action.ts:16-19` has no catch, so a crafted POST is a 500. All other Server Functions (`createSubmission`, `issueUploadTicket`, `completeSubmission`, `addFileTicket`, `replaceFileTicket`, `removeFile`, …) are `safeParse`d.
- Remaining work (if any): a `z.object({ ticket: ticketSchema, claimToken: z.string().min(16).max(128) })` in `finalizeUpload` and `updateMemoryFromClaim`; wrap the JSON parse in `/api/upload`.
- Launch impact: LATER — only a hand-crafted request hits it; the browser never sends these shapes; effect is a 500 and a Sentry event, no data impact.
- Merge with: none

### M-B-10: Budget checks race at READ COMMITTED; admin drafts count against `DAILY_MEMORY_BUDGET`
- Sources: LEDGER-FR-9, DOC-82, DOC-163, PR30-42
- Kind: Deferred minor
- What: `withinBudget` in `createMemory`/`createUploadTicket` can over-admit under concurrency (WAF rule is the stated mitigation, see M-H-01); admin drafts share the same daily budget (intended cost ceiling; revisit if Rob drafts in volume).
- Why deferred / reasoning given: WAF mitigates; low volume.
- Verdict: OPEN (accepted; one launch note)
- Evidence: `features/memories/create-memory.ts:69-85` `withinBudget` counts inside the interactive transaction with no serialisation; `features/memories/draft-memory.ts:61` `withinBudget(tx, 0, 1)` and the count has no `source` filter, so drafts share the budget; `docs/plans/phase1-ledger.md:41` "[ ] WAF rate-limit rule created" is still unticked. Defaults: `server/config/env.ts:67-68` 200 memories and 20 GB per rolling day.
- Remaining work (if any): nothing for the race. Note for M-H-01: the byte budget is counted from `Media.maxBytes`, which for claim-page adds is the kind's ceiling, not the file's size; the launch values should be checked with that in mind.
- Launch impact: LATER — over-admission by a handful under true concurrency only; the budget is a cost ceiling, not a safety rule.
- Merge with: M-H-01 (WAF rule and launch budget values)

### M-B-11: `filename*` leaves `'()*!` unencoded (RFC 8187 nit)
- Sources: LEDGER-FR-10, DOC-82
- Kind: Deferred minor
- What: Download header encoding nit on `/api/media/[id]`; not injectable.
- Why deferred / reasoning given: cosmetic.
- Verdict: DONE
- Evidence: `lib/media-types.ts:163-165` `encodeRfc8187` percent-encodes `'()*` (commit 74f0c00, Team Code Review PR #6); `!` is an RFC 8187 `attr-char` and must stay literal; test `__tests__/api/media.test.ts:136` "percent-encodes RFC 8187 attr-char exceptions".
- Remaining work (if any): none.
- Launch impact: NEVER — closed.
- Merge with: none

### M-B-12: Accepted lease-renewal race (cron rotates after a claim-page ticket renews the lease)
- Sources: DOC-94, DOC-95, DOC-208, PR28-18, PR16-15, LEDGER-X5
- Kind: Risk/open question
- What: Cron (e3) reads an expired lease, a claim-page ticket renews it, the cron rotates; that upload's finalize fails but the Blob callback still records the file.
- Why deferred / reasoning given: accepted (low), recorded in the ledger.
- Verdict: NOT-DEBT (accepted residual)
- Evidence: `features/memories/upload-lease.ts:21-28` renews on the anchor in one `UPDATE`; `features/memories/complete-submission.ts:179-181` reads the lease before, not under, the rotation write; the window needs a claim-page add in the seconds after an 80-minute lease lapsed on a send ≥30 min old that never got its receipt. `app/api/upload/route.ts` and the callback still record the file; only that one finalize answers `not_found`.
- Remaining work (if any): none unless observed.
- Launch impact: LATER — the file is kept, the receipt still lists it after the cron run.
- Merge with: none

### M-B-13: Claim-token rotation: no "send me a new link", no `UPLOAD_TICKET_SECRET_PREVIOUS`
- Sources: DOC-68, DOC-69, DOC-78, DOC-86, PR3-F11, LEDGER-T8-1, LEDGER-TCR-6, PR27-7
- Kind: Follow-up
- What: Raw tokens are never stored, so the cron cannot rebuild a link; `confirmMemory()` without a raw token rotates `claimTokenHash` and the emailed link supersedes the on-screen one (step (e) waits 30 min and only runs with an address; `completeSubmission` settles with whatever is READY and lets the cron rotate later). Cost: an on-screen link that dies after the email arrives. §11 #11 asks for a "send me a new link" Server Function and accepting `UPLOAD_TICKET_SECRET_PREVIOUS` for 15 minutes during a secret rotation.
- Why deferred / reasoning given: Low; rotation-on-send gives the guarantee without new tables.
- Verdict: OPEN (as designed)
- Evidence: `grep -rn SECRET_PREVIOUS server lib` is empty; `lib/upload-ticket.ts:60-62` signs with the one secret; `features/memories/draft-memory.ts:144-170` `reissueDraftClaimLink` is DRAFT-only (`status: "DRAFT"` in the `where`); no contributor-facing reissue. Important correction to the catalog text: on the normal path `completeSubmission` passes the raw tokens (`complete-submission.ts:304`), so nothing rotates and the on-screen links stay valid; rotation only happens on the cron path after a browser died (`confirm.ts:91-97`, `complete-submission.ts:208-213`).
- Remaining work (if any): a "send me my link again" Server Function keyed by email would need a new email type; `UPLOAD_TICKET_SECRET_PREVIOUS` only matters during a secret rotation (none planned).
- Launch impact: LATER — a lost email means asking an admin; for collection-only, a relative can simply share again.
- Merge with: M-E-09 (secret rotation runbooks)

### M-B-14: Cron response omits `recipient_capped` / budget-refusal counts
- Sources: DOC-79, LEDGER-T9-1
- Kind: Deferred minor
- What: Nothing persists those counts; they are only logged, so the daily summary must come from Vercel logs until a counter table exists.
- Why deferred / reasoning given: plan deviation accepted.
- Verdict: NITPICK
- Evidence: `Counts` at `app/api/cron/reconcile-uploads/route.ts:67-79` has no cap/refusal fields; skips are logged (`services/email/index.ts:130`) and, since PR #33, every receipt attempt emits a Sentry metric with the skip reason (`features/memories/complete-submission.ts:163` `confirmationSent(...)`), which is where a 100-person launch would read it.
- Remaining work (if any): none worth doing; a Sentry metric query answers the question.
- Launch impact: LATER.
- Merge with: none

### M-B-15: `Memory.deletedAt` re-checks in ticket paths and cron (e3) after admin delete
- Sources: PR22-5, PR31-21, DOC-215
- Kind: Follow-up
- What: PR #22 said "add the same `deletedAt` re-check to `createUploadTicket`/`createReplacementTicket` when memory deletion ships"; PR #31 shipped soft delete but declined a `deletedAt` filter on cron step (e3) (3.6). Confirm both paths behave on a soft-deleted memory.
- Why deferred / reasoning given: low; blocked on deletion existing (now true).
- Verdict: DONE
- Evidence: `features/memories/create-memory.ts:148` and `:190` return `not_found` for `memory.deletedAt !== null` inside the locked transaction of both `createUploadTicket` and `createReplacementTicket` (present since 061cf0c/08e9dcb); `app/api/upload/route.ts:61` refuses the token exchange; `ingest-upload.ts:206` rejects finalize. Cron (e3) is deliberately unfiltered: `docs/plans/2026-11-04-admin-page.md:111` and reconcile test C6 (`__tests__/api/reconcile.test.ts:548-549`) pin that a deleted anchor's live siblings still get their receipt.
- Remaining work (if any): none.
- Launch impact: NEVER — closed.
- Merge with: none

### M-B-16: Replacement cannot explicitly clear inherited words (`null` vs omitted)
- Sources: PR27-1
- Kind: Follow-up
- What: `resolveFile` collapses omitted and `null` to `null` and the inherit step uses `??`, so a replacement always keeps the target's caption/date/place. When Replace gains per-file fields: keep `undefined` (inherit) distinct from `null` (clear) through `ResolvedFile`; cover omitted / empty / `null` in the replacement tests.
- Why deferred / reasoning given: no caller sends words with a replacement today (Low).
- Verdict: NOT-DEBT (latent)
- Evidence: `features/memories/create-memory.ts:62-64` collapses omitted/empty to `null` and `:209-215` inherits with `??`; `lib/validations/media.ts:13-15` lets a replace request carry words, but the only caller `app/m/[claimToken]/media-list-client.tsx:175` sends `{ name, type, size }` only.
- Remaining work (if any): only when Replace gains per-file fields (M-C-09 territory).
- Launch impact: NEVER for launch (no caller can hit it).
- Merge with: M-C-09

## C. Visitor UI: share form, recorder, claim page, consent

### M-C-01: Wrong claim token answers HTTP 200 with a not-found body (PR #30 F7; decide)
- Sources: DOC-77, DOC-82, DOC-174, LEDGER-T8-2, PR30-27
- Kind: Follow-up
- What: `app/m/[claimToken]/page.tsx` calls `notFound()` inside `<Suspense>`, which streams a 200 shell. Either move the lookup before the shell or accept it (256-bit bearer tokens; enumeration infeasible). Decide and record.
- Why deferred / reasoning given: Low; undecided.
- Verdict: OPEN (decision only; code unchanged)
- Evidence: `app/m/[claimToken]/page.tsx:21-37` still calls `notFound()` inside `<Suspense>` below a static shell; `docs/plans/phase1-ledger.md:108` "wrong token → not-found body (HTTP 200, deferred minor)". Tokens are 32 random bytes base64url (`lib/claim-token.ts:4,10`), so enumeration is not a concern.
- Remaining work: record the decision (accept) in the ledger; or move the lookup above the Suspense boundary (loses the static shell, which the Cache Components rule wants).
- Launch impact: LATER — nobody in the family will hit a wrong token; the status code only matters to crawlers and monitors.
- Merge with: none

### M-C-02: `ClaimView` sends the contributor email (and an untyped `id`) to the client
- Sources: DOC-82, DOC-173, LEDGER-FR-2, PR30-26, PR32-5
- Kind: Deferred minor
- What: Drop `email` from the `select` in `getMemoryForClaim` and from `ClaimView` (the form never shows it); `contributor.id` now rides along at runtime for Sentry identity but the type omits it, so strip or declare it. Update `__tests__/features/claim.test.ts`. Note the Sentry identity work reads the contributor in the browser, which may argue for keeping `email` deliberately.
- Why deferred / reasoning given: Low.
- Verdict: NITPICK (the email part is now deliberate; only the type nit remains)
- Evidence: `features/memories/claim.ts:104` selects `id, name, relationship, email, contactOptIn`; `ClaimView.contributor` (`claim.ts:82`) omits `id` while the runtime object carries it. `app/m/[claimToken]/claim-form.tsx:26-29` now reads `memory.contributor?.email` in the browser for Sentry identity (PR #33, plan 2026-11-04 §8.3), so `email` must stay in the view.
- Remaining work: declare `id: string` on the `ClaimView.contributor` type (or strip it in the mapper) and update `__tests__/features/claim.test.ts:73`.
- Launch impact: LATER — the only person who can see the page already owns that email; no leak.
- Merge with: none

### M-C-03: `share-form.tsx` `canRecord` hydration mismatch
- Sources: LEDGER-FR-1
- Kind: Deferred minor
- What: `canRecord` was computed from `window` during render; use an effect or `useSyncExternalStore`.
- Why deferred / reasoning given: final-review minor.
- Verdict: DONE
- Evidence: `app/share/share-form.tsx:139` `const canRecord = useSyncExternalStore(subscribeNever, () => pickRecordingType() !== null, () => false);` with the C9 comment; `docs/plans/2026-11-02-phase1-findings.md:45` records the fix; Task 15 verification reports "no hydration warnings" (`phase1-ledger.md:228`).
- Remaining work: none (close the ledger line at `phase1-ledger.md:147`).
- Launch impact: NEVER — resolved.
- Merge with: none

### M-C-04: Claim form stale overwrite of admin corrections (A8); preference flags via direct POST
- Sources: DOC-222, PR31-26, DOC-163, PR30-44
- Kind: Follow-up
- What: The sender's old tab sends every field on save and overwrites an admin correction. Add `version` to `ClaimView` and `claimChangesSchema`, dirty-only submission in `claim-form.tsx`, `stale` in `updateMemoryFromClaim` with the same re-read protocol as admin §4.3. Also a crafted POST can change the two preference flags on a non-DRAFT memory (UI does not send them; link holder owns the memory).
- Why deferred / reasoning given: touches public UI shared with other open work (M).
- Verdict: OPEN
- Evidence: `features/memories/claim.ts:26-41` `claimChangesSchema` has no `version`; `updateMemoryFromClaim` (`claim.ts:175-280`) has no `stale` branch; `claim-form.tsx:33-48` sends every field on every save. `preferencesEditable = sharing || fresh.status !== "DRAFT"` (`claim.ts:225`) lets a crafted POST flip `notifyWhenPosted`/`contactOptIn` on a non-DRAFT memory. `docs/plans/2026-11-04-admin-page.md:364,382` records A8 as not done.
- Remaining work: `version` on `ClaimView` + schema, dirty-key submission in `claim-form.tsx`, `stale` result with the admin §4.3 re-read protocol; restrict the two flags to the form's own paths or accept (link holder owns the memory).
- Launch impact: LATER — needs an admin correction AND a sender saving from an older tab afterwards; during collection admin edits will be rare, and the overwrite is of the sender's own memory with a MemoryRevision trail either way.
- Merge with: M-C-06 (both are "the claim save accepts more than the form offers"; one PR on `claim.ts` + `claim-form.tsx` + claim tests)

### M-C-05: Claim form `not_found` copy (A6); claim heading streams with content
- Sources: DOC-221, PR31-25, PR30-43
- Kind: Deferred minor
- What: Claim form shows "Could not save. Please check the fields" when the memory was deleted while the page was open; add `not_found` → "This memory is no longer available" to the `claim-form.tsx` message map. Cosmetic: the page heading now streams with the content instead of the static shell (heading depends on status).
- Why deferred / reasoning given: Low.
- Verdict: OPEN (the copy); NOT-DEBT (the heading)
- Evidence: `app/m/[claimToken]/claim-form.tsx:49-59` message map handles `last_words` only; `not_found` falls through to "Could not save. Please check the fields and try again." The heading lives inside `ClaimContent` by design (`page.tsx:40` comment: it depends on status).
- Remaining work: add `result.code === "not_found" ? "This memory is no longer available." : …` to the map (one line).
- Launch impact: LATER — only reachable if an admin deletes a memory while its sender has the page open.
- Merge with: M-C-04 (same two files)

### M-C-06: `features/memories/claim.ts` still accepts PRIVATE from a crafted claim-page save
- Sources: PR35-5
- Kind: Deferred minor
- What: The form no longer offers PRIVATE, but a crafted request can set it on a non-PRIVATE memory (only the sender's own memory affected). Allow PRIVATE only when `before.visibility === "PRIVATE"`, else invalid; add a test beside the claim tests.
- Why deferred / reasoning given: Low; Rob decides.
- Verdict: OPEN
- Evidence: `claim.ts:37` `visibility: z.enum(["PUBLIC", "FAMILY", "PRIVATE"]).optional()`; `claim.ts:237` `visibility: input.visibility ?? before.visibility` with no `before.visibility === "PRIVATE"` guard; `__tests__/features/claim.test.ts:110` even saves PRIVATE from the claim path. Quick-fixes plan `:271,279` lists it as bucket 4.
- Remaining work: allow `PRIVATE` only when `before.visibility === "PRIVATE"`, else `invalid`; adjust `claim.test.ts:110-112` and add the negative case.
- Launch impact: LATER — needs a crafted request, affects only the sender's own memory, and PRIVATE is the most restrictive value (nothing becomes more visible).
- Merge with: M-C-04

### M-C-07: Desktop-layout leftovers from #35/#36 (`resize-y`, `sm:` two-up, lone placeholder, declined-to-judge)
- Sources: PR35-6, PR35-7, PR35-12, PR36-5, PR36-6, PR36-7
- Kind: Deferred minor
- What: (1) `resize-y` on the words textarea is inert at `roomy` because `flex-1` sets `flex-basis: 0%`; `roomy:basis-auto` restores the drag (`app/share/memory-card-client.tsx`). (2) About-you grid goes two-up on landscape phones via `sm:grid-cols-2`; use `wide:grid-cols-2` / `wide:col-span-2` if D1 (phone decisions by `wide:`/`narrow:`) should hold. (3) Lone placeholder in the left column when cards are open/open/closed at `roomy`. (4) Declined-to-judge, standing as is: `defaultValue={remembered?.email}` hydration timing, the draft not saving the email, the unreachable `MAX_CARDS_NOTICE`.
- Why deferred / reasoning given: low/cosmetic; bucket-4 candidates after merge.
- Verdict: NITPICK
- Evidence: (1) `app/share/memory-card-client.tsx:143` textarea has `roomy:min-h-[300px] roomy:max-h-[calc(100dvh-14rem)] roomy:flex-1` and `textareaClass` adds `resize-y` (`app/_components/field-classes.ts:10`); no `roomy:basis-auto`, so the drag is still inert at `roomy`. (2) `share-form.tsx:310` About-you grid is still `grid gap-5 sm:grid-cols-2 roomy:grid-cols-3`. (3)/(4) stand as ruled at `2026-11-04-share-form-quick-fixes.md:272`: `defaultValue={remembered?.email}` (`share-form.tsx:338`), draft never stores email (`lib/share-draft.ts:9-10`), `MAX_CARDS_NOTICE` reachable only via the reducer (`lib/memory-cards.ts:78,296`).
- Remaining work: `roomy:basis-auto` on the textarea; swap `sm:` for `wide:` on the About-you grid if D1 should hold; the rest is cosmetic.
- Launch impact: LATER — phones (the family's main device) never see `roomy` or two-up; desktop readers can still type without resizing.
- Merge with: none

### M-C-08: Claim-page add/replace wording and no-op revision minors (PR #22)
- Sources: PR22-1, PR22-2, PR22-3
- Kind: Deferred minor
- What: A FAILED replacement is shown as "not received yet" and blocks Replace; a PENDING finalize is reported as "could not be accepted"; cancelling a pending replacement writes a no-op `MemoryRevision`.
- Why deferred / reasoning given: low.
- Verdict: PARTIAL
- Evidence: PR22-2 done: PENDING finalize says "still being checked" (`claim-form.tsx:84`, `media-list-client.tsx:168,213`). PR22-3 done: cancelling a replacement names `cancelledReplacementOf` so the revision is not a no-op (`claim.ts:329-333`). PR22-1 half done: Replace is disabled only while `pending?.status === "PENDING"` (`media-list-client.tsx:321`), but the pending block at `media-list-client.tsx:296-301` says "has not been received yet" for a FAILED replacement too, with "Cancel it".
- Remaining work: branch the replacement line on `pending.status` ("could not be accepted; the original is still here" + "Clear it").
- Launch impact: LATER — a FAILED replacement needs a wrong-type/too-large file on the second attempt; wording only.
- Merge with: none

### M-C-09: Per-file caption/date/place on the share form (D10) parked for Rob
- Sources: DOC-93, DOC-204, PR16-9, PR28-14, DOC-208, PR16-15, LEDGER-X5, DOC-210, PR28-30
- Kind: Risk/open question
- What: The share-form card carries date, place and words per memory; the `Media.caption/approxDateText/place` columns and `updateMediaFromClaim` from PR #27 were kept, so per-file words are editable on the claim page only. D10 amends Rob's issue #17 ruling and was flagged to him.
- Why deferred / reasoning given: UX and technical review agreed the card covers the need; "for Rob".
- Verdict: NEEDS-ROB (decision; nothing to build unless he asks)
- Evidence: `docs/plans/2026-11-03-share-redesign.md:33,412` D10 "Flag to Rob"; `phase1-ledger.md:222,225` "D10 stands for the share form; the per-file words are editable on the claim page only" (`media-list-client.tsx:265-283` has the per-file caption/when/where form). No acknowledgement from Rob in any ledger.
- Remaining work: Rob confirms D10 (card-level date/place/words on /share, per-file words on the claim page) or asks for per-file fields on /share.
- Launch impact: LATER — the form collects everything the family needs; per-file words exist on the claim page.
- Merge with: none

### M-C-10: Sibling-memories list on the claim page
- Sources: PR28-15, DOC-208, PR16-15
- Kind: Follow-up
- What: A list of the other memories from the same send on each claim page. A "note when name and relationship are shared by a send" was built instead.
- Why deferred / reasoning given: out of scope for Task 15.
- Verdict: NOT-DEBT (declined follow-up; a note was built instead)
- Evidence: `claim-form.tsx:117-121` shows "This is memory N of the M you sent together…" from `memory.submission` (`claim.ts:93,129-132`); no sibling links on the page; `phase1-ledger.md:229` lists "sibling list on the claim page" as out of scope.
- Remaining work: none unless a family member asks where their other memories went (the receipt email lists every link).
- Launch impact: NEVER — the receipt email already carries every link.
- Merge with: none

### M-C-11: Slice C: in-page webcam recording on computers (release 2) and Safari video container
- Sources: DOC-206, PR16-7, PR28-25, DOC-92, PR29-1, PR28-20, DOC-208
- Kind: Follow-up
- What: C1 `recorder.ts` audio/video profile (mp4 first then webm vp9/vp8, ~2 Mbps, 1280×720@30 `facingMode: "user"`, `previewing` state, auto-stop near 95 % of 500 MB, skip `fix-webm-duration` above ~100 MB); C2 camera help for `NotAllowedError`/`NotFoundError`/`NotReadableError` plus `videoinput` list; C3 `video-recorder-panel-client.tsx` with muted autoplay preview; C4 video fakes in `__tests__/stubs/browser-audio.ts`, Chromium fake-camera smoke and a device pass (Safari MediaRecorder video support is undocumented on MDN).
- Why deferred / reasoning given: D7 release 2; computers upload video files today.
- Verdict: NOT-DEBT (release 2 by D7; not started)
- Evidence: no `app/share/video-recorder-panel-client.tsx`; `app/share/recorder.ts:39` `CANDIDATES` are audio-only; `phase1-ledger.md:220` "Slice C (in-page webcam recording) is release 2 and not started". Computers can upload a video file today (`ACCEPT_ATTRIBUTE`).
- Remaining work: the C1–C4 plan as written, when Rob wants release 2.
- Launch impact: NEVER — phones use their own camera; desktop uploads work.
- Merge with: none

### M-C-12: In-browser recorder on the claim page (PR #30 F4)
- Sources: DOC-171, PR30-24, PR30-9, DOC-165
- Kind: Follow-up
- What: Import `AudioRecorder` and `pickRecordingType` from `app/share/recorder.ts`, follow the `share-form.tsx` integration (meter, permission help, release on unmount), upload through the ticket flow with `contentType`. The file input already accepts audio files.
- Why deferred / reasoning given: L; product non-goal for the draft feature.
- Verdict: NOT-DEBT (product non-goal for the draft feature)
- Evidence: `grep recorder app/m/[claimToken]` returns nothing; the claim page's file input accepts audio (`claim-form.tsx:106` `ACCEPT_ATTRIBUTE`); `docs/plans/2026-11-03-draft-memory-on-behalf.md` F4 marked L / non-goal.
- Remaining work: none now. Note the rough edge: a person opening a DRAFT claim link on an iPhone cannot record a voice memory in place (only pick a file), so an admin-drafted memory gets voice only via /share.
- Launch impact: LATER — admin drafts are the minority path; /share has the recorder.
- Merge with: none

### M-C-13: No "not you? clear" control for remembered contributor fields on a shared device
- Sources: PR16-4
- Kind: Deferred minor
- What: `lib/remembered-contributor.ts` prefills name/email from localStorage; a second person on the same device has no one-click clear. (Sentry identity staleness across people is M-F-05.)
- Why deferred / reasoning given: review nit "for later".
- Verdict: OPEN
- Evidence: `share-form.tsx:325-367` prefills name/email/relationship from `remembered` with no clear button; `lib/remembered-contributor.ts` exposes no clear function used by UI; the fields are ordinary inputs, so the second person can overtype.
- Remaining work: a small "Not you? Clear these" tertiary button that calls `localStorage.removeItem` and resets the three inputs (and the draft notice).
- Launch impact: LATER — a shared iPad in a grieving household is plausible, but overtyping works and the email is validated; Sentry identity staleness is M-F-05.
- Merge with: M-F-05 (same fix point; clearing the remembered contributor should also reset the Sentry user)

### M-C-14: `Memorial.defaultVisibility` read by nothing; Prisma defaults `FAMILY` while the form defaults `PUBLIC`
- Sources: PR16-6
- Kind: Deferred minor
- What: Validation always supplies a value, so the column defaults are inert; `Memorial.defaultVisibility` is dead. Decide whether to align or drop.
- Why deferred / reasoning given: borderline; no behaviour impact.
- Verdict: NITPICK
- Evidence: `prisma/schema.prisma:85` is the only reference to `defaultVisibility` in the tree; `Memory.visibility @default(FAMILY)` (`schema.prisma:133`) vs `lib/validations/memory.ts:70,172` `.default("PUBLIC")`; every create path passes a value, so the column default never fires.
- Remaining work: drop the dead column in a future migration, or align the column default to PUBLIC; no behaviour change either way.
- Launch impact: LATER — inert.
- Merge with: none

### M-C-15: Consent as shipped: no checkbox, wording pending Rob, v1 not marked superseded
- Sources: PR11-1, PR16-5, DOC-122, DOC-39, PR3-R10, LEDGER-D2, DOC-99, DOC-21
- Kind: Risk/open question
- What: Rob skipped the storage-consent checkbox (friends and family); one implicit-consent sentence sits under Send; the contact-preference checkbox stays; `consentVersion`/`consentedAt` are still recorded. `lib/consent.ts` / `docs/consent/2026-11-v1.md` began as DRAFT wording "pending Rob"; v2 (2026-11-03) supersedes v1 but v1 is not marked superseded. With email now required (PR #35) the "contact checkbox on, no email" edge is moot; `docs/consent/2026-11-v2.md` still describes it.
- Why deferred / reasoning given: Rob's decision; wording confirmation outstanding.
- Verdict: PARTIAL + NEEDS-ROB
- Evidence: live wording is Rob's v2 sentence (`lib/consent.ts:12-13`, shown at `share-form.tsx:460` and `claim-form.tsx:177`). Docs: `docs/consent/2026-11-v1.md` carries no "superseded" marker; `2026-11-v2.md:7` still describes "checked but gives no email" although email is required since PR #35 (`lib/validations/memory.ts:42-69`). The ledger decisions table still says `CONSENT_VERSION` = `2026-11-v1` in Vercel (`phase1-ledger.md:26`); the draft-memory plan lists `CONSENT_VERSION=2026-11-v2` in Vercel as Rob's step, status "no" (`2026-11-03-draft-memory-on-behalf.md:73,224`); no ledger line records it done. `docs/environment.md:64` already describes v2.
- Remaining work: Rob: confirm the v2 sentence as final and verify `vercel env ls production` shows `CONSENT_VERSION=2026-11-v2` (Production + Preview). Repo: mark v1 superseded, drop the moot "no email" sentence from v2.
- Launch impact: SHOULD — if Vercel still carries `2026-11-v1`, every memory shared at launch is stamped with the wrong consent version while the page shows the v2 sentence (a records mismatch, not a leak); a two-minute dashboard check.
- Merge with: M-C-15 env half likely duplicates an env-var item in area I/J (Vercel env vars); the doc half stays here

### M-C-16: Recorder open questions: silent-clip root cause unconfirmed, −60 dBFS tunable, no hook/canvas tests
- Sources: DOC-198, DOC-202, PR21-10, PR21-11, PR21-13
- Kind: Risk/open question
- What: The production silent clip on Rob's Mac is unconfirmed (likeliest: macOS input volume at zero or an idle Bluetooth/virtual default device); the Mac-Chrome-denied-mic row is part of the unrun matrix (M-H-04). The silence threshold is one constant in `lib/audio-level.ts`; the `unknown`-keeps-clip rule makes discarding safe. Engine lifecycle tests exist (20 in `__tests__/app/recorder.test.ts`); hook and canvas have none.
- Why deferred / reasoning given: warn-not-delete chosen by Rob; tunable later.
- Verdict: OPEN (risk acknowledged; nothing further to do until a device run says otherwise)
- Evidence: `lib/audio-level.ts:2` `SILENCE_THRESHOLD_DBFS = -60`; `docs/plans/2026-11-03-recorder-feedback.md:7,437` cause "unconfirmed", likeliest macOS input volume / idle Bluetooth device. Tests: `__tests__/app/recorder.test.ts`, `__tests__/lib/{audio-level,recorder-state,recorder-help,recording-devices}.test.ts`; none for `app/share/use-recorder.ts` or `level-meter-client.tsx` (vitest `environment: "node"`, no DOM). The silent-clip path warns and offers "Send anyway" (`share-form.tsx:248-253,451-455`).
- Remaining work: run the Mac Chrome/Safari rows of the device matrix (M-H-04) and watch for `suspectedSilent` verdicts in Sentry after launch; retune the constant only if real clips are misjudged.
- Launch impact: LATER — the guard rails (meter, warning, playback, "Send anyway", clip never discarded) cover the family case; a silent clip is recoverable by re-recording.
- Merge with: M-H-04 (the unrun device matrix is the only way to close this)

### M-C-17: `durationSeconds` is client-reported and display-only; picked files have no duration
- Sources: DOC-200, PR21-12, PR21-4, PR22-10, PR27-6, DOC-198, DOC-196, PR20-3
- Kind: Risk/open question
- What: Only in-browser recordings carry a duration (zod `z.int().min(0).max(86400)`, shown as "Voice recording · 2:14"); `fix-webm-duration` swallows failures and resolves the original blob, so wall-clock vs media duration is a known limitation; measuring a picked audio file client-side or probing on the server was declined.
- Why deferred / reasoning given: a media probe in the ingest path is out of scope; hint is display-only and capped.
- Verdict: NOT-DEBT (accepted limitation)
- Evidence: `share-form.tsx:183` sets `durationSeconds` only for in-browser recordings; `features/memories/complete-submission.ts:53,130` and `claim.ts:63,153` only pass it through; shown as "2:14" under the player (`media-list-client.tsx:278`). The plan declined server probing.
- Remaining work: none.
- Launch impact: NEVER — a missing or slightly-off duration label hurts nobody.
- Merge with: none

### M-C-18: Existing silent production recording and historical `durationSeconds = null` rows (no backfill)
- Sources: PR21-6, DOC-197
- Kind: Deferred minor
- What: One 24 s silent `audio/webm` row (`4e14e723…`) in production; delete by hand. Durations only for new recordings.
- Why deferred / reasoning given: low; no backfill.
- Verdict: NEEDS-ROB (production data; delete on /admin)
- Evidence: PR #21 notes the one silent `audio/webm` row (`4e14e723…`); no ledger line says it was removed; the admin page can delete memories (`docs/admin.md`, 30-day grace). No backfill by design.
- Remaining work: Rob (or an admin) deletes that test memory on `/admin` before launch, or leaves it as the admins' own test row.
- Launch impact: LATER — it is a family-admin test row, invisible to contributors (nothing is displayed in Phase 1).
- Merge with: none

### M-C-19: iOS has no `beforeunload`; drafts never hold media
- Sources: PR28-19, DOC-208, PR16-15
- Kind: Risk/open question
- What: Draft v2 saves words only; on iOS a navigation away loses attached files (the draft is saved before any picker opens as mitigation).
- Why deferred / reasoning given: known platform limitation.
- Verdict: NOT-DEBT (platform limitation, mitigated)
- Evidence: `lib/share-draft.ts:9-10` words only; `app/share/use-share-draft.ts:88-107` saves on `visibilitychange`/`pagehide` and `onBeforeCamera={saveDraftNow}` (`share-form.tsx:420`); `beforeunload` guard is desktop-only by comment (`share-form.tsx:208`); `phase1-ledger.md:229` lists iOS `beforeunload` as out of scope.
- Remaining work: none feasible (files cannot be persisted from the page on iOS without the File System API).
- Launch impact: LATER — an iPhone user who leaves the tab re-picks the photo; the typed words survive, which is the painful part.
- Merge with: none

### M-C-20: Claim-page thumbnails/posters (F10, D9)
- Sources: DOC-155, PR20-15
- Kind: Follow-up
- What: "The claim page does not use previews yet" (needs a tokenized derived-media route). PR #25 added `?v=thumb` to the token-gated media route and the admin gallery uses thumbs; whether the claim page now does is unrecorded.
- Why deferred / reasoning given: out of scope for the email work.
- Verdict: PARTIAL (web copy yes, thumbnails no)
- Evidence: `media-list-client.tsx:231` `src = /api/media/${id}?t=…` with no `v=thumb`; `mediaVariantFrom(null)` → `"web"` (`features/media/serve-media.ts:32-34`), and the card waits for `web.status === "ready"` (`media-list-client.tsx:236-249`), so the claim page shows the sanitized web copy at column width, never the original. Videos have no poster.
- Remaining work: none needed for a ≤10-file page at 760px; `?v=thumb` only if claim pages get long.
- Launch impact: LATER — web copies are already sized for the page.
- Merge with: none

### M-C-21: Right-hand rail on desktop: revisit after the 2560 evidence (ruling 4)
- Sources: PR35-15
- Kind: Risk/open question
- What: Rob chose a single 1040px column with side-by-side rows; PR #36 measured 1.52 screens at 2560×1440. "Rail remains possible later."
- Why deferred / reasoning given: UX review: a rail shows Send before a word is typed.
- Verdict: NEEDS-ROB (decision; no work pending)
- Evidence: `docs/plans/evidence/2026-11-share-quick-fixes/README.md:59,61` 2190px = 1.52 screens at 2560×1440 (was 2.02); `phase1-ledger.md:234` ruling 4 "single column at 1040px… no right-hand rail"; `quick-fixes.md:255` "rail remains possible later".
- Remaining work: Rob looks at `b-2560x1440.jpeg` and says whether 1.52 screens is fine.
- Launch impact: NEVER — the family is on phones; the desktop page is already one and a half screens.
- Merge with: none

## D. Email

### M-D-01: Email Task 4: thumbnails for legacy `confirmMemory`; base64 budget; 30 MB transport guard
- Sources: DOC-89, DOC-90, DOC-158, DOC-189, PR20-2, PR20-8, PR20-10, PR20-22, PR25-1, PR27-2, PR28-31, LEDGER-X2, LEDGER-X3, PR20-21
- Kind: Follow-up
- What: Contract (PR #25): a usable thumbnail is a `DerivedMedia` row `kind = THUMBNAIL`, `status = READY`, `image/jpeg`, `sizeBytes ≤ 350000`, width/height set, key under `derivedPrefix()` and not a staging key; read with `storage.get`, attach inline as `preview-<mediaId>`, first 4, ≤ 1.5 MB total measured in base64 (4 × 350 KB raw ≈ 1.87 MB on the wire), 8 s deadline; never read PENDING/FAILED or build URLs from keys. Task 15 moved the attachment point to the send receipt (`completeSubmission`, up to 10 s wait, D16), so `confirmMemory` for legacy single memories still sends no previews. Add a transport-level 30 MB guard in `integrations/sendgrid/index.ts` `assertAttachmentContract` once previews are attached.
- Why deferred / reasoning given: blocked on issue 17 PR A, then re-homed by Task 15.
- Verdict: PARTIAL
- Evidence: receipts attach thumbnails: `features/memories/complete-submission.ts:85` reads READY `THUMBNAIL` rows, `:110-143` fetches at most `MAX_PREVIEW_FETCHES = 4`, after the D16 10 s wait (`:291-300`); per-preview ≤ 350 KB enforced in `services/email/templates/shared.ts:23,102-109` (`usablePreview`), so the wire size is bounded at ~1.9 MB. Not done: `media-summary.ts:37` still `preview: null`, so `confirmMemory` (legacy/cron only) **and the admin alert** carry no thumbnails; no 8 s fetch deadline and no total-bytes or 30 MB guard in `integrations/sendgrid/index.ts:65-74` `assertAttachmentContract`.
- Remaining work (if any): decide whether admins want thumbnails in the alert (one `derivatives` include in `notifyAdminsOfMemory` + the same `readBase64`); a transport guard is a 5-line addition; legacy `confirmMemory` previews are moot once no new memory takes that path.
- Launch impact: LATER — every family send gets thumbnails in its receipt; admins have the admin page.
- Merge with: none

### M-D-02: Per-recipient delivery state via SendGrid Event Webhook (F15)
- Sources: DOC-129, PR26-4, DOC-128, PR26-12
- Kind: Follow-up
- What: Gmail accepts, Hotmail rejects, the `EmailLog` row still says SENT (one row per memory per type by design, R3). Pick-up: Event Webhook → per-recipient table keyed by `sendgridMessageId` + address; surface bounces in the cron summary. First check: both inboxes after the first production alert (M-H-09).
- Why deferred / reasoning given: low until a bounce is seen.
- Verdict: OPEN
- Evidence: `app/api/` holds only `admin`, `cron`, `media`, `upload`; `EmailLog.sendgridMessageId` (`prisma/schema.prisma:260`) is stored but nothing consumes events; SENT means "SendGrid accepted" (`services/email/index.ts:99-101`).
- Remaining work (if any): webhook route + per-recipient table; only if a bounce is ever seen.
- Launch impact: LATER — the first production alert to both admin inboxes is the check (M-H-09).
- Merge with: M-H-09

### M-D-03: Alert and receipt for later claim-page edits or added files (F13)
- Sources: DOC-130, PR26-5, PR20-9
- Kind: Follow-up
- What: One alert and one confirmation per memory today; files added later from the claim page appear in neither. Needs a second alert type or an "updated" flag; edit paths are `app/m/[claimToken]/actions.ts` and `features/memories/claim.ts`.
- Why deferred / reasoning given: low; pre-existing.
- Verdict: OPEN
- Evidence: `EmailType` has three members (`prisma/schema.prisma:67-71`); `features/memories/claim.ts` and `features/admin/*` import nothing from `services/email`; `finalizeAddedFile` → `finalizeUpload` skips email for send memories (`ingest-upload.ts:219`) and answers `already_sent` for legacy ones.
- Remaining work (if any): an "updated" email type or flag; the admin page's revision history already shows the edit.
- Launch impact: LATER — collection-only; nothing is lost, admins can see the change.
- Merge with: none

### M-D-04: Daily digest instead of one admin alert per memory (F14)
- Sources: DOC-131, PR26-6
- Kind: Follow-up
- What: A cron step grouping `ADMIN_NEW_MEMORY` rows by day if volume grows; the no-cap ruling (R4) is deliberate for launch.
- Why deferred / reasoning given: low; launch volume.
- Verdict: NOT-DEBT (deliberate R4 for launch volume)
- Evidence: `services/email/index.ts:257-276` one uncapped alert per memory; no digest step in the cron.
- Remaining work (if any): none unless volume hurts (100 people × a few memories = a few hundred alerts to two inboxes over weeks).
- Launch impact: NEVER.
- Merge with: M-D-05

### M-D-05: One admin alert per send instead of per memory (D18, parked for Rob)
- Sources: DOC-205, PR16-10, PR28-22, DOC-93, LEDGER-X5, DOC-208, PR16-15
- Kind: Risk/open question
- What: Rob's rule (PR #26) is one alert per memory; Task 15 schedules them with `after()` at `completeSubmission` so each lists every file (`settleNow`). D18 "one alert per send" is marked proposed and parked for Rob.
- Why deferred / reasoning given: Rob's ruling stands until he says otherwise.
- Verdict: NEEDS-ROB (decision)
- Evidence: `features/memories/complete-submission.ts:311-316` one `notifyAdminsQuietly(..., { settleNow: true })` per live memory after the response; `docs/plans/2026-11-03-share-redesign.md:41` D18 "(proposed) … parked for Rob".
- Remaining work (if any): Rob says yes or no; a per-send alert would be a fourth `EmailType` on the anchor.
- Launch impact: LATER — Rob's standing rule works; a 5-memory send is 5 alerts, which admins have accepted.
- Merge with: M-D-04, M-I-11

### M-D-06: "Your story is posted" notice (`MEMORY_POSTED`) not built; November 10th promise
- Sources: DOC-122, DOC-170, PR30-23, PR16-1, PR16-2, PR30-12, DOC-215, PR31-21
- Kind: Follow-up
- What: `Memory.notifyWhenPosted` (on by default) is stored and nothing sends it. New `EmailType` `MEMORY_POSTED`, template in `services/email/templates/`, trigger when `status` becomes `APPROVED`, honour `notifyWhenPosted` and the per-recipient cap; admin-drafted memories are eligible. The thank-you screen says "On November 10th … we'll email an update to all who have contributed", which relies on this or the Phase 2 mailer (M-J-03). Removing the checkbox was declined.
- Why deferred / reasoning given: Phase 2 mailer; PR #31 declined "posted" email on APPROVED.
- Verdict: OPEN (Phase 2)
- Evidence: no `MEMORY_POSTED` in `EmailType`; `features/admin/set-status.ts:18` "nothing public reads APPROVED/HIDDEN yet and nothing emails"; `Memory.notifyWhenPosted` stored (`schema.prisma:134`) and shown read-only on `app/admin/memory-detail.tsx:35`; the promise is live copy at `app/share/thank-you-client.tsx:61` ("On November 10th … we'll be sharing them with everyone").
- Remaining work (if any): the email belongs to the Phase 2 mailer; the launch-relevant piece is only that the thank-you copy makes a dated promise someone must keep (by hand if need be).
- Launch impact: LATER — nothing breaks; the promise is an obligation on Rob, not on the code.
- Merge with: M-J-03

### M-D-07: "Nudge" email for unshared DRAFT rows (admin A5, PR #30 F2 second half)
- Sources: DOC-117, DOC-169, DOC-220, PR31-24, PR30-22, PR30-11
- Kind: Follow-up
- What: Admin detail already lists DRAFT age; add a Nudge button with a new `EmailType` and template, honouring `OUTBOUND_*`. Listing and reissue were delivered by the admin page (PR #31).
- Why deferred / reasoning given: M; out of PR #31 scope.
- Verdict: OPEN
- Evidence: `grep -rni nudge app features lib services` is empty; `docs/plans/2026-11-03-draft-memory-on-behalf.md:378-379` records listing/reissue delivered by PR #31 and the nudge still open.
- Remaining work (if any): new `EmailType`, template, admin button honouring `OUTBOUND_*`.
- Launch impact: LATER — admins can nudge by hand; drafts are a side path.
- Merge with: none

### M-D-08: Per-recipient email cap bypassed by plus-tag address variants
- Sources: LEDGER-FR-7, DOC-82
- Kind: Deferred minor
- What: The cap (now 15/day, D15) keys on the literal address; `name+tag@` variants bypass it. Normalise or accept (WAF is the abuse control).
- Why deferred / reasoning given: final-review minor.
- Verdict: NITPICK
- Evidence: `services/email/index.ts:145-153` counts rows by the literal `recipientEmail` (lower-cased and trimmed only, `:231,248`); cap is 15/day (D15, `:44`) and exists to protect a contributor from their own retries, not as abuse control (`:39-43`).
- Remaining work (if any): none; normalising `+tag` would also mis-merge legitimately distinct Gmail aliases.
- Launch impact: NEVER for a family of 100.
- Merge with: none

### M-D-09: SendGrid link branding not created; open tracking disabled; interim single-sender box unchecked
- Sources: DOC-24, DOC-98, LEDGER-T6-1, LEDGER-O4, DOC-73
- Kind: Deferred minor
- What: Domain authentication validated 2026-11-03, so the interim Single Sender Verification was likely never needed (ledger box unchecked, dates blank). Link branding (two more CNAMEs) was not set up because click tracking is disabled; the test email arrived with an open-tracking pixel, so the transport now sends `openTracking.enable = false`.
- Why deferred / reasoning given: by design.
- Verdict: DONE-PER-LEDGER (one stale checkbox)
- Evidence: open tracking off in the transport `integrations/sendgrid/index.ts:104-107` (`clickTracking` and `openTracking` `enable: false`); domain authentication id 33798852 **valid 2026-11-03** (`docs/plans/phase1-ledger.md:93-95`); link branding not created by ruling (`phase1-ledger.md:94`); the interim single-sender box `phase1-ledger.md:43` is still "[ ]" with blank dates because it was never needed.
- Remaining work (if any): strike the ledger box as "not needed: domain validated 2026-11-03".
- Launch impact: NEVER.
- Merge with: M-I-12 (stale ledgers/unticked boxes)

## E. Admin page, admin API, drafts on behalf

### M-E-01: Move public pages into `app/(site)/` so admin drops the public header/footer (A1)
- Sources: DOC-216, PR31-28, PR31-21, DOC-215
- Kind: Follow-up
- What: `app/layout.tsx` keeps html/body/fonts; `app/(site)/layout.tsx` gets `SiteHeader`/`SiteFooter`; `git mv` `page.tsx`, `share/`, `obituary/`, `m/`; relative `_components` imports gain one `../`. Do it when no other worktree touches those files.
- Why deferred / reasoning given: L; conflicts with open worktrees.
- Verdict: OPEN
- Evidence: no `app/(site)` directory (`ls app` → `_components admin api m obituary page.tsx share …`); `app/admin/layout.tsx` still renders under the root layout's `SiteHeader`/`SiteFooter` (admin-page plan §3.8 "my call", §10 "No route-group refactor").
- Remaining work: the `git mv` refactor described in the plan A1, once no worktree touches `page.tsx`, `share/`, `obituary/`, `m/`.
- Launch impact: LATER — cosmetic for the few family admins; the public header above the admin bar is odd but harmless.
- Merge with: none

### M-E-02: Paging and sorting past ~200 memories (A2)
- Sources: DOC-217, PR31-27
- Kind: Follow-up
- What: Cursor on `(createdAt, id)` in `listMemoriesForAdmin`; "Older" link; keep `take: 200`; no sorting controls or bulk actions today.
- Why deferred / reasoning given: L; ~100 contributors expected.
- Verdict: OPEN
- Evidence: `features/admin/list-memories.ts:8` `ADMIN_LIST_TAKE = 200`, `:76` `take: ADMIN_LIST_TAKE`, comment "paging is follow-up A2"; the list reports `shown`/`total` so the UI can say "Showing 200 of N".
- Remaining work: cursor on `(createdAt, id)` + "Older" link.
- Launch impact: LATER — ~100 contributors; the search box and status chips cover the gap until the count passes 200.
- Merge with: none

### M-E-03: Per-person attribution of admin changes (A3; needs a user table)
- Sources: DOC-218, PR31-22
- Kind: Follow-up
- What: `MemoryRevision.changedByUserId` is null for every admin change; the revision says ADMIN only. Blocked by D5 (no users/Auth.js now; see M-J-05).
- Why deferred / reasoning given: M; D5.
- Verdict: OPEN (blocked by decision D5)
- Evidence: `features/admin/update-memory.ts:128`, `set-status.ts:39`, `set-deleted.ts:42` write `changedVia: "ADMIN"` with no `changedByUserId`; `prisma/schema.prisma:232` `changedByUserId String?` is never set.
- Remaining work: needs a user table / login (M-J-05); nothing to do until then.
- Launch impact: LATER — a handful of trusted family admins; the revision history still shows what changed and when.
- Merge with: M-J-05 (same prerequisite)

### M-E-04: Media delete/replace/upload from admin (A4) and `--attach` for drafts from the script (F13)
- Sources: DOC-219, PR31-23, DOC-179, PR30-32, PR31-13
- Kind: Follow-up
- What: Media is view-only in admin (D4). A4: reuse `retireMedia`, the ticket flow and `finalizeUpload` behind `hasAdminSession()`. F13: `--attach <memoryId> <file>` in `scripts/draft-memory.ts` backed by an admin ticket route limited to DRAFT so Rob never opens a draft's page (whose only button is the sender's consent); reuse `createPendingMedia` + tickets + `finalizeUpload`.
- Why deferred / reasoning given: M; issue #17 claim-page flow landed first.
- Verdict: OPEN
- Evidence: `app/admin/media/[id]/route.ts` exports `GET` only (view); `app/api/admin/memories/**` has only `POST /` (draft) and `POST /[id]/claim-link` (reissue); `scripts/draft-memory.ts:28` usage is `--input | --reissue` only; `docs/admin.md` "Files are view-only here"; SKILL.md:55 "`--attach` is follow-up F13".
- Remaining work: admin-session-guarded ticket/finalize/retire routes; `--attach` backed by a DRAFT-only ticket route.
- Launch impact: LATER — the claim page already lets the sender add/replace/remove files; admins can ask the person. Only bites if someone sends a photo by email and cannot use their link.
- Merge with: M-E-11 (F5 ingest attachments is the other half of F13)

### M-E-05: Admin page deferred minors (#31 review) and the conservative stale rule
- Sources: PR31-1, PR31-2, PR31-3, PR31-4, DOC-212, DOC-225
- Kind: Deferred minor
- What: `features/admin/session.ts` `age >= 0` rejects a cookie minted on a slightly-ahead clock (add a small negative tolerance); `app/admin/memory-detail.tsx` passes the whole `AdminMemoryView` (revisions JSON, contributor phone) to the client edit form; the rail on `app/admin/memories/[id]/page.tsx` lists with the empty query so a filter resets; stale banner says "Someone changed this memory" when only hidden columns moved (mostly avoided by auto-retry). Two admins editing contributor fields of sibling memories: the second sees `stale` even if fields differ (deliberately conservative).
- Why deferred / reasoning given: minors; Rob decides.
- Verdict: OPEN (all four minors unchanged; stale rule is a decision)
- Evidence: `features/admin/session.ts:57` `return age >= 0 && age <= ADMIN_SESSION_MS` (no negative tolerance); `app/admin/memory-detail.tsx:81` `<MemoryEditForm memory={memory} />` passes the whole `AdminMemoryView` (revisions, contributor) to the client form; `app/admin/memories/[id]/page.tsx:32` rail calls `listMemoriesForAdmin({})` (filter resets); `memory-edit-form.tsx:125-127,167` only-hidden-columns case auto-retries once, then says "Someone changed this memory". Conservative sibling stale rule is documented as deliberate in plan §4.3.
- Remaining work: optional: `age >= -60_000` tolerance; narrow the client prop; carry the list query into the detail rail.
- Launch impact: NITPICK/LATER — clock skew of seconds on a cookie minted by the same server is rare; the over-wide client prop ships data the admin may already see (phone of a contributor), no secret.
- Merge with: none (the stale rule half is NOT-DEBT)

### M-E-06: Withdraw or correct a draft via the API (F12)
- Sources: DOC-178, PR30-31
- Kind: Follow-up
- What: A DRAFT with the wrong excerpt: `deletedAt` works but the unique `sourceRef` blocks a redraft (409) and reissue answers `not_found`. Add `POST /api/admin/memories/[id]/withdraw` (conditional on DRAFT: set `deletedAt`, rewrite `sourceRef` to `withdrawn:<id>`), `--withdraw` in the script, and make the 409 report a deleted row.
- Why deferred / reasoning given: M.
- Verdict: PARTIAL
- Evidence: no `withdraw` route under `app/api/admin/memories/[id]/`; `features/memories/draft-memory.ts:57-59,120-124` answers `duplicate` on `sourceRef` regardless of `deletedAt`; `:154-159` reissue answers `not_found` for a deleted row. Mitigation shipped by PR #31: the admin page can edit a DRAFT's words (`docs/admin.md` "Drafts") and soft-delete it.
- Remaining work: `POST …/withdraw` (rewrite `sourceRef` to `withdrawn:<id>`), `--withdraw` in the script, 409 body says the existing row is deleted.
- Launch impact: LATER — the common fix (wrong excerpt) is now a browser edit; the only dead end is "redraft the same Gmail message after deleting", which Rob can work around by editing instead.
- Merge with: none

### M-E-07: `sameEmail` hint on `POST /api/admin/memories` (F14)
- Sources: DOC-180, PR30-33
- Kind: Follow-up
- What: A follow-up Gmail message ("here's the photo") has a new id and makes a second draft; return `sameEmail: [{ memoryId, status }]` and have the skill show them to Rob before drafting.
- Why deferred / reasoning given: L.
- Verdict: OPEN
- Evidence: `app/api/admin/memories/route.ts:30` success body is `{ memoryId, claimLink }` only; `grep sameEmail` finds nothing outside the plan.
- Remaining work: a `findMany` by contributor email in `draftMemory` and a line in the skill.
- Launch impact: LATER — drafts are run by Rob one at a time; the admin list's search by email shows the same thing by hand.
- Merge with: none

### M-E-08: Verify a claim link without using it (F15)
- Sources: DOC-181, PR30-34, PR30-39, DOC-164
- Kind: Follow-up
- What: `POST /api/admin/memories/[id]/claim-link/verify` taking a raw token, read-only, bearer-protected; until then the skill says "probably live" and shows the `memoryId`.
- Why deferred / reasoning given: L.
- Verdict: OPEN
- Evidence: no `claim-link/verify` route (`find app/api/admin -type f` → `_auth.ts`, `memories/route.ts`, `memories/[id]/claim-link/route.ts`); SKILL.md:95 still says "probably the link … probably still live" and shows the `memoryId`.
- Remaining work: read-only bearer route comparing the token hash.
- Launch impact: LATER — only matters when a session dies between POST and the Gmail draft; the reissue path exists.
- Merge with: none

### M-E-09: Secret rotation runbooks and residual exposure (`ADMIN_API_SECRET` F16; `ADMIN_PAGE_SECRET` never exercised)
- Sources: DOC-110, DOC-182, PR30-35, PR31-32, DOC-114, DOC-113
- Kind: Follow-up
- What: Write `docs/runbooks/admin-api-secret-rotation.md`: generate, `vercel env rm` + `vercel env add … production` from a mode-600 file, redeploy (older deployments keep the old value until gone), replace the `.env` line, verify 401/200 (a 409 duplicate works); Preview has no `ADMIN_API_SECRET` by design. `docs/admin.md` documents `ADMIN_PAGE_SECRET` rotation (signs everyone out; needs Standard Protection, M-A-07) and the accepted residuals (browser history of the entry link; request log of `POST /admin/enter` method and path only); rotation has never been run.
- Why deferred / reasoning given: M; short version lives in `docs/environment.md`.
- Verdict: PARTIAL
- Evidence: `docs/runbooks/` does not exist (`ls: cannot access 'docs/runbooks'`); the short procedures do exist: `docs/environment.md:80` (`ADMIN_API_SECRET` rotation: `vercel env rm/add`, redeploy, 401 check) and `docs/admin.md` "Rotating the secret" (`ADMIN_PAGE_SECRET`, 5 steps, Standard Protection caveat). Neither rotation has been run (plan ledgers L15/L16 todo; draft plan "ADMIN_API_SECRET in Vercel Production: no").
- Remaining work: the full runbook file with exact commands; one dry run of each rotation after launch settings exist.
- Launch impact: LATER — the steps are written where an agent will look; rotation only matters after an exposure. Depends on M-A-07 (Standard Protection) for the page secret.
- Merge with: M-A-04, M-A-05, M-A-07 (the env/protection prerequisites)

### M-E-10: Draft skill runs from the shared, often-stale main checkout (F11); symlink target
- Sources: DOC-177, PR30-30, PR30-4
- Kind: Follow-up
- What: A detached tools worktree at `origin/main` (e.g. `../jowray_tools`) fetched and reset before each run; move `~/.claude/skills/jowray-draft-memory` there. Interim: the SKILL.md preflight refuses a checkout that differs from `origin/main`; the symlink resolves since PR #30 merged.
- Why deferred / reasoning given: M; premortem P4 interim guard accepted.
- Verdict: PARTIAL (interim guard built; worktree is NEEDS-ROB)
- Evidence: `docs/skills/jowray-draft-memory/SKILL.md:24` preflight: `git fetch -q origin main && git diff --quiet origin/main -- scripts/draft-memory.ts lib/source-ref.ts docs/skills/… || echo "STOP: …differs from origin/main"`. The `../jowray_tools` worktree and the `~/.claude/skills` symlink live on Rob's Mac; not checkable here (`~/.claude/skills` in this container has only `session-start-hook`, `synced`).
- Remaining work: Rob creates the detached tools worktree and repoints the symlink (or keeps relying on the STOP guard).
- Launch impact: LATER — the guard refuses rather than runs stale code; worst case is a refused draft run.
- Merge with: none

### M-E-11: Ingest email attachments into a draft automatically (F5)
- Sources: DOC-172, PR30-25, PR30-10
- Kind: Follow-up
- What: Blocked on a Gmail tool that returns attachment bytes; when available, download to the scratchpad, mint a ticket via the admin API (new endpoint, M-E-04 F13) or the claim-link upload, finalize, delete the local file. The skill flags attachments so Rob adds them through the claim link.
- Why deferred / reasoning given: L; tool gap.
- Verdict: OPEN (tool gap unchanged)
- Evidence: the Gmail connector in this session exposes `get_message`, `get_thread`, `create_draft`, … and no attachment-download tool; SKILL.md:55 "the skill cannot download them … invites the sender to add the photo on their own page".
- Remaining work: blocked until a Gmail tool returns bytes; then needs the M-E-04 F13 ticket route.
- Launch impact: LATER — the reply email already asks the sender to add the photo on their page.
- Merge with: M-E-04

### M-E-12: Draft expiry/cleanup policy for memories nobody shares (F10)
- Sources: DOC-183, PR30-36
- Kind: Follow-up
- What: Decide keep-forever vs soft-delete after N months (Rob's say-so); a cron step over `status = DRAFT AND createdAt < now - N`.
- Why deferred / reasoning given: not urgent; drafts are invisible and cost nothing.
- Verdict: NEEDS-ROB (policy decision)
- Evidence: no cron step over `status = DRAFT AND createdAt < …` in `app/api/cron/reconcile-uploads/route.ts`; draft plan F10 "Not urgent: drafts are invisible and cost nothing"; admin list shows DRAFT age so a human can decide.
- Remaining work: Rob picks keep-forever vs N months; one cron step if the latter.
- Launch impact: NEVER (for launch) — drafts are invisible, silent, and visible to admins; nothing is lost by waiting.
- Merge with: none

### M-E-13: First real draft runs (Joyce, then Bridget) and connector-mailbox check
- Sources: DOC-160, DOC-184, PR30-2
- Kind: Ops step (Rob)
- What: Use synthetic contributors until Rob says "run it for real". Joyce (single message, `thread-f`), Rob sends the reply, watch DRAFT → PENDING; then Bridget (reply in Rob's thread; has an attachment). Check `authuser` in a `viewUrl` first because the threads live in whichever mailbox the planning session's connector used. Done-check: `SELECT status FROM "Memory" WHERE "sourceRef" IN ('gmail:1a1a2317fba34eec','gmail:1a1a1ad3b27b64e4')`.
- Why deferred / reasoning given: real people; Rob's go.
- Verdict: NEEDS-ROB
- Evidence: draft plan ledger rows "First real run (Joyce) | no" and "Second real run (Bridget) | no" (`docs/plans/2026-11-03-draft-memory-on-behalf.md:78-79`); the `authuser` caveat is recorded in the Gmail-probe row (`:74`). Prerequisites `ADMIN_API_SECRET` in Vercel Production / `.env` are also "no" in the same ledger (M-A-04).
- Remaining work: Rob says "run it for real"; set `ADMIN_API_SECRET` first; check the connector mailbox; run Joyce, then Bridget; tick the ledger with the SQL check.
- Launch impact: SHOULD — these are two real people who already sent memories; not a code risk, but the promise to them is outstanding and the path (secret + skill) has never been exercised against production.
- Merge with: M-A-04

### M-E-14: Every future lister of memories must decide explicitly what to do with DRAFT
- Sources: PR30-45
- Kind: Risk/open question
- What: Standing rule from the draft plan; the admin list shows DRAFT chips; Phase 2 public pages must exclude DRAFT (and HIDDEN/PRIVATE) explicitly.
- Why deferred / reasoning given: rule for future code.
- Verdict: NOT-DEBT (standing rule)
- Evidence: admin list includes DRAFT deliberately with chips (`list-memories.ts` `adminStatusCounts` DRAFT/PENDING/APPROVED/HIDDEN); today no public `findMany` over `Memory` exists (Phase 2 not built), so nothing violates it.
- Remaining work: none now; the rule belongs in the Phase 2 plan (M-J-01) as an acceptance line.
- Launch impact: NEVER — no public lister exists in the collection-only launch.
- Merge with: M-J-01 (carry the rule there)

## F. Sentry, logging, observability

### M-F-01: Sentry §10 manual checklist in sentry.io (GitHub + Seer, alert notifications, IP storage, quota)
- Sources: DOC-227, PR34-2
- Kind: Ops step (Rob)
- What: 1 connect GitHub + Seer for `RobertdWray/jowray_com`; 2 keep the default issue alert, add "User Feedback received" and "Replay with error" notifications to Rob; 3 leave "Prevent Storing of IP Addresses" off, keep default scrubbers, do not rely on Advanced Data Scrubbing for replays; 4 glance at quota after week one; 5 Vercel: nothing to add.
- Why deferred / reasoning given: needs a Sentry login.
- Verdict: NEEDS-ROB
- Evidence: Sentry plan §10 (lines 391-397) is a sentry.io-only list; §16 ledger 18:25 row: "Not run: … the Sentry UI checks (login)"; no later ledger row records §10 or the §11.4 production smoke.
- Remaining work: Rob (or an agent with a Sentry login): connect GitHub + Seer, add "User Feedback received" and "Replay with error" notifications, confirm IP storage stays on, glance at quota after week one.
- Launch impact: SHOULD — without the two notifications, a family member's "Report a problem" submission or a replay with an error only shows up if someone opens sentry.io; the default issue alert still emails errors, so not a blocker. ~10 minutes of clicking.
- Merge with: M-H-11 (same login, same sitting)

### M-F-02: Wrap admin Server Functions with `instrumentedAction`; tag `submission_id` in the browser
- Sources: PR33-4, PR32-4, PR28-17, DOC-95, DOC-208, PR16-15, DOC-237
- Kind: Follow-up
- What: `app/admin/actions.ts` exports are not wrapped (one import and one wrapper per export, pattern in `app/share/actions.ts`; the `key` argument is already a secret field). §8.3 says `submission_id` becomes a browser tag after a successful send but `share-form.tsx` does not call `tagIds({ submissionId })` (the server tags it). The older "Sentry `withServerActionInstrumentation`" parking-lot item is satisfied by `instrumentedAction` for the share/claim functions.
- Why deferred / reasoning given: low; both PRs merged independently.
- Verdict: OPEN (both halves)
- Evidence: `grep instrumentedAction app/admin/actions.ts` → nothing; the wrapper is used only in `app/share/actions.ts:17-31` and `app/m/[claimToken]/actions.ts:26-55`. `grep tagIds app/share/share-form.tsx` → nothing (only `identifyContributor` at :148, :290); the server tags it in `features/memories/create-submission.ts:159` and `complete-submission.ts:285`. `key` is already on `SECRET_FIELD_KEYS` (`lib/sentry/secrets.ts:12`) so wrapping `enterAdmin` is safe.
- Remaining work: six one-line wrappers in `app/admin/actions.ts` (+ the `admin-actions.test.ts` mock); optionally `tagIds({ submissionId })` after a successful send in `share-form.tsx`.
- Launch impact: LATER — admin errors still reach Sentry through `onRequestError`/Pino `fatal`; they just lack the `serverAction/<name>` span and scrubbed input context. Admin is a few family members.
- Merge with: none

### M-F-03: Expected-path catches emit noise events (recorder teardown, `use-share-draft` storage probe)
- Sources: PR32-7, DOC-237
- Kind: Deferred minor
- What: `recorder.ts` reports the expected "already disconnected" error per node on `release-stop`/`disconnect`; `use-share-draft.ts` reports every failed `localStorage` access (one per debounced save when site data is blocked; doubled by Strict Mode). Drop the two recorder reports and rate-limit the storage report if volume shows up.
- Why deferred / reasoning given: noise only, accepted for the alpha.
- Verdict: OPEN (accepted noise)
- Evidence: `app/share/recorder.ts:313-315` (`release-stop`, comment "Already stopping") and `:525-528` (`disconnect`, comment "Already disconnected") still call `reportClientError`; `app/share/use-share-draft.ts:10-13` reports every `localStorage` access throw (`step: "storage"`), called per debounced save.
- Remaining work: drop the two recorder reports; rate-limit or `once` the storage report. Decide after seeing the first week's issue list.
- Launch impact: LATER — noise in Sentry only; with 100 % error sampling a phone in private browsing could produce dozens of `share-draft/storage` events per session, which costs quota and attention, not family experience. Revisit in week one.
- Merge with: none

### M-F-04: Browser Sentry identity can go stale across people on one device
- Sources: PR32-6, DOC-237
- Kind: Deferred minor
- What: The claim page sets the user; `/share` re-identifies only when the remembered contributor changes or on Send. `clearContributor()` on claim-form unmount would close it.
- Why deferred / reasoning given: minor.
- Verdict: OPEN
- Evidence: `clearContributor()` is exported from `lib/sentry/user.ts:29` and called nowhere (`grep -rn clearContributor app/ lib/` → definition only); `claim-form.tsx:26` identifies on mount, `share-form.tsx:148,290` on remembered contributor and on send.
- Remaining work: `clearContributor()` in the claim-form unmount effect; optionally on `/share` when the remembered fields are cleared.
- Launch impact: LATER — mis-attributed replays only when two family members share one phone in one browser session; tags (`memory_id`) still identify the right memory.
- Merge with: M-C-13 (the "not you? clear" control would be the natural place to call it)

### M-F-05: Scrubber side effects: `key` filters Replay keyboard breadcrumbs; JSON re-serialisation; bare `#` dropped
- Sources: PR33-7, PR33-8, PR31-5
- Kind: Deferred minor
- What: `key` as a whole-key secret (added so `enterAdmin`'s argument never reaches `server_action_input`) also turns `ui.keyDown` → `data.key: "[Filtered]"`, so replays no longer show which key was pressed; option: scope the exact match to `server_action_input`. `scrubText` re-serialises JSON-looking strings (whitespace, number formatting, big-int precision; app ids are strings). After a token is scrubbed from a log line a bare `#` followed by whitespace is dropped too.
- Why deferred / reasoning given: low/cosmetic.
- Verdict: NITPICK
- Evidence: `lib/sentry/secrets.ts:12` `key` on `SECRET_FIELD_KEYS` (whole-key, so `ui.keyDown` `data.key` becomes `[Filtered]`); `lib/sentry/scrub.ts:158-165` parses JSON-looking text and re-`stringify`s it; `:45-48` strips a trailing bare `#`/`?`/`&` after a scrubbed token.
- Remaining work: optionally scope the `key` exact match to `server_action_input`; nothing else worth doing.
- Launch impact: NITPICK/LATER — replays lose which key was pressed (clicks and typed text are still recorded unmasked); re-serialisation changes whitespace, not meaning; all ids in this app are strings.
- Merge with: none

### M-F-06: Token-free claim URLs (F1) and presigned Blob URLs in replay breadcrumbs (F6)
- Sources: DOC-231, DOC-236, PR34-14, PR34-15
- Kind: Follow-up
- What: `/m/<token>` sets an `HttpOnly` cookie scoped to `/m` and 302s to `/m/edit`; media routes read the cookie instead of `?t=`. Removes the accepted replay residual (token in `/m/*` recording URLs) and the `Referrer-Policy` dance. Touches `app/m/[claimToken]/page.tsx`, `app/api/media/[id]/route.ts`, `lib/claim-token.ts`, emails. Presigned Blob redirect URLs (60 s) in replay network breadcrumbs are acceptable now; revisit with F1.
- Why deferred / reasoning given: "only worth doing if the alpha outgrows family only".
- Verdict: NOT-DEBT (accepted residual; conditional follow-up)
- Evidence: `app/m/[claimToken]/page.tsx` still carries the token in the path; Sentry plan §2 row "Replay on `/m/<token>` pages: Recorded … Rob accepts that one residual"; §15 F1 "Only worth doing if the alpha outgrows family only"; F6 "Acceptable now".
- Remaining work: none unless the audience changes; then the cookie + `/m/edit` redesign touching page, media route, `lib/claim-token.ts` and both emails.
- Launch impact: NEVER (for this launch) — Rob's explicit ruling for the family-only alpha.
- Merge with: M-K-17 (same accepted residual), M-F-13 (the same token in Vercel request logs)

### M-F-07: Automated browser envelope test (F2) and known Sentry test gaps (R3, R9, R10)
- Sources: DOC-232, PR32-3, DOC-239, PR34-16, PR34-17, PR34-18, PR34-19
- Kind: Follow-up
- What: Playwright against `next dev` with `/sentry-tunnel` intercepted, asserting no `SENTRYTEST_` string leaves (replaces the manual §11.1 check; rrweb and the compression worker do not run under jsdom). Known gaps: the envelope test cannot exercise stack-frame locals offline (`LocalVariablesAsync` only via the inspector; `stackFrameVariables` deny list is the guard); no render test for `app/global-error.tsx` or the browser init; the envelope header's trace context repeats the root span name, unreachable by `beforeSendSpan` (no app span carries a token).
- Why deferred / reasoning given: Low; no DOM test harness (M-I-01).
- Verdict: OPEN
- Evidence: no Playwright in `package.json` (`grep playwright package.json` → nothing); `__tests__/` has no browser harness; the server-side gate exists (`__tests__/lib/sentry-envelope.test.ts`) and the manual §11.1 browser check was run on PR 3's preview (ledger 18:25 row: "a browser error arrived through the tunnel … no cookie/bypass/token in the event"). Gaps R3 (frame locals via inspector only) and the `global-error.tsx`/browser-init render tests remain untested.
- Remaining work: Playwright harness (M-I-01) intercepting `/sentry-tunnel`; a jsdom render test for `global-error.tsx`.
- Launch impact: LATER — the server envelope test plus the manual preview check cover the leak question for launch; this is regression insurance.
- Merge with: M-I-01 (the harness is the prerequisite)

### M-F-08: Node (server) profiling when Node 26 binaries ship (F3)
- Sources: DOC-118, DOC-233, PR34-5
- Kind: Follow-up
- What: No prebuilt `@sentry/profiling-node` binary for Node 26; Rob chose not to pin Vercel to 24. When binaries ship add `nodeProfilingIntegration()` + `profileSessionSampleRate: 1.0`, `profileLifecycle: "trace"` to `instrumentation.ts`.
- Why deferred / reasoning given: Low; upstream.
- Verdict: OPEN (upstream-blocked; Rob's ruling to skip)
- Evidence: `@sentry/profiling-node` not in `package.json`; `instrumentation.ts` has no `nodeProfilingIntegration`; Sentry plan §2 "Node (server) profiling: Skip for now; Vercel runs Node 26.x … Approved"; `@types/node ^26.6.6`.
- Remaining work: watch `@sentry/profiling-node` releases; two lines in `instrumentation.ts` when a Node 26 binary exists.
- Launch impact: NEVER (for launch) — browser profiling is on; server profiling is a nice-to-have.
- Merge with: none

### M-F-09: Per-segment `error.tsx` boundaries calling `reportClientError` (F4)
- Sources: DOC-234, PR33-5
- Kind: Follow-up
- What: `app/share/error.tsx` and `app/m/[claimToken]/error.tsx` so a render error does not replace the whole layout; each calls `reportClientError` and offers `retry()`. ESLint already has the `app/**/error.tsx` pattern.
- Why deferred / reasoning given: Low; separate UX work.
- Verdict: OPEN
- Evidence: `find app -name error.tsx` → none; only `app/global-error.tsx` exists, so any render error on `/share` or `/m/*` replaces the whole page with the crash dialog.
- Remaining work: `app/share/error.tsx` and `app/m/[claimToken]/error.tsx` with `reportClientError` + `reset()`; ESLint already matches `app/**/error.tsx`.
- Launch impact: SHOULD — a render error mid-share (e.g. a bad file preview) drops a grieving person to a full-page crash screen instead of a "try again" inside the page; small (two ~30-line files), real UX gain if a crash does happen. Not a blocker: no known render error exists and the global dialog still lets them report it.
- Merge with: none

### M-F-10: Cron partial-failure alerting (F5)
- Sources: DOC-235, PR33-6
- Kind: Follow-up
- What: An `error` check-in needs two consecutive failures (`failureIssueThreshold: 2`); consider a metric alert on `reconcile.run{errors>0}` for one-off failures.
- Why deferred / reasoning given: Low.
- Verdict: OPEN (half code decision, half NEEDS-ROB)
- Evidence: `app/api/cron/reconcile-uploads/route.ts:42` `failureIssueThreshold: 2`; `lib/sentry/metrics.ts:25-27` emits `reconcile.run` with `errors` attribute; no metric alert exists in the repo (alerts live in sentry.io; §10 not run).
- Remaining work: either `failureIssueThreshold: 1` (one line) or a metric alert on `reconcile.run{errors>0}` in sentry.io.
- Launch impact: LATER — a single failed reconcile run self-heals on the next 10-minute tick; two in a row already alert. The step-level Pino logs and per-item isolation scopes still create issues for thrown errors.
- Merge with: M-F-01 (same sentry.io session)

### M-F-11: Ending the alpha telemetry settings and rollback (Rob decides); decisions still "Proposed"
- Sources: DOC-226, DOC-229, PR34-20
- Kind: Risk/open question
- What: One commit restores Phase 1 `lib/sentry/data-collection.ts` values, `replaysSessionSampleRate: 0.1`/`1.0`, removes `maskAllText/maskAllInputs/blockAllMedia: false`, `tracesSampleRate: 0.2`; instant stop by disabling the DSN; observed-leak procedure (delete events, rotate token, add pattern + test). §2a comments stay with an "Ended on <date>" line. Cron monitor semantics, identity contract and "bearer secrets never reach Sentry" are still marked Proposed/Assumed in §2.
- Why deferred / reasoning given: Rob decides when the alpha ends.
- Verdict: NOT-DEBT (Rob's call; the revert recipe is written)
- Evidence: Sentry plan §13 lists the exact one-commit revert, the DSN kill-switch and the leak procedure; §2 rows "Cron monitor semantics", "Identity contract", "Who ends the alpha settings" still read `Proposed`, "Bearer secrets never reach Sentry" reads `Assumed`; all four are implemented as proposed (`route.ts:94-98`, `lib/sentry/user.ts`, `secrets.ts`).
- Remaining work: Rob flips the four §2 rows to Approved (or amends them) in one docs PR; nothing to build.
- Launch impact: NEVER — the aggressive policy is deliberate for the alpha (§2a verbatim ruling).
- Merge with: M-I-11 (rulings awaiting acknowledgement), M-K-17

### M-F-12: Logger does not redact `MemoryRevision.before/after` JSON or `sourceRef` (PR #30 F1)
- Sources: DOC-168, PR30-21
- Kind: Follow-up
- What: `lib/logger/logger.ts` redacts named top-level keys only. Audit every `log.*` call that could carry a revision or Prisma row; add paths or stop logging the object; test in `__tests__/lib/logger.test.ts`. Today nothing logs those objects.
- Why deferred / reasoning given: M; no known leak.
- Verdict: PARTIAL (narrower than the catalog says)
- Evidence: the catalog's "top-level keys only" is stale: `lib/logger/logger.ts:24-33` `REDACT_PATHS` covers `key`, `*.key`, `*.*.key`, `*.*.*.key` for every PII key (`note`, `contributorNote`, `relationship`, `place`, `approxDateText`, `originalFilename`, `claimLink`, `email`, `name`, `phone`), tested in `__tests__/lib/logger.test.ts:90` ("redacts two and three levels down"); `redactPii` is recursive for Sentry `extra`. A logged `{ revision: { before: { contributorNote } } }` would be redacted. Still true: `sourceRef` (`gmail:<id>`) is on no list, and no call site logs a row or revision today (`grep log\.\(info\|warn\|error\)` over `features/admin`, `draft-memory.ts`: ids, `keys: result.written`, `status`, `source` only).
- Remaining work: add `sourceRef` to `PII_KEYS` (one line + test) if it is ever logged; keep the "ids, never rows" rule.
- Launch impact: LATER — no known leak; nested redaction already exists.
- Merge with: none

### M-F-13: Vercel request logs hold `/m/<token>` and admin paths; retention/drain policy (§11 #3, A9)
- Sources: DOC-37, DOC-61, DOC-69, DOC-83, DOC-114, DOC-223, PR3-F3, PR3-R8, LEDGER-FR-13, PR31-29
- Kind: Follow-up
- What: Claim links `https://www.jowray.com/m/<token>` and `POST /admin/enter` (method and path only; the key travels in the body) appear in Vercel request logs. Review the project's log drain/retention once and record it in `docs/admin.md`; in Phase 3 consider moving the token to a POST body or cookie (M-F-06).
- Why deferred / reasoning given: Low.
- Verdict: NEEDS-ROB
- Evidence: `docs/admin.md` names the `POST /admin/enter` residual (method and path only) but records no retention/drain setting; `grep -ri "log drain" docs/` → only the Phase 1 §11 #3 and admin-page A9 follow-up rows. Vercel request-log retention is a dashboard setting; never reviewed.
- Remaining work: Rob opens Vercel → project → Logs/Drains once, notes retention (and that no drain forwards logs elsewhere) in `docs/admin.md`.
- Launch impact: LATER — Vercel's default runtime-log retention is short, the logs are visible only to the Vercel project members, and the token-in-URL residual is already accepted (M-F-06). Five minutes, no deadline.
- Merge with: M-F-06, M-A-07 (same dashboard visit)

## G. Brand, design, content

### M-G-01: `design/tokens.css` and `app/globals.css` will drift (F4)
- Sources: DOC-146, PR15-20, PR15-9
- Kind: Follow-up
- What: Consider `@import "../design/tokens.css"` from `globals.css` with the `@layer`/`@utility` wrapping moved into the design file so one copy exists; § 3 E11–E12 list today's differences (`.stitch-rule`/`.patchwork` replaced by utilities).
- Why deferred / reasoning given: Low.
- Verdict: OPEN (and already drifting)
- Evidence: two separate files (`design/tokens.css` 101 lines, `app/globals.css` 134 lines, no `@import` between them, `globals.css:1,23,95,118`); a token diff shows `globals.css` carries `--accent-*`, `--shadow-card-hover`, `--shadow-card-red-hover`, `--shadow-pill`, `--text-display-sm*`, `--text-thanks*` that `tokens.css` lacks.
- Remaining work: either `@import "../design/tokens.css"` from `globals.css` with the `@theme` wrapper moved into the design file, or declare `design/tokens.css` a reference copy in `DESIGN.md` and stop maintaining it.
- Launch impact: LATER — the site renders from `globals.css`; the drift only misleads the next designer.
- Merge with: M-G-02 (one "design docs match code" pass)

### M-G-02: Spec/code drift in DESIGN.md and plan citations (focus outline colour, `/icon.svg`); invalid+focus style
- Sources: PR35-9, PR35-10, DOC-153, PR15-27
- Kind: Deferred minor
- What: `design/DESIGN.md:157` says the focus outline is goldenrod; code uses walnut (`globals.css:105`). The global `:focus-visible` walnut outline overlaps the new invalid ring; PR #36 says it "sits cleanly outside the ring", no decision recorded on an invalid-specific focus style. Brand plan V5/[C10] say the icon route is `/icon`; Next 16.4 emits `/icon.svg`.
- Why deferred / reasoning given: low; not touched by the quick-fix PRs.
- Verdict: OPEN (doc drift); NOT-DEBT (invalid+focus, verified fine)
- Evidence: `design/DESIGN.md:157` "Focus: 4px `goldenrod` outline" vs `app/globals.css:111-113` 3px `walnut` outline, offset 2px. F2 checked twice: "sits outside the 4px ring; not muddy. No change" (`evidence README.md:32,68`), so no invalid-specific focus style is needed. `app/icon.svg` exists; the brand plan cites `/icon?…` (`2026-11-03-brand-implementation.md:70,336`) while Next 16 emits `/icon.svg?…` — a citation, not a bug.
- Remaining work: one-line edits to `DESIGN.md:157` (3px walnut, 2px offset) and the brand plan's icon href; record the F2 "no change" ruling in DESIGN.md § 5.4.
- Launch impact: LATER — code is right and accessible (walnut outline on paper/white passes 3:1); only the spec is wrong.
- Merge with: M-G-01

## H. Verification gates never run

### M-H-01: Task 10 launch gates: WAF rule, Spend Management, budgets, SendGrid; `/share` unshared until on
- Sources: DOC-28, DOC-38, DOC-56, DOC-72, DOC-73, DOC-81, DOC-87, DOC-111, LEDGER-O2, LEDGER-O3, LEDGER-T10-1, PR7-3, PR10-1, PR3-R9, PR3-N18, DOC-36, PR3-R7, LEDGER-FR-9
- Kind: Gate not run
- What: Unchecked boxes: WAF rate-limit rule covering `/share`, `/api/upload`, `/api/media/*`, `/m/*` (record rule id and date); Spend Management hard pause (amount, date); `DAILY_MEMORY_BUDGET` (default 200) / `DAILY_BYTE_BUDGET` (default 20 GB) set to launch values; "SendGrid domain authentication Verified and account can send" (domain auth passed 2026-11-03; account is paid, 500,000 credits/month). The WAF rule is also the named mitigation for the READ COMMITTED budget race and the reason per-IP in-app rate limiting (`@upstash/ratelimit`, §11 #2) is not built. "Sharing `/share` publicly: Blocked until the Vercel WAF rate-limit rule and Spend Management are on." Rob, dashboard.
- Why deferred / reasoning given: dashboard-only; Pro plan features.
- Verdict: NEEDS-ROB (PARTIAL in the ledger: budgets and SendGrid done, WAF and Spend Management not)
- Evidence: `docs/plans/phase1-ledger.md:18` "Sharing `/share` publicly — **Blocked** until the Vercel WAF rate-limit rule and Spend Management (Task 10) are on"; `:41-42` `[ ] WAF rate-limit rule created` / `[ ] Spend Management hard pause set`; `:99` `DAILY_MEMORY_BUDGET=200`, `DAILY_BYTE_BUDGET=21474836480` added to Vercel Production + Preview 2026-11-03 (`vercel env ls` confirmed); `:180` "Not yet done (Task 10 gates): Vercel WAF rate-limit rule and Spend Management (Rob, dashboard)". SendGrid: domain auth passed 2026-11-03 per catalog; `docs/plans/2026-11-03-admin-new-memory-alert.md` §10 records real sends accepted (202) with dkim/spf/dmarc pass. No later plan or ledger row records a WAF rule id or a Spend Management amount.
- Remaining work: Rob, Vercel dashboard: create the Firewall rate-limit rule over `/share`, `/api/upload`, `/api/media/*`, `/m/*` and the Spend Management hard pause; record rule id/amount/date in the ledger "One-off actions"; decide whether 200 memories / 20 GB per day are the launch values (they are the defaults; fine for 100 people).
- Launch impact: SHOULD — nothing in the code enforces per-IP limits (M-K-07), so the WAF rule and the spend pause are the only abuse/cost backstops; 100 family members are unlikely to abuse it, but the ledger's own rule says `/share` stays unshared until these are on, and it takes ~15 minutes in the dashboard.
- Merge with: M-K-07 (same mitigation; K-07 is the "don't build in-app limiting" half, H-01 is the "turn the WAF on" half).

### M-H-02: Task 10 acceptance checklist (16 boxes) never run; Task 10 closes on `docs/phase1-close`
- Sources: DOC-29, DOC-81, LEDGER-T10-1
- Kind: Gate not run
- What: Includes: closing a PR deletes its Neon branch within a minute; Sentry test error without query strings/cookies (policy since reversed); 20 MB client upload; 100 MB video READY + cron checksum within 10 min; iPhone HEIC/.mov/recording READY and playback in Safari; forced email failure retried to SENT; `/api/media/[id]` headers; budget refusal on preview; every ledger task `[x]`; `docs/consent/<CONSENT_VERSION>.md` matches the live form and email.
- Why deferred / reasoning given: never started.
- Verdict: OPEN (umbrella; most boxes are tracked individually)
- Evidence: `docs/plans/phase1-ledger.md:117-120` Task 10 `Status: [ ]`, "Acceptance results: —"; no `docs/phase1-close` branch in `git log`. Boxes with automated coverage making a manual run moot: closing a PR deletes its Neon branch — `.github/workflows/neon-cleanup.yml` (on `pull_request: closed`, REST API, fork-guarded per ledger `:166`), but the ledger `:39` still has `[ ] preview/docs/bootstrap-report Neon branch deleted by hand` and no run of the workflow is recorded; `/api/media/[id]` headers — `__tests__/api/media.test.ts:129` "sends no-referrer on every response" plus `__tests__/next-config.test.ts:9`; Sentry test error "without query strings/cookies" — superseded by the 2026-11-04 policy flip (now proven by `__tests__/lib/sentry-envelope.test.ts`); consent doc — `docs/consent/2026-11-v1.md`, `2026-11-v2.md` exist and `CONSENT_VERSION` is required by `server/config/env.ts:73`, but "matches the live form and email" is a reading check nobody recorded; "every ledger task `[x]`" — false today (Task 0 `[~]`, Task 7 `[~]`, Task 10 `[ ]`).
- Remaining work: run the device/video/email items (M-H-03/06/07/08) and tick the boxes, or formally retire Task 10 as a checklist and keep only the items that still matter (devices, WAF). One cheap check: confirm the `neon-cleanup` workflow actually ran green on PR #36's close (GitHub Actions tab) — otherwise preview Neon branches accumulate and cost money.
- Launch impact: LATER — the umbrella itself is bookkeeping; its load-bearing children are rated on their own rows.
- Merge with: M-H-03, M-H-06, M-H-07 (children); M-H-01.

### M-H-03: Real-device pass on iPhone and Android (HEIC, `.mov`, recording, cellular, five files, 390 px)
- Sources: DOC-26, DOC-29, DOC-76, DOC-87, DOC-90, DOC-92, DOC-100, DOC-149, DOC-188, DOC-195, DOC-209, PR15-23, PR16-16, PR25-3, PR27-3, PR28-24, PR29-1, LEDGER-T7-1, LEDGER-T8-3, LEDGER-FR-8, LEDGER-X3, LEDGER-X5, DOC-66, PR3-F8, I17-1, DOC-185, PR25-16, PR10-1
- Kind: Gate not run
- What: Owed since Task 7/Task 10 and re-promised by brand F7, issue #17 (V9), Task 15 and PR #35: from an iPhone a HEIC photo, a native-camera `.mov` and an in-browser Safari recording reach READY (record iOS version); five mixed JPEG/HEIC/.mov/recording files → one memory, one claim link, one email with the right per-kind list, five rows in order; 390 px has no horizontal scroll; cellular upload; the draft survives the camera app opening; the new player and "Remove recording"; the same on Chrome Android. Informational: does dropping HEIC from `accept` make iOS send JPEG (issue #17 open question 9)? The old "iOS Chrome/Firefox get a HEIC download link" minor is superseded by derived web copies but the device pass is the proof. The share form's row ids no longer need a secure context, so a LAN address works.
- Why deferred / reasoning given: needs Rob's devices.
- Verdict: OPEN (never run; cannot be automated — needs Rob's phones)
- Evidence: Owed and re-promised in every ledger row since Task 7: `phase1-ledger.md:98,102,105,108,154,180,206,228,239-240` ("real devices (this also closes F7 / Task 10)", "Still Rob's: … the device/AT pass"). `docs/plans/evidence/2026-11-share-redesign/README.md` "Not run here … Real devices (iPhone, Android): native camera `.mov`, HEIC, cellular upload, the draft surviving the camera app". `docs/plans/evidence/2026-11-issue17/README.md`: only a desktop-Chrome HEIC check on a preview with the 48×64 fixture; "Not yet measured: decode time and memory for a 24 MP iPhone HEIC on Vercel". Automated coverage that *partly* substitutes: HEIC decode/rotation with real fixtures (`__tests__/integrations/images.test.ts`, `__tests__/lib/heic-worker.test.ts` using `rotated.heic`/`tiny.heic`); per-memory cap and multi-file submission (`create-memory.test.ts:81`, `create-submission.test.ts`); scripted 390 px / 852×393 browser checks with fake mic+camera (`browser-checks.json`, 51 assertions). None of that exercises iOS Safari's MediaRecorder, a real 24 MP HEIC on Vercel memory, the native-camera `.mov`, or a cellular upload.
- Remaining work: Rob (or any family tester) with an iPhone and an Android phone on the production URL: one HEIC photo, one native-camera video, one in-browser recording, then five mixed files in one send; confirm READY on the claim page and the email lists them; note iOS/Android versions in the ledger. ~30 minutes. The 24 MP HEIC memory/time measurement is the one with a real failure mode (`too_many_pixels`/timeout → FAILED row, download-only link).
- Launch impact: BLOCKER — nearly every family member will be on a phone, and the three most common things they will do (take a photo, record a voice note, film a short video) have never been exercised on a real iPhone or Android against production; a silent failure here is the launch's most likely visible defect.
- Merge with: M-H-04 (same session on the same phones), M-H-05 (VoiceOver/TalkBack can be done in the same sitting), M-H-10 (V9 is this item).

### M-H-04: Recorder physical device matrix NOT RUN
- Sources: PR21-1, DOC-199, PR21-14, PR28-20
- Kind: Gate not run
- What: Mac Chrome with mic denied at the OS, headset picker, Mac Safari 18.4+ WebM and older MP4, iPhone Safari incl. screen lock, Android Chrome, Firefox, Windows; record browser/OS and `recorder.mimeType` per row; checklist in `docs/plans/2026-11-03-recorder-feedback.md` § Verification. Premortem P2 "Device test on iPhone is a gate" ("High: gate before relying on it in the field"). The Safari MediaRecorder video container question belongs to the same pass when Slice C lands.
- Why deferred / reasoning given: headless smoke covers Chromium with fake inputs only.
- Verdict: OPEN (needs physical devices; headless smoke only covers Chromium)
- Evidence: `docs/plans/2026-11-03-recorder-feedback.md:456` "| Device matrix (Mac Chrome denied mic, headset picker, Mac Safari, iPhone Safari, Android, Firefox, Windows) | — | NOT RUN | needs Rob's devices; the smoke covers only Chromium with fake inputs |"; same plan "Risks": "No automated coverage for engine/hook/canvas [C24]". Automated: `__tests__/app/recorder.test.ts` (engine lifecycle with fakes), `recorder-help`, `recording-devices`, `audio-level`, `recorder-state` tests; `scripts/recorder-smoke.mjs` hearing + silent cases recorded in the share-redesign evidence README. PR #21 merged 2026-11-03 (`5edd042`) without the matrix; hotfixes #23/#24 touched the picker afterwards.
- Remaining work: fold into M-H-03's phone session: iPhone Safari (meter moves on first tap, lock-screen mid-recording, deny → iOS steps, Reduce Motion), Android Chrome; Mac Safari `audio/mp4` path. Mac Chrome denied-mic and Windows rows are desktop-only and can wait.
- Launch impact: SHOULD — voice memories are a headline feature and iOS Safari's AudioContext/MediaRecorder behaviour is exactly where "works in Chromium smoke" is not proof; one 10-minute try on an iPhone settles it. (Rated below H-03 only because H-03 subsumes it.)
- Merge with: M-H-03.

### M-H-05: Assistive-technology pass on the share form (VoiceOver / TalkBack / reduced motion)
- Sources: PR35-1
- Kind: Gate not run
- What: VoiceOver on iPhone Safari and macOS Chrome: Send on a blank form announces the alert then "Your name, required, invalid, We'll need a name…"; typing does not re-announce the summary; typed text survives a failed Send; Android Chrome + TalkBack same pass; reduced motion on iOS gives an instant scroll.
- Why deferred / reasoning given: owner Rob; does not gate the PRs.
- Verdict: OPEN (not run; AT needs a human with the devices)
- Evidence: `docs/plans/evidence/2026-11-share-quick-fixes/README.md` "Part 3 — assistive technology and devices (owner: Rob; does not gate the drafts) — Not run: VoiceOver (iPhone Safari, macOS Chrome), TalkBack, iOS reduced motion." Automated/scripted partials: Chrome a11y tree captured (`a-1280-a11y-tree.txt`); `aria-invalid`/`aria-describedby`/`role="alert"` asserted by script in the same README; reduced-motion emulated in Chrome ("behavior: auto", 422 = 422); `lib/reveal-scroll.ts` has unit tests. The screen-reader *announcement order* ("alert then 'Your name, required, invalid…'") cannot be asserted without a real screen reader.
- Remaining work: 10 minutes with VoiceOver on an iPhone: blank Send, hear the summary then the name field; type, confirm the summary is not re-announced; failed Send keeps typed text. Same on TalkBack if an Android is handy.
- Launch impact: LATER — the ARIA wiring is verified; what remains is announcement polish for the (probably few) screen-reader users among 100 family members. Do it in the M-H-03 sitting if time allows.
- Merge with: M-H-03.

### M-H-06: Large-video and load checks: 20 MB / 100 MB videos, 21 rapid creates
- Sources: DOC-26, DOC-76, DOC-100, LEDGER-T7-1, DOC-87, DOC-29
- Kind: Gate not run
- What: 20 MB `.mp4` → READY with checksum within a minute; 100 MB video READY with cron checksum within 10 min; 21 rapid `createMemory` calls with `DAILY_MEMORY_BUDGET=20` → the 21st refused (budget refusal on preview); long-video seeking against the 60 s presigned URL (M-B-05).
- Why deferred / reasoning given: pending since Task 7.
- Verdict: PARTIAL (budget refusal is unit-tested; large-video runtime path never exercised)
- Evidence: `phase1-ledger.md:102` "Still pending: 20 MB and 100 MB videos, iPhone HEIC/.mov/recording, 21 rapid creates with budget 20"; `:180` repeats it; nothing later records a large upload. Automated: budget refusal — `__tests__/features/create-submission.test.ts:106` "refuses the whole send and creates nothing when the memory count or the declared bytes pass the budget", plus `draft-memory.test.ts`, `admin-memories.test.ts`, `upload-ticket.test.ts` (the 21-creates check is therefore moot as a logic test; only the READ COMMITTED race remains, mitigated by the WAF rule per `:155`). Hashing split: `features/memories/ingest-upload.ts:26` `INLINE_HASH_MAX_BYTES = 50 MB`, larger files hashed by the cron (cron behaviour unit-tested in `reconcile.test.ts:220`). Large-video seeking: the inline view 302s to a presigned blob URL that serves Range (`app/api/media/[id]/route.ts:7`), so Range/206 on the route itself is moot; the 60 s presign window on a long seek is M-B-05 and still unverified.
- Remaining work: one 100 MB `.mp4` upload from a laptop on production, then check the claim page plays it and the cron run writes the checksum within 10 minutes (`Media.checksumSha256` non-null). 5 minutes plus the upload.
- Launch impact: SHOULD — phone videos are routinely 50–200 MB; the >50 MB path (cron hashing, multipart Blob upload, 60 s presign) has never carried a real file. A single upload before launch is cheap insurance.
- Merge with: M-B-05 (presign/seek), M-H-03 (phone `.mov` is the same path from the other side).

### M-H-07: Forced email failure retried end to end on a preview
- Sources: DOC-27, DOC-80, LEDGER-T9-2
- Kind: Gate not run
- What: A deliberately failed confirmation email is retried by the cron and its `attempts` increments through to SENT.
- Why deferred / reasoning given: Task 9 pending check.
- Verdict: PARTIAL (logic fully unit-tested; one runtime retry recorded for the admin-alert path, none for the contributor path)
- Evidence: `phase1-ledger.md:115` "Pending: a forced email failure retried end to end"; `docs/plans/2026-11-03-admin-new-memory-alert.md` §9 row 9b: synthetic FAILED admin row retried by cron step (d) on Neon `dev-admin-alert` → SENT, second run a no-op (real cron code, real Postgres). Share-redesign evidence README: cron (e3) leased → expired → re-check → terminal row run against the Neon dev branch. Unit tests: `__tests__/services/email.test.ts:163,315` "marks FAILED with attempts and nextAttemptAt when SendGrid fails", `:462` "reclaims a SENDING row stuck > 15 min", `:483` "writes SENT and the new claim hash in one transaction when a rotated hash is supplied", `:492` "retries the SENT bookkeeping"; `__tests__/api/reconcile.test.ts:220` asserts `(d)` retries FAILED `SUBMISSION_CONFIRMATION` rows to SENT and skips the leased one.
- Remaining work: none worth scheduling; the admin-path cron retry on a real database plus the unit tests cover the same code (`deliver()` is shared). If Rob wants the box ticked: set a wrong `SENDGRID_API_KEY` on a preview, submit, fix the key, wait for the cron.
- Launch impact: LATER — the retry path is the best-tested code in the repo and has one real-database run; the accepted residual (M-K-05) is documented.
- Merge with: M-K-05 (the residual this gate would observe).

### M-H-08: Real email sends and delivered-message inspection (receipts, thumbnails, per-client rendering)
- Sources: DOC-89, DOC-92, DOC-157, DOC-209, PR20-6, PR20-7, PR28-1, PR28-23, PR29-1, LEDGER-X2, LEDGER-X5
- Kind: Gate not run
- What: Run `npx tsx --env-file=.env scripts/send-test-email.ts robwray@gmail.com` and inspect "Show original" (`multipart/related`, `Content-ID`s, no `sendgrid.net` rewriting) in Gmail web/iOS, Apple Mail, Outlook desktop (Word engine), Yahoo, light/dark, images blocked; screenshots into `docs/plans/evidence/2026-11-confirmation-email/`. Task 15 receipts: two-link receipt, thumbnail after the 10 s wait, ten-memory size, admin alerts after completion (outbound was disabled in every check; needs an allowlisted address).
- Why deferred / reasoning given: outbound disabled locally; needs real inboxes.
- Verdict: PARTIAL (admin alert inspected in Gmail web/iOS + Apple Mail; contributor receipt never inspected in any real inbox)
- Evidence: `docs/plans/2026-11-03-admin-new-memory-alert.md` §9 row 9 "both samples then accepted (202) and received in Gmail with 5 inline attachments", §10 "Gmail web + iOS, Apple Mail; Authentication-Results dkim/spf/dmarc pass" (admin template; the `content_id` bug this exposed was fixed in `62c4c62` and also unblocked the confirmation email). `docs/plans/evidence/2026-11-confirmation-email/README.md` "Not yet recorded: delivered-message inspection (Gmail web/iOS, Apple Mail, Outlook)". `docs/plans/evidence/2026-11-share-redesign/README.md` "Not run here: Real emails (allowlisted address needed): the two-link receipt, the thumbnail-in-email case after the 10 s wait, the ten-memory size case, admin alerts after completion". `phase1-ledger.md:108` records one real confirmation email arriving (pre-redesign single-link template, local + preview). Template HTML is unit-tested (`__tests__/services/email-template.test.ts`, `submission-template.test.ts`, `admin-template.test.ts`: no `@font-face`, no `href=` in the admin mail, inline `cid:` images).
- Remaining work: one real send of the *current* receipt (`npx tsx --env-file=.env scripts/send-test-email.ts robwray@gmail.com`) plus one real two-memory submission with a photo to the allowlisted address; open on an iPhone Gmail/Mail client and confirm the two links and the thumbnail render. 15 minutes. Outlook/Yahoo/dark-mode matrices can wait.
- Launch impact: SHOULD — the receipt email is the family member's only durable copy of their private link; the current multi-link + thumbnail version has never been seen in a real inbox, and the one real send that *was* done found a SendGrid 400 bug.
- Merge with: M-H-09 (same send, add the Hotmail inbox).

### M-H-09: Hotmail/Outlook.com deliverability and rendering of the admin alert (F16)
- Sources: DOC-132, PR26-3, DOC-91, LEDGER-X4
- Kind: Gate not run
- What: After the production deploy, check both `ADMIN_ALERT_EMAILS` inboxes (`robwray@gmail.com`, `rjwray@hotmail.com`) on the first real alert and record in the runbook § 9; needs `OUTBOUND_ENABLED=true` or a preview allowlist entry for the Hotmail address.
- Why deferred / reasoning given: medium; production only.
- Verdict: OPEN (production-only by design; not recorded)
- Evidence: `docs/plans/2026-11-03-admin-new-memory-alert.md:132` F16; §10 "Hotmail checked after the production deploy (R3 / follow-up)"; §9 row 9b: the outbound guard *dropped* the hotmail address in the dev run (not allowlisted), so Hotmail has never received a message from the site. `rjwray@hotmail.com` is one of the two `ADMIN_ALERT_EMAILS` (ledger `:211`). No later ledger line records a Hotmail delivery.
- Remaining work: after the first real production memory, look in `rjwray@hotmail.com` (Inbox and Junk) and note the result in the plan's §9. Alternatively add the address to `OUTBOUND_ALLOWLIST` on a preview and send one test alert now.
- Launch impact: SHOULD — one of the two family admins reads alerts on Hotmail; if Outlook.com junk-folders the new sender domain, that admin silently misses every memory. Five-minute check once the first alert fires.
- Merge with: M-H-08.

### M-H-10: Issue #17 preview verifications V2–V13 and production acceptance never evidenced
- Sources: DOC-90, DOC-195, DOC-193, PR22-9, PR25-3, PR25-17, PR27-8, I17-3, LEDGER-X3, DOC-191
- Kind: Gate not run
- What: Plan § 7 rows need executor, deployment SHA, evidence path and pass/fail in `## Progress`: V6 concurrency (two HEICs finalised within a second plus two removals; "competing mutations on a real PostgreSQL" was only partly proven, no test DB), V7 remove/replace/cancel with blobs gone after one cron run, V8 caps, V9 five mixed files on phones (M-H-03), V10 lease and batch email (abandon one of three uploads; cron skips a live lease, sends and rotates after expiry), V11 token hygiene in Sentry/logs, V12 thumbnail contract, V13 worker deadline in Vercel logs. Issue #17 acceptance A1: Rob's production memory renders `IMG_8487.HEIC` in Chrome/Firefox after one cron run and `?download=1` returns the original bytes; steps 5–8 (`vercel blob list` shows one `derived/` object; Sentry shows no `/m/<token>` or `t=` from the new code).
- Why deferred / reasoning given: "mocked tests prove logic, not runtime".
- Verdict: PARTIAL (V1 automated and green; V2 desktop and V9 desktop done on previews; V4–V8, V10–V13 and the production A1 never recorded; issue closed without them)
- Evidence: GitHub REST: issue #17 `state: closed`, `closed_at: 2026-11-04T18:55:36Z`. `docs/plans/2026-11-03-photos-derived-media.md` §7 table (V1–V13) and `## Progress` (`:814`): PR A and PR B `[x]`, PR C `[ ]` (though PR #27 `feat/multi-file-memories` merged 2026-11-04 `6c1a217`), "Ledger Task 12 section … updated" `[ ]`. `docs/plans/evidence/2026-11-issue17/README.md`: V2 on preview with the 48×64 fixture only. `phase1-ledger.md:206` "Done on previews: V2 (HEIC renders upright), V9 desktop part … Still open: … V9 mobile part, V10 lease expiry and V11–V13 on a preview". Automated substitutes: V6 concurrency — `__tests__/features/lock.test.ts`, `derive-media.test.ts` (claim/publish protocol), unit doubles only (ledger/plan say "mocked tests prove logic, not runtime"; no Postgres test DB, see M-K-09); V7 remove/replace/cancel + purge — `claim.test.ts`, `reconcile.test.ts:380` "51 removed files: 50 on the first run…", `:489` C1 purge; V8 caps — `create-memory.test.ts:81,142`; V10 lease — `reconcile.test.ts:294,311` plus the real-DB (e3) run in the share-redesign evidence; V11 token hygiene — `sentry-envelope.test.ts` (real server SDK, `SENTRYTEST_` tokens never leave); V12 thumbnail contract — `images.test.ts`, `derive-media.test.ts`; V13 worker deadline — `heic-worker.test.ts` (timeout/terminate). Not covered anywhere: V4 production A1 (Rob's `IMG_8487.HEIC` memory renders after one cron run, `vercel blob list` shows one `derived/` object), V5 a >30 MP / corrupt HEIC on a preview, the 24 MP decode time/memory on Vercel.
- Remaining work: the production A1 check is the one that matters and takes 2 minutes: open Rob's existing production claim link in Chrome and confirm the HEIC shows; `?download=1` returns the original. Then update the plan's Progress (PR C `[x]`, V rows) so the next agent does not reopen the issue.
- Launch impact: SHOULD — the derived-image pipeline is what makes every iPhone photo visible to Android/Chrome relatives; it has only been proven with a 48×64 fixture on a preview, never with a real phone photo in production. Same sitting as M-H-03.
- Merge with: M-H-03 (V9 phones), M-H-06 (large media runtime).

### M-H-11: Sentry preview gates §11.1–§11.3, production smoke §11.4, Task 4 step-6 UI checks
- Sources: DOC-2, DOC-23, DOC-75, DOC-87, DOC-228, PR1-6, BOOT-R2, LEDGER-T4-1, PR10-1, PR32-1, PR32-8, PR33-1, PR33-9, PR34-1, PR34-3
- Kind: Gate not run
- What: Done on #34's preview: tunnel POSTs 200 behind Deployment Protection, forced `/api/upload` error arrived scrubbed (JOWRAY_COM-5), browser error with replay/profile/React context (JOWRAY_COM-4), `Document-Policy: js-profiling` on `/share`, feedback button injected. Not run: submit a memory as the allow-listed address and confirm Issues show `user.email`, a pageload trace linked to a `createSubmission` span with `"claimTokens": "[Filtered]"`, Logs carry `user.email`, Metrics show `memory.created`; the feedback-form submission with screenshot; the `/m/*` replay (photo visible, `urls` shows `/m/[claimToken]`, network body shows `"claimToken":"[Filtered]"`); tunnel bodies after a test send contain no `/m/`, `claimToken` or `ticket`. Production (§11.4): load `/` and `/share`, one production replay, Crons shows `reconcile-uploads` `ok` every 10 min (never fabricate an error in production), Vercel build log shows the tunnel line and "Successfully uploaded source maps". The Task 4 step-6 checks (event without query string/cookies, Pino `warn` in Logs) predate the policy flip.
- Why deferred / reasoning given: need the network and a Sentry login.
- Verdict: PARTIAL (§11.1 and most of §11.3 done on PR #34's preview and recorded; §11.2 submission/identity checks, the `/m/*` replay, feedback submission and §11.4 production smoke not recorded; Task 4 step 6 superseded)
- Evidence: `docs/plans/2026-11-04-sentry-full-telemetry.md:472` ledger row: "Preview gates run on PR 3's preview (`jowray-iklh6kucw`): tunnel POSTs 200 behind Deployment Protection; a forced `/api/upload` error arrived as JOWRAY_COM-5 … no cookie/bypass/token in the event; a browser error arrived through the tunnel (JOWRAY_COM-4) with replay id, profile and React contexts … two preview replays listed with scrubbed URL lists; `Document-Policy: js-profiling` on `/share`; feedback button injected; 20 annotated elements. Not run: the memory-submission and feedback-form submissions, the `/m/*` replay and the Sentry UI checks (login)." #32–#34 merged 2026-11-04 (`8ce6b99`, `912cb00`, `33ed1fc`); no §11.4 row after that. `phase1-ledger.md:79` Task 4 "Step 6 UI checks (test error without query string/cookies, Pino warn in Logs) still pending" — the query-string/cookie expectation is reversed by the 2026-11-04 policy; its replacement is the envelope test. Automated: `__tests__/lib/sentry-envelope.test.ts` (real SDK, scrubbed `server_action_input`, spans, no router-state header/cookie/token), `sentry-scrub`, `sentry-user`, `sentry-report`, `sentry-metrics`, `sentry-after-flush`, `next-config` tests; `__tests__/api/reconcile.test.ts:437` cron error status mapping. §10 manual checklist (Seer/GitHub connect, alert rules, "Prevent Storing of IP Addresses" off, quotas) is dashboard-only and unrecorded.
- Remaining work: Rob, logged into sentry.io after the next production deploy: Replays shows a session, Crons shows `reconcile-uploads` `ok` every 10 min, Vercel build log shows the tunnel line and "Successfully uploaded source maps"; one submission from the allowlisted address shows `user.email` on the Issue/trace. 10 minutes. The §10 alert rules ("User Feedback received", "Replay with error" → Rob) are worth setting before launch since they are how Rob hears about problems.
- Launch impact: SHOULD — telemetry is Rob's stated instrument for "rapidly fix errors" during the alpha; the production side (crons check-ins, source maps, alert routing) has never been confirmed, and a broken tunnel/DSN in production would fail silently. Not a family-facing defect, so not a blocker.
- Merge with: M-H-02 (Task 4 step 6 is retired by the policy flip; drop it from the checklist).

### M-H-12: Production referrer check after deploy (brand F2)
- Sources: DOC-144, PR15-18
- Kind: Gate not run
- What: Open a claim link on `www.jowray.com`, click every link, confirm no request carries `/m/<token>` in `Referer` (devtools Network). Preview V6 passed but header links navigate client-side from prefetched payloads, so the live check stays owed.
- Why deferred / reasoning given: post-merge.
- Verdict: PARTIAL (preview V6 passed with 23 requests and no `/m/` Referer; the policy is enforced in two places and unit-tested; the live production click-through was never recorded)
- Evidence: `docs/plans/2026-11-03-brand-implementation.md:509` V6 pass on the preview, "the header links navigate client-side from already-prefetched payloads, so the live production check stays follow-up F2"; `app/m/[claimToken]/page.tsx:20` `<meta name="referrer" content="no-referrer" />`; `next.config.ts` `headers()` sets `Referrer-Policy: no-referrer` on `/m/:path*` (asserted by `__tests__/next-config.test.ts:9`); `__tests__/api/media.test.ts:129` "sends no-referrer on every response". No ledger line after PR #15 records a production devtools check.
- Remaining work: 2 minutes with devtools on `www.jowray.com`: open a claim link, click "Jo Wray", "Leave a memory", "Jo's obituary" (footer), check no request carries `/m/` in `Referer`. Can be done in the same sitting as M-H-10's A1 check.
- Launch impact: LATER — both the document meta and the response header say `no-referrer`, both are tested, and all navigation targets are same-origin; the preview run already observed real requests. Residual risk is a browser ignoring both, which is not a realistic failure.
- Merge with: none (mention: M-H-10 A1 uses the same production claim link).

## I. Docs, process, tooling

### M-I-01: Browser test harness (Playwright, fake media, preview URL, CI); no DOM/e2e tests exist
- Sources: DOC-59, DOC-143, DOC-156, PR3-N21, PR15-17, PR20-17, PR34-16, PR36-2
- Kind: Follow-up
- What: `__tests__` is Vitest/node only; UI flows (share → thank-you → claim edit) regress silently; the desktop layout (PR #36) and `global-error.tsx`/browser init have no tests by ruling (R12, R9). Add Playwright against a preview URL (needs `VERCEL_AUTOMATION_BYPASS_SECRET`), run in CI; the Playwright scripts used for #15 and #28/#29 evidence are a starting point (not committed). Unlocks F12 (poster capture) and the Sentry envelope test (M-F-07).
- Why deferred / reasoning given: jsdom + DOM testing library judged low value for Phase 1; Medium follow-up since.
- Verdict: OPEN
- Evidence: `package.json` has no `playwright`/`@playwright/test`; `.github/workflows/ci.yml` runs lint, type-check, `test:run`, `build` only; `__tests__` is Vitest/node.
- Remaining work: Playwright against a preview URL with the bypass secret, a fake-media fixture, one CI job; the uncommitted scripts from #15/#28 are the seed.
- Launch impact: LATER — real value, but a day of work; the launch-week risk is covered by the manual 390×844 walks recorded in `docs/plans/evidence/`.
- Merge with: M-I-06 (both want `playwright` as a devDependency), M-F-07 (Sentry envelope test needs the harness)

### M-I-02: `build:offline` in CI (F3), OS-level network-isolated CI build (F8), cwd dependence (F9)
- Sources: DOC-119, DOC-142, DOC-145, DOC-150, DOC-151, PR15-15, PR15-19, PR15-24, PR15-25, DOC-31, PR3-R2
- Kind: Follow-up
- What: `scripts/no-network.mjs` refuses non-loopback sockets and DNS on the main thread of every Node process; worker threads and native code are outside it ("strong check, not a proof"). F3: run `npm run build:offline` in `.github/workflows/ci.yml`. F8: run `npm run build` under `unshare -n` or `--network none` in CI (macOS `sandbox-exec` breaks Turbopack). F9: `NODE_OPTIONS=--import=./scripts/no-network.mjs` resolves against the cwd; switch to an absolute `file://` URL in a wrapper if it ever bites. Known: with `NEXT_PUBLIC_SENTRY_DSN` set the build attempts one blocked Sentry connection and still succeeds.
- Why deferred / reasoning given: Low/Medium; CI-only work.
- Verdict: OPEN
- Evidence: `ci.yml` step is `npm run build`, not `npm run build:offline`; `package.json:8` `build:offline` uses the cwd-relative `--import=./scripts/no-network.mjs`; no `unshare`/`--network none` anywhere in `.github/`.
- Remaining work: F3 is a one-line CI change (`npm run build:offline`); F8/F9 optional.
- Launch impact: LATER — CI-only; the offline build is run by hand on every PR per AGENTS.md and the risk it guards (build-time network) is a build failure, not a family-visible bug.
- Merge with: M-I-17 (same guard)

### M-I-03: `npm audit` advisories (minimatch GHSA-g3hv-75wg-m249, deepmerge, glob; 28, 4 high); upgrade PR
- Sources: DOC-6, DOC-96, PR1-7, BOOT-R7, PR1-C5, PR21-2, DOC-197, LEDGER-T2a-1, PR3-F6, DOC-64
- Kind: Follow-up
- What: All transitive (`minimatch` under `eslint-config-next`/`typescript-eslint`; `deepmerge` under `@sendgrid/mail`; `glob`/`minimatch` under `@sentry/bundler-plugins`). `npm audit fix --force` only downgrades (eslint@4, `@sendgrid/mail@6`, `@sentry/nextjs@10`) and is a stated non-goal. Pick-up: a dependency-upgrade PR, the four high ones first, or an `overrides` pin once compatible.
- Why deferred / reasoning given: dev-only / breaking downgrades; revisit when upstream fixes.
- Verdict: OPEN (numbers changed; the set is different from the catalog's)
- Remaining work: a dependency PR that (a) adds an `overrides` entry `"@vercel/cli-config": { "zod": "^4.6.6" }` or waits for `@vercel/oidc` to bump, (b) checks whether newer `@sentry/nextjs` 11.x / `eslint-config-next` 16.4.5 clear the minimatch/glob rows; never `--force`.
- Launch impact: LATER — the only runtime-reachable package in the high chain is `@vercel/cli-config`'s zod, which parses local CLI config, never request input; the rest is build/dev tooling.
- Merge with: M-I-04 (same dependency-bump PR)

### M-I-04: Bump `next` and `eslint-config-next` 16.4.4 → 16.4.5 (2026-11-03 security release) (A10)
- Sources: DOC-224, PR31-30
- Kind: Follow-up
- What: Seven moderate advisories, two touching Cache Components fallback shells and forwarded fetched responses; preconditions do not match this deployment. One-line PR; run the three checks.
- Why deferred / reasoning given: a framework bump does not belong in a feature PR.
- Verdict: OPEN
- Evidence: `package.json:33` `"next": "16.4.4"`, `:46` `"eslint-config-next": "16.4.4"`; `package-lock.json:6397`, `:8852` both 16.4.4; `npm view` confirms `next@16.4.5` and `eslint-config-next@16.4.5` are published; no commit on any branch mentions 16.4.5; admin-page plan `:384` A10 still a follow-up. `npm audit` does not flag `next` itself (the advisories' preconditions do not match, per the plan's research row `:348`).
- Remaining work: one-line PR bumping both pins, run `validate`, `test:run`, `build:offline`; a Vercel preview to confirm the Cache Components build is unchanged.
- Launch impact: SHOULD — a security release of the framework that serves the launch; the plan's own research says the preconditions do not match this deployment, so it is hygiene rather than exposure, but it is a 15-minute PR and lowers the chance of being on an unsupported patch when the next advisory lands.
- Merge with: M-I-03

### M-I-05: README is still the create-next-app starter (F5)
- Sources: DOC-147, PR15-21
- Kind: Follow-up
- What: Rewrite to describe the memorial site, the checks and the docs index; only the font sentence was fixed.
- Why deferred / reasoning given: Low.
- Verdict: OPEN
- Evidence: `README.md:1` "This is a [Next.js](https://nextjs.org) project bootstrapped with `create-next-app`".
- Remaining work: short rewrite: what the site is, the three checks, the docs index.
- Launch impact: LATER — the family never sees the README; agents are steered by AGENTS.md.
- Merge with: none

### M-I-06: Favicon regeneration needs Playwright; commit `scripts/make-favicon.mjs` (F6)
- Sources: DOC-148, PR15-22
- Kind: Follow-up
- What: If the mark changes again, add `playwright` as a devDependency and commit the brand-plan Step 3 script as `scripts/make-favicon.mjs`.
- Why deferred / reasoning given: Low; only when the mark changes.
- Verdict: OPEN
- Evidence: `ls scripts/` shows no `make-favicon.mjs`; no `playwright` devDependency.
- Remaining work: only when the mark changes.
- Launch impact: NEVER (for launch) — the favicon exists; this is a regeneration convenience.
- Merge with: M-I-01

### M-I-07: EmpathIQ docs link returns 404 (ask Rob); EmpathIQ eslint-comments rules not ported
- Sources: DOC-19, DOC-95, DOC-208, DOC-210, PR16-11, PR28-21, PR16-15, LEDGER-FR-12, LEDGER-X5
- Kind: Risk/open question
- What: The approved EmpathIQ docs URL 404s and a site search finds nothing; house conventions come from `docs/code-layout.md` and AGENTS.md. The EmpathIQ eslint-comments rules were not ported (AGENTS.md plus a grep enforce the no-suppression rule). Other unverifiable citations from the Phase 1 plan (`[C69]` VoIP.ms mirror, `dotenv` precedence) were resolved or deferred with their phases.
- Why deferred / reasoning given: ask Rob.
- Verdict: PARTIAL (link NEEDS-ROB; rules not ported = NITPICK)
- Evidence: `eslint.config.mjs` has `no-restricted-imports` layer rules (lines 62–135) and no `eslint-comments` plugin; AGENTS.md's "no `eslint-disable` without YES" is enforced by rule text and grep. `docs/code-layout.md:3` / AGENTS.md:24 still cite EmpathIQ as the source; phase1 ledger `:229` lists the 404 link as out of scope.
- Remaining work: Rob supplies the current link or the sentence is reworded to drop the citation; an `eslint-comments` rule (`no-unlimited-disable`, `require-description`) would be a small PR if wanted.
- Launch impact: NEVER — conventions are already in the repo; the link is provenance only.
- Merge with: none

### M-I-08: File bucket-4 follow-ups as GitHub issues; no issue template or TrayVerify prompts
- Sources: DOC-60, DOC-88, LEDGER-X1, PR3-N22, PR35-14
- Kind: Ops step (Rob)
- What: Every PR since #15 ends with "file as issues after merge" (brand F1–F9, email F10–F12, admin-alert F13–F16, draft F1–F16, admin A1–A10, Sentry F1–F6, quick-fix F1–F4); none are recorded as filed. The TrayVerify prompts (`premortem`, `citations`, `friend-buckets-*`, `bucket-*-sorting`, `document-issue`) live on Rob's Mac and were to be copied into `docs/workflows/` and `.github/ISSUE_TEMPLATE/`; "the repo has no issue template yet".
- Why deferred / reasoning given: Rob-side setup.
- Verdict: OPEN
- Evidence: `gh api repos/RobertdWray/jowray_com/issues?state=all` → only #37 (open, "Prompt to update Documents") and #17 (closed); no `.github/ISSUE_TEMPLATE/`, no `docs/workflows/`; phase1 ledger `:240` "Still Rob's: … filing the bucket-4 issues".
- Remaining work: this catalog is the input; once the merge/verdict pass is done, file the OPEN+SHOULD items as issues (optionally with a template).
- Launch impact: LATER — tracking hygiene; nothing the family sees.
- Merge with: none (it is the process that consumes every other item)

### M-I-09: `scripts/seed-dev-memory.ts` for repeatable runtime checks on the Neon dev branch (quick-fix F1)
- Sources: PR35-8
- Kind: Follow-up
- What: No seeded fixture or token-safe tool; testers create rows through the form and the admin page (R10 used a direct SQL `UPDATE` to avoid putting `ADMIN_PAGE_SECRET` in a transcript). A script that prints only a claim URL would make the checks repeatable.
- Why deferred / reasoning given: medium; out of scope for #35.
- Verdict: OPEN
- Evidence: `ls scripts/` has no `seed-dev-memory.ts`; `scripts/draft-memory.ts` exists but needs `ADMIN_API_SECRET` and a running server; phase1 ledger `:237` records the SQL-by-hand workaround.
- Remaining work: a small `tsx` script creating a memory + contributor on the dev branch and printing only the claim URL.
- Launch impact: LATER — agent/test convenience.
- Merge with: M-I-01 (the Playwright fixture would need the same seed)

### M-I-10: Share-redesign process stages never run (premortem, four buckets, D17) and the second regression pass
- Sources: DOC-92, DOC-203, PR16-13, PR28-1, PR28-2, PR28-29
- Kind: Risk/open question
- What: The plan's Process table left premortem (`/team-code-review` with `premortum.md`), four buckets, build, draft PRs, review and ship as ☐ for "Rob's environment"; #28/#29 were built and merged with a review-feedback sort posted as comments but no premortem recorded. PR #28's reconciliation with #27 (merge `6139d5b`, 14 conflicting files) promised "a second Fable regression pass before merge" whose result is not recorded.
- Why deferred / reasoning given: D17 placed those stages with Rob.
- Verdict: OPEN, effectively moot
- Evidence: `docs/plans/2026-11-03-share-redesign.md:69-74` all stages still ☐; PR #28 comment (`gh api .../issues/28/comments`) says "a second Fable regression pass focused on the reconciliation runs before merge" with no result comment after it; #28 merged `3f437eb` 2026-11-04 12:13Z. Since then the share form went through PR #35/#36 Team Code Review rounds (ledger `:237-240`) and a 390×844 walk.
- Remaining work: either tick the ☐ rows as "superseded by #35/#36 review" or leave.
- Launch impact: LATER — the form has been re-reviewed since; no evidence of a shipped defect from the skipped pass.
- Merge with: M-I-12 (stale ledgers)

### M-I-11: Amendments to Rob's rulings awaiting acknowledgement (D10, D14–D16, D18, PR C scope)
- Sources: DOC-93, DOC-210, PR16-12, PR28-30
- Kind: Risk/open question
- What: Task 15 told Rob and the issue #17 orchestrator: it owns PR C's share-form scope; email Task 4's attachment point moves to the shared submission email builder (≤ 4 previews per send, unique content ids); D14 shortens words in long multi-memory emails under Gmail clipping; D15 raises the per-recipient cap 3 → 15/day ("the firewall rule is the abuse control"); D16 `completeSubmission` waits up to 10 s for READY thumbnails; D10 and D18 are parked (M-C-09, M-D-05).
- Why deferred / reasoning given: "for Rob".
- Verdict: NEEDS-ROB
- Evidence: phase1 ledger `:222` "Amendments to earlier rulings (for Rob): D10, D14, D15, D16, D18"; no acknowledgement line follows; the amended behaviour is live on main (merged in #28/#29).
- Remaining work: Rob reads the five bullets and says ok or not; D15 (per-recipient email cap 3 → 15/day) is the one with an operational consequence (abuse control now rests on the WAF rule, which is a Task 10 gate in area C/E).
- Launch impact: LATER — decisions already in production; only D15 interacts with launch, and it is covered by the WAF item elsewhere.
- Merge with: none

### M-I-12: Stale plan ledgers and unticked boxes (photos plan, admin-page L0–L12, quick-fix S11)
- Sources: DOC-191, PR25-19, PR31-31, PR36-1, DOC-211
- Kind: Deferred minor
- What: `docs/plans/2026-11-03-photos-derived-media.md` Progress: "[ ] PR C — steps 1–7" and "[ ] Ledger Task 12 section; Task 7/8/10 HEIC lines and F7 updated" never ticked though PR #27 merged; admin-page ledger L0–L12 read "todo" with empty Commit/Evidence while the PR reports all checks green; quick-fix ledger S11 `[ ]` though #36 was retargeted and merged.
- Why deferred / reasoning given: docs not back-filled after merges.
- Verdict: OPEN (records only)
- Evidence: `docs/plans/2026-11-03-photos-derived-media.md:818-819` PR C and ledger-section boxes `[ ]` though #27 merged `6c1a217`; `docs/plans/2026-11-04-admin-page.md:41-43` L10–L12 "todo" with empty columns while L13–L14 are "verified"; `docs/plans/2026-11-04-share-form-quick-fixes.md:241` S11 `[ ]` though #36 was retargeted and merged (`ae9fb0b`); phase1 ledger `:202` Task 13 still "PR C in review".
- Remaining work: one docs PR ticking the boxes with the merge SHAs (`6c1a217`, `9ffdb8e`, `3d12cc2`/`ae9fb0b`).
- Launch impact: LATER — bookkeeping; this catalog already corrects the picture.
- Merge with: M-I-10, M-A-09 (same docs PR can fill the SHA placeholder)

### M-I-13: Evidence and review records that live only outside the repo
- Sources: LEDGER-TCR-7, PR20-23, PR25-20, DOC-152, PR15-26, DOC-201, PR20-22
- Kind: Deferred minor
- What: Team-review logs (`~/Downloads/team-review-20261103-013418-…`), the cited email plan C1–C35 (`/Users/rob/.claude/plans/please-use-worldclass-email-fancy-mountain.md`), Astra premortem artifacts (`~/.local/state/astra-work/888f1417a12a/…`), brand screenshots (`~/Downloads/jowray-brand-screenshots-20261103/`, not attached to PR #15 because the API cannot attach images), recorder review buckets only in PR #21 comment `#issuecomment-6614899813`, and build-time rulings in a git-ignored `.superpowers/sdd/.../progress.md`.
- Why deferred / reasoning given: tooling limits; Rob can drag screenshots into PRs.
- Verdict: NOT-DEBT
- Evidence: the cited paths are on Rob's Mac; the repo keeps what matters under `docs/plans/evidence/` (six folders: admin-alert, admin-page, confirmation-email, issue17, share-quick-fixes, share-redesign).
- Remaining work: none unless Rob wants the screenshots dragged into PR #15.
- Launch impact: NEVER — provenance only.
- Merge with: none

### M-I-14: Review coverage gap: Sentry Team Code Review stood on Oscar only
- Sources: DOC-238
- Kind: Risk/open question
- What: George (Gemini) timed out three times at the maximum budget during the Sentry stack review; buckets 2–4 were empty for that round.
- Why deferred / reasoning given: tooling limit.
- Verdict: OPEN
- Evidence: `docs/plans/2026-11-04-sentry-full-telemetry.md:472`: George timed out three times (287/169/110 KB diffs), buckets 2–4 empty; preview gates and `__tests__/lib/sentry-envelope.test.ts` were run instead.
- Remaining work: optional second-reviewer pass over #32–#34 in smaller slices.
- Launch impact: LATER — the stack has an envelope test proving no token leaks, which is the one property that matters for the family.
- Merge with: none

### M-I-15: Site-wide release/rollback runbook
- Sources: PR21-7, DOC-197
- Kind: Follow-up
- What: Deploys happen via Vercel on merge and revert via Vercel rollback; uploaded media and additive columns survive either way, but the four rollback floors (M-A-09) now make a single runbook worthwhile.
- Why deferred / reasoning given: out of scope for PR #21.
- Verdict: OPEN
- Evidence: no `docs/runbooks/` directory; rollback rules are spread across `docs/admin.md:34`, admin-page plan `:299`, admin-alert plan `:20`, PR #30 body, and `docs/environment.md:80-81` (secret rotation); `vercel.json` runs migrations at build.
- Remaining work: one page: deploy = merge to main; rollback = Vercel Instant Rollback never below `9ffdb8e`; if an older build must run, Disable Cron Jobs first; migrations are additive-only; secret rotation steps.
- Launch impact: SHOULD — Rob is the only operator and may need to roll back during launch week while tired; a one-page rule sheet is an hour and removes the need to remember four floors.
- Merge with: M-A-09, M-A-19

### M-I-16: Process lesson: retarget stacked PRs before deleting the base branch
- Sources: PR10-2
- Kind: Deferred minor
- What: `--delete-branch` on the lower PR auto-closed #4 and #6 (re-opened as #8 and #9). Retarget to `main` explicitly first.
- Why deferred / reasoning given: lesson recorded in the ledger.
- Verdict: NITPICK
- Evidence: phase1 ledger `:177` records the lesson; followed for #36 (ledger `:233`, quick-fix plan S11); AGENTS.md has no line about it.
- Remaining work: optionally one sentence in AGENTS.md "Project rules".
- Launch impact: NEVER — agent workflow only.
- Merge with: none

### M-I-17: Standing build risks: Cache Components prerender and network at build time
- Sources: DOC-30, PR3-R1
- Kind: Risk/open question
- What: A page or `GET` handler that reads Prisma or env before a request-time read is prerendered at build time (seen on `/m/[claimToken]`, fixed with `await connection()`); the house rule, lazy `getDb()`/`getXEnv()` and the no-`.env` build are the guard.
- Why deferred / reasoning given: guarded by convention.
- Verdict: NOT-DEBT
- Evidence: AGENTS.md "Cache Components rule" (`await connection()` first, lazy `getDb()`/`getXEnv()`, no `.env` at build) and `scripts/no-network.mjs` + `__tests__/scripts/no-network.test.ts`.
- Remaining work: none; CI enforcement is M-I-02.
- Launch impact: NEVER — guarded by convention and the offline build.
- Merge with: M-I-02

## J. Phase 2 / Phase 3 ideas

### M-J-01: Phase 2 "Analyze and show": transcription, description, tags, search, timeline, gallery, public pages
- Sources: DOC-20, DOC-54, DOC-107, DOC-115, DOC-242, PR3-N12, I17-4, PR16-8, PR28-13, DOC-208, PR16-15, DOC-215, PR31-21, DOC-109
- Kind: Non-goal
- What: Design-doc Phase 2: `ANALYSIS` rows per media file per model run, `DERIVED_MEDIA` (now `DerivedMedia`), pgvector/tsvector search, tag cloud, timeline, gallery, a scheduled analysis cron over `analysis_status = not_started`; public pages reading `APPROVED`/`HIDDEN` (today "approving does not publish anything"); Phase 2 family pages serve the same derived copies and reuse `notifyWhenPosted` rows; family-side titles are a Phase 2 idea (D8). `ELEVENLABS_API_KEY` is unused and to be retired when Phase 2 starts (Gemini transcribes instead); `GEMINI_API_KEY` / `GOOGLE_API_KEY` are placeholders.
- Why deferred / reasoning given: Rob: Phase 2 is explicitly not being built now; collection only.
- Verdict: NOT-DEBT (confirmed nothing implements it)
- Evidence: Code grep over `app/ features/ services/ integrations/ lib/ server/ prisma/` for `transcri|pgvector|tsvector|gallery|timeline|elevenlabs|@google/genai|GoogleGenerativeAI`: only `prisma/schema.prisma:38` `enum AnalysisStatus` and `:138` `analysisStatus … @default(NOT_STARTED)` (schema placeholders, never read), and the admin-only `app/admin/media-gallery.tsx` (view-only media list for admins, not a public gallery). `package.json` has no Gemini/ElevenLabs/vector dependency. `docs/environment.md:24` `ELEVENLABS_API_KEY` "Unused; to be retired", `:95` `GEMINI_API_KEY` "Phase 2; unused in Phase 1". No public page reads APPROVED/HIDDEN; `features/admin/set-status.ts` only changes status. AGENTS.md/brief: Phase 2 is explicitly not being built.
- Remaining work: none now. Housekeeping only: remove `ELEVENLABS_API_KEY` from Vercel/`.env` when Phase 2 starts (already documented).
- Launch impact: NEVER — phase 2 by Rob's decision.
- Merge with: none.

### M-J-02: Gemini API terms decision before processing family media (billed project vs Vertex AI)
- Sources: DOC-43, PR3-F1, PR3-D1
- Kind: Follow-up
- What: Keys without a billed Cloud project are Unpaid Services (Google may use prompts/files, human review). Decide Gemini API with a billed project vs Vertex AI, record which data-use terms apply (Gemini API Additional Terms eff. 2026-03-23; Interactions API stores requests by default, 55 days on paid, pass `store: false`); API clients must not be directed at under-18s.
- Why deferred / reasoning given: Medium; Phase 2 prerequisite.
- Verdict: NOT-DEBT (a Phase 2 prerequisite; decision already recorded at the level needed now)
- Evidence: `docs/plans/phase1-ledger.md` Decisions table: "Gemini in Phase 1 — None. Phase 2 uses a key from a Cloud project with **active billing** [C65]" (2026-11-02, Rob); `docs/environment.md:95` repeats the billing requirement and the Unpaid-Services data-use warning; `docs/plans/2026-11-02-phase1-…md` §11 #1 (Medium) keeps the Gemini-API-vs-Vertex and `store: false` decision open. No Gemini code or dependency exists (see M-J-01), so no family media can be sent anywhere today.
- Remaining work: none before Phase 2; when it starts, decide Gemini API (billed) vs Vertex AI and record the applicable terms.
- Launch impact: NEVER — nothing in the collection launch touches Gemini.
- Merge with: M-J-01.

### M-J-03: Phase 2 mailer: weekly mailing list (`Contributor.mailingListOptIn`) and the promised update email
- Sources: PR16-1, PR16-2
- Kind: Follow-up
- What: `mailingListOptIn` (off by default, migration `20261103190000_contributor_preferences`) records the preference; nothing sends a weekly list. The thank-you copy promises an update email to all contributors on November 10th once stories are shared (see also M-D-06).
- Why deferred / reasoning given: Phase 2 mailer.
- Verdict: NOT-DEBT for the mailer; the November 10th promise is a real copy/communication question (see M-D-06), not code
- Evidence: `prisma/schema.prisma:111` `mailingListOptIn Boolean @default(false)`; it is collected (`app/share/share-form.tsx:600`), shown to admins (`app/admin/memory-detail.tsx:36`, admin alert template `services/email/templates/admin-new-memory.ts:132`) and nothing sends a list (grep: no consumer besides display). `app/share/thank-you-client.tsx:61` still says "On November 10th, after we have some stories, photos and videos collected, we'll be sharing them with everyone and will email an update to all who have contributed." No `EmailType` for an update mail exists (`enum EmailType` has MEMORY_CONFIRMATION, SUBMISSION_CONFIRMATION, ADMIN_NEW_MEMORY only).
- Remaining work: none in code. Rob decides whether the November 10th sentence stays (it is a promise to grieving relatives six days out; with Phase 2 not being built, "sharing them with everyone" on the 10th will not happen through the site). Either soften the copy before launch or plan a hand-sent Gmail update using the admin page's contributor emails.
- Launch impact: SHOULD (copy only) — a dated promise on the thank-you screen that the site cannot keep is a visible rough edge for the family; a one-line copy change. The mailer itself is NEVER.
- Merge with: M-D-06.

### M-J-04: SMS/MMS collection and the phone line (VoIP.ms) — deferred, candidate Phase 3
- Sources: DOC-9, DOC-18, DOC-41, DOC-42, DOC-62, DOC-63, DOC-70, DOC-108, DOC-123, DOC-176, PR1-1, BOOT-R10, PR3-F4, PR3-F5, PR30-29, PR30-7, PR14-1, PR15-1
- Kind: Non-goal
- What: Rob's ruling "deferred, too complex for now"; sub-account `262980_jowray`, DID `2349569729` and keys (`voipms_*`, `VOIPMS_*`, `DID_JOWRAY`) kept unused (recurring cost review is Rob's, §11 #4; the sub-account shows "Register" until a device registers). Blockers and facts to carry forward: the API allows only whitelisted source IPs (`voipms_whitelisted_ip`) and Vercel has no fixed egress (Static IPs $100/month, a relay, or another provider); inbound callback variables conflict between the wiki and the API reference so a live test is needed; Callback Retry expects body `ok` else resends every 30 min; `markListenedVoicemailMessage` moves messages INBOX → Old so identity must never key on `folder`/`message_num`; cheapest voicemail transport is voicemail-to-email via SendGrid Inbound Parse at an `MX` on `jowray.com` (not set up, M-A-18). Vendor-neutral requirements: idempotent inbound on message id, STOP/HELP before any LLM, model output advisory only, outbox with atomic SENDING claim (`FOR UPDATE SKIP LOCKED`), A2P 10DLC and daily caps. F9: `draftMemory()` with `source: SMS` from a webhook once a vendor is chosen. UI consequence: the "Text us" card and phone-in voicemail path were dropped from the home page (three share cards).
- Why deferred / reasoning given: Rob; §9 of the Phase 1 plan holds the verified facts.
- Verdict: NOT-DEBT (deferred by Rob; nothing built; facts preserved)
- Evidence: `docs/plans/phase1-ledger.md` Decisions: "SMS/MMS collection — Deferred: too complex for now; candidate for Phase 3", "Phone line (VoIP.ms voicemail) — Deferred", "VoIP.ms sub-account `262980_jowray`, DID, `voipms_*` keys — **Kept**; unused in Phase 1"; `docs/environment.md:20-23` VoIP.ms rows marked deferred; `docs/plans/2026-11-02-phase1-…md` §9 "Deferred phases: verified facts to carry forward" and §11 #4 (recurring cost review is Rob's) and #5. Code: no VoIP.ms client, no SMS tables (schema has `MemorySource` values only), no "Text us" card on the home page (three share cards per ledger `:181`). `draftMemory()` accepts `source: SMS` for admin drafts only.
- Remaining work: none; Rob's recurring-cost review of the DID/sub-account is a money question, not repo work.
- Launch impact: NEVER — deferred phase.
- Merge with: M-K-02 (the non-goal mirror of this item).

### M-J-05: Phase 3 "Manage": Auth.js magic-link login, user table/roles, contributor merging by verified email
- Sources: DOC-50, DOC-53, PR3-N8, PR3-N11, PR31-12, PR31-20, DOC-109, DOC-242, DOC-20
- Kind: Non-goal
- What: No user table, roles, Auth.js or magic links (admin D5: "MVP alpha for family; Rob accepts the shared-secret risk"); `AUTH_SECRET` is a placeholder. No matching submissions to existing `Contributor` rows by unverified email (would let anyone attach to or rewrite someone else's record); one row per submission; merging/dedupe happens in Phase 3 behind a verified login. Blocks per-person attribution (M-E-03). The shared-secret admin page already covers part of "Manage".
- Why deferred / reasoning given: Phase 3 per the design doc.
- Verdict: NOT-DEBT (confirmed nothing implements it; the shared-secret admin page is the accepted interim)
- Evidence: `prisma/schema.prisma:92` `model User { // Phase 3 fills this in (magic-link login)`, `:102` `model Contributor { // one row per submission in Phase 1; merging by verified email is Phase 3`; grep: no `next-auth`/`@auth/*` dependency or import; `docs/environment.md:97` `AUTH_SECRET` "phase 3". Admin access is the shared-secret cookie (`features/admin/session.ts:61-62`, `SameSite=Lax`, 30 days) per admin plan D5. `features/memories/create-submission.ts` creates a fresh Contributor per send (asserted in `__tests__/features/create-submission.test.ts:74`), so no unverified-email matching exists.
- Remaining work: none before Phase 3.
- Launch impact: NEVER — per-person attribution (M-E-03) is the only thing this blocks and it is not a collection-launch need.
- Merge with: M-K-16 (admin non-goal "no contributor merging"), M-E-03.

## K. Explicit non-goals and accepted residuals

### M-K-01: Bootstrap non-goals (PR #1 / bootstrap report Bucket 3)
- Sources: DOC-13, DOC-16, BOOT-N1, BOOT-N2, BOOT-N3, BOOT-N4, PR1-C1, PR1-C2, PR1-C3, PR1-C4, PR1-C6, PR1-C7, PR1-C9, PR1-11
- Kind: Non-goal
- What: Not hand-listing files for the initial commit (allowlist + index/secret checks suffice); no `--turbopack`/`--webpack` flags (absent in create-next-app 16.4.4, Turbopack is default); no `npm ci` policy for the bootstrap (CI uses `npm ci`); not rewriting Rob's design doc beyond the Twilio → VoIP.ms update; not editing the frozen runbook snapshot `docs/plans/2026-11-02-bootstrap.md`; no CLI/API toggle exists for Neon preview branching (done in the dashboard); not doing the tracked infra follow-ups inside the docs-only PR (all done later in Phase 1).
- Why deferred / reasoning given: as listed.
- Verdict: NOT-DEBT (all still non-goals; none reversed)
- Evidence: `docs/plans/2026-11-02-bootstrap.md` unchanged since the bootstrap commit (frozen snapshot per AGENTS.md); `package.json` scripts carry no `--turbopack`/`--webpack` flag; `.github/workflows/ci.yml` uses `npm ci` (CI only, no bootstrap policy); Neon preview branching remains dashboard-configured (no CLI toggle in repo); the tracked infra follow-ups were done in Phase 1 (ledger Tasks 1–9).
- Remaining work: none.
- Launch impact: NEVER.
- Merge with: none.

### M-K-02: SMS/phone-related non-goals while those phases are deferred
- Sources: DOC-44, DOC-45, DOC-46, DOC-51, PR3-N1, PR3-N2, PR3-N3, PR3-N4, PR3-N9, PR30-20, PR30-38, DOC-164, DOC-166
- Kind: Non-goal
- What: No `Call`/`SmsConversation`/`SmsMessage`/`SyncState` tables or VoIP.ms/Gemini wiring (a table is a one-line migration later; `MemorySource`/`MemoryType` keep every design-doc value because that is free); not recording "VoIP.ms is the wrong vendor" (ruling is "deferred", account kept); SMS callback dedupe, STOP/HELP, LLM hardening, conversation lifecycle, voicemail identity keys, `createVoicemail`, DID rollback, Mac worker runbook, Static IPs, base64 audio are moot; no phone field on the form (`Contributor.phone` column stays); no immutable message id as the `sms:` dedup key (no vendor; key is number + UTC minute + canonical text).
- Why deferred / reasoning given: empty tables and dead code add review noise; see M-J-04.
- Verdict: NOT-DEBT (still non-goals; nothing quietly built)
- Evidence: `prisma/schema.prisma` model list: Memorial, User, Contributor, Memory, Media, DerivedMedia, Person, MemoryRevision, WebhookEvent, EmailLog — no `Call`/`SmsConversation`/`SmsMessage`/`SyncState`; `Contributor.phone` column kept (`:107` "not collected by the Phase 1 form"); `git log -S'name="phone"'` on code: no commit ever added a phone field; `lib/source-ref.ts` keys admin drafts by hash (`sms:` key = number + minute + text, as ruled); the home page has three share cards (ledger `:181`).
- Remaining work: none while M-J-04 is deferred.
- Launch impact: NEVER.
- Merge with: M-J-04.

### M-K-03: Upload/email engineering non-goals from the Phase 1 plan
- Sources: DOC-47, DOC-49, PR3-N5, PR3-N7
- Kind: Non-goal
- What: No durable job system for upload completion (`WebhookEvent` rows, the reconcile cron and a Sentry alert give the same guarantee); no inline SHA-256 of every upload before "Saved" (size/type at `head()` immediately, small files hashed in `after()`, large by the cron; Rob's decision).
- Why deferred / reasoning given: one memorial.
- Verdict: NOT-DEBT (design unchanged)
- Evidence: `features/memories/ingest-upload.ts:25-26` `INLINE_HASH_MAX_BYTES = 50 MB` ("hashed inline in `after()`; larger ones by the cron"); `WebhookEvent` model (`schema.prisma:242` "raw audit; insert first, process after") plus the reconcile cron and Sentry check-ins stand in for a job system; no queue/job dependency in `package.json`.
- Remaining work: none.
- Launch impact: NEVER.
- Merge with: M-H-06 (the gate that would exercise the >50 MB cron-hash path).

### M-K-04: Configuration non-goals (Cache Components, Pino, env pull, Sentry wizard, dotenv)
- Sources: DOC-55, PR3-N13, PR3-N14, PR3-N16, PR3-N17
- Kind: Non-goal
- What: No `export const dynamic`/`runtime` (forbidden under Cache Components; supersedes the EmpathIQ rule); no `serverExternalPackages` for Pino (already default); no interactive Sentry wizard and no pin to `@sentry/nextjs` 10 (manual install; the restrictive `dataCollection` half was later reversed by the 2026-11-04 policy); no `dotenv` in `prisma.config.ts` (`@next/env`). The `vercel env pull .env.local` rule is M-A-12.
- Why deferred / reasoning given: as listed; codified in AGENTS.md.
- Verdict: NOT-DEBT (all hold; one half knowingly superseded)
- Evidence: grep `export const (dynamic|runtime|revalidate|fetchCache)` over `app/`: none; `next.config.ts:14` `serverExternalPackages: ["heic-decode", "libheif-js"]` only (Pino not listed, it is on Next's default list); no `dotenv` dependency or import; `@sentry/nextjs` is at 11.x installed manually (plan §0). The "restrictive `dataCollection`" half of the Sentry ruling was reversed by Rob's 2026-11-04 policy (AGENTS.md Sentry section), which is recorded, not a quiet drift.
- Remaining work: none.
- Launch impact: NEVER.
- Merge with: M-A-12 (env pull rule).

### M-K-05: Accepted residual: duplicate email after a crash between SendGrid 202 and SENT (R5)
- Sources: DOC-48, DOC-85, DOC-124, DOC-134, PR3-N6, LEDGER-TCR-5, PR26-8
- Kind: Non-goal
- What: No "ambiguous outcome" state or SendGrid reconciliation subsystem. A function that dies after the 202 (after three retries) leaves a SENDING row the cron re-sends after 15 minutes with a new link (confirmation) or a duplicate admin alert; accepted as the lesser evil to a silently lost email. Cron (e2) skips a memory with a live PENDING file younger than one hour (R8).
- Why deferred / reasoning given: unique `(memoryId, emailType)` plus cron retry bounds it to one duplicate.
- Verdict: NOT-DEBT (accepted residual; bounds unchanged)
- Evidence: `phase1-ledger.md:170` "Residual: a function that dies between SendGrid's 202 and the SENT write (after three retries) leaves a SENDING row that the cron re-sends after 15 minutes with a new link; accepted as the lesser evil"; `__tests__/services/email.test.ts:462,468,483,492` pin the 15-minute reclaim, fresh-row protection, same-transaction rotation and the three bookkeeping retries; `reconcile.test.ts:294` pins (e2)'s live-lease skip. Unique `(memoryId, emailType)` on `EmailLog` bounds it to one duplicate.
- Remaining work: none.
- Launch impact: NEVER — worst case one family member gets two emails, the second with the working link.
- Merge with: M-H-07.

### M-K-06: Team Code Review findings deliberately not applied (Phase 1)
- Sources: DOC-84, LEDGER-TCR-1, LEDGER-TCR-2, LEDGER-TCR-3, LEDGER-TCR-4, DOC-33, PR3-R4
- Kind: Non-goal
- What: Allowlist case finding (parser already lower-cases); per-recipient quota serialisation/advisory locks (over-engineering for a small cap under a WAF rule); a bypass-secret `callbackUrl` for previews (would put the secret in the client token; preview callbacks stay behind Deployment Protection, covered by the Server-Function path and the cron's orphan sweep); a structural token table (rotation-on-success plus FAILED-on-persist-failure gives the same guarantee).
- Why deferred / reasoning given: as listed.
- Verdict: NOT-DEBT (all four still unapplied, reasons intact)
- Evidence: `phase1-ledger.md:168` "Not applied (ruled)" lists the four; code: no advisory locks (`grep pg_advisory` none), no token table (claim hash on `Memory`, rotation in `services/email`), preview callbacks still behind Deployment Protection (no bypass secret in the client token — `features/memories/issue-upload-ticket.ts`), allowlist parser lower-cases (`server/config/env.ts`).
- Remaining work: none.
- Launch impact: NEVER.
- Merge with: none.

### M-K-07: No application-level rate limiting in Phase 1 (conditional §11 #2)
- Sources: DOC-56, PR3-F2, PR3-N18
- Kind: Non-goal
- What: Daily budgets, the WAF rule and Spend Management are the gates; add `@upstash/ratelimit` keyed by IP on `createMemory`/`/api/upload` plus a per-memorial daily cap only if abuse gets past them. Note the WAF rule itself is not yet created (M-H-01).
- Why deferred / reasoning given: Medium, conditional.
- Verdict: NOT-DEBT, but its stated precondition is NOT yet met
- Evidence: grep `upstash|ratelimit` in code and `git log -S'@upstash'`: never added. `docs/plans/2026-11-02-phase1-…md` §11 #2: build it only "if abuse gets past the daily budgets and the WAF rule". The daily budgets are live (Vercel env, ledger `:99`, unit-tested refusal `create-submission.test.ts:106`), but the WAF rule is still `[ ]` (ledger `:41`), so today the only gate is the daily budget, and the READ COMMITTED race on it is explicitly "WAF rule mitigates" (`:155`).
- Remaining work: none in code; turn on the WAF rule (M-H-01). Reassess only if abuse appears.
- Launch impact: NEVER for the code non-goal; the reason it is safe to skip is M-H-01 (SHOULD).
- Merge with: M-H-01.

### M-K-08: Not redirecting `jowraycom.vercel.app` to `www.jowray.com`
- Sources: DOC-52, DOC-103, PR2-2, PR3-N10
- Kind: Non-goal
- What: The alias still serves the site; harmless now; redirect only if duplicate indexing ever matters.
- Why deferred / reasoning given: not Phase 1.
- Verdict: NOT-DEBT (still not redirected; still harmless)
- Evidence: `next.config.ts` has `headers()` only, no `redirects()`; `vercel.json` has no redirects; grep `jowraycom.vercel.app` in code: none; `git log -S'async redirects'`: never added. Apex → www 308 is in place (ledger `:178`). The site is not meant to be indexed yet and claim links always use `getSiteUrl()` (www in production), so the alias only matters if someone shares the vercel.app URL by hand.
- Remaining work: none.
- Launch impact: NEVER.
- Merge with: none.

### M-K-09: Admin-alert non-goals (backfill, cron fairness, Postgres test, per-recipient rows, links, hardcoded addresses)
- Sources: DOC-125, DOC-126, DOC-127, DOC-128, PR26-9, PR26-10, PR26-11, PR26-12, PR26-13, PR30-15, DOC-166
- Kind: Non-goal
- What: No historical backfill (`ADMIN_ALERT_SINCE` keeps "never alerted" and "new" distinct, R6); no cron fairness rework (revisit only if the cron ever reports `errors` from timeouts); no Postgres integration test for the compound key or live-database/concurrency Vitest tests (CI has no database; unit doubles honour the key); no per-recipient `EmailLog` rows (R3; F15 is the alternative); no `mailto:` or any link in the admin email (Rob: "the edit links are for users only", R2); no hardcoded addresses.
- Why deferred / reasoning given: as listed; "do not re-propose".
- Verdict: NOT-DEBT (all hold)
- Evidence: `ADMIN_ALERT_SINCE` cutoff documented and tested (`reconcile.test.ts:347` "never announces a memory created before the alert feature was activated"); no Postgres integration test exists (`__tests__/` uses doubles throughout; CI has no DB); `EmailLog` still one row per `(memoryId, emailType)` with `recipientEmail` the attempted set; `__tests__/services/admin-template.test.ts:126` "has no anchor, no network image, no mailto and no claim path" and `:134` `expect(html).not.toContain("href=")`; recipients come from `ADMIN_ALERT_EMAILS` (`docs/environment.md:79`), nothing hardcoded.
- Remaining work: none.
- Launch impact: NEVER.
- Merge with: M-H-09 (the one admin-alert check that is still owed is deliverability, not these).

### M-K-10: Brand/home-page non-goals (PR #15, #18, #19)
- Sources: DOC-135, DOC-136, DOC-137, DOC-138, DOC-139, DOC-140, DOC-141, PR15-2, PR15-3, PR15-4, PR15-5, PR15-6, PR15-7, PR15-8, PR15-9, PR15-10, PR15-11, PR15-12, PR15-13, PR15-14, PR15-16, PR18-1, PR19-1
- Kind: Non-goal
- What: Header "Leave a memory" on the thank-you screen is a same-URL link (revisit only if visitors try it); no manual matrix of PENDING/FAILED/REJECTED branches (`__tests__/features/*`); no 10-minute recorder cap (Rob); "Text us" card dropped and the obituary button omitted (superseded: `/obituary` exists with a plain text link and footer link, deliberately no header nav entry, red button or hero date); no `prefetch={false}` on claim-page links (no-referrer in force); `SecondaryLink` does not detect `mailto:`; `.stitch-rule` dead CSS and `secondaryOnGreenClass` removed; no dark mode (one warm theme); emails and `/api` not restyled under § 2 (email later restyled in #20); no Storybook/dev toggle; no in-page "sharing failed" message (falls back to `mailto:`); "Remove recording" uses the standard secondary size; "Hunt Valley" left in mockup/plan as historical snapshots. Per-field inline error messages were declined in #15 and later delivered by #35.
- Why deferred / reasoning given: as listed.
- Verdict: NOT-DEBT (hold, with the two supersessions the catalog already notes)
- Evidence: `app/obituary/page.tsx` exists and is linked only from `app/_components/site-footer.tsx:19` (no header nav entry — confirmed by grep); `git log -S'prefers-color-scheme'`: present in the scaffold, removed in `9fbaa65` (w1-foundation) and never re-added (no dark mode); `prefetch={false}` appears only under `app/admin/*`, not on claim-page links; no `.stitch-rule`; per-field inline errors now exist (`app/share/share-form.tsx:561,566` `role="alert"` lines) — that is the recorded supersession by #35, not a reversal. Recorder has no time cap (`lib/recorder-state.ts` has no max-duration guard per plan).
- Remaining work: none.
- Launch impact: NEVER.
- Merge with: none.

### M-K-11: Email-template non-goals (PR #20, #27)
- Sources: DOC-154, PR20-11, PR20-12, PR20-13, PR20-14, PR20-18, PR20-19, PR20-20, PR27-4
- Kind: Non-goal
- What: No general preview backfill cron (cron (g) covers abandoned uploads only); no `[data-ogsc]`/`[data-ogsb]` Outlook.com dark-mode overrides; no `@font-face` in email (Georgia/Arial stacks, R6); HEIC stays accepted (no dropping it so iOS transcodes, R5); no case-insensitive `kindOf()` with `memory.type` fallback; no byte-equality test of re-rasterised email assets (libvips builds differ); `sharp` stays an exact pin (D5); no per-kind summary rewrite ("3 photos and a video") since the template lists every READY file.
- Why deferred / reasoning given: as listed.
- Verdict: NOT-DEBT (all hold)
- Evidence: `services/email/templates/shared.ts:10` "no @font-face"; tests `email-template.test.ts:95`, `admin-template.test.ts:151` assert it; no `data-ogsc|data-ogsb` anywhere; HEIC still accepted (`lib/media-types.ts:31` `"image/heic"`, `ACCEPT_ATTRIBUTE` in `card-media-client.tsx:221`); `sharp` pinned exactly `0.35.5` in `package.json` devDependencies; no general preview-backfill cron step (cron (g) retries derived rows only, `reconcile.test.ts:220` comments). Template lists every READY file rather than a per-kind summary (`submission-template.test.ts`).
- Remaining work: none.
- Launch impact: NEVER.
- Merge with: M-H-08 (rendering checks, not non-goals).

### M-K-12: Recorder non-goals (PR #21)
- Sources: DOC-196, PR21-3, PR21-4, PR21-5, PR21-8, PR21-9
- Kind: Non-goal
- What: No server-side silence check (ffprobe `volumedetect` in the cron; Rob chose warn-not-delete; the review comment keeps a Low pick-up of a peak-dBFS column for admin); no duration from the media file itself; no clip autosave in IndexedDB (storage/privacy question for a memorial site); no engine-side `coverageGap` marking (timestamp gaps in `lib/audio-level.ts` instead); no clip-resolution handler inside `AudioRecorder.start()` (one effect in `use-recorder.ts`).
- Why deferred / reasoning given: as listed.
- Verdict: NOT-DEBT (all hold)
- Evidence: grep `ffprobe|volumedetect|indexedDB`: none; `features/memories/create-memory.ts:53-54` keeps the client-reported `durationSeconds` as a display hint (non-photo, > 0 only); `app/share/recorder.ts` has no clip autosave; `lib/audio-level.ts:97` timestamp-gap rule rather than an engine `coverageGap`; `useRecorder(` is called once (`share-form.tsx` / `recorder-panel-client.tsx`), no per-card recorders.
- Remaining work: none.
- Launch impact: NEVER.
- Merge with: M-H-04 (device matrix is the gate; these are the declined additions).

### M-K-13: Media-pipeline non-goals (issue #17 plan § 6; PRs #22, #25, #27)
- Sources: DOC-185, PR22-7, PR22-8, PR22-10, PR22-11, PR22-12, PR22-13, PR25-8, PR25-9, PR25-10, PR25-11, PR25-12, PR25-13, PR25-14, PR25-15, PR25-16, PR27-5, PR27-6, PR27-7
- Kind: Non-goal
- What: No request-time conversion in `/api/media`; no client-side HEIC→JPEG; no render columns on `Media`; no desktop-only table via `matchMedia`; not one memory per photo; no per-route function memory (Fluid); no pre-minted tickets; no `Serializable` isolation (row lock); no OPEN/COMPLETE/ABANDONED submission state machine (one lease column); never serve the original inline as a fallback (placeholder until sanitised); no inline blob deletion when a replacement is retired (the idempotent purge is the single path, waits out the 75-min Blob token); FAILED replacements retired at the source; no separate completion tracker for cancelled uploads; no semaphore around buffering the original; retry `too_many_pixels` once per ceiling change; Worker streams left piped; no global `sharp.block`; no "Try again" for a never-received reservation (Cancel + Add instead; reverses plan P12/PR #22); no measuring a picked audio file's duration; no holding the confirmation until a PENDING-finalised file is READY (`completeSubmission` settles with what is READY; the cron records the rest and rotates). Range/206 (item 11) stays a Task 10 item (M-B-05).
- Why deferred / reasoning given: as listed; "copy into PR bodies".
- Verdict: NOT-DEBT (all hold)
- Evidence: `app/api/media/[id]/route.ts` + `features/media/serve-media.ts` redirect to a presigned URL, no request-time conversion, originals never served inline (`serve-media.ts:21` sandbox CSP on the proxy path only); grep `sharp.block|Serializable`: none; `vercel.json` has no `functions.memory`; no `Submission` model (lease columns on `Memory:141-142`); `reconcile.test.ts:380` "51 removed files: 50 on the first run…" and `:489` C1 pin the single idempotent purge path; `completeSubmission` settles with READY files and leaves the rest to the cron (`features/memories/complete-submission.ts:174-199`; `reconcile.test.ts:294`). Range/206 on the route is moot (blob host serves Range) and the presign-window question is M-B-05.
- Remaining work: none.
- Launch impact: NEVER.
- Merge with: M-B-05, M-H-10.

### M-K-14: Share-redesign parking lot "Don't do" (Task 15, PRs #28/#29)
- Sources: DOC-95, DOC-207, PR16-14, PR28-3, PR28-4, PR28-5, PR28-6, PR28-7, PR28-8, PR28-9, PR28-10, PR28-11, PR28-12, PR28-26, PR28-27, PR16-8
- Kind: Non-goal
- What: No title field (D8; derived `labelFor`); no per-card recorders plus capture lock; no two-lock `lockForUpload`; headings stay "Memory N" (no ordinals); authorization stays token arguments, not cookies/headers; no `Submission` table or state machine; no pre-minted tickets (15-min expiry); no one email per memory; no phone tip at the top (D12: thank-you screen only); no hand-written partial unique index (Prisma drift); keep the "only copy of these links" line even when the email merely failed (cron retry rotates tokens anyway); not squashing the two B1 commits.
- Why deferred / reasoning given: as listed.
- Verdict: NOT-DEBT (all hold)
- Evidence: `git log -S'name="title"'` on code: never added (labels derive via `labelFor` per `lib/memory-cards.ts` tests); one recorder (see M-K-12); headings "Memory N" (`browser-checks.json`, evidence README); authorization by token arguments (`features/memories/create-memory.ts:152` test "refuses … a wrong token"); no `Submission` table; tickets minted on demand with 15-min expiry (`lib/upload-ticket.ts` tests); one receipt per send keyed on the anchor (`complete-submission.ts:174` `memoryId: anchor.id, emailType: "SUBMISSION_CONFIRMATION"`); "only copy of these links" line present on the not-emailed thank-you (`a-390-thank-you-not-emailed.png` row in the quick-fixes README).
- Remaining work: none.
- Launch impact: NEVER.
- Merge with: none.

### M-K-15: Draft-on-behalf non-goals (PR #30)
- Sources: DOC-165, DOC-166, DOC-164, DOC-162, PR30-5, PR30-6, PR30-8, PR30-13, PR30-14, PR30-16, PR30-17, PR30-18, PR30-19, PR30-37, PR30-40, PR30-41
- Kind: Non-goal
- What: Product: no AI rewriting of anyone's words; no site-sent invitation or any site email for admin-drafted memories (Rob's Gmail reply is the only message); no "save for later" on a draft's claim page. Engineering: no two-PR rollout (roll-forward rule covers the window); no local ledger of contributors/memory ids/Gmail draft ids; no reliance on Prisma `meta.target`; no new email template or `EmailType`; no change to the Media upload path; no issue-writer subagents or multi-cycle repair loop; no request-path admin alert on Share (R1: cron alerts within ≤ 10 min; the "submitted at shows draft time" minor was fixed by P1 `submittedAt = consentedAt ?? createdAt`); no redaction of claim links from the script's success output (bearer secret is redacted everywhere); no separate `budget.ts` (reuses `withinBudget`/`TX_OPTIONS`). Items F2/F4/F5/F9/F12 that were "non-goals with a follow-up" are tracked in E/C/J.
- Why deferred / reasoning given: as listed.
- Verdict: NOT-DEBT (all hold)
- Evidence: `docs/plans/2026-11-03-draft-memory-on-behalf.md` §10 "Non-goals"; `enum EmailType` unchanged (no draft/invitation type); `features/memories/draft-memory.ts` reuses `withinBudget`/`TX_OPTIONS` (`draft-memory.test.ts` budget cases); no AI rewriting anywhere (no LLM dependency, M-J-01); request-path alert for Share stays off (cron (e3) alerts within 10 min, `reconcile.test.ts:311`); `submittedAt = consentedAt ?? createdAt` fix landed (P1).
- Remaining work: none.
- Launch impact: NEVER.
- Merge with: none.

### M-K-16: Admin-page non-goals (PR #31, plan § 10)
- Sources: DOC-214, DOC-215, PR31-11, PR31-14, PR31-15, PR31-16, PR31-17, PR31-18, PR31-19, PR31-13, PR31-21
- Kind: Non-goal
- What: Cookie stays `SameSite=Lax` (Strict would land every emailed admin link on the signed-out page; revisit if a state-changing `GET` ever appears under `/admin`); media view-only (D4 → M-E-04); no hard delete or immediate blob purge (30-day grace; one schema change `Media.purgedAt`); no reversal of a purge once `purgedAt` is set; no blocking Restore after 30 days; no approving a DRAFT (the sender's Share is the consent); no editing a contributor's email or the three preference flags; no `?key=` query-string entry (would land the secret in request logs); no Gmail-id/SMS fields in the browser draft form (`source: OTHER`); no contributor merging (M-J-05); no claim-form version check in that PR (A8 → M-C-04); no `deletedAt` filter on (e3) (M-B-15); no "posted" email (M-D-06); no public pages; no paging/sorting/bulk; no `proxy.ts`; no route-group refactor in that PR (A1 → M-E-01).
- Why deferred / reasoning given: "declined; do not re-raise unless the reason is wrong".
- Verdict: NOT-DEBT (all hold; `SameSite=Lax` reason still valid)
- Evidence: `docs/plans/2026-11-04-admin-page.md:352` "## 10. Non-goals (declined; do not re-raise unless the reason is wrong)"; `features/admin/session.ts:61-62` `sameSite: "lax", path: "/admin"` (tests `admin-session.test.ts:99`, `admin-actions.test.ts:85`); `git log -S'sameSite: "strict"'`: never; no state-changing `GET` under `/admin` (all mutations are Server Functions / POST routes under `app/api/admin/memories/**`), so the Lax reasoning still holds; soft delete + 30-day purge via `Media.purgedAt` (`features/admin/set-deleted.ts:17,34`; `reconcile.test.ts:489,530`), no hard delete; `features/admin/set-status.ts:32` refuses status changes on a `DRAFT`; entry key travels in the URL fragment (`lib/sentry/scrub.ts:15` "`/admin/enter#key=<secret>`"), no `?key=`; no paging/sorting/bulk, no `proxy.ts`.
- Remaining work: none.
- Launch impact: NEVER.
- Merge with: M-J-05 (contributor merging), M-E-04 (media view-only), M-D-06 ("posted" email).

### M-K-17: Sentry non-goals and accepted residuals (alpha data policy, Rob 2026-11-04)
- Sources: DOC-120, DOC-230, DOC-240, PR34-4, PR34-6, PR34-7, PR34-8, PR34-9, PR34-10, PR34-11, PR34-12, PR34-13, PR33-2, DOC-118
- Kind: Non-goal
- What: Accepted residuals: the `/m/<token>` page URL inside replay DOM recordings and rrweb meta `href` (Rob chose to record `/m/*`), user-taken feedback screenshots (may show thank-you links), feedback form text, signed media URLs in breadcrumbs; nothing is masked or blocked (reversal mechanism if ever needed: `data-sentry-block` on the thank-you `<ul>` and claim media cards plus `replaysSessionSampleRate: 0` on `/m/*`). Not doing: `_experimental.vercelCronsMonitoring` (explicit check-ins instead); Content-Security-Policy (separate task; if added, Replay needs `worker-src 'self' blob:` and the tunnel `connect-src 'self'`); lazy-loading Replay/Feedback; `replayCanvasIntegration` (no canvas); server-side Advanced Data Scrubbing as the token defence (client scrubbing is authoritative); `tracesSampler` per route; Sentry agent plugin / Vercel Drains / Marketplace; emailing claim links from the admin alert. Known limitation R5: the recorded Server Function result is visible only to events captured inside the action.
- Why deferred / reasoning given: 100 % telemetry for a family alpha; tokens stay scrubbed everywhere.
- Verdict: NOT-DEBT (standing; nothing reversed since #34)
- Evidence: AGENTS.md "Sentry (alpha data policy, 2026-11-04)" names the two accepted residuals; grep `vercelCronsMonitoring|replayCanvas|tracesSampler|Content-Security-Policy` in code: none (the only CSP string is the per-response sandbox header on the media proxy route, `features/media/serve-media.ts:21`, not a page CSP); `instrumentation-client.ts` ships Replay/Feedback eagerly (no lazy load, per plan §14); the reconcile cron uses explicit check-ins (`reconcile.test.ts:437`); `__tests__/lib/sentry-envelope.test.ts` is the authoritative token defence. The reversal lever (`data-sentry-block`, `replaysSessionSampleRate: 0` on `/m/*`) is documented in the plan §13 and M-F-11.
- Remaining work: none until Rob ends the alpha (M-F-11).
- Launch impact: NEVER — Rob's explicit ruling for the alpha; tokens stay scrubbed everywhere (tested).
- Merge with: M-F-11, M-H-11.

### M-K-18: Share quick-fix non-goals (PRs #35/#36, premortem bucket 3)
- Sources: PR35-3, PR35-4, PR35-13, PR36-3, PR36-4, PR36-8
- Kind: Non-goal
- What: No `block: "nearest"`/viewport check in the reveal effect alone (structural fix: error line inside the growing words box); no bounding of the words cell (the textarea is bounded instead); no capping the textarea alone; `role="alert"` summary kept (VoiceOver check is in the device list); no `flushSync`; `null` rejected with the same required message (no separate null semantics); no `w-full` on the outer div; exact `submissionIssueLocation` implementation kept; windows 768–1279 px wide (`wide` not `roomy`) intentionally lose the duplicate "+ Add another memory" button while a placeholder exists (acceptance is "390 unchanged").
- Why deferred / reasoning given: as listed.
- Verdict: NOT-DEBT (all hold as merged)
- Evidence: grep `block: "nearest"|flushSync`: none; `lib/reveal-scroll.ts` (measured delta scroll, unit-tested) is the structural fix; `role="alert"` summary kept (`share-form.tsx:539`); the `wide` 768–1279 px window keeps one "+ Add another memory" (`b-1279x900.png` row in the quick-fixes README, "Placeholders shown 2 (full width)"); 390 px pixel-compared unchanged (README "390 identical to PR A"). `design/DESIGN.md:157` goldenrod-vs-walnut focus outline note is M-G-xx territory, not this item.
- Remaining work: none.
- Launch impact: NEVER.
- Merge with: M-H-05 (the VoiceOver check that the kept `role="alert"` depends on).
