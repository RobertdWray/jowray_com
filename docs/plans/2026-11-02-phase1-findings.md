# Phase 1 findings log

Running log of verification results, event ids and anything a check turned up (plan §4). Dated entries, newest last. No secret values.

## 2026-11-02 — Task 0

- Domain: `https://www.jowray.com/` → 200; `https://jowray.com/` → 308 → `https://www.jowray.com/`.
- Vercel: team `rob-wrays-projects` is on **Pro** (10-minute cron, WAF rate limiting and Spend Management are available).
- SendGrid (API, read-only): account type `paid`; key scopes include `mail.send`, `whitelabel.*`, `sender_verification_eligible`; no domain authentication for `jowray.com` yet; `robwray@gmail.com` is a verified single sender.
- Neon CLI 2.4.0 present but not authenticated; `neon projects list` fails until `neonctl auth` or `NEON_API_KEY`.
- EmpathIQ reference cloned at `ac902c9` to `/Users/rob/Documents/active_work/_reference/empathiq` (outside the repo).
- Local toolchain: node v22.23.4 / npm 10.9.9 (Vercel and CI build on Node 26).
