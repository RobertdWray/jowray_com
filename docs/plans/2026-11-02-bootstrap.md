> **Snapshot taken at step P7, before the initial commit.** Its STATUS and ledger are frozen at that point.
> The authoritative final state is [2026-11-02-bootstrap-report.md](2026-11-02-bootstrap-report.md), added by the `docs/bootstrap-report` PR. If that file exists, it supersedes this snapshot.

# jowray_com bootstrap runbook (v4)

> **Read this first if you're resuming, or if this was handed to you.** This file is the single source of truth. It doesn't depend on any chat history.
> - Paths: plan file `/Users/rob/.claude/plans/can-you-install-the-smooth-rainbow.md`, project root `/Users/rob/Documents/active_work/jowray_com`, state folder `/Users/rob/.claude/plans/jowray-bootstrap-state/`. The state folder holds only key **names** and fingerprints, never secret values.
> - Before doing anything, read the **Progress ledger**. Each step starts with a **done-check**. If that check says the step is already done, mark it verified and move on. Never repeat a step blindly.
> - Update the ledger row after every step: status, timestamp, artifacts produced, evidence.

## STATUS
- **v4, EXECUTING — snapshot taken at P7, before the initial commit.** Rob approved "go ahead and execute this plan" on 2026-11-02 at about 14:31. See the ledger for progress.
- **Rulings made during execution** (each records what was decided, why, and the cost if it's wrong):
  - P0: Node now resolves to Homebrew v26.13.0 (npm 11.20.0, global prefix `/opt/homebrew`), git is 2.56.0, and the nvm v22.13.1 folder on PATH no longer exists. Kept as is: v26 meets both minimums (≥20.9 and ≥20.19). Cost if wrong: Next 16.4.4 could misbehave on Node 26, and P8 would catch that.
  - P1: the `vercel` CLI is a **pnpm** global (`/Users/rob/Library/pnpm/vercel`), not an npm/nvm install. So I used `pnpm add -g vercel@65.9.0` per `[C12]`'s "re-run the installation command". `npm i -g` would have added a second binary in `/opt/homebrew/bin`, which is earlier on PATH and would shadow it. Cost if wrong: none; `which -a vercel` shows a single binary.
  - P1: `neonctl` was already at 8.16.0, so `brew upgrade` wasn't needed.
  - P3: the 16.4.4 `app-tw` template wires Tailwind through `@tailwindcss/turbopack` (in `next.config.ts`), not PostCSS, so there's **no `postcss.config.mjs`**. I kept `postcss.config.mjs` in the P9 allowlist: the allowlist permits paths rather than requiring them, so an absent entry is harmless. Cost if wrong: none. (`[C4]`'s Relevant Files list mentions it too, which is a cosmetic inaccuracy.)
  - P3: a `.DS_Store` appeared in the root at 14:34, created by Finder rather than the scaffold. It's covered by the scaffold `.gitignore`, so I left it alone.
  - P4: I did **not** run `npm audit fix --force`. Its only "fix" downgrades to eslint@4 / eslint-config-next@0.2.4 (breaking), and the advisory is dev-only. Added as Bucket 4 item 8. Cost if wrong: a moderate ReDoS in lint tooling that only runs on trusted input.
- Rob's decisions are recorded below. The friend's feedback review (four buckets, two rounds) is at the end.
- **The authoritative final record** is `docs/plans/2026-11-02-bootstrap-report.md` in `RobertdWray/jowray_com`, added by the follow-up PR from branch `docs/bootstrap-report` in step P17. If that file exists on `main` or in that PR, it supersedes this file's status and ledger.
  - Get it with `gh pr list --repo RobertdWray/jowray_com --head docs/bootstrap-report`.
  - Or, after merge: `gh api repos/RobertdWray/jowray_com/contents/docs/plans/2026-11-02-bootstrap-report.md`.

## Goal
Bootstrap Rob's Memorial Memories site. Architecture is in `docs/Memorial Memories Site initial thinking.md` (currently in the project root). This runbook does only the setup:
- Next.js 16.4.4 scaffold and the Neon driver.
- The design doc moved into `docs/`.
- Placeholder and real env keys added to the existing `.env`.
- Project docs (`AGENTS.md` rules, `docs/environment.md`, a repo copy of this runbook).
- One initial commit, pushed to a private GitHub repo.
- A Vercel project connected to that repo.
- An empty Neon database through the Vercel integration, with preview branching turned on.
- A Sentry project.

Architecture choices (ORM or migrations, storage provider, Auth.js, SDKs) belong to Rob's separate plan. Its path or URL hasn't been provided yet.

## Decisions (Rob, 2026-11-02)
| Topic | Decision |
|---|---|
| Vercel CLI | Upgrade the global CLI. Vercel project **`rob-wrays-projects/jowray.com`**, connected to GitHub. |
| GitHub | **Private** repo `RobertdWray/jowray_com`. **Single initial commit on `main`** (no PR for the bootstrap). |
| Neon | Driver `@neondatabase/serverless` and a Neon CLI upgrade. An **empty** database via `vercel integration add neon` with plan **`scale_v3`**. |
| Neon env vars | **Merged into `.env`.** Done append-only, because another agent edits `.env` concurrently. |
| Sentry | New project `jowray_com` in org `med3ai` (https://med3ai.sentry.io), found and created by API. |
| Telephony | **VoIP.ms** with `DID_JOWRAY`. Another agent is setting these keys up. **No Twilio keys.** |
| `.env` duplicate | Rob fixes the duplicate `SENDGRID_API_KEY` himself. P0 stops if any duplicate remains. |
| `.env` permissions | `chmod 600`. |
| Nice-to-do items | All four: `AGENTS.md` project rules, a repo copy of this runbook, `docs/environment.md`, Neon preview branching. |
| Completion report | A follow-up docs PR from `docs/bootstrap-report` adds `docs/plans/2026-11-02-bootstrap-report.md`. That PR's preview deployment also serves as the preview-branching test. Rob reviews and merges it. |
| `.env` ownership | Before P15, Rob confirms the VoIP.ms agent is finished with `.env`. The executor then owns `.env` exclusively until P15 verification passes, and tells Rob when it's released. |

## External state found at planning time (2026-11-02, read-only). Re-check in P0.
| Resource | State |
|---|---|
| GitHub | `gh` is logged in as `RobertdWray` (SSH, `repo` scope). `RobertdWray/jowray_com` **does not exist**. |
| Vercel | User `robertdwray`, team `rob-wrays-projects` (Pro). Project `jowray.com` **does not exist**. CLI is 65.2.0 (latest 65.9.0). |
| Neon | The org that Vercel's integration manages is `org-dark-band-75525913`, "Vercel: Rob Wray's projects" (Scale plan, all existing app databases in `aws-us-east-1`). There's also a separate console org, `org-restless-leaf-00125159`. No project named jowray exists in either. The Homebrew `neonctl` is 3.2.2 (latest 8.16.0). |
| Neon integration | Metadata: `region` (choose `iad1`), `auth` (**defaults to true**, so we pass `false` because Auth.js is the plan), `realtime` (defaults to false). Plans: `free_v3`, `launch_v3`, `scale_v3`. |
| Sentry | Org `med3ai`, API host `https://us.sentry.io`, team `med3ai`. Project `jowray_com` **does not exist**. Underscore slugs work (precedent: `robwray_com`). Platform is `javascript-nextjs`. |
| Local | Node v22.13.1. Git 2.51.1 with no `init.defaultBranch` set. The create-next-app saved preferences include `srcDir: true`. The design doc's sha256 is `8634015b4af3870d4930c7507193a6494b8774c6a68990751e63a5b70716d49b`. `.env` has 18 key lines with **`SENDGRID_API_KEY` duplicated**, mode 644, and it is being edited by another agent. |

## Execution conventions (every step)
- **Prelude:** start every shell invocation with this, because shell state doesn't persist between calls.
  ```bash
  set -euo pipefail
  ROOT=/Users/rob/Documents/active_work/jowray_com
  STATE=/Users/rob/.claude/plans/jowray-bootstrap-state
  cd "$ROOT" && [ "$(pwd -P)" = "$ROOT" ] || { echo "ABORT: wrong directory"; exit 1; }
  ```
- **Stop on failure.** Record the error in the ledger, find and fix the root cause (no band-aids, no suppressed errors), and ask Rob if the fix isn't obvious.
- **Secrets:** never print a secret value. Show `.env` only as `sed -E 's/=.*/=<hidden>/' .env`. Tokens go into shell variables and are `unset` afterward. Delete temp files that hold secrets in the same command that used them.
- **Recovery rules:**
  - Never force-push.
  - Never delete or recreate the GitHub repo, Vercel project, Neon project, or Sentry project to "start over".
  - Never `git reset --hard` or `rm` anything that isn't a temp folder recorded in the ledger.
  - Global CLI upgrades are tracked separately from repo progress.
- **Remote writes** (P10–P14, P16) only happen after their P0 re-check passes.
- **Attribution:** commit and PR attribution must name the agent actually executing. If that's Claude Code in session `014KCPxLiCm9zz9stncJNecG`, use the two lines in P9.
- **Versions** are pinned exactly as written. Homebrew `neonctl` is accepted at ≥ 8.16.0, and the actual version is recorded.

## Progress ledger
| Step | Status | When | Artifacts / evidence | Next |
|---|---|---|---|---|
| P0 cold start | verified | 2026-11-02 14:33 | node v26.13.0, npm 11.20.0, git 2.56.0, gh 2.103.3. Root holds `.env` and the doc only, and isn't a git repo. `.env`: 17 keys, 0 duplicates (Rob fixed SENDGRID), mode 644, names in `$STATE/p0-keys.txt`. Doc sha 8634015b… unchanged. GH repo, Vercel project, Neon project (org-dark-band), and Sentry project all confirmed absent (Sentry project 404). Sentry token prefix `sntryu_`, org GET 200. No leftover temp files. | |
| P1 global CLIs | verified | 2026-11-02 14:36 | vercel 65.9.0 (pnpm global, single binary). neon 8.16.0 (`/opt/homebrew/bin/neon` first). | |
| P2 move doc | verified | 2026-11-02 14:37 | `docs/Memorial Memories Site initial thinking.md`, sha 8634015b… matches. Root copy gone. | |
| P3 scaffold | verified | 2026-11-02 14:39 | temp dir: `/var/folders/kf/27q2x37j1tg8fst0w1cb_1lm0000gn/T//jowray-scaffold.FzGY9X` (**removed**). 17 files copied, `shasum -c` OK, no collisions. next 16.4.4, `cacheComponents: true` (the template also sets `partialPrefetching: true` and `turbopack.rules` for `@tailwindcss/turbopack`), AGENTS.md marker present, no `src/`, `.gitignore` covers `.env*`, `.vercel`, `.DS_Store`, `next-env.d.ts`. | |
| P4 dependencies | verified | 2026-11-02 14:41 | `next@16.4.4`, `@neondatabase/serverless@1.2.0` (exact). Lockfile sha256 `784f51b9290e050688f0a14cc97c14bfb6c01b057253f0e6ef98a8687ee07bf5`. `npm audit`: 16 moderate, all dev-only ESLint tooling, one advisory (minimatch GHSA-g3hv-75wg-m249). `--omit=dev` gives 0. | |
| P5 AGENTS.md rules | verified | 2026-11-02 14:43 | `## Project rules` appended below `END:nextjs-agent-rules` (checked by line order). | |
| P6 docs/environment.md | written; re-check at P15 | 2026-11-02 14:45 | Built from the 17 `.env` key names (unchanged since P0). Neon names come from the live Neon doc (DATABASE_URL, DATABASE_URL_UNPOOLED, PGHOST, PGHOST_UNPOOLED, PGUSER, PGDATABASE, PGPASSWORD, POSTGRES_*). Sentry and placeholder sections included. | |
| P7 README + runbook copy | in progress (this snapshot) | 2026-11-02 14:46 | | |
| P8 quality gates | pending | | | |
| P9 git init + commit | pending | | SHA: | |
| P10 GitHub repo | pending | | | |
| P11 Vercel project + git | pending | | | |
| P12 Neon database | pending | | project id: | |
| P13 Neon preview branching (Rob) | pending | | | |
| P14 Sentry project | pending | | DSN: | |
| P15 .env updates | pending | | | |
| P16 push + deployment check | pending | | | |
| P17 completion report PR + preview-branching check | pending | | PR: · preview branching: pending / setting enabled / verified | |
| P18 cleanup | pending | | | |

## Steps

### P0 — Cold-start checks (read-only except the state folder)
1. **Tools.** Run `node -v; npm -v; which -a node npm vercel neon gh; npm prefix -g; vercel --version; neon --version; gh --version; git --version`. Node must be ≥ 20.9 `[C4]` and ≥ 20.19 for the Neon CLI `[C11]`. Record the results.
2. **Root contents.** `ls -A "$ROOT"`. Expected: `.env`, plus the design doc in the root or in `docs/`. Anything else means a partial run, so use the resume rules in the later steps. `git -C "$ROOT" rev-parse --is-inside-work-tree` should fail, unless P9 already ran.
3. **`.env` integrity.**
   - `grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' .env | sort | uniq -d` must print nothing. If it prints anything, **STOP** and ask Rob, who is fixing `SENDGRID_API_KEY`.
   - Record the key names: `mkdir -p "$STATE"; grep -oE '^[A-Za-z_][A-Za-z0-9_]*' .env | sort > "$STATE/p0-keys.txt"`.
4. **Doc preservation.** `shasum -a 256` the design doc. Record the sha. If it differs from the planning-time value, Rob has edited it, so use the new value going forward.
5. **Remote re-checks.** Each one must match the planning table. If a resource already exists, follow the done-check in its step.
   - `gh auth status` shows `RobertdWray`. `gh repo view RobertdWray/jowray_com` returns not found.
   - `vercel whoami` shows `robertdwray`. `vercel project inspect jowray.com --scope rob-wrays-projects` returns `project_not_found`.
   - The Neon MCP `list_projects` with `org_id=org-dark-band-75525913` and `search=jowray` returns `[]`.
   - Sentry: `GET https://us.sentry.io/api/0/projects/med3ai/jowray_com/` returns 404, using the token pattern from P14.
6. **Local-only setup.** Write the Sentry admin token's file path into `$STATE/sentry-admin-token-file.txt`, using the command in the Local-only notes. Then confirm the token still reaches the org: `GET https://us.sentry.io/api/0/organizations/med3ai/` returns 200. Print the HTTP status code only.
7. **Leftover secret temp files from an interrupted run.**
   - `[ ! -f "$STATE/p15-tmpenv.txt" ] || { f=$(cat "$STATE/p15-tmpenv.txt"); rm -f "$f"; rm -f "$STATE/p15-tmpenv.txt"; }`.
   - If `$STATE/p3-tmp.txt` points to a folder that still exists, delete it only after confirming P3 has been verified.
   - Record what was removed.

### P1 — Upgrade the global CLIs (outside the repo)
- **Done-check:** `vercel --version` is 65.9.0 and `neon --version` is ≥ 8.16.0.
- **Commands:**
  - `npm i -g vercel@65.9.0` `[C12]`. The CLI was installed with npm under nvm.
  - `brew upgrade neonctl` `[C11]`. It was installed with Homebrew and runs as `neon`.
- **Verify:** both versions are as above, and `which -a neon` lists `/opt/homebrew/bin/neon` first.

### P2 — Move the design doc into `docs/`
- **Done-check:** `docs/Memorial Memories Site initial thinking.md` exists, its sha matches P0, and the root copy is gone.
- **Command:** `mkdir -p docs && mv -n "Memorial Memories Site initial thinking.md" docs/`. `docs` is on create-next-app's list of allowed folders `[C1]`.
- **Verify:** the sha256 of the moved file equals the P0 value.

### P3 — Scaffold Next.js 16.4.4 into a temp folder, then copy it in
The scaffold runs elsewhere because create-next-app refuses a folder that contains `.env` `[C1]`, and we don't want to move a secrets file.
- **Done-check:** `package.json`, `app/`, `AGENTS.md`, and `next.config.ts` exist in `$ROOT`, and the P3 ledger row says verified.
- **Resume:** if some scaffold files exist but P3 isn't verified, re-scaffold into a **new** temp folder. Compare every file present in both (`shasum`). On **any** mismatch, **STOP** and ask Rob. Otherwise, copy only the missing files and continue from "Verify".
- **Commands:**
  ```bash
  TMP=$(mktemp -d "${TMPDIR:-/tmp}/jowray-scaffold.XXXXXX"); echo "$TMP" > "$STATE/p3-tmp.txt"   # also record in ledger
  cd "$TMP" && npx --yes create-next-app@16.4.4 jowray_com \
    --ts --eslint --tailwind --app --no-src-dir --no-react-compiler \
    --cache-components --agents-md --no-agent-feedback \
    --import-alias "@/*" --use-npm --skip-install --disable-git --yes
  cd "$ROOT"; SRC="$TMP/jowray_com"
  coll=$(comm -12 <(ls -A "$SRC" | sort) <(ls -A "$ROOT" | sort))
  [ -z "$coll" ] || { echo "ABORT: name collision: $coll"; exit 1; }
  cp -R "$SRC/." "$ROOT/"
  (cd "$SRC" && find . -type f -print0 | xargs -0 shasum -a 256) > "$TMP/manifest.sha256"
  (cd "$ROOT" && shasum -a 256 -c --quiet "$TMP/manifest.sha256")
  ```
  Why each flag:
  - Every shape-defining option is passed **explicitly**. With `--yes`, any option left out falls back to saved preferences, and this machine has `srcDir: true` saved `[C5]`.
  - `--cache-components` and `--agents-md` are the recommended defaults `[C2, C4]`.
  - `--no-agent-feedback` is recorded as Rob's privacy default.
  - There's no bundler flag: 16.4.4 has no `--turbopack`/`--webpack` option, and Turbopack is used unless you pass `--rspack` `[C5]`.
  - `--disable-git`: otherwise the CLI runs its own `git init` and makes its own initial commit `[C2, C3]`.
  - `--skip-install`: dependencies are installed in P4 `[C2]`.
- **Verify** (before deleting anything):
  - `package.json` has `"next": "16.4.4"`.
  - `next.config.ts` contains `cacheComponents: true`.
  - `AGENTS.md` contains `BEGIN:nextjs-agent-rules`.
  - There's no `src/` folder.
  - `.gitignore` contains `.env*` and `.vercel` `[C6]`.
  - Only after all of that: `rm -rf "$TMP"`, then record the cleanup in the ledger.

### P4 — Install dependencies and the Neon driver
- **Done-check:** `npm ls next @neondatabase/serverless` shows `next@16.4.4` and `@neondatabase/serverless@1.2.0`.
- **Commands:** `npm install`, then `npm install --save-exact @neondatabase/serverless@1.2.0` `[C8]`. `package-lock.json` gets committed.
- **Verify:** `npm ls` as above. Record the lockfile's sha256.

### P5 — Add project rules to `AGENTS.md`
- **Done-check:** `grep -q '^## Project rules' AGENTS.md`.
- Append **below** the `<!-- END:nextjs-agent-rules -->` marker. `next dev` rewrites the block between the markers, so anything inside it would be lost `[C30]`.
  ```markdown

  ## Project rules (Rob, apply to every agent)
  - After the bootstrap commit, every change goes on a branch with a PR, including critical fixes.
  - Never add a git submodule unless Rob approves it directly.
  - Never add an ESLint suppression (`eslint-disable…`) unless Rob approves with an all-caps "YES" after being asked.
  - Never hide an error to keep moving. Fix the root cause with best-practice code. Use a band-aid only if Rob insists; if you're stuck, ask Rob how to find the root cause.
  - Never apply "unsafe" automatic fixes (for example `ruff --unsafe-fixes`) without asking Rob first.
  - Never commit secrets. `.env*` files are gitignored; key names and purposes are in `docs/environment.md`.
  - Bootstrap history and decisions: `docs/plans/2026-11-02-bootstrap.md`.
  ```

### P6 — Write `docs/environment.md` (key names only, never values)
- **Done-check:** the file exists and lists every key present in `.env` after P15. Re-check this at P15.
- Build the "pre-existing" table from the **actual** key names in `.env` at P6, because another agent may be adding VoIP.ms keys. Sections:
  1. **How env works here.**
     - Next.js reads `.env*` files into `process.env`. `.env.local` takes precedence over `.env` `[C7]`.
     - All keys live in `.env`. `vercel link` writes `.env.local` containing only `VERCEL_OIDC_TOKEN` `[C14]`.
     - Refresh the Neon values with `vercel env pull` `[C17]`.
     - Never commit `.env*` `[C6]`.
  2. **Pre-existing keys (managed by Rob):**
     - `CLOUDFLARE_ACCOUNTT_ID` (sic) and `CLOUDFLARE_DNS_ONLY_API_TOKEN`: DNS.
     - `SENDGRID_API_KEY`: outbound email.
     - The VoIP.ms keys (`voipms_*`, `VOIPMS_*`): the phone and SMS provider, set up separately.
     - `DID_JOWRAY`: the memorial phone number.
     - `ELEVENLABS_API_KEY`: phase 2 speech-to-text `[C20]`.
  3. **Neon:** managed by the Vercel integration `[C9, C16]`. `DATABASE_URL` is pooled and is what the app uses. `DATABASE_URL_UNPOOLED` is a direct connection for migrations. Also `PG*` and the legacy `POSTGRES_*`.
  4. **Placeholders still to fill:**
     - `GEMINI_API_KEY` `[C19]`.
     - `SENTRY_AUTH_TOKEN`: a future **org** token for CI source maps `[C23, C25]`.
     - `AUTH_SECRET`: phase 3 Auth.js `[C26]`.
  5. **Sentry:** `NEXT_PUBLIC_SENTRY_DSN` holds a real value, and DSNs aren't secrets `[C22, C24]`. Org `med3ai`, project `jowray_com`, API host `https://us.sentry.io`.

### P7 — Link docs from `README.md` and add the repo copy of this runbook
- **Done-check:** `README.md` contains `## Project docs`, and `docs/plans/2026-11-02-bootstrap.md` exists.
- Append to `README.md` `[C31]`:
  ```markdown

  ## Project docs
  - [Design notes](docs/Memorial%20Memories%20Site%20initial%20thinking.md)
  - [Environment variables](docs/environment.md)
  - [Bootstrap runbook and decisions](docs/plans/2026-11-02-bootstrap.md)
  ```
- Before taking the snapshot, set this file's STATUS to `EXECUTING — snapshot taken at P7, before the initial commit`.
- Copy this runbook with the local-only block removed.
  - The markers only count when they're a **whole line**, so the marker text inside this command can't start or end the deletion range.
  - A dry run at planning time confirmed it: unanchored markers kept only 8 of 18 step headings and left a code block unclosed, while anchored markers kept every heading.
  ```bash
  SRCPLAN=/Users/rob/.claude/plans/can-you-install-the-smooth-rainbow.md; COPY=docs/plans/2026-11-02-bootstrap.md
  mkdir -p docs/plans
  { echo "> **Snapshot taken at step P7, before the initial commit.** Its STATUS and ledger are frozen at that point."
    echo "> The authoritative final state is [2026-11-02-bootstrap-report.md](2026-11-02-bootstrap-report.md), added by the \`docs/bootstrap-report\` PR. If that file exists, it supersedes this snapshot."; echo
    sed '/^<!-- LOCAL-ONLY:BEGIN -->$/,/^<!-- LOCAL-ONLY:END -->$/d' "$SRCPLAN"; } > "$COPY"
  pat_a="curie""dx"; pat_b='sntry[su]_[A-Za-z0-9]{20,}'; pat_c='^<!-- LOCAL-ONLY:(BEGIN|END) -->$'
  ! grep -qE "$pat_a|$pat_b" "$COPY" || { echo "ABORT: local-only content leaked"; exit 1; }
  ! grep -qE "$pat_c" "$COPY" || { echo "ABORT: local-only marker left in copy"; exit 1; }
  [ "$(grep -c '^### P[0-9]' "$COPY")" = "$(grep -c '^### P[0-9]' "$SRCPLAN")" ] || { echo "ABORT: step headings lost"; exit 1; }
  [ $(( $(grep -cE '^[[:space:]]*```' "$COPY") % 2 )) -eq 0 ] || { echo "ABORT: unbalanced code fences"; exit 1; }
  ```
- Also check that the source plan has exactly 19 `### P` headings (P0–P18), so a missing step can't slip through by matching an equally short copy.

### P8 — Quality gates (all must pass before P9)
- `npm run lint` exits 0.
- `npm run build` exits 0. The output should mention Turbopack, which confirms the bundler `[C5]`.
- Fix any failure at the root cause. Never add a suppression without Rob's "YES".

### P9 — `git init` and the single initial commit (local)
- **Done-check:** use this when a commit already exists.
  - If the ledger recorded a commit SHA and tree SHA, `git rev-parse HEAD` and `git rev-parse 'HEAD^{tree}'` must equal them.
  - If nothing was recorded (a crash after the commit but before the ledger update), all of these must hold:
    - There's exactly 1 commit.
    - Its subject is `Initial commit: Next.js 16 scaffold, Neon driver, project docs`.
    - `git status --porcelain` is empty.
    - `git ls-files | awk -F/ '{print $1}' | sort -u` passes the gate-2 allowlist.
    - `git ls-files -- '.env*'` is empty.
    - `git show HEAD:package-lock.json | shasum -a 256` matches the P4 lockfile sha.
    Then record the SHAs.
  - On any mismatch, **STOP** and ask Rob. Never amend or reset.
- **After committing:** record `git rev-parse HEAD`, `git rev-parse 'HEAD^{tree}'`, and `git ls-files | shasum -a 256` in the ledger.
- **Commands:**
  ```bash
  [ -d .git ] || git init -b main          # init.defaultBranch is unset, so name the branch explicitly  [C27]
  git add -A
  # Gate 1: secrets are not in the index (check-ignore alone can't prove a file is untracked)  [C28]
  [ -z "$(git ls-files -- '.env*')" ] && [ -z "$(git diff --cached --name-only | grep -E '(^|/)\.env')" ] || { echo "ABORT: env file staged"; exit 1; }
  git check-ignore -q .env || { echo "ABORT: .env not ignored"; exit 1; }   # [C6]
  # Gate 2: only allowlisted top-level paths are staged
  allow='^(\.gitignore|AGENTS\.md|README\.md|app|docs|eslint\.config\.mjs|next\.config\.ts|package\.json|package-lock\.json|postcss\.config\.mjs|public|tsconfig\.json)$'
  bad=$(git diff --cached --name-only | awk -F/ '{print $1}' | sort -u | grep -vE "$allow" || true)
  [ -z "$bad" ] || { echo "ABORT: unexpected staged paths: $bad"; exit 1; }
  git commit -F - <<'EOF'
  Initial commit: Next.js 16 scaffold, Neon driver, project docs

  - Scaffold Next.js 16.4.4 via create-next-app (TypeScript, ESLint,
    Tailwind CSS, App Router, Cache Components, AGENTS.md)
  - Add @neondatabase/serverless 1.2.0
  - Move initial design notes into docs/; add docs/environment.md,
    the bootstrap runbook, and project rules in AGENTS.md

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014KCPxLiCm9zz9stncJNecG
  EOF
  ```
  If the staged list contains a legitimate new generated file, add it to the allowlist **and to this runbook** first. Don't bypass the gate.

### P10 — Create the GitHub repo (no push yet)
- **Done-check:** `git remote get-url origin` is `RobertdWray/jowray_com`, and `gh repo view RobertdWray/jowray_com --json visibility` shows `PRIVATE`.
- **Command:** `gh repo create RobertdWray/jowray_com --private --source=. --remote=origin` `[C29]`.
  - The push waits until P16. Vercel gets connected first, so the push triggers the first production deployment.
  - If the repo already exists and is **empty and private**, just add the remote. If it has commits, **STOP**.

### P11 — Create the Vercel project and connect GitHub
- **Done-check:** `vercel project inspect jowray.com --scope rob-wrays-projects` succeeds, shows Next.js as the framework, and shows the GitHub repo connected.
- **Commands:**
  1. `vercel link --yes --project jowray.com --scope rob-wrays-projects` `[C13]`.
     - Run it inside the scaffolded root so the framework is detected as Next.js.
     - This writes `.vercel/` (gitignored `[C6]`) and appends `VERCEL_OIDC_TOKEN` to `.env.local` `[C14]`. Leave `.env.local` as is and record it.
  2. If the inspect output shows no Git connection: `vercel git connect --yes --scope rob-wrays-projects` `[C15]`.
     - If that fails because GitHub access is missing, **STOP**. Rob needs to grant the Vercel GitHub App access to `RobertdWray/jowray_com` (GitHub → Settings → Applications → Vercel → Repository access). Then retry.
- **Verify:**
  - The remote: inspect shows the framework, the repo, and the default function region `iad1` `[C18]`.
  - The **local link**: `.vercel/project.json` has a `projectId` equal to the project ID printed by `vercel project inspect jowray.com --scope rob-wrays-projects`, and an `orgId` equal to the `rob-wrays-projects` team ID.
  - Record both IDs. On a mismatch, **STOP**, because the folder is linked to the wrong project.

### P12 — Provision an empty Neon database through the Vercel integration
- **Done-check:** Neon MCP `list_projects` (`org_id=org-dark-band-75525913`, `search=jowray`) returns one project, and `vercel env ls --scope rob-wrays-projects` lists `DATABASE_URL` for Production, Preview, and Development. If a Neon project exists but isn't connected, use `vercel integration resource connect` (see `[C16]`). Never create a second one.
- **Command:** run from the linked root.
  ```bash
  vercel integration add neon --name jowray_com --plan scale_v3 \
    -m region=iad1 -m auth=false -m realtime=false --no-env-pull \
    --scope rob-wrays-projects --format json
  ```
  `[C16]`:
  - `--no-env-pull`: P15 merges the values into `.env` itself.
  - `auth=false`: the default would provision Neon Auth, which conflicts with Auth.js.
  - `iad1` matches Vercel's default function region `[C18]`.
  - The default environments are production, preview, and development.
  - If the CLI says the plan has to match the existing installation, accept the installation's plan (Scale) and record that.
- **Verify:**
  - The project is in `org-dark-band-75525913`, region `aws-us-east-1`. Record the project id.
  - The database is **empty**: Neon MCP `run_sql` with `SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')` returns 0.
  - Neon Auth is **not** enabled (Neon MCP `get_neon_auth_config` shows it disabled, and there's no `neon_auth` schema).
  - `vercel env ls` shows `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in all three environments `[C9]`.

### P13 — Turn on Neon preview branching (Rob, in the Vercel dashboard; doesn't block P14–P16)
- In the Vercel dashboard, go to Storage → the `jowray_com` Neon database → connected projects → `jowray.com`. Under **Create database branch for deployment**, select **Preview** and leave **Production** unchecked `[C10]`.
- An agent may do this with browser automation only if Rob explicitly OKs it.
- **Verify:** the setting shows Preview checked. The first real proof comes with the first PR's preview deployment, when Neon creates a branch named `preview/<git-branch>` `[C10]`.

### P14 — Create the Sentry project and fetch its DSN
- **Done-check:** `GET https://us.sentry.io/api/0/projects/med3ai/jowray_com/` returns 200. If so, skip creation and just fetch the DSN.
- **Commands:** they use the one-off admin token. Its location is in the local-only block. It's a personal token, used once and never copied `[C23]`.
  ```bash
  F="$(cat "$STATE/sentry-admin-token-file.txt")"   # path written there in P0 from the LOCAL-ONLY block
  TOKEN=$(grep -E '^[[:space:]]*(export[[:space:]]+)?SENTRY_AUTH_TOKEN[[:space:]]*=' "$F" | head -1 | cut -d= -f2- | tr -d "\"' \r")
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" https://us.sentry.io/api/0/projects/med3ai/jowray_com/)
  if [ "$code" = 404 ]; then
    curl -sS -X POST "https://us.sentry.io/api/0/teams/med3ai/med3ai/projects/" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d '{"name":"jowray_com","slug":"jowray_com","platform":"javascript-nextjs","default_rules":true}' \
      | python3 -I -c 'import sys,json; d=json.load(sys.stdin); print("slug=",d.get("slug"),"platform=",d.get("platform"),"detail=",d.get("detail"))'
  fi
  curl -sS "https://us.sentry.io/api/0/projects/med3ai/jowray_com/keys/" -H "Authorization: Bearer $TOKEN" \
    | python3 -I -c 'import sys,json; k=json.load(sys.stdin); print(k[0]["dsn"]["public"])' > "$STATE/sentry-dsn.txt"
  unset TOKEN
  ```
  `[C21, C22]`:
  - The slug is passed explicitly because Sentry would otherwise derive it from the name.
  - `default_rules: true` alerts on every new issue.
  - The DSN isn't a secret, so it's fine to store in `$STATE` `[C22]`.
- **Verify:** the slug is `jowray_com`, the platform is `javascript-nextjs`, and `$STATE/sentry-dsn.txt` starts with `https://`.

### P15 — Update `.env` (exclusive ownership, append-only)
- **Ownership gate (required):**
  - Ask Rob to confirm that the VoIP.ms agent has finished with `.env` and will leave it alone until you report that P15 verification has passed.
  - **Don't start without an explicit yes.** Record the time of his confirmation in the ledger.
  - Why the gate: "check, then append" isn't atomic. A concurrent writer can create a duplicate key between the check and the append. If it rewrites the whole file, it can also silently drop lines we appended. A lock would only work if both writers honored it, so this is a handoff.
  - When verification passes, tell Rob `.env` is released.
- **Done-check:** every target key below is present, `DATABASE_URL` is non-empty, there are no duplicate keys, and the mode is 600.
- **Commands:**
  ```bash
  dups=$(grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' .env | sort | uniq -d); [ -z "$dups" ] || { echo "ABORT: duplicate keys: $dups"; exit 1; }
  grep -oE '^[A-Za-z_][A-Za-z0-9_]*' .env | sort > "$STATE/p15-keys.txt"
  fp() { awk -F= 'NR==FNR{k[$1]=1;next} ($1 in k)' "$STATE/p15-keys.txt" .env | sort | shasum -a 256 | cut -c1-16; }
  FP_BEFORE=$(fp)
  has() { grep -qE "^$1=" .env; }
  [ -z "$(tail -c1 .env)" ] || printf '\n' >> .env
  grep -qF '# --- added by jowray bootstrap' .env || printf '\n# --- added by jowray bootstrap (2026-11-02); see docs/environment.md ---\n' >> .env
  # 1) Neon values from Vercel (development environment), pulled to a private temp file  [C17]
  TMPENV=$(mktemp "${TMPDIR:-/tmp}/jowray-devenv.XXXXXX")
  echo "$TMPENV" > "$STATE/p15-tmpenv.txt"                                   # lets P0 clean up after a hard kill
  trap 'rm -f "$TMPENV" "$STATE/p15-tmpenv.txt"' EXIT                         # runs on success and on any set -e exit  [C34]
  chmod 600 "$TMPENV"
  vercel env pull "$TMPENV" --environment=development --yes --scope rob-wrays-projects
  conflicts=""
  while IFS= read -r line; do k=${line%%=*}
    case "$k" in VERCEL_*) continue;; esac          # OIDC token lives in .env.local only  [C14]
    if has "$k"; then [ "$(grep -E "^$k=" .env)" = "$line" ] || conflicts="$conflicts $k"
    else printf '%s\n' "$line" >> .env; fi
  done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$TMPENV")
  rm -f "$TMPENV"                                                            # deleted right away; the trap is the safety net
  [ -z "$conflicts" ] || { echo "STOP: keys already set with different values:$conflicts"; exit 1; }
  # 2) Sentry DSN (real value, not a secret)  [C22, C24]
  has NEXT_PUBLIC_SENTRY_DSN || printf 'NEXT_PUBLIC_SENTRY_DSN=%s\n' "$(cat "$STATE/sentry-dsn.txt")" >> .env
  # 3) Placeholders, added only if missing  [C19, C25, C26]
  for k in GEMINI_API_KEY SENTRY_AUTH_TOKEN AUTH_SECRET; do has "$k" || printf '%s=\n' "$k" >> .env; done
  chmod 600 .env
  [ "$(fp)" = "$FP_BEFORE" ] || { echo "ABORT: pre-existing values changed during P15"; exit 1; }
  ```
- **Verify:**
  - `sed -E 's/=.*/=<hidden>/' .env` shows the pre-existing keys followed by the new ones.
  - `grep -qE '^DATABASE_URL=.+' .env`.
  - No duplicates.
  - `stat -f %Lp .env` is `600`.
  - `git status --porcelain` is clean, because `.env*` is ignored.
  - Re-check that `docs/environment.md` covers every key name. If not, **STOP**: the doc change belongs on a branch and PR now, per the project rules.

### P16 — Push and check the first production deployment
- **Commands and checks:**
  1. `git push -u origin main`.
  2. `[ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$(git rev-parse HEAD)" ]`.
  3. `vercel ls jowray.com --scope rob-wrays-projects` shows a Production deployment for that SHA. Wait until it's **Ready**, then `vercel inspect <deployment-url> --scope rob-wrays-projects`.
  4. `curl -s -o /dev/null -w '%{http_code}' https://<production-domain>/` returns `200`. Get the domain from the project inspect output.
- If the build fails, read the build logs (`vercel inspect --logs`) and fix the root cause through a branch and PR, since `main` now has its commit.

### P17 — Completion report PR, plus the preview-branching check
- **Done-check:** an open or merged PR from `docs/bootstrap-report` exists (`gh pr list --repo RobertdWray/jowray_com --head docs/bootstrap-report --state all`), and its report file has every section below filled in.
- **Steps:**
  1. `git switch -c docs/bootstrap-report` (or `git switch docs/bootstrap-report` if it already exists).
  2. Write `docs/plans/2026-11-02-bootstrap-report.md` with **no secret values**. Sections:
     - **Resources:**
       - GitHub: repo URL and visibility.
       - Vercel: project URL, project ID, team ID, Git link, production domain, and the production deployment URL and ID.
       - Neon: project ID, org, region, empty-database result, Neon Auth off.
       - Sentry: project URL and DSN.
     - **Commits:** the initial commit SHA, tree SHA, `git ls-files` hash, and lockfile sha256. Local and remote SHAs match.
     - **Checks:** lint and build results, deployment status, and the `curl` result.
     - **Secret hygiene:**
       - `.env` is untracked, has no duplicate keys, and is mode 600.
       - The P15 fingerprint matched.
       - No temp files remain.
     - **Doc preservation:** the design doc's sha.
     - **CLI versions.**
     - **Preview branching:** exactly one of these:
       - **pending:** P13 not done.
       - **setting enabled, not yet verified.**
       - **verified:** the preview branch was created.
     - **Remaining tasks:** Bucket 4, plus anything not done.
     - **What we're not doing:** Bucket 3.
  3. Add `- [Bootstrap completion report](docs/plans/2026-11-02-bootstrap-report.md)` to the "Project docs" list in `README.md`.
  4. **Gates, before committing.** Check the staged changes, not the branch history. Until this branch has a commit, `main...HEAD` is empty and would pass without checking anything.
     ```bash
     npm run lint && npm run build
     git add -- README.md docs/plans/2026-11-02-bootstrap-report.md
     expected=$'README.md\ndocs/plans/2026-11-02-bootstrap-report.md'
     [ "$(git diff --cached --name-only | sort)" = "$expected" ] || { echo "ABORT: staged paths differ from the two expected files"; exit 1; }
     git diff --cached            # review the full staged content (it must contain no secret values)
     [ -z "$(git ls-files -- '.env*')" ] || { echo "ABORT: env file tracked"; exit 1; }
     ```
  5. Commit with executor attribution. **After committing**, verify the whole PR scope:
     `[ "$(git diff --name-only main...HEAD | sort)" = "$expected" ]`, which compares against the same two paths.
     Then `git push -u origin docs/bootstrap-report`.
  6. `gh pr create --base main --head docs/bootstrap-report --title "docs: bootstrap completion report" --body-file <file>` `[C33]`.
     - The body covers: the summary, a link to the report, **"What we're not doing, and why"** (Bucket 3), and **"Out of scope: candidate issues"** (Bucket 4).
     - End the body with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and then `https://claude.ai/code/session_014KCPxLiCm9zz9stncJNecG`. Use your own attribution if another agent is executing.
  7. **Preview-branching functional check** (Neon's documented test: push a feature branch, then check the Vercel deployments and the Neon branches `[C32]`):
     - The push in step 5 triggers a Vercel Preview deployment. `vercel ls jowray.com --scope rob-wrays-projects` must show it as Ready.
     - Then the Neon MCP `list_branches` on the P12 project must show `preview/docs/bootstrap-report`. Record the state:
       - **verified:** P13 is enabled and the branch exists.
       - **setting enabled, not yet verified:** P13 is enabled but there's no branch. Investigate the root cause; don't paper over it.
       - **pending:** P13 isn't done yet. Leave it as a remaining task and re-check after Rob enables it, using the next PR.
     - Record the result in the report file with a second commit on the same branch. Use the same gate as step 4: `git add -- docs/plans/2026-11-02-bootstrap-report.md`, then `git diff --cached --name-only` must be exactly that one path. After the commit, re-run the `main...HEAD` scope check against the two expected paths. Then push.
  8. **Don't merge.** Rob reviews and merges the PR, per the project rules.
- Update this file: STATUS becomes `COMPLETE except: <remaining items>`, and every ledger row gets filled in.

### P18 — Cleanup
- **Precondition:** the P17 PR exists **and** its report holds every resource ID, SHA, and piece of evidence.
- **Order matters.** The temp paths are recorded *inside* `$STATE`, so check and clean them first, and delete `$STATE` last:
  ```bash
  for rec in "$STATE/p3-tmp.txt" "$STATE/p15-tmpenv.txt"; do
    [ -f "$rec" ] || continue
    p=$(cat "$rec")
    if [ -e "$p" ]; then echo "leftover: $p"; rm -rf -- "$p"; fi   # only paths this runbook recorded
    [ ! -e "$p" ] || { echo "ABORT: could not remove $p"; exit 1; }
  done
  rm -rf -- "$STATE"     # held only key names, the DSN, and fingerprints
  [ ! -e "$STATE" ]
  ```
- Record what was removed in the ledger, then `git switch main`.
- Give Rob the final summary with links to the PR, the report, the Vercel project, Neon, and Sentry.
- If preview branching isn't **verified**, say so explicitly and name the next check.

## Friend's feedback, sorted into four buckets (each claim checked against source, 2026-11-02)
**Bucket 1 — Must do.** Built into the steps above.
- `.env` changes are idempotent and append-only, with a duplicate-key abort and a fingerprint proof that existing values are unchanged.
- Collisions and copy failures stop the run (`comm` exits 0 even when it finds collisions). The scaffold uses a fresh `mktemp`, recorded and verified with `shasum -c` before cleanup.
- Lint and build pass before the commit. A staged-path allowlist runs, and an index check covers `.env` (git's own docs say `check-ignore` doesn't show tracked files `[C28]`).
- Every scaffold option is explicit, because `--yes` falls back to saved preferences `[C5]`.
- Versions are pinned.
- Cold-start checks, a progress ledger, done-checks for resuming, recovery rules, and a completion-evidence list.
- Placeholder count corrected (v1 had 9, not 10). The count is no longer used; checks go by key list.
- Executor-accurate attribution.
- `set -euo pipefail` and a directory assertion at the start of every step.

Also found while checking the new scope:
- `auth=false` on the Neon integration.
- Create the Vercel project through `vercel link` inside the scaffold.
- The GitHub App access fallback.
- `iad1`.
- Append-only `.env` handling because of the concurrent agent.
- The pre-existing duplicate `SENDGRID_API_KEY`.
- VoIP.ms instead of Twilio.

Second review round (friend, 2026-11-02). All accepted; I verified #1 with a stdout-only dry run.
1. The P7 sanitizer matched its own command text: only 8 of 18 headings survived, and a code block was left unclosed. Now the markers match only as whole lines, the leak check looks for whole-line markers, and heading-count and code-fence checks were added.
2. Append-only doesn't make concurrent `.env` edits safe. P15 now has an explicit ownership handoff from the VoIP.ms agent.
3. The secret temp file wasn't cleaned up on failure. Now an `EXIT` trap is registered right after `mktemp`, and the path is recorded so P0 can clean it up after a hard kill.
4. There was no durable completion record. It now lives in the follow-up docs PR (P17), and the snapshot header and STATUS both point to it.
5. Preview branching wasn't part of the completion criteria. P17 now reports one of three states, using Neon's documented feature-branch test.
6. Smaller fixes:
   - P9's resume check compares the recorded SHA, tree, and contents.
   - P11 checks `.vercel/project.json` against the remote project.

Third review round (friend, 2026-11-02). Both accepted.
1. P17's gate used `main...HEAD` before the branch had any commits, so it checked nothing. It now checks the staged diff with explicit `git add --`, requires exactly the expected paths, and re-checks `main...HEAD` after each commit.
2. P18 deleted `$STATE` before reading the temp paths recorded inside it. It now cleans the recorded paths first and deletes `$STATE` last.

**Bucket 2 — Nice to do (all accepted by Rob):** P5, P6, P7, P13. The local homepage smoke check is replaced by the real production deployment plus a `curl` 200 in P16.

**Bucket 3 — Don't do, and why:**
1. **Hand-listing files to stage.** A list of generated files breaks when the generator changes. The staged-path allowlist plus the index secret check gives the same protection.
2. **`--turbopack`/`--webpack` flags.** They don't exist in create-next-app 16.4.4, and unknown flags are silently ignored. Turbopack is already the default, and the build output proves it `[C5]`.
3. **An `npm ci` policy.** There are no later installs in this bootstrap. Vercel installs from the committed lockfile.
4. **Editing or relabeling Rob's design doc** (it still says Twilio, for example). It's Rob's doc and it's titled "initial thinking." `docs/environment.md` records the VoIP.ms reality.

**Bucket 4 — Real problems, out of scope.** Candidates for https://github.com/RobertdWray/jowray_com/issues after the bootstrap.
1. Local development env vars point at the production (default) Neon branch. Adopt a branch-first dev flow.
2. Sentry SDK setup (the wizard), plus an **org** auth token (`org:ci`) for Vercel source maps `[C23, C25]`.
3. Protect `main` by requiring PRs and status checks.
4. A CI workflow on GitHub Actions (lint, typecheck, build).
5. Rename the `CLOUDFLARE_ACCOUNTT_ID` typo (Rob's call).
6. Update the design doc's Twilio references to VoIP.ms (Rob's doc).
7. Optional upstream issue: the Next.js docs list `--turbopack`/`--webpack`, but the 16.4.4 source doesn't have them.
8. `npm audit` shows 16 moderate findings in the fresh scaffold. All are dev-only ESLint tooling, from one transitive `minimatch` advisory ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)). `npm audit --omit=dev` gives 0. Track an upstream `eslint-config-next`/`typescript-eslint` bump, or an `overrides` pin once a patched `minimatch` line is compatible. Don't use `audit fix --force`, which downgrades to eslint@4.


## Citations

### [C1] — create-next-app's allowed files and folders
- **Relevant File(s):** `docs/Memorial Memories Site initial thinking.md`; `.env` (the reason for the temp-folder scaffold)
- **Change Summary:** Moving the doc into `docs/` doesn't block the scaffold. `.env` would, so the scaffold runs in a temp folder.
- **Source URL:** https://github.com/vercel/next.js/blob/v16.4.4/packages/create-next-app/helpers/is-folder-empty.ts#L7-L43
- **Verbatim Quote:**
  > `const validFilesOrFolders = [` … `'docs',` … `]` … ``The directory ${green(name)} contains files that could conflict:``
- **Justification:** `docs` is on the allowed list and `.env` isn't. That explains both P2 and the temp-folder design in P3.

### [C2] — create-next-app CLI options
- **Relevant File(s):** all scaffolded files
- **Change Summary:** The P3 flags.
- **Source URL:** https://nextjs.org/docs/app/api-reference/cli/create-next-app#reference
- **Verbatim Quote:**
  > "Explicitly tell the CLI to disable git initialization" · "Explicitly tell the CLI to skip installing packages" · "Initialize with Cache Components enabled (default for App Router)" · "Include `AGENTS.md` to guide coding agents (default)" · "Do not prepare anonymized Next.js feedback for your review"
- **Justification:** Each P3 flag maps to a documented option.

### [C3] — create-next-app makes its own commit unless git is disabled
- **Relevant File(s):** `.git/`
- **Change Summary:** `--disable-git`.
- **Source URL:** https://github.com/vercel/next.js/blob/v16.4.4/packages/create-next-app/helpers/git.ts#L29-L46
- **Verbatim Quote:**
  > `execSync('git init', { stdio: 'ignore' })` … `execSync('git commit -m "Initial commit from Create Next App"', {`
- **Justification:** Without the flag, a `.git` folder would be created in the temp folder and copied into the project, and the first commit wouldn't be ours.

### [C4] — Recommended defaults and the Node requirement
- **Relevant File(s):** `package.json`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `app/`, `AGENTS.md`
- **Change Summary:** Use the recommended defaults and check Node ≥ 20.9.
- **Source URL:** https://nextjs.org/docs/app/getting-started/installation#quick-start (also #system-requirements)
- **Verbatim Quote:**
  > "`--yes` skips prompts using saved preferences or defaults. The default setup enables TypeScript, Tailwind CSS, ESLint, App Router, and Turbopack, with import alias `@/*`, and includes `AGENTS.md` to guide coding agents to write up-to-date Next.js code."
  > "Minimum Node.js version: 20.9"
- **Justification:** The P3 flags reproduce these defaults, and P0 checks Node.

### [C5] — Saved preferences, unknown flags, and the bundler in create-next-app 16.4.4
- **Relevant File(s):** all scaffolded files
- **Change Summary:** Pass every option explicitly, and add no bundler flag.
- **Source URL:** https://github.com/vercel/next.js/blob/v16.4.4/packages/create-next-app/index.ts#L90 (also #L131, #L420-L428, #L797)
- **Verbatim Quote:**
  > `.option('--yes', 'Use saved preferences or defaults for unprovided options.')`
  > `// If not using the recommended template, we prefer saved preferences, otherwise defaults.`
  > `.allowUnknownOption()`
  > `const bundler: Bundler = opts.rspack ? Bundler.Rspack : Bundler.Turbopack`
- **Justification:**
  - With `--yes`, any option left out comes from saved preferences, and this machine has `srcDir: true` saved. So every option is passed explicitly.
  - A `--turbopack` flag would be silently ignored, and Turbopack is already the default.

### [C6] — The scaffold gitignores `.env*` and `.vercel`
- **Relevant File(s):** `.gitignore`, `.env`, `.env.local`, `.vercel/`
- **Change Summary:** Rely on the scaffold's `.gitignore` and verify it in P9.
- **Source URL:** https://github.com/vercel/next.js/blob/v16.4.4/packages/create-next-app/templates/app-tw/ts/gitignore#L33-L37 (also https://nextjs.org/docs/app/guides/environment-variables, the warning above #loading-environment-variables)
- **Verbatim Quote:**
  > `.env*` · `.vercel`
  > "The default `create-next-app` template ensures all `.env` files are added to your `.gitignore`. You almost never want to commit these files to your repository."
- **Justification:** `.env` holds live secrets. P9's gates abort if it's staged or not ignored.

### [C7] — How Next.js loads `.env` files, and in what order
- **Relevant File(s):** `.env`, `docs/environment.md`
- **Change Summary:** All keys go in `.env`. Document that `.env.local` takes precedence.
- **Source URL:** https://nextjs.org/docs/app/guides/environment-variables#loading-environment-variables (also #environment-variable-load-order)
- **Verbatim Quote:**
  > "Next.js has built-in support for loading environment variables from `.env*` files into `process.env`."
  > "Environment variables are looked up in the following places, in order, stopping once the variable is found." … "3. `.env.local`" … "5. `.env`"
- **Justification:** This is why keys added to `.env` work, and why P15 keeps `VERCEL_OIDC_TOKEN` only in `.env.local`, avoiding two copies where the stale one could shadow the other.

### [C8] — Install the Neon serverless driver
- **Relevant File(s):** `package.json`, `package-lock.json`
- **Change Summary:** `npm install --save-exact @neondatabase/serverless@1.2.0`.
- **Source URL:** https://neon.com/docs/serverless/serverless-driver#install-the-neon-serverless-driver
- **Verbatim Quote:**
  > "Install with `npm install @neondatabase/serverless`; TypeScript types are bundled."
- **Justification:** This is the documented install command, pinned for reproducibility.

### [C9] — Env vars the Neon–Vercel integration sets
- **Relevant File(s):** `.env`, `docs/environment.md`
- **Change Summary:** Pull and document the Neon variables.
- **Source URL:** https://neon.com/docs/guides/vercel-managed-integration#environment-variables-set-by-the-integration
- **Verbatim Quote:**
  > "`DATABASE_URL` | Pooled connection string (PgBouncer)" · "`DATABASE_URL_UNPOOLED` | Direct connection string" · "`POSTGRES_*` (legacy) | Provided for backwards compatibility with Vercel Postgres templates"
- **Justification:** These are the names P12 verifies in Vercel and P15 appends to `.env`.

### [C10] — Neon preview branching
- **Relevant File(s):** none in the repo (P13 is a Vercel dashboard setting)
- **Change Summary:** Select Preview under "Create database branch for deployment".
- **Source URL:** https://neon.com/docs/guides/vercel-managed-integration#enable-automated-preview-branching-recommended
- **Verbatim Quote:**
  > "(Optional) Under **Create database branch for deployment**, select **Preview** to turn on _Preview Branching_ (see next section). Leave **Production** unchecked."
  > "Developer pushes to feature branch → Vercel kicks off Preview Deployment." … "Neon creates branch `preview/<git-branch>`."
- **Justification:** This is the exact dashboard control in P13, and how its effect gets verified later.

### [C11] — Upgrade the Neon CLI the way it was installed
- **Relevant File(s):** none (global `/opt/homebrew/bin/neon`)
- **Change Summary:** `brew upgrade neonctl`.
- **Source URL:** https://neon.com/docs/cli/install#upgrade
- **Verbatim Quote:**
  > "Upgrade using the method that matches how you installed the CLI." · "The Homebrew formula is named `neonctl`, so install commands use that name even though you run the CLI as `neon`." · "The current CLI requires Node.js 20.19.0 or higher."
- **Justification:** It was installed with Homebrew. Upgrading through npm would add a second `neon` binary on PATH.

### [C12] — Update the Vercel CLI
- **Relevant File(s):** none (global `vercel` under nvm)
- **Change Summary:** `npm i -g vercel@65.9.0`.
- **Source URL:** https://vercel.com/docs/cli#updating-vercel-cli
- **Verbatim Quote:**
  > "If you have installed our command-line interface through [npm](http://npmjs.org/) or [Yarn](https://yarnpkg.com), the easiest way to update it is by running the installation command yet again."
- **Justification:** It was installed with npm. The version is pinned so P0's acceptance check matches.

### [C13] — `vercel link` with `--yes` and `--project`
- **Relevant File(s):** `.vercel/` (gitignored)
- **Change Summary:** Create and link `jowray.com`, whose name differs from the folder name.
- **Source URL:** https://vercel.com/docs/cli/link#project (also #yes)
- **Verbatim Quote:**
  > "The `--yes` option can be used to skip questions you are asked when setting up a new Vercel Project."
  > "In non-interactive usage, `--project` allows you to set a project that does not match the name of the current working directory."
- **Justification:** The folder is `jowray_com` but the project must be `jowray.com`. `--yes` sets the project up without prompts, inside the scaffold so Next.js is detected.

### [C14] — `vercel link` writes `VERCEL_OIDC_TOKEN` to `.env.local`
- **Relevant File(s):** `.env.local`, `docs/environment.md`
- **Change Summary:** Leave `.env.local` alone, and keep `VERCEL_*` out of `.env`.
- **Source URL:** https://vercel.com/changelog/preserve-local-environment-variables-when-linking-with-the-vercel-cli
- **Verbatim Quote:**
  > "The CLI now updates `VERCEL_OIDC_TOKEN` if it exists, or appends it if missing, without touching anything else."
- **Justification:** It explains the `.env.local` file that appears after P11, and why P15 skips `VERCEL_*` keys.

### [C15] — `vercel git connect`
- **Relevant File(s):** none (Vercel project setting)
- **Change Summary:** Connect `RobertdWray/jowray_com` to the Vercel project.
- **Source URL:** https://vercel.com/docs/cli/git#usage
- **Verbatim Quote:**
  > "Using the `vercel git` command to connect a Git provider repository from your local Git config to a Vercel Project."
  > "The `--yes` option can be used to skip connect confirmation."
- **Justification:** P10 sets `origin`, and P11 connects it, so the P16 push deploys.

### [C16] — `vercel integration add`
- **Relevant File(s):** none (Neon resource), plus the env vars in Vercel
- **Change Summary:** Provision the Neon database non-interactively, without pulling env.
- **Source URL:** https://vercel.com/docs/cli/integration#vercel-integration-add
- **Verbatim Quote:**
  > "In non-interactive environments (CI pipelines, scripted usage), provide required options via flags."
  > "`--environment` … Defaults to all three built-in environments."
  > "`--no-env-pull` … Skip running `vercel env pull` after provisioning."
  > (CLI `--help`) "auth (true/false) … Default: true" · "Options: cle1, iad1, pdx1, fra1, lhr1, syd1, sin1, gru1"
- **Justification:**
  - The flags make P12 deterministic.
  - `auth=false` overrides the default that would enable Neon Auth.
  - `--no-env-pull` lets P15 merge the values append-only.

### [C17] — `vercel env pull [file]`
- **Relevant File(s):** `.env` (through a temp file)
- **Change Summary:** Pull the development env into a private temp file, then append missing keys to `.env`.
- **Source URL:** https://vercel.com/docs/cli/env#exporting-development-environment-variables
- **Verbatim Quote:**
  > "The `vercel env pull` sub-command will export development environment variables to a local `.env` file or a different file of your choice."
- **Justification:** Pulling to a separate file means the tool never rewrites the `.env` that another agent is editing.

### [C18] — Vercel's default function region
- **Relevant File(s):** none (Neon region choice)
- **Change Summary:** Neon region `iad1`.
- **Source URL:** https://vercel.com/docs/functions/configuring-functions/region#setting-your-default-region
- **Verbatim Quote:**
  > "The default Function region is [*Washington, D.C., USA* (`iad1`)](/docs/pricing/regional-pricing/iad1) **for all new projects**."
- **Justification:** Putting the database next to the functions keeps latency low. It also matches Rob's other databases in us-east-1.

### [C19] — Gemini API key variable
- **Relevant File(s):** `.env`, `docs/environment.md`
- **Change Summary:** Add a `GEMINI_API_KEY` placeholder.
- **Source URL:** https://ai.google.dev/gemini-api/docs/api-key#set-api-env-var
- **Verbatim Quote:**
  > "Set the environment variable `GEMINI_API_KEY` or `GOOGLE_API_KEY`. The Gemini API client libraries automatically detect and use these variables. If both are set, `GOOGLE_API_KEY` takes precedence."
- **Justification:** It's the documented name, and only one of the two is set, so precedence isn't ambiguous.

### [C20] — ElevenLabs API key variable
- **Relevant File(s):** `docs/environment.md` (the key already exists in `.env`)
- **Change Summary:** Document `ELEVENLABS_API_KEY`.
- **Source URL:** https://elevenlabs.io/docs/eleven-api/quickstart#create-an-api-key
- **Verbatim Quote:**
  > "Store the key as a managed secret and pass it to the SDKs either as an environment variable via an `.env` file" … `ELEVENLABS_API_KEY=<your_api_key_here>`
- **Justification:** It confirms Rob's existing key name. P15 skips it because it's already present.

### [C21] — Sentry API: create a project
- **Relevant File(s):** none (Sentry project `med3ai/jowray_com`)
- **Change Summary:** POST with an explicit slug, platform, and default rules.
- **Source URL:** https://docs.sentry.io/api/projects/create-a-new-project/
- **Verbatim Quote:**
  > "POST /api/0/teams/{organization\_id\_or\_slug}/{team\_id\_or\_slug}/projects/"
  > "Uniquely identifies a project and is used for the interface. If not provided, it is automatically generated from the name."
  > "`project:admin`" · "`project:write`"
- **Justification:** P14 calls this endpoint with a token that has `project:write`, and pins the slug.

### [C22] — Sentry client keys (DSN), and DSNs aren't secrets
- **Relevant File(s):** `.env`; `$STATE/sentry-dsn.txt`
- **Change Summary:** Fetch the DSN and store it as a real value.
- **Source URL:** https://docs.sentry.io/api/projects/list-a-projects-client-keys/ (also https://docs.sentry.io/security-legal-pii/security/token-formats/#excluding-dsns)
- **Verbatim Quote:**
  > "GET /api/0/projects/{organization\_id\_or\_slug}/{project\_id\_or\_slug}/keys/"
  > "DSNs aren't secrets, so leave them out of secret scanning rules."
- **Justification:** It's safe to keep the DSN in the state folder and to write it into `.env` as a real value.

### [C23] — Sentry token types
- **Relevant File(s):** none (choosing the token for P14); `docs/environment.md`
- **Change Summary:** Use the personal token once. Future CI should use an org token.
- **Source URL:** https://docs.sentry.io/account/auth-tokens/#types-of-auth-tokens
- **Verbatim Quote:**
  > "They have a limited set of permissions and are designed to be used in CI environments and with Sentry CLI."
  > "Organization tokens permissions aren't customizable."
  > "For example, to programmatically create a new project, you would use an internal integration."
- **Justification:** Org tokens can't create projects. The only capable token is a personal one, so it's used once and not copied. A future `SENTRY_AUTH_TOKEN` should be an org token (Bucket 4 #2).

### [C24] — A public env var for the Sentry DSN
- **Relevant File(s):** `.env`, `docs/environment.md`
- **Change Summary:** Name the key `NEXT_PUBLIC_SENTRY_DSN`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#initialize-sentry-sdks
- **Verbatim Quote:**
  > "Include your DSN directly in these files, or use a *public* environment variable like `NEXT_PUBLIC_SENTRY_DSN`."
- **Justification:** It's the documented name for when the SDK is configured later.

### [C25] — Sentry auth token for CI
- **Relevant File(s):** `.env`, `docs/environment.md`
- **Change Summary:** Add a `SENTRY_AUTH_TOKEN` placeholder.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/#add-readable-stack-traces-with-source-maps
- **Verbatim Quote:**
  > "For CI/CD builds, set the `SENTRY_AUTH_TOKEN` environment variable in your build system instead."
- **Justification:** It reserves the documented name for future source-map uploads.

### [C26] — Auth.js v5 secret
- **Relevant File(s):** `.env`, `docs/environment.md`
- **Change Summary:** Add an `AUTH_SECRET` placeholder.
- **Source URL:** https://authjs.dev/getting-started/migrating-to-v5#environment-variables
- **Verbatim Quote:**
  > "The `AUTH_SECRET` environment variable is the only variable that is really necessary."
- **Justification:** It's the one key that phase 3 Auth.js needs.

### [C27] — Name the initial branch at `git init`
- **Relevant File(s):** `.git/`
- **Change Summary:** `git init -b main`.
- **Source URL:** https://git-scm.com/docs/git-init#Documentation/git-init.txt---initial-branchbranch-name
- **Verbatim Quote:**
  > "Use <branch-name> for the initial branch in the newly created repository. If not specified, fall back to the default name (currently master, but this will change to main when Git 3.0 is released)."
- **Justification:** `init.defaultBranch` isn't set on this machine, so a plain `git init` would create `master`.

### [C28] — `git check-ignore` doesn't report tracked files
- **Relevant File(s):** `.git/` index (P9 gate 1)
- **Change Summary:** Check `.env*` in the index directly, in addition to `check-ignore`.
- **Source URL:** https://git-scm.com/docs/git-check-ignore#_description
- **Verbatim Quote:**
  > "By default, tracked files are not shown at all since they are not subject to exclude rules"
- **Justification:** An ignore check alone can't prove `.env` is untracked, so `git ls-files` and the staged list are checked too.

### [C29] — `gh repo create` from an existing local repo
- **Relevant File(s):** `.git/config` (`origin`); the remote repo
- **Change Summary:** Create a private repo and set `origin`, without pushing yet.
- **Source URL:** https://cli.github.com/manual/gh_repo_create
- **Verbatim Quote:**
  > "To create a remote repository from an existing local repository, specify the source directory with --source." · "--private Make the new repository private" · "-r, --remote <string> Specify remote name for the new repository"
- **Justification:** It creates `RobertdWray/jowray_com` privately with `origin`. The push is left out so it happens after Vercel is connected (P16).

### [C30] — The `AGENTS.md` block that `next dev` manages
- **Relevant File(s):** `AGENTS.md`
- **Change Summary:** Append the project rules below the END marker.
- **Source URL:** https://github.com/vercel/next.js/blob/v16.4.4/packages/create-next-app/helpers/generate-agent-files.ts#L7-L17
- **Verbatim Quote:**
  > "This block is written and re-added by `next dev`" · `<!-- END:nextjs-agent-rules -->`
- **Justification:** Rules placed inside the block could be overwritten. Rules placed after the END marker are kept.

### [C31] — Relative links in the README
- **Relevant File(s):** `README.md`, `docs/environment.md`, `docs/plans/2026-11-02-bootstrap.md`
- **Change Summary:** Add a "Project docs" section with relative links.
- **Source URL:** https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes#relative-links-and-image-paths-in-markdown-files
- **Verbatim Quote:**
  > "You can define relative links and image paths in your rendered files to help readers navigate to other files in your repository."
- **Justification:** It makes the runbook copy, the environment doc, and the completion report easy to find from the repo's front page.

### [C32] — Neon's preview-branching test
- **Relevant File(s):** `docs/plans/2026-11-02-bootstrap-report.md` (the preview-branching status)
- **Change Summary:** Use the report PR's branch push as the functional check for P13.
- **Source URL:** https://neon.com/docs/guides/vercel-managed-integration#test-the-setup
- **Verbatim Quote:**
  > "To verify preview branching works:" … "3. Push: `git push`" … "4. Check Vercel deployments and Neon Console branches to confirm the preview branch was created"
- **Justification:** P17 step 7 follows this exact procedure with the `docs/bootstrap-report` branch. Branch creation is what moves the status from "setting enabled" to "verified".

### [C33] — `gh pr create`
- **Relevant File(s):** none (the PR on `RobertdWray/jowray_com`)
- **Change Summary:** Open the report PR non-interactively, with an explicit base, head, title, and body file.
- **Source URL:** https://cli.github.com/manual/gh_pr_create
- **Verbatim Quote:**
  > "-B, --base <branch> The branch into which you want your code merged" · "-H, --head <branch> The branch that contains commits for your pull request" · "-F, --body-file <file> Read body text from file"
- **Justification:** It makes the PR deterministic, and the body file carries the Bucket 3 and Bucket 4 notes.

### [C34] — Bash `trap` on `EXIT`
- **Relevant File(s):** the P15 temp file holding pulled secrets, and `$STATE/p15-tmpenv.txt`
- **Change Summary:** Register cleanup right after `mktemp`.
- **Source URL:** https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html#index-trap
- **Verbatim Quote:**
  > "If a sigspec is 0 or EXIT, action is executed when the shell exits."
  > "Any trap on EXIT is executed before the shell terminates."
- **Justification:** With `set -e`, a failed pull or merge exits the shell, and the trap still deletes the secret file. A hard kill skips traps, which is why the path is also recorded and P0 cleans it up.
