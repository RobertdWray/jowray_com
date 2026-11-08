# Notify correspondents

Prepare a family-reviewed list, personal invite links and a paced Thunderbird send. This runbook ships with PR-1. The importer and `/s/` page come from PR-2; their presence here is not evidence that they are deployed.

**Stop line (R1): nothing for a correspondent is ever queued until the operator explicitly picks go-day.** Readiness ends with the hold on, Send Later's scheduled list empty and Outbox empty. The only scheduled exception during preparation is the dress rehearsal: exactly two messages to `<REHEARSAL_TO>`, one from each account, with Cc `<ROB_GMAIL>`.

The [plan](./plans/2026-11-07-notify-correspondents.md) is the design record. Its execution ledger is frozen; use the live ledger named in its banner for current status. Source citations below are the plan's 2026-11-07 records, not a fresh compatibility check. Keep names, addresses, subjects, tokens, row-level evidence and actual campaign totals out of this public repo and chat.

## 1. Order of operations

These D1–D9 labels mean **readiness steps in plan §10**, not the separate design calls in §2. PR-2 merges first, then PR-1. Harvest and family review may start once the hardened harvester is integrated, while deployment work continues.

| You are here | Do next | Evidence needed before advancing |
|---|---|---|
| D1 — production | Verify the expected production deployment and Invite migration. Import one invite for `<REHEARSAL_TO>` into `invites_rehearsal.csv`. | Deployment status is `success` for the expected merge SHA; migration `finished_at` is set and `rolled_back_at` is null. `/s/<token>` has `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex, nofollow`; unknown tokens show the plain form. The rehearsal link prefills correctly. A GET does not change database row counts. Sentry uses `/s/[inviteToken]` without the bare token. |
| D2 — protection | Follow plan §10 D2 with approval for the WAF publish. | No unrelated staged firewall changes. Before/after inspection retains `/share`, `/api/upload`, `/api/media/`, `/m/` and adds `/s/`. Action stays `rate_limit` (429), 1200 requests per 600 seconds, fixed window, IP key. Both public forms still load. |
| D3 — harvest | Finish offline sync, quit Thunderbird, run the harvester in the background. | Private outputs exist; resolve missing-mail warnings and check account attribution. |
| D4 — family review | Review people and export a separate UTF-8 copy. | Family approval of the final rows, names and sending accounts. |
| D5 — send list | Run `send-list`. | Exit 0; reconcile its deduplicated row total with the approved selections. |
| D6 — invite import | Obtain the operator's explicit go-ahead for this production import, then run `import-invites`. | Every approved email has a ledger entry; production count readback reconciles with the approved list. A `created` count alone is not enough. |
| D7 — Thunderbird | Install and record versions; set the hold, local drafts and late limit; test OAuth; save templates. | One OAuth test per account arrives at `<ROB_GMAIL>`; settings, SMTP details and recovery-method holders are recorded privately. |
| D8 — rehearsal | Follow [the rehearsal](#dress-rehearsal-d8) below. | Exactly two scheduled test messages arrive with working links; hold restored; scheduled list and Outbox empty. |
| D9 — ready, then STOP | Write `~/jo-mail-review/evidence/ready.md` privately. | PRs deployed, migration verified, `/s/` and token checks passed, WAF checked, replay unmasking verified, family review and import complete, templates saved, rehearsal passed. Attest that no correspondent message is queued, both queues are empty and the hold is on. |
| Go-day — separate approval | Complete [go-day morning](#11-go-day-morning). | Final copy and Spend Management decision; fresh OAuth tests; fresh schedules; merge gate passed before releasing the hold. |

PR-3 records the rehearsal evidence and fills in the final section of this runbook (D28). Readiness does not authorize go-day.

## 2. Prerequisites

This is the local checklist for issue #59 §5.1–§5.6, §5.9 and §5.10, using the facts recorded on 2026-11-07. Recheck the machine before operating it.

| Requirement | Check |
|---|---|
| Thunderbird | The plan records **159.0**. Record the installed version again before adding extensions. |
| Both accounts | Configure `<PRIMARY_HOTMAIL>` and `<SECOND_HOTMAIL>`. Identify each account's local folder in Account Settings; do not infer the address from the server-folder suffix. |
| Offline mail | Under Account Settings → Synchronization & Storage, enable **“Keep messages for this account on this computer”** for both accounts [C2]. Include Inbox, Sent and Archive; wait for downloads to finish, then quit Thunderbird before harvesting. An `.msf` index alone is not downloaded mail. |
| Profile | Find the active profile, not an old one. macOS uses `~/Library/Thunderbird/Profiles/*/ImapMail/`; the plan records `outlook.office365.com` and `outlook.office365-1.com` beneath it. Mozilla names “~/Library/Thunderbird/ for Mac OS X.” [C1]. |
| Python | **Python 3.9+**; the harvester uses only the standard library and reads mail files without changing them. |
| Importer | **Node 26**, installed dependencies and PR-2's `scripts/import-invites.ts`. If `node -v` is not v26, put `/opt/homebrew/bin` first on `PATH`. |
| Addresses and exclusions | `<REHEARSAL_TO>` is an operator-controlled address other than Gmail. Put the operator's addresses, already-notified people and other exclusions in the private exclusion file. It accepts one address or domain per line and `#` comments. |
| Delivery evidence | Access to both Microsoft accounts, their recovery methods and `<ROB_GMAIL>`; Gmail inbox placement of the Cc is part of the rehearsal gate. |
| Private storage | `~/jo-mail-review` and `evidence/` are **0700**; `notify.env`, exclusions, CSVs, logs and ledgers are **0600**. They stay outside every git worktree. |

Create the private shell file without printing or overwriting its values:

```bash
( umask 077
  mkdir -p ~/jo-mail-review/evidence
  chmod 700 ~/jo-mail-review ~/jo-mail-review/evidence
  touch ~/jo-mail-review/notify.env
  chmod 600 ~/jo-mail-review/notify.env
)
```

Populate `notify.env` privately with shell-quoted assignments. Variable names only are documented here:

| Variable | Purpose |
|---|---|
| `PRIMARY_HOTMAIL`, `SECOND_HOTMAIL` | The two sending accounts, always passed in this order. |
| `ROB_GMAIL`, `REHEARSAL_TO` | Cc canary and rehearsal recipient. |
| `HOUSEHOLD_NAMES` | Optional; may be empty. Household display names separated by `\|`; the harvest command turns each non-empty value into a separate `--household-name`. |
| `EXCLUDE_FILE` | Absolute path to the private exclusion file. |
| `TB_PROFILE` | Absolute path to the active Thunderbird profile, without `/ImapMail`. |
| `MAIN_CHECKOUT_ENV` | Absolute path to the main checkout's existing `.env`, used only by the importer. Never copy `.env` into a worktree. |
| `SEND_START` | On go-day only: a future local time in `YYYY-MM-DD HH:MM` format. Refresh immediately before each merge. |

The main checkout's env supplies `ADMIN_API_SECRET` and `MEMORIAL_SLUG`; the server's site origin must be `https://www.jowray.com`. See [environment handling](./environment.md). `ADMIN_API_URL` must be unset in both the shell and env file when using `--prod`; for local testing it replaces `--prod` and must match the server's link origin exactly (for example `http://localhost:3000`).

Run the following blocks **in Bash, from the repo root**. Source only the trusted private env file. Do not enable shell tracing, echo its values, use `--verbose`, or paste private outputs into chat. Missing required private values are a stop: obtain them from the operator instead of guessing.

## 3. Data flow

`rank` → family review → `send-list` → `import-invites` and its ledger → **go-day only** `schedule` → Mail Merge. None of the command-line tools sends email. `schedule` creates files; Mail Merge creates the scheduled drafts.

### 3.1 Harvest (D3)

“Rank” is the default operation, **not a literal `rank` subcommand**. Keep the `--self` order fixed. Quit Thunderbird so it cannot compact mail during the read. The block starts a background job and waits for its exit status; leave it running until complete.

```bash
( set -a; . ~/jo-mail-review/notify.env; set +a
  set -e
  umask 077
  : "${PRIMARY_HOTMAIL:?}" "${SECOND_HOTMAIL:?}" "${TB_PROFILE:?}"
  : "${EXCLUDE_FILE:?}"
  IFS='|' read -r -a notify_household_names <<< "${HOUSEHOLD_NAMES:-}"
  notify_name_args=()
  for notify_name in "${notify_household_names[@]}"; do
    if [ -n "$notify_name" ]; then
      notify_name_args+=(--household-name "$notify_name")
    fi
  done
  python3 scripts/notify/rank_correspondents.py \
    --self "$PRIMARY_HOTMAIL" --self "$SECOND_HOTMAIL" \
    "${notify_name_args[@]}" --exclude "$EXCLUDE_FILE" \
    --out ~/jo-mail-review \
    "$TB_PROFILE/ImapMail/outlook.office365.com" \
    "$TB_PROFILE/ImapMail/outlook.office365-1.com" \
    > ~/jo-mail-review/evidence/harvest.log 2>&1
) &
notify_harvest_pid=$!
wait "$notify_harvest_pid"
```

It writes `correspondents.csv` (UTF-8 **with BOM** for Excel), `mail.sqlite` and `evidence/household-names.txt`, all 0600. It rebuilds the database and original ranking on each run; keep the reviewed copy separate. All three are prepared in private temporary files before any final file is replaced atomically; a failed read or write leaves the previous complete files in place. `evidence/` is always secured to 0700, including when it already exists; parents of `--out` are never chmodded. The 0600 `evidence/harvest.log` contains aggregate counts, year range, elapsed time, neutral output labels and warnings, not per-person lines. `--top` prints personal rows only with `--verbose`; do not use that option for this workflow.

If `correspondents_reviewed.csv` already exists, a later harvest rerun rewrites `correspondents.csv` but never the reviewed copy; the operator or orchestrator carries decisions forward privately by matching email and merging `notify` marks and edited names into the new file, never by row position.

The household-name file records observed display names and their counts. Review it privately, add missing full household names to `HOUSEHOLD_NAMES`, then rerun before family review. One-word or otherwise unusable name keys are ignored and counted. `--household-name` prevents household aliases under those names appearing as correspondents. Optionally add `--contacts` with a private address-book CSV for better names and address-book flags.

The tool refuses no messages, invalid options, invalid household addresses, inaccessible inputs and outputs inside git. Correct the path, sync or permissions; keep output outside git. **Warnings about indexed but undownloaded folders, no household-sent mail or unlisted senders need investigation even when exit status is 0.** Check Sent downloads and the account mapping before accepting the ranking. Default console output is aggregate, not a per-account folder mapping; verify that mapping privately in Thunderbird and the local database.

Missing mail path arguments refuse the harvest before any mail is read. Unreadable mail files or subdirectories also refuse it, reporting only the count, before replacing prior outputs. All three commands refuse symlinked output paths, including `mail.sqlite` sidecars, `evidence/` and its household-name file, send lists and `schedule.log`; correct the output location before retrying.

When the harvest reports messages in outgoing folders whose sender is not a `--self` address ("check --self"), inspect those senders privately, for example with `sqlite3` on `mail.sqlite`, never in chat; if one is a household alias, record it privately and resolve it before family review.

### 3.2 Family review (D4)

```bash
( set -a; . ~/jo-mail-review/notify.env; set +a
  open -a "Microsoft Excel" ~/jo-mail-review/correspondents.csv
)
```

Use Numbers instead if preferred. Mark `notify`, correct first and last names, confirm the email and sending account, remove businesses and lists, and add people the family knows are missing. Save a **copy** as `~/jo-mail-review/correspondents_reviewed.csv`, choosing **CSV UTF-8**. Preserve the header names. After saving, set its mode with `chmod 600 ~/jo-mail-review/correspondents_reviewed.csv`. Opening the sheet prints no counts; the app writes the reviewed file. Do not use the workbook format or legacy CSV export as input.

| Column | How to use it |
|---|---|
| `rank`, `score` | Review priority, not permission to send. Recent, direct and two-way correspondence weighs more; old messages decay. |
| `notify` | An explicit family choice. Blank means do not send. |
| `first_name`, `last_name`, `name` | Suggested greeting, surname and observed display name. Fix them; the importer requires a nonempty first name, but a blank last name is allowed. Align `name` with the corrected names for any template that uses it. |
| `email` | Suggested recipient address; check it is still the right one. The older header `send_to` is also accepted. |
| `account`, `account_basis` | Suggested sending account and strongest attribution basis; see below. |
| `she_wrote` | Outgoing-message count. Correspondence initiated by the household is useful evidence of a real relationship. |
| `she_wrote_direct` | Outgoing messages with at most three recipients. More useful than a chain-forward count. |
| `they_wrote` | Incoming non-bulk, non-automated messages counted for the person. Inbound volume alone does not make a vendor a friend. |
| `first_year`, `last_year`, `years_active` | Earliest and latest observed year, and distinct years with activity. |
| `other_addresses`, `names_seen` | Possible aliases and observed name variants. Shared full names are grouped, so check that distinct people have not been combined. |
| `recent_subjects` | Header-only context for identifying a relationship. Read privately; never copy subjects into this repo. |
| `flags` | `two-way`, `in her address book`, `address book only`, `mailing list: one email reaches the group`, or `looks automated`. Inspect flags; they are hints, not approvals. |

Accepted positive marks, ignoring case and surrounding whitespace: **`y`, `yes`, `x`, `1`, `true`, `✓`, `✔`, `✅`, `☑`**. Blank, `n`, `no`, `0`, `false` and `-` mean no. Other marks cause a refusal. Blank trailing rows are ignored. The reader removes a BOM and a leading apostrophe only when it guards `=`, `+`, `-`, `@`, their full-width forms, tab, CR or LF. A genuine leading apostrophe in a name survives. It does not silently approve a comment in `notify`.

**Account attribution (D24):** each message uses household From first, then household To, then Cc, then `Delivered-To` / `X-Original-To`, then the source folder. Ties use `--self` order. Folder attribution is inferred from other headers in that source root; without evidence it falls back to the primary account. The person's `account` is the higher weighted account score, with the same tie rule; `account_basis` is its strongest basis (`from`, `to`, `cc`, `delivered`, `folder`). Address-book-only rows can have `none`. Privately review **every `folder` and `none` row** and correct `account` to the address the recipient knew. It must be one of the two configured accounts.

Added people need `notify`, `first_name`, `email` and `account`; surname is optional. Give them a deliberate numeric rank if order matters. Rows without a numeric rank sort after ranked rows.

### 3.3 Create the plain send list (D5)

```bash
( set -a; . ~/jo-mail-review/notify.env; set +a
  python3 scripts/notify/rank_correspondents.py send-list \
    ~/jo-mail-review/correspondents_reviewed.csv \
    --self "$PRIMARY_HOTMAIL" --self "$SECOND_HOTMAIL" \
    --out ~/jo-mail-review
)
```

It prints the selected, deduplicated count and a neutral filename, plus the dropped-duplicate count only when duplicates were dropped. It writes `send_list.csv` (0600, UTF-8 **without BOM**), with `email,first_name,last_name,name,account`, in rank order. Addresses are trimmed and lower-cased. Repeated recipients, including Gmail dots, `+tags` and `googlemail.com` spellings of one inbox, collapse to the first ranked row, even if accounts differ. The emitted address keeps that row's trimmed, lower-cased spelling for the importer and ledger join; reconcile the count with the family's selections. A private temporary file is written and synced before atomically replacing the send list, so a failed write leaves the previous complete file. The reviewed input is unchanged, so this step is safe to rerun before scheduling.

It refuses missing/duplicate headers, malformed CSV, unknown approval marks, no selected rows, invalid email, empty first name, unknown account, household (`--self`) recipients including canonical aliases, control or line-separator characters in any output field (including CR, LF, tab, U+0085, U+2028 and U+2029), symlinked outputs, input/output collisions and an output folder inside git. Diagnostics identify ranks or row numbers, not people. Correct the reviewed copy and export again. `--out` is a **directory**, not a CSV path. `--gap`, `--hours` and `--start` here fail with **“use `schedule`”**; leave timing until go-day.

### 3.4 Import invite links (D6)

**Obtain explicit approval for the production import first.** D1 and D2 must pass. This uploads approved names and emails; it does not send mail. Run from a checkout containing PR-2's importer.

```bash
( set -a; . ~/jo-mail-review/notify.env; set +a
  export PATH="/opt/homebrew/bin:$PATH"
  npx tsx --env-file="$MAIN_CHECKOUT_ENV" scripts/import-invites.ts \
    --prod --in ~/jo-mail-review/send_list.csv \
    --ledger ~/jo-mail-review/invites.csv
)
```

The importer validates all rows and any existing ledger before posting. If rows are missing from the ledger, a bearer-protected **GET `/api/admin/invites`** checks the server's `memorialSlug` and `siteUrl` against the requested memorial and exact target origin **before any POST**. POST responses must attest to the same binding. A rerun with every row already in the ledger makes no network call; it is not a fresh production health check.

The 0600 ledger begins with `# target=https://www.jowray.com memorial=<MEMORIAL_SLUG>`, followed by `email,share_url`. Each private row maps `<email>` to `https://www.jowray.com/s/<token>`. Never hand-fill tokens or print the file. The ledger is logically append-only: each successful batch atomically replaces it with all prior entries plus new ones. Only emails absent from it are posted. Preserve it: the database stores token hashes, so it cannot recover a lost raw link.

Successful console output contains only `rows`, `already in ledger`, `created`, `rotated` and `posted batches` counts. The final check is that **every approved row has an entry**, plus a production readback, not that every row was newly created.

| Refusal | Resolution before retrying |
|---|---|
| Missing env, conflicting target options, or server memorial/origin mismatch | Check `ADMIN_API_SECRET`, `MEMORIAL_SLUG`, `--prod` versus `ADMIN_API_URL`, deployment and server site origin. Do not relabel a ledger to force it through. |
| Input/ledger inside git, unreadable input, or ledger not a regular 0600 file | Use the private directory and correct permissions. Existing ledger symlinks are refused. |
| Bad CSV, duplicate email, blank first name or invalid invite fields | Correct the approved input. Blank last names are accepted. |
| Wrong ledger binding, invalid link/token, duplicate ledger email/link or malformed server response | Stop and investigate the source or deployment; do not invent a replacement link. |
| `exists` with no ledger entry | The server has only a hash. Use the recovery procedure below; rotation is allowed only before sending. |
| `revoked` row | Stop. Review the revocation with the operator; do not bypass it with rotation. Valid new links from a mixed response are saved before this refusal. |
| Leftover `.invite-ledger-*.tmp` or an atomic-write/durability error | Keep all files private. Inspect and preserve possible issued links before removing a leftover and retrying. A post-rename error may leave a complete new ledger. |

For an interrupted POST, invalid response or ledger write failure, the tool may say:

> The server may have issued invites for this batch. Re-run the same command without --rotate-missing first; use --rotate-missing only before any message has been sent.

Follow that order. If a retry reports an existing invite with no ledger entry, first look for the recoverable private ledger. Only before any message is sent may the same command add `--rotate-missing`. It rotates **missing ledger entries only**, not links already saved. Keep production and rehearsal ledgers separate. Never delete the ledger to force a fresh import.

For D1, privately prepare a **one-row** `rehearsal_primary.csv` with the send-list columns, recipient `<REHEARSAL_TO>` and account `<PRIMARY_HOTMAIL>`. Use the same import command with `--in ~/jo-mail-review/rehearsal_primary.csv --ledger ~/jo-mail-review/invites_rehearsal.csv`. This is the single invite reused by the rehearsal, not an import of correspondents.

### 3.5 Schedule files — go-day only

Do not run this on the correspondent list during readiness. Immediately before each go-day merge, set `SEND_START` privately to a future local time and run:

```bash
( set -a; . ~/jo-mail-review/notify.env; set +a
  python3 scripts/notify/rank_correspondents.py schedule \
    ~/jo-mail-review/send_list.csv \
    --ledger ~/jo-mail-review/invites.csv \
    --self "$PRIMARY_HOTMAIL" --self "$SECOND_HOTMAIL" \
    --target https://www.jowray.com --start "$SEND_START" \
    --gap 30-90 --hours 9-19 --pace per-account \
    --out ~/jo-mail-review
)
```

It prints row counts per neutral file and a log-write count. It writes `send_list_primary.csv` and `send_list_second.csv` (0600, UTF-8 without BOM), including a header-only file for an empty account. Columns are the plain send-list columns plus `share_url` and `send_at`. Times use local `YYYY-MM-DD HH:MM`. `schedule.log` (0600, logically appended) records the timezone name, seed, start, hours, pace and per-account counts/time ranges. Both account files and the old log plus new lines are prepared and synced in private temporary files before any final file is replaced atomically. A failed preparation leaves both previous account files and the log byte-identical. Inputs are unchanged.

Each file replacement is atomic; the set of replacements is not a filesystem transaction. An interruption during replacement can leave complete files from different runs. After any failed or interrupted run, reconcile and rerun successfully before using the files; never treat preserved old schedules as authorization to merge.

| Option | Choice for this campaign |
|---|---|
| `--self` | Primary first, second next, every time; this controls neutral filenames. |
| `--gap`, `--hours` | `30-90`, `9-19`. Gaps are random within the day; overnight gaps are longer. A start outside the window moves to its next opening. |
| `--pace` | `per-account`, the default. Each account has an independent clock. `combined` exists but is not R4's choice. |
| `--seed` | Optional reproducible timing; otherwise the generated seed is recorded privately. It does not track delivery. |
| `--target` | `https://www.jowray.com`, exactly matching the ledger origin. |

It refuses **any start in the past**, missing ledger entries, a bad/mismatched origin, malformed ledger/CSV, invalid selected rows (including control characters and household recipients), symlinked outputs or log, output/input collisions and output inside git. Fix the cause; refresh the start immediately before merging. Do not use `--allow-missing-share-url` or a git-guard override for this workflow. A failed run is not permission to use old schedule files.

The scheduler requires a memorial field in the ledger header but **does not compare it with `MEMORIAL_SLUG`**; it checks the target and link prefix. Preserve the importer-validated ledger and privately confirm `<MEMORIAL_SLUG>` before scheduling. It also deduplicates recipient emails. It has no knowledge of sent or already queued mail: never re-merge a file just because it was regenerated. Reconcile first ([F9/F10](#7-emergency-stop-and-overdue-mail)).

## 4. Thunderbird setup (D7; design calls D10/D19)

| Component | Recorded version and compatibility |
|---|---|
| Mail Merge | **11.6.1**; listing: “Works with Thunderbird 128.0a1 - 160.*” [C7]. |
| Send Later | **10.7.8**; listing: “Works with Thunderbird 126.0 - 160.*” [C11]. It schedules drafts for later delivery [C9]. |

Record installed versions privately. If they differ, verify their behavior before proceeding; the following mode choice was checked against the 11.6.1 package.

1. In Send Later preferences, set **“Check every # minutes” = 0**. This is the hold. The docs say it “won't deliver scheduled drafts when their time comes” [C52]. Keep it on throughout setup. Open the preferences and read back **“Check every # minutes” = 0 immediately before every merge, after any Thunderbird restart and after any add-on update**. If the setting did not hold, **stop: do not merge; resolve it first**.
2. Enable **“Don't deliver messages more than 60 minutes late”** [C53].
3. Turn **off** the option that sends unsent Outbox mail. Record its **exact installed label** privately during installation; PR-3 adds the verified label here. Do not guess the label or proceed until that behavior is disabled.
4. For **each account**, go to Account Settings → Copies & Folders and put drafts in **Local Folders → Drafts**. This avoids Exchange IMAP stripping the scheduling headers.
5. Check each outgoing SMTP configuration uses OAuth2. Mozilla records: “Deprecated basic authentication (username/password), now requiring OAuth authentication.” [C15]. Send **one ordinary OAuth test per account to `<ROB_GMAIL>`**, and verify receipt. These are separate from the scheduled rehearsal. Privately record each account's SMTP host, OAuth2 setting and **who holds its recovery methods**. Do not record passwords or recovery codes here.
6. Make one plain-text template per account with the fields below, then **Save as Template**. Do not merge correspondent rows yet.

| Template field | Value |
|---|---|
| From | That template's account: `<PRIMARY_HOTMAIL>` or `<SECOND_HOTMAIL>`. |
| To | Must stay exactly `{{email}}`, the bare reviewed address. Do not add a display name such as `{{name}} <{{email}}>`. |
| Cc | `<ROB_GMAIL>` |
| Subject | `{{first_name}} - …`, followed by the operator's privately approved words. No real subject belongs in this runbook. |
| Body | Plain text in the operator's words. At most two full `https://www.jowray.com/` links: the obituary and `{{share_url}}`. |

The open [Send Later issue #798, "MacOS 14.8.3 TB 153.0.3 (aarch64) Settings not held, not functional"](https://github.com/Extended-Thunder/send-later/issues/798) is a reason to re-check the hold. The title alone does not establish behavior on this installation.

At rehearsal or go-day, read back the hold, open the matching saved template and set the Mail Merge dialog explicitly:

| Mail Merge field | Required value |
|---|---|
| Source / character encoding | CSV / UTF-8; use the generated file without a BOM. |
| File | `send_list_primary.csv` for the primary template; `send_list_second.csv` for the second. Confirm the intended output directory too. |
| **Deliver Mode** | **Save As Draft** |
| **Send Later** | **On** |
| **At** | **`{{send_at}}`** |

CSV column names become template variables [C8]; `At` accepts variables [C7]. Never re-export generated merge files through a spreadsheet that adds a BOM.

**Never choose Deliver Mode “Send Later.”** Mail Merge's page recommends:

> It is strongly recommended to use "Send Later" as "Deliver Mode" and to check the individual and personalized messages in the folder "Local Folders -> Outbox". [C6]

That recommendation concerns reviewing **unscheduled Outbox mail**. In Mail Merge 11.6.1 that mode calls `await messenger.compose.sendMessage(popup.id, { mode: "sendLater" });` [C50]. It does not apply a per-row schedule. The package exposes the `At` controls and writes `X-Send-Later-*` headers only in **Save As Draft** [C51]. Sending unsent Outbox mail could flush the entire batch. Recheck the dialog each time; its default is not this runbook's choice.

## 5. Post-merge gate — every merge

Open Send Later's preferences and read back **“Check every # minutes” = 0 immediately before every merge, after any Thunderbird restart and after any add-on update**. If the setting did not hold, **stop: do not merge; resolve it first** (see issue #798 in [setup](#4-thunderbird-setup-d7-design-calls-d10d19)). After the merge, confirm the hold still reads 0 and keep it there until all checks pass:

1. Send Later's scheduled count equals the rows merged, excluding CSV headers. Start from an empty list for the rehearsal and initial go-day merges. With an existing verified batch, reconcile its count and the added rows separately.
2. In **View → Message Source**, a sample from each account has **`X-Send-Later-At`**, with the intended time and account. Inspect recipient, Cc, greeting and links privately too. No merged row may be left as an ordinary unscheduled draft; a count mismatch stops the gate.
3. **Local Folders → Outbox = 0.**

If any check fails, keep the hold on. Check the merge mode, encoding, `At`, local Drafts location and selected account file. Reconcile the affected drafts before removing or re-merging them; do not blindly merge again. Only after the gate passes, and only for the authorized rehearsal or go-day, set **Check every = 1**.

## 6. Keep the sender awake

Keep Thunderbird running **with at least one main window open**. Send Later's macOS requirement is “there must be at least one main Thunderbird window open” [C10]; leaving the app running with all windows closed is not enough.

Keep the Mac on power, awake and connected, with its lid open. In a separate terminal run:

```sh
caffeinate -is
```

Leave that process running during delivery. It does not replace checking Thunderbird's window or network connection. Stop it with Ctrl-C after delivery is finished or held and reconciled.

## 7. Emergency stop and overdue mail

**Set Send Later's “Check every # minutes” to 0 immediately.** This holds future scheduled drafts; it cannot recall a message already handed to SMTP. Do not use Send Unsent Messages or release an unexpected Outbox.

With the 60-minute late limit enabled, Send Later warns about overdue mail and leaves it for manual rescheduling. Its docs say “leave them for you to reschedule by editing the relevant draft message by hand” [C53].

F9 and F10 are go-day follow-ups, not an automated delivery journal in these tools. Before any re-merge or late-message recovery, maintain a **private** `~/jo-mail-review/campaign.csv` (0600) identifying each row, its account, `send_at` and status: `merged`, `scheduled`, `sent`, `failed` or `unknown`. Reconcile it against the Send Later list, Outbox and **each account's Sent folder**. For every overdue row, check Sent before editing its draft. Reschedule by hand only when it is confirmed unsent, then record the new time and repeat the gate. **Unknown outcomes never auto-retry.** Resolve uncertainty before another merge.

## 8. Monitor

Watch the Cc copies in `<ROB_GMAIL>` and confirm they reach the **inbox**, not just the account. Check both sending accounts for bounces and replies. A Cc is a useful delivery canary and send log; it does not prove the correspondent received the other copy. Hold the send on authentication failures, unexpected bounces or spam placement while investigating.

If a reply contains a memory, use the existing [draft-on-behalf flow](./features/draft-on-behalf.md). Preserve the sender's words and follow that flow's approval and consent steps. Receiving an email is not consent to publish it.

## 9. Deliverability

R4 chooses **about 10 messages per day per account**, with independent **30–90 minute gaps** inside **09:00–19:00 local time**. The scheduler implements gaps and a window, not a hard daily message cap. Each Cc also counts as a recipient, roughly doubling the recipient volume per account.

Microsoft says “Limits may vary based on usage history and will be lower for non-subscribers” [C12]. It calls a non-relationship recipient “someone you've never sent email to before” [C13]. Use the account the person knew. This pace is an operational choice, not a published free-account allowance or a delivery guarantee.

Google advises: “Start with a low sending volume to engaged users, and slowly increase the volume over time.” [C14]. Keep the approved plain-text copy and link limit. Gmail inbox placement of the Cc is a readiness check; do not increase volume to work around a failure.

## 10. Before go-day

To revoke an invite, have the operator approve a SQL change setting that Invite's **`revokedAt`**, scoped to the intended memorial and email, with readback. There is no revoke button yet (F3). A revoked link stops prefilling; remove that recipient from the approved send list and reconcile any prepared files. Revocation alone does not cancel email already queued in Thunderbird.

`--rotate-missing` is only for missing-link recovery **before any message is sent**. It is not a resend operation. Never rotate the rehearsal link after its test messages have gone out. Keep every issued link in its private ledger.

**After the first correspondent send, fix forward only (D27).** Do not revert PR-2: delivered `/s/` links must keep working. Before go-day, the plan allows an approved PR-2 revert and restoration of the prior Sentry flags; re-prove readiness before sending after any rollback. Schedule regeneration does not cancel drafts already merged.

## 11. Go-day morning

1. Obtain an explicit go-day decision. Confirm the final message copy and the operator's separate Spend Management decision. Recheck D1–D9 evidence and establish the private F9 journal. Keep **Check every = 0**.
2. Send a **fresh OAuth test from each account to `<ROB_GMAIL>`** and confirm Gmail inbox arrival. Resolve authentication or recovery access problems before continuing.
3. Reconcile Send Later, Outbox and Sent. The initial campaign starts with no correspondent draft queued. Check the Mac's local timezone and clock.
4. Set a future `SEND_START` and rerun [schedule](#35-schedule-files--go-day-only) **right before each merge**. If the morning start has passed, choose a new future time; the command refuses past starts. Use the freshly generated file for the account being merged. Do not merge the other account's file twice when rerunning regenerates both files.
5. Open Send Later's preferences and read back **“Check every # minutes” = 0 immediately before every merge, after any Thunderbird restart and after any add-on update**. If the setting did not hold, **stop: do not merge; resolve it first**. Merge each account with **Save As Draft**, Send Later on, **At = `{{send_at}}`**. Keep the hold on while merging and run the post-merge gate after each merge. Reconcile the combined scheduled count before release.
6. With every gate passed, keep a main Thunderbird window open and `caffeinate -is` running, then set **Check every = 1**. Monitor Cc copies, bounces and replies; use the emergency stop when needed.

## Dress rehearsal (D8)

Do this before D9. Schedule **exactly two messages**, both To `<REHEARSAL_TO>` with Cc `<ROB_GMAIL>`, one per sending account. Use the one D1 invite already saved in `invites_rehearsal.csv`. No correspondent rows enter this rehearsal.

**Code difference from plan §10 D8:** one two-row input with the same recipient is deduplicated by `schedule`. Instead, privately save **two one-row UTF-8 CSVs**, `rehearsal_primary.csv` and `rehearsal_second.csv`, each with `email,first_name,last_name,name,account`. Both use the same rehearsal recipient and approved test name; their `account` values differ. Keep them 0600. Schedule separately into two directories so one pass cannot overwrite the other's output. Do not change the validation code or create another invite.

1. Set **Check every = 0**. Confirm Send Later's list and Outbox are empty and there are no leftover rehearsal drafts. Check the local Drafts settings and late limit.
2. Run during the 09:00–19:00 window with enough time for a start 15 minutes from now and both merges. The command below calculates that future local time; `--start` does not accept a literal `<now+15m>`. If setup runs past the start, regenerate before merging; if anything was already merged, reconcile it first.

```bash
( set -a; . ~/jo-mail-review/notify.env; set +a
  set -e
  umask 077
  notify_rehearsal_start=$(python3 -c 'import datetime as d; print((d.datetime.now() + d.timedelta(minutes=15)).strftime("%Y-%m-%d %H:%M"))')
  for notify_account in primary second; do
    python3 scripts/notify/rank_correspondents.py schedule \
      "$HOME/jo-mail-review/rehearsal_${notify_account}.csv" \
      --ledger ~/jo-mail-review/invites_rehearsal.csv \
      --self "$PRIMARY_HOTMAIL" --self "$SECOND_HOTMAIL" \
      --target https://www.jowray.com --start "$notify_rehearsal_start" \
      --gap 30-90 --hours 9-19 --pace per-account \
      --out "$HOME/jo-mail-review/rehearsal-${notify_account}"
  done
)
```

3. The primary pass writes one populated `rehearsal-primary/send_list_primary.csv`; the second pass writes one populated `rehearsal-second/send_list_second.csv`. Each pass also writes a header-only file for the other account and a private `schedule.log`. Merge **only the two populated files**, using their matching templates. Each directory is 0700; files are 0600. The console reports counts only.
4. Open Send Later's preferences and read back **“Check every # minutes” = 0 immediately before every merge, after any Thunderbird restart and after any add-on update**. If the setting did not hold, **stop: do not merge; resolve it first**. Use **Save As Draft**, Send Later on and **At = `{{send_at}}`**. Run the gate after each merge; the final scheduled count must be **two**, both account samples must have `X-Send-Later-At`, and **Outbox must be 0**.
5. Keep a main window open and `caffeinate -is` running. Set **Check every = 1**. Verify both messages arrive at `<REHEARSAL_TO>` and both Cc copies reach the Gmail **inbox**. Check the privately approved subject, greeting, From account, obituary link and working `/s/` prefill in each message.
6. **Set Check every = 0 again.** Confirm Send Later's scheduled list **and Outbox are empty** and no test draft remains. Reconcile Sent before retrying any uncertain delivery. Save screenshots and settings privately, with files 0600. Record the outcome in `evidence/ready.md`; then stop at R1.

## Source notes

The [plan §18](./plans/2026-11-07-notify-correspondents.md#18-citations) contains the full quotes and the package excerpts recorded on 2026-11-07. The source labels in this runbook refer to:

| Labels | Source |
|---|---|
| C1, C2 | Mozilla: [profiles](https://support.mozilla.org/en-US/kb/profiles-where-thunderbird-stores-user-data#w_moving-a-profile), [IMAP synchronization](https://support.mozilla.org/en-US/kb/imap-synchronization#w_configuring-synchronization-and-disk-space-usage). |
| C3–C5 | Python: [mbox](https://docs.python.org/3/library/mailbox.html#mailbox.mbox), [address parsing](https://docs.python.org/3/library/email.utils.html#email.utils.getaddresses), [unittest discovery](https://docs.python.org/3/library/unittest.html#unittest-test-discovery). These support the harvester, not mail-delivery readiness. |
| C6–C8 | [Mail Merge listing and usage](https://addons.thunderbird.net/en-US/thunderbird/addon/mail-merge/#addon-description). |
| C9–C11 | [Send Later purpose](https://github.com/Extended-Thunder/send-later#user-content-schedule-email-messages-to-be-sent-later), [main-window requirement](https://extended-thunder.github.io/send-later/#thunderbird-must-be-running-for-scheduled-messages-to-be-sent), [compatibility listing](https://addons.thunderbird.net/en-US/thunderbird/addon/send-later-3/). |
| C12, C13 | Microsoft: [Outlook.com sending limits](https://support.microsoft.com/en-us/outlook/sending-limits-in-outlook-com#what-are-the-outlookcom-email-limits). |
| C14 | Google: [increase sending volume slowly](https://support.google.com/mail/answer/81126?hl=en#increase-volume-slowly). |
| C15 | Mozilla: [Microsoft OAuth requirements](https://support.mozilla.org/en-US/kb/microsoft-oauth-authentication-and-thunderbird-202#w_changes-to-authentication). |
| C50, C51 | Plan §18's **Mail Merge 11.6.1 package** inspection: `content/dialog.js` lines 777, 419, 1150 and 1196. The mutable latest-download URL is not a version pin. |
| C52, C53 | [Send Later guide](https://extended-thunder.github.io/send-later/): hold and late-message preferences. |

## What scheduled looks like

**Placeholder — fill in after the successful rehearsal, in PR-3 (D28).** Add the verified installed option labels, where to read the scheduled count, and a public-safe illustration of a scheduled draft and its header. Keep original screenshots, recipients, subjects, tokens and actual campaign totals private. This placeholder is not evidence that the rehearsal has run.
