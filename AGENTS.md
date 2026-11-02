<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules (Rob, apply to every agent)
- After the bootstrap commit, every change goes on a branch with a PR, including critical fixes.
- Never add a git submodule unless Rob approves it directly.
- Never add an ESLint suppression (`eslint-disable…`) unless Rob approves with an all-caps "YES" after being asked.
- Never hide an error to keep moving. Fix the root cause with best-practice code. Use a band-aid only if Rob insists; if you're stuck, ask Rob how to find the root cause.
- Never apply "unsafe" automatic fixes (for example `ruff --unsafe-fixes`) without asking Rob first.
- Never commit secrets. `.env*` files are gitignored; key names and purposes are in `docs/environment.md`.
- Bootstrap history and decisions: `docs/plans/2026-11-02-bootstrap.md`.
