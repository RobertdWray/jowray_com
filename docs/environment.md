# Environment variables

This file lists key **names** and what they're for. It never contains values. The secrets themselves live in the gitignored `.env` (mode 600) on Rob's machine and in the Vercel project's environment settings.

## How env works here

- Next.js loads `.env*` files into `process.env`. `prisma.config.ts` loads the same files through `@next/env` (`loadEnvConfig`, production file set: `.env.production.local`, `.env.local`, `.env.production`, `.env`; it never reads `.env.development*`). Load order: `process.env` → `.env.$(NODE_ENV).local` → `.env.local` → `.env.$(NODE_ENV)` → `.env`. The first match wins, so **`.env.local` overrides `.env`**. ([Next.js docs](https://nextjs.org/docs/app/guides/environment-variables#environment-variable-load-order))
- **Every project key lives in `.env`.** The one exception is `VERCEL_OIDC_TOKEN`: `vercel link` writes it to `.env.local`, and it stays only there. ([Vercel changelog](https://vercel.com/changelog/preserve-local-environment-variables-when-linking-with-the-vercel-cli))
- The Neon values come from the Vercel project. To see the current values, run `vercel env pull <tmpfile> --environment=development` and merge in only the keys that are missing. Don't let the tool overwrite `.env`, because other tooling edits that file too. ([Vercel CLI docs](https://vercel.com/docs/cli/env#exporting-development-environment-variables))
- **Never commit `.env*`.** The scaffold `.gitignore` already ignores `.env*` and `.vercel`.
- Only variables prefixed `NEXT_PUBLIC_` reach the browser bundle. Everything else is server-only.

## Pre-existing keys (managed by Rob)

| Key | Purpose |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID for DNS. *(Renamed on 2026-11-02 from the misspelled `CLOUDFLARE_ACCOUNTT_ID`.)* |
| `CLOUDFLARE_DNS_ONLY_API_TOKEN` | Account-owned Cloudflare API token for DNS edits in every zone in the account. Verify it with `/accounts/{id}/tokens/verify`, not `/user/tokens/verify`. It manages the `jowray.com` records; see [domain.md](domain.md). The account-wide scope is accepted as-is (Rob, 2026-11-05, public-repo audit #43: no rotation or re-scoping of existing keys). |
| `SENDGRID_API_KEY` | Outbound email (notifications, and later magic links). |
| `DID_JOWRAY` | The memorial phone number (a VoIP.ms DID) that people call or text to leave memories. The sub-account's status and what is still Rob's are in [voip_ms_262980_jowray-subaccount-settings.md](voip_ms_262980_jowray-subaccount-settings.md); the full settings table was removed from that file before the repo went public (#43). |
| `voipms_username`, `voipms_password`, `voipms_Bearer_Token`, `voipms_whitelisted_ip` | VoIP.ms API access: the phone and SMS provider. **Deferred: unused in Phase 1** (SMS/MMS and the phone line are a later phase; the sub-account and keys are kept). |
| `VOIPMS_SUB_ACCOUNT`, `VOIPMS_SUB_PASSWORD`, `VOIPMS_POP` | The VoIP.ms SIP sub-account and point of presence for the DID. |
| `VOIPMS_PHONEBOOK_GROUP`, `VOIPMS_TIME_CONDITION`, `VOIPMS_CALLERID_FILTER`, `VOIPMS_FRIENDS_GROUP`, `VOIPMS_FRIENDS_FILTER` | VoIP.ms call-routing objects: a phonebook group, a time condition, and caller-ID filters. |
| `ELEVENLABS_API_KEY` | **Unused; to be retired.** Phase 2 transcribes with Gemini instead of ElevenLabs speech-to-text. Remove the key when Phase 2 starts. ([ElevenLabs docs](https://elevenlabs.io/docs/eleven-api/quickstart#create-an-api-key)) |

## Neon Postgres (set by the Vercel–Neon integration)

The Vercel-managed Neon integration sets these for the `jowray.com` project in Production, Preview, and Development. ([Neon docs](https://neon.com/docs/guides/vercel-managed-integration#environment-variables-set-by-the-integration))

| Key | Purpose |
|---|---|
| `DATABASE_URL` | **Pooled** connection string (PgBouncer). The app uses this one. |
| `DATABASE_URL_UNPOOLED` | Direct connection string, for migrations and session-level features. |
| `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGDATABASE`, `PGPASSWORD` | The raw pieces, for building custom connection strings. |
| `POSTGRES_*` | Legacy Vercel Postgres names, kept for backward compatibility. Don't use them in new code. |
| `NEON_PROJECT_ID` | The Neon project identifier (`icy-scene-20351172`). Not a secret. |

The integration was provisioned with Neon Auth and Realtime **off**, so `NEON_AUTH_*` and `NEON_REALTIME_*` aren't set. Preview deployments get their own `preview/<git-branch>` database branch, with its own values.

## Sentry

| Key | Purpose |
|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | The DSN for Sentry project `med3ai/jowray_com` (API host `https://us.sentry.io`). It holds a **real value**: DSNs aren't secrets. ([Sentry docs](https://docs.sentry.io/security-legal-pii/security/token-formats/#excluding-dsns), [Next.js SDK](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#initialize-sentry-sdks)) |
| `SENTRY_AUTH_TOKEN` | **Placeholder (empty) locally; set in Vercel only.** A Sentry **organization** token (`org:ci`) that lets Vercel builds upload source maps. It is never copied into local `.env`, so local and worker builds skip the upload (`sourcemaps.disable` in `next.config.ts`). ([Sentry docs](https://docs.sentry.io/platforms/javascript/guides/nextjs/#add-readable-stack-traces-with-source-maps)) |

The alpha telemetry (plan `docs/plans/2026-11-04-sentry-full-telemetry.md`: 100 % traces and replays, feedback widget, browser profiling, cron monitor, metrics) needs no further keys. `VERCEL_ENV` (set by Vercel) decides where the cron monitor checks in (`production` only) and the `environment` tag; `NEXT_PUBLIC_VERCEL_ENV` does the same in the browser. Browser profiling is a response header (`Document-Policy: js-profiling`, `next.config.ts`), not an env var.

## Phase 1: orchestrator and CI keys

These are used by the agent running the Phase 1 plan and by GitHub Actions, never by the app.

| Key | Purpose |
|---|---|
| `NEON_API_KEY` | Neon API key for the Vercel-managed org, used by the `neon` CLI (`--api-key`) when `neonctl auth` is not available and by `.github/workflows/neon-cleanup.yml` as the GitHub secret `NEON_API_KEY`. Create it from the Neon console (Vercel → Storage → `jowray_com` → Open in Neon → Account settings → API keys). ([Neon docs](https://neon.com/docs/manage/api-keys)) The key in use is an **organization** key (ledger, Task 1); that scope is accepted as-is (Rob, 2026-11-05, public-repo audit #43: no rotation or re-scoping of existing keys). |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Protection Bypass for Automation secret from the Vercel project's Deployment Protection settings. Sent as the `x-vercel-protection-bypass` header so scripted checks can reach preview deployments. `.env` only; never in Vercel env. ([Vercel docs](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)) |

## Phase 1: application keys

| Key | Purpose |
|---|---|
| `MEMORIAL_NAME` | Display name of the one Phase 1 memorial; the seed creates the `Memorial` and its `Person` row from it (`update: {}`, so later edits in Prisma Studio survive). Production + Preview + local `.env`. |
| `MEMORIAL_SLUG` | URL-safe identifier of that memorial; the seed's upsert key. Production + Preview + local `.env`. |
| `CONSENT_VERSION` | Version label of the consent sentences in force (`2026-11-v2` since the draft-memory feature; stamped when a drafted memory is shared); stored on every memory. The text lives in `docs/consent/<CONSENT_VERSION>.md`. Production + Preview + local `.env`. |
| `UPLOAD_TICKET_SECRET` | HMAC key (32+ random bytes) for upload tickets minted by `issueUploadTicket()` and `createUploadTicket()` and verified by `/api/upload` and `finalizeUpload()`. Different random values in Production, Preview and local `.env`. Generate with `openssl rand -base64 48`. |
| `DAILY_MEMORY_BUDGET` | Maximum memories created per rolling 24 h (default 200); beyond it the form answers "try again later". Production + Preview. Cost ceiling; launch value set in Task 10. |
| `CRON_SECRET` | Bearer secret Vercel Cron sends to `/api/cron/reconcile-uploads`; the route fails closed when it is unset. Production + Preview (and local `.env` for manual runs). Generate with `openssl rand -hex 32`. |
| `DAILY_BYTE_BUDGET` | Maximum ticketed upload bytes per rolling 24 h (default 21474836480 = 20 GB), counted from `Media.maxBytes` over READY rows and open reservations (a PENDING row whose `reservedUntil` is ahead; issue #44). Production + Preview. |
| `MEDIA_FILE_DAILY_MULTIPLE` | Egress allowance (issue #45): distinct viewers (client addresses) per UTC day a file whose memory is APPROVED may be served to, each charged once at the file's size (default 100). A viewer's later requests that day (seeks, reloads, range requests) are free. Optional; counted in `EgressCounter`. |
| `MEDIA_FILE_DAILY_MULTIPLE_UNAPPROVED` | Same, before a family admin approves the memory (default 50). Optional. |
| `MEDIA_DAILY_EGRESS_BYTES` | Bytes the whole site may serve to claim-link holders per UTC day, charged once per viewer, copy and file (default 53687091200 = 50 GiB). Over it, `/api/media` answers 429 with `Retry-After`; the admin page is counted but never refused. Optional. |
| `MEDIA_VIEWER_DAILY_REQUESTS` | Requests one viewer may make for one copy of one file per UTC day (default 300); what stops one address looping on a file. Optional. |
| `MEDIA_PROXY_DOWNLOAD_MAX_BYTES` | Downloads up to this size stream through the function with the sanitized attachment filename (default 26214400 = 25 MiB, as on main; billed on both legs but bounded by the allowance); larger ones redirect to a 60-second presigned Blob URL with the host's `download=1` switch. Optional. |
| `MAX_DECLARED_BYTES_PER_SUBMISSION` | Most bytes one `/share` send may declare across all its files (default 4294967296 = 4 GiB); over it the form answers "more than we can take in one go" and nothing is written. A reservation costs its sender nothing until bytes arrive, so this bounds what one request can hold of the day (issue #44, T10). Optional; Production + Preview. |
| `TOTAL_BYTE_CEILING` | Stock limit (default 53687091200 = 50 GiB): READY originals (`sizeBytes`) + READY derived copies + open reservations may not pass it; beyond it every new reservation is refused with `budget_exceeded` until files are removed or purged. The daily budget is the rate limit, this is the total (issue #44, Oscar #16). Optional; Production + Preview. |
| `TEST_DATABASE_URL` | Tests only, never the app: a throwaway Postgres at the latest migration for `__tests__/integration/*` (the budget concurrency proof). CI provides a service container; locally the suite skips it when unset. |

## Phase 1: storage and email keys (Task 5)

| Key | Purpose |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Read-write token for the private Vercel Blob store `jowray-media`; set by Vercel in all three environments when the store was connected, merged into local `.env` from a temporary env pull. |
| `BLOB_STORE_ID` | The store id (`store_…`), the fourth `_` segment of the token. Needed by the Vercel CLI next to `VERCEL_OIDC_TOKEN`. `.env` only. |
| `SENDGRID_FROM_EMAIL` | The from-address of every site email, on the authenticated domain `jowray.com`. A Cloudflare Email Routing rule for the literal address memories@jowray.com forwards replies to `FAMILY_CONTACT_EMAIL` (`lib/contact.ts`, a constant, not an env key), so no Reply-To is set. Changing this value needs a matching Cloudflare rule first; see [domain.md](domain.md#inbound-email-cloudflare-email-routing-enabled-2026-11-06). Production + Preview + `.env`. |
| `OUTBOUND_ENABLED` | Strict `"true"`/`"false"`. When false, email goes only to `OUTBOUND_ALLOWLIST`. `true` in Production only. |
| `OUTBOUND_ALLOWLIST` | Comma-separated addresses that may receive email even when outbound is disabled (lower-cased, trimmed). Production + Preview. |
| `ADMIN_ALERT_EMAILS` | Comma-separated family-admin addresses that get the "new memory" alert (`ADMIN_NEW_MEMORY`), one message to all of them; trimmed, lower-cased, each validated as an address. Empty or unset turns the alert off (the reconcile cron catches up once it is set). Still subject to `OUTBOUND_ENABLED` / `OUTBOUND_ALLOWLIST`. Production + Preview + local `.env`. |
| `OUTBOUND_HOURLY_CAP` | Global ceiling on contributor email (confirmations and send receipts, all recipients together) per rolling hour; default **60** (sized so a memorial afternoon of 30 relatives sending one to three memories each never holds a receipt; a held receipt is sent by the cron an hour later with rotated links). A send past it is held as a retryable `EmailLog` row the reconcile cron sends once the hour has moved on. Optional; a malformed value (`0`, `abc`) falls back to the default and is reported, never stopping receipts. (Issue #46, D2.) |
| `OUTBOUND_DAILY_CAP` | The same ceiling per rolling 24 h; default **300**. Optional, same fallback. (Issue #46, D2.) |
| `ADMIN_ALERT_HOURLY_CAP` | After this many `ADMIN_NEW_MEMORY` alerts in a rolling hour the admins get one "Memories are arriving quickly" notice and further alerts that hour are skipped (the memories stay on the admin page); default **20**. Optional, same fallback. (Issue #46, D4.) |
| `ADMIN_API_SECRET` | Bearer secret for the admin API (`POST /api/admin/memories`, `POST /api/admin/memories/[id]/claim-link`), used by `scripts/draft-memory.ts` for the `jowray-draft-memory` skill. 32+ characters; the routes answer 401 to everything when it is unset or empty. Production + local `.env` (same value in both). Generate with `openssl rand -hex 32`. **Rotation** (if the laptop or the value is exposed): generate a new value, `vercel env rm ADMIN_API_SECRET production` then `vercel env add … production < file`, redeploy (env reaches only new deployments), replace the line in `.env`, then confirm the old value answers 401 against `https://www.jowray.com/api/admin/memories`. A runbook with the exact commands is follow-up F16 in the draft-memory plan. |
| `ADMIN_PAGE_SECRET` | Shared secret behind the family admin page (`/admin`, [admin.md](admin.md)). The family enters once through `https://www.jowray.com/admin/enter#key=<secret>`; the server sets a 30-day httpOnly cookie derived from the secret (never the secret itself). 32+ characters; unset or empty means every admin check fails closed (signed-out page, never a 500). Separate from `ADMIN_API_SECRET` so each rotates on its own. Production + local `.env` (same value in both); **never Preview** (Preview deploys read a copy of production rows). Generate with `openssl rand -hex 32`. Rotating it signs everyone out; an older production deployment URL keeps the previous value until Standard Protection hides it (admin.md § Rotation). |
| `MCP_API_SECRET` | Bearer secret for the MCP endpoint `/api/mcp` (the jowray Claude connector: eight admin tools for the `jowray-draft-memory` skill; see [MCP connector](#mcp-connector-apimcp) below). 32+ characters; the route answers 401 to everything when it is unset or empty. Separate from `ADMIN_API_SECRET` so each rotates on its own: a connector's header cannot be edited, only removed and re-added. **Production only; never Preview** (Preview deploys read a copy of production rows), and not in local `.env` (a local run passes a throwaway value in the shell). Generate with `openssl rand -hex 32`; set it with `vercel env add MCP_API_SECRET production`, then redeploy (env reaches only new deployments). It is the organisation's credential, not a person's: every request carries the same key, so revisions record `changedVia: ADMIN` with no person. |
| `ADMIN_API_URL` | Where `scripts/draft-memory.ts` posts when **not** run with `--prod`; there is no default, and `--prod` (production, `https://www.jowray.com`) refuses to run while it is set. Plain http is accepted only for localhost. Pass it inline for a local check (`ADMIN_API_URL=http://localhost:3000 npx tsx …`); **do not put it in `.env`**, or every `--prod` run aborts. |
| `NEXT_PUBLIC_SITE_URL` | `https://www.jowray.com` in Production only; previews derive their own host from `VERCEL_BRANCH_URL`, local falls back to `http://localhost:3000`. Production refuses to run without it. |

## MCP connector (`/api/mcp`)

The `jowray-draft-memory` skill saves drafts through a Claude custom connector, so it works from claude.ai, the phone, Desktop and cloud sessions without the laptop checkout. Plan: `docs/plans/2026-11-06-mcp-endpoint.md`.

**Add the connector** (Customize > Connectors > Add custom connector; an Owner does this for the organisation):
- URL: `https://www.jowray.com/api/mcp`. Use `www`: the apex answers 308 to `www`, and a cross-origin redirect drops the `Authorization` header.
- Authentication: **No sign-in**.
- Request headers: name `authorization`, value `Bearer <MCP_API_SECRET>`. Claude sends the value exactly as entered and adds no scheme, so type `Bearer ` yourself.
- Then set **requires approval** on the five tools that change data: `set_coordinates`, `update_memory`, `set_status`, `set_deleted`, `reissue_claim_link`. Repeat this after every re-add.

A wrong or missing header shows as a connection error in Claude, never a sign-in prompt: the route answers a plain 401 with no `WWW-Authenticate` challenge.

**Rotation** (if the value is exposed): generate a new value, `vercel env rm MCP_API_SECRET production` then `vercel env add MCP_API_SECRET production`, redeploy, confirm the old value answers 401 (`curl -si https://www.jowray.com/api/mcp -H 'Authorization: Bearer <old>' -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`), then remove the connector and add it again with the new header (headers cannot be edited in place) and re-apply the five approvals. Removing the key and redeploying turns the endpoint off without a code change.

**Fallback.** The request-headers option is a beta for a limited set of organisations. If Anthropic withdraws it, or the connector is down, the skill falls back to `scripts/draft-memory.ts` on Rob's Mac with `ADMIN_API_SECRET` (above).

## Place suggestions from photo GPS

Place names for the "Where" buttons on `/share` and the MCP `suggest_places` tool come from OpenStreetMap Nominatim, through our own server and the `PlaceLookup` cache (`features/places/lookup-place.ts`; plan `docs/plans/2026-11-06-photo-gps-places.md`, D7–D9). Every key is optional: with none set, lookups are off.

| Key | Purpose |
|---|---|
| `PLACES_PROVIDER` | `nominatim`, `stub` or `off` (default **off**). **Production only** sets `nominatim`: the usage policy's limit is per application, and Preview databases hold their own throttle rows, so a preview calling Nominatim would double the site's rate. Preview and local runs use `stub`, which answers "Photo location found near {lat}, {lon} (test)" without any network, so a device check shows whether a photo's GPS arrived. `off` answers `disabled`. Blank means unset. An unknown value fails the lookup (reported), never the page. |
| `PLACES_LOOKUP_URL` | Base URL of the Nominatim instance (default `https://nominatim.openstreetmap.org`; a trailing slash is dropped, a path is kept). The usage policy asks that the service can be switched without a software update: point this at another instance (or set `PLACES_PROVIDER=off`) and redeploy. http(s) only; blank means unset. |
| `PLACES_DAILY_PROVIDER_CALLS` | Requests actually sent to the provider site-wide per UTC day (default **500**), counted in `EgressCounter` under `places:provider` after the site-wide slot is won and a fresh cache check misses. Over it, lookups answer `daily_limit` until midnight UTC. Optional; a malformed value (`0`, `abc`) falls back to the default and is reported. |
| `PLACES_VIEWER_DAILY_REQUESTS` | Lookups one viewer (client address, hashed in the counter's scope) may ask for per UTC day (default **60**), counted on arrival, before the cache. Over it, `/api/places/suggest` answers 429. The MCP path has no viewer and is not counted here. Optional; same fallback. |

Real sends are at least 1.1 s apart site-wide whatever these values are: a lease and fence on `PlaceLookupThrottle` spaces them, by the database's clock.

## Phase 1: DNS automation

| Key | Purpose |
|---|---|
| `CLOUDFLARE_ZONE_ID` | The `jowray.com` zone (`dad5b9fdb1ece5afc4a4224f61a51770`), used by `scripts/dns-setup.ts` together with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_DNS_ONLY_API_TOKEN`. Not a secret. `.env` only. |

## Placeholders still to fill

| Key | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini for transcription and photo/video analysis (Phase 2; **unused in Phase 1**). The key must come from a Google Cloud project with **active billing**: keys without billing are "Unpaid Services" and Google may use prompts and files to improve its products. Set this **or** `GOOGLE_API_KEY`, not both. If both are set, `GOOGLE_API_KEY` wins. ([Gemini docs](https://ai.google.dev/gemini-api/docs/api-key#set-api-env-var), [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)) |
| `SENTRY_AUTH_TOKEN` | See the Sentry section above. |
| `AUTH_SECRET` | Auth.js v5 secret for magic-link sign-in (phase 3). Generate it with `npx auth secret`. ([Auth.js docs](https://authjs.dev/getting-started/migrating-to-v5#environment-variables)) |

## Image conversion (issue #17, PR A)

No new keys. Two direct dependencies: `sharp` (pinned to the exact version Next ships, so one libvips binary is traced) and `heic-decode`, whose dependency `libheif-js` is libheif + libde265 compiled to WebAssembly and licensed **LGPL-3.0** (server-side use only, nothing redistributed; resolved version is recorded in `package-lock.json`). HEIC decoding runs in a `worker_threads` Worker with a heap cap and a hard deadline (`lib/heic-worker.ts`); the pixel ceiling is `DERIVE_DEFAULTS.maxPixels` (30 MP). Function memory is a Vercel dashboard setting under Fluid compute; raise it there (and the ceiling in code) if a 48 MP photo must convert. The decoder processes untrusted bytes: it runs in its own thread with a heap cap and a hard deadline, dimensions are checked before any pixel is decoded, and the bytes must match the declared type before libvips sees them. Check the libheif / libde265 advisories for the resolved `libheif-js` version whenever it is upgraded.
