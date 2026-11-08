# Accounts and "Sign up for updates"

Plan v1, 2026-11-08. Status: **proposal, nothing built**. Rob's request (2026-11-08):

> Add a thing at the footer that says sign up for updates that allows a user to put in their email address. This should be a proper feature. We should validate the email before adding it to our list. … I wonder if we shouldn't just build a user table into the database and deploy basic NextAuth, which would lay the groundwork for future things like editing all your memories, commenting, or adding more memories. A user would get an account by signing up for emails, adding a memory, or signing up for a mailing list. After we have validated the email with a return click, they could then edit memories, add memories, comment etc. Don't build the comment feature now.

This plan turns that into three PRs. It is the Phase 3 "Manage" item from the design doc (`docs/Memorial Memories Site initial thinking.md` §Auth.js) and debt item M-J-05, scoped down to what Rob asked for.

## Cold start

| Item | Value |
|---|---|
| Canonical path | `docs/plans/2026-11-08-accounts-and-updates-signup.md` |
| Base | `origin/main` at the time PR-A is cut; newest migration today is `20261108021500_media_gps_scan_complete` (re-check with `ls prisma/migrations \| tail -1`). |
| Prior art to reuse | Claim tokens (`lib/claim-token.ts`: 32-byte base64url, only the sha256 stored), invite tokens (`lib/invite-token.ts`), the admin entry key carried in a URL **fragment** (`/admin/enter#key=`) so it never reaches a server log, the HMAC admin cookie (`features/admin/session.ts`), `recipientKey()` (`services/email/recipient-key.ts`), the outbound caps and `EmailLog` (`docs/features/email-and-cron.md`), the per-viewer counters in `EgressCounter` (places and media), the Sentry token scrubber (`lib/sentry/secrets.ts`, `lib/sentry/scrub.ts`). |
| What exists today | `User` model is a stub ("Phase 3 fills this in"), `Contributor.userId` is nullable and `@unique` (one contributor per user), `Contributor.mailingListOptIn` is a share-form checkbox that is stored and shown in the admin alert but **never confirmed or acted on**, `AUTH_SECRET` is a placeholder key in `docs/environment.md`. No auth library is installed. |
| Before any Next.js code | `npm ci`, then read the auth, Server Functions and `cookies()`/`headers()` guides in `node_modules/next/dist/docs/` (AGENTS.md). |
| Checks | `npm run validate`, `TEST_DATABASE_URL=… npm run test:run`, `npm run build:offline`. All three must pass with no `.env*` and no database, so nothing in the auth setup may read env or open a connection at module scope. |

## What Rob gets, in order

1. **PR-A, "Sign up for updates" in the footer, on top of real accounts.** A footer form takes an email. We check it and send one fixed-content email with a confirm button. The click verifies the address, creates (or finds) the person's account, confirms their subscription and signs them in. Nobody is on the list until they click.
2. **PR-B, accounts from the share form.** Sending a memory with an email creates an unverified account. The "sign up for the mailing list" checkbox, which today is stored and never used, creates a pending subscription. Verifying the address, by the receipt's confirm button or by any later sign-in, links every memory sent from that address to the account.
3. **PR-C, "Your memories".** Signed-in, verified people see every memory they sent on one page and can edit any of them, using the same edit rules as the claim link today. When they add a memory, the share form fills in their details and the new memory belongs to their account straight away. Claim links keep working for people who never sign in.

Comments are **not** built. The account model leaves room for them (a `Comment` table keyed by `userId` later).

## Decisions for Rob

| Id | Decision | Recommendation | Status |
|---|---|---|---|
| A1 | **Auth library.** Rob said "NextAuth". Auth.js v5 (the `next-auth` package) is still a beta (`5.0.0-beta.x`). In September 2025 the Auth.js team handed maintenance to the Better Auth team, and both teams now tell new projects to use **Better Auth**. Better Auth has a Prisma adapter, a magic-link plugin, database sessions and a standard Next.js 16 route handler. | **Better Auth** with the Prisma adapter and the magic-link plugin, wrapped so that every place the site touches it goes through one `features/auth` module. Alternative: write the small amount of auth ourselves (hashed one-time tokens + an HMAC session cookie, which is what the admin page and claim links already do). That gives less "groundwork" for later and more code to own. | **Rob** |
| A2 | **What "validate the email" means.** | Three layers, all needed: (1) syntax, using the zod `z.email()` the share form uses, trimmed and lower-cased, at most 254 characters; (2) the domain must accept mail, checked with an MX lookup (A/AAAA fallback, 2-second timeout; on a DNS *error* we go ahead, because the click still decides); (3) **double opt-in**: the address goes on the list only after its owner clicks the confirm link. No paid verification service. | **Rob** |
| A3 | **Does the confirm click also sign the person in?** | Yes. The click proves they own the inbox, which is the same proof a magic link gives. The page then says "You're on the list, and you're signed in on this device." | **Rob** |
| A4 | **Abuse of a public "send an email to this address" form.** Anyone could type a stranger's address. | Fixed-content email only: no name and no text typed by the visitor (the same rule as the receipt, issue #46 D1). Per-recipient cap: at most 3 confirm emails per address per 24 h, counted by `recipientKey()`. Per-visitor cap: 10 sign-ups per hashed client address per UTC day, using the `EgressCounter` pattern. All of these count toward the global `OUTBOUND_*` caps. A hidden honeypot field. The visitor always sees the same answer, "Check your inbox", whether the address is new, already confirmed or capped, so the form can't be used to find out who is on the list. **No CAPTCHA for now.** Add Cloudflare Turnstile only if abuse appears (follow-up F2). | **Rob** |
| A5 | **Email link scanners.** Outlook Safe Links and some corporate filters open every link in an email. A GET that verifies a one-time token would be used up by the scanner before the person clicks it. | The email links to `/confirm#t=<token>`. The token is in the **fragment**, the way `/admin/enter#key=` already works, so it is never in a request line, Vercel log or `Referer`. The page shows a button. Pressing it sends the token to a Server Function in the body, which verifies the token, signs the person in and confirms the subscription. A scanner loads the page, never presses the button, and so never uses the token. This means we **do not use Better Auth's GET `/magic-link/verify` link in emails**. We call its verify API from our Server Function instead. Check at implementation that the plugin allows this; if it doesn't, use our own token table for this one step and leave sessions to Better Auth. | **Rob** |
| A6 | **Sessions.** | Database sessions (Better Auth default), with an httpOnly, `Secure`, `SameSite=Lax` cookie lasting 30 days and renewed on use, the same length as the admin session. Signing out deletes the row. | agent call |
| A7 | **Linking past memories to an account.** The debt catalog (M-J-05) forbids attaching submissions to an account by an *unverified* email. | Link only at verification. When an address is verified, every `Contributor` row whose `recipientKey(email)` matches is linked to that user, in one transaction. This grants nothing new: each of those memories' claim links was already emailed to that same inbox. Rows for other aliases stay unlinked until the person verifies that alias. | **Rob** |
| A8 | **One email or two after a share** (PR-B). | One. The send receipt gets one fixed line, "Confirm your email to manage all your memories in one place" (plus "and get updates" when the checkbox was ticked), and a button to `/confirm#t=…`. This changes a critical-path template, so it goes in PR-B with TDD and an email preview, not in PR-A. | **Rob** |
| A9 | **What happens to the existing `mailingListOptIn = true` rows?** Those addresses were never confirmed. | Turn each into a `PENDING` subscription with source `SHARE_FORM_LEGACY`. **Do not mail them automatically.** The November 10 update to contributors (promised on the thank-you page) is the natural point to ask them to confirm. Rob decides when that goes out. | **Rob** |
| A10 | **Family admins as accounts.** `UserRole.FAMILY_ADMIN` exists. | Out of scope. `/admin` stays on `ADMIN_PAGE_SECRET`. Moving admins to role-based sign-in is follow-up F4. | agent call |
| A11 | **Sending the updates themselves** (a broadcast to the list). | Out of scope for these PRs, but PR-A stores everything a broadcast will need: a per-subscription unsubscribe token hash and the consent record. The broadcast feature (with RFC 8058 one-click `List-Unsubscribe`, which Gmail and Yahoo require of bulk senders) is follow-up F1. | **Rob** |

## Data model (PR-A migration, PR-B/C additions noted)

The table names stay Prisma-style. Better Auth's adapter maps its `user`/`session`/`account`/`verification` models onto ours through its `modelName`/`fields` options. Check the exact field set against the installed Better Auth version, then write the migration by hand (not from its CLI) so it follows house style.

```prisma
model User {
  id              String    @id @default(uuid())
  email           String    @unique          // trimmed, lower-cased as typed; was nullable, now required (table is empty today: verify COUNT(*) = 0 in the migration step)
  emailKey        String    @unique          // recipientKey(email): one account per inbox, aliases folded
  emailVerified   Boolean   @default(false)  // Better Auth's flag
  emailVerifiedAt DateTime?
  name            String?
  image           String?                    // Better Auth field; unused
  phone           String?   @unique          // kept for the design doc (SMS sign-in later)
  role            UserRole  @default(CONTRIBUTOR)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  sessions        Session[]
  accounts        Account[]
  contributors    Contributor[]              // was one-to-one; Contributor.userId loses @unique
  subscriptions   MailingListSubscription[]
  revisions       MemoryRevision[]
}

model Session {                              // Better Auth
  id        String   @id @default(uuid())
  userId    String
  token     String   @unique                 // stored hashed if the installed version supports it; check at implementation
  expiresAt DateTime
  ipAddress String?
  userAgent String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model Account {                              // Better Auth requires it; one row per sign-in method
  id         String @id @default(uuid())
  userId     String
  providerId String
  accountId  String
  /* token columns Better Auth defines, all unused by magic link */
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  user       User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([providerId, accountId])
}

model Verification {                         // Better Auth one-time tokens (magic link)
  id         String   @id @default(uuid())
  identifier String                          // hashed token (storeToken: "hashed")
  value      String
  expiresAt  DateTime                        // 30 minutes for sign-in; 7 days for a mailing-list confirm (see note)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@index([identifier])
}

enum SubscriptionStatus { PENDING CONFIRMED UNSUBSCRIBED }
enum SubscriptionSource { FOOTER SHARE_FORM SHARE_FORM_LEGACY ACCOUNT ADMIN }

model MailingListSubscription {
  id                   String             @id @default(uuid())
  memorialId           String
  userId               String
  status               SubscriptionStatus @default(PENDING)
  source               SubscriptionSource
  requestedAt          DateTime           @default(now())
  confirmedAt          DateTime?          // the double opt-in proof, with the fields below
  confirmedIp          String?
  unsubscribedAt       DateTime?
  unsubscribeTokenHash String             @unique // sha256; the raw token goes only into update emails (F1)
  memorial             Memorial           @relation(fields: [memorialId], references: [id])
  user                 User               @relation(fields: [userId], references: [id])
  @@unique([memorialId, userId])
  @@index([memorialId, status])
}
```

`EmailLog` today requires a `memoryId` and is unique on `(memoryId, emailType)`. PR-A makes `memoryId` nullable, adds `userId String?`, adds a CHECK that exactly one of the two is set, and adds the types `ACCOUNT_CONFIRM` (the footer confirm) and `SIGN_IN_LINK`. In Postgres, NULLs are distinct in a unique index, so the per-memory idempotency still holds. The per-recipient and global caps keep counting these rows through `recipientKey` and `updatedAt`, as they do now.

PR-C adds `ChangedVia.ACCOUNT`. Edits made while signed in write a `MemoryRevision` with `changedByUserId` set.

**Token lifetime.** A sign-in link expires after 30 minutes. A footer confirm link expires after 7 days, because people open newsletter confirmations late. If Better Auth's magic-link plugin allows only one `expiresIn`, the footer confirm uses our own `Verification` row through its internal adapter, or a small `EmailConfirmation` table built like `Invite` (hashed token, `expiresAt`, `usedAt`). Pick this at implementation and record the choice here.

## Flows

### Footer sign-up (PR-A)

1. `SiteFooter` gains a short form under the contact line: the heading "Sign up for updates", one email field, a button, and a hidden honeypot. It is a Client Component (`app/_components/updates-signup-form.tsx`) that calls a Server Function in `app/updates/actions.ts`. Per the layer rules, `_components` never imports `@/server` or `@/integrations`.
2. The Server Function `requestUpdatesSignup(email, honeypot)` is wrapped in `instrumentedAction` and calls `features/accounts/request-signup.ts`:
   - parse with `lib/validations/accounts.ts` (zod), then run the MX check through `services/email-domain` (`integrations/dns`, which wraps `node:dns/promises` and can be faked in tests);
   - apply the per-visitor counter, then the per-recipient cap, then the global outbound caps;
   - in one transaction, upsert `User` by `emailKey` and upsert a `PENDING` subscription. A `CONFIRMED` subscription is left as it is and gets no email. An `UNSUBSCRIBED` one goes back to `PENDING`, and only the click re-confirms it;
   - mint the token and send the `ACCOUNT_CONFIRM` email through `services/email` (new template `account-confirm.ts` on `templates/shared.ts`, fixed content, brand marks inline, no visitor text).
   - The visitor always gets `{ success: true }` and "Check your inbox for a link from memories@jowray.com." Validation errors are the only other answer ("That doesn't look like an email address", "We can't find a mail server for that address").
3. `/confirm` (page, `await connection()` first) reads `#t=` in the browser and shows "Confirm my email". The button calls `confirmEmail(token)`, which runs `features/accounts/confirm-email.ts`. That function verifies and spends the token, sets `emailVerified`, links contributors (A7), confirms the subscription, records `confirmedAt` and `confirmedIp`, and creates the session cookie. The page then replaces the URL without the fragment (`history.replaceState`) and shows "You're on the list" plus a link to `/account`.
4. An expired or used token shows "This link has expired" with the footer form inline to get a new one. This screen is the same whether the token was never valid or already used.

### Sign-in for existing accounts (PR-A)

`/signin` takes an email and sends a `SIGN_IN_LINK` email with the same caps and the same "Check your inbox" answer, but only when a `User` with that `emailKey` exists. Otherwise it sends nothing and gives the same answer. The link goes through the same `/confirm#t=` page. The header gets a small "Sign in" or "Your account" link. That link is hidden until PR-C so it doesn't point at an empty page; until then `/account` shows email, list status (subscribe/unsubscribe) and "Sign out".

### Share form (PR-B)

`createSubmission` already creates a `Contributor` per send. When an email is given it also upserts an **unverified** `User` by `emailKey`. It does not link the contributor (A7). If `mailingListOptIn` is ticked it upserts a `PENDING` subscription with source `SHARE_FORM`. The receipt gains the confirm button (A8). If the visitor is signed in and verified, the contributor is linked to them straight away.

### Your memories (PR-C)

`/account/memories` lists memories whose contributor is linked to the signed-in, verified user (status shown, drafts included). Editing reuses `features/memories/claim.ts`. The token lookup becomes one of two **access resolvers**: a claim token, or a session whose user owns the memory's contributor. Everything after the lock (validation, D17 re-review, revisions, media add/replace/remove) stays one code path, so the two ways in can't drift. TDD: every claim test runs again under the session resolver, plus tests for a memory owned by someone else (404) and for an unverified user (no access).

## Security, logging and Sentry

- **New bearer secrets.** The confirm and sign-in token (`t` in a fragment and in the Server Function body), the session cookie and the unsubscribe token. Add `confirmToken`, `sessionToken` and `unsubscribeToken` to `SECRET_FIELD_KEYS`. The `token` key fragment already covers them, but naming them documents them. Add `/confirm#t=` to the URL patterns in `lib/sentry/scrub.ts`, then extend `__tests__/lib/sentry-envelope.test.ts` with a synthetic `SENTRYTEST_` confirm token and session cookie and prove neither leaves. The Better Auth cookie travels in `cookie`, which is already dropped whole. Never log a `Verification` or `Session` row.
- **CSRF.** Server Functions are POST-only with Next's origin check. Better Auth's own route handler (`app/api/auth/[...all]/route.ts`) keeps its origin check, with `trustedOrigins` set from `getSiteUrl()`. Only the sign-out and get-session routes are used directly.
- **Cache Components.** `getAuth()` builds the Better Auth instance lazily on first call, like `getDb()`. It reads `BETTER_AUTH_SECRET` through a new `getAuthEnv()` sub-schema, and neither happens at module scope. Pages that read the session call `await connection()` first. No `proxy.ts` is needed: gating happens in the page and again in every Server Function, the way the admin page does it.
- **Sentry identity.** When a session exists, `lib/sentry/user.ts` sets `user.id` to the `User` id, `user.email` to the address and `user.username` to the name. The R10/R13 policy allows this.
- **Privacy note** (`app/_components/privacy-note-client.tsx`) gains short paragraphs on the mailing list (what we store, how to leave) and on accounts.
- **Retention.** The reconcile cron gets two steps: delete `PENDING` subscriptions older than 30 days whose user never verified, and delete unverified users that have no contributor and no subscription. Expired `Session` and `Verification` rows are swept as well.

## Environment

| Key | Purpose | Where |
|---|---|---|
| `BETTER_AUTH_SECRET` | Signs and encrypts Better Auth cookies and tokens. 32+ random bytes (`openssl rand -base64 48`). Replaces the placeholder `AUTH_SECRET` row in `docs/environment.md`. When unset or empty, sign-in and confirm fail closed with a friendly "Sign-up isn't available right now", never a 500. | Production, Preview (its own value), local `.env` |
| `ACCOUNT_SIGNUP_VIEWER_DAILY` | Sign-up and sign-in requests per hashed client address per UTC day (default 10). Optional; a malformed value falls back to the default and is reported. | optional |
| `ACCOUNT_CONFIRM_RECIPIENT_DAILY` | Confirm and sign-in emails per `recipientKey` per rolling 24 h (default 3). Same fallback. | optional |

Better Auth's base URL comes from `getSiteUrl()`, not from a separate `BETTER_AUTH_URL`, so previews work on their branch host. Preview databases are copies of production rows, so a preview can email a real contributor only if that address is on `OUTBOUND_ALLOWLIST`. That is the existing guard, and it is enough.

## PR breakdown and ledger

| Row | Step | Done when | Status |
|---|---|---|---|
| P0 | Rob rules on A1–A5, A7–A9, A11 | rulings recorded in the table above | open |
| A1 | Branch, `npm ci`, read Next auth/cookies docs, three checks green on base | recorded here | |
| A2 | Install Better Auth (exact version pinned, added to `docs/dependencies.md`), migration (User, Session, Account, Verification, MailingListSubscription, EmailLog generalisation), `getAuthEnv`, `getAuth()` | `validate` + `test:run` (real Postgres) green; `build:offline` green with no env | |
| A3 | `lib/validations/accounts.ts`, `integrations/dns` + `services/email-domain`, counters and caps; tests first | unit tests for syntax, MX present/absent/error, every cap, honeypot, identical answers | |
| A4 | `features/accounts/request-signup.ts`, `confirm-email.ts`, `sign-in.ts`, `sign-out.ts`; `account-confirm` and `sign-in-link` templates with previews | TDD: confirm spends the token once, links contributors by key, confirms subscription, sets the session; expired/used tokens share the same screen | |
| A5 | Footer form, `/confirm`, `/signin`, `/account`; privacy note; Sentry scrub and envelope test | Playwright check on a preview: sign-up → email (allowlisted inbox) → confirm → signed in → unsubscribe → re-subscribe; screenshots in `docs/plans/evidence/2026-11-accounts/` | |
| A6 | Docs: `docs/features/accounts.md`, `docs/environment.md`, `docs/code-layout.md` layer list, README diagram if one changes | PR-A ready for review | |
| B1 | Share-form account and subscription creation; receipt confirm button (A8); legacy opt-ins → `PENDING` (A9) | TDD on `create-submission` and the receipt template; email preview attached | |
| C1 | Access resolvers in `claim.ts`; `/account/memories`; signed-in share form; `ChangedVia.ACCOUNT`; header link | the claim suite runs under both resolvers; ownership tests | |

## Follow-ups (not in these PRs)

- **F1** Send an update to the list from `/admin`, with RFC 8058 one-click `List-Unsubscribe` and `List-Unsubscribe-Post` headers, SendGrid batching and a per-subscription unsubscribe link. Needed for the November 10 contributor email if that should go to subscribers, not just contributors.
- **F2** Cloudflare Turnstile on the footer and sign-in forms if A4's caps are not enough.
- **F3** Comments (Rob: not now). A `Comment` table keyed by `userId` and `memoryId`, verified users only, family approval like memories.
- **F4** Family admins sign in with `role = FAMILY_ADMIN` and retire `ADMIN_PAGE_SECRET`.
- **F5** SMS sign-in by verified phone (design doc), once the VoIP.ms line is in use.
