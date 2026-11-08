# Vercel Web Analytics and Speed Insights

Page-view analytics and Core Web Vitals for Rob in the Vercel project dashboard. `SiteAnalytics` and `SiteSpeedInsights` in `app/layout.tsx` cover every page the root layout renders (not the root error page, `app/global-error.tsx`, which has its own `<html>`). Both use one `beforeSend` guard, `scrubVercelEvent`, which scrubs URLs and drops events to protect private claim and invite links.

**Status:** [PR #62](https://github.com/RobertdWray/jowray_com/pull/62) delivered analytics (merged 2026-11-06 as `73ac034`); [PR #64](https://github.com/RobertdWray/jowray_com/pull/64) added protection for token-bearing unmatched routes (merged into #62 on 2026-11-06 as `bb4a2e2`). There is no feature plan; the PR descriptions are the record. Deployment evidence is limited: `/_vercel/insights/script.js` answered 200 at 2026-11-07 01:07 UTC (404 in PR #62); at 2026-11-07 02:29 UTC both it and the per-project path the pages loaded, `/57754c27654861f8/script.js`, answered 200 with identical bytes; intake payload not checked. Page views arriving and use with real data are not verified.

[PR #96](https://github.com/RobertdWray/jowray_com/pull/96) adds Speed Insights (`@vercel/speed-insights` 2.1.0) through the same guard, which now also checks the route Speed Insights hands to `beforeSend` and, for both scripts, drops claim and invite links whose token segment is percent-encoded. Its PR description is the record. `/_vercel/speed-insights/script.js` answered 200 on 2026-11-08 before this PR (script `0.1.3`), which suggests Speed Insights is already enabled on the project. No vitals intake has been checked.

The npm audit cleanup in #62 and #64's replacement of the ineffective zod override with a real bundled-code fix are recorded in [Dependencies](../dependencies.md).

## What we built

1. A visitor opens a page. The root layout renders `SiteAnalytics`, which loads Vercel's browser analytics through `@vercel/analytics/next`, and `SiteSpeedInsights`, which loads the Core Web Vitals script through `@vercel/speed-insights/next`.
2. Before a page view, custom event or vital leaves, `scrubVercelEvent` returns a scrubbed event or `null` to drop it.
3. Rob views collected page views in the project's Analytics dashboard and vitals in its Speed Insights dashboard once enabled. Live intake for both still needs the F2 and F4 checks below.

## Why we built it

To add page-view measurement without sending claim or invite credentials to analytics. [PR #62](https://github.com/RobertdWray/jowray_com/pull/62) explains that an unfiltered claim-page view would send its bearer token to Vercel, contrary to the [site's secret policy](../code-layout.md#sentry-alpha-data-policy-2026-11-04).

## Key decisions (Rob)

| Decision | Source |
|---|---|
| Adding analytics was delivered in PR #62 and accepted at merge. The supplied PR record contains no direct ruling from Rob authorizing the addition. | [PR #62](https://github.com/RobertdWray/jowray_com/pull/62), 2026-11-06 |
| Agent's implementation choices, accepted at merge: reuse `scrubUrl`; after review, reject unsafe raw paths instead of testing only the scrubbed URL, which misses upper-case and short segments. | [PR #64](https://github.com/RobertdWray/jowray_com/pull/64) and [PR #62's review comment](https://github.com/RobertdWray/jowray_com/pull/62), 2026-11-06 |
| Rob asked for Speed Insights following [Vercel's docs](https://vercel.com/docs/speed-insights), installing `@vercel/speed-insights` and naming `SpeedInsights` from `@vercel/speed-insights/next`. He approved the plan, including the agent's calls in the next row. | Rob, 2026-11-08 (session plan; [PR #96](https://github.com/RobertdWray/jowray_com/pull/96)) |
| Agent's calls, approved in that plan: one guard for both scripts (`scrubPageView` renamed `scrubVercelEvent`) instead of a second copy; drop a vital whose route fails the path rule, because the script ignores a rewritten route; no `sampleRate`, so every event is sent as under the 100 % alpha policy. A later agent's call, which Rob has not yet accepted: document Speed Insights here, not in its own file. The plan had proposed a new file, but template rule 1 quotes Rob: "I don't want documents just to create documents." | [PR #96](https://github.com/RobertdWray/jowray_com/pull/96), 2026-11-08 |
| TCR round 1 (George, Oscar, research), 2026-11-08: drop encoded claim/invite segments and accept only exact route placeholders; reverses #64's keep-encoded rule and tightens the previous row's route rule. Agent's call, approved by the orchestrator. | [PR #96](https://github.com/RobertdWray/jowray_com/pull/96), 2026-11-08 |

## How it works

`package.json` requests `@vercel/analytics` `^2.0.1` and `@vercel/speed-insights` `^2.1.0`; `package-lock.json` resolves 2.0.1 and 2.1.0. `SiteAnalytics` and `SiteSpeedInsights` both pass `scrubVercelEvent` as `beforeSend`. This section describes Web Analytics; [Speed Insights](#speed-insights) below lists the fields that differ.

| Field or input | Behaviour |
|---|---|
| URL (`url` in the hook, `o` on the wire) | `scrubUrl` replaces lower-case `/m/` followed by a run of at least 16 token characters with `/m/[claimToken]`. It also replaces case-insensitive `/s/` followed by at least 12 token characters with `/s/[inviteToken]`, including full invite URLs. Both patterns accept base64url characters and `%` to cover percent-encoded token characters. It removes lower-case `t=` and `key=` parameters from query strings or fragments, including `?t=` and `#key=`, and tidies their separators. Other parameters remain. |
| Route (`dp`) | The Next wrapper constructs it outside the hook by replacing `useParams()` values in `usePathname()`: `/m/[claimToken]` or `/s/[inviteToken]` for the matched claim or invite route, but the raw pathname, token included, for a root not-found page and for a claim or invite link with any percent-encoded token character. The pathname keeps the encoding while the params are decoded, so nothing matches (reproduced 2026-11-08; see Tests and evidence). The hook cannot rewrite it, so the unsafe-path rows below drop both cases. |
| Referrer (`r`) | Read from `document.referrer` outside `beforeSend`; like `dp`, it never passes through `scrubVercelEvent`. The claim and invite pages' `no-referrer` policy keeps their URLs out of it. |
| Unsafe claim path | Check raw and decoded pathnames for `/m/` (case-insensitive, at any depth); keep only an exact raw lower-case `/m/` plus one non-empty segment with no `%` and no trailing slash. Any percent-encoding in that segment drops the event, because the wrapper's `dp` for it is the raw path; claim tokens are base64url (`lib/claim-token.ts`), so real links contain no `%`. Until TCR round 1 of PR #96, encoded token characters were kept and scrubbed. Encoded `m` segments, extra segments, trailing slashes, upper-case `M`, `/m/` alone, nested claim paths and doubled leading slashes are dropped. Unparsable URLs and malformed percent-encoding also drop the whole event. Paths such as `/m`, `/mx/…` and `/media/…` remain. |
| Unsafe invite path | Check raw and decoded pathnames for an `s` segment (case-insensitive, at any depth); keep only an exact raw lower-case `/s/` plus one non-empty segment with no `%` and no trailing slash. Encoded token characters (invite tokens are base64url too, `lib/invite-token.ts`), encoded `s` segments and malformed percent-encoding are dropped, for the same reason as claim paths. Other dropped paths remain `/S/<token>`, `/s/<token>/x`, `/s/<token>/`, `/s/`, nested paths and doubled leading slashes. `/share`, `/s` and paths merely starting with `s` remain. The kept event's `url` is scrubbed to `/s/[inviteToken]` for valid invite tokens. |
| Other event fields | The spread preserves runtime `payload` and `__cdp` fields. This hook scrubs only the URL; it does not sanitize arbitrary custom-event data. The current integration adds no custom events or user identity. |

The same rules apply to page views and custom events. PR #64 records that Next redirects trailing slashes with 308 before a real claim-page view. Short claim segments remain in `o`; see F1. Invite segments shorter than 12 characters also remain in `o`, but cannot be issued or resolved as invite tokens.

Script `0.1.3` reads `document.referrer` outside `beforeSend` and sends it when `!referrer.includes(location.host)` on the first page view of a document load and on every custom event. This is a substring test, not a host comparison; `r`, like `dp`, never passes through `scrubVercelEvent`. Separately, `next.config.ts` sets `Referrer-Policy: no-referrer` for claim pages, and `app/m/[claimToken]/page.tsx` repeats it in a meta tag. The header applies on every host; together with the meta it leaves `document.referrer` empty on a page opened from a claim page, keeping the claim URL out of `r`. The apex `jowray.com` redirects with 308 to `www` and serves no page. F2 must confirm intake accepts a POST without `Referer`; `Origin` is expected because intake uses `fetch` in `cors` mode.

`next.config.ts` and `app/s/[inviteToken]/page.tsx` apply the same no-referrer header/meta pairing to personal links; `/s/:path*` also gets `X-Robots-Tag: noindex, nofollow`. The analytics `/s/` rule is implemented in this branch ([notify plan D7 / §8.7](../plans/2026-11-07-notify-correspondents.md)); live intake proof remains pending.

This integration adds no application logging or Sentry calls. The shared URL helper is only one part of [Sentry's scrubber](./sentry-telemetry.md#how-it-works); its broader secret-field and header filtering is not applied to analytics payloads. Claim tokens, invite tokens, share URLs, admin keys, upload tickets and protected header values must not be added to those payloads.

### Speed Insights

Speed Insights stores the route and URL with every data point ([Vercel: data collected](https://vercel.com/docs/speed-insights/privacy-policy#data-collected)). Script `0.1.3`, served from the project, calls `beforeSend({ type: "vital", url, route })` for each metric and copies back only the returned `url`. The table describes that script as fetched on 2026-11-08.

| Field or input | Behaviour |
|---|---|
| URL (`url` in the hook, `metrics[].href` on the wire) | `location.href`, query and fragment included. It goes through `scrubUrl` exactly as above. |
| Route (`route` in the hook and on the wire) | The Next wrapper builds it from `useParams()`, falling back to search params when that is empty, via `computeRoute`. The result is `/m/[claimToken]` or `/s/[inviteToken]` on the claim or invite page, but the raw pathname on the root not-found page and on a claim or invite link with a percent-encoded token character. It can also lag a client navigation, because the wrapper updates the script's `data-route` in an effect. The script ignores a returned `route`, so `scrubVercelEvent` drops the vital unless a route with an `m` or `s` segment (raw or decoded, any case, any depth) is exactly `/m/[claimToken]` or `/s/[inviteToken]`; malformed encoding drops it too. A lagging route is therefore either a placeholder, kept because it carries no token, or a raw token path, dropped. |
| Attribution (`metrics[].attribution`) | The CSS selector of the element behind LCP, CLS, INP or FID, built outside `beforeSend`. No element `id` in `app/` is built from a token (`git grep`, 2026-11-08). A token-derived `id` or class added later would leak here. |
| Other fields | Network type (`speed`), metric name and value, SDK name and version. Vercel adds browser, device, OS and country. There is no referrer field. |
| Intake | A same-origin `fetch` POST (`keepalive`, `mode: "no-cors"`), or `navigator.sendBeacon` where `keepalive` is unsupported, to the per-project `…/vitals` path, sent on `visibilitychange`, `pagehide`, `popstate` and `history.pushState`, or after six metrics. When every metric is dropped, nothing is sent. The claim and invite pages' `no-referrer` header keeps their URLs out of the request's `Referer`. Sentry Replay records same-origin request bodies, so it sees the already scrubbed body, which `scrubRecordingEvent` scrubs again. |

The wrapper's prop type omits `route`, and it renders inside its own `<Suspense fallback={null}>`, so the root layout keeps prerendering under `cacheComponents` with no extra boundary. `sampleRate` is unset, so every event is sent. In `next dev` the SDK loads `script.debug.js`, which sends nothing and logs each payload to the console as `[Vercel Speed Insights] [vitals]`. The production script, like Web Analytics', sends nothing when `navigator.webdriver` is true or the user agent contains `Headless`.

## Operations and rollback

Rob enables or disables Web Analytics in the Vercel project dashboard's **Analytics** area; see [the Vercel project](../domain.md#vercel). There is no application analytics env key or code switch (`git grep` found none in `server/config/env.ts` or [Environment](../environment.md)). PR #62 recorded `/_vercel/insights/script.js` as 404; it answered 200 at 2026-11-07 01:07 UTC. At 2026-11-07 02:29 UTC both it and the per-project path the pages loaded, `/57754c27654861f8/script.js`, answered 200 with identical bytes. Vercel sets the per-project base path at build time; for future checks, read the loaded script path from the browser's network panel rather than assuming either URL. Script availability suggests enablement, not proven intake; intake payload not checked.

Rob enables or disables Speed Insights from the project's **Speed Insights** sidebar entry. It has no env key or code switch either. Vercel tracks it on preview and production deployments ([Vercel: overview](https://vercel.com/docs/speed-insights)), so F4 can run on a PR preview before merge.

To remove Speed Insights alone, remove `SiteSpeedInsights` from `app/layout.tsx` and `app/_components/analytics-client.tsx`, then the package. Keep `scrubVercelEvent` and its tests while Web Analytics stays. For code removal of Web Analytics, remove the `SiteAnalytics` import and render from `app/layout.tsx`, its component and tests, then remove the package and update the lockfile. Keep the shared Sentry helper and unrelated dependency fixes. Prefer that targeted removal over reverting both PRs. Do not restore an analytics build without #64's route guard. Analytics has no database migration or secret rotation; any whole-site rollback must respect the [admin rollback floor](../admin.md#what-deleted-means).

After a deploy, check script loading and perform F2 against the deployed site in a normal, non-automated desktop browser. Do not use Playwright, Chrome DevTools MCP or any headless/WebDriver session: script `0.1.3` sends nothing when `navigator.webdriver` is true or the user agent contains `Headless`. Do not use `next dev`, where the SDK's debug script sends nothing. First see an ordinary page view's POST reach intake in the network panel; then check a claim page's `o` and `dp` are both `/m/[claimToken]`; then check `/m/<token>/x` sends nothing. On the claim page's intake POST, confirm `Referer` is absent and intake accepts it; `Origin` is expected.

## Key files

| Path | Role |
|---|---|
| **app** | |
| `app/layout.tsx` | Site-wide mount of both scripts |
| `app/_components/analytics-client.tsx` | `scrubVercelEvent` (URL hook and route guard), `SiteAnalytics`, `SiteSpeedInsights` |
| `next.config.ts`, `app/m/[claimToken]/page.tsx`, `app/s/[inviteToken]/page.tsx` | Claim/invite-page referrer policy |
| **lib + server** | |
| `lib/sentry/scrub.ts`, `lib/sentry/secrets.ts` | Shared URL helper and broader secret policy |
| **tests** | |
| `__tests__/app/analytics-client.test.ts` | Hook contract for page views, custom events and vitals |
| **packages** | |
| `package.json`, `package-lock.json` | SDK versions and dependency overrides |

## Tests and evidence

- The original analytics tests cover: claim page and custom-event URL scrubbing; `?t=` removal while retaining another parameter; `#key=` removal; ordinary URLs and paths merely starting with `m` unchanged; the six dropped path shapes above; a mismatched custom event; an unparsable URL; and preservation of `payload` and `__cdp`. These exercise the hook, not the SDK's transmitted payload.
- Invite cases in `__tests__/app/analytics-client.test.ts` pin the `/s/` keep/drop rule and explicitly assert the returned `url` contains `/s/[inviteToken]`, not the token. They also cover ordinary `/share` and other `s`-prefix paths. These exercise the hook, not live intake.
- PR #62 records local `npm run validate` and `npm run build:offline` passing, and 70 files / 1268 tests passing, 7 skipped. PR #64's Team Code Review round 1 fixes record both commands passing and `npm run test:run`: 70 files passed, 1 skipped; 1278 tests passed, 7 skipped. Both records say `DATABASE_URL` unset and no `.env*`.
- The orchestrator checked `/_vercel/insights/script.js`: 200 at 2026-11-07 01:07 UTC (404 in PR #62). At 2026-11-07 02:29 UTC both it and the per-project path the pages loaded, `/57754c27654861f8/script.js`, answered 200 with identical bytes (4,522 bytes, script `0.1.3`); intake payload not checked. On that date, the per-project intake path was `/57754c27654861f8/view`; Vercel sets the base path at build time. The server HTML search returned no script reference; browser injection means that does not establish whether page views arrive. The PR exports record Ready previews, not CI test results or production intake.

- [PR #96](https://github.com/RobertdWray/jowray_com/pull/96) adds the Speed Insights cases to the same file. They use `{ type: "vital", url, route }`, typed from the SDK's `beforeSend`:
  - a claim-page vital keeps the route `/m/[claimToken]` and loses the token, `?t=` and `#key=` from its URL;
  - an invite vital is scrubbed to `/s/[inviteToken]`;
  - a safe URL with an unsafe stale route (upper-case `M`, extra segment, trailing slash, nested `/s/`, encoded `m`) is dropped;
  - a not-found claim path is dropped;
  - ordinary vitals with or without a route are unchanged;
  - a route with malformed encoding is dropped.

  Team Code Review round 1 added:
  - an encoded-token URL paired with the raw route the wrapper builds for it, for `/m/` and `/s/` (T8), and a safe URL with a single-segment token route (T9), both dropped;
  - a lagging placeholder route under another page's URL, kept (T10);
  - near-miss placeholders (`/M/[claimToken]`, `/m/[claimtoken]`, a trailing slash, `/S/[inviteToken]`, `/s/[InviteToken]`), dropped (T11);
  - the placeholders checked against the `app/m/[claimToken]` and `app/s/[inviteToken]` folders (T12);
  - on the Web Analytics side, the four encoded-token paths for each event type now drop instead of being kept, and percent-encoding outside a token segment (a path, or a claim page's query) is still kept.

  Mutation checks on the final code (77 tests in the file): removing the route check fails 14; removing the `%` exclusion from the claim and invite page paths fails 8; checking the route with the URL rule (the behaviour before round 1) fails 4; removing both fails 24. Results are recorded in the PR description.
- Local debug-script check, 2026-11-08, PR #96 branch: `next dev` with no `.env*`, a separate headless Chrome driven over CDP, synthetic `SENTRYTEST_` values, and `pagehide` dispatched to flush.
  - `/how-it-was-built?t=…&from=email#key=…` logged FCP, TTFB and LCP with `href` `/how-it-was-built?from=email` and route `/how-it-was-built`; the LCP attribution was `#page-heading`.
  - On the root not-found pages `/m/<token>/extra` and `/M/<token>`, the script's `data-route` held the raw token path and no payload was logged.
  - A control run on `/m/<token>/extra` with a pass-through `beforeSend` logged three metrics carrying the token in both `href` and `route`. So the drop comes from `scrubVercelEvent`, not from missing metrics.
  - The claim and invite pages themselves need a database and were not loaded in this run.
- TCR round 1 repro, 2026-11-08, same setup, on head `e153f92` (before the fix), hard loads with synthetic values:

  | URL loaded | Speed Insights | Web Analytics |
  |---|---|---|
  | `/m/SENTRYTEST_abcdefghijklmnop0123` | `href` and `route` `/m/[claimToken]` | `o` and `dp` `/m/[claimToken]` |
  | `/m/%53ENTRYTEST_abcdefghijklmnop0123` | `href` `/m/[claimToken]`, but `route` `/m/%53ENTRYTEST_abcdefghijklmnop0123` (token leaked) | `o` `/m/[claimToken]`, but `dp` `/m/%53ENTRYTEST_abcdefghijklmnop0123` (token leaked, on `main` since #64) |
  | `/s/%53ENTRYTEST_invite01` | `route` `/s/%53ENTRYTEST_invite01` (token leaked) | the same rule applies |

  After the fix, same setup: `/m/SENTRYTEST_abcdefghijklmnop0123` still logged FCP, TTFB and LCP and a page view, with `href`, `o`, `route` and `dp` all `/m/[claimToken]`. For `/m/%53ENTRYTEST_abcdefghijklmnop0123` and `/s/%53ENTRYTEST_invite01`, Speed Insights logged no payload and Web Analytics logged "Page view would be ignored by `beforeSend` because null was returned". The script's `data-route` attribute in the page still held the raw path; it is never sent.

**NOT RUN:** F2 and F4 live intake and real-data verification. TCR round 1's local `npm run validate`, `npm run test:run` and `npm run build:offline` results are in the PR description. Current local documentation checks are recorded in [Invite links](./invite-links.md#tests-and-evidence).

## Known gaps and follow-ups

- **F1, Low, open at HEAD:** `CLAIM_PATH` in `lib/sentry/scrub.ts` still lacks the case-insensitive flag, so upper-case claim paths can reach Sentry unchanged. Analytics drops those paths. The same follow-up proposes scrubbing claim segments of any length: the hook permits `/m/abc`, but `scrubUrl` leaves that short value in `o`.
- **F2, Medium, open; Rob's live check:** use a normal, non-automated desktop browser against a deployed site. Playwright, Chrome DevTools MCP and headless/WebDriver sessions send nothing; `next dev` loads a debug script that sends nothing. First see an ordinary page view's POST reach intake in the network panel; then verify a claim page sends `o` and `dp` both as `/m/[claimToken]`; then verify `/m/<token>/x` sends nothing. Repeat for `/s/<token>` (`o` and `dp` both `/s/[inviteToken]`) and `/s/<token>/x` (no event). Confirm the claim page's intake POST is accepted with `Referer` absent (`Origin` is expected). Script availability does not close this item.
- **F3, Low, open:** both overrides remain. The lockfile still has Blob requiring oidc `^3.6.1` and typescript-estree requiring minimatch `^10.2.2`, so the [documented removal conditions](../dependencies.md#overrides-in-packagejson) are unmet; the cli-config condition also requires checking its bundled zod without the override. Do not remove either on audit output alone.
- **F4, Medium, open; Rob's live check for Speed Insights:** same browser rules as F2. On a page, hide the tab to flush, then find the `…/vitals` POST in the network panel.
  - On `/m/<token>`, every `metrics[].href` and `route` shows `/m/[claimToken]`.
  - On `/s/<token>`, they show `/s/[inviteToken]`.
  - `/m/<token>/x` and `/s/<token>/x` send no POST.
  - Hard-load `/m/<token>` and `/s/<token>` with one token character percent-encoded (for example `%53` for `S`): no `…/vitals` and no `…/view` POST.
  - A URL with `?t=` arrives without it.
  - The dashboard shows data after visits.
- **F5, Low, open:** the attribution selector is sent outside `beforeSend` (see [Speed Insights](#speed-insights)). Keep claim and invite tokens out of element `id`s and class names.
- **F6, Low, open: report upstream.** `computeRoute` in `@vercel/analytics` 2.0.1 and `@vercel/speed-insights` 2.1.0 matches decoded `useParams()` values against the encoded `usePathname()`, so a percent-encoded dynamic segment is never parameterized and the raw path is reported as the route. Repro: a hard load of `/m/%53ENTRYTEST_x` gives `dp` and `route` `/m/%53ENTRYTEST_x`. Proposed fix: decode the pathname before matching, or encode the params. File issues on `vercel/analytics` and `vercel/speed-insights`; our `%` drop can stay after an upstream fix.

## Related

- [Sentry telemetry](./sentry-telemetry.md): shared scrubbing and the alpha policy.
- [Privacy](./privacy.md): the visitor note in `app/_components/privacy-note-client.tsx` describes screen, log, click and typing collection; it does not name Vercel page-view analytics or Speed Insights. That document owns disclosure follow-up.
- [Code layout and checks](../code-layout.md), [environment](../environment.md), [domain](../domain.md) and [admin operations](../admin.md).
