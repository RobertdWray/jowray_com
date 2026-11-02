# jowray.com Phase 1 Implementation Plan — Database, Core Infrastructure, Memory Collection

> **For the executing agent:** work in `/Users/rob/Documents/active_work/jowray_com/`. Treat this plan as task-by-task instructions. Every change carries a citation tag `[C#]`; the tags resolve in the Citations section at the end. Project rules in `AGENTS.md` apply to every task: every change goes on a branch with a PR, never commit `.env*`, never hide an error `[C4]`.

**Goal:** Build Phase 1 of the Memorial Memories site as designed in `docs/Memorial Memories Site initial thinking.md`: the database, the core infrastructure the bootstrap left open, and memory collection by phone (voicemail), SMS/MMS (with a Gemini-driven follow-up agent), and web upload. Every memory is stored untouched with who left it, an approximate date, and consent, and the contributor gets a claim link by SMS or email `[C1]`.

**Architecture:** The existing Next.js 16.4.4 App Router scaffold (`app/` at the repo root, no `src/`) deployed on Vercel project `rob-wrays-projects/jowray.com`, with Neon project `icy-scene-20351172` (Vercel-managed, preview branching on) and Sentry project `med3ai/jowray_com`, all provisioned by the bootstrap `[C2]`. Code follows the EmpathIQ house layout adapted to the root-level `app/` directory: `features/ → services/ → integrations/`, integrations import `"server-only"`, Pino logging, zod validation `[C5]`. Prisma 7 with `@prisma/adapter-neon` sits on the existing `@neondatabase/serverless` driver `[C22]`. **All AI is Google Gemini through the `@google/genai` SDK** (structured JSON output for the SMS agent; Gemini transcription is reserved for Phase 2). There is no BAML, no Anthropic, no ElevenLabs in Phase 1 `[C49, C51]`. VoIP.ms delivers inbound SMS/MMS to a public route on jowray.com and records calls to a voicemail box; the app reads voicemail and sends replies through the VoIP.ms API, either from Vercel (if egress IP allow-listing is solved) or from a small worker on Rob's Mac whose IP is already enabled `[C41, C37]`.

**Tech Stack:** Next.js 16.4.4 | React 19.3 | TypeScript 5 | Tailwind 4 | Prisma 7 + `@prisma/adapter-neon` (Neon Postgres 18) | `@google/genai` (Gemini 3.8 Flash) | `@sentry/nextjs` 10 | `@sendgrid/mail` | `@vercel/blob` (private store) | Vercel Cron | Cloudflare DNS API | VoIP.ms REST API | Vitest | GitHub Actions

**Branch:** `feat/phase1-memory-collection` (one PR per task group is fine; `main` requires PRs per the project rules `[C4]`).
**PR at end:** Yes.

---

## 0. Read this first: what was verified, what is assumed, what changed

**Repository state (verified 2026-11-02, `main` at `3e9d619`).** Fresh `create-next-app` 16.4.4 scaffold: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `next.config.ts` (`cacheComponents: true`, `partialPrefetching: true`, Tailwind through `@tailwindcss/turbopack`), ESLint 9, `@neondatabase/serverless@1.2.0`, no `src/`, no tests, no Prisma, no Sentry SDK yet `[C2]`. Docs: the design doc, `docs/environment.md`, `docs/plans/2026-11-02-bootstrap.md` (frozen snapshot), `docs/plans/2026-11-02-bootstrap-report.md` (authoritative), `docs/voip_ms_262980_jowray-subaccount-settings.md`.

**What PR #1 (merged) already did, which this plan builds on rather than repeats `[C2]`:**
- Vercel project `jowray.com` connected to GitHub, production branch `main`, production URL https://jowraycom.vercel.app (200), Node 26.x, region `iad1`.
- Neon project `icy-scene-20351172`, database `neondb`, **empty** (0 tables), Neon Auth and Realtime off, preview branching **verified** (`preview/<git-branch>` branches), 16 database env vars in Production/Preview/Development.
- Sentry project `med3ai/jowray_com` created; the DSN is in `.env` as `NEXT_PUBLIC_SENTRY_DSN`; the SDK is **not** installed yet.
- `.env` has 37 keys (mode 600): VoIP.ms, Cloudflare, SendGrid, `DID_JOWRAY`, the Neon set, and empty placeholders `GEMINI_API_KEY`, `SENTRY_AUTH_TOKEN`, `AUTH_SECRET` `[C3]`.
- `CLOUDFLARE_ACCOUNTT_ID` renamed to `CLOUDFLARE_ACCOUNT_ID`; the design doc switched from Twilio to VoIP.ms; the VoIP.ms sub-account doc was committed.

**PR #1 follow-ups this plan absorbs** (numbers are the report's "Remaining tasks") `[C2]`: #1 Neon `dev` branch for local work (Task 1); #2 Sentry SDK + org token (Task 4); #3 protect `main` (Task 1); #4 CI workflow (Task 1); #10 Neon preview-branch cleanup action (Task 1); #12 VoIP.ms IP allow-list vs Vercel egress (decision **D1**, Task 0); #14 `.env.local` mode after `vercel env pull` (Task 1). Not in scope: #7, #8, #13, #15 (upstream notes and the minimatch advisory).

**What changed from the previous draft of this plan:** BAML is gone. Gemini is the only AI vendor, called through the official `@google/genai` SDK with JSON-Schema structured output `[C49, C51]`. The plan now targets the real repo layout (`app/` at root) and the real resources above instead of creating new ones. Auth.js and admin pages are **deferred to Phase 3** as the design doc specifies; until then claim links give contributors edit access and Rob reviews rows in Prisma Studio or the Neon console `[C1]`.

**Verified live on 2026-11-02:** every external page quoted in Citations (Next.js, Neon, Prisma, Sentry, Vercel, Cloudflare, SendGrid, Gemini, `@google/genai`, `actions/setup-node`). Note that `ai.google.dev/gemini-api/docs/...` now redirects to `aistudio.google.com/docs/...`; both URLs are given.

**Could not be verified:**
- `https://empathiq.dev/82c8632048c0074f8614c3c8/docs/` returns 404. The EmpathIQ **source repository** is used as the house-convention source `[C5–C12]`.
- The public VoIP.ms API page renders a cookie wall to unauthenticated fetches. VoIP.ms quotes come from the repo copy in `AvaTinCan/docs/voip.ms.documentation.md` (with line numbers) and from Rob's `ha-voipms_sms` integration. **The executor must reconcile each VoIP.ms citation against `/Users/rob/Documents/active_work/Ava/AvaTinCan/docs/2026-10-30-voipms-api-documentation.md`** `[C13, C14, C39–C48]`.
- The Gemini 3.8 Flash model card page rendered empty; its model code and description are quoted from the models index instead `[C53]`.

**Assumptions (say so if any is wrong):**
1. One memorial in Phase 1. Its name and slug come from `MEMORIAL_NAME` / `MEMORIAL_SLUG` and are seeded, not hard-coded `[C1]`.
2. Vercel team `rob-wrays-projects` is on **Pro** (the bootstrap says so), so per-minute crons are allowed `[C2, C29]`.
3. Cloudflare holds the `jowray.com` zone; `CLOUDFLARE_DNS_ONLY_API_TOKEN` can edit its DNS records `[C3, C33]`.
4. The memory line is `DID_JOWRAY` = 2349569729 on sub-account `262980_jowray` `[C3]`.
5. VoIP.ms voicemail transcription stays **off**; Phase 2 transcribes with Gemini 3.5 Transcribe `[C54]`.
6. Consent on the phone and SMS paths is notice-based (the greeting and the first auto-reply state how memories are used); the web form has an explicit checkbox. `CONSENT_VERSION` is stored on every memory `[C1]`.

---

## 1. Scope

**In (Phase 1):** PR #1 follow-ups (dev branch, CI, branch protection, preview cleanup); Prisma 7 schema for the design doc's Phase 1 tables plus operational tables; Sentry SDK + Pino; Vercel Blob private storage service; SendGrid email service with `EmailLog`; Cloudflare DNS for `jowray.com` (Vercel + SendGrid records); VoIP.ms memory line setup (SMS callback, voicemail box, DID routing); SMS/MMS ingestion with the Gemini follow-up agent; voicemail ingestion; web upload form; claim links; SMS + email confirmations; verification checklist.

**Out:** Auth.js login and admin pages (Phase 3 `[C1]`); transcription, image description, tags, embeddings, search (Phase 2 `[C1]`); a live AI voice agent on calls; video transcoding; any change to AvaTinCan or the kid-phone routing.

---

## 2. Architecture and data flows

```
 Contributor phone / browser      VoIP.ms                      Vercel: jowray.com (Next.js 16)
 ┌──────────────┐  SMS/MMS      ┌──────────────────┐  GET url_callback  ┌─────────────────────────────────────────────────┐
 │ Family/friend│─────────────▶ │ DID_JOWRAY       │───────────────────▶│ app/api/voipms/sms/[token]/route.ts             │
 │              │  call         │  ├ SMS settings  │                    │   → WebhookEvent → SmsConversation/SmsMessage   │
 │              │               │  └ vm:<mailbox>  │◀── poll ───────────│   → Memory + Media → Gemini parse → reply queued │
 │              │  web upload   └──────────────────┘                    │ app/api/cron/voicemail-poll  (Path A)           │
 │              │────────────────────────────────────────────────────▶ │ app/api/cron/sms-outbox      (Path A)           │
 └──────────────┘                        ▲                             │ app/api/internal/**          (Path B)           │
                                         │ getVoicemail*, sendSMS      │ app/share (upload form) · app/m/[claimToken]    │
                                ┌────────┴────────┐                    │ app/api/upload (Blob client-upload handler)     │
                                │ voipms-worker   │── Bearer INTERNAL ─┘        │            │             │
                                │ (Mac, enabled IP│   _API_SECRET (Path B)   Neon (Prisma)  Vercel Blob   Gemini / Sentry / SendGrid
                                └─────────────────┘
```

**Decision D1 — how the app reaches the VoIP.ms API (PR #1 remaining task #12).** VoIP.ms enables API access per caller IP ("By default no IP Address is able to consume services from VoIP.ms API") `[C41]`, and Vercel Functions have no fixed egress IP by default `[C37]`. Only two things need egress: sending SMS replies and fetching voicemail. Inbound SMS callbacks need none. Resolve in Task 0, in this order:
- **(a) Bearer token without IP enablement.** `.env` already holds `voipms_Bearer_Token` `[C3]`. If the 2026-10-30 VoIP.ms document shows bearer authentication that is not IP-restricted, use **Path A** (Vercel crons) with the bearer token.
- **(b) Path B: Mac worker.** Otherwise run the VoIP.ms calls from `scripts/voipms-worker.ts` on the Mac, whose public IP is `voipms_whitelisted_ip` `[C3, C41]`; it pushes voicemails into the app and drains the SMS outbox through internal, secret-protected routes. No extra cost; replies are delayed by up to the worker interval (60 s).
- **(c) Path A with Vercel Static IPs.** Vercel's Static IPs give "a static pair per active region" for "$100/month per project" on Pro, and the pair can be added to the VoIP.ms enabled-IP list `[C37, C41]`. Choose this only if (b) proves unreliable.
Both paths share `integrations/voipms/`; only the trigger differs.

**Text memory flow `[C1, C14, C39]`.** VoIP.ms requests `GET https://jowray.com/api/voipms/sms/<token>?id={ID}&to={TO}&from={FROM}&message={MESSAGE}&media={MEDIA}` → the handler validates the token, writes `WebhookEvent`, finds or creates `SmsConversation` by phone, inserts `SmsMessage(INBOUND)`, creates `Memory(status PENDING, source SMS)` + `Media` for each photo, responds with the body `ok`, and in `after()` asks Gemini what is known and what is missing, queues at most two questions (or the claim-link "Saved" message) as `SmsMessage(OUTBOUND, QUEUED)`.

**Voice memory flow `[C1, C44, C45]`.** Caller reaches `vm:<mailbox>` → the poller lists `getVoicemailMessages`, pulls audio with `getVoicemailMessageFile`, uploads the MP3 to Vercel Blob, inserts `Call` + `Memory(type VOICE, source PHONE_CALL)` + `Media`, marks the message listened, then queues the confirmation SMS with the claim link and opens an `SmsConversation` so the agent can ask the caller's name and the memory's date.

**Web upload flow `[C1, C31]`.** The `/share` form validates who/when/consent in a Server Function, creates `Contributor` + `Memory(status PENDING, source WEB_UPLOAD)`, and returns a signed upload ticket; the browser uploads the file straight to the private Blob store; Vercel calls `onUploadCompleted`, which inserts `Media` (storage key, checksum, mime, size) and sends the email/SMS confirmation with the claim link.

---

## 3. Repository layout (files this plan creates or edits)

The scaffold has no `src/`, and `@/*` maps to the repo root, so the house folders sit beside `app/` `[C2, C5]`.

```
jowray_com/
├── .env.local                         # gitignored; dev Neon branch + local-only values  [C16, C3]
├── .github/workflows/ci.yml           # lint, typecheck, test, build  [C26, C2]
├── .github/workflows/neon-cleanup.yml # delete preview/<branch> on PR close  [C25, C2]
├── vercel.json                        # buildCommand (migrate + build), crons (Path A)  [C38, C27, C10]
├── next.config.ts                     # withSentryConfig, serverExternalPackages  [C21, C11]
├── instrumentation.ts                 # Sentry.init in register(); onRequestError  [C7, C17, C21]
├── instrumentation-client.ts, sentry.edge.config.ts, app/global-error.tsx  [C20]
├── prisma.config.ts                   # DATABASE_URL_UNPOOLED for the CLI  [C23, C22]
├── prisma/schema.prisma, prisma/migrations/, prisma/seed.ts   [C22, C23, C1]
├── vitest.config.ts, __tests__/       # route-handler tests  [C5]
├── scripts/voipms-worker.ts           # Path B worker  [C13, C41]
├── scripts/setup-memory-line.ts       # VoIP.ms one-time setup  [C39, C43, C45]
├── scripts/dns-setup.ts               # Cloudflare DNS records  [C33, C32, C36]
├── app/
│   ├── share/page.tsx, share/actions.ts            # web upload form  [C31, C56]
│   ├── m/[claimToken]/page.tsx, actions.ts         # claim link edit page  [C1, C56]
│   ├── api/upload/route.ts                         # Blob client-upload handler  [C31]
│   ├── api/voipms/sms/[token]/route.ts             # SMS/MMS callback  [C39, C14, C19, C18]
│   ├── api/cron/voicemail-poll/route.ts  (Path A)  [C27, C28, C10]
│   ├── api/cron/sms-outbox/route.ts      (Path A)  [C27, C28, C10]
│   ├── api/internal/ingest/voicemail/route.ts (B)  [C19, C28]
│   └── api/internal/outbox/sms/route.ts       (B)  [C19, C28]
├── server/db/client.ts                # PrismaNeon singleton  [C6, C22]
├── server/config/env.ts               # zod-validated env  [C5, C3]
├── lib/logger/, lib/sentry/after-flush.ts, lib/validations/, lib/phone.ts, lib/claim-token.ts  [C5, C21]
├── services/{storage,email,sms,memory-agent}/   # interfaces + factories  [C5]
├── integrations/vercel-blob/, integrations/sendgrid/, integrations/voipms/, integrations/gemini/  [C9, C8, C13, C49]
└── features/memories/{ingest-sms.ts,sms-agent.ts,ingest-voicemail.ts,ingest-upload.ts,confirm.ts,claim.ts}  [C5, C1]
```

---

## 4. Tasks

### Task 0 — Inventory, decisions, inputs (no code)

**Files:** `docs/plans/2026-11-02-phase1-findings.md` (findings and decisions, committed with the first PR).

1. Confirm the repo state matches §0 (`git log --oneline -5`, `cat package.json`, `ls app docs`). If anything beyond PR #1 has landed, record it and adapt `[C2]`.
2. Open `/Users/rob/Documents/active_work/Ava/AvaTinCan/docs/2026-10-30-voipms-api-documentation.md` and answer: (a) does bearer-token auth exist without IP enablement (**D1**) `[C41]`; (b) which URL-callback variables exist beyond `{FROM}`, `{TO}`, `{MESSAGE}` — the design doc expects `{ID}`, `{TIMESTAMP}`, `{MEDIA}` `[C1, C39]`; (c) confirm the signatures of `getVoicemailMessages`, `getVoicemailMessageFile`, `markListenedVoicemailMessage`, `sendSMS`, `sendMMS`, `getMMS`, `createVoicemail`, `setDIDRouting`, `getDIDsInfo`, `setSMS` `[C39–C48]`.
3. Confirm the Vercel plan is Pro (per-minute crons) `[C29]` and that the Cloudflare token can list the `jowray.com` zone `[C33]`.
4. Get from Rob: `MEMORIAL_NAME`/`MEMORIAL_SLUG`, the SendGrid `from` address, Rob's own mobile number for alerts and tests, a Gemini API key for `GEMINI_API_KEY` (AI Studio) `[C50]`, and a decision on D1 if (a) is unavailable.
5. Record decisions in the findings file. Never print `.env` values; show keys with `sed -E 's/=.*/=<hidden>/' .env` `[C4]`.

### Task 1 — Core infrastructure left open by PR #1

**Files:** `.github/workflows/ci.yml`, `.github/workflows/neon-cleanup.yml`, `package.json` (scripts), `.env.local`, `docs/environment.md`.

1. **Neon `dev` branch (PR #1 task #1).** `neon branches create --project-id icy-scene-20351172 --name dev --no-secrets`, then `neon connection-string dev --project-id icy-scene-20351172 --pooled` and the unpooled variant; put them in `.env.local` as `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. `.env.local` overrides `.env`, so local work never touches the production branch `[C24, C16, C3]`. Keep `.env.local` at mode 600 and re-check it after any `vercel env pull` (PR #1 task #14) `[C2]`.
2. **CI (PR #1 task #4).** `.github/workflows/ci.yml` on `pull_request` and `push` to `main`: `actions/checkout@v4`, `actions/setup-node@v7` with `node-version: 26` and `cache: npm`, then `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm run test:run`, `npm run build` `[C26, C2]`. `build` must not need a database (see Task 3 step 7).
3. **Preview-branch cleanup (PR #1 task #10).** `.github/workflows/neon-cleanup.yml` on `pull_request: types: [closed]` using `neondatabase/delete-branch-action@v3` with `project_id: ${{ vars.NEON_PROJECT_ID }}`, `branch: preview/${{ github.head_ref }}`, `api_key: ${{ secrets.NEON_API_KEY }}`; add the repository variable and secret in GitHub. Then delete the stale `preview/docs/bootstrap-report` branch once by hand (`neon branches delete`) `[C25, C2]`.
4. **Protect `main` (PR #1 task #3).** Add a GitHub ruleset on `main` requiring a pull request and the `ci` status check `[C2, C4]`.
5. Add the scripts the later tasks use: `type-check`, `test`, `test:run`, `db:migrate`, `db:migrate:prod`, `db:seed`, `db:studio`, `validate`.
6. Update `docs/environment.md` for every new key named in §7, in the same PR that introduces it (project rule) `[C3, C4]`.

### Task 2 — Conventions, config, logging

**Files:** `AGENTS.md` (append a "Code layout" section), `eslint.config.mjs`, `server/config/env.ts`, `lib/logger/*`, `lib/sentry/after-flush.ts`, `next.config.ts`.

1. Append the layering rules to `AGENTS.md`: `features/ → services/ → integrations/`; `integrations/*` and `server/*` start with `import "server-only"`; no `console.log` on the server (Pino); pages that read user data export `dynamic = "force-dynamic"`; route handlers validate input with zod from `lib/validations` and answer `{ success, data }` / `{ error: { code, message } }` `[C5]`. Enforce the import direction with `no-restricted-imports` groups in `eslint.config.mjs`.
2. `server/config/env.ts`: a zod schema over the **existing** key names from `docs/environment.md` (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `DID_JOWRAY`, `voipms_username`, `voipms_password`, `voipms_Bearer_Token`, `voipms_whitelisted_ip`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DNS_ONLY_API_TOKEN`, `SENDGRID_API_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `GEMINI_API_KEY`) plus the new ones in §7, parsed once and exported `[C3, C5]`.
3. Port EmpathIQ's `lib/logger` (Pino, `createLogger`, `logError`, categories `api | voice | sms | session | email | db | ai`) and `lib/sentry/after-flush.ts` (`afterWithFlush`) `[C5, C21]`.
4. `next.config.ts`: keep `cacheComponents`, `partialPrefetching`, and the Tailwind Turbopack rule; add `serverExternalPackages: ["pino", "pino-pretty"]`; export `withSentryConfig(nextConfig, { org: "med3ai", project: "jowray_com", tunnelRoute: "/monitoring" })` after Task 4 `[C11, C21, C2]`.

### Task 3 — Database: Prisma 7 on the existing Neon project

**Files:** `prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations/*`, `prisma/seed.ts`, `server/db/client.ts`, `package.json`, `vercel.json`.

1. Install pinned Prisma 7 (the `latest` tag is a Prisma 8 prerelease): `npm i @prisma/client@7 @prisma/adapter-neon@7 && npm i -D prisma@7 tsx`. `@neondatabase/serverless` is already installed `[C22, C2]`.
2. `prisma.config.ts`: load `.env.local` then `.env` (dotenv), `schema: "prisma/schema.prisma"`, `migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" }`, `datasource: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL }` — the CLI needs the direct string; `directUrl` no longer exists `[C23, C22, C16]`.
3. `server/db/client.ts`: `"server-only"`; `new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) })` behind a `globalThis` singleton, as in EmpathIQ `[C6, C22]`. No `url` in the schema `datasource` block `[C22]`.
4. `prisma/schema.prisma` — the design doc's Phase 1 tables, plus `WebhookEvent`, `EmailLog`, `SyncState` for operations `[C1, C8, C28]`:

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql" }   // URL comes from prisma.config.ts / adapter [C22]

enum Visibility        { PUBLIC FAMILY PRIVATE }
enum UserRole          { FAMILY_ADMIN CONTRIBUTOR }
enum MemoryType        { VOICE VIDEO PHOTO TEXT }
enum MemorySource      { PHONE_CALL SMS WEB_UPLOAD }
enum MemoryStatus      { PENDING APPROVED HIDDEN }
enum AnalysisStatus    { NOT_STARTED QUEUED DONE FAILED }
enum ChangedVia        { WEB SMS CLAIM_LINK ADMIN }
enum ConversationState { OPEN AWAITING_REPLY CLOSED }
enum SmsDirection      { INBOUND OUTBOUND }
enum SmsStatus         { RECEIVED QUEUED SENT FAILED }
enum EmailType         { MEMORY_CONFIRMATION }
enum EmailStatus       { PENDING SENT FAILED }

model Memorial {
  id                String      @id @default(uuid())
  name              String
  slug              String      @unique
  born              DateTime?   @db.Date
  died              DateTime?   @db.Date
  defaultVisibility Visibility  @default(FAMILY)
  createdAt         DateTime    @default(now())
  contributors      Contributor[]
  memories          Memory[]
  people            Person[]
  calls             Call[]
  conversations     SmsConversation[]
}

model User {                          // Phase 3 fills this in (magic-link login) [C1]
  id        String   @id @default(uuid())
  email     String?  @unique
  phone     String?  @unique
  role      UserRole @default(CONTRIBUTOR)
  createdAt DateTime @default(now())
  contributor Contributor?
  revisions MemoryRevision[]
}

model Contributor {
  id            String    @id @default(uuid())
  memorialId    String
  userId        String?   @unique          // nullable until Phase 3
  name          String?
  phone         String?                    // E.164; also keep the 10-digit NANPA form for VoIP.ms matching [C15]
  phoneNanpa    String?
  email         String?
  relationship  String?
  contactOptIn  Boolean   @default(false)
  optedOutAt    DateTime?                  // STOP
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  memorial      Memorial  @relation(fields: [memorialId], references: [id])
  user          User?     @relation(fields: [userId], references: [id])
  memories      Memory[]
  calls         Call[]
  conversations SmsConversation[]
  @@unique([memorialId, phoneNanpa])
  @@index([memorialId, email])
}

model Memory {
  id               String         @id @default(uuid())
  memorialId       String
  contributorId    String?
  type             MemoryType
  source           MemorySource
  approxDateText   String?        // as given: "Summer 1998"
  approxYear       Int?
  approxMonth      Int?
  place            String?
  contributorNote  String?        // caption, SMS text, or form note
  language         String         @default("en")
  visibility       Visibility     @default(FAMILY)
  consentVersion   String
  consentedAt      DateTime?
  status           MemoryStatus   @default(PENDING)
  analysisStatus   AnalysisStatus @default(NOT_STARTED)
  claimToken       String         @unique     // 32+ random bytes, base64url [C1]
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
  deletedAt        DateTime?
  memorial         Memorial       @relation(fields: [memorialId], references: [id])
  contributor      Contributor?   @relation(fields: [contributorId], references: [id])
  media            Media[]
  revisions        MemoryRevision[]
  call             Call?
  conversation     SmsConversation? @relation("CurrentMemory")
  sourceConversation SmsConversation? @relation("ProducedMemories", fields: [sourceConversationId], references: [id])
  sourceConversationId String?
  @@index([memorialId, status, createdAt])
  @@index([contributorId])
}

model Media {
  id               String    @id @default(uuid())
  memoryId         String
  storageKey       String    @unique          // Blob pathname: originals/<memoryId>/<uuid>-<name>; never overwritten [C1, C9]
  blobUrl          String                     // private URL; served only through the app
  originalFilename String?
  checksumSha256   String
  mimeType         String
  sizeBytes        Int
  durationSeconds  Int?
  width            Int?
  height           Int?
  capturedAt       DateTime?                  // from EXIF when present
  exif             Json?
  createdAt        DateTime  @default(now())
  memory           Memory    @relation(fields: [memoryId], references: [id])
  @@index([checksumSha256])
}

model Person {
  id                     String   @id @default(uuid())
  memorialId             String
  name                   String
  relationshipToDeceased String?
  isTheDeceased          Boolean  @default(false)
  createdAt              DateTime @default(now())
  memorial               Memorial @relation(fields: [memorialId], references: [id])
  @@unique([memorialId, name])
}

model MemoryRevision {
  id              String     @id @default(uuid())
  memoryId        String
  changedByUserId String?
  changedVia      ChangedVia
  before          Json
  after           Json
  createdAt       DateTime   @default(now())
  memory          Memory     @relation(fields: [memoryId], references: [id])
  changedBy       User?      @relation(fields: [changedByUserId], references: [id])
  @@index([memoryId])
}

model Call {
  id              String   @id @default(uuid())
  memorialId      String
  contributorId   String?
  memoryId        String?  @unique
  providerCallId  String   @unique       // "<mailbox>/<folder>/<message_num>/<date>" [C44]
  fromNumber      String
  durationSeconds Int?
  recordingUrl    String?                // same as Media.blobUrl
  rawPayload      Json
  createdAt       DateTime @default(now())
  memorial        Memorial     @relation(fields: [memorialId], references: [id])
  contributor     Contributor? @relation(fields: [contributorId], references: [id])
  memory          Memory?      @relation(fields: [memoryId], references: [id])
}

model SmsConversation {
  id              String            @id @default(uuid())
  memorialId      String
  contributorId   String?
  phoneNanpa      String
  state           ConversationState @default(OPEN)
  currentMemoryId String?           @unique
  questionsAsked  Int               @default(0)   // rounds; the agent stops after 3 [C1]
  lastMessageAt   DateTime?
  createdAt       DateTime          @default(now())
  memorial        Memorial     @relation(fields: [memorialId], references: [id])
  contributor     Contributor? @relation(fields: [contributorId], references: [id])
  currentMemory   Memory?      @relation("CurrentMemory", fields: [currentMemoryId], references: [id])
  memories        Memory[]     @relation("ProducedMemories")
  messages        SmsMessage[]
  @@unique([memorialId, phoneNanpa])
}

model SmsMessage {                          // inbound log and outbound queue in one table [C1, C42]
  id                String       @id @default(uuid())
  conversationId    String
  direction         SmsDirection
  status            SmsStatus    @default(RECEIVED)   // OUTBOUND rows start QUEUED
  providerMessageId String?      @unique              // VoIP.ms id (inbound {ID} or sendSMS "sms"), or sha256 fallback
  body              String
  mediaUrls         Json?
  parsed            Json?                             // Gemini SmsTurnResult [C51]
  error             String?
  sentAt            DateTime?
  createdAt         DateTime     @default(now())
  conversation      SmsConversation @relation(fields: [conversationId], references: [id])
  @@index([direction, status])
}

model WebhookEvent {                        // raw audit; insert first, process after [C28]
  id          String    @id @default(uuid())
  provider    String    // "voipms" | "vercel-blob"
  kind        String    // "sms_callback" | "voicemail_poll" | "worker_ingest" | "upload_completed"
  payload     Json
  receivedAt  DateTime  @default(now())
  processedAt DateTime?
  error       String?
  @@index([receivedAt])
}

model EmailLog {                            // mirrors EmpathIQ [C8]
  id                String      @id @default(uuid())
  recipientEmail    String
  emailType         EmailType
  status            EmailStatus @default(PENDING)
  sendgridMessageId String?     @unique
  errorMessage      String?
  sentAt            DateTime?
  createdAt         DateTime    @default(now())
  @@index([recipientEmail])
}

model SyncState {                           // poller cursors
  key       String   @id
  value     Json
  updatedAt DateTime @updatedAt
}
```

5. `npx prisma migrate dev --name phase1_init` against the `dev` branch, then `npx prisma generate` `[C22, C23]`.
6. `prisma/seed.ts`: upsert the single `Memorial` from `MEMORIAL_NAME`/`MEMORIAL_SLUG` and a `Person` row with `isTheDeceased = true`; nothing else `[C1]`.
7. Scripts: `"build": "prisma generate && next build"` (database-free, so CI can run it), `"postinstall": "prisma generate"`, `"db:migrate": "prisma migrate dev"`, `"db:migrate:prod": "prisma migrate deploy"`. In `vercel.json` set `"buildCommand": "npx prisma migrate deploy && npm run build"` so production and preview deployments migrate their own Neon branch before building `[C38, C22, C2]`.
8. Verify: `npx prisma migrate deploy` is a no-op on a second run; `neon branches list --project-id icy-scene-20351172` still shows `main`, `dev`, and any live `preview/*` `[C24]`.

### Task 4 — Sentry SDK and source maps (PR #1 task #2)

**Files:** `instrumentation.ts`, `instrumentation-client.ts`, `sentry.edge.config.ts`, `app/global-error.tsx`, `next.config.ts`, Vercel env `SENTRY_AUTH_TOKEN`.

1. Run `npx @sentry/wizard@latest -i nextjs` (Node ≥ 20.19 is satisfied by Node 26), choosing org `med3ai`, project `jowray_com`; it adds `@sentry/nextjs`, the three init files, `global-error.tsx`, and wraps `next.config.ts` with `withSentryConfig` `[C20, C21, C2]`.
2. Replace the generated server init with EmpathIQ's pattern: `Sentry.init` **inside** `register()` for `process.env.NEXT_RUNTIME === "nodejs"`, with `requestDataIntegration({ include: { cookies: false } })`, `prismaIntegration()`, `pinoIntegration()`, `enableLogs: true`, a `beforeSend` that drops `authorization`/`cookie` headers, and `export const onRequestError = Sentry.captureRequestError` `[C7, C17, C21]`.
3. Create a Sentry **organization** token (`org:ci`) and store it as `SENTRY_AUTH_TOKEN` in Vercel (Production + Preview) and in `.env` (placeholder exists) so builds upload source maps; it is never committed `[C2, C3, C21]`.
4. Set `tunnelRoute: "/monitoring"` and keep `NEXT_PUBLIC_SENTRY_DSN` as the DSN source `[C21, C3]`.
5. Verify: throw from a temporary route, see the event in `med3ai/jowray_com`, and see a Pino `warn` line in Sentry Logs `[C21]`.

### Task 5 — Storage and email services

**Files:** `services/storage/{index,types}.ts`, `integrations/vercel-blob/index.ts`, `services/email/{index,types}.ts`, `integrations/sendgrid/{client,index}.ts`, `services/email/templates/memory-confirmation.ts`, `app/api/media/[id]/route.ts`.

1. Create a **private** Blob store: `vercel blob create-store jowray-media --access private --yes`, then `vercel env pull .env.local` (re-check mode 600 afterwards, PR #1 task #14) `[C30, C31, C2]`. Port EmpathIQ's `VercelBlobStorageService`: `put(pathname, body, { access: "private", contentType, addRandomSuffix: false, allowOverwrite: false })` (originals are write-once, so overwrite is **off** here), `head()` for size, `get(url, { access: "private" })` streaming `[C9, C30]`. Server-side `put` is used for MMS photos (≤ 1.2 MB each) and voicemail MP3s; both sit under Vercel's 4.5 MB function body limit `[C30, C40]`.
2. `GET /api/media/[id]`: serves a `Media` row's private blob with its content type **only** when the request carries a valid claim token for the owning memory (`?t=<claimToken>`); everything else is 404. Phase 3 adds admin access `[C9, C1]`.
3. Port `SendGridEmailService` (EmailLog `PENDING` before send, 3 retries with linear backoff, non-retryable 400/401/403, `x-message-id` capture) and the `createEmailService()` factory; `npm i @sendgrid/mail`; a 202 means accepted `[C8, C35]`. Template `memory-confirmation` (text + HTML): thanks, what was received, the claim link, how to add more. The `from` address must be on the SendGrid-authenticated domain (Task 6) `[C36, C35]`.

### Task 6 — Cloudflare DNS for jowray.com (Vercel + SendGrid)

**Files:** `scripts/dns-setup.ts`, `.env.local` (`CLOUDFLARE_ZONE_ID`).

1. In Vercel, add `jowray.com` to project `jowray.com` and accept the `www` prompt; note the `A` record for the apex and the `CNAME` for `www` that Vercel asks for `[C32, C2]`.
2. In SendGrid, start Domain Authentication for `jowray.com` with automated security on; it yields one `CNAME` for SPF/DKIM, two `CNAME`s for link branding, and one `TXT` for DMARC `[C36]`.
3. `scripts/dns-setup.ts` (idempotent: list first, create only what is missing) creates the records through the Cloudflare DNS Records API (`POST /zones/{zone_id}/dns_records`) using `CLOUDFLARE_DNS_ONLY_API_TOKEN`: the Vercel `A` and `www` `CNAME` as DNS-only (`proxied: false`) so Vercel issues the certificate; the SendGrid `CNAME`s and `_dmarc` `TXT` as DNS-only; enter only the host label (`em1234`, `s1._domainkey`), never the full name, to avoid the double-domain mistake SendGrid warns about `[C33, C32, C36, C3]`.
4. Click **Verify** in SendGrid and check the Vercel domain status; DNS verification can take up to 48 hours `[C36, C32]`.

### Task 7 — VoIP.ms integration and memory-line setup

**Files:** `integrations/voipms/client.ts`, `integrations/voipms/sms-settings.ts`, `integrations/voipms/voicemail.ts`, `lib/validations/voipms.ts`, `lib/phone.ts`, `scripts/setup-memory-line.ts`.

1. **Client** (`client.ts`): POST `https://voip.ms/api/v1/rest.php` as `multipart/form-data` with `api_username` = `voipms_username`, `api_password` = `voipms_password` (or the bearer header if D1(a)), `method`, params; treat HTTP 200 with `status !== "success"` as an error; typed errors for `invalid_credentials`, `ip_not_enabled`, `sms_wait_message`, `limit_reached`; 0.3 s spacing between calls `[C13, C15, C41, C3]`.
2. **Phone helpers** (`lib/phone.ts`): normalize to E.164 and to the 10-digit NANPA form VoIP.ms uses for `callerid` and `contact`; compare `to` against `DID_JOWRAY` ignoring a leading `1` `[C15, C14]`.
3. **SMS settings** (`sms-settings.ts`): read the DID with `getDIDsInfo`, map its `sms_*` fields to `setSMS` parameter names, replace only `url_callback_enable`, `url_callback`, `url_callback_retry`, write **all** settings back, re-read to verify, and respect the one-change-per-minute cooldown `[C13, C14, C48, C39]`.
4. **Voicemail** (`voicemail.ts`): `getVoicemailMessages(mailbox, folder="INBOX")`, `getVoicemailMessageFile(..., format="mp3")` (base64 `data`), `markListenedVoicemailMessage(..., listened="yes")` `[C44, C47]`.
5. **Setup script** (idempotent, run once from the Mac): `createVoicemail` (`digits` = last 4 of the DID, `name="jowray memory line"`, `transcription=no`, greeting via `setRecording`: who the line is for, "say your name, the memory, and roughly when it happened", and the consent notice) `[C43]`; `setDIDRouting(DID_JOWRAY, "vm:<mailbox>")` `[C45]`; `setSMS(... url_callback_enable=1, url_callback="https://jowray.com/api/voipms/sms/<VOIPMS_CALLBACK_TOKEN>?id={ID}&to={TO}&from={FROM}&message={MESSAGE}&media={MEDIA}", url_callback_retry=1, dialmode=1)` through the read-modify-write helper, dropping any variable Task 0 found unsupported `[C39, C14, C1]`. Record the mailbox id as `VOIPMS_MEMORY_MAILBOX`. Note the 100 SMS/day default and A2P registration `[C46]`.

### Task 8 — SMS/MMS ingestion and the Gemini follow-up agent

**Files:** `app/api/voipms/sms/[token]/route.ts`, `features/memories/ingest-sms.ts`, `features/memories/sms-agent.ts`, `services/memory-agent/{index,types}.ts`, `integrations/gemini/{client,sms-turn}.ts`, `lib/validations/{voipms,sms-agent}.ts`, `__tests__/api/voipms-sms.test.ts`.

**Route (`route.ts`)** — TDD: write the tests first (token mismatch → 404; happy path → `ok` + one `SmsMessage` + one `Memory`; replay with the same id → `ok` and no duplicates; `STOP` → opt-out and no reply) `[C5]`.
1. `export const runtime = "nodejs"`, `export const dynamic = "force-dynamic"`, `export const maxDuration = 60` `[C18]`.
2. `GET`: `const { token } = await params`; 404 unless it equals `VOIPMS_CALLBACK_TOKEN`; read `id`, `to`, `from`, `message`, `media` from `request.nextUrl.searchParams` through a zod schema; 400 if `to`/`from`/`message` are missing; verify `to` is `DID_JOWRAY` `[C19, C14]`.
3. Insert `WebhookEvent` first. `providerMessageId` = `id` when present, else `sha256(to|from|message|minute)` (VoIP.ms re-sends every 30 minutes until it sees `ok`) `[C39, C14, C28]`. Upsert `SmsConversation` by `(memorialId, phoneNanpa)`; insert `SmsMessage(INBOUND)` ignoring the unique-constraint conflict on replay.
4. Respond `new Response("ok", { status: 200, headers: { "content-type": "text/plain" } })` `[C39, C14]`.
5. In `afterWithFlush()`: if `media` is empty but the text suggests a photo, or always for MMS, call `getMMS(did, from=today, contact=from, all_messages=1)` to get the media URLs, fetch each, `put` it under `originals/<memoryId>/…`, compute the SHA-256, and insert `Media` (pictures are not delivered to the callback itself) `[C40, C14, C30]`. Then run the agent turn (below) and queue the reply `[C5, C21]`.
6. `POST` is also exported and parses JSON or form bodies, so a VoIP.ms POST webhook (if the 2026-10-30 doc offers one) is a config change `[C19]`.

**Agent turn (`sms-agent.ts`, `integrations/gemini/sms-turn.ts`)** `[C1, C49, C51, C52]`
7. Install the SDK pinned below the next major: `npm i "@google/genai@<3.0.0"` (Node 20+; version 3 will require Node 22, which Node 26 satisfies anyway). Client: `new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })` in `integrations/gemini/client.ts` with `"server-only"`; model from `GEMINI_MODEL`, default `gemini-3.8-flash` `[C49, C50, C53]`.
8. Define the output with zod in `lib/validations/sms-agent.ts` and derive JSON Schema from it (Zod 4 `z.toJSONSchema`); Gemini supports `string | number | integer | boolean | object | array | null`, `enum`, `required`, `minItems`/`maxItems`, and **ignores** `minLength`/`maxLength`, so lengths are validated in app code after `parse` `[C51]`:

```ts
export const SmsTurnResult = z.object({
  intent: z.enum(["new_memory", "answer", "stop", "help", "unclear"]),
  memory_text: z.string().nullable(),          // cleaned note; null when the text was only an answer
  contributor_name: z.string().nullable(),
  contributor_relationship: z.string().nullable(),
  people_mentioned: z.array(z.string()),
  approx_date_text: z.string().nullable(),
  approx_year: z.number().int().nullable(),
  approx_month: z.number().int().nullable(),
  place: z.string().nullable(),
  photo_description: z.string().nullable(),   // only when a photo was attached
  missing: z.array(z.enum(["contributor_name", "people", "approx_date"])),
  next_questions: z.array(z.string()).max(2), // maxItems is enforced by the API [C51]
});
```

9. Build the request as one `interactions.create` call: a text part with the system framing (the memorial name, **known facts for this phone** from `Contributor`/`SmsConversation`, the open memory's current fields, the rules "ask only for what is missing, at most two questions, never ask for anything already known"), the inbound text, and each MMS photo as an inline base64 image part (`image/jpeg` etc.; the whole request must stay under 20 MB) with `response_format: { type: "text", mime_type: "application/json", schema }`. Parse `output_text` with `SmsTurnResult.parse(JSON.parse(...))`; on a parse error log it, mark the message `parsed = null`, and fall back to the generic question set. The JS SDK may expose these names in camelCase (`responseFormat`, `mimeType`, `outputText`); follow the installed typings `[C49, C51, C52]`.
10. Apply the result in a transaction: update `Contributor` (name, relationship), the current `Memory` (note, approx date, place), upsert `Person` rows for `people_mentioned`, store `parsed` on the `SmsMessage`. Then decide the reply **in code, not in the model**: if `intent = stop` → `optedOutAt`, close the conversation, no reply; if `missing` is empty **or** `questionsAsked >= 3` → mark the memory complete for Phase 1, queue "Saved. Text another anytime, or edit this one: https://jowray.com/m/<claimToken>", set `state = CLOSED`; else queue `next_questions` (≤ 2, joined, ≤ 160 chars), `questionsAsked += 1`, `state = AWAITING_REPLY` `[C1, C42]`.
11. A new inbound text while `state = CLOSED` starts a new `Memory` (same conversation, same contributor; known facts carry over so the agent never asks for the name again) `[C1]`.
12. Tests for the agent use a stubbed `MemoryAgentService` (the `services/memory-agent` interface) so Vitest never calls Gemini `[C5]`.

### Task 9 — Voicemail ingestion (Path A: Vercel cron · Path B: Mac worker)

**Files (A):** `vercel.json` (crons), `app/api/cron/voicemail-poll/route.ts`, `app/api/cron/sms-outbox/route.ts`.
**Files (B):** `scripts/voipms-worker.ts`, `app/api/internal/ingest/voicemail/route.ts`, `app/api/internal/outbox/sms/route.ts`, `~/Library/LaunchAgents/com.jowray.voipms-worker.plist` (not in the repo; documented in `docs/environment.md`).
**Shared:** `features/memories/ingest-voicemail.ts`, `features/memories/confirm.ts`.

Shared logic `ingestVoicemail({ mailbox, folder, message_num, date, callerid, duration, audioBase64 })`: `providerCallId = "<mailbox>/<folder>/<message_num>/<date>"`; skip if a `Call` with that id exists; `put` the MP3 under `originals/<memoryId>/voicemail.mp3` with its SHA-256; insert `Contributor` (by `callerid`), `Call`, `Memory(type VOICE, source PHONE_CALL, consentVersion)`, `Media`; write `SyncState["voicemail:<mailbox>:last_date"]`; queue the confirmation SMS with the claim link and open an `SmsConversation` with `currentMemoryId` set so the agent's next inbound text asks the caller's name and the memory's date `[C44, C30, C1, C28]`.

**Path A.** `vercel.json` crons: `/api/cron/voicemail-poll` and `/api/cron/sms-outbox` on `* * * * *` (Pro) `[C27, C29, C38, C10]`. Each route checks `Authorization: Bearer <CRON_SECRET>` and fails closed when the secret is unset `[C28, C10]`; runs are idempotent on `providerCallId` / `SmsMessage.id` because cron delivery may duplicate or skip and Vercel does not retry `[C28]`. The poll route lists INBOX messages, fetches each file, calls `ingestVoicemail`, then `markListenedVoicemailMessage` `[C44, C47]`. The outbox route sends `SmsMessage(OUTBOUND, QUEUED)` rows with `sendSMS` (or `sendMMS` when `mediaUrls` is set), stores the returned `sms` id as `providerMessageId`, and sets `SENT`/`FAILED` `[C42]`.

**Path B.** `scripts/voipms-worker.ts` (tsx, every 60 s via launchd `StartInterval`, `caffeinate` so sleep does not stop it) does the same VoIP.ms calls from the Mac, then `POST /api/internal/ingest/voicemail` (JSON with base64 audio) and `GET /api/internal/outbox/sms` → `sendSMS` → `POST /api/internal/outbox/sms/{id}/sent`. Internal routes require `Authorization: Bearer <INTERNAL_API_SECRET>` and are the only VoIP.ms-touching code that runs off-Vercel `[C19, C28, C41]`.

### Task 10 — Web upload form

**Files:** `app/share/page.tsx`, `app/share/actions.ts`, `app/api/upload/route.ts`, `features/memories/ingest-upload.ts`, `lib/validations/memory.ts`, `lib/upload-ticket.ts`.

1. `/share` (design doc: "voice, video, photo; record audio in browser") `[C1]`: fields name, relationship, phone **or** email, approximate date (free text), note, visibility (default `FAMILY`), consent checkbox (`CONSENT_VERSION`), and a file input (audio/video/image); optional in-browser audio recording with `MediaRecorder` producing a `webm` blob.
2. The Server Function in `actions.ts` validates with zod, creates `Contributor` + `Memory(source WEB_UPLOAD, type from the file's MIME, status PENDING, consentedAt = now())`, and returns `{ memoryId, ticket }` where `ticket` is an HMAC (`UPLOAD_TICKET_SECRET`) over `memoryId|expiresAt`. It also verifies authorization itself rather than relying on any proxy `[C56, C5]`.
3. The client calls `upload(pathname, file, { access: "private", handleUploadUrl: "/api/upload", clientPayload: JSON.stringify({ memoryId, ticket }) })` from `@vercel/blob/client`, so files larger than 4.5 MB (video) never pass through a function `[C31]`.
4. `app/api/upload/route.ts` uses `handleUpload`; `onBeforeGenerateToken` verifies the HMAC ticket and expiry (this is the authentication step the docs require — "Without authentication, anyone can upload files to your Blob store"), restricts `allowedContentTypes` to audio/video/image types, sets `maximumSizeInBytes`, and pins `pathname` to `originals/<memoryId>/…`; `onUploadCompleted` inserts `WebhookEvent` and `Media` (size, mime, blob URL, storage key) and schedules `confirm.ts` `[C31, C30]`. The SHA-256 of a client-uploaded file is computed afterwards in `afterWithFlush()` by streaming the private blob `[C9, C21]`.
5. Local testing: `onUploadCompleted` cannot reach localhost; run `cloudflared tunnel --url http://localhost:3000` (Quick Tunnel) and set `VERCEL_BLOB_CALLBACK_URL` in `.env.local` for the session; never store a quick-tunnel URL anywhere persistent `[C31, C34]`.
6. After the upload the page shows "Saved" and the claim link; `confirm.ts` sends the email (if given) and/or SMS (if given) `[C1]`.

### Task 11 — Claim links and confirmations

**Files:** `features/memories/confirm.ts`, `features/memories/claim.ts`, `lib/claim-token.ts`, `app/m/[claimToken]/page.tsx`, `app/m/[claimToken]/actions.ts`, `services/sms/{index,types}.ts`.

1. `claimToken`: 32 random bytes, base64url, generated at `Memory` creation; the link is `https://jowray.com/m/<claimToken>` `[C1]`.
2. `confirm.ts` is idempotent per memory and channel: SMS → one `SmsMessage(OUTBOUND, QUEUED)` ≤ 160 chars ("Thanks {name}. Your memory of {MEMORIAL_NAME} is saved. Edit or add: {link}. Reply STOP to opt out.") `[C42]`; email → `createEmailService().send(...)` with the `memory-confirmation` template when `contributor.email` is set `[C8, C35]`. It skips contributors with `optedOutAt`.
3. `/m/[claimToken]`: `dynamic = "force-dynamic"`; looks up the memory by token (404 otherwise); shows what was received (text, photo via `/api/media/[id]?t=…`, audio player) and a form to edit name, relationship, approximate date, place, note, visibility; the Server Function re-validates the token, writes the change, and appends a `MemoryRevision(changedVia CLAIM_LINK, before, after)` `[C1, C56, C5]`.
4. Inbound `STOP` anywhere in the SMS path → `Contributor.optedOutAt = now()`, conversation `CLOSED`, no further SMS to that number `[C1]`.

### Task 12 — Verification and acceptance

- [ ] `npm run validate` (type-check + lint) and `npm run build` pass locally and in CI `[C26]`.
- [ ] `npx prisma migrate deploy` is a no-op on a second run; Neon `dev` and `main` show the 13 tables `[C22, C24]`.
- [ ] A preview deployment for the PR gets its own `preview/<branch>` Neon branch with the migrations applied; closing the PR deletes that branch within a minute `[C25, C2]`.
- [ ] Sentry shows the test error and a Pino log line from the poller `[C20, C21]`.
- [ ] `curl "https://jowray.com/api/voipms/sms/<token>?to=2349569729&from=2025550123&message=test&id=1"` returns `ok`; one `SmsMessage` and one `Memory(source SMS)`; a replay creates no duplicate `[C39, C14]`.
- [ ] From Rob's phone: text a photo and "Grandpa at the lake, early 80s" to 234-956-9729 → a `Media` row with a checksum, a `Memory` with `approxDateText = "early 80s"`, `place = "lake"`, and one reply asking at most two questions; reply with a name → the contributor is named and the next reply contains the claim link `[C1, C51, C40]`.
- [ ] A 10-second call to 234-956-9729 produces, within 2 minutes, a `Call`, a `Memory(type VOICE)` with a Blob URL, and an SMS confirmation with a working claim link `[C44, C42]`.
- [ ] `/share` accepts a 20 MB video through the client upload; `Media.sizeBytes` matches; the email confirmation arrives with the claim link; the claim page edit creates a `MemoryRevision` `[C31, C35]`.
- [ ] `jowray.com` and `www.jowray.com` resolve to Vercel with a valid certificate; SendGrid domain authentication shows verified `[C32, C36]`.
- [ ] `git ls-files -- '.env*'` is empty; no secret value appears in the diff `[C4]`.

---

## 5. Sequencing

| Order | Task | Depends on | Inputs from Rob |
|---|---|---|---|
| 1 | 0 inventory + D1 | — | 2026-10-30 VoIP.ms doc; Gemini API key; memorial name; SendGrid `from` |
| 2 | 1 infra follow-ups | 0 | `NEON_API_KEY` for the cleanup action |
| 3 | 2 conventions | 1 | — |
| 4 | 3 database | 1, 2 | — |
| 5 | 4 Sentry | 2 | Sentry org token |
| 6 | 5 storage + email | 2, 3 | — |
| 7 | 6 DNS | 5 | Cloudflare zone id |
| 8 | 7 VoIP.ms | 6 (public URL) | run the setup script from the Mac |
| 9 | 8 SMS + agent | 3, 5, 7 | — |
| 10 | 9 voicemail (A or B) | 3, 5, 7 | launchd (B) or Static IPs (A) |
| 11 | 10 web upload | 3, 5 | — |
| 12 | 11 claim + confirm | 5, 8 | — |
| 13 | 12 verification | all | a second phone |

## 6. Database runbook (condensed)

```bash
npm i @prisma/client@7 @prisma/adapter-neon@7 && npm i -D prisma@7 tsx
neon branches create --project-id icy-scene-20351172 --name dev --no-secrets
# .env.local: DATABASE_URL (pooled, dev branch), DATABASE_URL_UNPOOLED (direct, dev branch)
npx prisma migrate dev --name phase1_init   # CLI uses DATABASE_URL_UNPOOLED from prisma.config.ts
npx prisma generate
npx prisma db seed                          # one Memorial + one Person
```
`[C22, C23, C24, C16]`

## 7. Environment variables

Existing keys keep their names from `docs/environment.md`; new keys are added to `.env` (and to Vercel for Production/Preview) and documented in the same PR `[C3, C4]`.

| Variable | Status | Used by | Notes |
|---|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | existing (Vercel–Neon) | Prisma | pooled for the app, direct for the CLI; `.env.local` points both at the `dev` branch `[C22, C3, C24]` |
| `NEXT_PUBLIC_SENTRY_DSN` | existing | Sentry | `[C3, C21]` |
| `SENTRY_AUTH_TOKEN` | placeholder → org token | Sentry builds | source maps `[C2, C21]` |
| `SENDGRID_API_KEY` | existing | email | `[C3, C35]` |
| `SENDGRID_FROM_EMAIL` | **new** | email | on the authenticated domain `[C36]` |
| `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID` | **new** (store creation) | Blob | from `vercel env pull`; the RW token is required for client-upload tokens `[C31]` |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DNS_ONLY_API_TOKEN` | existing | `scripts/dns-setup.ts` | `[C3, C33]` |
| `CLOUDFLARE_ZONE_ID` | **new** | `scripts/dns-setup.ts` | the `jowray.com` zone `[C33]` |
| `DID_JOWRAY` | existing | Tasks 7–11 | 2349569729 `[C3]` |
| `voipms_username`, `voipms_password`, `voipms_Bearer_Token`, `voipms_whitelisted_ip` | existing | VoIP.ms client | which pair is used depends on D1 `[C3, C41]` |
| `VOIPMS_MEMORY_MAILBOX` | **new** | voicemail | from `createVoicemail` `[C43]` |
| `VOIPMS_CALLBACK_TOKEN` | **new** | Task 8 | ≥ 32 random chars in the callback path `[C39]` |
| `CRON_SECRET` | **new** (Path A) | crons | Vercel sends it as `Authorization: Bearer` `[C28]` |
| `INTERNAL_API_SECRET`, `JOWRAY_BASE_URL` | **new** (Path B) | worker | bearer for internal routes |
| `GEMINI_API_KEY` | placeholder → real | Gemini | set this **or** `GOOGLE_API_KEY`, not both `[C3, C50]` |
| `GEMINI_MODEL` | **new** | Gemini | default `gemini-3.8-flash` `[C53]` |
| `UPLOAD_TICKET_SECRET` | **new** | `/api/upload` | HMAC for upload tickets `[C31]` |
| `MEMORIAL_NAME`, `MEMORIAL_SLUG`, `CONSENT_VERSION` | **new** | seed, prompts, templates | e.g. `Jo`, `jo`, `2026-11-02-v1` `[C1]` |
| `AUTH_SECRET` | placeholder | — | unused until Phase 3 `[C3, C1]` |

## 8. Risks and open questions

- **D1 (egress).** Decides Path A vs B; Path B adds a Mac dependency; Static IPs cost $100/month per project and apply to every environment of the project `[C41, C37]`.
- **SMS callback shape.** Variables beyond `{FROM}/{TO}/{MESSAGE}` must be confirmed in the 2026-10-30 doc; the body travels in a URL; 30-minute resends; pictures are not delivered via callback (hence `getMMS`) `[C14, C39, C40]`.
- **`setSMS` writes all fields** and allows one change per minute; never edit the DID's SMS settings in the portal while the setup script runs `[C13, C48]`.
- **Gemini structured output** ignores string-length constraints and can reject over-complex schemas; keep the schema flat and validate in code; model strings change (the 2.5 models are deprecated and auto-route on 2026-12-01), so `GEMINI_MODEL` is an env value `[C51, C53]`.
- **Client-upload callback** cannot reach localhost; preview deployments work because Vercel sets `VERCEL_BRANCH_URL` `[C31]`.
- **PII.** Private Blob, token-gated media route, Sentry `beforeSend` scrubbing, `cookies: false` in request data, no message bodies in logs `[C7, C9, C5]`.
- **Consent.** Phone/SMS consent is notice-based in Phase 1; Rob confirms the wording of the greeting and the first auto-reply before the line goes live `[C1]`.

## 9. Phase 2 preview (not in scope)

Transcribe voicemails and video audio with `gemini-3.5-transcribe` (files up to 1 hour; `smart` mode removes disfluencies) and store the text in `ANALYSIS` `[C54]`; describe photos and video frames with `gemini-3.8-flash` using the same structured-output pattern `[C51, C52]`; audio can also be passed inline (under 20 MB, `audio/mp3`) for one-shot "describe this clip" prompts `[C55]`. Phase 3 adds Auth.js magic-link login and admin review `[C1]`.

---

## Citations

Project sources are this repository and Rob's other repositories (primary documentation maintained by the project). External quotes were taken from the live pages on 2026-11-02. Gemini pages on `ai.google.dev` now redirect to `aistudio.google.com`; the quoted text is from the redirected page.

### [C1] — jowray_com design doc: phases, SMS agent rules, VoIP.ms contract, Phase 3 auth

- **Relevant File(s):** `prisma/schema.prisma`, `features/memories/*`, `app/share/*`, `app/m/[claimToken]/*`, `scripts/setup-memory-line.ts`, §0–§2, §9
- **Change Summary:** Build only what Phase 1 specifies (collect, capture who/when/consent, store originals, send a claim link); mirror the Phase 1 data model; enforce the agent's three rules in code; defer Auth.js and admin to Phase 3.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/main/docs/Memorial%20Memories%20Site%20initial%20thinking.md
- **Verbatim Quote:**
  > "A place for family and friends to leave voice, video, photo and text memories by phone, text message or the web. Phase 1 only collects. Later phases transcribe and analyze what was collected, then show it back as a tag cloud, a timeline and search."
  > "Rules for the agent: at most two questions per reply, stop asking after three rounds and save what it has, and never ask for anything already in the database for that phone number."
  > "- **Retries:** with URL Callback Retry on, VoIP.ms expects the response body `ok`. Otherwise it resends the same message every 30 minutes, so the handler must be idempotent on the message ID."
  > "- **Open question:** the account's API access is set up with an IP whitelist (`voipms_whitelisted_ip`), so API calls from Vercel functions need a stable egress IP or a relay. Resolve this before building the SMS agent."
  > "Phase 1: parse SMS text and photos to drive the agent's questions. Phase 2: image and video description, tag extraction, embeddings."
  > "Phase 3. Magic-link sign-in by email or SMS; link USER to CONTRIBUTOR by the verified email or phone. Until then, claim links give contributors edit access."
- **Justification:** The design doc is the product spec; every scope decision in §1 and the schema in Task 3 follow it.

### [C2] — jowray_com bootstrap completion report (PR #1): resources, state, remaining tasks

- **Relevant File(s):** §0, Task 0, Task 1, Task 4, `vercel.json`, `.github/workflows/*`
- **Change Summary:** Reuse the provisioned Vercel, Neon, and Sentry resources; absorb remaining tasks #1, #2, #3, #4, #10, #12, #14.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/main/docs/plans/2026-11-02-bootstrap-report.md (merged in https://github.com/RobertdWray/jowray_com/pull/1)
- **Verbatim Quote:**
  > "| Vercel project | https://vercel.com/rob-wrays-projects/jowray.com · project ID `prj_UWoR1IGnShoagieZphn2aXOnGSfm` · team `rob-wrays-projects` (`team_KcheaXYZlslwXKrG5iksYEhL`) · framework Next.js · Node 26.x · function region `iad1` |"
  > "| Neon | Project `icy-scene-20351172` (\"jowray_com\") · org `org-dark-band-75525913` (Vercel-managed) · `aws-us-east-1` · Postgres 18.6 · database `neondb` · default branch `main` (`br-restless-king-bbmkh5zd`) · … billing plan Scale (`scale_v3`) |"
  > "| Neon state | **Empty**: 0 user tables. **Neon Auth off**: the API returns \"not enabled\" and there's no `neon_auth` schema. Realtime is off. |"
  > "| Sentry | https://med3ai.sentry.io/projects/jowray_com/ · slug `jowray_com` · id `4512363870158848` · platform `javascript-nextjs` · team `med3ai` · default alert rules on · API host `https://us.sentry.io` |"
  > "**State: verified.** Neon's documented test was run on this PR: push a feature branch, then check the Vercel deployments and the Neon branches."
  > "1. **[Medium]** Local development env vars point at the production (default) Neon branch. Adopt a branch-first dev flow, such as a `dev` Neon branch for local work."
  > "2. **[Medium]** Sentry SDK setup (`@sentry/nextjs` via the wizard), plus an **organization** auth token (`org:ci`) in Vercel for source-map uploads."
  > "3. **[Medium]** Protect `main` by requiring PRs and status checks."
  > "4. **[Medium]** A GitHub Actions CI workflow: lint, typecheck, build."
  > "10. **[Medium]** Clean up Neon preview branches when PRs close: add a GitHub Action using `neondatabase/delete-branch-action` on `pull_request: closed`, as [Neon's cleanup guide](https://neon.com/docs/guides/vercel-branch-cleanup) recommends."
  > "12. **[High]** Decide how VoIP.ms API calls from Vercel functions get past the account's IP whitelist (`voipms_whitelisted_ip`): a stable egress IP or a relay."
  > "14. **[Low]** Re-check that `.env.local` is still mode 600 after any `vercel link` or `vercel env pull`, which write to that file."
- **Justification:** §0 states what already exists so the executor does not recreate it; Task 1 closes the report's open items.

### [C3] — jowray_com `docs/environment.md`: existing key names and load order

- **Relevant File(s):** `server/config/env.ts`, `.env.local`, §7
- **Change Summary:** Read the existing key names unchanged; keep every project key in `.env`; add new keys to the doc in the same PR.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/main/docs/environment.md
- **Verbatim Quote:**
  > "**Every project key lives in `.env`.** The one exception is `VERCEL_OIDC_TOKEN`: `vercel link` writes it to `.env.local`, and it stays only there."
  > "| `DID_JOWRAY` | The memorial phone number (a VoIP.ms DID) that people call or text to leave memories. |"
  > "| `voipms_username`, `voipms_password`, `voipms_Bearer_Token`, `voipms_whitelisted_ip` | VoIP.ms API access: the phone and SMS provider. A separate agent sets these up. |"
  > "| `CLOUDFLARE_DNS_ONLY_API_TOKEN` | Cloudflare API token scoped to DNS edits. |"
  > "| `DATABASE_URL` | **Pooled** connection string (PgBouncer). The app uses this one. | | `DATABASE_URL_UNPOOLED` | Direct connection string, for migrations and session-level features. |"
  > "| `GEMINI_API_KEY` | Google Gemini for photo and video analysis (phase 2). Set this **or** `GOOGLE_API_KEY`, not both. If both are set, `GOOGLE_API_KEY` wins. |"
- **Justification:** Task 2 step 2 and §7 use these names verbatim instead of inventing new ones.

### [C4] — jowray_com `AGENTS.md`: project rules

- **Relevant File(s):** every task (branching, secrets, error handling)
- **Change Summary:** Work on branches with PRs, never commit `.env*`, never hide errors, document keys in `docs/environment.md`.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/main/AGENTS.md
- **Verbatim Quote:**
  > "- After the bootstrap commit, every change goes on a branch with a PR, including critical fixes."
  > "- Never hide an error to keep moving. Fix the root cause with best-practice code."
  > "- Never commit secrets. `.env*` files are gitignored; key names and purposes are in `docs/environment.md`."
- **Justification:** These rules govern how every task is executed and verified (Task 12 last item).

### [C5] — empathiq `CLAUDE.md`: layering, logging, `force-dynamic`, `afterWithFlush`, TDD for webhooks

- **Relevant File(s):** `AGENTS.md` (code layout section), `eslint.config.mjs`, `lib/logger/*`, `lib/sentry/after-flush.ts`, all route handlers, `app/m/[claimToken]/page.tsx`
- **Change Summary:** Adopt the house conventions adapted to a root-level `app/` directory.
- **Source URL:** https://github.com/RobertdWray/empathiq/blob/main/CLAUDE.md (commit `ac902c9`)
- **Verbatim Quote:**
  > "Features -> Services -> Integrations -> External APIs"
  > "Services define interfaces; integrations implement with `"server-only"` guard"
  > "Pages with user data MUST export `dynamic = "force-dynamic"` (Next.js 15+ caches aggressively - symptom: data only updates after redeploy)"
  > "All integration files MUST import `"server-only"` as first line"
  > "`after()` callbacks in API routes: Use `afterWithFlush()` from `@/lib/sentry/after-flush` instead of raw `after()` when the callback calls `logError()` or captures Sentry events — serverless functions terminate before Sentry's async transport flushes"
  > "**TDD Required (Critical Paths)** - RED-GREEN-REFACTOR: - Auth flows (`src/lib/auth/*`, `src/app/api/auth/*`) - Webhook handlers (`src/app/api/elevenlabs/webhook/*`, `src/app/api/webhooks/*`)"
- **Justification:** Tasks 2, 8, 10, 11 copy these conventions so jowray.com matches the codebase Rob already maintains.

### [C6] — empathiq `src/server/db/client.ts`: Prisma 7 client singleton over a driver adapter

- **Relevant File(s):** `server/db/client.ts`
- **Change Summary:** Same lazy `globalThis` singleton, with `PrismaNeon` instead of `PrismaPg`.
- **Source URL:** https://github.com/RobertdWray/empathiq/blob/main/src/server/db/client.ts
- **Verbatim Quote:**
  > "Uses @prisma/adapter-pg for Prisma v7 compatibility. Uses globalThis to prevent multiple instances during hot reloading."
  > "const adapter = new PrismaPg({ connectionString: databaseUrl, }); return new PrismaClient({ adapter, log: logConfig, });"
- **Justification:** Task 3 step 3 ports this file; the adapter changes because jowray_com already uses Neon's serverless driver.

### [C7] — empathiq `instrumentation.ts`: Sentry server init and scrubbing

- **Relevant File(s):** `instrumentation.ts`
- **Change Summary:** Initialize Sentry inside `register()` with Pino and Prisma integrations and credential scrubbing.
- **Source URL:** https://github.com/RobertdWray/empathiq/blob/main/instrumentation.ts
- **Verbatim Quote:**
  > "Initialize Sentry server SDK directly in register() rather than importing from sentry.server.config.ts. The dynamic import pattern fails silently on Vercel Lambda"
  > "Sentry.requestDataIntegration({ include: { cookies: false } }), … Sentry.prismaIntegration(), // Forward Pino logs to Sentry Logs dashboard Sentry.pinoIntegration(),"
  > "export const onRequestError = Sentry.captureRequestError;"
- **Justification:** Task 4 step 2 and the PII note in §8.

### [C8] — empathiq SendGrid integration: EmailLog and retries

- **Relevant File(s):** `integrations/sendgrid/index.ts`, `prisma/schema.prisma` (`EmailLog`)
- **Change Summary:** Reuse the retrying email service with pre-send `EmailLog` rows.
- **Source URL:** https://github.com/RobertdWray/empathiq/blob/main/src/integrations/sendgrid/index.ts
- **Verbatim Quote:**
  > "Implements EmailService interface using SendGrid with retry logic and EmailLog database tracking."
  > "const MAX_RETRIES = 3; /** Base delay in ms for linear backoff (1s, 2s, 3s). */ const BASE_DELAY_MS = 1000;"
  > "const NON_RETRYABLE_CODES = new Set([400, 401, 403]);"
  > "// Create EmailLog record before attempting to send"
- **Justification:** Task 5 step 3 and Task 11 step 2.

### [C9] — empathiq Vercel Blob storage service

- **Relevant File(s):** `integrations/vercel-blob/index.ts`, `app/api/media/[id]/route.ts`, `features/memories/ingest-upload.ts`
- **Change Summary:** Private uploads with deterministic pathnames and streamed private reads; overwrite disabled for originals.
- **Source URL:** https://github.com/RobertdWray/empathiq/blob/main/src/integrations/vercel-blob/index.ts
- **Verbatim Quote:**
  > "const blob = await put(pathname, body, { access: "private", contentType, addRandomSuffix: false, allowOverwrite: true, });"
  > "// PutBlobResult doesn't include size — fetch it via head()"
  > "const result = await get(url, { access: "private" }); if (!result || result.statusCode === 304) return null;"
- **Justification:** Task 5 steps 1–2, Task 9 audio upload, Task 10 checksum, Task 11 playback.

### [C10] — empathiq `vercel.json` crons and `CRON_SECRET` route pattern

- **Relevant File(s):** `vercel.json`, `app/api/cron/*/route.ts`
- **Change Summary:** Define crons in `vercel.json` and fail closed on a missing or wrong `CRON_SECRET`.
- **Source URL:** https://github.com/RobertdWray/empathiq/blob/main/vercel.json and https://github.com/RobertdWray/empathiq/blob/main/src/app/api/cron/stale-sessions/route.ts
- **Verbatim Quote:**
  > "\"crons\": [ { \"path\": \"/api/cron/stale-sessions\", \"schedule\": \"*/30 * * * *\" },"
  > "// 1. Authenticate via CRON_SECRET — fail closed if env var is missing const cronSecret = process.env.CRON_SECRET; if (!cronSecret) {"
  > "if (authHeader !== `Bearer ${cronSecret}`) { return NextResponse.json( { error: { code: "UNAUTHORIZED", message: "Invalid or missing CRON_SECRET" } }, { status: 401 } ); }"
- **Justification:** Task 9 Path A routes copy this structure.

### [C11] — empathiq `next.config.ts`: externalize native packages for Turbopack

- **Relevant File(s):** `next.config.ts`
- **Change Summary:** Add `serverExternalPackages` for Pino (BAML is not used here, so it is omitted).
- **Source URL:** https://github.com/RobertdWray/empathiq/blob/main/next.config.ts
- **Verbatim Quote:**
  > "// Externalize native Node.js packages that can't be bundled by Turbopack serverExternalPackages: ["pino", "pino-pretty", "@boundaryml/baml"],"
- **Justification:** Task 2 step 4.

### [C12] — empathiq `docs/plans/` task format

- **Relevant File(s):** this plan
- **Change Summary:** Use the house plan structure (Goal / Architecture / Tech Stack / Branch / Tasks with Files and Steps).
- **Source URL:** https://github.com/RobertdWray/empathiq/blob/main/docs/plans/2026-02-26-audio-data-retention.md
- **Verbatim Quote:**
  > "**Goal:** … **Architecture:** … **Tech Stack:** Prisma 7 (migration) | Next.js 16 App Router | React 19 | Zod | TailwindCSS 4 | Vitest **Worktree:** Yes — create isolated worktree before starting. **Branch:** `feat/audio-data-retention` **PR at end:** Yes."
  > "## Task 1: Prisma Schema — Add `AudioRetentionPolicy` enum and `User.audioRetentionPolicy` field **Files:** - Modify: `prisma/schema.prisma` (add enum + field)"
- **Justification:** The executing agent already consumes plans in this shape.

### [C13] — ha-voipms_sms `api.py`: VoIP.ms REST client behaviour

- **Relevant File(s):** `integrations/voipms/client.ts`, `integrations/voipms/sms-settings.ts`
- **Change Summary:** POST multipart form data, treat HTTP 200 + non-success status as failure, map `getDIDsInfo` fields to `setSMS` names, honour the per-minute cooldown.
- **Source URL:** https://github.com/RobertdWray/ha-voipms_sms/blob/main/custom_components/voipms_sms/api.py (commit `42ad9ff`)
- **Verbatim Quote:**
  > "# VoIP.ms only reads POST parameters from a multipart/form-data body."
  > "# The API answers HTTP 200 for failures too; only `status` tells."
  > "# getDIDsInfo reports a DID's SMS settings under different names than setSMS # accepts. Maps each field getDIDsInfo returns to the setSMS parameter that # writes it, covering every parameter setSMS documents besides the DID itself."
  > "VoIP.ms accepts one change of a DID's SMS settings per minute and refuses any further one, leaving the settings as they are."
  > "Every setting is included, because the API does not document what happens to parameters that are left out."
- **Justification:** Task 7 steps 1 and 3 port this logic to TypeScript.

### [C14] — ha-voipms_sms `webhook.py` and README: callback contract and caveats

- **Relevant File(s):** `app/api/voipms/sms/[token]/route.ts`, `scripts/setup-memory-line.ts`, `integrations/voipms/sms-settings.ts`
- **Change Summary:** Build the callback URL with `{TO}/{FROM}/{MESSAGE}`, answer exactly `ok`, verify the recipient, expect resends and duplicates, read-modify-write-verify the DID settings.
- **Source URL:** https://github.com/RobertdWray/ha-voipms_sms/blob/main/custom_components/voipms_sms/webhook.py and https://github.com/RobertdWray/ha-voipms_sms/blob/main/README.md#receiving-texts
- **Verbatim Quote:**
  > "CALLBACK_QUERY = "?to={TO}&from={FROM}&message={MESSAGE}""
  > "# VoIP.ms sends a message again every 30 minutes until the response body is # exactly this. ACKNOWLEDGED = "ok""
  > "setSMS takes all SMS settings of a DID at once, so the settings are read, written back with only the callback replaced, and read again to verify, because a request that timed out may still have been applied."
  > "**A text can arrive more than once.** VoIP.ms sends a text again every 30 minutes until Home Assistant acknowledges it."
  > "**Only texts arrive.** Pictures sent to your number are not delivered to Home Assistant."
  > "**Incoming texts travel in a URL.** … A reverse proxy in front of Home Assistant may write that URL, and with it the text, to its access log."
- **Justification:** Task 7 step 5, Task 8 steps 2–5, and the §8 risks.

### [C15] — AvaTinCan handoff doc: VoIP.ms client conventions

- **Relevant File(s):** `integrations/voipms/client.ts`, `lib/phone.ts`, `Contributor.phoneNanpa`
- **Change Summary:** 0.3 s spacing, 10-digit NANPA numbers, tolerant empty-result statuses.
- **Source URL:** https://github.com/RobertdWray/ava_can/blob/main/docs/avatincan-handoff.md
- **Verbatim Quote:**
  > "VoIP.ms API has 0.3s rate limiting between calls"
  > "**Critical**: Phonebook entries must use **10-digit NANPA format** (e.g. `2025551234`, NOT `12025551234`). VoIP.ms receives incoming CallerID in 10-digit format and performs exact matching against phonebook entries."
  > "Empty results return error statuses like `"no_filter"`, `"no_phonebook_group"`, etc."
- **Justification:** Task 7 steps 1–2 and the contributor key in Task 3.

### [C16] — Next.js: environment variable load order

- **Relevant File(s):** `.env.local`, `prisma.config.ts`, `server/config/env.ts`
- **Change Summary:** `.env.local` (dev Neon branch) overrides `.env`; both are gitignored.
- **Source URL:** https://nextjs.org/docs/app/guides/environment-variables#environment-variable-load-order
- **Verbatim Quote:**
  > "Environment variables are looked up in the following places, in order, stopping once the variable is found. 1. `process.env` 2. `.env.$(NODE_ENV).local` 3. `.env.local` (Not checked when `NODE_ENV` is `test`.) 4. `.env.$(NODE_ENV)` 5. `.env`"
  > "The default `create-next-app` template ensures all `.env` files are added to your `.gitignore`."
- **Justification:** Task 1 step 1, Task 3 step 2, §6.

### [C17] — Next.js: `instrumentation.ts` `register()` semantics

- **Relevant File(s):** `instrumentation.ts`
- **Change Summary:** Sentry is initialized once per server start, gated on `NEXT_RUNTIME`.
- **Source URL:** https://nextjs.org/docs/app/guides/instrumentation#convention and https://nextjs.org/docs/app/guides/instrumentation#importing-runtime-specific-code
- **Verbatim Quote:**
  > "Then, export a `register` function in the file. This function will be called **once** when a new Next.js server instance is initiated, and must complete before the server is ready to handle requests."
  > "Next.js calls `register` in all environments, so it's important to conditionally import any code that doesn't support specific runtimes (e.g. Edge or Node.js). You can use the `NEXT_RUNTIME` environment variable to get the current environment:"
- **Justification:** Task 4 step 2.

### [C18] — Next.js: Route Handler segment config

- **Relevant File(s):** `app/api/voipms/sms/[token]/route.ts`, cron and internal routes
- **Change Summary:** Node runtime, dynamic rendering, `maxDuration`.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/route#segment-config-options
- **Verbatim Quote:**
  > "Route Handlers use the same route segment configuration as pages and layouts."
  > "export const dynamic = 'auto' … export const runtime = 'nodejs'"
- **Justification:** Task 8 step 1.

### [C19] — Next.js: Route Handlers for webhooks, query params, async `params`

- **Relevant File(s):** `app/api/voipms/sms/[token]/route.ts`, `app/api/internal/**`
- **Change Summary:** Read query variables and the token segment; accept POST bodies without extra config.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/route#webhooks and https://nextjs.org/docs/app/api-reference/file-conventions/route#url-query-parameters
- **Verbatim Quote:**
  > "You can use a Route Handler to receive webhooks from third-party services:"
  > "The request object passed to the Route Handler is a `NextRequest` instance, which includes some additional convenience methods, such as those for more easily handling query parameters."
  > "`params`: a promise that resolves to an object containing the dynamic route parameters for the current route."
- **Justification:** Task 8 steps 2 and 6; Task 9 internal routes.

### [C20] — Sentry: Next.js wizard, prerequisites, init files

- **Relevant File(s):** `instrumentation-client.ts`, `sentry.edge.config.ts`, `app/global-error.tsx`
- **Change Summary:** Run the wizard, then align the server init with the house pattern.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/#install and https://docs.sentry.io/platforms/javascript/guides/nextjs/#initialize-the-sdk
- **Verbatim Quote:**
  > "npx @sentry/wizard@latest -i nextjs"
  > "You need: A Next.js application on version 14 or higher Node.js 20.19.0 or higher"
  > "`instrumentation-client.ts`: runs in the browser `sentry.server.config.ts`: runs in the Node.js runtime `sentry.edge.config.ts`: runs in the Edge runtime"
- **Justification:** Task 4 steps 1–2.

### [C21] — Sentry: `withSentryConfig`, `onRequestError`, logs

- **Relevant File(s):** `next.config.ts`, `instrumentation.ts`, `lib/logger/*`, `lib/sentry/after-flush.ts`
- **Change Summary:** Wrap the Next config, keep `onRequestError`, forward structured logs, upload source maps with an auth token.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/#apply-instrumentation-to-your-app , https://docs.sentry.io/platforms/javascript/guides/nextjs/#register-the-server-side-configuration , https://docs.sentry.io/platforms/javascript/guides/nextjs/#send-logs
- **Verbatim Quote:**
  > "The wizard wraps your Next.js configuration with `withSentryConfig`. This instruments your app at build time, uploads source maps, and, if you said yes in the wizard, routes browser requests to Sentry through your server to avoid ad blockers."
  > "It loads your server and edge configurations, and exports `onRequestError` to capture errors from Server Components, route handlers, and middleware."
  > "If you're already logging with another library, use an integration to capture those logs as Sentry Logs automatically: … Pino"
- **Justification:** Task 2 steps 3–4, Task 4 steps 1–5, Task 8 error logging.

### [C22] — Neon: Prisma ORM 7 setup (pinned versions, two connection strings, no `url` in schema)

- **Relevant File(s):** `prisma/schema.prisma`, `prisma.config.ts`, `server/db/client.ts`, `package.json`
- **Change Summary:** Pin Prisma 7 with `@prisma/adapter-neon`, use pooled + direct strings, keep the datasource URL out of the schema.
- **Source URL:** https://neon.com/docs/guides/prisma#step-1-install-dependencies and https://neon.com/docs/guides/prisma#why-two-connection-strings
- **Verbatim Quote:**
  > "This guide uses Prisma ORM 7. Install the `prisma` CLI, `@prisma/client`, and `@prisma/adapter-neon` at the same major version (`@7`). The `prisma` package's `latest` npm tag currently points to a Prisma 8 prerelease, so an unpinned `npm install prisma` installs a CLI that doesn't match the rest of this setup."
  > "In Prisma 7+, do not include a `url` property in the datasource block. The connection is configured via `prisma.config.ts` and the adapter."
  > "**Direct (unpooled) connection (`DATABASE_URL_UNPOOLED`)**: Prisma CLI commands like `prisma migrate` and `prisma db push` need a direct connection for schema operations."
- **Justification:** Task 3 steps 1–5, §6, §7.

### [C23] — Prisma 7 config reference: `datasource.url`, `migrations.seed`, `directUrl` removed

- **Relevant File(s):** `prisma.config.ts`, `package.json`
- **Change Summary:** Configure migrations path, seed command, and the CLI datasource URL in `prisma.config.ts`.
- **Source URL:** https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference#datasourceurl and https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference#datasourcedirecturl-removed
- **Verbatim Quote:**
  > "export default defineConfig({ schema: "prisma/schema.prisma", migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts", }, datasource: { url: env("DATABASE_URL"), }, });"
  > "The `datasource.directUrl` property has been removed in Prisma ORM v7 in favor of the `url` property."
  > "Environment variables from `.env` files need to be loaded explicitly. The `prisma init` command generates a config that includes `import 'dotenv/config'` by default."
- **Justification:** Task 3 step 2 and §6.

### [C24] — Neon CLI: `neon branches create` and `list`

- **Relevant File(s):** Task 1 step 1, §6, Task 12
- **Change Summary:** Create the `dev` branch for local work without printing its connection string into terminal scrollback.
- **Source URL:** https://neon.com/docs/cli/branches#create
- **Verbatim Quote:**
  > "Creates a branch in a Neon project. neon branches create [options]"
  > "| `--name` | The branch name | string | branch id | No |"
  > "Omit the connection string from the output, keeping it out of terminal scrollback and CI logs: neon branches create --no-secrets"
  > "| `--project-id` | Project ID | string | — | No |"
- **Justification:** PR #1 remaining task #1 (Task 1 step 1).

### [C25] — Neon: Vercel preview branch cleanup via GitHub Action

- **Relevant File(s):** `.github/workflows/neon-cleanup.yml`
- **Change Summary:** Delete `preview/<branch>` when a PR closes; low-activity projects never auto-clean.
- **Source URL:** https://neon.com/docs/guides/vercel-branch-cleanup#github-action-on-pr-close-recommended
- **Verbatim Quote:**
  > "Neon's [`delete-branch-action`](https://github.com/neondatabase/delete-branch-action) deletes a Neon branch by name. Add this workflow to your repository to clean up the preview branch as soon as a PR is closed or merged:"
  > "- uses: neondatabase/delete-branch-action@v3 with: project_id: ${{ vars.NEON_PROJECT_ID }} branch: preview/${{ github.head_ref }} api_key: ${{ secrets.NEON_API_KEY }}"
  > "This workflow requires a `NEON_PROJECT_ID` repository variable and a `NEON_API_KEY` repository secret."
  > "In particular, a project with fewer than about 20 preview deployments may never auto-delete any preview branch, because every preview stays within the last-20 set."
- **Justification:** PR #1 remaining task #10 (Task 1 step 3).

### [C26] — GitHub Actions `actions/setup-node`: usage

- **Relevant File(s):** `.github/workflows/ci.yml`
- **Change Summary:** Pin Node 26 in CI with npm caching.
- **Source URL:** https://github.com/actions/setup-node#usage
- **Verbatim Quote:**
  > "- uses: actions/setup-node@v7 with: # Version Spec of the version to use in SemVer notation. # It also admits such aliases as lts/*, latest, nightly and canary builds # Examples: 12.x, 10.15.1, >=10.15.0, lts/Hydrogen, 16-nightly, latest, node node-version: ''"
- **Justification:** PR #1 remaining task #4 (Task 1 step 2).

### [C27] — Vercel: how cron jobs are triggered

- **Relevant File(s):** `vercel.json`, `app/api/cron/*/route.ts`
- **Change Summary:** Define schedules in `vercel.json`; Vercel issues GET requests to the production URL.
- **Source URL:** https://vercel.com/docs/cron-jobs#how-cron-jobs-work
- **Verbatim Quote:**
  > "To trigger a cron job, Vercel makes an HTTP GET request to your project's production deployment URL, using the `path` provided in your project's `vercel.json` file."
  > "Vercel Functions triggered by a cron job on Vercel will always contain `vercel-cron/1.0` as the user agent."
  > "The timezone is always UTC"
- **Justification:** Task 9 Path A.

### [C28] — Vercel: securing cron jobs, idempotency, no retries

- **Relevant File(s):** `app/api/cron/*/route.ts`, `app/api/internal/**`, `features/memories/ingest-voicemail.ts`, `WebhookEvent`
- **Change Summary:** Bearer `CRON_SECRET` check; idempotent reconciliation on provider ids.
- **Source URL:** https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs and https://vercel.com/docs/cron-jobs/manage-cron-jobs#cron-job-delivery-and-idempotency
- **Verbatim Quote:**
  > "It is possible to secure your cron job invocations by adding an environment variable called `CRON_SECRET` to your Vercel project. … The value of the variable will be automatically sent as an `Authorization` header when Vercel invokes your cron job."
  > "Cron delivery can also occasionally invoke the same scheduled run more than once. Because of this, cron jobs should be resilient to both missed runs and duplicate runs."
  > "Vercel will not retry an invocation if a cron job fails."
- **Justification:** Task 9 (both paths) and the unique provider-id columns in Task 3.

### [C29] — Vercel: cron frequency limits by plan

- **Relevant File(s):** `vercel.json`, Task 0 step 3
- **Change Summary:** Per-minute polling needs Pro; Hobby allows once per day.
- **Source URL:** https://vercel.com/docs/cron-jobs/usage-and-pricing#hobby-scheduling-limits
- **Verbatim Quote:**
  > "| Hobby | 100 cron jobs | Once per day | Per-hour (±59 min) | | Pro | 100 cron jobs | Once per minute | Per-minute |"
  > "Hobby accounts are limited to cron jobs that run once per day. Cron expressions that would run more frequently will fail during deployment."
- **Justification:** §0 assumption 2, Task 0 step 3, Task 9.

### [C30] — Vercel Blob: server uploads, private stores, size limit

- **Relevant File(s):** `integrations/vercel-blob/index.ts`, `features/memories/ingest-sms.ts`, `features/memories/ingest-voicemail.ts`
- **Change Summary:** Private store, uploads under 4.5 MB from functions (MMS photos, voicemail MP3s).
- **Source URL:** https://vercel.com/docs/vercel-blob/server-upload#create-a-blob-store and https://vercel.com/docs/vercel-blob/server-upload#prepare-your-local-project
- **Verbatim Quote:**
  > "vercel blob create-store Images --access private --yes"
  > "Vercel has a 4.5 MB request body size limit on Vercel Functions. If you need to upload larger files, use client uploads."
  > "`BLOB_READ_WRITE_TOKEN`: A long-lived static read-write token … To use these Environment Variables locally, we recommend pulling them with the Vercel CLI: vercel env pull"
- **Justification:** Task 5 step 1, Task 8 step 5, Task 9.

### [C31] — Vercel Blob: client uploads (browser → Blob, token exchange, callback)

- **Relevant File(s):** `app/share/page.tsx`, `app/api/upload/route.ts`, `lib/upload-ticket.ts`, `.env.local`
- **Change Summary:** Upload large files directly from the browser; authorize in `onBeforeGenerateToken`; record the file in `onUploadCompleted`; tunnel for local testing.
- **Source URL:** https://vercel.com/docs/vercel-blob/client-upload#create-a-client-upload-route and https://vercel.com/docs/vercel-blob/client-upload#authenticating-client-uploads
- **Verbatim Quote:**
  > "When you need to upload files larger than 4.5 MB, you can use client uploads. The file goes directly from the browser to Vercel Blob, secured by a token exchange between your server and Vercel Blob."
  > "You must authenticate and authorize users in the `onBeforeGenerateToken` callback of your server route before generating a client token. Without authentication, anyone can upload files to your Blob store."
  > "`BLOB_READ_WRITE_TOKEN`: A long-lived static read-write token; required by `handleUpload` to generate client tokens for browser uploads, and for code that runs outside Vercel."
  > "The responsibility of this client upload route is to: 1. Authenticate and authorize the user making the upload request 2. Generate tokens for client uploads 3. Listen for completed client uploads, so you can update your database with the URL of the uploaded file for example"
  > "When running your application locally, the `onUploadCompleted` callback will not work as Vercel Blob cannot contact your localhost. Instead, we recommend you run your local application through a tunneling service like [ngrok](https://ngrok.com/) … `VERCEL_BLOB_CALLBACK_URL=https://abc123.ngrok-free.app`"
- **Justification:** Task 10 steps 3–5 and §7 (`BLOB_READ_WRITE_TOKEN`, `UPLOAD_TICKET_SECRET`).

### [C32] — Vercel: adding a custom apex domain

- **Relevant File(s):** `scripts/dns-setup.ts`
- **Change Summary:** Apex via `A` record, `www` via `CNAME`, verify in the dashboard.
- **Source URL:** https://vercel.com/docs/domains/working-with-domains/add-a-domain#configure-the-domain
- **Verbatim Quote:**
  > "If you're using an Apex domain (e.g. example.com), you will need to configure it with an A record"
  > "If you're using a Subdomain (e.g. docs.example.com), you will need to configure it with a CNAME record"
  > "If you add an apex domain (e.g. `example.com`) to the project, Vercel will prompt you to add the `www` subdomain prefix."
- **Justification:** Task 6 steps 1 and 3.

### [C33] — Cloudflare: creating DNS records via the API

- **Relevant File(s):** `scripts/dns-setup.ts`, `.env.local` (`CLOUDFLARE_ZONE_ID`)
- **Change Summary:** Create the Vercel and SendGrid records programmatically with the DNS-only token already in `.env`.
- **Source URL:** https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/#create-dns-records
- **Verbatim Quote:**
  > "To create records with the API, use a POST request. For field definitions, select a record type under the request body specification."
  > "**Proxy status**: For `A`, `AAAA`, and `CNAME` records, decide whether hostname traffic is proxied through Cloudflare."
- **Justification:** Task 6 step 3.

### [C34] — Cloudflare Tunnel: Quick Tunnels for local callback testing only

- **Relevant File(s):** Task 10 step 5 (local testing)
- **Change Summary:** Temporary public URL for the Blob `onUploadCompleted` callback and the SMS callback against `next dev`; never stored in VoIP.ms or Vercel.
- **Source URL:** https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/#limitations
- **Verbatim Quote:**
  > "Quick Tunnels are for testing and development. For production, create a Cloudflare Tunnel."
  > "The hostname changes each time you create a Quick Tunnel."
- **Justification:** Local testing only; production callbacks point at jowray.com on Vercel.

### [C35] — SendGrid: Node.js quickstart (key scope, sender identity, `@sendgrid/mail`, 202)

- **Relevant File(s):** `integrations/sendgrid/client.ts`, `.env`
- **Change Summary:** Mail Send-only key, authenticated sender, SDK usage.
- **Source URL:** https://www.twilio.com/docs/sendgrid/for-developers/sending-email/quickstart-nodejs#create-and-store-a-sendgrid-api-key and https://www.twilio.com/docs/sendgrid/for-developers/sending-email/quickstart-nodejs#complete-code-block
- **Verbatim Quote:**
  > "For this tutorial, create a Restricted Access API key with **Mail Send** > **Full Access** permissions only."
  > "we require customers to verify their Sender Identities by completing Domain Authentication."
  > "npm install --save @sendgrid/mail"
  > "If you receive a `202` status code printed to the console, your message was sent successfully."
- **Justification:** Task 5 step 3 and Task 11 step 2.

### [C36] — SendGrid: domain authentication DNS records

- **Relevant File(s):** `scripts/dns-setup.ts`
- **Change Summary:** Add the four generated records at Cloudflare using host labels only.
- **Source URL:** https://www.twilio.com/docs/sendgrid/ui/account-and-settings/how-to-set-up-domain-authentication#dns-resource-records-that-twilio-sendgrid-generates
- **Verbatim Quote:**
  > "If you turned on **Use automated security**, the first step on the **Install DNS Records** page displays four DNS resource records. - One `CNAME` record that points mail from your branded URL to the Twilio SendGrid email service and supports SPF and DKIM. … - Two `CNAME` records that point servers that support link branding. … - One `TXT` record that provides the DMARC record."
  > "If you see this incorrect `CNAME` value, type only the _hostname_ value into your DNS provider `CNAME` field. In this example, the host value is `em123`."
  > "DNS verification can take _up to 48 hours after upload_."
- **Justification:** Task 6 steps 2–4.

### [C37] — Vercel Knowledge Base: fixed outbound IPs (Static IPs) for allow-listed backends

- **Relevant File(s):** Decision D1 (§2), Task 0 step 2, §8
- **Change Summary:** Vercel has no fixed egress IP by default; Static IPs (Pro, $100/month per project) give an allow-listable pair, which resolves PR #1 remaining task #12 if the Mac worker is not wanted.
- **Source URL:** https://vercel.com/kb/guide/can-i-get-a-fixed-ip-address#how-to-get-a-fixed-outbound-ip-with-static-ips
- **Verbatim Quote:**
  > "Vercel deployments don't have a fixed IP address by default. Builds and [Vercel Functions](https://vercel.com/docs/functions) send outbound requests from a dynamic range of addresses, so a backend that filters by source IP will reject them."
  > "Each region you activate gets its own pair of static IPs, and you can activate up to three regions per project. Static IPs is available on Pro and Enterprise at $100/month per project, plus [Private Data Transfer](https://vercel.com/docs/pricing/regional-pricing) at regional rates."
  > "Project-level scope: The addresses apply to every [deployment environment](https://vercel.com/docs/deployments/environments) in the project. You can't limit them to production or preview."
- **Justification:** D1 option (c); the cost is why option (b) is preferred for Phase 1.

### [C38] — Vercel `vercel.json`: `buildCommand` and `crons`

- **Relevant File(s):** `vercel.json`, `package.json`
- **Change Summary:** Run `prisma migrate deploy` in the Vercel build while `npm run build` stays database-free for CI; define the Path A crons.
- **Source URL:** https://vercel.com/docs/project-configuration/vercel-json#buildcommand and https://vercel.com/docs/project-configuration/vercel-json#crons
- **Verbatim Quote:**
  > "The `buildCommand` property can be used to override the Build Command in the Project Settings dashboard, and the `build` script from the `package.json` file for a given deployment."
  > "Used to configure [cron jobs](https://vercel.com/docs/cron-jobs) for the production deployment of a project."
  > "- `path` - Required - The path to invoke when the cron job is triggered. Must start with `/`. - `schedule` - Required - The [cron schedule expression](https://vercel.com/docs/cron-jobs#cron-expressions) to use for the cron job."
- **Justification:** Task 3 step 7 and Task 9 Path A.

### [C39] — VoIP.ms API: `setSMS` URL callback, retry, dial mode

- **Relevant File(s):** `scripts/setup-memory-line.ts`, `app/api/voipms/sms/[token]/route.ts`
- **Change Summary:** Enable SMS with a GET callback to jowray.com and answer `ok`.
- **Source URL:** https://voip.ms/m/apidocs.php (section `setSMS`; interactive session required). Local copy: `AvaTinCan/docs/voip.ms.documentation.md` lines 12792–12840; re-verify in `docs/2026-10-30-voipms-api-documentation.md`.
- **Verbatim Quote:**
  > "url_callback_enable =>          If Enable, SMS Messages received by your DID will be send a GET request to the URL callback provided (Values:1=Enable / 0=Disable)"
  > "url_callback        =>          SMS Messages received by your DID will be send a GET request to the URL callback provided Available Variables for your URL {FROM}    The phone number that sent you the message. {TO}      The DID number that received the message. {MESSAGE} The content of the message."
  > "url_callback_retry  =>          Enable URL callback Retry (Values:1=Enable / 0=Disable) we will be expecting an 'ok' output (without quotes) from your URL callback page as an indicator that you have received the message correctly. If we don\'t receive the 'ok' letters (wihtout quotes) from your callback page, we will keep sending you the same message every 30 minutes."
  > "dialmode            =>          Dialing Mode for SMS (API) (Values:1=NANPA / 2=E164)"
- **Justification:** Task 7 step 5 and Task 8 steps 3–4. The `{ID}`, `{TIMESTAMP}`, `{MEDIA}` variables the design doc lists are not in this copy and must be confirmed in Task 0.

### [C40] — VoIP.ms API: `getSMS` / `getMMS` (ids and media)

- **Relevant File(s):** `features/memories/ingest-sms.ts`
- **Change Summary:** Recover MMS media after the callback; photos are at most 1.2 MB each.
- **Source URL:** https://voip.ms/m/apidocs.php (sections `getSMS`, `getMMS`, `sendMMS`). Local copy lines 11305–11385 and 12312–12322.
- **Verbatim Quote:**
  > "type    =>          Filter SMSs by Type (Boolean: 1 = received / 0 = sent) did     =>          DID number for Filtering SMSs (Example: 5551234567) contact =>          Contact number for Filtering SMSs (Example: 5551234567)"
  > "all_messages=>          Filter to recive all SMSs and MMSs, 1 recive all SMS and MMS, 0 if only need SMS, important: the sms ID must be 0"
  > "[media] => Array ( [0] =>'https://voip.ms/media.php?map=MTU5MzUzMDcTk2NNUw=='"
  > "When sending multimedia via POST and base64, the file limit is based on the maximum allowed per message, 1.2 mb per file."
- **Justification:** Task 8 step 5 and the size note in Task 5.

### [C41] — VoIP.ms API: IP address enablement (decision D1)

- **Relevant File(s):** `scripts/voipms-worker.ts`, `integrations/voipms/client.ts`, Decision D1
- **Change Summary:** VoIP.ms calls must originate from an enabled IP; Vercel has none by default, so Path B runs them from the Mac unless bearer auth or Static IPs are used.
- **Source URL:** https://voip.ms/m/apidocs.php (section "ENABLE IP ADDRESSES"). Local copy lines 47–57; error `ip_not_enabled` line 689.
- **Verbatim Quote:**
  > "ENABLE IP ADDRESSES By default no IP Address is able to consume services from VoIP.ms API. IP Addresses must be enabled on Per Account Basis following these steps:"
  > "Introduce the IP Address where the API is going to be consumed from Click on [Save IP Addresses] button to Enable the IP Addresses"
  > "You can add various IP Addresses by separating them with a comma (example: 192.168.1.1, 192.168.1.2)"
  > "ip_not_enabled	This IP is not enabled for API use"
- **Justification:** §2 D1 and Task 0 step 2(a).

### [C42] — VoIP.ms API: `sendSMS`

- **Relevant File(s):** `integrations/voipms/client.ts`, `features/memories/confirm.ts`, `features/memories/sms-agent.ts`
- **Change Summary:** Send ≤ 160-character replies and store the returned id on the outbound `SmsMessage`.
- **Source URL:** https://voip.ms/m/apidocs.php (section `sendSMS`). Local copy lines 12296–12305.
- **Verbatim Quote:**
  > "sendSMS Parameters did         => [Required] DID Numbers which is sending the message (Example: 5551234567) dst         => [Required] Destination Number (Example: 5551234568) message     => [Required] Message to be sent (Example: 'hello John Smith' max chars: 160)"
  > "Output Array ( [status] => success [sms] => 23434 )"
- **Justification:** Task 8 step 10, Task 9 outbox, Task 11 step 2.

### [C43] — VoIP.ms API: `createVoicemail`

- **Relevant File(s):** `scripts/setup-memory-line.ts`
- **Change Summary:** Create the memory mailbox (transcription off in Phase 1) with a custom greeting.
- **Source URL:** https://voip.ms/m/apidocs.php (section `createVoicemail`). Local copy lines 13965–13990.
- **Verbatim Quote:**
  > "digits                        => [Required] Digits used to create the voicemail (Example: 01) Minimum 1 digit, maximum 10 digits name                          => [Required] Name for the Mailbox"
  > "transcription                 => 'yes' to enable Voicemail Transcription"
  > "unavailable_message_recording => Recording for the Unavailable Message (values from getRecordings)"
- **Justification:** Task 7 step 5.

### [C44] — VoIP.ms API: `getVoicemailMessages` / `getVoicemailMessageFile`

- **Relevant File(s):** `integrations/voipms/voicemail.ts`, `features/memories/ingest-voicemail.ts`, `Call.providerCallId`
- **Change Summary:** Poll the mailbox and download MP3 audio as base64.
- **Source URL:** https://voip.ms/m/apidocs.php (sections `getVoicemailMessages`, `getVoicemailMessageFile`). Local copy lines 14147–14200.
- **Verbatim Quote:**
  > "[messages] => Array ( [0] => Array ( [mailbox] => 1001 [folder] => INBOX [message_num] => 1 [date] => 2016-01-30 [callerid] => 5551234567 [duration] => 00:00:06 [urgent] => yes [listened] => no ) )"
  > "format     =>            File format. Default value is mp3. Values: mp3, wav, wav49, gsm."
  > "[data]   => UklGRqTEAQBXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YYDEA...."
- **Justification:** Task 7 step 4 and Task 9.

### [C45] — VoIP.ms API: `setDIDRouting`

- **Relevant File(s):** `scripts/setup-memory-line.ts`
- **Change Summary:** Route the memory DID to the mailbox.
- **Source URL:** https://voip.ms/m/apidocs.php (section `setDIDRouting`). Local copy lines 12502–12520.
- **Verbatim Quote:**
  > "routing can receive values in the following format => header:record_id Where header could be: account, fwd, vm, sip, grp, ivr, sys, recording, queue, cb, tc, disa, none."
  > "vm          Used for routing calls to a Voicemail. You can get all voicemails and their IDs using the getVoicemails function Examples:    'account:100001_VoIP' 'fwd:1026' 'vm:101'"
- **Justification:** Task 7 step 5.

### [C46] — VoIP.ms: SMS daily limit and A2P

- **Relevant File(s):** `features/memories/confirm.ts`, Task 7 step 5
- **Change Summary:** Budget replies under the default limit; plan A2P registration.
- **Source URL:** https://voip.ms/m/apidocs.php (introduction). Local copy line 18.
- **Verbatim Quote:**
  > "VoIP.ms also supports Application-to-Person (A2P) delivery for business text messaging. However, requirements and fees vary due to industry regulations. The default limit is 100 SMS per day, which can be raised upon request. Contact us at messaging@voip.ms to start your verification process."
- **Justification:** Task 7 step 5 note.

### [C47] — VoIP.ms API: `markListenedVoicemailMessage`

- **Relevant File(s):** `integrations/voipms/voicemail.ts`
- **Change Summary:** Mark processed messages listened instead of deleting them.
- **Source URL:** https://voip.ms/m/apidocs.php (section `markListenedVoicemailMessage`). Local copy lines 14233–14242.
- **Verbatim Quote:**
  > "markListenedVoicemailMessage Parameters mailbox     => [Required] ID for specific Mailbox (Example: 1001) folder      => [Required] Name for specific Folder (Example: 'INBOX', values from: getVoicemailFolders) message_num => [Required] ID for specific Voicemail Message (Example: 1) listened    => [Required] Code for mark voicemail as listened or not-listened (Values: 'yes'/'no')"
- **Justification:** Task 7 step 4 and Task 9.

### [C48] — VoIP.ms API: `getDIDsInfo` SMS fields

- **Relevant File(s):** `integrations/voipms/sms-settings.ts`
- **Change Summary:** Read the DID's current SMS settings before writing them back.
- **Source URL:** https://voip.ms/m/apidocs.php (section `getDIDsInfo`). Local copy, `getDIDsInfo` output block.
- **Verbatim Quote:**
  > "[sms_enabled] => 1 [sms_email] => john.doe@example.com [sms_email_enabled] => 1 [sms_forward] => 2264836086 [sms_forward_enabled] => 1 [sms_url_callback] => http://myurl.com [sms_url_callback_enabled] => 1 [sms_url_callback_retry] => 1"
- **Justification:** Task 7 step 3's read-modify-write of all SMS settings.

### [C49] — Google Gen AI JS SDK (`@google/genai`): install, client, Node version, pinning

- **Relevant File(s):** `package.json`, `integrations/gemini/client.ts`, `integrations/gemini/sms-turn.ts`
- **Change Summary:** The only AI dependency; API-key client; pin below 3.0.0.
- **Source URL:** https://github.com/googleapis/js-genai#quickstart and https://github.com/googleapis/js-genai#prerequisites
- **Verbatim Quote:**
  > "npm install @google/genai"
  > "import {GoogleGenAI} from '@google/genai'; const GEMINI_API_KEY = process.env.GEMINI_API_KEY; const ai = new GoogleGenAI({apiKey: GEMINI_API_KEY});"
  > "1. Node.js version 20 or later"
  > "**Upcoming Change to Node.js Support:** Starting from SDK version 3.0.0, Node.js version 22 or later is required."
  > "To avoid unexpected updates, pin the SDK version to `< 3.0.0`."
  > "const interaction = await ai.interactions.create({ model: 'gemini-flash-latest', input: 'Hello, how are you?', });"
- **Justification:** Task 8 steps 7 and 9; replaces every BAML reference in the previous draft.

### [C50] — Gemini API quickstart: API key

- **Relevant File(s):** `.env` (`GEMINI_API_KEY`), Task 0 step 4
- **Change Summary:** Create the key in AI Studio and set it as an environment variable.
- **Source URL:** https://ai.google.dev/gemini-api/docs/quickstart (redirects to https://aistudio.google.com/docs/get-started)
- **Verbatim Quote:**
  > "[Create a Gemini API Key](https://aistudio.google.com/apikey) Set your key as an environment variable: export GEMINI_API_KEY="YOUR_API_KEY""
- **Justification:** Task 0 step 4 and §7.

### [C51] — Gemini API: structured outputs (JSON Schema support, Zod, validation, unenforced constraints)

- **Relevant File(s):** `lib/validations/sms-agent.ts`, `integrations/gemini/sms-turn.ts`, `features/memories/sms-agent.ts`
- **Change Summary:** Ask Gemini for JSON matching a schema derived from zod; enforce `maxItems: 2` on questions; validate everything else in code.
- **Source URL:** https://ai.google.dev/gemini-api/docs/structured-output#json-schema-support (redirects to https://aistudio.google.com/docs/structured-output#json-schema-support) and …#limitations
- **Verbatim Quote:**
  > "You can configure Gemini models to generate responses that adhere to a provided JSON Schema. This ensures predictable, type-safe results and simplifies extracting structured data from unstructured text."
  > "In addition to supporting JSON Schema in the REST API, the Google GenAI SDKs allow defining schemas using [Pydantic](https://docs.pydantic.dev/latest/) (Python) and [Zod](https://zod.dev/) (JavaScript)."
  > "To generate a JSON object, configure `response_format` with an object (or an array containing an object) of type `text` and set its `mime_type` to `application/json`. The schema should be provided in the `schema` field."
  > "The following values of `type` are supported: - **`string`**: For text. - **`number`**: For floating-point numbers. - **`integer`**: For whole numbers. - **`boolean`**: For true or false values. - **`object`**: For structured data with key-value pairs. - **`array`**: For lists of items. - **`null`**: To allow a property to be null, include `"null"` in the type array"
  > "**Unenforced constraints:** `minLength`, `maxLength`, `minProperties`, `maxProperties`, `uniqueItems`, `contains`, `minContains`, and `maxContains` (and their snake_case variants) are not enforced by the constrained decoding grammar engine. … `minItems` and `maxItems` are enforced. To enforce the other constraints, validate the output in your client application (e.g., using Pydantic `model_validate_json()` or Zod `.parse()`)."
  > "**Validation:** While output is syntactically correct JSON, always validate values in your application."
- **Justification:** Task 8 steps 8–9 and §8.

### [C52] — Gemini API: image understanding (inline base64 images, request size)

- **Relevant File(s):** `integrations/gemini/sms-turn.ts`
- **Change Summary:** Pass MMS photos inline as base64 image parts, text prompt first.
- **Source URL:** https://ai.google.dev/gemini-api/docs/image-understanding#inline-image (redirects to https://aistudio.google.com/docs/image-understanding#inline-image)
- **Verbatim Quote:**
  > "You can provide image data as base64-encoded strings:"
  > "Inline image data limits your total request size (text prompts, system instructions, and inline bytes) to 20MB. For larger requests, [upload image files](https://aistudio.google.com/docs/image-understanding#upload-image) using the File API."
  > "Gemini supports the following image format MIME types: - PNG - `image/png` - JPEG - `image/jpeg` - WEBP - `image/webp` - HEIC - `image/heic` - HEIF - `image/heif`"
  > "When using a single image with text, place the text prompt _before_ the image in the `input` array."
- **Justification:** Task 8 step 9; MMS photos (≤ 1.2 MB) fit comfortably inline.

### [C53] — Gemini API: models (Gemini 3.8 Flash, 2.5 deprecations)

- **Relevant File(s):** `integrations/gemini/client.ts`, §7 (`GEMINI_MODEL`), §8
- **Change Summary:** Default to `gemini-3.8-flash`; keep the model string in an env value because the 2.5 generation is being retired.
- **Source URL:** https://ai.google.dev/gemini-api/docs/models (redirects to https://aistudio.google.com/docs/models)
- **Verbatim Quote:**
  > "Gemini 3.8 Flash Our most intelligent Flash model, engineered for long-horizon software engineering, autonomous agents, and complex enterprise workflows."
  > "| [Gemini 3.8 Flash](https://aistudio.google.com/docs/models/gemini-3.8-flash) | `gemini-3.8-flash` |"
  > "`gemini-2.5-pro` is [deprecated](https://aistudio.google.com/docs/deprecations#gemini-2.5-pro-models) and is no longer available to select in Google AI Studio (API access to the 2.5 models is limited to existing users). Effective December 1, 2026, all API requests to `gemini-2.5-pro` will automatically route to [`gemini-3.8-flash`](https://aistudio.google.com/docs/models/gemini-3.8-flash)."
  > "For any new projects, use our latest models: 3.5 Flash-Lite or 3.8 Flash."
- **Justification:** Task 8 step 7 and §8.

### [C54] — Gemini API: audio transcription with `gemini-3.5-transcribe` (Phase 2)

- **Relevant File(s):** §0 assumption 5, §9
- **Change Summary:** Leave VoIP.ms transcription off; transcribe stored audio with Gemini in Phase 2.
- **Source URL:** https://ai.google.dev/gemini-api/docs/transcribe (redirects to https://aistudio.google.com/docs/transcribe) and https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe
- **Verbatim Quote:**
  > "The Gemini API converts speech in audio files into text using the Gemini 3.5 Transcribe model (`gemini-3.5-transcribe`). Based on Gemini's audio understanding capabilities, it delivers accurate transcription with automatic language identification, speaker diarization, word-level timestamps, and custom vocabulary hints."
  > "**Audio duration:** Standard unary requests support audio files up to 1 hour. Audio processing is limited to 30 minutes when features like speaker diarization or word-level timestamps are enabled."
  > "**`smart` (Smart transcription)**: Optimizes the transcript for reading by applying intelligent post-processing: - **Disfluency removal**: Strips conversational filler words, stuttering, and false starts."
- **Justification:** Phase 2 preview; explains why no transcription vendor is wired in Phase 1.

### [C55] — Gemini API: audio understanding (inline audio, formats, token cost) (Phase 2)

- **Relevant File(s):** §9
- **Change Summary:** One-shot audio prompts can pass the MP3 inline under 20 MB.
- **Source URL:** https://ai.google.dev/gemini-api/docs/audio#inline-audio (redirects to https://aistudio.google.com/docs/audio#inline-audio)
- **Verbatim Quote:**
  > "For small audio files under 20MB total request size:"
  > "Maximum request size is 20 MB total (including prompts and all files)"
  > "Gemini supports the following audio format MIME types: - WAV - `audio/wav` - MP3 - `audio/mp3` … - MPEG - `audio/mpeg`"
  > "**Tokens**: 32 tokens per second of audio (1 minute = 1,920 tokens)"
- **Justification:** Phase 2 preview.

### [C56] — Next.js: verify authorization inside Server Functions

- **Relevant File(s):** `app/share/actions.ts`, `app/m/[claimToken]/actions.ts`
- **Change Summary:** The upload ticket and claim token are checked inside each Server Function, not in a proxy.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/proxy#execution-order
- **Verbatim Quote:**
  > "Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone."
- **Justification:** Task 10 step 2 and Task 11 step 3.
