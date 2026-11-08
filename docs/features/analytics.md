# Vercel Web Analytics

Page-view analytics for Rob in the Vercel project dashboard. `SiteAnalytics` in `app/layout.tsx` covers every page the root layout renders (not the root error page, `app/global-error.tsx`, which has its own `<html>`), with URL scrubbing and event dropping to protect private claim and invite links.

**Status:** [PR #62](https://github.com/RobertdWray/jowray_com/pull/62) delivered analytics (merged 2026-11-06 as `73ac034`); [PR #64](https://github.com/RobertdWray/jowray_com/pull/64) added protection for token-bearing unmatched routes (merged into #62 on 2026-11-06 as `bb4a2e2`). There is no feature plan; the PR descriptions are the record. Deployment evidence is limited: `/_vercel/insights/script.js` answered 200 at 2026-11-07 01:07 UTC (404 in PR #62); at 2026-11-07 02:29 UTC both it and the per-project path the pages loaded, `/57754c27654861f8/script.js`, answered 200 with identical bytes; intake payload not checked. Page views arriving and use with real data are not verified.

The npm audit cleanup in #62 and #64's replacement of the ineffective zod override with a real bundled-code fix are recorded in [Dependencies](../dependencies.md).

## What we built

1. A visitor opens a page; the root layout renders `SiteAnalytics`, which loads Vercel's browser analytics through `@vercel/analytics/next`.
2. Before an event leaves, `scrubPageView` returns a scrubbed event or `null` to drop it.
3. Rob views collected page views in the project's Analytics dashboard once enabled; live intake still needs the F2 check below.

## Why we built it

To add page-view measurement without sending claim or invite credentials to analytics. [PR #62](https://github.com/RobertdWray/jowray_com/pull/62) explains that an unfiltered claim-page view would send its bearer token to Vercel, contrary to the [site's secret policy](../code-layout.md#sentry-alpha-data-policy-2026-11-04).

## Key decisions (Rob)

| Decision | Source |
|---|---|
| Adding analytics was delivered in PR #62 and accepted at merge. The supplied PR record contains no direct ruling from Rob authorizing the addition. | [PR #62](https://github.com/RobertdWray/jowray_com/pull/62), 2026-11-06 |
| Agent's implementation choices, accepted at merge: reuse `scrubUrl`; after review, reject unsafe raw paths instead of testing only the scrubbed URL, which misses upper-case and short segments. | [PR #64](https://github.com/RobertdWray/jowray_com/pull/64) and [PR #62's review comment](https://github.com/RobertdWray/jowray_com/pull/62), 2026-11-06 |

## How it works

`package.json` requests `@vercel/analytics` `^2.0.1`; `package-lock.json` resolves 2.0.1. `SiteAnalytics` passes `scrubPageView` as `beforeSend`.

| Field or input | Behaviour |
|---|---|
| URL (`url` in the hook, `o` on the wire) | `scrubUrl` replaces lower-case `/m/` followed by a run of at least 16 token characters with `/m/[claimToken]`. It also replaces case-insensitive `/s/` followed by at least 12 token characters with `/s/[inviteToken]`, including full invite URLs. Both patterns accept base64url characters and `%` to cover percent-encoded token characters. It removes lower-case `t=` and `key=` parameters from query strings or fragments, including `?t=` and `#key=`, and tidies their separators. Other parameters remain. |
| Route (`dp`) | The Next wrapper constructs it outside the hook: `/m/[claimToken]` or `/s/[inviteToken]` for the matched claim or invite route, but the raw pathname for a root not-found page. The hook cannot rewrite it. |
| Referrer (`r`) | Read from `document.referrer` outside `beforeSend`; like `dp`, it never passes through `scrubPageView`. The claim and invite pages' `no-referrer` policy keeps their URLs out of it. |
| Unsafe claim path | Check raw and decoded pathnames for `/m/` (case-insensitive, at any depth); keep only an exact raw lower-case `/m/` plus one non-empty segment with no trailing slash. Encoded token characters are kept and scrubbed. Encoded `m` segments, extra segments, trailing slashes, upper-case `M`, `/m/` alone, nested claim paths and doubled leading slashes are dropped. Unparsable URLs and malformed percent-encoding also drop the whole event. Paths such as `/m`, `/mx/…` and `/media/…` remain. |
| Unsafe invite path | Check raw and decoded pathnames for an `s` segment (case-insensitive, at any depth); keep only an exact raw lower-case `/s/` plus one non-empty segment without a trailing slash. Encoded token characters are kept and scrubbed; encoded `s` segments and malformed percent-encoding are dropped. Other dropped paths remain `/S/<token>`, `/s/<token>/x`, `/s/<token>/`, `/s/`, nested paths and doubled leading slashes. `/share`, `/s` and paths merely starting with `s` remain. The kept event's `url` is scrubbed to `/s/[inviteToken]` for valid invite tokens. |
| Other event fields | The spread preserves runtime `payload` and `__cdp` fields. This hook scrubs only the URL; it does not sanitize arbitrary custom-event data. The current integration adds no custom events or user identity. |

The same rules apply to page views and custom events. PR #64 records that Next redirects trailing slashes with 308 before a real claim-page view. Short claim segments remain in `o`; see F1. Invite segments shorter than 12 characters also remain in `o`, but cannot be issued or resolved as invite tokens.

Script `0.1.3` reads `document.referrer` outside `beforeSend` and sends it when `!referrer.includes(location.host)` on the first page view of a document load and on every custom event. This is a substring test, not a host comparison; `r`, like `dp`, never passes through `scrubPageView`. Separately, `next.config.ts` sets `Referrer-Policy: no-referrer` for claim pages, and `app/m/[claimToken]/page.tsx` repeats it in a meta tag. The header applies on every host; together with the meta it leaves `document.referrer` empty on a page opened from a claim page, keeping the claim URL out of `r`. The apex `jowray.com` redirects with 308 to `www` and serves no page. F2 must confirm intake accepts a POST without `Referer`; `Origin` is expected because intake uses `fetch` in `cors` mode.

`next.config.ts` and `app/s/[inviteToken]/page.tsx` apply the same no-referrer header/meta pairing to personal links; `/s/:path*` also gets `X-Robots-Tag: noindex, nofollow`. The analytics `/s/` rule is implemented in this branch ([notify plan D7 / §8.7](../plans/2026-11-07-notify-correspondents.md)); live intake proof remains pending.

This integration adds no application logging or Sentry calls. The shared URL helper is only one part of [Sentry's scrubber](./sentry-telemetry.md#how-it-works); its broader secret-field and header filtering is not applied to analytics payloads. Claim tokens, invite tokens, share URLs, admin keys, upload tickets and protected header values must not be added to those payloads.

## Operations and rollback

Rob enables or disables Web Analytics in the Vercel project dashboard's **Analytics** area; see [the Vercel project](../domain.md#vercel). There is no application analytics env key or code switch (`git grep` found none in `server/config/env.ts` or [Environment](../environment.md)). PR #62 recorded `/_vercel/insights/script.js` as 404; it answered 200 at 2026-11-07 01:07 UTC. At 2026-11-07 02:29 UTC both it and the per-project path the pages loaded, `/57754c27654861f8/script.js`, answered 200 with identical bytes. Vercel sets the per-project base path at build time; for future checks, read the loaded script path from the browser's network panel rather than assuming either URL. Script availability suggests enablement, not proven intake; intake payload not checked.

For code removal, remove the `SiteAnalytics` import and render from `app/layout.tsx`, its component and tests, then remove the package and update the lockfile. Keep the shared Sentry helper and unrelated dependency fixes. Prefer that targeted removal over reverting both PRs. Do not restore an analytics build without #64's route guard. Analytics has no database migration or secret rotation; any whole-site rollback must respect the [admin rollback floor](../admin.md#what-deleted-means).

After a deploy, check script loading and perform F2 against the deployed site in a normal, non-automated desktop browser. Do not use Playwright, Chrome DevTools MCP or any headless/WebDriver session: script `0.1.3` sends nothing when `navigator.webdriver` is true or the user agent contains `Headless`. Do not use `next dev`, where the SDK's debug script sends nothing. First see an ordinary page view's POST reach intake in the network panel; then check a claim page's `o` and `dp` are both `/m/[claimToken]`; then check `/m/<token>/x` sends nothing. On the claim page's intake POST, confirm `Referer` is absent and intake accepts it; `Origin` is expected.

## Key files

| Path | Role |
|---|---|
| **app** | |
| `app/layout.tsx` | Site-wide mount |
| `app/_components/analytics-client.tsx` | URL hook and route guard |
| `next.config.ts`, `app/m/[claimToken]/page.tsx`, `app/s/[inviteToken]/page.tsx` | Claim/invite-page referrer policy |
| **lib + server** | |
| `lib/sentry/scrub.ts`, `lib/sentry/secrets.ts` | Shared URL helper and broader secret policy |
| **tests** | |
| `__tests__/app/analytics-client.test.ts` | Hook contract |
| **packages** | |
| `package.json`, `package-lock.json` | SDK version and dependency overrides |

## Tests and evidence

- The original analytics tests cover: claim page and custom-event URL scrubbing; `?t=` removal while retaining another parameter; `#key=` removal; ordinary URLs and paths merely starting with `m` unchanged; the six dropped path shapes above; a mismatched custom event; an unparsable URL; and preservation of `payload` and `__cdp`. These exercise the hook, not the SDK's transmitted payload.
- Invite cases in `__tests__/app/analytics-client.test.ts` pin the `/s/` keep/drop rule and explicitly assert the returned `url` contains `/s/[inviteToken]`, not the token. They also cover ordinary `/share` and other `s`-prefix paths. These exercise the hook, not live intake.
- PR #62 records local `npm run validate` and `npm run build:offline` passing, and 70 files / 1268 tests passing, 7 skipped. PR #64's Team Code Review round 1 fixes record both commands passing and `npm run test:run`: 70 files passed, 1 skipped; 1278 tests passed, 7 skipped. Both records say `DATABASE_URL` unset and no `.env*`.
- The orchestrator checked `/_vercel/insights/script.js`: 200 at 2026-11-07 01:07 UTC (404 in PR #62). At 2026-11-07 02:29 UTC both it and the per-project path the pages loaded, `/57754c27654861f8/script.js`, answered 200 with identical bytes (4,522 bytes, script `0.1.3`); intake payload not checked. On that date, the per-project intake path was `/57754c27654861f8/view`; Vercel sets the base path at build time. The server HTML search returned no script reference; browser injection means that does not establish whether page views arrive. The PR exports record Ready previews, not CI test results or production intake.

**NOT RUN:** F2 live intake and real-data verification; CI results are not supplied. Current local documentation checks are recorded in [Invite links](./invite-links.md#tests-and-evidence); no offline build or live intake check was run for this sync.

## Known gaps and follow-ups

- **F1, Low, open at HEAD:** `CLAIM_PATH` in `lib/sentry/scrub.ts` still lacks the case-insensitive flag, so upper-case claim paths can reach Sentry unchanged. Analytics drops those paths. The same follow-up proposes scrubbing claim segments of any length: the hook permits `/m/abc`, but `scrubUrl` leaves that short value in `o`.
- **F2, Medium, open; Rob's live check:** use a normal, non-automated desktop browser against a deployed site. Playwright, Chrome DevTools MCP and headless/WebDriver sessions send nothing; `next dev` loads a debug script that sends nothing. First see an ordinary page view's POST reach intake in the network panel; then verify a claim page sends `o` and `dp` both as `/m/[claimToken]`; then verify `/m/<token>/x` sends nothing. Repeat for `/s/<token>` (`o` and `dp` both `/s/[inviteToken]`) and `/s/<token>/x` (no event). Confirm the claim page's intake POST is accepted with `Referer` absent (`Origin` is expected). Script availability does not close this item.
- **F3, Low, open:** both overrides remain. The lockfile still has Blob requiring oidc `^3.6.1` and typescript-estree requiring minimatch `^10.2.2`, so the [documented removal conditions](../dependencies.md#overrides-in-packagejson) are unmet; the cli-config condition also requires checking its bundled zod without the override. Do not remove either on audit output alone.

## Related

- [Sentry telemetry](./sentry-telemetry.md): shared scrubbing and the alpha policy.
- [Privacy](./privacy.md): the visitor note in `app/_components/privacy-note-client.tsx` describes screen, log, click and typing collection; it does not name Vercel page-view analytics. That document owns disclosure follow-up.
- [Code layout and checks](../code-layout.md), [environment](../environment.md), [domain](../domain.md) and [admin operations](../admin.md).
