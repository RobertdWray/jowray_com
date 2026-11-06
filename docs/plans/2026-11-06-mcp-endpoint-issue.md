<!-- severity:medium -->
<!-- Copied 2026-11-06 from the issue text Rob uploaded (Mac copy: ~/Downloads/jowray-mcp-endpoint-issue.md). One sentence about Rob's family whereabouts was shortened for the public repo; nothing else changed. -->

# Add a bearer-protected MCP endpoint (`/api/mcp`) exposing admin memory CRUD plus memory coordinates (lat/lon), so the draft-memory skill works from any Claude surface

**Repo / branch:** `RobertdWray/jowray_com`, `main` at `95f4df4` (merge of PR #52, 2026-11-05). Line numbers below are from that commit.
**Type:** feature
**Labels:** `severity:medium`, `enhancement`

> **Read first (out-of-date context):** `AGENTS.md` lines 3–5 say this repo runs a Next.js with breaking changes. Read `node_modules/next/dist/docs/` before writing the route. Follow the Cache Components rule (AGENTS.md lines 44–52) and the layering rule (line 37). Everything below assumes those house rules.

---

## Why This Is Important

When condolence notes about Jo arrive in Rob's Gmail, the `jowray-draft-memory` skill saves the sender's words as a **DRAFT** memory on jowray.com and drafts Rob's reply carrying the sender's personal claim link. Today the save step works only on Rob's Mac. It runs `scripts/draft-memory.ts` from a local checkout, with `ADMIN_API_SECRET` read from that checkout's `.env`. The Gmail half of the skill already works anywhere because it uses the Gmail connector. The memory half doesn't.

What happened on 2026-11-05: Rob ran the skill from a claude.ai session with his Mac asleep. Gmail worked and the reply to Joyce Gilley (next-door neighbour at Broadmead) was drafted. The memory could not be saved, so the reply went into Gmail with the placeholder `[MEMORY LINK - ADDING ONCE SAVED, DON'T SEND YET]` and sat unsent. The cloud session failed in three ways:

1. The repo path `/Users/rob/...` doesn't exist in the cloud container.
2. The admin secret isn't there.
3. The container's egress proxy refuses `jowray.com` (`curl: (56) CONNECT tunnel failed, response 403`).

A Claude custom connector solves all three. Anthropic's infrastructure calls the site directly, so it works the same from web, desktop, phone and cloud sessions.

- **User impact:** condolence replies are time-sensitive. Rob is often away from his desk. Every note that arrives while he's away waits for the laptop, and senders like Joyce get a slower or less personal reply.
- **Family impact:** the site exists to gather these memories for Richard and, later, Rob's daughter. Friction in the capture step means fewer memories collected.
- **Technical risk of not doing it:** the workaround is a reply drafted without its link. A reply sent by mistake with the placeholder shows the sender a broken message. Someone may also try to run the script by hand, or move `ADMIN_API_SECRET` into a skill file. Rob asked about doing exactly that on 2026-11-05.
- **Coordinates for future mapping (Rob, 2026-11-06):** each memory should be able to carry a latitude/longitude for a future map of where memories took place. Nothing displays them yet, neither the admin page nor the public site, so the MCP tools are the only way to set or read them. Capturing them now, while each memory's place is fresh in the conversation, avoids a later backfill of every row by hand.
- **Downstream systems:**
  - The `jowray-draft-memory` skill (`docs/skills/jowray-draft-memory/SKILL.md`): its procedure, the preflight and the 409 branch change.
  - The admin API and its secret.
  - Sentry (claim links in new response bodies).
  - Vercel env (a new secret).
  - The family admin page: unchanged, but its features become callable from a second adapter.

## Severity: `severity:medium`

Nothing is broken and no data is at risk. Drafting works from Rob's Mac, and the admin page works from any browser signed in with the admin key. But the core capture flow is impaired whenever Rob is away from his desk, which is most of the time during this period. That makes it more than a convenience (`low`). It isn't `high` because there is a working path: the admin page's draft form can create a draft by hand, though it can't key it to the Gmail message id.

## Who Is Impacted

- **Rob** (primary operator of the skill). He uses claude.ai on web, phone and cloud sessions.
- **Richard and Tracy**, the other family admins. Any of them could use the connector, though the secret is shared, not per-person.
- **Senders** (friends, neighbours, family). They wait longer for their claim link.

## Scope (decided with Rob, 2026-11-06)

- **Authentication:** a static bearer credential in a request header. Rob confirmed his claude.ai **Add custom connector** dialog shows the **Request headers** section (beta). No OAuth.
- **Secret:** a **new** `MCP_API_SECRET`, separate from `ADMIN_API_SECRET`, so each can be rotated on its own. The connector's copy lives with Anthropic; the script's copy stays on the laptop.
- **Tools:** all admin functions, meaning full CRUD on memories. That is everything `app/admin/actions.ts` exposes today, plus the draft API:

| Tool | Wraps (unchanged feature) | Kind | Annotations |
|---|---|---|---|
| `list_memories` | `listMemoriesForAdmin` + `adminStatusCounts` (`features/admin/list-memories.ts`); rows include `coordinates` | Read | `readOnlyHint: true` |
| `get_memory` | `getMemoryForAdmin` (`features/admin/get-memory.ts`); includes `coordinates` | Read | `readOnlyHint: true` |
| `draft_memory` | `draftMemory` (`features/memories/draft-memory.ts`); accepts optional `coordinates` | Create | `destructiveHint: false`, `idempotentHint: true` (a repeat answers `duplicate`) |
| `set_coordinates` | **new** `setMemoryCoordinatesAsAdmin` (`features/admin/set-coordinates.ts`) | Update (or clear with `null`) | `destructiveHint: true`, `idempotentHint: true` |
| `update_memory` | `updateMemoryAsAdmin` (`features/admin/update-memory.ts`) | Update | `destructiveHint: true` |
| `set_status` | `setMemoryStatusAsAdmin` (`features/admin/set-status.ts`) | Update | `destructiveHint: true`, `idempotentHint: true` |
| `set_deleted` | `setMemoryDeletedAsAdmin` (`features/admin/set-deleted.ts`) | Delete / restore | `destructiveHint: true`, `idempotentHint: true` |
| `reissue_claim_link` | `reissueDraftClaimLink` (`features/memories/draft-memory.ts`) | Update (revokes the sent link) | `destructiveHint: true`, `idempotentHint: false` |

**Coordinates (added by Rob, 2026-11-06):**
- **Schema:** two nullable columns on `Memory`, `latitude` and `longitude` (`Float?`, i.e. Postgres `double precision`), in WGS 84 decimal degrees.
- **Database checks:** CHECK constraints enforce that both columns are set or both are null, and that each is in range.
- **API shape:** a single `coordinates: { latitude, longitude } | null` object, so a half-set pair can't be sent.
- **Who sees them:** only the MCP tools set or return them. The admin page, the claim page and the public pages don't show them. The admin page's data must not carry them either, including revision snapshots (see Proposed Direction §6).
- **Scope:** per memory only. `Media` rows also have `place`, but per-file coordinates are out of scope.

**Delete means soft delete and restore**, exactly as the admin page does it. Files are purged by cron step (f) after 30 days. There is no hard-delete feature in `features/`, and this issue doesn't add one.

**Out of scope:**
- Media upload and download over MCP.
- Changing the admin page.
- Per-person identity.
- Removing `scripts/draft-memory.ts`. It stays as the local fallback.

---

## Files Impacted

**New**
- `app/api/mcp/route.ts`: **new**. Holds the bearer gate plus `createMcpHandler`, exported as `GET` and `POST`, with `maxDuration = 30` like the admin routes.
- `app/api/mcp/tools.ts`: **new**. Registers the eight tools. Each is a thin adapter: parse input, call the existing feature, map the result. It lives in `app/` because route handlers are the HTTP adapter layer (AGENTS.md line 37).
- `lib/validations/mcp.ts`: **new**. Tool input schemas, mostly re-exports of existing ones. Two are new:
  - `draft_memory`'s input takes `sourceInput`, not `source`/`sourceRef`.
  - `list_memories` takes a real boolean `deleted` (see Relevant Code §6).
- `lib/source-input.ts`: **new (moved code)**. `SourceInput`, `sourceFor` and `prepareInput`, moved verbatim from `scripts/draft-memory.ts` so the script and the MCP tool derive `sourceRef` with one implementation.
- `prisma/migrations/<timestamp>_memory_coordinates/migration.sql`: **new**. Adds two nullable columns and three CHECK constraints. It is expand-only, so the running app keeps working during the deploy.
- `features/admin/set-coordinates.ts`: **new**. `setMemoryCoordinatesAsAdmin({ memoryId, memoryVersion, coordinates })` follows the `set-status.ts` shape:
  - takes the memory lock
  - re-reads the row; `not_found` if missing or deleted
  - returns `stale` (with the current version and coordinates) if `memoryVersion` moved
  - returns `ok` with no revision if the coordinates are already equal
  - otherwise writes them with an ADMIN revision `{ coordinates }` → `{ coordinates }`
- `__tests__/features/set-coordinates.test.ts`: **new**. TDD for the above, plus the CHECK constraints refusing a half pair or an out-of-range value.
- `__tests__/api/mcp.test.ts`: **new**. Covers:
  - 401 paths
  - `tools/list`
  - each tool's success and error mapping
  - the claim link not appearing in logs

**Modified**
- `app/api/admin/_auth.ts`: **requires change**. Generalise `unauthorized()` to take the secret to check (or add a sibling `mcpUnauthorized()`), so `/api/mcp` uses the same fail-closed, constant-time check against `MCP_API_SECRET`.
- `server/config/env.ts`: **requires change**. Add a `mcpSchema` with `MCP_API_SECRET`, same shape as `ADMIN_API_SECRET` (empty means unset; min 32), and a lazy `getMcpEnv()`.
- `scripts/draft-memory.ts`: **requires change**. Import `prepareInput` from `lib/source-input.ts`; behaviour must not change.
- `__tests__/scripts/draft-memory.test.ts`: **requires change**. Imports follow the move; the existing assertions must still pass unchanged.
- `package.json`, `package-lock.json`: **requires change**. Add `mcp-handler` (2.x, latest 2.3.0 on 2026-11-06) and `@modelcontextprotocol/server` (2.x, latest 2.4.0).
- `prisma/schema.prisma`: **requires change**. Add `latitude Float?` and `longitude Float?` to `model Memory`, next to `place`, with a comment that only the MCP tools set and read them.
- `lib/validations/memory.ts`: **requires change**.
  - Add a shared `coordinatesSchema`: a strict `z.object` with `latitude` −90…90 and `longitude` −180…180.
  - Add optional, nullable `coordinates` to `draftMemoryInputSchema`. The REST draft API then accepts it too, which is harmless.
- `features/memories/draft-memory.ts`: **requires change**. Write `latitude`/`longitude` from `input.coordinates`, and include `coordinates` in the first revision's `after` snapshot (lines 106–116).
- `features/admin/get-memory.ts`: **requires change**.
  - Add an opt-in `{ includeCoordinates: true }`. Only the MCP tool passes it.
  - Without it, the view omits `coordinates` and strips the `coordinates` key from every revision's `before`/`after`. Drop a revision that becomes empty after stripping.
  - The admin page then never receives coordinates in its server-rendered payload.
- `features/admin/list-memories.ts`: **requires change**. The same opt-in, adding `coordinates` to `AdminListRow`.
- `__tests__/features/draft-memory.test.ts`, `__tests__/features/admin-memories.test.ts`: **requires change**. Cover:
  - drafting with and without coordinates
  - the admin view never containing coordinates, at the top level or in revisions, unless opted in
- `docs/environment.md`: **requires change**. Add a `MCP_API_SECRET` row covering:
  - purpose
  - Production only, **never Preview**
  - how to generate it
  - rotation, which means removing and re-adding the connector
- `docs/skills/jowray-draft-memory/SKILL.md`: **requires change**. Use the connector's tools when present and the script as fallback; see Proposed Direction §4.

**Verify only (no change expected)**
- `lib/sentry/scrub.ts`, `lib/sentry/secrets.ts`, `__tests__/lib/sentry-envelope.test.ts`: **requires verification**. MCP responses carry `claimLink` inside JSON-RPC text content. Prove the scrubber removes it from any event or span for `/api/mcp`.
- `eslint.config.mjs`: **requires verification**. The `no-restricted-imports` layering must accept `app/api/mcp/*` importing `features/*` and `lib/*`.
- `features/admin/update-memory.ts`, `set-status.ts`, `set-deleted.ts`, `create-draft.ts`: **no change**. Reused as-is; the MCP layer must not reimplement locking, revisions, budgets or token minting.
- `features/memories/claim.ts`, `app/m/[claimToken]/*`, `app/admin/*`: **requires verification**. Confirm the claim page and the admin pages select explicit columns and never render or serialize `latitude`/`longitude`. Today `claim.ts` uses an explicit `select`. `getMemoryForAdmin` uses `include`, which returns every scalar column, but it maps fields one by one into the view.

---

## Relevant Code

### 1. `app/api/admin/_auth.ts`, lines 15–28: the bearer check to reuse

```ts
export function unauthorized(request: NextRequest): NextResponse | null {
  const authorization = request.headers.get("authorization") ?? "";
  const secret = getAdminEnv().ADMIN_API_SECRET;
  if (!secret || !safeEqualHex(authorization, `Bearer ${secret}`)) {
    // Failed attempts are logged (never the header) so a guessing run is visible in the logs.
    log.warn({ action: "admin_unauthorized", path: request.nextUrl.pathname, configured: Boolean(secret) }, "admin API request refused");
    return NextResponse.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
  }
  return null;
}

export function errorResponse(status: number, code: string, message: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}
```

This is the auth shape to keep for `/api/mcp`:
- fail closed when unset
- constant-time compare (`safeEqualHex`, `lib/claim-token.ts` lines 21–25)
- log the refusal, never the header

Today it's hard-wired to `ADMIN_API_SECRET`.

### 2. `app/api/admin/memories/route.ts`, lines 20–44: the draft API the skill calls today

```ts
export async function POST(request: NextRequest): Promise<Response> {
  const denied = unauthorized(request);
  if (denied) {
    return denied;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid", "The body must be JSON");
  }
  const result = await draftMemory(body);
  if (result.ok) {
    return NextResponse.json({ success: true, data: { memoryId: result.memoryId, claimLink: result.claimLink, originalNoteRecorded: result.originalNoteRecorded } });
  }
  switch (result.code) {
    case "invalid":
      return errorResponse(400, "invalid", result.message);
    case "duplicate":
      log.info({ action: "admin_draft_duplicate", memoryId: result.memoryId }, "draft refused: source already has a memory");
      return errorResponse(409, "duplicate", "A memory already exists for this source", { memoryId: result.memoryId, status: result.status });
    case "budget_exceeded":
      return errorResponse(429, "budget_exceeded", "The daily memory budget is spent; try again later");
  }
}
```

`draft_memory` must return the same information: `memoryId`, `claimLink`, `originalNoteRecorded`, and on `duplicate` the `memoryId` and `status`. The skill's hard rules depend on `originalNoteRecorded`, and on knowing that a 409 means nothing was applied.

### 3. `app/api/admin/memories/[id]/claim-link/route.ts`, lines 15–33: reissue

```ts
export async function POST(request: NextRequest, { params }: RouteContext<"/api/admin/memories/[id]/claim-link">): Promise<Response> {
  const denied = unauthorized(request);
  if (denied) {
    return denied;
  }
  const { id } = await params;
  const result = await reissueDraftClaimLink({ memoryId: id });
  if (result.ok) {
    return NextResponse.json({ success: true, data: { memoryId: result.memoryId, claimLink: result.claimLink } });
  }
  switch (result.code) {
    case "invalid":
      return errorResponse(400, "invalid", "The memory id must be a UUID");
    case "not_found":
      return errorResponse(404, "not_found", "No such memory");
    case "not_draft":
      return errorResponse(409, "not_draft", "This memory has already been shared; its link cannot be reissued");
  }
}
```

### 4. `app/admin/actions.ts`, lines 53–86: the full admin surface to expose

```ts
export async function saveMemory(input: unknown): Promise<AdminUpdateResult | Unauthorized> {
  if (!(await hasAdminSession())) {
    return UNAUTHORIZED;
  }
  return updateMemoryAsAdmin(input);
}

export async function setStatus(input: unknown): Promise<AdminStatusResult | Unauthorized> {
  if (!(await hasAdminSession())) {
    return UNAUTHORIZED;
  }
  return setMemoryStatusAsAdmin(input);
}

export async function setDeleted(input: unknown): Promise<AdminDeletedResult | Unauthorized> {
  if (!(await hasAdminSession())) {
    return UNAUTHORIZED;
  }
  return setMemoryDeletedAsAdmin(input);
}

export async function createDraft(input: unknown): Promise<AdminDraftResult | Unauthorized> {
  if (!(await hasAdminSession())) {
    return UNAUTHORIZED;
  }
  return createDraftAsAdmin(input);
}

export async function reissueLink(input: unknown): Promise<ReissueResult | Unauthorized> {
  if (!(await hasAdminSession())) {
    return UNAUTHORIZED;
  }
  return reissueDraftClaimLink(input);
}
```

The admin page proves the pattern: a thin wrapper does the auth check, then calls the feature unchanged. The MCP tools should be the same, with the bearer check in place of the cookie. The reads are `getMemoryForAdmin` (called from `app/admin/memories/[id]/page.tsx` line 32) and `listMemoriesForAdmin`/`adminStatusCounts` (`app/admin/page.tsx` line 33).

### 5. Feature result types the tools must map. `features/memories/draft-memory.ts` lines 17–26, `features/admin/set-status.ts` line 12, `features/admin/set-deleted.ts` line 12, `features/admin/update-memory.ts` lines 24–28

```ts
export type DraftMemoryResult =
  /** `originalNoteRecorded` is true when the input carried the verbatim excerpt behind a rewrite and it went into the revision. */
  | { ok: true; memoryId: string; claimToken: string; claimLink: string; originalNoteRecorded: boolean }
  | { ok: false; code: "invalid"; message: string }
  | { ok: false; code: "duplicate"; memoryId: string; status: MemoryStatus }
  | { ok: false; code: "budget_exceeded" };

export type ReissueResult =
  | { ok: true; memoryId: string; claimLink: string }
  | { ok: false; code: "invalid" | "not_found" | "not_draft" };
```
```ts
export type AdminStatusResult = { ok: true } | { ok: false; code: "invalid" | "not_found" | "draft" };
```
```ts
export type AdminDeletedResult = { ok: true; purgedFiles: number } | { ok: false; code: "invalid" | "not_found" };
```
```ts
export type AdminUpdateResult =
  /** `current` is the committed snapshot after the write (every editable value and both versions): the form keeps what it typed, refreshes what it did not touch, and saves again without a reload. */
  | { ok: true; written: Array<keyof AdminMemoryChanges>; current: AdminMemoryEditable }
  | { ok: false; code: "invalid" | "not_found" | "last_words" }
  | { ok: false; code: "stale"; current: AdminMemoryEditable };
```

Every `ok: false` becomes a tool execution error (`isError: true`) with its `code` and any extra fields (`memoryId`, `status`, `current`). Never drop `claimToken` into a result: return `claimLink` only, as the API route does.

### 6. `lib/validations/admin.ts`, lines 21–34 and 45–64: schemas to reuse, and one that won't fit MCP as-is

```ts
export const adminListQuerySchema = z.object({
  status: z.enum(MEMORY_STATUSES).optional(),
  q: z
    .string()
    .trim()
    .max(100)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional(),
  // A checkbox or a hand-typed link: "on", "1" and "true" mean true; anything else is refused.
  deleted: z
    .enum(["on", "1", "true"])
    .transform(() => true)
    .optional(),
});
```
```ts
export const adminMemoryChangesSchema = z.object({
  memoryId: z.uuid(),
  memoryVersion: isoDate,
  contributorVersion: isoDate.nullable(),
  changes: z
    .object({
      name: optionalText(120),
      relationship: optionalText(120),
      approxDateText: optionalText(120),
      place: optionalText(200),
      note: z
        .string()
        .max(10_000)
        .transform((value) => (value.trim().length === 0 ? null : value))
        .nullable()
        .optional(),
      visibility: z.enum(["PUBLIC", "FAMILY", "PRIVATE"]).optional(),
    })
    .strict(),
});
```

`deleted` is a query-string enum. An MCP client should send a JSON boolean, so `list_memories` needs its own schema that maps `deleted: boolean` to the feature's input. `update_memory` keeps optimistic concurrency: the model must first call `get_memory` to read `memoryVersion` and `contributor.contributorVersion` (`features/admin/get-memory.ts` lines 36–37, 58–59), and a `stale` result returns `current` for a retry.

### 7. `scripts/draft-memory.ts`, lines 10–16, 106–115, 156–177, 209–221: what ties the skill to the laptop, and the code to move

```ts
// Env: ADMIN_API_SECRET (bearer; never printed). There is no default target:
// production (https://www.jowray.com) needs the explicit --prod flag, anything
// else needs ADMIN_API_URL (http only to loopback), so a forgotten variable can
// never create rows in production. Redirects are refused: the apex 308s to
// www, and a cross-origin redirect drops the Authorization header, which would
// surface as a confusing 401. Pure module: imports nothing guarded by
// `server-only`; only `main()` touches the environment.
```
```ts
/**
 * Where the words came from, in the input JSON. The script turns this into
 * `source` + `sourceRef` through the canonical builders in lib/source-ref.ts,
 * so the skill never reproduces the hashing by hand. An input may instead
 * carry `source` and `sourceRef` itself (a replay of an earlier payload).
 */
export type SourceInput =
  | { kind: "gmail"; messageId: string }
  | { kind: "sms"; number: string; sentAt: string; text: string }
  | { kind: "other"; email: string; originalText: string };
```
```ts
/** The JSON file's object, with `sourceInput` replaced by `source` + `sourceRef`. */
export function prepareInput(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("The input file must hold a JSON object");
  }
  const { sourceInput, ...rest } = raw as Record<string, unknown> & { sourceInput?: unknown };
  const explicit = "source" in rest || "sourceRef" in rest;
  if (sourceInput !== undefined && explicit) {
    throw new Error("Give either sourceInput or source + sourceRef, not both");
  }
  if (sourceInput === undefined) {
    if (!("source" in rest) || !("sourceRef" in rest)) {
      throw new Error("The input needs sourceInput ({ kind: gmail | sms | other, … }) or source + sourceRef");
    }
    return rest;
  }
  if (typeof sourceInput !== "object" || sourceInput === null) {
    throw new Error("sourceInput.kind must be gmail, sms or other");
  }
  const contributor = rest.contributor as { email?: unknown } | undefined;
  const contributorEmail = typeof contributor?.email === "string" ? contributor.email : undefined;
  return { ...rest, ...sourceFor(sourceInput as Record<string, unknown>, contributorEmail) };
}
```
```ts
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) {
    throw new Error("ADMIN_API_SECRET is not set (run with --env-file=.env)");
  }
  const target = resolveTarget(process.env.ADMIN_API_URL, args.prod);
  console.log(`target: ${describeTarget(target)}`);
  const call =
    args.mode === "draft"
      ? callAdmin({ target, secret, path: "/api/admin/memories", body: prepareInput(JSON.parse(readFileSync(args.inputPath, "utf8"))) })
      : callAdmin({ target, secret, path: `/api/admin/memories/${encodeURIComponent(args.memoryId)}/claim-link`, body: null });
```

The `sourceInput` → `sourceRef` derivation runs only in this local script today. The MCP `draft_memory` tool must accept `sourceInput` (never a hand-built `sourceRef`) and derive it server-side with the same code. The skill's rule is "Never compute a `sourceRef` by hand." Move `SourceInput`, `stringField`, `sourceFor` and `prepareInput` (lines 112–145 and 155–177) to `lib/source-input.ts` unchanged. Leave `redactSecret` (lines 147–153) in the script.

Decide whether the MCP tool should also accept the explicit `source` + `sourceRef` replay form (lines 165–169). The recommendation is **no**: accept only `sourceInput`.

The comment on lines 13–15 also matters for the connector URL: it must be `https://www.jowray.com/api/mcp`. The apex redirect would drop the `Authorization` header.

### 8. `server/config/env.ts`, lines 129–133: the secret schema to copy

```ts
/** Bearer secret for the admin API (/api/admin/*); unset means the routes answer 401 to everything. */
const adminSchema = z.object({
  // `ADMIN_API_SECRET=` (empty) means unset, like the other optional keys, so the routes fail closed with 401 rather than 500.
  ADMIN_API_SECRET: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(32, "ADMIN_API_SECRET must be at least 32 characters").optional()),
});
```

### 9. `lib/sentry/scrub.ts`, lines 27–29, and `AGENTS.md` line 57: claim links must never reach Sentry

```ts
// A claim path is `/m/` followed by a base64url token (16+ chars); the token
// may be followed by anything (slash, query, whitespace in a log message).
const CLAIM_PATH = /\/m\/[A-Za-z0-9_-]{16,}/g;
```

AGENTS.md line 57: "Still forbidden everywhere: claim tokens in any form (`/m/<token>`, `?t=`, `claimToken(s)`, `claimLink`), upload tickets (`ticket`, `clientPayload`, `sig`) and the values of `cookie`, `authorization`, `x-vercel-protection-bypass`, `x-vercel-signature`."

`draft_memory` and `reissue_claim_link` put a `claimLink` inside JSON-RPC `result.content[].text` and `structuredContent`. The key-based and path-based scrubbing must cover both shapes on this route.

### 10. `docs/skills/jowray-draft-memory/SKILL.md`, lines 15–16 and 122: the skill's laptop dependency

```md
- The repo at `/Users/rob/Documents/active_work/jowray_com` with `node_modules` installed (Node 20+).
- `/Users/rob/Documents/active_work/jowray_com/.env` holding `ADMIN_API_SECRET` (never print it). Real runs pass `--prod`; a local test sets `ADMIN_API_URL=http://localhost:3000` instead. There is no default target.
```
```bash
npx tsx --env-file=/Users/rob/Documents/active_work/jowray_com/.env /Users/rob/Documents/active_work/jowray_com/scripts/draft-memory.ts --prod --input <json-file>
```

### 11. `prisma/schema.prisma`, lines 126–131: where the coordinates go

```prisma
  sourceRef       String?        @unique     // opaque, unique reference to where the words came from; never an address or number in clear (lib/validations/memory.ts)
  approxDateText  String?        // as given: "Summer 1998"
  approxYear      Int?
  approxMonth     Int?
  place           String?
  contributorNote String?        // the person's words: as typed on /share, or an admin-drafted excerpt (verbatim, or a light rewrite the sender edits before Share; the verbatim text is in the ADMIN revision's before)
```

`latitude Float?` and `longitude Float?` go after `place`. They sit next to the free-text place they describe.

### 12. `prisma/migrations/20261104070100_consent_check/migration.sql`: the repo's pattern for a hand-written CHECK

```sql
-- Restores the database guarantee that every memory a person has shared carries
-- a consent timestamp: only a DRAFT (saved by the admin, not yet shared) may have
-- consentedAt NULL. Separate from 20261104070000_draft_memories because the new
-- enum value cannot be referenced in the transaction that added it.
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_consent_when_not_draft" CHECK ("status" = 'DRAFT' OR "consentedAt" IS NOT NULL);
```

Prisma's schema can't express CHECK constraints, so this repo writes them by hand in the migration SQL. The coordinates migration follows the same pattern:

```sql
-- Coordinates for a future map (WGS 84 decimal degrees). Set and read only through /api/mcp.
-- Expand-only: nullable columns, no backfill; the running app ignores them.
ALTER TABLE "Memory" ADD COLUMN "latitude" DOUBLE PRECISION, ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_coordinates_pair" CHECK (("latitude" IS NULL) = ("longitude" IS NULL));
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90);
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180);
```

(The SQL above is proposed, not existing code.) The range checks need no `IS NULL OR …`: a check whose expression is null is satisfied (see Citations).

### 13. `features/memories/draft-memory.ts`, lines 87–116: the draft write and its first revision

```ts
      const memory = await tx.memory.create({
        data: {
          memorialId: memorial.id,
          contributorId: contributor.id,
          type: "TEXT",
          status: "DRAFT",
          source: input.source,
          sourceRef: input.sourceRef,
          approxDateText: input.approxDateText ?? null,
          place: input.place ?? null,
          contributorNote: input.note,
          visibility: input.visibility,
          notifyWhenPosted: true,
          consentVersion: CONSENT_VERSION,
          consentedAt: null,
          claimTokenHash: hashClaimToken(claimToken),
        },
      });
      // Everything the draft wrote, so the revision history starts from a complete picture.
      const after: Prisma.InputJsonObject = {
        note: input.note,
        name: input.contributor.name ?? null,
        relationship: input.contributor.relationship ?? null,
        approxDateText: input.approxDateText ?? null,
        place: input.place ?? null,
        visibility: input.visibility,
        status: "DRAFT",
        source: input.source,
        sourceRef: input.sourceRef,
      };
```

Add `latitude`/`longitude` to the `create` data, and add `coordinates` to `after` so the history stays complete. `getMemoryForAdmin` strips the latter for the admin page (§14).

### 14. `features/admin/get-memory.ts`, lines 71–75 and 95; `app/admin/format.ts`, lines 40–51: why coordinates would leak into the admin History

```ts
export async function getMemoryForAdmin(id: string): Promise<AdminMemoryView | null> {
  const memory = await getDb().memory.findUnique({
    where: { id },
    include: {
      contributor: { select: { id: true, name: true, email: true, relationship: true, phone: true, contactOptIn: true, mailingListOptIn: true, updatedAt: true } },
```
```ts
      revisions: { select: { id: true, changedVia: true, before: true, after: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: REVISION_TAKE },
```
```ts
/** The keys a revision touched: everything in `before` or `after`, in a stable order. */
export function changedKeys(before: unknown, after: unknown): string[] {
  const keys = new Set<string>();
  for (const side of [before, after]) {
    if (side && typeof side === "object" && !Array.isArray(side)) {
      for (const key of Object.keys(side)) {
        keys.add(key);
      }
    }
  }
  return [...keys];
}
```

The admin History renders every key in a revision's `before`/`after` (`app/admin/history.tsx` line 24). A `coordinates` revision would therefore show on the admin page unless `getMemoryForAdmin` strips it. Strip it in the feature, not in the component, so the coordinates never reach the admin browser at all.

---

## What Needs to Be Investigated

1. **What Claude does on a wrong or missing header.** With no OAuth, `/api/mcp` answers a plain `401` and no `WWW-Authenticate: Bearer resource_metadata=…`. Confirm Claude surfaces this as a connection error rather than trying OAuth discovery. Claude probes `/.well-known/oauth-protected-resource` when no pointer is given; those paths 404 here. *Why:* a misleading "sign in" prompt with no authorization server behind it would confuse Rob. This is also why the proposal uses its own gate instead of `mcp-handler`'s `withMcpAuth`, which answers with a resource-metadata challenge.
2. **Cache Components and the build.** `npm run build:offline` must pass with the new route.
   - The gate's `request.headers` read must come before any Prisma or env access (AGENTS.md lines 46–52).
   - Confirm `mcp-handler` does nothing at module scope that touches the network or env. `scripts/no-network.mjs` refuses non-loopback sockets during the build.
   - Never export `dynamic`/`runtime`/`revalidate` from the route.
3. **Protocol generation Claude speaks.** `mcp-handler` 2.x serves the 2026-07-28 spec natively and 2025-era Streamable HTTP through a stateless fallback. GET/DELETE session operations answer `405`. Confirm `tools/list` and `tools/call` both work from:
   - a claude.ai custom connector
   - `claude mcp add --transport http …` in Claude Code

   *Why:* the two clients may negotiate different protocol versions.
4. **Sentry scrubbing of MCP bodies.** Extend `__tests__/lib/sentry-envelope.test.ts` with a synthetic `SENTRYTEST_` claim link returned from `draft_memory`. Assert it leaves in no event, span, log or breadcrumb, whether in `content[].text` (serialized JSON) or `structuredContent`. *Why:* this route returns bearer links in response bodies, which the existing admin API does too, but through a different serializer.
5. **Logging.** Confirm Pino logs only ids (`memoryId`) for every tool, never `claimLink`, email or name. The existing features already log ids; the adapter must not add result logging. The `authorization` header is already redacted by the logger and dropped by `SECRET_HEADER_KEYS`; confirm `MCP_API_SECRET` travels only in that header.
6. **Rate limiting.** The MCP spec says servers "MUST … Rate limit tool invocations". `draft_memory` is already capped by the daily memory budget (`withinBudget`); the other tools aren't. Decide one of:
   - (a) rely on the 32+ character secret, the logged refusals and the budget
   - (b) add a Vercel Firewall rate-limit rule on `/api/mcp`
   - (c) restrict `/api/mcp` to Anthropic's egress range `160.79.104.0/21`. This breaks Claude Code on Rob's Mac, which connects directly, not through Anthropic.

   *Why:* the endpoint is on the public internet and every tool except the reads can change family data.
7. **Tool permissions in Claude.** After adding the connector, set the destructive tools (`update_memory`, `set_status`, `set_deleted`, `reissue_claim_link`) to require approval under **Customize > Connectors**. Confirm Claude prompts before calling them. *Why:* the skill's hard rules ("Reissue is revocation", "Never save text Rob has not seen") rely on Rob confirming these actions.

8. **Coordinates when `place` changes.** The sender (claim page) or an admin (edit form) can change `place` without seeing the coordinates, which can leave them pointing at the old place. *Recommended:* (a) leave the coordinates alone. `get_memory` returns both `place` and `coordinates`, and the revisions show when each last changed, so a later mapping feature, or Claude, can spot a mismatch. This keeps `claim.ts` and `update-memory.ts`, both critical paths, untouched. *Alternative:* (b) clear the coordinates in the same transaction whenever `place` changes, and record that in the revision. That's safer for a public map, but it touches the claim page's write path and drops good coordinates on cosmetic edits like "Broadmead" → "Broadmead, Cockeysville". **Rob to decide.**
9. **Privacy of coordinates.** Memories are PUBLIC by default, and the skill already forbids street and unit details ("No phone numbers, no street or unit details", SKILL.md hard rules). Coordinates of a home address would leak the same thing. *Recommended:*
   - `set_coordinates` and `draft_memory` say in their descriptions: "coordinates of the named place (a town, facility, church, park, lake), never a private home or unit".
   - The skill shows Rob the proposed coordinates with the place they came from, and asks before saving, like the other fields.

   *Open:* whether the server should also round to a fixed precision, e.g. 3 decimal places (about 110 m). Rounding doesn't make a home address safe, so the rule above is the real guard.
10. **Migration on Vercel.** `vercel.json` runs `npx prisma migrate deploy` in every build, and Preview deploys read a copy of production rows. Confirm the migration is expand-only: nullable columns, no backfill. The CHECKs pass on every existing row because both columns are null. The currently deployed code must also keep working against the new schema during the deploy.

## Steps to Reproduce (current limitation)

1. **Environment:** a claude.ai session running in Anthropic's cloud container (Linux), 2026-11-05 ~10:30 ET. Rob's Mac asleep (desktop app not reachable). Gmail connector connected as `robwray@gmail.com`.
2. **Configuration:** `jowray-draft-memory` skill installed; no jowray connector exists.
3. **Input:** the Gmail thread "Your mother" from Joyce Gilley (`thread-f:1880854380293607148`, message id `1a1a2317fba34eec`).
4. **Actions:** run `/jowray-draft-memory <popout URL>`; answer the Words/Visibility/When/Where/Relationship questions.
5. **Observed:**
   - `ls /Users/rob/Documents/active_work/jowray_com` → `No such file or directory`
   - `curl https://jowray.com` → `curl: (56) CONNECT tunnel failed, response 403`
   - the device bridge → "The device this session is bound to is not connected to the bridge."

   No memory saved. The Gmail reply was drafted with `[MEMORY LINK - ADDING ONCE SAVED, DON'T SEND YET]` in place of the claim link.
6. **Expected:** the skill calls `draft_memory` through the connector, gets `memoryId`, `claimLink` and `originalNoteRecorded`, and puts the link in the reply, from any surface.

**Acceptance checks after the change:**
- `curl -si https://www.jowray.com/api/mcp` with JSON-RPC `tools/list`:
  - no header → `401`
  - wrong `Authorization: Bearer …` → `401`
  - the right one → `200` with eight tools
- `MCP_API_SECRET` unset in Vercel → every request `401` (fail closed).
- claude.ai → **Add custom connector**:
  - URL `https://www.jowray.com/api/mcp`
  - Authentication **No sign-in**
  - Request header `authorization` = `Bearer <MCP_API_SECRET>`

  Then, from the phone app, "list draft memories" returns the list.
- `draft_memory` with an existing Gmail `sourceInput` returns a tool error with `code: "duplicate"`, `memoryId` and `status`, and writes nothing.
- Coordinates:
  - `draft_memory` with `coordinates: { latitude: 39.4815, longitude: -76.6447 }` stores both; `get_memory` and `list_memories` return them.
  - `set_coordinates` with a stale `memoryVersion` returns `stale`; with `null` it clears both.
  - A raw `UPDATE` setting only `latitude`, or `latitude = 91`, is refused by Postgres.
  - The admin page's detail payload contains no `latitude`, `longitude` or `coordinates`, at the top level or in revisions. Assert this in a test, not by eye.
- `scripts/draft-memory.ts` still works unchanged against `ADMIN_API_SECRET`; `__tests__/scripts/draft-memory.test.ts` is green.
- `npm run validate`, `npm run test:run` and `npm run build:offline` all pass with `DATABASE_URL` unset and no `.env*`.

## Proposed Direction

1. **Route.** In `app/api/mcp/route.ts`, the handler for both `GET` and `POST`:
   1. calls the generalised `unauthorized(request, getMcpEnv().MCP_API_SECRET)` first;
   2. returns its `401` if denied;
   3. otherwise returns `handler(request)`, where `handler = createMcpHandler(registerTools, { serverInfo: { name: "jowray", version } })`.

   Keep `maxDuration = 30`. No OAuth metadata routes.
2. **Tools.** `app/api/mcp/tools.ts` registers the eight tools in the table, each with:
   - a full `z.object(...)` input schema
   - a `title`, plus a `description` written for the model. For example, `draft_memory`'s description must say: "pass `sourceInput`, never `sourceRef`; a duplicate means nothing was saved".
   - the annotations listed

   Results return `structuredContent` plus the same JSON as text. Feature `ok: false` codes become `isError: true` results carrying the code and extra fields; unexpected exceptions propagate (no swallowing, per AGENTS.md "No band-aids").
3. **Shared source derivation.** Move lines 112–145 and 155–177 of `scripts/draft-memory.ts` to `lib/source-input.ts` (pure, no `server-only`) and import it from both the script and the tool.
4. **Skill update** (`docs/skills/jowray-draft-memory/SKILL.md`):
   - **Prerequisites:** "the jowray connector's tools, or (fallback) the local checkout".
   - **Preflight:** check the connector tools are present; run the git check only on the script path.
   - **Step 3:** call `draft_memory` with the same JSON minus nothing. It already carries `sourceInput`.
   - **409 branch:** call `get_memory(memoryId)` to read the row's words, visibility and first revision's `before.note`, instead of asking Rob to open `/admin`.
   - **Reissue:** `reissue_claim_link`, still only on Rob's explicit yes.
5. **Env and docs.**
   - Generate with `openssl rand -hex 32`.
   - `vercel env add MCP_API_SECRET production`. **Never Preview**: previews read a copy of production rows, the same rule as `ADMIN_PAGE_SECRET` in `docs/environment.md` line 92.
   - Redeploy.
   - Document rotation: generate, replace in Vercel, redeploy, then **remove and re-add the connector**, because Claude can't edit request headers in place.
6. **Coordinates.**
   1. **Schema and migration.** Add `latitude Float?` and `longitude Float?` to `Memory` (§11). Generate the migration with `npx prisma migrate dev --create-only`, add the three CHECK constraints by hand (§12), and review the SQL, as the repo already does (`docs/plans/2026-11-03-share-redesign.md` line 262).
   2. **Validation.** `coordinatesSchema` in `lib/validations/memory.ts`:

      ```ts
      z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict()
      ```

      It is reused by `draftMemoryInputSchema` (optional, nullable) and by the `set_coordinates` input (`{ memoryId: z.uuid(), memoryVersion: isoDate, coordinates: coordinatesSchema.nullable() }`).
   3. **Write paths.** `draftMemory` writes them at creation. `setMemoryCoordinatesAsAdmin` changes them later, with lock, stale check, idempotent no-op and an ADMIN revision. `updateMemoryAsAdmin` and the claim page don't touch them (unless Rob picks option (b) in Investigate §8).
   4. **Read paths.** `getMemoryForAdmin` and `listMemoriesForAdmin` take `{ includeCoordinates }`, and only the MCP tools pass `true`. By default the view has no `coordinates` field, and `coordinates` keys are stripped from revision snapshots. The admin page and its browser payload therefore never carry them, and `app/admin/history.tsx` needs no change.
   5. **Tool output.** `coordinates` is always `{ latitude, longitude }` or `null`, never two loose numbers. When a mapping feature later builds GeoJSON, it must emit `[longitude, latitude]` in that order (see Citations).
   6. **Skill.** In step 2, after "where", propose coordinates for the named place with the source phrase. Add a `Coordinates` question in step 2b: the proposed value / "Leave blank". Pass `coordinates` in step 3's JSON only when Rob chose a value.

**Alternatives considered**

- **`withMcpAuth` from `mcp-handler`.** *Risk:* it answers `401` with an RFC 9728 challenge pointing at protected-resource metadata. With no authorization server, that steers Claude into an OAuth discovery that can't succeed. Use it only if the site later adopts OAuth.
- **OAuth (CIMD/DCR) with per-person sign-in** for Rob, Richard and Tracy. *Benefit:* per-person identity in revisions. *Risk:* a full authorization server (metadata, `/authorize`, `/token`, PKCE, refresh rotation) for three users. Not worth it now; revisit if more admins join.
- **Reuse `ADMIN_API_SECRET`.** Rejected by Rob: one rotation would break both the laptop script and the connector.
- **Insert rows through the Neon connector.** *Risk:* it would duplicate claim-token hashing, `sourceRef` canonicalisation, revisions, locks and the budget in SQL, outside the tested features.
- **Put the secret in the skill file.** *Risk:* the skill is readable wherever it syncs, the cloud egress still blocks `jowray.com`, and anyone with the file could reissue (revoke) links.

---

## Documentation & Citations

### `app/api/mcp/route.ts`: hosting an MCP server as a Next.js Route Handler
- **Change summary:** a new Route Handler exporting `GET` and `POST` from `createMcpHandler`.
- **Source:** [mcp-handler README, "Framework Compatibility"](https://github.com/vercel/mcp-handler#framework-compatibility) and ["Quick Start (Next.js)"](https://github.com/vercel/mcp-handler#quick-start-nextjs)
- **Verbatim quote:** "`createMcpHandler` returns a Web-standard request handler, so the package is not tied to Vercel or any particular framework. It can be mounted in: - Next.js Route Handlers" and, from the Quick Start, "`export { handler as GET, handler as POST };`"
- **Why this matters:** it confirms the package mounts as a plain `(Request) => Promise<Response>` Route Handler, so the gate can run before it and `maxDuration` applies as on the admin routes.

- **Source:** [Next.js docs, route.js file convention](https://nextjs.org/docs/app/api-reference/file-conventions/route)
- **Verbatim quote:** "Route Handlers allow you to create custom request handlers for a given route using the Web Request and Response APIs."
- **Why this matters:** the handler from `createMcpHandler` takes and returns Web `Request`/`Response`, which is exactly the Route Handler contract.

- **Source:** [Claude docs, Lazy authentication, "Test the lazy-auth path"](https://claude.com/docs/connectors/building/lazy-authentication#test-the-lazy-auth-path)
- **Verbatim quote:** "Claude reaches custom connectors from Anthropic's infrastructure, so `localhost` isn't reachable directly."
- **Why this matters:** connector calls come from Anthropic, not from the session's container. The endpoint must therefore be on the public site, and the cloud container's egress block (`CONNECT tunnel failed, response 403`) doesn't apply.

### `app/api/admin/_auth.ts` and `app/api/mcp/route.ts`: static bearer credential in the `authorization` header
- **Change summary:** gate `/api/mcp` with the existing constant-time bearer check against `MCP_API_SECRET`, read only from the `authorization` header.
- **Source:** [Claude docs, Authentication for connectors, "Static credentials in request headers"](https://claude.com/docs/connectors/building/authentication#static-credentials-in-request-headers)
- **Verbatim quote:** "**Read the credential from a request header**: standard authentication header names such as `authorization`, `x-api-key`, and `x-auth-token` work for every connector." and "**Never accept it in the URL**: don't read tokens from query parameters such as `?token=` or `?apiKey=`."
- **Why this matters:** `authorization` needs no Anthropic approval and is already what `unauthorized()` reads; the secret must never be accepted from the URL.

- **Source:** [Claude docs, Add a connector that isn't in the directory, "Choose authentication settings"](https://claude.com/docs/connectors/custom/add-unlisted#choose-authentication-settings) and ["Enter the full header value"](https://claude.com/docs/connectors/custom/add-unlisted#enter-the-full-header-value)
- **Verbatim quote:** "If the server uses an API key, choose **No sign-in** and add the key under **Request headers**." and "Claude sends the value exactly as you enter it. It doesn't add an authentication scheme or any other prefix. For an `Authorization` header, include the scheme in the value"
- **Why this matters:** the connector is configured as No sign-in plus a header value of `Bearer <secret>`. That matches `safeEqualHex(authorization, \`Bearer ${secret}\`)` byte for byte, so the gate needs no new parsing.

- **Source:** [Claude docs, Lazy authentication, "Answer a protected call with 401 before the MCP SDK runs"](https://claude.com/docs/connectors/building/lazy-authentication#answer-a-protected-call-with-401-before-the-mcp-sdk-runs)
- **Verbatim quote:** "A tool handler can't produce that response: once the MCP SDK is running a tool, whatever the handler returns is wrapped in a `200`. The check has to run in your HTTP handler, on the parsed JSON-RPC body, before the request reaches the SDK."
- **Why this matters:** it justifies doing the bearer check in the Route Handler before `createMcpHandler` runs, so a bad secret is a transport-level `401` and not a `200` tool error.

### `server/config/env.ts` and `docs/environment.md`: a separate, organisation-level `MCP_API_SECRET`
- **Change summary:** add `MCP_API_SECRET` (min 32, empty means unset, fail closed) with a lazy `getMcpEnv()`, and document it, including rotation.
- **Source:** [Claude docs, Authentication for connectors, "Static credentials in request headers"](https://claude.com/docs/connectors/building/authentication#static-credentials-in-request-headers)
- **Verbatim quote:** "**Treat it as the organization's credential, not a person's**: every member's requests carry the same key, so don't use it to identify which user is calling." and "**Tell Owners what to enter**: document the header name and where they get the key."
- **Why this matters:** the revision history keeps `changedVia: "ADMIN"` with no person attached, matching the admin API today. `docs/environment.md` must say what to enter.

- **Source:** [Claude docs, Add a connector that isn't in the directory, "Edit or remove a connector"](https://claude.com/docs/connectors/custom/add-unlisted#edit-or-remove-a-connector)
- **Verbatim quote:** "You can't change authentication settings after you add a connector. That covers OAuth credentials and request headers. To change them, remove the connector and add it again with the new details."
- **Why this matters:** rotating `MCP_API_SECRET` means removing and re-adding the connector. That is a second reason to keep it separate from `ADMIN_API_SECRET`, whose rotation shouldn't force a connector rebuild.

### `app/api/mcp/tools.ts`: tool definitions, annotations and error mapping
- **Change summary:** register eight tools with annotations; return feature `ok: false` codes as tool execution errors; return `structuredContent` plus serialized text.
- **Source:** [MCP specification 2025-11-25, Schema, `ToolAnnotations`](https://modelcontextprotocol.io/specification/2025-11-25/schema#toolannotations) (text from [schema.ts](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2025-11-25/schema.ts))
- **Verbatim quote:** "If true, the tool does not modify its environment." (`readOnlyHint`) and "If true, the tool may perform destructive updates to its environment." (`destructiveHint`) and "NOTE: all properties in ToolAnnotations are **hints**."
- **Why this matters:** the reads are marked read-only, and the update, status, delete and reissue tools are marked destructive. Rob still sets per-tool approval in Claude (Investigate §7) because hints are advisory.

- **Source:** [MCP specification 2025-11-25, Tools, "Error Handling"](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#error-handling)
- **Verbatim quote:** "**Tool Execution Errors**: Reported in tool results with `isError: true`: … Business logic errors" and "**Tool Execution Errors** contain actionable feedback that language models can use to self-correct and retry with adjusted parameters."
- **Why this matters:** `duplicate`, `stale`, `not_draft`, `last_words` and `budget_exceeded` are business-logic outcomes the skill acts on. They must reach the model as `isError: true` results with their codes, not as JSON-RPC protocol errors.

- **Source:** [MCP specification 2025-11-25, Tools, "Structured Content"](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content)
- **Verbatim quote:** "For backwards compatibility, a tool that returns structured content SHOULD also return the serialized JSON in a TextContent block."
- **Why this matters:** each result carries both `structuredContent` and the same JSON as text. That is also why the Sentry check (Investigate §4) must cover both shapes.

- **Source:** [MCP specification 2025-11-25, Tools, "Security Considerations"](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#security-considerations)
- **Verbatim quote:** "Servers **MUST**:" … "Validate all tool inputs" … "Implement proper access controls" … "Rate limit tool invocations" … "Sanitize tool outputs"
- **Why this matters:** it covers four things:
  - input validation reuses the existing zod schemas
  - access control is the bearer gate
  - rate limiting is the open decision in Investigate §6
  - output sanitising means never returning `claimToken`, `claimTokenHash`, `blobUrl` or `storageKey`. `getMemoryForAdmin` already excludes the last three.

### `lib/validations/mcp.ts`: tool input schemas
- **Change summary:** full `z.object(...)` schemas per tool, reusing `adminMemoryChangesSchema`, `adminStatusSchema`, `adminDeletedSchema` and `adminMemoryIdSchema`. Two are new: a boolean-`deleted` list schema and a `sourceInput`-based draft schema.
- **Source:** [mcp-handler README, "Migrating from 1.x"](https://github.com/vercel/mcp-handler#migrating-from-1x)
- **Verbatim quote:** "`inputSchema`/`argsSchema` take a full Standard Schema (e.g. `z.object({ ... })`) instead of a raw zod shape."
- **Why this matters:** the repo's existing exported `z.object` schemas can be passed as-is; only the query-string-shaped list schema needs an MCP variant.

- **Source:** [MCP specification 2025-11-25, Tools, "Tool"](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool)
- **Verbatim quote:** "`inputSchema`: JSON Schema defining expected parameters" … "**MUST** be a valid JSON Schema object (not `null`)"
- **Why this matters:** `list_memories` has all-optional inputs. It still needs an object schema, not `undefined`.

### `package.json` / `package-lock.json`: dependencies
- **Change summary:** add `mcp-handler` 2.x and `@modelcontextprotocol/server` 2.x (no `@modelcontextprotocol/sdk` 1.x, no Redis).
- **Source:** [mcp-handler README, "Installation"](https://github.com/vercel/mcp-handler#installation)
- **Verbatim quote:** "`mcp-handler` 2.x requires the MCP SDK v2 packages (`@modelcontextprotocol/server` ^2.0.0), zod ^4.2.0, and Node.js 20+. If you're on `@modelcontextprotocol/sdk` 1.x, use `mcp-handler` 1.x."
- **Why this matters:** the repo already has `zod ^4.6.7`, `next 16.4.4` and Node 20+, so 2.x fits with no other upgrades.

- **Source:** [mcp-handler README, "Protocol Support"](https://github.com/vercel/mcp-handler#protocol-support)
- **Verbatim quote:** "**2026-07-28** (current): served natively — stateless, no sessions" and "**2025-era Streamable HTTP**: served via the SDK's stateless legacy fallback from the same handler. GET/DELETE session operations answer `405` (serving is stateless)."
- **Why this matters:** it is stateless, so it works on Vercel functions with no session store, and either protocol generation is served from one route (Investigate §3).

### `lib/source-input.ts` and `scripts/draft-memory.ts`: moving the `sourceInput` derivation
- **Change summary:** move `SourceInput`/`sourceFor`/`prepareInput` out of `scripts/` into `lib/` unchanged; the script and the MCP tool both import it.
- **Source:** repository house rules, [`AGENTS.md` line 37](https://github.com/RobertdWray/jowray_com/blob/95f4df4c42280952688048c16f1195a9c3e1685b/AGENTS.md?plain=1#L37) (no external documentation governs this internal move)
- **Verbatim quote:** "`app/ → features/ → services/ → integrations/`. A layer imports only from layers below it plus `lib/` and `server/`. Nothing imports from `app/`."
- **Why this matters:** `app/api/mcp/tools.ts` may import `lib/` but shouldn't import `scripts/`. Moving the pure function to `lib/` gives one canonical derivation, keeping the script's own promise (line 109): "so the skill never reproduces the hashing by hand."

### `__tests__/api/mcp.test.ts`: test shape
- **Change summary:** Vitest tests calling the route's `POST` with JSON-RPC bodies. Model them on `__tests__/api/admin-memories.test.ts`: mock the features, set and unset the secret, `resetEnvCache()`.
- **Source:** [Claude docs, Lazy authentication, "Test the lazy-auth path"](https://claude.com/docs/connectors/building/lazy-authentication#test-the-lazy-auth-path)
- **Verbatim quote:** "`-d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_products","arguments":{}}}'`" and "The server answers `401 Unauthorized` … If you see `200` with `isError: true` instead, your server is returning a tool error rather than failing the HTTP request."
- **Why this matters:** it gives the exact JSON-RPC body shape for `tools/call`, and confirms the test should assert a transport `401` (not `200`/`isError`) for a bad secret.

### `docs/skills/jowray-draft-memory/SKILL.md`: the skill uses the connector on every surface
- **Change summary:** the connector tools become the primary path, with the local script as fallback; the 409 branch reads the row through `get_memory`.
- **Source:** [Claude docs, Authentication for connectors](https://claude.com/docs/connectors/building/authentication)
- **Verbatim quote:** "The same authentication infrastructure backs claude.ai, Claude Desktop, Claude mobile, Claude Code, and Cowork, so the requirements here apply to all of them."
- **Why this matters:** one connector configuration serves Rob on web, phone, desktop and cloud sessions, which is the whole point of the change.

### `prisma/schema.prisma`: `latitude Float?` / `longitude Float?`
- **Change summary:** two nullable `Float` fields on `Memory`.
- **Source:** [Prisma schema reference, `Float`](https://www.prisma.io/docs/orm/reference/prisma-schema-reference#float)
- **Verbatim quote:** "Floating point number." and, for the PostgreSQL connector, "| PostgreSQL | `double precision` |"
- **Why this matters:** `Float` maps to Postgres `double precision` with no `@db` attribute. That gives about 15 significant digits, far more than map coordinates need, and the migration SQL in §12 uses the same column type.

### `prisma/migrations/<timestamp>_memory_coordinates/migration.sql`: hand-added CHECK constraints
- **Change summary:** generate the migration with `--create-only`, then add the pair and range CHECKs by hand before applying.
- **Source:** [Prisma docs (ORM v7), Unsupported database features, "Customize a migration to include an unsupported feature"](https://www.prisma.io/docs/orm/prisma-migrate/workflows/unsupported-database-features#customize-a-migration-to-include-an-unsupported-feature)
- **Verbatim quote:** "However, some database features cannot be represented in the Prisma schema" … "To add an unsupported feature to your database, you must customize a migration" … "Use the `--create-only` flag to generate a new migration without applying it:"
- **Why this matters:** Prisma's schema has no CHECK syntax, so the constraints live in hand-edited migration SQL. That's what `20261104070100_consent_check` already does.

- **Source:** [PostgreSQL docs, 5.5.1 Check Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-CHECK-CONSTRAINTS)
- **Verbatim quote:** "A check constraint is the most generic constraint type. It allows you to specify that the value in a certain column must satisfy a Boolean (truth-value) expression." and "It should be noted that a check constraint is satisfied if the check expression evaluates to true or the null value."
- **Why this matters:** the null rule means the range checks (`"latitude" BETWEEN -90 AND 90`) pass for rows with no coordinates. That covers every existing row, so the migration needs no backfill and no `IS NULL OR` clause. The pair check `("latitude" IS NULL) = ("longitude" IS NULL)` never evaluates to null, so it always enforces both-or-neither.

### `lib/validations/memory.ts` and the tool output: coordinate convention
- **Change summary:** `coordinates: { latitude, longitude }` in WGS 84 decimal degrees, with ranges validated, and named fields rather than a positional array.
- **Source:** [RFC 7946 (GeoJSON), Section 4, Coordinate Reference System](https://www.rfc-editor.org/rfc/rfc7946#section-4) and [Section 3.1.1, Position](https://www.rfc-editor.org/rfc/rfc7946#section-3.1.1)
- **Verbatim quote:** "The coordinate reference system for all GeoJSON coordinates is a geographic coordinate reference system, using the World Geodetic System 1984 (WGS 84) [WGS84] datum, with longitude and latitude units of decimal degrees." and "The first two elements are longitude and latitude, or easting and northing, precisely in that order and using decimal numbers."
- **Why this matters:** WGS 84 decimal degrees is the standard that web maps and GeoJSON expect, so a future map needs no conversion. Named `latitude`/`longitude` fields avoid the classic lat/lon swap. The GeoJSON order (`[lon, lat]`) is noted for whoever builds the map.

### `lib/sentry/*` (verify only): optional network restriction and secret scrubbing
- **Change summary:** no code change expected; add an envelope test for MCP responses. Optionally add a Vercel Firewall rule.
- **Source:** [Claude docs, Authentication for connectors, "Network reference"](https://claude.com/docs/connectors/building/authentication#network-reference)
- **Verbatim quote:** "Anthropic's outbound traffic to your server originates from `160.79.104.0/21`."
- **Why this matters:** it is the allowlist for option (c) in Investigate §6, with the stated trade-off that Claude Code on Rob's Mac would be blocked.

- **Source:** repository house rules, [`AGENTS.md` line 57](https://github.com/RobertdWray/jowray_com/blob/95f4df4c42280952688048c16f1195a9c3e1685b/AGENTS.md?plain=1#L57)
- **Verbatim quote:** "Still forbidden everywhere: claim tokens in any form (`/m/<token>`, `?t=`, `claimToken(s)`, `claimLink`)"
- **Why this matters:** two of the new tools return claim links, so the existing scrubber guarantee must be re-proven for this route.
