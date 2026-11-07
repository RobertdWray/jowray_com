# Vercel Web Analytics

Page-view analytics for Rob in the Vercel project dashboard. `SiteAnalytics` in `app/layout.tsx` covers every page, with URL scrubbing and event dropping to protect private claim links.

**Status:** [PR #62](https://github.com/RobertdWray/jowray_com/pull/62) delivered analytics (merged 2026-11-06 as `73ac034`); [PR #64](https://github.com/RobertdWray/jowray_com/pull/64) added protection for token-bearing unmatched routes (merged into #62 on 2026-11-06 as `bb4a2e2`). There is no feature plan; the PR descriptions are the record. Deployment evidence is limited: the script answers 200 (checked 2026-11-07 01:07 UTC); intake payload not checked. Page views arriving and use with real data are not verified.

The npm audit cleanup in #62 and #64's replacement of the ineffective zod override with a real bundled-code fix are recorded in [Dependencies](../dependencies.md).

## What we built

1. A visitor opens a page; the root layout renders `SiteAnalytics`, which loads Vercel's browser analytics through `@vercel/analytics/next`.
2. Before an event leaves, `scrubPageView` returns a scrubbed event or `null` to drop it.
3. Rob views collected page views in the project's Analytics dashboard once enabled; live intake still needs the F2 check below.

## Why we built it

To add page-view measurement without sending claim credentials to analytics. [PR #62](https://github.com/RobertdWray/jowray_com/pull/62) explains that an unfiltered claim-page view would send its bearer token to Vercel, contrary to the [site's secret policy](../code-layout.md#sentry-alpha-data-policy-2026-11-04).

## Key decisions (Rob)

| Decision | Source |
|---|---|
| Adding analytics was delivered in PR #62 and accepted at merge. The supplied PR record contains no direct ruling from Rob authorizing the addition. | [PR #62](https://github.com/RobertdWray/jowray_com/pull/62), 2026-11-06 |
| Agent's implementation choices, accepted at merge: reuse `scrubUrl`; after review, reject unsafe raw paths instead of testing only the scrubbed URL, which misses upper-case and short segments. | [PR #64](https://github.com/RobertdWray/jowray_com/pull/64) and [PR #62's review comment](https://github.com/RobertdWray/jowray_com/pull/62), 2026-11-06 |

## How it works

`package.json` requests `@vercel/analytics` `^2.0.1`; `package-lock.json` resolves 2.0.1. `SiteAnalytics` passes `scrubPageView` as `beforeSend`.

| Field or input | Behaviour |
|---|---|
| URL (`url` in the hook, `o` on the wire) | `scrubUrl` replaces lower-case `/m/` followed by a run of at least 16 base64url characters with `/m/[claimToken]`. It removes lower-case `t=` and `key=` parameters from query strings or fragments, including `?t=` and `#key=`, and tidies their separators. Other parameters remain. |
| Route (`dp`) | The Next wrapper constructs it outside the hook: `/m/[claimToken]` for the matched claim route, but the raw pathname for a root not-found page. The hook cannot rewrite it. |
| Unsafe path | Parse the URL, then drop any path containing `/m/` (case-insensitive, at any depth) unless it is exactly lower-case `/m/` plus one non-empty segment with no trailing slash. This drops an extra segment, a trailing slash, upper-case `M`, `/m/` alone, a nested claim path and a doubled leading slash. An unparsable URL also drops the whole event. Paths such as `/m`, `/mx/…` and `/media/…` remain. |
| Other event fields | The spread preserves runtime `payload` and `__cdp` fields. This hook scrubs only the URL; it does not sanitize arbitrary custom-event data. The current integration adds no custom events or user identity. |

The same rules apply to page views and custom events. PR #64 records that Next redirects trailing slashes with 308 before a real claim-page view. Short claim segments remain in `o`; see F1.

The script sends `document.referrer` only for another host, so same-host referrers are omitted; this was inspected for PR #62, not rechecked against the current script here. Separately, `next.config.ts` sets `Referrer-Policy: no-referrer` for claim pages, and `app/m/[claimToken]/page.tsx` repeats it in a meta tag. F2 must confirm intake accepts a POST without `Referer`.

This integration adds no application logging or Sentry calls. The shared URL helper is only one part of [Sentry's scrubber](./sentry-telemetry.md#how-it-works); its broader secret-field and header filtering is not applied to analytics payloads. Claim tokens, admin keys, upload tickets and protected header values must not be added to those payloads.

## Operations and rollback

Rob enables or disables Web Analytics in the Vercel project dashboard's **Analytics** area; see [the Vercel project](../domain.md#vercel). There is no application analytics env key or code switch (`git grep` found none in `server/config/env.ts` or [Environment](../environment.md)). The original PR reported a script 404; the later 200 suggests enablement, not proven intake.

For code removal, remove the `SiteAnalytics` import and render from `app/layout.tsx`, its component and tests, then remove the package and update the lockfile. Keep the shared Sentry helper and unrelated dependency fixes. Prefer that targeted removal over reverting both PRs. Do not restore an analytics build without #64's route guard. Analytics has no database migration or secret rotation; any whole-site rollback must respect the [admin rollback floor](../admin.md#what-deleted-means).

After a deploy, check script loading and perform F2 in the browser: scrubbed claim URL and route, no event for a mismatched claim path, and accepted intake without a `Referer` header.

## Key files

| Path | Role |
|---|---|
| **app** | |
| `app/layout.tsx` | Site-wide mount |
| `app/_components/analytics-client.tsx` | URL hook and route guard |
| `next.config.ts`, `app/m/[claimToken]/page.tsx` | Claim-page referrer policy |
| **lib + server** | |
| `lib/sentry/scrub.ts`, `lib/sentry/secrets.ts` | Shared URL helper and broader secret policy |
| **tests** | |
| `__tests__/app/analytics-client.test.ts` | Hook contract |
| **packages** | |
| `package.json`, `package-lock.json` | SDK version and dependency overrides |

## Tests and evidence

- The analytics test has 15 cases: claim page and custom-event URL scrubbing; `?t=` removal while retaining another parameter; `#key=` removal; ordinary URLs and paths merely starting with `m` unchanged; the six dropped path shapes above; a mismatched custom event; an unparsable URL; and preservation of `payload` and `__cdp`. These exercise the hook, not the SDK's transmitted payload.
- PR #62 records local `npm run validate` and `npm run build:offline` passing, and 70 files / 1268 tests passing, 7 skipped. PR #64's Team Code Review round 1 fixes record both commands passing and `npm run test:run`: 70 files passed, 1 skipped; 1278 tests passed, 7 skipped. Both records say `DATABASE_URL` unset and no `.env*`.
- The orchestrator's supplied live check records the script answers 200 (checked 2026-11-07 01:07 UTC); intake payload not checked. The server HTML search returned no script reference; browser injection means that does not establish whether page views arrive. The PR exports record Ready previews, not CI test results or production intake.

**NOT RUN:** F2 live intake and real-data verification; CI results are not supplied. This documentation worker did not rerun npm validation, tests or the offline build; those checks belong to the combined branch.

## Known gaps and follow-ups

- **F1, Low, open at HEAD:** `CLAIM_PATH` in `lib/sentry/scrub.ts` still lacks the case-insensitive flag, so upper-case claim paths can reach Sentry unchanged. Analytics drops those paths. The same follow-up proposes scrubbing claim segments of any length: the hook permits `/m/abc`, but `scrubUrl` leaves that short value in `o`.
- **F2, Medium, open; Rob's live check:** verify the claim page sends scrubbed `o` and `dp`, an extra-segment claim path sends nothing, and intake accepts the POST without `Referer`. The script's 200 does not close this item.
- **F3, Low, open:** both overrides remain. The lockfile still has Blob requiring oidc `^3.6.1` and typescript-estree requiring minimatch `^10.2.2`, so the [documented removal conditions](../dependencies.md#overrides-in-packagejson) are unmet; the cli-config condition also requires checking its bundled zod without the override. Do not remove either on audit output alone.

## Related

- [Sentry telemetry](./sentry-telemetry.md): shared scrubbing and the alpha policy.
- [Privacy](./privacy.md): the visitor note in `app/_components/privacy-note-client.tsx` describes screen, log, click and typing collection; it does not name Vercel page-view analytics. That document owns disclosure follow-up.
- [Code layout and checks](../code-layout.md), [environment](../environment.md), [domain](../domain.md) and [admin operations](../admin.md).
