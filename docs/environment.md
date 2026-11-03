# Environment variables

This file lists key **names** and what they're for. It never contains values. The secrets themselves live in the gitignored `.env` (mode 600) on Rob's machine and in the Vercel project's environment settings.

## How env works here

- Next.js loads `.env*` files into `process.env`. Load order: `process.env` → `.env.$(NODE_ENV).local` → `.env.local` → `.env.$(NODE_ENV)` → `.env`. The first match wins, so **`.env.local` overrides `.env`**. ([Next.js docs](https://nextjs.org/docs/app/guides/environment-variables#environment-variable-load-order))
- **Every project key lives in `.env`.** The one exception is `VERCEL_OIDC_TOKEN`: `vercel link` writes it to `.env.local`, and it stays only there. ([Vercel changelog](https://vercel.com/changelog/preserve-local-environment-variables-when-linking-with-the-vercel-cli))
- The Neon values come from the Vercel project. To see the current values, run `vercel env pull <tmpfile> --environment=development` and merge in only the keys that are missing. Don't let the tool overwrite `.env`, because other tooling edits that file too. ([Vercel CLI docs](https://vercel.com/docs/cli/env#exporting-development-environment-variables))
- **Never commit `.env*`.** The scaffold `.gitignore` already ignores `.env*` and `.vercel`.
- Only variables prefixed `NEXT_PUBLIC_` reach the browser bundle. Everything else is server-only.

## Pre-existing keys (managed by Rob)

| Key | Purpose |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID for DNS. *(Renamed on 2026-11-02 from the misspelled `CLOUDFLARE_ACCOUNTT_ID`.)* |
| `CLOUDFLARE_DNS_ONLY_API_TOKEN` | Account-owned Cloudflare API token for DNS edits in every zone in the account. Verify it with `/accounts/{id}/tokens/verify`, not `/user/tokens/verify`. It manages the `jowray.com` records; see [domain.md](domain.md). |
| `SENDGRID_API_KEY` | Outbound email (notifications, and later magic links). |
| `DID_JOWRAY` | The memorial phone number (a VoIP.ms DID) that people call or text to leave memories. Sub-account settings are in [voip_ms_262980_jowray-subaccount-settings.md](voip_ms_262980_jowray-subaccount-settings.md). |
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
| `SENTRY_AUTH_TOKEN` | **Placeholder (empty).** Reserved for a future **organization** token (`org:ci`) that uploads source maps from CI or Vercel builds. ([Sentry docs](https://docs.sentry.io/platforms/javascript/guides/nextjs/#add-readable-stack-traces-with-source-maps)) |

## Phase 1: orchestrator and CI keys

These are used by the agent running the Phase 1 plan and by GitHub Actions, never by the app.

| Key | Purpose |
|---|---|
| `NEON_API_KEY` | Neon API key for the Vercel-managed org, used by the `neon` CLI (`--api-key`) when `neonctl auth` is not available and by `.github/workflows/neon-cleanup.yml` as the GitHub secret `NEON_API_KEY`. Create it from the Neon console (Vercel → Storage → `jowray_com` → Open in Neon → Account settings → API keys). ([Neon docs](https://neon.com/docs/manage/api-keys)) |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Protection Bypass for Automation secret from the Vercel project's Deployment Protection settings. Sent as the `x-vercel-protection-bypass` header so scripted checks can reach preview deployments. `.env` only; never in Vercel env. ([Vercel docs](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)) |

## Phase 1: application keys

| Key | Purpose |
|---|---|
| `MEMORIAL_NAME` | Display name of the one Phase 1 memorial; the seed creates the `Memorial` and its `Person` row from it (`update: {}`, so later edits in Prisma Studio survive). Production + Preview + local `.env`. |
| `MEMORIAL_SLUG` | URL-safe identifier of that memorial; the seed's upsert key. Production + Preview + local `.env`. |
| `CONSENT_VERSION` | Version label of the consent sentences in force (e.g. `2026-11-v1`); stored on every memory. The text lives in `docs/consent/<CONSENT_VERSION>.md`. Production + Preview + local `.env`. |

## Placeholders still to fill

| Key | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini for transcription and photo/video analysis (Phase 2; **unused in Phase 1**). The key must come from a Google Cloud project with **active billing**: keys without billing are "Unpaid Services" and Google may use prompts and files to improve its products. Set this **or** `GOOGLE_API_KEY`, not both. If both are set, `GOOGLE_API_KEY` wins. ([Gemini docs](https://ai.google.dev/gemini-api/docs/api-key#set-api-env-var), [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)) |
| `SENTRY_AUTH_TOKEN` | See the Sentry section above. |
| `AUTH_SECRET` | Auth.js v5 secret for magic-link sign-in (phase 3). Generate it with `npx auth secret`. ([Auth.js docs](https://authjs.dev/getting-started/migrating-to-v5#environment-variables)) |
