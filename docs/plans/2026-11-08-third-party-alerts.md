# JOWRAY_COM-D (Facebook in-app browser error): stop third-party noise from emailing Rob, keep collecting it

Status: done 2026-11-09. Part A merged in PR #100 (`7c0d01d`); Part B (alerts) set and verified; Part C archives done (see §8 Ledger). Sentry issue: https://med3ai.sentry.io/issues/7836155008/

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

**A7 (review round 1, R1-1). `untagErrorsWithoutLocatedFrames` in `lib/sentry/third-party-filter.ts`, called first in the browser's `beforeSend`**: removes `third_party_code` when no frame has a filename plus a line, column or instruction address, the case where the SDK tags with no evidence [C20, C21]. Tests in `__tests__/lib/third-party-filter.test.ts` [C21].

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
| S11 | Claude | Preview round 2 (routing), §6 V3–V5 | V3, V4 and V5 each created a **new** issue (first seen during the run), confirmed before any email check; V3 tagged and not emailed; V4 and V5 untagged and emailed |
| S12 | Rob or Claude | Part C archives | JOWRAY_COM-D and the check issues `is:archived` |
| S13 | Claude | update the memory index entry for this work | MEMORY.md line added |

## 6. Verification

- **Unit**: A3 cases 1–4 and the A4 fixtures (S2–S3); the full suite (S5).
- **Build**: S5's build log and grep prove an offline Turbopack build injects the key (closes E9's open question in CI).
- **V1 (preview, tagged)**: in the PR preview, signed in to Vercel (chrome-devtools MCP or Rob), run in the console `const s=document.createElement("script"); s.textContent="(function w(){ window.jowrayThirdPartyCheck.messageHandlers })()"; document.head.appendChild(s);`. This is an inline script with no key, the same shape as JOWRAY_COM-D. Expect an issue in environment `preview` with `third_party_code: True`.
- **V2 (preview, not tagged)**: `setTimeout(() => { throw new Error("jowray preview check: wrapped timer (safe to ignore)") })`. Sentry's timer wrapper sits in our keyed bundle, so one frame is ours. Expect **no** `third_party_code` tag. Under today's mode this exact shape was tagged (JOWRAY_COM-4).
- **V3–V5 (after B1/B2), routing.** B1 fires only when an issue is created, so each case must create a new issue. A new message is not enough: Sentry groups a stack trace by its frames and exception type, not its message, and S7 and S7b both grouped the wrapped-timer check into the existing JOWRAY_COM-4 despite new messages. Each case therefore throws an exception type this project had not seen (on 2026-11-08 `jowray_com` had no `URIError` or `RangeError` issue; its one `SyntaxError` issue, JOWRAY_COM-5, is a server stack):
  - **V3**: an injected inline script (as V1) throws `new URIError("jowray preview check: injected script, round 2 (safe to ignore)")`. Expect a new issue tagged `third_party_code: True` and **no** email.
  - **V4**: a Sentry-wrapped timer (as V2) throws `new RangeError("jowray preview check: wrapped timer, round 2 (safe to ignore)")`. Expect a new issue, untagged, emailed.
  - **V5**: `Promise.resolve("<round 2").then(JSON.parse)`, left unhandled. Chrome's stack is only `at JSON.parse (<anonymous>)`. Expect a new `SyntaxError` issue, untagged, emailed. This is the end-to-end check of the `beforeSend` untag step (§9 R1-1).
  - **V5 as run (2026-11-09).** In Chrome 156 neither form above reaches Sentry automatically. A built-in passed straight to `.then()` (`.then(JSON.parse)`) does not dispatch `unhandledrejection` at all; the arrow form does, but then the arrow's own frame is located. `queueMicrotask(JSON.parse)` reaches `window.onerror` only as a muted "Script error." with no error object, which the SDK ignores by default. So V5 hands the deployed client a `SyntaxError` carrying Chrome's built-ins-only stack (`at JSON.parse (<anonymous>)`) through `window.__SENTRY__[version].defaultCurrentScope.captureException`, which is the path `Sentry.captureException` and `reportClientError` take, marked unhandled. That is the realistic route for this stack: our own code reporting a caught `JSON.parse` failure.
  - **Before checking any email**, read back each case's issue and confirm it is new: its `firstSeen` falls within the run (`sentry api "organizations/med3ai/issues/?query=error.type:URIError&statsPeriod=1h"`, likewise `RangeError` and `SyntaxError`). A case that grouped into an older issue proves nothing about routing; change its exception type or function name and rerun it. Then confirm the email outcome in Rob's inbox (Gmail search `from:sentry "round 2"`) and in each issue's activity.
- **Production**: no synthetic production errors. JOWRAY_COM-D's next event keeps `third_party_code: True` (`sentry issue events`).

## 7. Pre-mortem: "it shipped and it failed. Why?"

1. *A real bug never emailed.* Only an error with no frame from our bundles is tagged (A3 case 2). Turbopack `ChunkLoadError` has its own block (B1). Other runtime-only errors, such as a missing module factory after a deploy, are tagged and don't email as new issues; they stay in Sentry and B2 still fires if they surge. Accepted residual.
2. *Injection silently stopped after an upgrade, and everything looked third-party.* A4 fails the build (local, CI and Vercel) before such a deploy ships.
3. *Rob still gets in-app-browser emails.* Third-party code called through a Sentry-wrapped timer or listener carries a keyed wrapper frame, so it isn't tagged (V2 proves the mechanism) and still emails. This errs toward alerting; leave it unless it recurs.
4. *The tag filter quietly did nothing.* A tag filter on an escalation trigger is unsupported [C15], so escalation is a separate alert (B2), and V3–V5 test the routing end to end, each on an issue confirmed new.

## 8. Ledger

| When | Step | Result | Evidence |
|---|---|---|---|
| 2026-11-08 | Plan approved | Rob approved the plan as written | session |
| 2026-11-08 | S1 | worktree `../jowray_wt_third_party_alerts` on `fix/sentry-third-party-alerts` from `5726441` | `git log -1` |
| 2026-11-08 | S2 | both new test files RED because the module and script did not exist | vitest: "Cannot find package '@/lib/sentry/third-party-filter'" |
| 2026-11-08 | S3 | A1, A2, A4 in place; the two new test files and `replay-options.test.ts` pass (16 tests) | vitest |
| 2026-11-08 | S4 | A5 docs; `AGENTS.md` and `docs/code-layout.md` received the same two replacements | diff |
| 2026-11-08 | S5 | `npm run validate` clean; `npm run test:run` 3683 passed, 68 skipped (real-Postgres suites without `TEST_DATABASE_URL`; this change touches no database code); `CI=1 npm run build:offline` passed both gates: `check-sentry-app-key: OK (_sentryBundlerPluginAppKey:jowray_com in 26 of 32 client chunks, including our Sentry init ...)`. The 6 unmarked files hold none of our code: a Turbopack async-loader stub, the `noModule` polyfills, the Turbopack runtime and three manifests. This closes E9: an offline Turbopack build injects the key | build log |
| 2026-11-08 | S6 | PR #100 (draft); `ci`, python-notify, Vercel preview all pass. The CI build log shows `check-sentry-app-key: OK (... 26 of 32 client chunks, including our Sentry init ...)` | PR checks |
| 2026-11-08 | S7 | Preview `98c0c61`, headless Chrome over CDP, with the bypass sent as a CDP network header (never in a URL, never printed). V1: the inline-script error arrived as JOWRAY_COM-F, environment `preview`, `third_party_code = True`. V2: the wrapped-timer error grouped into JOWRAY_COM-4 (same stack shape as its 2026-11-04 event, which contains mode tagged `True`) and arrived with **no** `third_party_code` tag. Tunnel answered 200 throughout | `sentry api organizations/med3ai/issues/7836372216/events/latest/`; `.../issues/7829382036/events/?statsPeriod=24h` |
| 2026-11-08 | S8 | Independent subagent review, round 1: four findings; R1-1, R1-3 and R1-4 fixed, R1-2 answered by S7 (§9). `validate` clean; 18 tests in the two new files; full suite 3687 passed, 68 skipped; `CI=1 build:offline` passed both gates | §9 |
| 2026-11-08 | S7b | Preview re-check on `168f1f5` (with the `beforeSend` untag step; the preview took about 150 s to update after `ci`). Injected-script error arrived as JOWRAY_COM-G, `third_party_code = True`; wrapped-timer error grouped into JOWRAY_COM-4, no tag. Tunnel 200 throughout | `sentry api organizations/med3ai/events/?query="round 1b"&field=third_party_code` |
| 2026-11-08 | S8 (TCR round 1) | Team Code Review on `7e321ee`: George 4 findings, Oscar 3 (§10). Buckets 1 and 2 done (S11/V3–V5 rewritten with new exception types and a `firstSeen` check; docs no longer call Part B live; a real `BrowserClient` pipeline block with 8 cases and a WebAssembly-frame unit case); bucket 3 answered in the [PR comment](https://github.com/RobertdWray/jowray_com/pull/100#issuecomment-6731185194); bucket 4 in the PR body. `validate` clean; 27 tests in the two new files; full suite 3696 passed, 68 skipped; `CI=1 build:offline` passed both gates: `check-sentry-app-key: OK (_sentryBundlerPluginAppKey:jowray_com in 26 of 32 client chunks, including our Sentry init in chunks/2yad4v-abi12h.js)` | `~/Downloads/team-review-20261108-213817-jowray_com-pr100-7e321ee.md`; build log |
| 2026-11-08 | S8 (regression + approval) | Fable 5.1 regression check on `861857f` against `5726441`: no regressions. Verified: `beforeSend` still scrubs every error event and the untag step keeps every other field; the gate finds the root as `check-traces.ts` does and passed in CI and on Vercel; the BrowserClient test leaks no global state (own Scope, metadata restored, CommonJS copies); the docs do not claim the alerts are live. One MINOR note: a hand-set `third_party_code: true` would also be removed, but nothing sets it. Orchestrator gave final approval to merge | regression subagent report |
| 2026-11-09 | S9 | PR #100 merged as `7c0d01d`; production served it 60 s later (commit SHA in the served JS) | `gh pr view 100` |
| 2026-11-09 | S10 | Rob asked Claude to use the `sentry` CLI. The CLI's `alert issues edit` builds one If/Then block, so the change went through `sentry api` on the workflow endpoints. `PUT organizations/med3ai/workflows/6280207/` renamed it "High-priority new issues (not third-party)" with trigger `first_seen_event`; block 1 all {`issue_priority_greater_or_equal` 75, `tagged_event` `third_party_code` `ns`}; block 2 all {`event_attribute` `exception.type` `eq` `ChunkLoadError`}; both email issue owners (fallback: recently active members); frequency 0; all environments; detector `10834731`. `POST organizations/med3ai/workflows/` created `6314965` "High-priority issue escalates" with trigger `existing_high_priority_issue` and the same email. That trigger is the old rule's second one; the workflow API lists no trigger named "An issue escalates". **Rollback:** PUT `6280207` back to name "Send a notification for high priority issues", triggers `new_high_priority_issue` + `existing_high_priority_issue`, one action filter with no conditions and the same email; delete `6314965` | `sentry alert issues list med3ai/jowray_com --json` |
| 2026-11-09 | S11 | Preview round 2: V3 `URIError` made JOWRAY_COM-J (new, `third_party_code = True`, medium); the alert did **not** fire. V4 `RangeError` made JOWRAY_COM-H (new, untagged, high); it fired at 13:42:31 and the email arrived at 13:42:36. V5 as planned never reached Sentry (§6 note). V5 as run made JOWRAY_COM-M (new, untagged, high); it fired at 13:52:48, but no email came, because Claude archived M 66 s later. The project batches alert emails (`digestsMinDelay` 300 s, `digestsMaxDelay` 1800 s), and an archived issue appears to be dropped from a pending digest. Round 3 (`EvalError` from a wrapped timer) grouped into the archived H: for that stack, Sentry's wrapper frame decides the group, not the exception type. Round 4 used a custom fingerprint: JOWRAY_COM-N (new, untagged, high) fired at 14:07:54 and the email arrived at 14:08:27. Rob confirmed the H and N emails. The escalation alert was not exercised; that would need a surge | `.../workflows/6280207/group-history/`; Gmail |
| 2026-11-09 | S12 | JOWRAY_COM-D, -4, -F, -G, -H, -J, -M and -N archived until escalating (`sentry issue archive --until auto`) | `sentry api organizations/med3ai/issues/?query=issue:...` |
| 2026-11-09 | Lessons | For a routing check, force a new issue with a custom fingerprint, and leave the issue alone until its email arrives (at least 5 minutes, the digest delay) | this ledger |

## 9. Review round 1 (2026-11-08, independent subagent)

| # | Severity | Finding | Disposition |
|---|---|---|---|
| R1-1 | IMPORTANT | In exclusive mode an error whose stack holds only browser built-ins is tagged. Example: an unhandled `.then(JSON.parse)` rejection, whose stack is only `at JSON.parse (<anonymous>)` in Chrome or `parse@[native code]` in Safari. The SDK skips frames without a line or column, and `every` over an empty list is true; contains mode never tagged these | **Fixed.** Reproduced with the real browser stack parser and integration. `untagErrorsWithoutLocatedFrames` (`lib/sentry/third-party-filter.ts`) removes the tag when no frame has a filename plus a line, column or instruction address, the same test the SDK applies [C21]. It runs in `beforeSend`, which Sentry guarantees runs after every event processor [C20]. Tests pin both halves: the SDK alone tags these stacks, and our pipeline does not |
| R1-2 | IMPORTANT | Nothing proves that frames from our files get the key at runtime; the unit test sets `module_metadata` itself, and the build gate checks only a string | **Already shown by S7 V2.** The wrapped-timer event's Sentry wrapper frame comes from our marked bundle. If runtime attachment had failed, both of its frames would lack the key and exclusive mode would have tagged the event; it arrived untagged on the deployed `98c0c61` build. V1 being tagged shows the integration ran. No change |
| R1-3 | NICE-TO-HAVE | The feature doc said only the polyfills and the runtime stay unmarked; the build also leaves a Turbopack dynamic-import loader file and three manifests unmarked | **Fixed** wording |
| R1-4 | NICE-TO-HAVE | The test comment said it loads "exactly the code the app ships"; it loads the CommonJS build resolved from `@sentry/nextjs`, while the browser reaches `@sentry/core` through `@sentry/browser` | **Fixed:** the comment now says what is loaded, and a test asserts both resolve to the same installed copy |
| R1-5 | note | No further findings. The reviewer confirmed the init marker is unique to our options in runtime code, that the gate cannot fail on a healthy build, that the `isEntrypoint` import is side-effect free, and that no house rule is broken. Turning on `applicationKeyExcludeDependencies` would leave React unmarked: React-only errors would be tagged and the gate would still pass | **Guarded by a warning** in `lib/sentry/third-party-filter.ts` and the feature doc; `next.config.ts` does not set it |

## 10. Team Code Review round 1 (2026-11-08, George and Oscar)

Reviewed head `7e321ee`. George (Gemini, `gemini-4-argon`) found 4, Oscar (Codex) 3; the orchestrator verified each against the source and sorted them. Buckets: 1 must do, 2 do, 3 not doing (reasons in the [PR comment](https://github.com/RobertdWray/jowray_com/pull/100#issuecomment-6731185194)), 4 real but out of scope (follow-ups in the PR body).

| # | Reviewer | Finding | Bucket | Disposition |
|---|---|---|---|---|
| TCR-1 | George, medium | `untagErrorsWithoutLocatedFrames` is untested on tagged events with a malformed shape and on its `instruction_addr` branch; add `?.` on array elements, because a throw in `beforeSend` drops the event | 2 (WASM test), 3 (null-safety) | **Test added:** a frame located only by `instruction_addr` keeps the tag. **Not doing** the `?.`: unreachable. The step returns early unless the integration tagged the event, and the integration tags only after `getFramesFromEvent` has read every exception value's `stacktrace.frames` (a value without one returns `undefined`, so nothing is tagged) and `getBundleKeysForAllFramesWithFilenames` has read every frame's `filename` outside its try/catch, so a null frame throws before any tag exists |
| TCR-2 | George, medium | No test has an exception chain (`Error.cause`) | 2 | **Done** in the new browser-pipeline block: a cause with our frame (untagged), built-ins throughout (untagged), an injected-script error with a built-in-only cause (tagged); each asserts both exceptions arrived |
| TCR-3 | George, low | `browserTag` relied on `processEvent` mutating the event in place and left out `scrubEvent` | 2 | **Done:** `sdkProcess` returns the event `processEvent` passes on and the helpers use it; the pipeline block runs the init's exact `beforeSend`, `scrubEvent` included |
| TCR-4 | George, low | Assert `APP_KEY_MARK` and `INIT_MARK` against the installed SDK's internals | 3 | **Not doing.** Both mismatches already fail the build loudly: a renamed key prefix leaves the init chunk without our mark, and the init literal turning up in another chunk only widens what the gate checks. Grepping SDK internals would couple a test to a non-exported constant and the package's file layout |
| TCR-5 | Oscar, medium | V3/V4 assumed a "round 2" message makes new issues; stack grouping ignored message changes in S7/S7b, and B1 fires only on new issues | 1 | **Fixed** in §5 S11 and §6: V3 (`URIError`, injected), V4 (`RangeError`, wrapped timer) and the new V5 (unhandled `.then(JSON.parse)`, the end-to-end check of the untag step), each confirmed new by `firstSeen` before any email check |
| TCR-6 | Oscar, medium | The browser test bypassed the real `beforeSend` pipeline: no `scrubEvent`, no SDK normalization, no callback-error handling | 2, 3 (callback-error handling) | **Done:** a real `BrowserClient` (browser stack parser, the integration, linked errors, the init's `beforeSend`, in-memory transport, our chunk marked through `_sentryModuleMetadata`) captures eight errors from Chrome and Safari stack strings and asserts delivery and the final tag. Disabling the untag step fails three of its cases (Chrome and Safari built-ins, the built-in-only chain), unmarking our chunk fails two (ours plus extension, the cause with our frame). **Not doing** a try/catch in `beforeSend`: swallowing errors breaks the rule against hiding errors, and the step cannot throw on SDK-built events (TCR-1) |
| TCR-7 | Oscar, low | `AGENTS.md`, `docs/code-layout.md` and the feature doc described the Part B alerts as live | 1, 4 | **Fixed:** the mirror now says the alert "can skip tagged new issues once it is set up", and the feature doc says the alerts were not yet set when PR #100 merged and that §8 records when they are. Follow-up (bucket 4): once S10 is done, say they are live, with the date |

Bucket 4 (in the PR body, "Follow-ups (Team Code Review round 1, bucket 4)"): the upstream SDK edge behind R1-1 (exclusive mode tags events whose frames all lack location info; a candidate `getsentry/sentry-javascript` issue, Rob decides), and the docs update after S10.

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

### [C20] — `beforeSend` runs after every event processor
- **Relevant File(s):** `instrumentation-client.ts` (`beforeSend`), `lib/sentry/third-party-filter.ts` (`untagErrorsWithoutLocatedFrames`)
- **Change Summary:** Run the untag step in `beforeSend`, not as an event processor.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/enriching-events/event-processors/
- **Verbatim Quote:**
  > "`beforeSend` and `beforeSendTransaction` are guaranteed to be run last, after all other event processors, (which means they get the final version of the event right before it's sent, hence the name). Event processors added with either of the methods below run in an undetermined order, which means changes to the event may still be made after the event processor runs."
- **Justification:** The tag is applied by the integration's event processor. Only `beforeSend` is documented to run after it, so the correction must live there (before `scrubEvent`), not in `Sentry.addEventProcessor`, whose order the docs leave undetermined.

### [C21] — The SDK skips frames without location info
- **Relevant File(s):** `lib/sentry/third-party-filter.ts` (`untagErrorsWithoutLocatedFrames`), `__tests__/lib/third-party-filter.test.ts`
- **Change Summary:** Untag exactly when no frame survives the SDK's location test.
- **Source URL:** https://github.com/getsentry/sentry-javascript/blob/11.11.0/packages/core/src/integrations/third-party-errors-filter.ts#L190-L197
- **Verbatim Quote:**
  > "// Exclude frames without location info, since these are likely native code or built-ins.
  > // JS frames have lineno/colno, WASM frames have instruction_addr instead.
  > if (frame.lineno == null && frame.colno == null && frame.instruction_addr == null) {"
- **Justification:** When this leaves no frame, `every` (C3) is vacuously true and the event is tagged without evidence. The untag step applies the same filename-plus-location test, so it removes the tag in exactly that case and nowhere else.
