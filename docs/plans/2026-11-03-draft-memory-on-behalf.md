# Draft a memory on someone's behalf, then let them claim it

**Status:** approved by Rob in chat on 2026-11-04 ("go build this plan"); **built on branch `feat/draft-memory-on-behalf`** (worktree `/Users/rob/Documents/active_work/jowray_wt_draft_memory`) the same day. This repo copy is the live record; §2 says what has happened, §8.2 the rulings made during the build. No secret generated, no migration applied to any Neon branch, no Gmail draft created yet (see §2).
**Base:** `origin/main` at 1caf117 (2026-11-04), which includes #22 (claim remove/replace), #25 (derived web images) and #26 (admin alert). The plan was written against 079dfc2; §8.2 R1 covers what #26 changed.

---

## 0. Cold start (read this first if you are a resumed or new agent)

| Item | Value |
|---|---|
| Repo | `/Users/rob/Documents/active_work/jowray_com` (GitHub `RobertdWray/jowray_com`, private) |
| Base | `origin/main` at **1caf117** (2026-11-04; includes #22, #25, #26). Local `main` is stale; always start from `origin/main`, never local `main`. |
| Branch | `feat/draft-memory-on-behalf`, created from 1caf117 on 2026-11-04 |
| Worktree | `/Users/rob/Documents/active_work/jowray_wt_draft_memory` |
| PR | **#30** https://github.com/RobertdWray/jowray_com/pull/30 (draft; nothing merges without Rob's go-ahead). |
| Overlapping PR | **#22** merged 2026-11-03T21:42Z (1db03f6), so the "edit after #22" rule is satisfied. Open PRs #27, #28, #29 (multi-file memories, share cards) touch `create-memory.ts`, `claim.ts`, `confirm.ts`, `ingest-upload.ts` and the claim page too: whichever merges second rebases. |
| House rules | `AGENTS.md` (branch + PR for everything, no eslint-disable without "YES", no band-aids, no secrets in git, TDD on critical paths, Cache Components rules, layer import direction `app → features → services → integrations`). `docs/code-layout.md` has the long form. |
| Checks | `npm run validate`, `npm run test:run`, `npm run build:offline`; all three must pass with no `.env*` present. |
| Env on this machine | `.env` holds every project key (production Neon values from Vercel; `CONSENT_VERSION=2026-11-v1` there, see Ledger). `.env.local` overrides `DATABASE_URL` to the Neon **dev** branch `br-holy-rice-bbz4t50l` (host `ep-solitary-tree-bbnwysvl`). Next.js and `prisma.config.ts` read `.env.local`; `npx tsx --env-file=.env` does **not**, so a script run that way hits production. Never print values from either file. |
| Prod resources | Vercel `prj_UWoR1IGnShoagieZphn2aXOnGSfm` (team `rob-wrays-projects`); Neon project `icy-scene-20351172` (`main` = `br-restless-king-bbmkh5zd`, `dev` = `br-holy-rice-bbz4t50l`); Blob store `jowray-media`; SendGrid from `memories@jowray.com`; cron `*/10 * * * *` → `/api/cron/reconcile-uploads`; Sentry `med3ai/jowray_com`. Memorial slug `jo-wray`. |
| Skill location | repo `docs/skills/jowray-draft-memory/SKILL.md`, symlinked to `~/.claude/skills/jowray-draft-memory` (same pattern as `robwray-docs-publish`, which is a symlink into `Personal-doc-share/docs/skills/`). |
| Real people in play | Joyce Gilley `stsbmf2@gmail.com` (Gmail thread `1a1a2317fba34eec`, one message, same id). Bridget at Ticonderoga Methodist `timethodist@gmail.com` (thread `1a1a164305544897`, her message id `1a1a1ad3b27b64e4`, has an image attachment). **Do not create drafts, Gmail drafts, or press Share for either of them during development.** Use synthetic contributors (Rob's own addresses) until Rob says "run it for real". |

**If you are resuming mid-build (after a compaction or a hand-off):**
1. Read this file top to bottom; §1 tells you what is decided, §2 tells you what has already happened. Trust the §2 checks over any memory of progress.
2. In the worktree: `git status`, `git log --oneline origin/main..HEAD`, `git diff --stat origin/main` to see which §3 items exist. Compare against the Files list in §3.9. Run the three checks before writing anything new.
3. Re-read any §3 file before editing it, even one you believe you wrote.
4. Do not repeat an outside-effect step (secret, migration, Gmail draft, admin POST) without its §2 check.
5. If #22 merged while you were away, `git fetch` and merge or rebase onto `origin/main` before touching `claim.ts`, `confirm.ts`, the claim page or the cron route.
6. Who runs what: §4. If you are an Astra worker, your brief names your files; touch nothing else and commit nothing.
7. When something here turns out wrong, fix this plan first, then the code, and note it in §8.2 or §2.

## 1. Decisions already made: do not re-ask

**Rob decided (2026-11-03):**
1. Rob sends the link himself from Gmail. The skill drafts the reply; Rob reads and sends. The site never emails the link.
2. The memory text is a verbatim excerpt: only the sender's paragraphs about Jo, copied exactly. Claude proposes the cut, Rob approves before anything is saved. `contributorNote` stays "exactly as typed; never rewritten".
3. The skill reaches the database through an admin API on the site (bearer secret), via a small repo script. No production DB credentials in the skill.
4. An email address is required to draft. A text with no email is not drafted until Rob supplies one.
5. Quality over speed; "breeze through PR review"; four-bucket triage of reviewer findings with a parking lot.

**My calls, flagged for Rob's veto at plan approval (what, why, cost if wrong):**
- **New `MemoryStatus.DRAFT`.** Why: a drafted memory must be invisible and silent until its owner acts. Cost if wrong: an enum value we cannot remove without a migration; harmless if unused.
- **Share = consent.** Pressing **Share this memory** moves DRAFT → PENDING and stamps `consentedAt` + `consentVersion` (v2 implicit-consent model). `consentedAt` becomes nullable, guarded by a CHECK constraint. Why: the person never performed an act of sharing before that. Cost if wrong: a few rows with consent recorded at the wrong moment; fixable by revision history.
- **Admin-drafted memories never receive site email**, before or after Share. Why: Rob's reply is the only voice they hear; the existing confirmation says "stored exactly as you sent it", false for an excerpt; the cron's token rotation would kill the link Rob sent. A future "your story is posted" notice (does not exist yet) **does** honour `notifyWhenPosted`; only confirmations are suppressed. Cost if wrong: one email template variant later.
- **Reissue = deliberate revocation.** A second admin call rotates a DRAFT's token and returns a fresh link. "DRAFT" does **not** mean the old link was never opened (the person can add a photo and stay DRAFT), so the skill warns Rob that any link already sent stops working. Allowed only while DRAFT, with a conditional write.
- **One button on a draft's claim page: Share this memory.** No "save for later"; not ready means close the tab. The server still accepts a share-less edit on a DRAFT.
- **`sourceRef` is unique and never contains an address or number in clear.** Scheme in §3.
- **`EMAIL` and `OTHER` added to `MemorySource`** (`SMS` exists).
- **Roll forward only.** Once a DRAFT row exists in production, never roll back past this deploy (the old cron would email and rotate every draft within 30 minutes).
- **No in-browser recorder on the claim page in this change**; the file input already accepts audio files. Follow-up.
- **Email attachments are not ingested by the skill** (the Gmail connector cannot download them). The skill tells Rob when a note has one so he can add it through the claim link before sending.
- **Skill lives in the repo and is symlinked globally, with `disable-model-invocation: true`.** Why: versioned, reviewable, and a chat that mentions Jo cannot write to production by accident.

## 2. Progress ledger (idempotent done-checks; update as you go)

| Step | Done? | Check |
|---|---|---|
| Plan approved by Rob | **yes** (2026-11-04, chat: "go build this plan") | this file is on the branch |
| Citations step run | **yes** (2026-11-04) | §12 has no "ASSUMED" rows left except the Gmail probe part of [C11] |
| Premortem run and bucketed | **yes** (2026-11-04, fresh-context Opus agent on this plan; see §8.2) | §8.2 lists its findings |
| PR #22 merged | **yes** | `gh pr view 22 --json state` = MERGED (1db03f6, 2026-11-03T21:42Z) |
| Branch + worktree created from origin/main | **yes** | `git -C /Users/rob/Documents/active_work/jowray_wt_draft_memory log -1 --oneline` shows a commit on top of 1caf117 |
| Plan copied to `docs/plans/2026-11-03-draft-memory-on-behalf.md` | **yes** (fcf7fe7) | file exists on the branch |
| Migration A (enum values, nullable consent, sourceRef) written | **yes** | `ls prisma/migrations | grep draft_memories` → `20261104070000_draft_memories` |
| Migration B (CHECK constraint) written | **yes** | `ls prisma/migrations | grep consent_check` → `20261104070100_consent_check` |
| Migrations applied to a Neon **verification** branch only | **yes** (2026-11-04, `prisma migrate deploy`) | Branch `feat-draft-memory-verify` = `br-misty-bird-bbu404uq`, child of production `main`, endpoint `ep-tiny-credit-bb3uxpap`. Not the shared `dev` branch: `dev` already carries `20261104000000_submissions` and `20261103233000_media_words_lease` from open PRs (#27/#28), so its history differs from this branch (follow-up F8). `migrate status` with `.env.local` pointed at the verification branch: "Database schema is up to date!". **Production `main` also already has `20261103233000_media_words_lease`** (not on `origin/main`): flagged to Rob in PR #30. The branch can be deleted after merge (Rob's call; never by an agent). |
| Code + tests green | **yes** (2026-11-04: validate clean, 809 tests, offline build; see the PR) | the three checks pass with `.env*` absent from the worktree |
| Local end-to-end walk (§6 step 5) | **yes** (2026-11-04, against the verification branch, `next dev` with a throwaway `ADMIN_API_SECRET` and `ADMIN_ALERT_EMAILS=`) | wrong bearer 401; draft 200; same `sourceRef` 409 DRAFT with one Contributor; `http://www.jowray.com` refused by the script; DRAFT page rendered (heading, intro, checkboxes, Share); photo added → Media READY, `EmailLog` count 0; Share → PENDING, `consentedAt` set, revision shows `status`/`consentedAt`/`consentVersion`; reissue on the shared one → 409 `not_draft`; second draft reissued → old link renders the not-found page (streamed 200, F7), new link works; missing id → 404; cron with the two rows aged 31 min → `confirmationsSent: 0`, `EmailLog` count 0, both `claimTokenHash` unchanged. Memory ids on that branch: `c5265230-…` (shared), `1b5bd1f2-…` (draft, reissued). |
| `ADMIN_API_SECRET` in Vercel Production | no | `vercel env ls production \| grep -c ADMIN_API_SECRET` = 1 |
| `ADMIN_API_SECRET` in local `.env` | no | `grep -c '^ADMIN_API_SECRET=' .env` = 1 (never print the value) |
| `CONSENT_VERSION=2026-11-v2` in Vercel Production and `.env` | no | `vercel env ls production` shows it; `grep -c '^CONSENT_VERSION=2026-11-v2' .env` = 1 |
| Gmail threading probe done (draft reply to Rob's own message, then deleted) | **yes** (2026-11-04T12:15Z) | Connector account in this session: `rwray@tray-verify.com`. `create_draft` with `replyToMessageId` = message `1a10c465ac6230da` (a message Rob sent to himself and one other person), `to` = `["rwray@tray-verify.com"]`, explicit `Re:` subject → draft `r-4471266293683734600` landed in the **same thread** (`threadId` 1a10c465ac6230da), `to` was **exactly** the list given (the original's other recipient was **not** added), subject as given, the original quoted below the body. Deleted with `delete_draft` right after. So the skill must always set `to` explicitly (it does) and the subject is not inherited. **Note:** the Joyce/Bridget threads named in §0 live in whichever mailbox the planning session's connector was; check `authuser` in a `viewUrl` before the first real run. |
| Draft PR open, parking lot in notes | **yes** | `gh pr list --head feat/draft-memory-on-behalf` → #30 |
| `/team-code-review` on the PR, bucketed | no | §8 updated |
| Merged with Rob's go-ahead; production deploy carries both migrations | no | `vercel ls` latest READY; `prisma migrate status` against prod via a Rob-run command |
| First real run (Joyce) | no | `SELECT status FROM "Memory" WHERE "sourceRef" = 'gmail:1a1a2317fba34eec'` returns a row |
| Second real run (Bridget) | no | same for `gmail:1a1a1ad3b27b64e4` |

**Resume rule:** before repeating any step with an outside effect (secret, migration, Gmail draft, admin POST), run its check first. If a Gmail draft may already exist, `list_drafts` and look for one to that address in that thread before creating another. If a secret may already exist in either store, reconcile (copy the existing value to the other store) instead of generating a new one.

---

## 3. Context and design

Condolence notes are arriving in Rob's Gmail with real memories of Jo inside them. jowray.com already has a `Memory` row with a hashed claim token, a `/m/[claimToken]` page where a person edits their words and adds files, and an upload pipeline. Missing: a way for the family admin to create a memory **on a sender's behalf**, and a skill that drives it end to end.

### 3.1 Schema — two expand-only migrations [C1][C2]

Deploys run `prisma migrate deploy && prisma db seed && next build` (`vercel.json`), so every migration must be safe against the running app.

**Migration A** `prisma/migrations/20261104<HHMMSS>_draft_memories/` (timestamp must sort after `20261103210000` from #22):
- `ALTER TYPE "MemoryStatus" ADD VALUE 'DRAFT'` → enum `DRAFT PENDING APPROVED HIDDEN`.
- `ALTER TYPE "MemorySource" ADD VALUE 'EMAIL'`, `… 'OTHER'`.
- `ALTER TABLE "Memory" ALTER COLUMN "consentedAt" DROP NOT NULL`.
- `ALTER TABLE "Memory" ADD COLUMN "sourceRef" TEXT; CREATE UNIQUE INDEX "Memory_sourceRef_key" ON "Memory"("sourceRef")`.

**Migration B** `…_consent_check/`, a separate file because Postgres cannot reference a new enum value in the transaction that adds it [C2 ASSUMED → verify]:
- `ALTER TABLE "Memory" ADD CONSTRAINT "Memory_consent_when_not_draft" CHECK ("status" = 'DRAFT' OR "consentedAt" IS NOT NULL)`.

Schema comments: `consentedAt` "null only while status = DRAFT (CHECK constraint)"; `sourceRef` "opaque, unique reference to where the words came from; never an address or number in clear (see draft-memory.ts)".

**`sourceRef` scheme** (constant + builder in `lib/validations/memory.ts`, unit-tested):
- Gmail: `gmail:<Gmail message id>` of the **sender's message that contains the excerpt** (not the thread id; a `thread-f:` URL resolves to a thread, whose messages each carry their own id).
- Text message: `sms:<first 32 hex of sha256(E.164 number + "|" + ISO-8601 timestamp of the text)>`.
- Anything else: `other:<first 32 hex of sha256(lower-cased sender email + "|" + the full original message text)>`. Keyed on the original, not the excerpt, so an edited cut cannot create a second memory and two people's identical words cannot collide.

### 3.2 Feature `features/memories/draft-memory.ts` (new) [C3][C4]

`draftMemory(raw: unknown): Promise<DraftMemoryResult>`
- Input `draftMemoryInputSchema` (in `lib/validations/memory.ts`): `contributor { name?, email (required, valid), relationship?, phone? }`, `note` (1–10 000 chars, verbatim), `approxDateText?`, `place?`, `source: "EMAIL" | "SMS" | "OTHER"`, `sourceRef` (required, matches the scheme regex), `visibility` default `"PUBLIC"`.
- Transaction (reuse `TX_OPTIONS` and `withinBudget` from `create-memory.ts`; export them or lift into `features/memories/budget.ts`):
  1. `tx.memory.findUnique({ where: { sourceRef } })` → if found, return `{ ok: false, code: "duplicate", memoryId, status }` **before** writing anything (no orphan Contributor).
  2. `withinBudget(tx, 0, true)` → `budget_exceeded`.
  3. Memorial by `MEMORIAL_SLUG`; create `Contributor` (`contactOptIn: true` to match `/share`); create `Memory { type: TEXT, status: DRAFT, source, sourceRef, consentVersion: CONSENT_VERSION, consentedAt: null, claimTokenHash, visibility, contributorNote: note, notifyWhenPosted: true }`; append `MemoryRevision { changedVia: ADMIN, before: {}, after: { note, name, relationship, source, sourceRef } }`.
- **Race fallback outside the transaction:** catch Prisma `P2002` (check `error.code === "P2002"` only; with the Neon driver adapter `meta.target` is not reliable [C4 ASSUMED → verify]), then `getDb().memory.findUnique({ where: { sourceRef } })` and return `duplicate`; rethrow if no row matches. Never catch inside the callback: Postgres aborts the transaction after a failed insert, so a lookup through `tx` fails with `25P02` [C5].
- Returns `{ ok: true, memoryId, claimToken, claimLink }` (link from `getSiteUrl()`), or `{ ok: false, code: "invalid" | "duplicate" | "budget_exceeded", memoryId?, status? }`.

`reissueDraftClaimLink({ memoryId })`:
- Mint a token; `tx.memory.updateMany({ where: { id, status: "DRAFT", deletedAt: null }, data: { claimTokenHash } })`; if `count === 0` re-read to answer `not_found` or `not_draft`; else append `MemoryRevision { changedVia: ADMIN, before: {}, after: { claimLinkReissued: true } }`. Returns `{ ok: true, claimLink }` or `{ ok: false, code }`. Log `action: "draft_link_reissued"`, ids only.

### 3.3 Admin routes [C6]

- `app/api/admin/memories/route.ts`: `POST`. First statement reads `request.headers` (Cache Components rule). Auth like the cron route: `getAdminEnv().ADMIN_API_SECRET`, `safeEqualHex(authorization, \`Bearer ${secret}\`)`, 401 when unset or wrong. Body → `draftMemory()`. 200 `{ success: true, data: { memoryId, claimLink } }`; 400 `invalid`; 409 `duplicate` with `{ memoryId, status }`; 429 `budget_exceeded`.
- `app/api/admin/memories/[id]/claim-link/route.ts`: `POST`, same auth → `reissueDraftClaimLink()`. 200 `{ claimLink }`, 404 `not_found`, 409 `not_draft`.
- `maxDuration = 30` on both. Responses follow the `{ success, data } | { error: { code, message } }` house shape.
- Env: `adminSchema { ADMIN_API_SECRET: z.string().min(32).optional() }`, `getAdminEnv` in `server/config/env.ts`; row in `docs/environment.md`.

### 3.4 Claim page learns about drafts [C7]

`features/memories/claim.ts` (**edit only after #22 is merged; re-read the file first**, it now takes a memory lock and re-reads under it):
- `ClaimView` gains `status`, `notifyWhenPosted`, `contributor.contactOptIn`.
- `claimChangesSchema` gains `share?: boolean`, `notifyWhenPosted?: boolean`, `contactOptIn?: boolean`.
- In `updateMemoryFromClaim`, under the existing lock: when `fresh.status === "DRAFT" && share === true`, also set `status: PENDING`, `consentedAt: new Date()`, `consentVersion: getMemorialEnv().CONSENT_VERSION`; the revision's `after` records both. A DRAFT without `share` stays DRAFT. `share` on a non-DRAFT is ignored, so a repeated Share never restamps consent. Result gains `shared: boolean`. No email call.

`app/m/[claimToken]/page.tsx` + `claim-form.tsx`:
- Move the `<h1>` inside `ClaimContent` so it can depend on status.
- DRAFT: heading "A memory of Jo, in your words"; intro "Rob saved these words from your note so they can be part of Jo's memorial. Change anything you like, add a photo or a recording, then press Share."; single button **Share this memory** (sends `share: true`); `IMPLICIT_CONSENT_NOTE` under it; checkboxes `NOTIFY_WHEN_POSTED_LABEL` and `CONTACT_OPT_IN_LABEL` prefilled (both on). After Share the page re-renders in the PENDING state with "Thank you. Your memory is with the family."
- PENDING and later: unchanged.

### 3.5 Drafts stay silent [C8]

- `features/memories/confirm.ts`: export `siteEmailsConfirmation(memory)` = `status !== "DRAFT" && source === "WEB_UPLOAD"`, plus its Prisma `where` fragment `SITE_EMAIL_WHERE = { status: { not: "DRAFT" }, source: "WEB_UPLOAD" }`. `confirmMemory` returns `{ sent: false, skipped: "no_site_email" }` when the predicate is false, before any send. Covers `finalizeUpload → confirmQuietly` whenever a file is added.
- Cron step (e) in `app/api/cron/reconcile-uploads/route.ts`: spread `SITE_EMAIL_WHERE` into the `unconfirmed` query, so the cron never emails these memories nor rotates their token.

### 3.6 Repo script `scripts/draft-memory.ts` (new) [C9]

- `npx tsx --env-file=/Users/rob/Documents/active_work/jowray_com/.env /Users/rob/Documents/active_work/jowray_com/scripts/draft-memory.ts --input <json-file> | --reissue <memoryId>`.
- Reads `ADMIN_API_SECRET` and `ADMIN_API_URL` from env. `ADMIN_API_URL` defaults to `https://www.jowray.com`; the script prints the **host only** before every call, refuses `http:` except loopback, and uses `fetch(..., { redirect: "error" })` (the apex 308s to `www`, and a cross-origin redirect drops `Authorization`, which would surface as a confusing 401 [C10 ASSUMED → verify]).
- Prints `memoryId` + `claimLink` on 200, `memoryId` + `status` on 409, a clear message otherwise. The secret never appears in argv or output. No `server-only` imports (pure module, like `scripts/send-test-email.ts`).

### 3.7 The skill `docs/skills/jowray-draft-memory/SKILL.md` (new) [C11]

Frontmatter: `name: jowray-draft-memory`, `disable-model-invocation: true`, description "Turns a condolence email, text message or other note that mentions Jo into a DRAFT memory on jowray.com and drafts Rob's Gmail reply carrying the claim link. Requires the Gmail connector and the jowray_com repo on this machine." Prerequisites section: the repo path, `.env` with `ADMIN_API_SECRET`, Node 20+, the Gmail connector.

Procedure:
1. **Resolve the source.** Gmail popout URL with `thread-f:<decimal>` → `printf '%x'` → `get_thread(threadId, messageFormat: "PLAIN_TEXT")`; pick the sender's message (not Rob's) and keep **its** `id`. `thread-a:r…` cannot be converted → `search_threads` by sender and subject Rob gives; if nothing matches, ask Rob to paste the message. Pasted text/SMS → use as given; ask for sender name and email if missing (email is required).
2. **Propose the excerpt.** Show Rob: sender name, email, suggested relationship with no street or unit details ("Neighbor at Broadmead", never an apartment number: the field defaults to PUBLIC), the verbatim paragraphs about Jo (drop logistics, greetings, Dad's health, quoted earlier mail), optional `approxDateText` / `place` only if stated, and whether the message has attachments. Wait for Rob's yes or edits. Never paraphrase.
3. **Save the draft.** Build `sourceRef` by the scheme; write the JSON to the scratchpad; run the script; read `claimLink`; delete the JSON. On 409 DRAFT: offer `--reissue`, warning that any link already sent stops working. On 409 PENDING or later: the person already shared it; stop.
4. **Draft Rob's reply.** `list_drafts` first; if a draft to this address in this thread exists, show it and stop. Else `create_draft` with `replyToMessageId` = the sender's message id, `to` = **the sender only** (never reply-all; `cc` empty), `subject` = `Re: <original>`. Voice: short, warm, first person, thank them for the specific memory, one line that it is saved to Jo's memorial in their words, the link, "change anything, add a photo or a recording, and press Share when it's right", and a clean exit ("no need to do anything if you'd rather not"). Never grovel, never quote their note back at length, never include anyone's phone number. Mention the attachment if there is one.
5. **Report**: the Gmail draft `viewUrl`, the claim link (bearer token: anyone with it can edit), and the reminder that nothing is public until the person presses Share.

Symlink: `ln -s /Users/rob/Documents/active_work/jowray_com/docs/skills/jowray-draft-memory ~/.claude/skills/jowray-draft-memory`. Add the skill to the README's Project docs list.

### 3.8 Tests (TDD; Vitest, Prisma stubbed in memory as in `__tests__/features/claim.test.ts`)

- `__tests__/features/draft-memory.test.ts`: creates Contributor + DRAFT + ADMIN revision with `consentedAt: null`; rejects missing email / empty note / bad `sourceRef`; pre-check duplicate → `duplicate` with id and status and **no Contributor created**; P2002 fallback (stub throws `{ code: "P2002" }` with no `meta.target`) → `duplicate`; budget refusal; `reissueDraftClaimLink` rotates and appends a revision for DRAFT, `not_draft` for PENDING, `not_found` for missing/deleted, and the `count === 0` path.
- `__tests__/api/admin-memories.test.ts`: both routes: 401 unset / wrong / missing bearer; 200 shape; 400; 409 with `status`; 404; 429.
- `__tests__/features/claim.test.ts`: DRAFT + `share` → PENDING, `consentedAt` set, `consentVersion` from env, revision records both, no email; DRAFT without `share` stays DRAFT; PENDING + `share` leaves `consentedAt` unchanged (no restamp); preference checkboxes persist.
- `__tests__/features/confirm.test.ts`: DRAFT → `skipped: "no_site_email"`; PENDING with `source: EMAIL` → same; transport not called.
- `__tests__/api/reconcile.test.ts`: step (e) `where` contains `SITE_EMAIL_WHERE`.
- `__tests__/lib/validations-memory.test.ts`: `draftMemoryInputSchema` and the `sourceRef` builders (gmail / sms / other; sms and other contain no raw number or address).

---

### 3.9 Files

New: `features/memories/draft-memory.ts`, `app/api/admin/memories/route.ts`, `app/api/admin/memories/[id]/claim-link/route.ts`, `scripts/draft-memory.ts`, `prisma/migrations/<ts>_draft_memories/`, `prisma/migrations/<ts>_consent_check/`, `docs/skills/jowray-draft-memory/SKILL.md` (+ symlink in `~/.claude/skills/`), `docs/plans/2026-11-03-draft-memory-on-behalf.md` (this plan), tests in §3.8.
Modified: `prisma/schema.prisma`, `server/config/env.ts`, `lib/validations/memory.ts`, `features/memories/claim.ts`, `features/memories/confirm.ts`, `features/memories/create-memory.ts` (export `withinBudget`/`TX_OPTIONS` or move them), `app/m/[claimToken]/page.tsx`, `app/m/[claimToken]/claim-form.tsx`, `app/api/cron/reconcile-uploads/route.ts`, `docs/environment.md`, `README.md`.
Reuse, do not reinvent: `hashClaimToken` / `newClaimToken` / `safeEqualHex` (`lib/claim-token.ts`), `getSiteUrl` (`lib/site-url.ts`), `confirmQuietly` is **not** called by this feature, `IMPLICIT_CONSENT_NOTE` and the three labels (`lib/consent.ts`), `PrimaryButton` and field classes (`app/_components`), `lockMemory` (`features/memories/lock.ts`, arrives with #22), `createLogger` (`lib/logger`).

## 4. Who does what

| Task | Owner | Why |
|---|---|---|
| Plan, citations, bucket sorting, premortem triage | Fable 5.1 (this session) | judgment-heavy |
| Migrations A + B, schema comments | Astra worker | mechanical, one owner for `prisma/**` |
| `lib/validations/memory.ts` additions + `sourceRef` builders + their tests | Astra worker | self-contained, one owner |
| `scripts/draft-memory.ts` | Astra worker | pure module, spec above is complete |
| `server/config/env.ts` admin sub-schema + `docs/environment.md` row | Astra worker | small, isolated |
| `features/memories/draft-memory.ts` + tests | Orchestrator (linear) | transaction semantics, P2002 handling |
| Admin routes + tests | Orchestrator (linear), after the feature | depends on the feature |
| `claim.ts`, `page.tsx`, `claim-form.tsx` | Orchestrator (linear), **after #22 merges** | deep context, overlaps #22 |
| `confirm.ts` predicate + cron step (e) + tests | Orchestrator (linear), after #22 merges | overlaps #22 |
| SKILL.md + symlink + README line | Orchestrator (linear) | Rob's voice |
| Premortem and PR review | `/team-code-review` (George + Oscar) | fixed by the skill |
| Secrets, Vercel env, merge, first real runs | Rob | outside effects |

Astra workers: two at a time, one owner per file, no network. Orchestrator model: Rob's pick (Opus 5.5 by default per `docs/workflows/orchestration.md` in the scoring repo); Fable returns for bucket sorting after each review.

## 5. Rules for this work

- Start from `origin/main`; re-read every function immediately before editing it (five of the touched files changed in #20, #21, #23 and will change again in #22).
- One worktree for this branch; never run `prisma migrate dev` while the checkout's `.env.local` points anywhere but the intended dev branch; check the host first. **Never accept a `migrate dev` reset.** Never delete or recreate remote resources (Neon branches, Blob stores, Vercel env).
- Expand-only migrations; timestamps sort after existing ones; regenerate the SQL against the rebased baseline.
- Roll forward only once a DRAFT row exists in production.
- Secrets: generate into a mode-600 file and pipe into `vercel env add ADMIN_API_SECRET production < file`; set Vercel env **before** merging (env changes reach only new deployments) or redeploy after. Check both stores before generating.
- Synthetic contributors only during development; no agent presses Share on a real person's link.
- Accuracy over speed. Nothing merges without Rob's go-ahead.

## 6. Rollout

1. **Citations step** (Fable): resolve every `ASSUMED` row in §12 against current docs; fix the plan where an assumption fails.
2. **Premortem**: `/team-code-review` on this plan with `premortum.md` ("this shipped and failed; what happened?"); sort findings into the four buckets (§8); buckets 1 and 2 into the plan.
3. Wait for **#22** to merge (or ask Rob).
4. Branch + worktree from `origin/main`; commit the plan copy; dispatch the Astra tasks; run the linear tasks.
5. Checks green with `.env*` moved aside. Local end-to-end on the dev Neon branch with `ADMIN_API_URL=http://localhost:3000` set explicitly: migrate (status check first), `next dev`, post a draft for a synthetic contributor, open the link, add a photo (assert `skipped: "no_site_email"` in the log and **no `EmailLog` row**, not merely "outbound disabled"), press Share, assert status PENDING + consent stamped, press Share again (no restamp), `--reissue` on a fresh draft (old link 404s, new works), `--reissue` on the shared one → `not_draft`, double-post the same `sourceRef` → 409 and no second Contributor. Run the cron locally with the bearer against a 31-minute-old DRAFT with an email and a PENDING `source: EMAIL` memory: no `EmailLog`, hashes unchanged.
6. **Gmail probe**: `create_draft` with `replyToMessageId` on a message in Rob's own mailbox; confirm threading, subject and sender-only `to`; delete the draft; record in the ledger.
7. Draft PR whose description carries §10 (non-goals) and §11 (follow-ups) verbatim, after the summary and test plan. `/team-code-review`; bucket the findings (§8.2); fix buckets 1 and 2 in the same session; route 3 and 4 into §10 and §11 and update the PR description.
8. **Rob**: `ADMIN_API_SECRET` and `CONSENT_VERSION=2026-11-v2` in Vercel Production and `.env` (ledger checks), then merge. Confirm the deploy applied both migrations.
9. First real run: Joyce (single message, `thread-f`), Rob sends the reply, watch DRAFT → PENDING. Then Bridget (reply inside Rob's own thread; has an attachment).

## 7. Verification summary

Unit tests in §3.8; the manual walk in §6 step 5; the Gmail probe in step 6; security: wrong bearer → 401, a DRAFT claim link shows the editor and nothing else on the site reads DRAFT rows (nothing lists memories yet).

---

## 8. Parking lot and reviewer triage

### 8.1 Friend's 27 findings (George, Oscar, Claude), sorted — **Rob confirmed 2026-11-04: buckets 1 and 2 are in scope**

**Bucket 1 · Must do (in the plan above)**
- #1 / #12 duplicate handling: pre-check inside the tx, P2002 fallback outside it, `status` in the result, no orphan Contributor (§3.2, tests).
- #3 / #14 / #16 cold start, decisions list, progress ledger, "what — why — cost if wrong", `[C#]` tags and Citations (§0–2, §9). Rob asked for this directly.
- #4 / #10 roll-forward rule once a DRAFT exists (§1, §5).
- #6 / #21 Gmail: `sourceRef` pins the sender's **message** id; `to` = sender only, never reply-all; delete the scratch JSON; one threading probe; fallback when a popout URL cannot be resolved (§3.1, §3.7, §6).
- #7 / #17 / #18 secrets and transport: set env before merge or redeploy; secret via mode-600 file; reconcile before regenerating; `redirect: "error"`; https except loopback; explicit target in verification; print host only (§3.6, §5, §6).
- #8 / #22 skill in the repo with a global symlink, `disable-model-invocation: true`, absolute paths, prerequisites listed (§3.7).
- #11 / #25 base on `origin/main` (079dfc2), merge order #22 first, re-read before editing, migration timestamp after `20261103210000` (§0, §5).
- #13 reissue is deliberate revocation; conditional `updateMany` on `status`, `deletedAt`; rationale corrected (§1, §3.2).
- #15 resume safety: `list_drafts` before `create_draft`; synthetic contributors; nobody presses Share on a real link (§3.7, §5).
- #19 / #5 `sourceRef` for OTHER keyed on sender + original text, not the excerpt; SMS hashed, no number in clear (§3.1).
- #20 the contradictory "Apt. F2" example removed (§3.7).
- #23 (test part) repeated Share does not restamp consent (§3.8).
- #24 recorded policy: suppress confirmations only; a future "posted" notice honours `notifyWhenPosted`; checkbox stays (§1).
- #27 local check asserts `skipped: "no_site_email"` and no `EmailLog` row (§6).
- #26, corrected: the follow-up line now reads "SMS inbound (deferred; vendor undecided, VoIP.ms account kept)". The friend's claim that VoIP.ms was "ruled out" is not what the ledger says; the ruling is "deferred, too complex for now" and the plan explicitly declines to record it as the wrong vendor.
- #2 / #9 (rule part): check `.env.local` host before every migrate; never accept a reset; never delete or recreate remote resources (§5).

**Bucket 2 · Nice to do (in the plan; Rob approved 2026-11-04)**
- #23 CHECK constraint `status = 'DRAFT' OR consentedAt IS NOT NULL` as Migration B (§3.1). Cheap, restores the database guarantee.
- #2 / #9 (resource part): a dedicated Neon child branch for this feature's local verification, with branch and endpoint ids recorded in the ledger. The shared `dev` branch works if #22 merges first and its migration is applied there.
- #1 live double-post check against the dev Neon branch during the manual walk (§6 step 5), not in the test suite.
- #13 a unit test of the `count === 0` path stands in for a concurrent Share-vs-reissue test.

**Bucket 3 · Don't do** → written up as non-goals in **§10**, with reasons. Copy §10 into the PR description.

**Bucket 4 · Real, but out of scope** → written up as follow-ups in **§11**, each with a severity and a pickup note. Copy §11 to the end of the PR description; file the medium and high ones as issues after merge.

### 8.2 Rulings made during the build (2026-11-04), premortem and PR-review findings

Each ruling: what — why — cost if wrong.

- **R1 · Admin alert (PR #26, merged after this plan was written).** `notifyAdminsOfMemory` now returns `skipped: "draft"` for a DRAFT and cron step (e2) excludes DRAFT rows (`ADMIN_ALERT_WHERE`); once the person presses Share the memory is PENDING and the cron alerts the admins within one run (≤ 10 min). No request-path alert on Share — why: the cron already covers it, and wiring `notifyAdminsQuietly` into `claim.ts` would pull the storage and email graph into the claim feature for a ten-minute gain. Cost if wrong: Rob learns of a Share up to ten minutes late; the alert's "submitted at" shows the draft time, not the Share time (deferred minor).
- **R2 · The site-email predicates live in `features/memories/site-email.ts`,** not in `confirm.ts` as §3.5 said — why: the cron test mocks `@/features/memories/confirm` wholesale, so a constant exported from there would be `undefined` inside the route under test; a leaf module keeps the predicate testable from both sides. Cost if wrong: one extra small file.
- **R3 · `sourceRef` builders live in `lib/source-ref.ts`** (node:crypto), with only the regex and the zod schema in `lib/validations/memory.ts` — why: validations stay a pure zod module that could be bundled for the client. Cost if wrong: one import path in the skill doc.
- **R4 · `reissueDraftClaimLink` takes `raw: unknown` and validates `{ memoryId: uuid }`** (new `reissueClaimLinkSchema`), answering `invalid` → 400 from the route — why: the id comes from a URL segment and the house rule is "route handlers validate input with zod". Cost if wrong: none.
- **R5 · The admin bearer check is a shared helper `app/api/admin/_auth.ts`** used by both routes — why: one copy of the fail-closed, constant-time check. Cost if wrong: none.
- **R6 · Share stores both preferences and records them in the revision** (`notifyWhenPosted`, `contactOptIn` in `before`/`after`), and `before`/`after` carry `status` and `consentedAt` only when a Share happens — why: ordinary edits keep their compact snapshots; the Share revision shows the transition. Cost if wrong: revision JSON shape, read by nothing yet.
- **R7 · Astra workers not dispatched; built inline by Fable** — why: Rob's instruction was "go build this plan", the mechanical pieces were small, and the plan's §4 split was advisory. Cost if wrong: none to the code.
- **R8 · The premortem ran as a fresh-context Opus agent on this plan file,** not `/team-code-review` with `premortum.md` — why: no `premortum.md` exists on this machine (searched `~/.claude` and `~/.claude-shared-skills`); the plan already carried a 27-finding George/Oscar/Claude review; the PR-level `/team-code-review` (rollout step 7) is the external pass. Cost if wrong: one fewer external voice on the plan before code existed.
- **R9 · Test fixtures for `Memory` rows now carry `status` and `source`** (`confirm`, `notify-admins`, `reconcile` tests) because the predicates read them; the reconcile stub defaults every fixture to a /share memory. Cost if wrong: none.

**Premortem findings (fresh-context agent, 2026-11-04)** are listed below once received, sorted into the four buckets.


---

## 10. Non-goals: what this change deliberately does not do, and why

Reviewers: these were considered and declined. Please do not re-raise them unless the reason below is wrong.

**Product**
- **No AI rewriting of anyone's words.** The memory text is a verbatim excerpt the sender can edit. `contributorNote` is "exactly as typed; never rewritten" (schema). A polished draft would stop being theirs.
- **No site-sent invitation email, and no site email at all for admin-drafted memories.** Rob's Gmail reply is the only message (Rob's decision). The existing confirmation ("stored exactly as you sent it") would be false for an excerpt, and the cron's token rotation would break the link Rob sent.
- **No phone-only drafts.** An email address is required (Rob's decision). SMS sending is not built; VoIP.ms is deferred, not chosen or rejected.
- **No "save for later" button on a draft's claim page.** One button, Share. A person who is not ready closes the tab; the server still accepts a share-less edit for API completeness.
- **No in-browser recorder on the claim page.** The file input already accepts audio files. Follow-up F4.
- **No automatic ingestion of email attachments.** The Gmail connector cannot download them. The skill flags attachments so Rob can add them through the claim link. Follow-up F5.
- **No admin UI, no listing of drafts.** Rob watches rows in Prisma Studio or the Neon console, as for every other memory in Phase 1. Follow-up F2.
- **No removal of the `notifyWhenPosted` checkbox** (friend #24 option 2). The preference is real and the future posted-notice honours it; only confirmations are suppressed.

**Engineering**
- **No two-PR rollout** (cron exclusion shipped first, friend #10 option 1). Drafts exist only after Rob runs the skill, which is after this deploy; the roll-forward rule in §5 covers the window. Two PRs doubles review for no added safety.
- **No local ledger file of contributors, memory ids and Gmail draft ids** (friend #15). It would hold names and emails outside the redacted logger and the git-ignored env. The `Memory` row (`sourceRef`, `status`) and Gmail's own drafts are the record; the resume rule in §2 reads them.
- **No live-database or concurrency tests in the Vitest suite** (friend #1, #12, #13). The suite runs with no `DATABASE_URL` by house rule (`AGENTS.md`); uniqueness and the conditional writes are asserted at the unit level and exercised once by hand in rollout step 5.
- **No reliance on Prisma's `meta.target`** for the P2002 branch. The code checks `error.code` only.
- **No new email template or `EmailType`.** Nothing is sent, so nothing is rendered.
- **No change to the `Media` upload path, tickets or finalize.** The claim page's existing "add a file" flow is reused as is.
- **No issue-writer subagents or multi-cycle repair loop** from the scoring repo's orchestration. One `/team-code-review` pass and one fix pass in the PR; a second only if the first finds something severe.
- **Not recording "VoIP.ms is the wrong vendor"** (friend #26 as written). The ledger's ruling is "deferred, too complex for now; account kept".

## 11. Follow-ups: real, out of scope here

Severity: **H** = affects correctness or privacy today; **M** = affects the product soon; **L** = nice to have. Copy this table to the end of the PR description; file H and M as GitHub issues in `RobertdWray/jowray_com` after merge.

| # | Item | Sev | What another agent needs to pick it up |
|---|---|---|---|
| F1 | Logger does not redact `MemoryRevision.before/after` JSON or `sourceRef` (friend #5) | M | `lib/logger/logger.ts` redacts named top-level keys only. Audit every `log.*` call that could carry a revision or Prisma row; add paths or stop logging the object. Test in `__tests__/lib/logger.test.ts`. Today nothing logs those objects, so no leak is known. |
| F2 | Admin view of DRAFT rows: who was drafted, who pressed Share, nudge the rest | M | Phase 3 scope (design doc "Manage"). Needs auth first (Auth.js magic link, `AUTH_SECRET` placeholder exists). Query: `Memory where status = DRAFT` joined to `Contributor`. Until then: Prisma Studio. |
| F3 | "Your story is posted" notice; `notifyWhenPosted` is stored but nothing sends it | M | New `EmailType` (`MEMORY_POSTED`), a template in `services/email/templates/`, a trigger when `status` becomes `APPROVED`. Must honour `notifyWhenPosted` and the per-recipient cap; admin-drafted memories **are** eligible (§1 policy). |
| F4 | In-browser recorder on the claim page | L | Import `AudioRecorder` and `pickRecordingType` from `app/share/recorder.ts`; follow the integration in `app/share/share-form.tsx` (meter, permission help, release on unmount, PR #21). Upload through the existing ticket flow with `contentType` set. |
| F5 | Ingest email attachments into the draft automatically | L | Blocked on a Gmail tool that returns attachment bytes. When available: download to the scratchpad, mint a ticket via the admin API (new endpoint) or reuse the claim-link upload with the raw token, finalize, delete the local file. |
| F6 | `ClaimView` sends the contributor's email to the client although the form never shows it (Phase 1 ledger) | L | Drop `email` from the `select` in `getMemoryForClaim` and from `ClaimView`; update `__tests__/features/claim.test.ts`. |
| F7 | A wrong claim token answers 200 with a not-found body (Phase 1 ledger) | L | `app/m/[claimToken]/page.tsx` calls `notFound()` inside `<Suspense>`, which streams a 200. Either move the lookup before the shell or accept it (bearer tokens; enumeration is infeasible at 256 bits). Decide, then record. |
| F8 | One shared `.env.local` across worktrees: every checkout migrates the same dev Neon branch (friend #2) | M | Repo workflow fix: per-worktree `.env.local` from a template, or a `DATABASE_URL` guard in `prisma.config.ts` that refuses to run against a branch not named in an allowlist. Document in `docs/environment.md`. |
| F9 | SMS inbound: `draftMemory()` with `source: SMS` from a webhook | L | Deferred until a vendor is chosen (VoIP.ms account kept, not selected). Requirements already written in the Phase 1 plan §9: idempotent on message id, STOP/HELP handling before any model, outbox with atomic claim, 10DLC. |
| F10 | Draft expiry or cleanup for memories nobody ever shares | L | Decide a policy (keep forever vs soft-delete after N months with Rob's say-so). A cron step (g) over `status = DRAFT AND createdAt < now - N`. Not urgent: drafts are invisible and cost nothing. |

---

## 12. Citations

Each: Relevant File(s) · Change Summary · Source · Verbatim quote · Justification · **VERIFIED / ASSUMED**. The citations step (rollout 1) resolves every ASSUMED row before building. Section order of this document: 0 cold start · 1 decisions · 2 ledger · 3 design · 4 who does what · 5 rules · 6 rollout · 7 verification · 8 triage · 10 non-goals · 11 follow-ups · 12 citations.

**[C1] Deploy runs migrations on every build — VERIFIED (repo)**
`vercel.json`; migrations must be expand-only · `"buildCommand": "npx prisma migrate deploy && npx prisma db seed && npm run build"` (per Phase 1 plan Task 3 step 8, which also says every migration must be backward-compatible) · Why: the running app and the new schema overlap during a deploy.

**[C2] `ALTER TYPE … ADD VALUE` and using the new value in the same transaction — VERIFIED (2026-11-04)**
Migrations A/B split · Postgres commit 15bc038f9 (shipped in 12) relaxed "ADD VALUE cannot run inside a transaction block" to: the new value "cannot be used until the transaction has been committed" (SQLSTATE 55P04 `unsafe use of new value`) · Prisma's own reference (`docs/reference/postgres-native-enums.md`): "You can't add a value and use it in the same transaction. `ALTER TYPE ... ADD VALUE` is special-cased: the new value isn't usable until the transaction that adds it commits … So a migration can't add an enum value and apply the changes that depend on it as one atomic step" · Prisma Migrate sends each `migration.sql` as one script; Postgres runs a multi-statement simple-query string as one implicit transaction · Why: the CHECK that names `'DRAFT'` must be its own migration. Sources: https://www.postgresql.org/message-id/E1Tesj1-00081a-Kc@gemulon.postgresql.org, https://github.com/prisma/prisma/blob/00ae8e2e31be324e13b717152e4aacdb18ca4e5c/docs/reference/postgres-native-enums.md. Confirmed empirically when `migrate deploy` runs on the dev branch (§2).

**[C3] Existing create path to mirror — VERIFIED (repo)**
`features/memories/create-memory.ts` · `draftMemory` mirrors it · "Create a memory from the /share form: a new Contributor for this submission (never matched to an existing one by unverified email), a PENDING Memory with a fresh claim token (stored hashed) … Everything happens in one transaction behind the daily budgets." · Why: same invariants (one Contributor per submission, hashed token, budgets).

**[C4] Prisma P2002 shape with the Neon driver adapter — VERIFIED (2026-11-04, installed runtime)**
`draft-memory.ts` catch · `node_modules/@prisma/client/runtime/client.mjs` (7.10.1): `case"UniqueConstraintViolation":return"P2002"` and the error is built as `new K(message, code, { driverAdapterError: e, table? })`: `meta` holds `driverAdapterError` and optionally `table`, never `target` · Why: the code checks `error.code === "P2002"` only, then re-reads by `sourceRef` outside the transaction.

**[C5] Postgres aborts the transaction after a failed statement — VERIFIED (standard behaviour; cite in step 1)**
`draft-memory.ts` · SQLSTATE `25P02 in_failed_sql_transaction`: "current transaction is aborted, commands ignored until end of transaction block" · Why: the P2002 catch must sit outside `$transaction`.

**[C6] Bearer auth pattern to copy — VERIFIED (repo)**
`app/api/cron/reconcile-uploads/route.ts` · "const authorization = request.headers.get("authorization") ?? ""; const secret = getCronEnv().CRON_SECRET; if (!secret || !safeEqualHex(authorization, `Bearer ${secret}`)) { return NextResponse.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 }); }" · Why: same fail-closed, constant-time check; AGENTS.md: "a GET handler reads request.headers or request.nextUrl first".

**[C7] Claim page request-time rule — VERIFIED (repo)**
`app/m/[claimToken]/page.tsx`, AGENTS.md · "The first thing a dynamic page component does is `await connection()` … `await params` by itself is not enough: a runtime prefetch prerender knows the URL, and the Neon driver's `randomBytes` on connect then fails the prerender (seen on `/m/[claimToken]`, 2026-11-03)." · Why: the moved `<h1>` and status branch must stay inside `ClaimContent`.

**[C8] Cron step (e) rotates tokens — VERIFIED (repo)**
`features/memories/confirm.ts` · "The reconcile cron has only the hash, so when `claimToken` is omitted the token is rotated: a fresh one is minted, the email carries the new link, and its hash replaces the old one in the same transaction that records SENT." · Why: drafts must be excluded or Rob's hand-sent link dies.

**[C9] Script conventions — VERIFIED (repo)**
`scripts/send-test-email.ts`, `eslint.config.mjs` · scripts run as `npx tsx --env-file=.env scripts/<x>.ts`, import nothing guarded by `server-only`, console allowed only in `scripts/**` and `prisma/**` · Why: the new script follows the same shape.

**[C10] fetch drops Authorization on cross-origin redirect — VERIFIED (2026-11-04)**
`scripts/draft-memory.ts` `redirect: "error"` · WHATWG Fetch PR #1544 (merged 2022-11-25): a script-supplied `Authorization` value does not survive a redirect chain that crosses origins; undici implemented it the same day (and CVE-2023-45143 / CVE-2024-30260 closed the Cookie and `undici.request()` gaps) · `docs/domain.md`: "`https://jowray.com` | 308 to `https://www.jowray.com`" · Why: a call to the apex would redirect and lose the bearer, surfacing as a confusing 401; the script refuses redirects and defaults to `www`. Source: https://github.com/whatwg/fetch/pull/1544.

**[C11] Gmail connector parameters — VERIFIED (live tool schema, this session)**
SKILL.md · `get_thread` takes `threadId`, `messageFormat` ("We recommend using `PLAIN_TEXT`"); each message carries its own `id` and `viewUrl`; `create_draft`: "If the draft is created as a reply to an existing message, the ID of the original message should be passed to the tool in the `replyToMessageId` field … Returns a Draft object with the `id`, `threadId`, and `viewUrl` fields populated." · Why: threading and ids as the skill uses them. Still ASSUMED: that `replyToMessageId` does not fill `to` (so the skill always sets `to` explicitly) and the resulting subject; the rollout probe settles both.

**[C12] Skill frontmatter `disable-model-invocation` — VERIFIED (local examples)**
SKILL.md · `~/.claude/skills/goteam/SKILL.md` and `sprint-planner/SKILL.md` carry `disable-model-invocation: true` · Why: prevents automatic invocation from a chat that mentions Jo.

**[C13] Skill symlink pattern — VERIFIED (filesystem)**
`~/.claude/skills/robwray-docs-publish -> /Users/rob/Documents/active_work/Personal-doc-share/docs/skills/robwray-docs-publish` · Why: the repo-plus-symlink layout is Rob's existing convention.

**[C14] Consent model — VERIFIED (repo)**
`lib/consent.ts`, `docs/consent/2026-11-v2.md` · "Consent is implicit for this friends-and-family memorial (Rob, 2026-11-03): sharing a memory means the family may keep it and show it within the memorial … No consent checkbox is shown" · Why: the Share press is the act of sharing for a drafted memory; `IMPLICIT_CONSENT_NOTE` sits under the button.

**[C15] Open PR #22 and moved base — VERIFIED (git/gh, 2026-11-03)**
`origin/main` = 079dfc2; `gh pr list` shows #22 `feat/claim-remove-replace` touching the files named in §0; its migration is `20261103210000_media_soft_delete`; its `claim.ts` adds `lockMemory(tx, memory.id)` and a re-read under the lock · Why: merge order and the "edit after #22" rule.

**[C16] VoIP.ms ruling — VERIFIED (repo)**
`docs/plans/phase1-ledger.md` · "Phone line (VoIP.ms voicemail) | Deferred: too complex for now"; "VoIP.ms sub-account … Kept; unused in Phase 1"; Phase 1 plan §11: "Recording 'VoIP.ms is the wrong vendor'. Rob's ruling is 'deferred, too complex for now'; the account is kept." · Why: corrects friend finding #26.
