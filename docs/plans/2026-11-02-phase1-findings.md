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
