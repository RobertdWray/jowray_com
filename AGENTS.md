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
- Bootstrap history and decisions: `docs/plans/2026-11-02-bootstrap-report.md` is the final, authoritative record (resources, IDs, decisions, open follow-ups). `docs/plans/2026-11-02-bootstrap.md` is the runbook snapshot taken before the initial commit; its STATUS is frozen.

## Code layout and house rules

The full text lives in `docs/code-layout.md`; this copy is kept in sync by the orchestrator.

Adapted from the EmpathIQ conventions for this repo's root-level `app/` directory (no `src/`; `@/*` maps to the repo root).

### Layers and import direction

```
app/            routes, pages, Server Functions, route handlers (thin; call features)
features/       use cases (createMemory, recordMedia, confirm); import services and lib
services/       interfaces + factories (storage, email); import integrations
integrations/   vendor clients (Vercel Blob, SendGrid); import nothing above them
server/         db client, env sub-schemas (server-only leaves)
lib/            pure helpers: logger, validations, claim tokens, media types, site URL
```

- `app/ → features/ → services/ → integrations/`. A layer imports only from layers below it plus `lib/` and `server/`. Nothing imports from `app/`. `eslint.config.mjs` enforces this with `no-restricted-imports`.
- `integrations/*`, `server/*` and anything that reads secrets start with `import "server-only"`. Tests import them through the Vitest alias to `__tests__/stubs/server-only.ts`.
- Client Components (by convention `*-form.tsx`, `*-client.tsx`, `recorder.ts`, `app/global-error.tsx`, `instrumentation-client.ts`) never import `@/server` or `@/integrations`; they call Server Functions.
- Server code logs with Pino (`lib/logger`), never `console.log`. The logger redacts `email`, `recipientEmail`, `name`, `phone`, cookies and authorization headers at any depth. Log ids (`memoryId`, `mediaId`), never people.
- Route handlers validate input with zod schemas from `lib/validations` and answer `{ success, data }` or `{ error: { code, message } }`.

### Cache Components rule (replaces EmpathIQ's `force-dynamic` rule)

Next.js 16 with `cacheComponents: true` prerenders whatever it can at build time. A build runs with no database and no `.env`, so:

- Never export `dynamic`, `runtime`, `revalidate` or `fetchCache` from a route file.
- The **first** thing a dynamic page component or `GET` handler does is a request-time read: `await params`, `await searchParams`, `cookies()`, `headers()`, `request.headers`, `request.nextUrl`, or `await connection()`. Only then touch Prisma or env.
- `maxDuration` is allowed; for Server Functions it is set on the page that hosts them.
- Never construct a `PrismaClient` or parse env at module scope. Use `getDb()` and the lazy `getXEnv()` accessors in `server/config/env.ts`, each of which parses on first call.
- Each task adds only its own env sub-schema to `server/config/env.ts`; booleans parse strictly (`"true"` / `"false"`), lists are split, trimmed and lower-cased.

### Checks

`npm run validate` (= `next typegen && tsc --noEmit`, then `eslint`), `npm run test:run`, `npm run build`. All three pass with `DATABASE_URL` unset and the network disabled; the build downloads nothing (fonts come from the `geist` package).

### Rules every agent follows

- Every change goes on a branch with a PR.
- No `eslint-disable` without Rob's all-caps "YES". No band-aids: fix the root cause.
- No git submodules. Never commit `.env*`. Never print secret values.
- TDD for critical paths (upload tickets, finalize, confirmation, cron).
