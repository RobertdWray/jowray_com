# Phase 1 findings log

Running log of verification results, event ids and anything a check turned up (plan §4). Dated entries, newest last. No secret values.

## 2026-11-02 — Task 0

- Domain: `https://www.jowray.com/` → 200; `https://jowray.com/` → 308 → `https://www.jowray.com/`.
- Vercel: team `rob-wrays-projects` is on **Pro** (10-minute cron, WAF rate limiting and Spend Management are available).
- SendGrid (API, read-only): account type `paid`; key scopes include `mail.send`, `whitelabel.*`, `sender_verification_eligible`; no domain authentication for `jowray.com` yet; `robwray@gmail.com` is a verified single sender.
- Neon CLI 2.4.0 present but not authenticated; `neon projects list` fails until `neonctl auth` or `NEON_API_KEY`.
- EmpathIQ reference cloned at `ac902c9` to `/Users/rob/Documents/active_work/_reference/empathiq` (outside the repo).
- Local toolchain: node v22.23.4 / npm 10.9.9 (Vercel and CI build on Node 26).

## 2026-11-02 — Tasks 1, 2a, 2b (PR #4)

- Offline build check: `sandbox-exec` with any network-denying profile (even one that only denies outbound ports 80/443) makes `next build` fail with `Failed to write app endpoint /page … binding to a port … Operation not permitted`, because Turbopack's loader pool binds a loopback port that the sandbox refuses. The check therefore uses a Node preload (`NODE_OPTIONS=--require no-network.cjs`) that fails `dns.lookup` and `net.Socket.connect` for every non-loopback host; it propagates to Turbopack's Node child processes and to Vitest. Control: the pre-font-swap scaffold build fails on `fonts.googleapis.com` under the sandbox; the font-swapped build passes under the blocker with no `DATABASE_URL`.
- `npm audit` after the Task 2a install: three advisories, all transitive (`deepmerge` under `@sendgrid/mail`, `glob`/`minimatch` under `@sentry/bundler-plugins`); `npm audit fix --force` would downgrade to `@sendgrid/mail@6` and `@sentry/nextjs@10`. Not applied; revisit when upstream releases fixes.
- Local Node is v22.23.4 while Vercel and CI run Node 26; nothing in PR A depends on the difference.

## 2026-11-03 — Task 5 (PR C)

- **`vercel blob create-store --yes` overwrites `.env.local`.** Vercel CLI 65.9.0 connects the new store to the project and then pulls the Development environment into `.env.local` (it printed `✓ Updated .env.local file`), which replaced the Neon `dev`-branch `DATABASE_URL`/`DATABASE_URL_UNPOOLED` override with the Development environment's values (host `ep-withered-meadow-…`, the Vercel-managed values) and added every `PG*`/`POSTGRES_*` key. Restored by hand to `VERCEL_OIDC_TOKEN` plus the two `dev`-branch URLs. Rule for later tasks: after any `vercel` command that may touch env (`create-store`, `link`, `env pull`), re-check `.env.local` with the Task 1 checks before running Prisma.
- The Development environment pull contains `BLOB_READ_WRITE_TOKEN` but no `BLOB_STORE_ID`; `vercel blob list-stores --all` does not list the new store either; the id is the fourth `_`-separated segment of `BLOB_READ_WRITE_TOKEN` (`vercel_blob_rw_<id>_…`, confirmed with `vercel blob get-store store_<id>`), added to `.env` as `BLOB_STORE_ID` by hand.
- `@vercel/blob@2.8.2` **does** export `issueSignedToken` and `presignUrl` (operation `get`, `validUntil`), contrary to the plan's note that a presigned GET was not in the type definitions. Task 5 uses a presigned redirect for `/api/media/[id]` (see the ledger ruling).

## 2026-11-03 — Task 6 (PR C)

- SendGrid domain authentication for `jowray.com` created via `POST /v3/whitelabel/domains` (id 33798852, subdomain `em4653`, automated security). With automated security the API returns three CNAMEs (`mail_cname`, `dkim1`, `dkim2`); there is no SPF TXT and no DMARC record in that set, so the script adds `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:dmarc@jowray.com` itself. Link branding (two more CNAMEs in the UI flow) was not created.
- `POST /v3/whitelabel/domains/33798852/validate` immediately after creation: all three pending ("Expected CNAME … to match …"), as expected before propagation. Re-run the script later; it is idempotent (every record is looked up by type + name first).
- Test email to Rob (message id `kFBfoijgTHOAwVEiKZBjzQ`): `dkim=pass` (jowray.com, s1), `spf=pass` (envelope `em4653.jowray.com`), `dmarc=pass`. The HTML part arrived with a SendGrid **open-tracking pixel** (`…ct.sendgrid.net/wf/open?…`): the account has open tracking on by default. The transport and the test script now send `trackingSettings.openTracking.enable = false` alongside the click-tracking opt-out, so the confirmation email loads no third-party asset.
