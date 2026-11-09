# JOWRAY_COM-D (Facebook in-app browser error): stop third-party noise from emailing Rob, keep collecting it

Status: approved by Rob 2026-11-08; Part A in PR `fix/sentry-third-party-alerts`; Parts B and C pending (see §8 Ledger). Sentry issue: https://med3ai.sentry.io/issues/7836155008/

## 0. Answer: is this a problem?

**For visitors, no. For alerting, yes (a small one).**

- The error is not in jowray code. Facebook's iPhone app opens links in its own built-in browser and injects its own JavaScript into the page. That script tried to message the Facebook app through `window.webkit.messageHandlers`, a channel that exists only when a host app installs it [C2], and in that moment it wasn't there.
- The visitor saw the page normally: it painted its main content in 1 s, Replay shows one page view, no rage or dead clicks. The error came about 2 s after the page sent its last Speed Insights beacon, so it fired as the visitor was leaving.
- Our own filter already marked it `third_party_code: True` (tag mode, as Rob ruled on 2026-11-04). Nothing downstream uses that tag, so Sentry's default "high priority issue" alert emailed Rob anyway: every unhandled `error` is High [C5].
- It will recur (the visit came from a Facebook link, `?fbclid=`), and every new third-party error message (Instagram, TikTok, browser extensions) becomes a new High issue and a new email.
- Side note: the visitor's IP (3.93.212.203, Ashburn) belongs to Amazon. That means a cloud connection (VPN, privacy relay or an automated link check), not a home network. Nothing to act on.

## 1. Evidence (verified 2026-11-08; commands re-runnable)

| # | Fact | How verified |
|---|---|---|
| E1 | Event `7ea671bc…`: `TypeError: undefined is not an object (evaluating 'window.webkit.messageHandlers')`, `onerror` unhandled, browser "Facebook 535.0.0", iOS 26.6.1, release `5726441` (live main) | `sentry issue view 7836155008 --org med3ai` |
| E2 | All 3 frames are `app:///` line 1, functions `w`/`v` (minified). `app:///` is the page document URL with its origin rewritten by the Next.js SDK [C6]; i.e. code running in the page itself, not a `/_next/` file | `sentry api projects/med3ai/jowray_com/events/7ea671bc294f4b01a3d4d48de034a9c9/` |
| E3 | No `webkit`/`messageHandlers` anywhere in our repo or in the 21 inline scripts of the live home page; `connect.facebook.net/en_US/pcm.js` appears in the span tree, which we never load | `git grep -n messageHandlers origin/main`; `curl https://www.jowray.com/` |
| E4 | The SDK already treats in-app webview noise from Facebook and Instagram as unactionable and drops several such messages by default; this message is not on that list [C7] | `@sentry/core` 11.11.0 `eventFilters` |
| E5 | Today's filter is `behaviour: "apply-tag-if-contains-third-party-frames"` (`instrumentation-client.ts:65`): it tags an error when **any** frame lacks our key [C3, C4]. An error from our code with one extension frame on the stack (common in family browsers) is tagged too, so this tag can't safely gate alerts | SDK source; code comment "Family browsers carry extensions" |
| E6 | Live production chunks: 8 of 10 carry `_sentryBundlerPluginAppKey:jowray_com`. The two that don't: the `noModule` polyfill file (modern browsers never run it; the SDK excludes it on purpose [C13]) and the Turbopack runtime | `curl` each `/_next/static/immutable/chunks/*.js`, `grep -c` |
| E7 | The Turbopack runtime throws `ChunkLoadError` itself (`i.name="ChunkLoadError"`), so a chunk-load failure has only unkeyed frames | grep of `turbopack-0l1ukkt8h7dio.js` |
| E8 | Alert that emailed: workflow `6280207` "Send a notification for high priority issues", triggers `new_high_priority_issue` + `existing_high_priority_issue`, **no filters**, action email to issue owners (fallback: active members) | `sentry alert issues list med3ai/jowray_com --json` |
| E9 | No production browser error from our own code exists yet (JOWRAY_COM-1/-6 are development; -4 was a console-thrown preview check), so the key's presence has not been proven by an event. E6 proves it by bundle inspection | `sentry api organizations/med3ai/issues/?project=4512363870158848` |
| E10 | Under Turbopack the key is injected by a build-time loader rule, gated only on `applicationKey` and a Next.js version check; no auth token or network is needed [C13] | `@sentry/nextjs` `constructTurbopackConfig` |

## 2. Rulings this plan honours

- Rob, 2026-11-04: 100 % error collection; third-party errors are "tagged, never dropped" (`instrumentation-client.ts` header and comment; telemetry plan [C34] justification "tagging keeps the signal but makes noise filterable"). **Nothing in this plan drops an event.**
- Sentry UI settings are Rob's (memory: Sentry telemetry stack). Part B is Rob's in the UI, or mine through the `sentry` CLI if Rob says so.
- Branch + PR + `ci` for every change; work in a worktree; no `eslint-disable`; no band-aids; TDD.

## 3. Recommended fix

Make the tag mean exactly "no frame from our bundles", then let the alert skip tagged new issues. Collection stays at 100 %. Our own errors keep emailing.

### Part A — code PR `fix/sentry-third-party-alerts` (worktree `../jowray_wt_third_party_alerts`, from `origin/main` 5726441)

**A1. New `lib/sentry/third-party-filter.ts`**: export `THIRD_PARTY_FILTER_OPTIONS = { filterKeys: ["jowray_com"], behaviour: "apply-tag-if-exclusively-contains-third-party-frames" }`, typed with `satisfies Parameters<typeof thirdPartyErrorFilterIntegration>[0]` (type-only import from `@sentry/nextjs`, the same pattern as `lib/sentry/replay-options.ts`) [C8]. Header comment: Rob's tag-never-drop ruling; what "exclusively" means [C8]; the integration exists for "code-injecting browsers" like this one [C1]; JOWRAY_COM-D as the example [C2]; the issue stream search `!third_party_code:True` [C10]; why `ignoreSentryInternalFrames` stays off: the SDK warns it can mistake an application frame for its wrapper [C9].

**A2. `instrumentation-client.ts`**: import the constant and call `Sentry.thirdPartyErrorFilterIntegration(THIRD_PARTY_FILTER_OPTIONS)` in place of the inline contains-mode options [C8, C4]. Replace the comment on line 64 with: "Tagged, never dropped (Rob, 2026-11-04). Only errors with no frame from our bundles are tagged, so the issue alert can skip them." The import is static and `Sentry.init` stays synchronous top-level code [C11].

**A3. Test first, `__tests__/lib/third-party-filter.test.ts`** (RED before A1/A2):
- Pins the options with `toEqual`; asserts `filterKeys` matches `applicationKey: "jowray_com"` in `next.config.ts`; asserts `instrumentation-client.ts` imports and passes `THIRD_PARTY_FILTER_OPTIONS` (source match, as `replay-options.test.ts` does) [C8].
- Runs the real integration. The Node entry of `@sentry/nextjs` doesn't export it, so the test resolves `@sentry/core` from `@sentry/nextjs`'s own location (`createRequire(import.meta.url)` → `require.resolve("@sentry/nextjs")` → `createRequire(that)("@sentry/core")`). That loads exactly the copy the app ships, with no new dependency. Call `processEvent` on fixtures carrying `module_metadata` as the SDK attaches it [C3]:
  1. JOWRAY_COM-D shape: 3 frames, filename `https://www.jowray.com/`, no metadata → `tags.third_party_code === true`.
  2. Our frame (`module_metadata: { "_sentryBundlerPluginAppKey:jowray_com": true }`) plus an extension frame → **no tag**; the same event with the old contains-mode options → tagged (shows why the mode changes) [C4, C8].
  3. Turbopack-runtime-only `ChunkLoadError` (one unkeyed frame) → tagged (the residual that Part B block 2 covers).
  4. Exception without a stacktrace → no tag.

**A4. Build guard `scripts/check-sentry-app-key.ts`**, appended to `"build"` after `check-traces.ts`: it reads `.next/static/**/*.js`, finds every chunk containing the literal `apply-tag-if-exclusively-contains-third-party-frames` (our init), and fails unless each also contains `_sentryBundlerPluginAppKey:jowray_com`. It also fails if it finds no such chunk, so it never passes without having read the output (the `check-traces.ts` principle). Why: Part B makes alert routing depend on the key being injected, and injection silently stops if the SDK's Next.js version gate stops matching after an upgrade [C12, C13]. Without the key, every browser error would look third-party and stop emailing. A pure exported function gets a unit test, `__tests__/scripts/check-sentry-app-key.test.ts`, using in-memory fixtures (pass, missing key, no init chunk) [C12].

**A5. Docs**: in `docs/code-layout.md` and the `AGENTS.md` mirror (identical text):
- Add "third-party filter options (`lib/sentry/third-party-filter.ts`)" after replay options in the `lib/` list.
- Replace "the third-party error filter in tag mode (`applicationKey: "jowray_com"`)" with "the third-party error filter, which tags `third_party_code` only when no stack frame comes from our bundles (`applicationKey: "jowray_com"`, checked after every build by `scripts/check-sentry-app-key.ts`); the production issue alert skips tagged new issues" [C8, C14].

In `docs/features/sentry-telemetry.md`:
- Fix the key-files row (line 94).
- Add a key-files row for the new module and the script.
- Add "### Third-party errors and alerts (2026-11-08)": tag meaning, the alert shape from Part B, the ChunkLoadError block, the `!third_party_code:True` search, and JOWRAY_COM-D as the worked example [C1, C10, C14–C17].
- List the new tests under "Tests and evidence".

**A6. `docs/plans/2026-11-08-third-party-alerts.md`**: this plan, committed as the record, with the ledger filled in [C8, C14].

### Part B — Sentry alerts (Rob in the UI: Monitors → Alerts)

**B1. Edit `6280207`** (rename "High-priority new issues (not third-party)"):
- **When** "A new issue is created". This replaces the two legacy high-priority triggers, because tag filters only work with this trigger or "An event or issue activity is captured" [C15].
- **Block 1**, If **all**: "Issue priority ≥ high" [C19]; "Tagged event: `third_party_code` **is not set**" [C14]. Then: the current email action, unchanged.
- **Block 2**, If **all**: "Event attribute: `exception.type` equals `ChunkLoadError`". Then: the same email. Blocks evaluate separately [C16]. Chunk-load failures are tagged (E7) but are ours, so they keep emailing as they do today. They never match block 1, so there is no duplicate email.
- Environment and throttling: unchanged.

**B2. New alert "High-priority issue escalates"**: When "An issue escalates" [C17]; If all "Issue priority ≥ high" [C19]; Then the same email. This keeps today's `existing_high_priority_issue` behaviour, including a surge of third-party errors (a surge could mean an in-app browser actually breaking the page).

### Part C — triage

**C1.** Archive JOWRAY_COM-D "until escalating" (the default) [C18]. Archive the preview-check issues from §5 the same way. Rob does this, or I do it with `sentry issue archive` if Rob says so.

## 4. Non-goals

- No `ignoreErrors`, `denyUrls`/`allowUrls` or `drop-*` behaviour. They drop events, against Rob's tag-never-drop ruling, even though the SDK drops some Facebook webview errors by default [C7].
- No `ignoreSentryInternalFrames` [C9].
- No shim for `window.webkit`. It isn't ours, and a shim would hide the app's real behaviour.
- No change to `next.config.ts` (`applicationKey` is already right; E6).

## 5. Steps and done-checks

| Step | Who | Action | Done when |
|---|---|---|---|
| S1 | Claude | `git fetch origin`; `git worktree add ../jowray_wt_third_party_alerts -b fix/sentry-third-party-alerts origin/main`; `npm ci`; `export PATH=/opt/homebrew/bin:$PATH` (Node 26) | `git log -1` = 5726441 |
| S2 | Claude | A3 + A4 tests (RED) | `npx vitest run __tests__/lib/third-party-filter.test.ts __tests__/scripts/check-sentry-app-key.test.ts` fails for the missing module/script, not for syntax |
| S3 | Claude | A1, A2, A4 script, `package.json` `build` | the two test files pass |
| S4 | Claude | A5, A6 docs | `docs/code-layout.md` block == `AGENTS.md` block (diff the two sections) |
| S5 | Claude | `npm run validate`; `npm run test:run`; `CI=1 npm run build:offline` | all green; the build log shows `check-sentry-app-key` passing with the chunk count; `grep -rl "_sentryBundlerPluginAppKey:jowray_com" .next/static` is non-empty |
| S6 | Claude | commit (attribution lines), push, draft PR, wait for `ci` | `ci` green on the PR |
| S7 | Claude | Preview round 1 (tagging), §6 V1–V2 | V1 tagged, V2 not tagged, read back with `sentry issue list` |
| S8 | Claude + reviewer subagent | separate subagent reviews the diff; fix findings; then follow Rob's final PR review instructions | review clean; Rob approves merge |
| S9 | Rob | merge after `ci` | `origin/main` contains the PR; production deploy Ready |
| S10 | Rob (or Claude on Rob's "YES, use the CLI") | Part B, B1 + B2 | `sentry alert issues list med3ai/jowray_com --json` shows B1's two blocks and B2 |
| S11 | Claude | Preview round 2 (routing), §6 V3–V4 | V3 issue created with no email; V4 issue created and emailed |
| S12 | Rob or Claude | Part C archives | JOWRAY_COM-D and the check issues `is:archived` |
| S13 | Claude | update the memory index entry for this work | MEMORY.md line added |

## 6. Verification

- **Unit**: A3 cases 1–4 and the A4 fixtures (S2–S3); the full suite (S5).
- **Build**: S5's build log and grep prove an offline Turbopack build injects the key (closes E9's open question in CI).
- **V1 (preview, tagged)**: in the PR preview, signed in to Vercel (chrome-devtools MCP or Rob), run in the console `const s=document.createElement("script"); s.textContent="(function w(){ window.jowrayThirdPartyCheck.messageHandlers })()"; document.head.appendChild(s);`. This is an inline script with no key, the same shape as JOWRAY_COM-D. Expect an issue in environment `preview` with `third_party_code: True`.
- **V2 (preview, not tagged)**: `setTimeout(() => { throw new Error("jowray preview check: wrapped timer (safe to ignore)") })`. Sentry's timer wrapper sits in our keyed bundle, so one frame is ours. Expect **no** `third_party_code` tag. Under today's mode this exact shape was tagged (JOWRAY_COM-4).
- **V3/V4 (after B1/B2)**: repeat V1 and V2 with messages ending "round 2" (new fingerprints, so new issues). Expect V3 not emailed and V4 emailed. Confirm in Rob's inbox (Gmail search `from:sentry "round 2"`) and in each issue's activity.
- **Production**: no synthetic production errors. JOWRAY_COM-D's next event keeps `third_party_code: True` (`sentry issue events`).

## 7. Pre-mortem: "it shipped and it failed. Why?"

1. *A real bug never emailed.* Only an error with no frame from our bundles is tagged (A3 case 2). Turbopack `ChunkLoadError` has its own block (B1). Other runtime-only errors, such as a missing module factory after a deploy, are tagged and don't email as new issues; they stay in Sentry and B2 still fires if they surge. Accepted residual.
2. *Injection silently stopped after an upgrade, and everything looked third-party.* A4 fails the build (local, CI and Vercel) before such a deploy ships.
3. *Rob still gets in-app-browser emails.* Third-party code called through a Sentry-wrapped timer or listener carries a keyed wrapper frame, so it isn't tagged (V2 proves the mechanism) and still emails. This errs toward alerting; leave it unless it recurs.
4. *The tag filter quietly did nothing.* A tag filter on an escalation trigger is unsupported [C15], so escalation is a separate alert (B2), and V3/V4 test the routing end to end.

## 8. Ledger

| When | Step | Result | Evidence |
|---|---|---|---|
| 2026-11-08 | Plan approved | Rob approved the plan as written | session |
| 2026-11-08 | S1 | worktree `../jowray_wt_third_party_alerts` on `fix/sentry-third-party-alerts` from `5726441` | `git log -1` |
| 2026-11-08 | S2 | both new test files RED because the module and script did not exist | vitest: "Cannot find package '@/lib/sentry/third-party-filter'" |
| 2026-11-08 | S3 | A1, A2, A4 in place; the two new test files and `replay-options.test.ts` pass (16 tests) | vitest |
| 2026-11-08 | S4 | A5 docs; `AGENTS.md` and `docs/code-layout.md` received the same two replacements | diff |
| 2026-11-08 | S5 | `npm run validate` clean; `npm run test:run` 3683 passed, 68 skipped (real-Postgres suites without `TEST_DATABASE_URL`; this change touches no database code); `CI=1 npm run build:offline` passed both gates: `check-sentry-app-key: OK (_sentryBundlerPluginAppKey:jowray_com in 26 of 32 client chunks, including our Sentry init ...)`. The 6 unmarked files hold none of our code: a Turbopack async-loader stub, the `noModule` polyfills, the Turbopack runtime and three manifests. This closes E9: an offline Turbopack build injects the key | build log |

## Citations

### [C1] — The integration targets code-injecting browsers
- **Relevant File(s):** `lib/sentry/third-party-filter.ts`, `docs/features/sentry-telemetry.md`
- **Change Summary:** Classify the Facebook in-app browser's injected script as third-party with the existing integration.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/filtering/#using-thirdpartyerrorfilterintegration
- **Verbatim Quote:**
  > "The `thirdPartyErrorFilterIntegration` allows you to filter out errors originating from third parties, such as browser extensions, code-injecting browsers, or widgets from third-party services that also use Sentry. This integration can be very helpful in reducing noise that's not related to your own application code."
- **Justification:** The Facebook in-app browser is a code-injecting browser, so this integration, not a message-specific rule, is the documented tool. The header comment cites it.

### [C2] — `window.webkit.messageHandlers` is a host app's bridge
- **Relevant File(s):** `lib/sentry/third-party-filter.ts` (comment), `docs/features/sentry-telemetry.md`
- **Change Summary:** The diagnosis that the failing expression belongs to the Facebook app's webview, not to jowray.
- **Source URL:** https://developer.apple.com/documentation/webkit/wkscriptmessagehandler#overview
- **Verbatim Quote:**
  > "To call your message handler from JavaScript, call the function `window.webkit.messageHandlers.<messageHandlerName>.postMessage(<messageBody>)` in your code. You specify the value of `<messageHandlerName>` when you install your message handler in a `WKUserContentController` object."
- **Justification:** Only a native app that installs a handler creates this object. The failing code talks to the Facebook app, so the fix belongs in classification and alerting, not in our page code (no shim; §4).

### [C3] — "some" vs "every" in the SDK's decision
- **Relevant File(s):** `__tests__/lib/third-party-filter.test.ts`, `lib/sentry/third-party-filter.ts`
- **Change Summary:** Test fixtures exercise the exact rule that decides the tag.
- **Source URL:** https://github.com/getsentry/sentry-javascript/blob/11.11.0/packages/core/src/integrations/third-party-errors-filter.ts#L102-L108
- **Verbatim Quote:**
  > "const arrayMethod =
  >   options.behaviour === 'drop-error-if-contains-third-party-frames' ||
  >   options.behaviour === 'apply-tag-if-contains-third-party-frames'
  >     ? 'some'
  >     : 'every';
  >
  > const behaviourApplies = frameKeys[arrayMethod](keys => !keys.some(key => options.filterKeys.includes(key)));"
- **Justification:** Exclusive mode uses `every`, so one `jowray_com` frame prevents the tag. A3 cases 1–4 assert this on the installed 11.11.0 code, so an SDK upgrade that changes it fails the test.

### [C4] — Contains-mode tags any event with one foreign frame
- **Relevant File(s):** `instrumentation-client.ts` (the line being replaced), `__tests__/lib/third-party-filter.test.ts` (contrast case)
- **Change Summary:** Why today's tag can't gate alerts.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/filtering/#using-thirdpartyerrorfilterintegration
- **Verbatim Quote:**
  > "`\"apply-tag-if-contains-third-party-frames\"`: Keep all error events, but apply a `third_party_code: true` tag in case the error contains at least one third-party stack frame."
- **Justification:** One extension frame on the stack of our own error would tag it and, with an alert filter, silence it. Changing the mode on line 65 removes that risk.

### [C5] — Why the issue was High
- **Relevant File(s):** none changed (explains E8; Part B keeps "priority ≥ high" as block 1's base filter)
- **Change Summary:** An unhandled `error` event becomes a High issue, which the default alert emails.
- **Source URL:** https://docs.sentry.io/product/issues/issue-priority/#how-priority-works
- **Verbatim Quote:**
  > "**High**: Issues that are likely to be actionable and require immediate attention, such as `ERROR` and `FATAL` events."
- **Justification:** Priority comes from the level, not from whether the code is ours, so the alert needs the extra tag filter.

### [C6] — What `app:///` means
- **Relevant File(s):** `docs/features/sentry-telemetry.md` (worked example)
- **Change Summary:** Explains why the frames read `app:///`: the page document URL with its origin rewritten.
- **Source URL:** https://github.com/getsentry/sentry-javascript/blob/11.11.0/packages/nextjs/src/client/clientNormalizationIntegration.ts#L51-L52
- **Verbatim Quote:**
  > "const { origin } = new URL(frame.filename as string);
  > frame.filename = frame.filename?.replace(origin, 'app://').replace(rewriteFramesAssetPrefixPath, '');"
- **Justification:** A frame at `https://www.jowray.com/` becomes `app:///`, so the code ran in the document itself (injected or inline), not in a `/_next/` chunk. The docs example states this so the next reader isn't misled by `in_app: true`.

### [C7] — The SDK already drops Facebook webview noise by default
- **Relevant File(s):** `docs/plans/2026-11-08-third-party-alerts.md` (§4 non-goal rationale)
- **Change Summary:** Precedent that this class of error is unactionable; we keep it but don't page.
- **Source URL:** https://github.com/getsentry/sentry-javascript/blob/11.11.0/packages/core/src/integrations/eventFilters.ts#L24
- **Verbatim Quote:**
  > "/Java object is gone$/, // error from Facebook Mobile browser (https://github.com/getsentry/sentry-javascript/issues/15065, https://github.com/getsentry/sentry-javascript/issues/23733)"
- **Justification:** It confirms Sentry's own maintainers treat in-app browser errors as noise. Rob's ruling keeps collection, so we only change routing.

### [C8] — Exclusive tag mode
- **Relevant File(s):** `lib/sentry/third-party-filter.ts`, `instrumentation-client.ts`, `__tests__/lib/third-party-filter.test.ts`, `AGENTS.md`, `docs/code-layout.md`, `docs/plans/2026-11-08-third-party-alerts.md`
- **Change Summary:** Switch `behaviour` to `apply-tag-if-exclusively-contains-third-party-frames`.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/filtering/#using-thirdpartyerrorfilterintegration
- **Verbatim Quote:**
  > "`\"apply-tag-if-exclusively-contains-third-party-frames\"`: Keep all error events, but apply a `third_party_code: true` tag in case the error contains exclusively third-party stack frames."
- **Justification:** "Keep all error events" honours the tag-never-drop ruling. "Exclusively" makes the tag mean "no frame of ours", which is safe to filter alerts on.

### [C9] — Why `ignoreSentryInternalFrames` stays off
- **Relevant File(s):** `lib/sentry/third-party-filter.ts` (comment; option omitted)
- **Change Summary:** Leave the option at its default `false`.
- **Source URL:** https://github.com/getsentry/sentry-javascript/blob/11.11.0/packages/core/src/integrations/third-party-errors-filter.ts#L38-L46
- **Verbatim Quote:**
  > "In minified bundles the SDK wrapper frame is detected heuristically, so an application frame can be mistaken for an SDK frame — with a `drop-*` behaviour, that error is dropped."
- **Justification:** In tag mode the same misdetection would tag our own error and silence its alert. Pre-mortem item 3 accepts the opposite, safer error.

### [C10] — Issue stream search for the tag
- **Relevant File(s):** `lib/sentry/third-party-filter.ts` (comment), `docs/features/sentry-telemetry.md`
- **Change Summary:** Document `!third_party_code:True` for hiding third-party issues in the stream.
- **Source URL:** https://github.com/getsentry/sentry-javascript/blob/11.11.0/packages/core/src/integrations/third-party-errors-filter.ts#L30
- **Verbatim Quote:**
  > "If you chose the mode to only apply tags, the tags can then be used in Sentry to filter your issue stream by entering `!third_party_code:True` in the search bar."
- **Justification:** It gives the exact tag value (`True`) that the alert's "is not set" filter avoids depending on, and the search Rob can save as a view.

### [C11] — `instrumentation-client.ts` must stay synchronous
- **Relevant File(s):** `instrumentation-client.ts`
- **Change Summary:** Import the options constant statically; no async work added.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client#execution-timing
- **Verbatim Quote:**
  > "Only synchronous, top-level code is guaranteed to complete before hydration."
- **Justification:** A static import of a plain object keeps `Sentry.init` synchronous and top-level, so error capture still starts before hydration.

### [C12] — The key is a build-time mark on our files
- **Relevant File(s):** `scripts/check-sentry-app-key.ts`, `__tests__/scripts/check-sentry-app-key.test.ts`, `package.json` (`build`)
- **Change Summary:** Check the build output for the mark after every build.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/filtering/#using-thirdpartyerrorfilterintegration
- **Verbatim Quote:**
  > "This integration works by \"marking\" your JavaScript files with an \"application key\" during the build process. At runtime, if an error occurs, this integration checks application keys for each stack frame in the stack trace."
- **Justification:** If the build stops marking files, every frame looks third-party. Checking `.next/static` for the mark catches that before deploy.

### [C13] — Turbopack injection is gated on a version check
- **Relevant File(s):** `scripts/check-sentry-app-key.ts`
- **Change Summary:** Why the guard is needed and why it needs no network: injection is a loader rule that a version check can switch off.
- **Source URL:** https://github.com/getsentry/sentry-javascript/blob/11.11.0/packages/nextjs/src/config/turbopack/constructTurbopackConfig.ts#L68-L76
- **Verbatim Quote:**
  > "// Tag modules so thirdPartyErrorFilterIntegration can identify first-party code. Dependencies
  > // are tagged by default to match webpack's BannerPlugin, which injects metadata into all chunks."
- **Justification:** The rule that follows (line 76) runs only `if (applicationKey && nextJsVersion && supportsTurbopackRuleCondition(nextJsVersion))`, so a Next.js version the SDK doesn't recognise turns it off silently. Dependencies are tagged by default, which is why Sentry's timer-wrapper frame counts as ours in V2.

### [C14] — Alert tag filter supports "is not set"
- **Relevant File(s):** none (Sentry alert `6280207`, B1), `docs/features/sentry-telemetry.md`, `AGENTS.md`, `docs/code-layout.md`
- **Change Summary:** Block 1 filter "Tagged event: `third_party_code` is not set".
- **Source URL:** https://docs.sentry.io/product/monitors-and-alerts/alerts/create-alerts/#filter-by-event-attributes
- **Verbatim Quote:**
  > "Event attribute and tag filters support these match types: contains, equals, starts with, ends with, does not contain, does not equal, does not start with, does not end with, is set, is not set, is one of, and is not one of."
- **Justification:** The SDK sets the tag only when it applies, so "is not set" matches exactly the events with a frame of ours, without depending on the value's case.

### [C15] — Tag filters need the new-issue trigger
- **Relevant File(s):** none (Sentry alerts B1/B2), `docs/features/sentry-telemetry.md`
- **Change Summary:** B1 uses "A new issue is created"; escalation moves to its own alert (B2).
- **Source URL:** https://docs.sentry.io/product/monitors-and-alerts/alerts/create-alerts/#if-filters
- **Verbatim Quote:**
  > "Frequency and event attribute filters only work with the A new issue is created and An event or issue activity is captured triggers."
- **Justification:** Today's rule uses the legacy high-priority triggers, so the tag filter can't be added to it as it stands. Splitting the triggers keeps both behaviours working.

### [C16] — Separate If/Then blocks
- **Relevant File(s):** none (Sentry alert `6280207`, B1 block 2), `docs/features/sentry-telemetry.md`
- **Change Summary:** A second block emails `ChunkLoadError` even though it is tagged.
- **Source URL:** https://docs.sentry.io/product/monitors-and-alerts/alerts/create-alerts/#add-multiple-ifthen-blocks
- **Verbatim Quote:**
  > "Every block evaluates separately against the same triggers, so you can route different event shapes to different places from a single Alert"
- **Justification:** It keeps the one known first-party, runtime-only error emailing (E7) without weakening block 1.

### [C17] — Escalation trigger
- **Relevant File(s):** none (Sentry alert B2), `docs/features/sentry-telemetry.md`
- **Change Summary:** The new alert "High-priority issue escalates" replaces the legacy `existing_high_priority_issue` trigger.
- **Source URL:** https://docs.sentry.io/product/monitors-and-alerts/alerts/create-alerts/#when-triggers
- **Verbatim Quote:**
  > "An event on an issue caused it to move from a lower priority to a higher one, or causes it to be flagged as escalating."
- **Justification:** It matches what the current second trigger does, so Rob loses no escalation emails.

### [C18] — Archive until escalating
- **Relevant File(s):** none (Sentry issue JOWRAY_COM-D and the preview-check issues, Part C)
- **Change Summary:** Archive the noise issue but let a surge bring it back.
- **Source URL:** https://docs.sentry.io/product/issues/states-triage/#archive
- **Verbatim Quote:**
  > "Archive an issue to move it out of the issue stream and pause alerts on it until the issue gets worse. Archiving makes sense for noisy issues that are less pressing or not applicable to you or your team."
- **Justification:** It clears the stream while keeping every event and a signal if Facebook's script starts failing at volume.

### [C19] — Issue priority filter
- **Relevant File(s):** none (Sentry alerts B1 block 1 and B2)
- **Change Summary:** Keep "high priority" as the base condition of both alerts.
- **Source URL:** https://docs.sentry.io/product/monitors-and-alerts/alerts/create-alerts/#filter-by-issue-attributes
- **Verbatim Quote:**
  > "The current issue priority is greater than or equal to high, medium, or low."
- **Justification:** It reproduces today's "high priority" scope under the new triggers, so medium and low issues stay quiet as they do now.
