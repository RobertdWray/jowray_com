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
features/       use cases (createSubmission, recordMedia, confirm); import services and lib
services/       interfaces + factories (storage, email, images; the two email templates share `services/email/templates/shared.ts`); import integrations
integrations/   vendor clients (Vercel Blob, SendGrid, sharp + libheif WASM); import nothing above them
server/         db client, env sub-schemas (server-only leaves)
lib/            helpers with no layer above them: logger, validations, claim tokens, media types, site URL (storage and derived prefixes), derived keys, image-derive error, HEIC worker thread, email assets (generated base64 PNG brand marks; `scripts/make-email-assets.ts` regenerates them) (some are server-only)
```

- `app/ → features/ → services/ → integrations/`. A layer imports only from layers below it plus `lib/` and `server/`. Nothing imports from `app/`. Pages and Server Functions call `features/`; route handlers under `app/api/` may also call `services/` directly (they are the HTTP adapter layer); nothing in `app/` imports `integrations/`. `eslint.config.mjs` enforces this with `no-restricted-imports`. One exception: `integrations/*` may import **types** from `services/*/types` (they implement those interfaces); value imports stay forbidden.
- `app/_components/` holds shared visitor-facing UI (header, footer, hearts, buttons, field classes). It is a Next.js private folder (not a route), imported only from `app/**` with relative paths, and it never imports `@/server`, `@/integrations` or `server-only` because Client Components use it; `eslint.config.mjs` applies the client-component import rule to it.
- `integrations/*`, `server/*` and anything that reads secrets start with `import "server-only"`. Tests import them through the Vitest alias to `__tests__/stubs/server-only.ts`.
- Client Components (by convention `*-form.tsx`, `*-client.tsx`, `recorder.ts`, `use-*.ts` hooks, `app/global-error.tsx`, `instrumentation-client.ts`) never import `@/server` or `@/integrations`; they call Server Functions.
- Server code logs with Pino (`lib/logger`), never `console.log`. The logger redacts `email`, `recipientEmail`, `name`, `phone` at the top level and up to two levels down (Pino wildcards are one level each), plus cookies and authorization headers. Log ids (`memoryId`, `mediaId`), never Prisma rows or people.
- Route handlers validate input with zod schemas from `lib/validations` and answer `{ success, data }` or `{ error: { code, message } }`.

### Cache Components rule (replaces EmpathIQ's `force-dynamic` rule)

Next.js 16 with `cacheComponents: true` prerenders whatever it can at build time. A build runs with no database and no `.env`, so:

- Never export `dynamic`, `runtime`, `revalidate` or `fetchCache` from a route file.
- The **first** thing a dynamic page component does is `await connection()` (then `params`/`searchParams`/`headers()` as needed); a `GET` handler reads `request.headers` or `request.nextUrl` first. Only then touch Prisma or env. `await params` by itself is not enough: a runtime prefetch prerender knows the URL, and the Neon driver's `randomBytes` on connect then fails the prerender (seen on `/m/[claimToken]`, 2026-11-03).
- `maxDuration` is allowed; for Server Functions it is set on the page that hosts them.
- Never construct a `PrismaClient` or parse env at module scope. Use `getDb()` and the lazy `getXEnv()` accessors in `server/config/env.ts`, each of which parses on first call.
- Each task adds only its own env sub-schema to `server/config/env.ts`; booleans parse strictly (`"true"` / `"false"`), lists are split, trimmed and lower-cased.

### Sentry (alpha data policy, 2026-11-04)

- `lib/sentry/data-collection.ts` is the one data policy for both inits. Rob, 2026-11-04: "I have deliberately authorized and pushed for 100 % tracking and error data collection. The family has approved these aggressive tracking measures since it is an alpha, vibe-coded website and only family will be using it. Intensive logging to rapidly fix errors is more important than security and privacy." It supersedes the Phase 1 "everything off, Replay off" policy. Plan and rulings: `docs/plans/2026-11-04-sentry-full-telemetry.md` (§2a, §3).
- Allowed in Sentry: contributor email and name as user context, Server Function inputs and outputs, headers, Prisma query data, stack-frame locals, unmasked replays. Still forbidden everywhere: claim tokens in any form (`/m/<token>`, `?t=`, `claimToken(s)`, `claimLink`), upload tickets (`ticket`, `clientPayload`, `sig`) and the values of `cookie`, `authorization`, `x-vercel-protection-bypass`, `x-vercel-signature`. The names live in `lib/sentry/secrets.ts`; `lib/sentry/scrub.ts` removes them from every event, span, log, breadcrumb, context and replay custom event; `__tests__/lib/sentry-envelope.test.ts` runs the real server SDK with the policy and proves no synthetic `SENTRYTEST_` token leaves while the user email does. Two accepted residuals (Rob, 2026-11-04): the `/m/<token>` page URL inside replay DOM recordings and user-taken feedback screenshots.
- The tunnel is in handler mode: `app/sentry-tunnel/route.ts` re-exports the SDK's `POST`, and `tunnelRoute: "/sentry-tunnel"` in `next.config.ts` names it. A healthy build log contains `[@sentry/nextjs] The tunnel route sends events through app/sentry-tunnel/route.ts.`; rewrite mode would drop browser events on protected previews (SDK 11.9+).
- Pino's `[Redacted]` behaviour for log lines is unchanged; Sentry Logs carry `user.email` automatically once the user is set.
- Browser (`instrumentation-client.ts`): 100 % traces and Session Replay (text, inputs and media unmasked), replay network bodies for same-origin requests (scrubbed by `scrubRecordingEvent`), the floating "Report a problem" feedback button (styled from `#sentry-feedback` in `app/globals.css`; name and email pre-filled from the identified contributor; screenshots on), browser profiling (`Document-Policy: js-profiling` on every response from `next.config.ts`; Chromium only), the third-party error filter in tag mode (`applicationKey: "jowray_com"`), React component annotation and widened source-map upload. `app/global-error.tsx` shows the crash-report dialog. Server (`instrumentation.ts`): every Server Function is wrapped by `instrumentedAction`, `afterWithFlush(name, cb)` groups deferred work into one `task` span, the reconcile cron reports explicit check-ins (production only) with every item in its own isolation scope. Node profiling is deferred (no Node 26 binary). If a Content-Security-Policy is ever added, Replay needs `worker-src 'self' blob:` and the tunnel needs `connect-src 'self'`.
- Identity: `lib/sentry/user.ts`. `user.email` is the key, `user.username` the name, `user.id` the contributor id when known; `memory_id`, `media_id` and `submission_id` are tags (`tagIds`), never `user.id`. Set only where the contributor row is already loaded; in the browser from the remembered contributor, the typed fields and the loaded memory. Swallowed browser errors go through `reportClientError` (`lib/sentry/report.ts`) with `surface` and `step` tags.

### Checks

`npm run validate` (= `next typegen && tsc --noEmit`, then `eslint`), `npm run test:run`, `npm run build:offline` (the build behind `scripts/no-network.mjs`, which refuses non-loopback sockets and DNS lookups on the main thread of every Node process in the build; worker threads and native code are outside it, so it is a strong check, not a proof — `__tests__/scripts/no-network.test.ts` pins its behaviour). All three pass with `DATABASE_URL` unset and no `.env*` file; fonts come from the Fontsource packages.

### Rules every agent follows

- Every change goes on a branch with a PR.
- No `eslint-disable` without Rob's all-caps "YES". No band-aids: fix the root cause.
- No git submodules. Never commit `.env*`. Never print secret values.
- TDD for critical paths (upload tickets, finalize, confirmation, cron).
