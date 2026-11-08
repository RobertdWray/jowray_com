# Notify correspondents: post-merge evidence (public-safe)

These are public-safe summaries of the checks recorded on 2026-11-08 after PR-2 and PR-1 merged ([notify plan](../../2026-11-07-notify-correspondents.md) §10 D1–D3, §8.10 S1). Only counts, commit SHAs and settings appear here. The raw outputs (replay segments, span dumps, ledgers and harvest outputs) are private on Rob's Mac. No token, share URL, name or email address appears in this file.

## Merges and deploy

| Item | Value |
|---|---|
| PR-2 [#91](https://github.com/RobertdWray/jowray_com/pull/91) (invite links, token privacy, replay unmasking) | merged 2026-11-08T02:07:47Z, `81fd36a` |
| Production migration `20261107120000_invites` | `finished_at` 2026-11-08T02:08:03Z, `rolled_back_at` null |
| PR-1 [#92](https://github.com/RobertdWray/jowray_com/pull/92) (harvester hardening, runbook) | merged 2026-11-08T02:23:07Z, `eba20e5` |
| Review | one Team Code Review round per PR (George + Oscar), the repairs, then an Opus regression review per PR: "no serious regressions" |

## D1: production `/s/` check

| Check | Result |
|---|---|
| `/s/<unknown 12-char token>` | 200; `Referrer-Policy: no-referrer`; `X-Robots-Tag: noindex, nofollow`; plain form, no greeting |
| Rehearsal invite (Rob's own non-Gmail address, separate private ledger) | created through `scripts/import-invites.ts --prod`: rows 1, created 1. Production `Invite` rows went from 0 to 1 |
| Prefill on production | greeting, prefilled email and the "Not you?" line present |
| GET never writes | `Invite` row count and a digest of (id, tokenHash, revokedAt) identical before and after four GETs |
| Sentry, release `eba20e5` | replay URL list shows `/s/[inviteToken]`; the token appears only in rrweb's Meta-event `href` (accepted residual R5); 0 occurrences in production spans; placeholders recorded unmasked |

## Preview check before merge (§11.3, PR #91 head `f651a6e`)

On the preview, the replays recorded the form placeholders unmasked, with 0 starred placeholder attributes. Before the change, the production replay had starred 6 of 6 (D16). A client navigation to `/s/<synthetic token>`: the replay URL list showed only `/s/[inviteToken]`, no recorded RSC network body contained the token, and the trace had 0 occurrences across the preview spans.

## S1: Sentry server-side scrubbing (R12 amended)

| Setting (project `jowray_com`) | Before | After (2026-11-08T02:43:40Z) |
|---|---|---|
| `dataScrubber` | true | false |
| `dataScrubberDefaults` | true | false |
| `sensitiveFields`, `safeFields`, `scrubIPAddresses`, `relayPiiConfig` | empty, empty, false, none | unchanged |

The organisation-level scrubbing was already off. A synthetic event (environment `s1-check`) whose story contained the word "author" arrived as `[Filtered]` before the switch and verbatim after it. After the switch, a production pageload of the rehearsal link still showed the token only in the replay's Meta-event `href`, and 0 times in 16 `POST /s/[inviteToken]` spans and in the other production spans. Rollback: set both flags back to `true`.

## D2: WAF

Rule "Public paths rate limit": before, 4 path prefixes (`/share`, `/api/upload`, `/api/media/`, `/m/`); after, 5 (`+ /s/`). The action is unchanged: `rate_limit`, 1200 requests per 600 s, fixed window, IP key. The firewall diff before publishing showed only the added `/s/` condition, and no changes were pending afterwards.

## D3: harvest

Two real harvests of both accounts, plus a run of the merged harvester into a separate private folder, gave identical counts, each in under a minute, with counts-only console output. Household display names are excluded automatically, and no household alias was found. A batch of Sent-folder messages with no From header, all written within three minutes on 2026-11-06, is correctly ignored. The family review (D4) and the steps after it have not been done.
