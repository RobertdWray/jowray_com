# Share form quick fixes (items 1–7, 2026-11-04)

Canonical copies: `/Users/rob/.claude-work/plans/can-you-make-a-tender-map.md` (this file; the filename is the planner's
auto-name and says nothing about the content) and, from step S1 on,
`/Users/rob/Documents/active_work/jowray_wt_share_fixes/docs/plans/2026-11-04-share-form-quick-fixes.md` (the repo copy, which
ships with PR A and is the one to edit during execution; mirror back here at the end of each step).

## Context

Rob reviewed jowray.com/share on a wide desktop on 2026-11-04 and sent two screenshots with seven numbered items. Verbatim:

1. "Email (optional · so we can say thank you and send your private link) - This should not be optional - remove: (optional · so we
   can say thank you and send your private link)"
2. "Use Jane doe for helper text name, Kay Bartholomew was her sister and that is confusing."
3. "use your@email.com for helper text"
4. "Helper text is getting cropped, and is too dark. we should make this 50% lighter to make it clear this is helper text. [Image #1]"
5. "Who can see this?: Should only be two options: Family, and Everyone. Everyone by default."
6. "If we haven't done this yet, let's flash, scroll the user to the empty field or otherwise make it obvious if someone tries to
   submit with no email listed. have a ui/ux subagent review this for old people compliance? Why can't I submit. But I'd like to
   leave email at the top."
7. "On the desktop, let's make better use of the negative space. [Image #2] - for example on a 5k display, i suspect we shouldn't
   take multiple pages just to do one memory, but I could be wrong. Have a ux/ ui expert look about the best way to optmize the ui
   for large laptops, displays, etc."

"Helper text" in items 2–4 means the input placeholders. Image 1 is a crop of two cropped placeholders; image 2 is the full /share
page in a 2000px-wide Chrome window. Both are copied into the evidence folder at S7 as `rob-item4-cropped-placeholders.png` and
`rob-item7-desktop-2000.png` from `/private/tmp/claude-501/-Users-rob-Documents-active-work-jowray-com/23b6e067-9aff-48d7-ad33-e96309ecc801/images/{1,2}.png`.

| Rob's item | Plan section | Verification check |
|---|---|---|
| 1 | §A1.5 (label), §A1.1 (required) | Runtime bullet "390×844" and "Blank form + Send" |
| 2 | §A2 | S5 grep done-check |
| 3 | §A2 | S5 grep done-check |
| 4 | §A2 (cropping), §A3 (weight; colour per ruling 1) | Runtime bullet "390×844"; contrast bullet |
| 5 | §A4 | Runtime bullet "Who can see this?"; `visibility.test.ts` |
| 6 | §A1.4–A1.8 | Runtime bullets "Blank form + Send", "kay@", "Server path"; part 3 checklist |
| 7 | §B0–B5 | Runtime bullet "PR B" and the §B1 table |

**Baseline.** All observations were made at `origin/main` = `9ffdb8e` (read through the `jowray_wt_admin_page` worktree at
`4956b2d`; `git diff --stat 4956b2d 9ffdb8e -- app/share lib app/_components app/globals.css app/m features/memories design` is
empty, so the two are identical for every file this plan touches). The main checkout `/Users/rob/Documents/active_work/jowray_com`
is 135 commits behind and must not be used. Installed versions: Next 16.4.4, React 19.3.0, zod 4.6.7, Tailwind 4.3.3.

### Root causes found

- **Bold, dark, cropped placeholders (item 4).** `inputClass` (`app/_components/field-classes.ts:3`) sets no font weight and
  Tailwind's Preflight gives `input`/`select`/`textarea` `font: inherit` [C15], so every field inherits `font-bold` from
  `labelClass`. Typed text and placeholders are both bold; only colour differs. The placeholder colour `--color-wood #8a7259` on
  white measures **4.53:1**, already the WCAG AA floor, and WCAG 1.4.3 explicitly covers placeholder text [C12]. So "50% lighter"
  (≈#c5b9ac, 1.92:1) cannot ship; the fix is weight and copy length (Rob's ruling 1).
- **Desktop column shrinks as the window grows (item 7).** `share-form.tsx:297` puts `max-w-[860px]` and `px-[max(16px,5%)]`
  on the same border-box; the 5% resolves against the full-width parent, so the usable column is 732px at 1280, 660px at 2000
  (Rob's screenshot) and 604px at 2560. Same pattern on `app/_components/site-header.tsx:6`.
- **No email check (items 1, 6).** `contributorFields.email` is `.nullable().optional()` (`lib/validations/memory.ts:44-54`);
  the form is `noValidate` and `validateForSend` (`lib/memory-cards.ts:148`) only checks cards. A server "Enter a valid email
  address" returns `memoryIndex: null` and is shown only above the Send button, with no `aria-invalid` and no focus.
- **Three visibility options (item 5).** `VISIBILITY_OPTIONS` (`lib/visibility.ts:9-13`) is shared by share, claim and both admin
  forms; the share zod enum accepts all three.

## Rob's rulings (2026-11-04, final; do not re-ask)

1. **Placeholder colour stays `wood`.** Fix is regular weight plus one short example per field; no colour token change (stays AA).
2. **Name is required too**, with the DESIGN.md error line [C26]. Only "How you knew Jo" stays optional and is marked "(optional)".
3. **Visibility labels are plain "Everyone" and "Family"** (amends D13 for the contributor forms) [C23]. Everyone first and default.
4. **Desktop: single column at 1040px with side-by-side rows.** No right-hand rail; revisit after the 2560 evidence.

---

## Premortem review (George + Oscar, 2026-11-04 13:01) sorted into four buckets

Source: `/private/tmp/team-review-20261104-124626-jowray_com-plan-tender-map-9ffdb8e/{george-review.txt,oscar-final.md}`.
Each point was checked against the source at 9ffdb8e before sorting. G = George (13 points), O = Oscar (12 points).

**Bucket 1 — Must do (folded into §A/§B below)**
- G1 + O1: `revealField` ran before React committed, so on the server-error path the input was still `disabled` and `focus()`
  no-ops. Verified: `disabled={sending}` on every contributor input (`share-form.tsx:316,322,333`). Fix: focus from an effect
  keyed on a reveal request (§A1.6) [C32].
- G4.2 + O3: `z.string().min(1, msg)` gives a generic type error for `undefined`/`null`. Verified against zod 4 docs [C31]. Fix:
  `z.string({ error })` error map (§A1.1).
- G4.1 + O4: client `z.email().safeParse` on an untrimmed value disagrees with the trimmed server schema. Fix: export the two
  contributor schemas and reuse them on the client (§A1.1, §A1.4).
- G2 + O5: name-required instructions were conditional and the markup/tests for name were missing. Fixed throughout; citations
  C17/C29 withdrawn.
- G5 + O6: `PipelineInput.visibility` (`lib/submission-pipeline.ts:44`) still `"PUBLIC" | "FAMILY" | "PRIVATE"`. Verified. Fix §A4.
- G6: `submissionIssueLocation` already destructures a local named `field`; a careless extension returns `issue.path[2]`. Verified
  (`lib/validations/memory.ts:98`). Exact implementation now specified (§A1.2).
- G7.1: moving inputs out of `<label>` loses `labelClass`'s `flex flex-col gap-2`; the third field orphans at `sm:grid-cols-2`.
  Fix: wrapper classes and `sm:col-span-2 roomy:col-span-1` (§A1.5, §B2).
- G7.2: `roomy:flex-1` on a textarea needs flex-column ancestors. Fix §B3.
- G8: validation order must follow DOM order (name, then email). Fix §A1.6.
- G9.1: mutating the `role="alert"` summary on every keystroke re-announces it. Fix: the summary is frozen until the next submit;
  only the field's own inline state clears on input (§A1.7).
- G11: outer wrapper needs `w-full`; keep `<header>` as the outer element. Fix §B0.
- O2: `height >= 30rem` is 480px, so 1280×600 is `roomy`, and my verification line said the opposite. Fixed; expected-layout
  table added (§B1).
- G3 + O8: no manifest/ledger/done-checks/recovery rules. Added (§Cold start). Baseline SHA ambiguity resolved above.
- G3.3 + O9: stacked-PR commands and post-merge integration missing. Added (§Delivery shape). The repo merges with merge commits
  (`git log --merges`: #31, #30, #28 are "Merge pull request" commits), so retargeting B to `main` after A merges is clean.
- O10: runtime checks need a database; the plan said "no .env". Split into offline and runtime verification with the env rule (§Verification).
- O12: repo citations as pinned permalinks. C22–C28, C30, C34 now link to `blob/9ffdb8e`.
- Orchestrator #10 (George 10 refined): the shared `textOnly` fixture (`__tests__/lib/validations-memory.test.ts:6`) and the
  `:57` fixture have no name or email and are parsed by about eight tests. Both now gain `name`/`email` (§A1.9).
- Orchestrator #26: wrong filename, outside the repo, never committed. S1 commits the repo copy as
  `docs/plans/2026-11-04-share-form-quick-fixes.md` first on PR A's branch.
- Orchestrator #27: Rob's seven items were never listed. Now verbatim with a traceability table (§Context); screenshots saved at S7.
- Orchestrator #28: draft Sentry PR #33 touches `share-form.tsx`, `create-submission.ts`, `submission-pipeline.ts`, `claim-form.tsx`,
  `create-submission.test.ts`, `submission-pipeline.test.ts`; #34 touches `globals.css`, `AGENTS.md`, `docs/code-layout.md`. Its
  hunks are additive (imports, `identifyContributor`, spans) next to our edit sites. Merge-order statement and symbol anchors added
  (§Delivery shape, §Anchors), plus step S0b that re-checks every anchor against the live `origin/main`.
- Orchestrator #29: the header split changes every page. PR B evidence now screenshots `/`, `/obituary`, a claim page and `/admin`
  at 1280 and 2560 (§Verification).
- Orchestrator asks 2, 4, 6, 7, 8, 9: items table, pre-filled rulings log with no remaining "if", second worktree for PR B, runtime
  environment per `docs/environment.md`, inspect-before-create recovery rule, stop points and definition of done. All added.
- Orchestrator #24: focus target ruling recorded (ruling 5 in the log): first invalid field, not the summary, matching the approved
  D-ruling [C24]; owner and gating stated in §Verification part 3.
- Orchestrator #23 (second half): the devtools bypass is replaced by a unit test of the pure mapper `issuesFromSendFailure` (§A1.6, §A1.9).

**Bucket 2 — Nice to do (also folded in)**
- G12: the 25% ring is ~1.6:1; the 2px `jo-red-deep` border carries the 3:1 state indicator [C33]; ring raised to 40% and measured.
- G13.1: `@custom-variant roomy` must sit with `wide`/`narrow` after `@import "tailwindcss"` (`globals.css:1,9`). Stated in §B1.
- G13.2: C19 (SC 1.4.8) is Level AAA guidance; noted in its Justification.
- G10: fixture inventory done. Only `__tests__/lib/validations-memory.test.ts`, `__tests__/features/create-submission.test.ts` and
  `__tests__/lib/submission-pipeline.test.ts` build submission inputs. The `email: null` fixtures in `notify-admins`,
  `complete-submission`, `confirm` and `api/reconcile` tests are stored Prisma rows (column stays nullable) and are unaffected.
  `admin-template.test.ts:99` uses PRIVATE on the admin template, unaffected. Recorded in §A1.9.
- O11: a device/assistive-technology checklist with owner and gating stated (§Verification, part 3).

**Bucket 3 — Don't do (and why, so later review rounds do not re-raise them)**
- O7 "B4 changes the phone layout": the "+ Add another memory" wrapper is already `narrow:hidden` (`share-form.tsx:374`) [C34], so
  phones never see it. Windows 768–1279px wide (`wide` but not `roomy`) do lose the duplicate button while a placeholder exists; that
  is intended and the acceptance criterion is "390 unchanged", not "all widths unchanged".
- G9.2 "make the summary polite": the summary keeps `role="alert"`, which is the approved D-ruling [C24]. The alert mounts in the
  same commit that enables focus; the field announcement follows it. A VoiceOver check is in the device checklist instead.
- G1's `flushSync` alternative: not used; the effect-driven reveal is deterministic and matches React's commit model [C32].
- O3's "define the intended treatment of null": `null` is rejected with the same required message via the error map (`iss.input ===
  undefined || iss.input === null`); no separate null semantics are introduced.
- Orchestrator "bad idea" #11 (`w-full` on the outer div): dropped, a block `div` is already full width. The header keeps `<header>` as
  the outer landmark (that half was real and is in §B0).
- Orchestrator "bad idea" #6 (`field` shadowing): `tsc` would catch a wrong return type, but the exact implementation in §A1.2 costs
  nothing and removes a retry, so it stays as written.

**Bucket 4 — Real, but out of scope for these PRs (candidate issues after merge)**
- F1 (medium): no seeded fixture or token-safe tool for runtime checks on the Neon dev branch; today a tester creates rows through
  the form and the admin page. A `scripts/seed-dev-memory.ts` that prints only a claim URL would make the runtime checks repeatable.
- F2 (low): the global `:focus-visible` walnut outline overlaps the new invalid ring; if the evidence screenshot looks muddy, consider
  an invalid-specific focus style. Verify in S4, decide later.
- F3 (open, existing): the iPhone/Android device pass (F7 / Task 10 in the ledger) remains Rob's and does not gate these drafts.
- F4 (low): `design/DESIGN.md:157` says the focus outline is goldenrod; code uses walnut (`globals.css:105`). Spec/code drift, not
  touched here.

---

## Cold start (read this first after a compaction or handoff)

### Execution manifest

| Item | Value |
|---|---|
| Baseline | `origin/main` `9ffdb8e` (verified identical to `4956b2d` for touched files; see Context). S0b re-checks anchors if `origin/main` has moved |
| Repo for `gh` | derive from `git remote -v` in the worktree → `RobertdWray/jowray_com` |
| Worktree A | `/Users/rob/Documents/active_work/jowray_wt_share_fixes` (branch `fix/share-form-email-placeholders-visibility` → base `main`) |
| Worktree B | `/Users/rob/Documents/active_work/jowray_wt_share_desktop` (branch `feat/share-desktop-layout` → base `fix/share-form-email-placeholders-visibility` until A merges, then `main`) |
| PR numbers | A: #35 (draft, base `main`) B: #36 (draft, base `fix/share-form-email-placeholders-visibility`; S11 retargets to `main`) |
| Plan in repo | `/Users/rob/Documents/active_work/jowray_wt_share_fixes/docs/plans/2026-11-04-share-form-quick-fixes.md` |
| Evidence | `/Users/rob/Documents/active_work/jowray_wt_share_fixes/docs/plans/evidence/2026-11-share-quick-fixes/` (PR B adds to the same folder from worktree B) |
| Review inputs | `/private/tmp/team-review-20261104-124626-jowray_com-plan-tender-map-9ffdb8e/` (George: `george-review.txt`, Oscar: `oscar-final.md`) |
| Open drafts that overlap | Sentry stack #32 → #33 → #34 (`feat/sentry-*`), Rob's gates pending. #33 edits five of our files additively; #34 edits `globals.css` |

### Runtime environment (dev-server checks only)

- Offline checks (`npm run validate`, `npm run test:run`, `npm run build:offline`) need no env at all.
- For `npm run dev`: follow `docs/environment.md` § "How env works here": `vercel env pull /private/tmp/claude-501/<session>/scratchpad/env.dev --environment=development`
  from the worktree, then merge **only the missing keys** into the worktree's own `.env` (gitignored, mode 600); never overwrite
  an existing `.env`, never print values, delete the temp file afterwards. Needed keys: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`
  (Neon dev branch), `BLOB_READ_WRITE_TOKEN`, `UPLOAD_TICKET_SECRET`, `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`,
  `OUTBOUND_ENABLED=false`, `OUTBOUND_ALLOWLIST`, `MEMORIAL_SLUG`, `CONSENT_VERSION`, and `ADMIN_PAGE_SECRET` only for the PRIVATE check.
- Email in dev: with `OUTBOUND_ENABLED=false` mail goes only to addresses in `OUTBOUND_ALLOWLIST`; use an allowlisted address or expect
  the thank-you page's "couldn't email you" line.
- Test memories: create a PUBLIC one through the form (use words only, no files, to keep Blob out of it); for the PRIVATE case set
  that row to PRIVATE on `/admin` (needs `ADMIN_PAGE_SECRET`) or skip and rely on the `contributorVisibilityOptions("PRIVATE")` unit
  test; the README says which was done. Claim links come from the thank-you page and are never written into the plan or README.

### Standing rules

- Inspect before creating: `git worktree list`, `git branch -a --list 'fix/share-form*' 'feat/share-desktop*'`, `gh pr list --state all
  --head <branch>`; reuse what exists, never recreate.
- Never work in `/Users/rob/Documents/active_work/jowray_com` (stale, shared) or `/Users/rob/Documents/active_work/jowray_wt_admin_page` (another PR's worktree).
- No force-push; when `origin/main` moves, `git merge origin/main` into the branch. Never delete or recreate remote branches, PRs,
  Neon branches or Vercel resources. No bare `git stash` (shared stack): make a WIP commit instead.
- No `eslint-disable`, no suppressed errors, no "unsafe" auto-fixes without Rob's all-caps YES. Fix root causes.
- Secrets: never print env values; `.env*` never committed.
- Rob's rulings are final. A deviation discovered while building is written in the Rulings log as "Ruling: what — why — cost if wrong"
  before the code changes.

### Stop points and definition of done

- The agent opens both PRs as **drafts** and stops. Rob runs Team Code Review on each (as on PRs #28–#31), decides merge order against
  the Sentry stack, un-drafts and merges. The agent never un-drafts or merges.
- Needs Rob: the device/assistive-technology pass (part 3), any change to a ruling, merges, filing bucket-4 issues after merge.
- Done for PR A = S0–S8 checked, Task 16 ledger entry written at S7 and updated at S8 with the PR number. Done for PR B = S9–S10, ledger
  updated; S11 runs after Rob merges A.

### Anchors (symbol + snippet; line numbers are from 9ffdb8e and will drift when #33/#34 land)

| Edit site | File | Anchor |
|---|---|---|
| contributor schema | `lib/validations/memory.ts` | `const contributorFields = {` … `email: z` (`:41-54`) |
| issue location | `lib/validations/memory.ts` | `export function submissionIssueLocation(` (`:93`) |
| server error return | `features/memories/create-submission.ts` | `const where = issue ? submissionIssueLocation(issue)` (`:69`) and `email: input.email ?? null` (`:108`) |
| pipeline types | `lib/submission-pipeline.ts` | `export type PipelineCreateResult =` (`:25`), `export interface PipelineInput {` (`:40`), `export type PipelineResult =` (`:71`), `UNREACHABLE_MESSAGE, memoryIndex: null` (`:132`) |
| client check | `lib/memory-cards.ts` | `export interface SendIssue {` (`:135`), `export function validateForSend(` (`:148`) |
| submit handler | `app/share/share-form.tsx` | `async function onSubmit(` (`:177`), `if (!result.ok) {` (`:251`) |
| contributor fields | `app/share/share-form.tsx` | `<h2 id="about-you"` (`:310`) through `narrow:hidden text-small` (`:336`) |
| visibility select | `app/share/share-form.tsx` | `<select name="visibility" defaultValue="PUBLIC"` (`:383`) |
| summary | `app/share/share-form.tsx` | `{issues.length > 0 && (` (`:392`) |
| add-another | `app/share/share-form.tsx` | `+ Add another memory` (`:376`) |
| page column | `app/share/share-form.tsx` | `<section id="form" className="mx-auto flex w-full max-w-[860px]` (`:297`) |
| card fields | `app/share/memory-card-client.tsx` | `<label htmlFor={ids.date}` (`:89`), `placeholder="her classroom · Lake George · Broadmead"` (`:109`), `id={ids.note}` (`:130`) |
| field classes | `app/_components/field-classes.ts` | `export const inputClass =` (`:3`) |
| header | `app/_components/site-header.tsx` | `max-w-[1200px]` (`:6`) |
| variants | `app/globals.css` | `@custom-variant narrow {` (`:10-15`) |
| claim select | `app/m/[claimToken]/claim-form.tsx` | `<select name="visibility" defaultValue={memory.visibility}` (`:133`) |
| thank-you | `app/share/thank-you-client.tsx` | `hasEmail ? "We couldn't email you just now, so this" : "This"` (`:92`) |

### Progress ledger (update after every step; a step is done only when its done-check passes)

| Step | Work | Done-check | Status / evidence |
|---|---|---|---|
| S0 | Inspect (standing rule 1); then `git -C /Users/rob/Documents/active_work/jowray_com fetch origin && git -C /Users/rob/Documents/active_work/jowray_com worktree add /Users/rob/Documents/active_work/jowray_wt_share_fixes -b fix/share-form-email-placeholders-visibility origin/main`; `cd` there; `npm ci` | `git rev-parse --abbrev-ref HEAD` prints the branch; `git merge-base --is-ancestor 9ffdb8e HEAD` exits 0; `ls node_modules/.bin/next` | [x] 2026-11-04 13:16: worktree at `9ffdb8e`, `npm ci` ok, baseline `test:run` 969/969 |
| S0b | Re-check anchors: for each row of §Anchors run `grep -n -F "<anchor>" <file>`; if `git rev-parse origin/main` ≠ `9ffdb8e`, record the new SHA and any moved lines in the Rulings log | every anchor found exactly once | [x] `origin/main` = `9ffdb8e`; every anchor found exactly once |
| S1 | Copy this plan to `docs/plans/2026-11-04-share-form-quick-fixes.md`; commit `docs(plan): share form quick fixes (items 1–7)` | `git log --oneline -1 -- docs/plans/2026-11-04-share-form-quick-fixes.md` shows the commit | [x] `01b17e4` |
| S2 | Write the §A1.9 and §A4 tests first (red) | `npx vitest run __tests__/lib/validations-memory.test.ts __tests__/lib/memory-cards.test.ts __tests__/features/create-submission.test.ts __tests__/lib/submission-pipeline.test.ts __tests__/lib/visibility.test.ts` shows only the new cases failing | [x] 32 new/changed cases red, 64 others green (`02ac7c7` carries the tests) |
| S3 | §A1.1–A1.3 server side (schemas, `submissionIssueLocation`, create-submission, pipeline types) and §A4 server side | S2 tests green; `npm run validate` clean | [x] `02ac7c7`; the five files 96/96; `validate` clean |
| S4 | §A1.4–A1.8 client side (memory-cards, share-form, field-classes, thank-you) | `npm run validate` clean; runtime: at 390 wide, Send on a blank form centres and focuses **Name**; with a name, **Email**; `document.activeElement.id` matches | [x] `b3da075`; `validate` clean; runtime: blank Send → `contributor-name` focused and centred (422 = 422), with a name → `contributor-email`; see evidence README |
| S5 | §A2 + §A3 copy and weight | `grep -rn "Kay Bartholomew\|So we can say thank you\|(optional · so" app/` returns nothing; `grep -n font-normal app/_components/field-classes.ts` hits `inputClass`; DESIGN.md updated | [x] in `b3da075`; grep: the one hit is the obituary's own sentence about Jo's sister (R11); `font-normal` on `inputClass`; DESIGN.md updated |
| S6 | §A4 client side (share-form select, claim-form) | visibility test green; `grep -n PRIVATE app/share/share-form.tsx` returns nothing | [x] in `b3da075`; visibility test green; no `PRIVATE` in share-form.tsx |
| S7 | §A5 docs; evidence folder with README naming each check; copy Rob's two screenshots (§Context) into it | ledger Task 16 present; README lists every §Verification item with a file name or "not run: reason"; both `rob-item*.png` present | [x] ledger Task 16, evidence README with every item, both `rob-item*.png` present |
| S8 | `npm run validate && npm run test:run && npm run build:offline`; `git push -u origin fix/share-form-email-placeholders-visibility`; `gh pr create --draft --base main --title "fix(share): required name+email, placeholders, two visibility options" --body-file <PR notes>`; write the PR number into the manifest and ledger | `gh pr view --json isDraft,baseRefName` → draft, `main` | [x] `validate` clean, `test:run` 1000/1000, `build:offline` exit 0; pushed; draft PR #35, base `main` |
| S9 | `git -C /Users/rob/Documents/active_work/jowray_wt_share_fixes worktree add /Users/rob/Documents/active_work/jowray_wt_share_desktop -b feat/share-desktop-layout fix/share-form-email-placeholders-visibility`; `npm ci` there; §B0–B5 | `npm run validate` clean; expected-layout table (§B1) holds in Chrome; 390 screenshot identical to PR A's | [x] worktree B at `65f5902`; B0–B5 applied; `validate` clean; the §B1 table holds (evidence README § PR B); 390 differs from PR A by a 2px row gap only (R12) |
| S10 | PR B evidence (§Verification "PR B" bullets incl. header pages); `git push -u origin feat/share-desktop-layout`; `gh pr create --draft --base fix/share-form-email-placeholders-visibility --title "feat(share): desktop layout (padding fix, 1040px, side-by-side rows)"`; PR number into manifest and ledger | `gh pr view --json baseRefName` → PR A's branch | [x] evidence `b-*` + README § PR B; `validate` clean, `test:run` 1000/1000, `build:offline` exit 0; pushed; draft PR #36, base = PR A's branch |
| S11 | After Rob merges PR A (merge commit): in worktree B `git fetch origin && git merge origin/main && git push`; `gh pr edit <B> --base main` | `gh pr view <B> --json baseRefName` → `main`; `gh pr diff <B>` shows only §B changes | [ ] |

Merge order against the Sentry stack (#32 → #33 → #34): PR A is independent of it. Whichever lands first, the other merges
`origin/main` and resolves the small additive overlaps in `share-form.tsx` (imports, `identifyContributor` call), `create-submission.ts`
(span wrapper around `createSubmissionInputSchema.safeParse`), `submission-pipeline.ts` (hooks) and the two test files; no force-push
either way. PR B's `globals.css` edit sits beside #34's; same rule.

### Rulings log (execution-time deviations)

| # | Ruling: what | Why | Cost if wrong |
|---|---|---|---|
| R1 (Rob) | Placeholder colour stays `wood`; weight and copy change | already at the 4.53:1 AA floor [C12] | none; reversible by one token |
| R2 (Rob) | Name required as well as email | family and admin alert otherwise get a memory from nobody; DESIGN.md already has the copy [C26] | a few anonymous stories lost; admin can still draft on someone's behalf |
| R3 (Rob) | Labels "Everyone" / "Family" | Rob's wording; D13 amended for contributor forms | less explicit "who is everyone"; one-line change |
| R4 (Rob) | Single column at 1040px, no rail | UX review: rail shows Send before a word is typed | 5K still ~1.3 screens; rail remains possible later |
| R5 (agent) | On a failed Send, focus the first invalid field (DOM order), not the summary | matches the approved D-ruling that summary links move focus [C24]; one jump beats a link hunt for a 70+ reader; GOV.UK's summary-first pattern is the alternative | if wrong, screen-reader users hear the field before the list; swap to summary focus is a one-line change in the effect |
| R6 (agent) | The shared `textOnly` test fixture gains `name`/`email` rather than each test adding them | eight tests parse it; one edit, no behaviour change | none |
| R7 (agent) | PR A is based on `origin/main` `9ffdb8e`, not stacked on the Sentry drafts #32→#34 | the stack forks from main before PR #31 (`6210009`) and already conflicts with main in `__tests__/api/reconcile.test.ts` and `app/api/cron/reconcile-uploads/route.ts`; stacking would import those conflicts and a tree without the admin page | small additive conflicts in `share-form.tsx` (imports, `identifyContributor` after `readContributor`), `create-submission.ts` (after `parsed.data`), `submission-pipeline.ts` and two test files when the second of the two lands; resolved by `git merge`, never force-push |
| R8 (agent) | A server refusal that lands on a field or card is shown in the summary and inline only; the bare `phase.error` line shows only when `issues` is empty | the same sentence twice in two `role="alert"` regions is read twice | if wrong, the unreachable/budget cases are unchanged (they have no field); only the field-named refusal loses its duplicate |
| R9 (agent) | The worktree's `.env` and `.env.local` are copied from the main checkout (both gitignored, mode 600; the worktree had neither) instead of `vercel env pull` | the worktree is not Vercel-linked, and the pull would not carry the Neon `dev`-branch override that lives in `.env.local` (memory note); nothing is overwritten | none; delete the two files with the worktree |
| R10 (agent) | The PRIVATE claim-page check set the test row by `UPDATE "Memory" SET visibility='PRIVATE'` on the Neon `dev` branch, not through `/admin` | entering `/admin` needs the secret in the URL fragment, which would put `ADMIN_PAGE_SECRET` into the session transcript | the admin form's own PRIVATE path is unchanged and covered by its existing tests; the claim page was checked against a real PRIVATE row either way |
| R11 (agent) | S5's grep hit on "Kay Bartholomew" in `app/obituary/page.tsx` stays; typing in a card's words clears that card's inline state too (not only name/email) | the obituary names Jo's sister on purpose; one clearing rule for every field is simpler to explain and matches "a field shows its inline state only while it has an issue and has not been typed in" | none / if wrong, the card line lingers until the next Send as before (one-line change) |
| R12 (agent) | PR B adds no unit test; its done-check is the §B1 table measured in Chrome. At 390 the "How you knew Jo" row sits 2px higher than on PR A (grid row gap 20px replaces the former 22px section gap) | markup and CSS only, nothing a Node test can see; a uniform 20px gap inside the About-you grid is simpler than special-casing one row to keep 22px | none visible; if Rob wants the 22px back it is `gap-y-[22px]` on the grid (then name→email also becomes 22px) |

### Final review (fresh reviewer, whole stack 9ffdb8e..0e20b9c, 2026-11-04)

Verdict "with fixes": one Important, six Minor; suite 1000/1000 and `validate` clean in the reviewer's own run. Re-graded by effect and acted on:

- Fixed (PR A, `110b49c`): a reveal from an earlier Send re-fired on the sending→error transition of a later Send that named no field, pulling focus to a field that was no longer wrong while the only explanation sat above the button off-screen. The effect now carries out each reveal once (`revealed` ref). Verified by a scripted browser scenario, RED (focus jumped to `contributor-name`, alert off-screen) → GREEN (focus stays on Send, alert on screen; same field twice and the invalid-email reveal still work); no DOM test environment exists in this repo (vitest `environment: "node"`).
- Fixed (PR B): `data-field` sat on the words label, so at a short `roomy` window (1280×560) the card's error line was centred out of view below the 515px textarea; it now sits on the words cell, which holds label, textarea and error line. RED (error line bottom 579px in a 560px window) → GREEN.
- Deferred minors (Rob decides): error lines under name/email inherit the wrapper's bold while the card's error line is regular (`font-normal` on `errorClass` would even them); `resize-y` on the textarea is inert at `roomy` because `flex-1` sets `flex-basis: 0` (`roomy:basis-auto` restores the drag); the claim save (`features/memories/claim.ts`) still accepts PRIVATE from a crafted request on a non-PRIVATE memory (affects only the sender's own memory; the form no longer offers it); the About-you grid goes two-up on landscape phones by width (`sm:`), as the old flex-wrap already did; docs nits (fixed here).
- Rulings on the reviewer's "declined to judge" list: `defaultValue={remembered?.email}` hydration timing, the draft not saving the email, the unreachable `MAX_CARDS_NOTICE`, and a lone placeholder in the left column when cards are open/open/closed at `roomy` are pre-existing or cosmetic and stand as they are (candidates for the bucket-4 list); the Sentry merge mechanics and the part-3 device pass are Rob's.

---

## Delivery shape

Two PRs from two worktrees [C30]: **PR A** = items 1–6 (§A) in worktree A; **PR B** = item 7 (§B) in worktree B, stacked on A,
retargeted to `main` after A merges (S11). Commit messages end with the attribution lines from the session reminder.

---

## PR A — items 1 to 6

### A1. Name and email become required — TDD [C22]

#### A1.1 Schemas — `lib/validations/memory.ts`

Export, next to `contributorFields`:

```ts
export const NAME_REQUIRED_MESSAGE = "We'll need a name so the family knows who to thank.";          // DESIGN.md verbatim [C26]
export const EMAIL_REQUIRED_MESSAGE = "Add your email address, please. It's where your private link goes.";
export const EMAIL_INVALID_MESSAGE = "That email address doesn't look quite right. Have a look for a typo.";

const requiredString = (message: string) =>
  z.string({ error: (iss) => (iss.input === undefined || iss.input === null ? message : undefined) }).trim();   // [C31]

export const contributorNameSchema = requiredString(NAME_REQUIRED_MESSAGE).min(1, NAME_REQUIRED_MESSAGE).max(120);
export const contributorEmailSchema = requiredString(EMAIL_REQUIRED_MESSAGE)
  .toLowerCase()
  .min(1, EMAIL_REQUIRED_MESSAGE)
  .max(254, EMAIL_INVALID_MESSAGE)
  .pipe(z.email(EMAIL_INVALID_MESSAGE));                                                                        // [C1]
```

`contributorFields` becomes `name: contributorNameSchema`, `email: contributorEmailSchema`, `relationship: optionalText(120)` (unchanged),
`visibility: z.enum(["PUBLIC", "FAMILY"]).default("PUBLIC")` [C2] (§A4), the three booleans unchanged. The error map returns
`undefined` for any other issue so the `.min`/`.max`/`z.email` messages apply [C31]. `draftMemoryInputSchema` (`:139-160`),
`lib/validations/admin.ts` and `features/memories/claim.ts` are untouched. Prisma `Contributor.email String?` stays nullable (admin
drafts, historical rows); no migration.

#### A1.2 Issue location — `lib/validations/memory.ts:93-102`

Exact implementation (rename the local that shadowed the new field) [C3]:

```ts
export type SubmissionIssueField = "name" | "email" | null;
export function submissionIssueLocation(issue: { path: ReadonlyArray<PropertyKey>; message: string }): {
  memoryIndex: number | null; fileIndex: number | null; field: SubmissionIssueField; message: string;
} {
  const [root, memoryIndex, memoryField, fileIndex] = issue.path;
  if (issue.path.length === 1 && (root === "name" || root === "email")) {
    return { memoryIndex: null, fileIndex: null, field: root, message: issue.message };
  }
  const atMemory = root === "memories" && typeof memoryIndex === "number" ? memoryIndex : null;
  const atFile = atMemory !== null && memoryField === "files" && typeof fileIndex === "number" ? fileIndex : null;
  return { memoryIndex: atMemory, fileIndex: atFile, field: null, message: issue.message };
}
```

#### A1.3 Server and pipeline types

- `features/memories/create-submission.ts:66-71`: the `ok: false` result carries `field: where.field` (and `field: null` on the
  file-outcome returns at `:78+`); `:108` `email: input.email ?? null` → `email: input.email`; `name: input.name` likewise [C3, C28].
- `lib/submission-pipeline.ts`: add `field: SubmissionIssueField` to the `ok: false` branches of `PipelineCreateResult` (`:27`) and
  `PipelineResult` (`:73`); the unreachable result (`:132`) sets `field: null`; `PipelineInput.visibility` (`:44`) becomes
  `ContributorVisibility` from `lib/visibility` (§A4) [C3].

#### A1.4 Client check — `lib/memory-cards.ts`

```ts
export type ContributorIssue = { target: "name" | "email"; message: string };
export type CardIssue = { target: "note"; cardId: string; position: number; message: string };   // today's SendIssue shape
export type SendIssue = ContributorIssue | CardIssue;
export function validateContributor(c: { name: string; email: string }): ContributorIssue[]     // DOM order: name, then email (G8)
```

Implemented with `contributorNameSchema.safeParse(c.name)` and `contributorEmailSchema.safeParse(c.email)` (first issue message
each), so trimming, case and length agree with the server (G4.1/O4) [C13, C14]. `validateForSend` keeps its signature and returns
`CardIssue[]`; existing call sites switch `issue.field` → `issue.target`.

#### A1.5 Field markup — `app/share/share-form.tsx:313-335`

Each of the three contributor fields becomes (name shown; email identical with `type="email"`, `autoComplete="email"`,
`maxLength={254}`, placeholder per §A2; "How you knew Jo" identical but without `required`/error and with the `(optional)` helper)
[C4, C5, C6, C21]:

```tsx
<div className="flex min-w-0 flex-col gap-2 text-label font-bold">                     {/* = labelClass moved to the wrapper (G7.1) */}
  <label htmlFor="contributor-name">Your name</label>
  <input id="contributor-name" name="name" maxLength={120} required className={inputClass} autoComplete="name"
         placeholder="Jane Doe" defaultValue={draft?.contributor.name || remembered?.name} disabled={sending}
         aria-invalid={nameIssue ? "true" : undefined} aria-describedby={nameIssue ? "contributor-name-error" : undefined}
         onInput={() => clearFieldIssue("name")} />
  {nameIssue && <p id="contributor-name-error" className={errorClass}>{nameIssue.message}</p>}
</div>
```

The email label is plain **Email** (Rob's ruling: the "(optional · …)" helper goes). "How you knew Jo" gains
`<span className={helperClass}>(optional)</span>`. The error `<p>` is a sibling of the label so it is not read as part of the
accessible name [C5]. The form keeps `noValidate` (`:299`) [C7]; `required` is for assistive tech [C6].

#### A1.6 Reveal after commit — `app/share/share-form.tsx`

State: `const [reveal, setReveal] = useState<{ id: string; n: number } | null>(null)`. `onSubmit` (`:177-187`) becomes:

```ts
const found: SendIssue[] = [...validateContributor(readContributor(event.currentTarget)), ...validateForSend(state.cards)];
setIssues(found);
if (found.length > 0) { setReveal({ id: idFor(found[0]!), n: Date.now() }); return; }
```

and the server-failure branch (`:251-262`) does `setIssues([issueFrom(result)])` plus `setReveal(...)` when `result.field` or
`result.memoryIndex` names a target. An effect does the DOM work only after React has committed the render that removed `disabled`
and mounted the error paragraph (G1/O1) [C32]:

```ts
useEffect(() => {
  if (!reveal || phase.kind === "sending") return;
  const input = document.getElementById(reveal.id); if (!input) return;
  const block = input.closest("[data-field]") ?? input;                      // the wrapper div / the textarea's label
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;   // [C10]
  input.focus({ preventScroll: true });                                     // [C9]
  block.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });   // [C8]
}, [reveal, phase.kind]);
```

`idFor` maps `name` → `contributor-name`, `email` → `contributor-email`, `note` → `cardIds(cardId).note`. The summary links
(`:398-404`) call `setReveal` instead of bare `.focus()`. Wrapper divs and the textarea's label carry `data-field`.

The server-failure mapping is a pure, tested function in `lib/memory-cards.ts`:
`issuesFromSendFailure(result: { field; memoryIndex; message }, cards): SendIssue[]` returns `[{ target: "email" | "name", message }]`
when `field` is set, `[{ target: "note", cardId, position, message }]` when `memoryIndex` names a card, else `[]` (the bare
`phase.error` line still shows). This replaces the unrepeatable "bypass the client check in devtools" verification.

#### A1.7 Summary and clearing — `app/share/share-form.tsx:392-412`

- `issues` is set only on submit (client or server) and never mutated by typing (G9.1). A second state `cleared: Set<target>` is
  added on `onInput` of a field and removed on the next submit; a field shows `aria-invalid`/inline error only when it has an issue
  **and** is not in `cleared`. The `role="alert"` summary therefore stays stable while the visitor types [C24].
- Summary first line: "We couldn't send this yet:"; items in `issues` order (name, email, cards); keys `target + cardId`.
- Send stays enabled (a disabled button cannot explain itself) [C13].

#### A1.8 Invalid state and thank-you

- `app/_components/field-classes.ts:3` `inputClass` += `aria-[invalid=true]:border-jo-red-deep aria-[invalid=true]:ring-4
  aria-[invalid=true]:ring-jo-red-deep/40` [C4]. The 2px `jo-red-deep` border (≈7:1 on paper) is the state indicator that meets
  SC 1.4.11; the ring is reinforcement (G12) [C33]. Persistent until valid, never a timed flash. The textarea already sets
  `aria-invalid` (`memory-card-client.tsx:137`) and inherits it.
- `app/share/thank-you-client.tsx:21,88-93` and `share-form.tsx:272,281`: drop `hasEmail`; keep "We couldn't email you just now, so
  this page is the only copy…" for the capped case [C25].

#### A1.9 Tests first (S2) [C22]

- `__tests__/lib/validations-memory.test.ts`: for **each** of name and email: omitted, `null`, `""`, `"   "` → the required message;
  email `"kay@"`, `"not-an-address"` → invalid message; `" Jane@Example.COM "` → accepted as `jane@example.com`; 255-char email and
  121-char name → rejected; `submissionIssueLocation` → `field: "email"` / `"name"` with `memoryIndex: null`, and `field: null` for
  a `["memories", 1, "note"]` path; PRIVATE rejected on /share (`:15-18` updated); fixture `:108` updated.
- `__tests__/lib/memory-cards.test.ts`: `validateContributor` returns name before email; trims; valid pair → `[]`;
  `issuesFromSendFailure` maps `field: "email"` → email issue, `memoryIndex: 1` → card 2's note, neither → `[]`.
- Shared fixtures (R6): `textOnly` (`validations-memory.test.ts:6`) becomes `{ name: "Kay", email: "kay@example.com", memories: […] }`
  and the `:57` inline input gains the same two keys; `send()` (`:85`) and `submission-pipeline.test.ts:16` already carry both.
- `__tests__/features/create-submission.test.ts:148`: expects `field: "email"`; add missing-name and missing-email cases with
  `field` set; fixture `:42` already has both.
- `__tests__/lib/submission-pipeline.test.ts`: `field` passes through; unreachable → `field: null`.
- `__tests__/lib/visibility.test.ts` (new): §A4.
- Inventory (G10): no other test builds a submission input; stored-row fixtures with `email: null` stay valid (Prisma column unchanged).

### A2. Placeholder copy (items 2, 3, and the cropping half of 4)

Placeholders vanish on focus and MDN warns long or sentence-like placeholders are mistaken for entered data [C11], so each becomes
one short example and nothing informational lives only in a placeholder:
- `share-form.tsx` name → `"Jane Doe"`; email → `"your@email.com"` (Rob's wording); relationship → `"former student"` with the label
  `How you knew Jo <span className={helperClass}>(optional)</span>` (no other helper; the dropped examples are not re-added).
- `memory-card-client.tsx:97` when → `"Summer 1985"`; `:109` where → `"her classroom"`.
- `design/DESIGN.md:62-66` placeholder mapping updated to match [C27].
- Test fixtures that say "Kay" are data, not UI copy; unchanged.

### A3. Placeholder weight and colour (item 4)

- `app/_components/field-classes.ts:3` `inputClass` += `font-normal` (covers textarea and select through composition) [C15].
  Typed text becomes regular 20px walnut (15:1) and is visibly different from the lighter regular placeholder; DESIGN.md specifies
  700 for labels only [C26].
- `::placeholder` stays `var(--color-wood)` (`app/globals.css:101-103`), no change (ruling 1) [C12, C16]. Record 4.53:1 in the
  evidence README; add "regular weight" to DESIGN.md § 5.4 [C26].

### A4. Visibility: two options, Everyone default (item 5)

- `lib/visibility.ts`: keep `VISIBILITY_OPTIONS` and `Visibility` (admin forms unchanged); add
  `export type ContributorVisibility = "PUBLIC" | "FAMILY"` and
  `export function contributorVisibilityOptions(current?: Visibility): ReadonlyArray<{ value: Visibility; label: string }>` returning
  `{ PUBLIC: "Everyone" }`, `{ FAMILY: "Family" }` (ruling 3, amending D13 [C23]) plus `{ PRIVATE: "Richard, Rob and Tracy only" }`
  only when `current === "PRIVATE"`. Update the header comment with the amendment.
- `app/share/share-form.tsx:383-388`: map over `contributorVisibilityOptions()`; `defaultValue="PUBLIC"` stays [C20]; the cast at
  `:199-202` becomes `ContributorVisibility` (fallback `"PUBLIC"`).
- `lib/validations/memory.ts` (§A1.1) and `lib/submission-pipeline.ts:44` (§A1.3) use the two-value type (G5/O6).
- `app/m/[claimToken]/claim-form.tsx:133-137`: `contributorVisibilityOptions(memory.visibility)` [C23].
- No Prisma change, no email-template change, no migration. Admin keeps all three.
- `__tests__/lib/visibility.test.ts`: two options by default in that order with those labels; three when current is PRIVATE.

### A5. Docs

- `docs/plans/phase1-ledger.md`: "Task 16 — Share form quick fixes (2026-11-04)" with the four rulings, the bucket-3 non-goals, the
  bucket-4 follow-ups and the evidence folder [C23].
- `docs/plans/2026-11-03-share-redesign.md`: one-line amendments under D5/D13 (contributor forms show "Everyone" / "Family" only
  from 2026-11-04, PRIVATE admin-only; name and email required) [C23, C25].

---

## PR B — desktop layout (item 7)

One column, padding bug fixed, column capped at 1040px, height recovered with side-by-side rows (ruling 4). A wider single column
alone saves nothing (height is set by 56–64px controls) and a 1120px+ textarea runs past 80 characters per line [C19].

- **B0 (one line, must).** `share-form.tsx:297`: outer `<div className="px-[max(16px,5%)] py-[56px]">` wrapping the inner
  `<section id="form" className="mx-auto flex w-full max-w-[860px] roomy:max-w-[1040px] flex-col gap-8">`.
  `site-header.tsx:6`: `<header>` stays the outer landmark with `px-[max(16px,5%)]`; the `max-w-[1200px]` and `mx-auto` move to an
  inner `<div className="mx-auto flex w-full max-w-[1200px] …">`. This header change shows on every page (orchestrator #29), so PR B's
  evidence covers them (§Verification).
- **B1.** `app/globals.css`: add `@custom-variant roomy (@media (width >= 80rem) and (height >= 30rem));` directly after the
  `narrow` block (line 15), i.e. after `@import "tailwindcss"` like `wide`/`narrow` (G13.1) [C18]. Not bare `xl:`: it ignores the
  height clause. Expected layouts (O2):

  | Window | `narrow` (phone) | `wide` | `roomy` |
  |---|---|---|---|
  | 390×844 | yes | no | no |
  | 1280×470 | yes (height < 480) | no | no |
  | 1279×900 | no | yes | no |
  | 1280×600 | no | yes | **yes** (height 600 ≥ 480) |
  | 1440×900, 2560×1440 | no | yes | yes |

- **B2.** About you (`share-form.tsx:313-335`): one `grid gap-5 sm:grid-cols-2 roomy:grid-cols-3` holding the three §A1.5 wrappers;
  the "How you knew Jo" wrapper gets `sm:col-span-2 roomy:col-span-1` so it is not orphaned at half width (G7.1) [C18].
- **B3 (biggest saver).** Memory card (`memory-card-client.tsx:88-146`): at `roomy`, a `grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)]
  gap-x-8` whose left cell holds When and Where stacked (`roomy:flex-col` on `:88`) then the media block, and whose right cell is
  `roomy:flex roomy:flex-col` containing the "Your memory of Jo" label as `flex flex-col roomy:flex-1` and the textarea as
  `roomy:flex-1 roomy:min-h-[300px]` (both ancestors are flex columns, G7.2). Line length ≈52ch [C19]. `rows={7}` stays below `roomy`.
- **B4.** Card list (`share-form.tsx:339-378`): `flex flex-col gap-8 roomy:grid roomy:grid-cols-2`; open-card wrappers (`:348`)
  `roomy:col-span-2`; placeholders one column each. The "+ Add another memory" block (`:374`, already `narrow:hidden` [C34]) renders
  only when `state.cards.every((c) => c.open)`; see bucket 3 for the 768–1279 note.
- **B5.** Send section (`share-form.tsx:380-426`): alerts stay directly above a `roomy:flex roomy:items-end roomy:gap-5` row holding
  the visibility label (`roomy:flex-1`) and the Send button. Checkboxes stay stacked.
- Estimated page height for one memory: today ~2,730px (3.0 screens at 1440×900, 1.9 at 2560×1440); after B0–B5 ~1,910–2,000px
  (2.1 and 1.3 screens). Record the measured `scrollHeight` in the README.

---

## Verification

**1. Offline (no `.env`, every step):** `npm run validate`, `npm run test:run`, `npm run build:offline` pass.

**2. Runtime in Chrome (chrome-devtools MCP), env per §Runtime environment, `npm run dev`:** screenshots and the a11y tree go to
the evidence folder; the README names each file.
- 390×844: placeholders fit, regular weight; "Email" has no "(optional …)"; "(optional)" on "How you knew Jo" only.
- Blank form + Send: Name block centred and focused (`document.activeElement.id === "contributor-name"`), red border + ring, message
  under it; summary lists name, email, then Memory 1. Fill name, Send: Email focused. Typing in a field clears its inline state; the
  summary does not change until the next Send. With reduced motion emulated the scroll is instant.
- `kay@` → invalid message. Valid name+email with an empty card → card message as before.
- Server path: covered by the `issuesFromSendFailure` unit test plus `create-submission.test.ts` (`field: "email"`); in the browser,
  confirm once that a network failure (devtools "Offline" during Send) re-enables the inputs and shows the unreachable message above
  the button, which exercises the same `ok: false` branch.
- "Who can see this?" shows Everyone, Family; Everyone selected. Create one memory through the form (PUBLIC); open its claim link
  (from the thank-you page; never paste tokens into the plan or README): two options. For the PRIVATE case, set the row PRIVATE on the
  admin page (`ADMIN_PAGE_SECRET` lives in `/Users/rob/Documents/active_work/jowray_com/.env`; copy only that key if needed) or skip
  and rely on the `contributorVisibilityOptions("PRIVATE")` unit test; the README says which.
- PR B: `/share` screenshots at 390×844, 1280×470, 1279×900, 1280×600, 1440×900, 2560×1440 matching the §B1 table; `scrollHeight`
  numbers; 390 identical to PR A's screenshot; invalid+focused field appearance checked (F2). Header on every page: `/`, `/obituary`,
  one claim page and `/admin` at 1280×800 and 2560×1440 (the header grows to its full 1200px at wide windows; nothing else moves).
- Contrast: placeholder 4.53:1 and the invalid border/ring measured with the a11y-debugging skill; recorded [C12, C33].

**3. Assistive-technology and device checklist (owner: Rob; does not gate the draft PRs, same as F7 / Task 10):** VoiceOver on
iPhone Safari and on macOS Chrome: Send on a blank form announces the alert then "Your name, required, invalid, We'll need a name…";
typing does not re-announce the summary; typed text survives a failed Send; Android Chrome + TalkBack same pass; reduced-motion on
iOS gives an instant scroll.

---

## Citations

### [C1] — zod `z.email()`

- **Relevant File(s):** `lib/validations/memory.ts`
- **Change Summary:** The share email field is validated with `z.email()` behind a trim/lower-case string and a `min(1)` required check.
- **Source URL:** https://zod.dev/api?id=emails
- **Verbatim Quote:**
  > "To validate email addresses: z.email(); By default, Zod uses a comparatively strict email regex designed to validate normal email addresses containing common characters. It's roughly equivalent to the rules enforced by Gmail."
- **Justification:** Confirms `z.email()` is the zod 4 (installed 4.6.7) API for the format check that the required email pipes into, matching the existing `draftMemoryInputSchema` usage.

### [C2] — zod `z.enum()`

- **Relevant File(s):** `lib/validations/memory.ts`
- **Change Summary:** The share schema's visibility enum shrinks to `["PUBLIC", "FAMILY"]` so the server refuses what the form no longer offers.
- **Source URL:** https://zod.dev/api?id=enums
- **Verbatim Quote:**
  > "Use z.enum to validate inputs against a fixed set of allowable string values."
- **Justification:** The fixed set on `createSubmissionInputSchema` becomes the two contributor-facing values; passing the array literal directly keeps the inferred type exact.

### [C3] — zod issue `path`

- **Relevant File(s):** `lib/validations/memory.ts` (`submissionIssueLocation`), `features/memories/create-submission.ts`, `lib/submission-pipeline.ts`
- **Change Summary:** A top-level issue whose `path` is `["email"]` or `["name"]` is reported to the client as `field`, so the message lands on the field.
- **Source URL:** https://zod.dev/error-formatting
- **Verbatim Quote:**
  > "The formErrors array contains any top-level errors (where path is []). The fieldErrors object provides an array of errors for each field in the schema."
- **Justification:** Zod locates each issue by `path`; reading its first segment (`"email"`, `"name"`, `"memories"`) with a length guard is how `submissionIssueLocation` routes contributor and card issues.

### [C4] — MDN `aria-invalid`

- **Relevant File(s):** `app/share/share-form.tsx`, `app/_components/field-classes.ts`
- **Change Summary:** Name and email inputs get `aria-invalid="true"` only after a failed submit, styled via `aria-[invalid=true]:` utilities, and cleared per field on input.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-invalid
- **Verbatim Quote:**
  > "The attribute should be set with JavaScript as a result of a validation process. Do not set aria-invalid="true" on empty required elements until after the user attempts to submit the form."
- **Justification:** Dictates setting the state only on submit (never on first paint) and driving the visual invalid style from `aria-invalid`, not `:invalid`.

### [C5] — MDN `aria-describedby`

- **Relevant File(s):** `app/share/share-form.tsx`
- **Change Summary:** The error paragraph is a sibling of the label with an id referenced by the input's `aria-describedby`.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-describedby
- **Verbatim Quote:**
  > "The global aria-describedby attribute identifies the element (or elements) that describes the element on which the attribute is set."
- **Justification:** Associates the plain-text error with the input so screen readers announce it after the label, the same wiring the textarea already uses.

### [C6] — MDN `required` attribute

- **Relevant File(s):** `app/share/share-form.tsx`
- **Change Summary:** `required` is added to the name and email inputs alongside a visible cue.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/required
- **Verbatim Quote:**
  > "When including the required attribute, provide a visible indication near the control informing the user that the <input>, <select> or <textarea> is required. Assistive technology should inform the user that the form control is mandatory based on the required attribute, but adding aria-required="true" doesn't hurt, in case the browser / screen reader combination does not support required yet."
- **Justification:** Supports adding `required` for assistive tech and marking the one remaining optional field "(optional)" so the required ones are visibly the unmarked ones.

### [C7] — MDN `novalidate`

- **Relevant File(s):** `app/share/share-form.tsx`
- **Change Summary:** `noValidate` stays on the form so the house error copy and scroll behaviour replace the browser bubble.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/form#novalidate
- **Verbatim Quote:**
  > "This Boolean attribute indicates that the form shouldn't be validated when submitted."
- **Justification:** Confirms `noValidate` suppresses only the browser's built-in submit validation UI; `required` remains meaningful to assistive tech.

### [C8] — MDN `scrollIntoView` options

- **Relevant File(s):** `app/share/share-form.tsx` (reveal effect)
- **Change Summary:** The first invalid block is scrolled with `block: "center"` and `behavior` chosen by the motion preference.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView#block
- **Verbatim Quote:**
  > "center: Aligns the element vertically at the center of the scrollable container, positioning it in the middle of the visible area."
- **Justification:** `block: "center"` keeps label, field and error on screen together instead of parking the input at an edge.

### [C9] — MDN `focus({ preventScroll })`

- **Relevant File(s):** `app/share/share-form.tsx` (reveal effect)
- **Change Summary:** Focus is set with `preventScroll: true` so the explicit centred scroll is the only scroll.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus#preventscroll
- **Verbatim Quote:**
  > "A value of false for preventScroll (the default) means that the browser will scroll the element into view after focusing it. If preventScroll is set to true, no scrolling will occur."
- **Justification:** Without it, `focus()` performs a second "nearest" scroll that undoes the centring.

### [C10] — MDN `prefers-reduced-motion`

- **Relevant File(s):** `app/share/share-form.tsx` (reveal effect)
- **Change Summary:** `behavior: "smooth"` is used only when the visitor has not asked for reduced motion.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
- **Verbatim Quote:**
  > "Indicates that a user has enabled the setting on their device for reduced motion. The reduce keyword value evaluates as true; therefore, @media (prefers-reduced-motion) is equivalent to @media (prefers-reduced-motion: reduce)."
- **Justification:** `matchMedia("(prefers-reduced-motion: reduce)")` is the JavaScript form of this query and selects `"auto"` scrolling for those visitors.

### [C11] — MDN `::placeholder` accessibility

- **Relevant File(s):** `app/share/share-form.tsx`, `app/share/memory-card-client.tsx`, `design/DESIGN.md`
- **Change Summary:** Placeholders are shortened to one example each; nothing informational lives only in a placeholder.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/::placeholder#accessibility
- **Verbatim Quote:**
  > "Placeholder text with sufficient color contrast may be interpreted as entered input. Placeholder text will also disappear when a person enters content into an <input> element. Both of these circumstances can interfere with successful form completion, especially for people with cognitive concerns."
- **Justification:** Explains both complaints (the sentence-like email placeholder reads as a filled value; long examples crop and vanish) and why the fix is shorter examples rather than colour alone.

### [C12] — WCAG 2.2 SC 1.4.3 Contrast (Minimum)

- **Relevant File(s):** `app/globals.css` (`::placeholder` rule), evidence README
- **Change Summary:** The placeholder colour stays at the measured 4.53:1; the measurement is recorded.
- **Source URL:** https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html#intent
- **Verbatim Quote:**
  > "This success criterion applies to text in the page, including placeholder text and text that is shown when a pointer is hovering over an object or when an object has keyboard focus. If any of these are used in a page, the text needs to provide sufficient contrast."
- **Justification:** Placeholder text is in scope for the 4.5:1 minimum; `wood` on white is at the floor, which is why no lightening ships (ruling 1).

### [C13] — WCAG 2.2 SC 3.3.1 Error Identification

- **Relevant File(s):** `lib/memory-cards.ts`, `app/share/share-form.tsx`
- **Change Summary:** A missing name or email, or a malformed email, is identified at the field in text, in the summary, and by focus/scroll.
- **Source URL:** https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html#intent
- **Verbatim Quote:**
  > "The intent of this success criterion is to ensure that users are aware that an error has occurred and can determine what is wrong. In the case of an unsuccessful form submission, it is not sufficient to only re-display the form without providing any hint that the submission failed. The error must be indicated in text."
- **Justification:** A Send with no email (once required) would otherwise fail silently at the top of a long page; the inline text, summary and reveal satisfy this criterion.

### [C14] — WCAG 2.2 SC 3.3.3 Error Suggestion

- **Relevant File(s):** `lib/validations/memory.ts` (messages), `lib/memory-cards.ts`
- **Change Summary:** Messages say what to do ("Add your email address…", "Have a look for a typo"), not just that something is wrong.
- **Source URL:** https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html#intent
- **Verbatim Quote:**
  > "Some examples of information that is not accepted include information that is required but omitted by the user and information that is provided by the user but that falls outside the required data format or allowed values."
- **Justification:** Both cases (omitted, wrong format) get their own corrective suggestion, shared between client and server so the words never differ.

### [C15] — Tailwind Preflight: form controls inherit font

- **Relevant File(s):** `app/_components/field-classes.ts`
- **Change Summary:** `inputClass` gains `font-normal` so inputs stop inheriting the label's `font-bold`.
- **Source URL:** installed `node_modules/tailwindcss/preflight.css` (Tailwind 4.3.3), lines 243–249; page: https://tailwindcss.com/docs/preflight#overview
- **Verbatim Quote:**
  > "button, input, select, optgroup, textarea, ::file-selector-button { font: inherit; /* 1 */"
  > and from the docs page: "For a complete reference of all the styles applied by Preflight, see the stylesheet."
- **Justification:** `font: inherit` is why every field inside a `font-bold` label renders bold; an explicit weight on `inputClass` is the root-cause fix.

### [C16] — Tailwind Preflight lives in the `base` layer

- **Relevant File(s):** `app/globals.css`
- **Change Summary:** The `::placeholder` colour rule stays inside `@layer base`, after Preflight; unchanged in this work.
- **Source URL:** https://tailwindcss.com/docs/preflight#overview
- **Verbatim Quote:**
  > "When you import tailwindcss into your project, Preflight is automatically injected into the base layer:"
- **Justification:** Confirms the existing `@layer base { input::placeholder … }` is the right place for the rule, and that nothing needs to move.

### [C17] — Withdrawn (ruling 1: no colour token). Kept so numbering is stable; no file is changed under this citation.

### [C18] — Tailwind breakpoints and custom variants

- **Relevant File(s):** `app/globals.css` (`roomy` variant), `app/share/share-form.tsx`, `app/share/memory-card-client.tsx`
- **Change Summary:** The desktop interior is gated by a custom `roomy` variant at 80rem plus a height clause instead of bare `xl:`.
- **Source URL:** https://tailwindcss.com/docs/responsive-design#overview
- **Verbatim Quote:**
  > "xl | 80rem (1280px) | @media (width >= 80rem) { ... }" and "Tailwind uses a mobile-first breakpoint system, similar to what you might be used to in other frameworks like Bootstrap."
- **Justification:** 80rem matches Tailwind's `xl`; adding `(height >= 30rem)` through `@custom-variant` (as `wide`/`narrow` already do) keeps D1's phone rule authoritative on short windows.

### [C19] — WCAG 2.2 SC 1.4.8 Visual Presentation (line length)

- **Relevant File(s):** `app/share/memory-card-client.tsx`, `app/share/share-form.tsx`
- **Change Summary:** The textarea is kept to roughly 52–75 characters per line (two-column card interior, or `max-w-[75ch]`).
- **Source URL:** https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html#intent
- **Verbatim Quote:**
  > "Width is no more than 80 characters or glyphs (40 if CJK)."
- **Justification:** SC 1.4.8 is Level AAA and is used here as ergonomic guidance, not a compliance gate (G13.2); a full-width 1040px textarea at 20px would run ~93 characters per line.

### [C20] — React `<select defaultValue>`

- **Relevant File(s):** `app/share/share-form.tsx`
- **Change Summary:** The visibility select stays uncontrolled with `defaultValue="PUBLIC"` over the two-option list.
- **Source URL:** https://react.dev/reference/react-dom/components/select#props
- **Verbatim Quote:**
  > "defaultValue: A string (or an array of strings for multiple={true}). Specifies the initially selected option."
- **Justification:** "Everyone by default" is expressed by `defaultValue`, the React-sanctioned way (not `selected` on an option).

### [C21] — Next.js Client Components and browser APIs

- **Relevant File(s):** `app/share/share-form.tsx`
- **Change Summary:** `matchMedia`, `scrollIntoView` and `focus` run inside the existing `"use client"` form component, never in `page.tsx`.
- **Source URL:** https://nextjs.org/docs/app/getting-started/server-and-client-components#when-to-use-server-and-client-components
- **Verbatim Quote:**
  > "Use Client Components when you need: State and event handlers. … Browser-only APIs. E.g. localStorage, window, navigator.geolocation, etc."
- **Justification:** The reveal effect depends on `window.matchMedia` and DOM scrolling, which belong in the client component that already owns the submit handler.

### [C22] — Repo rule: TDD for critical paths

- **Relevant File(s):** `__tests__/lib/validations-memory.test.ts`, `__tests__/lib/memory-cards.test.ts`, `__tests__/features/create-submission.test.ts`, `__tests__/lib/submission-pipeline.test.ts`, `__tests__/lib/visibility.test.ts`
- **Change Summary:** Tests for the required fields, issue routing and visibility list are written before the code.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/9ffdb8e/AGENTS.md#L63
- **Verbatim Quote:**
  > "- TDD for critical paths (upload tickets, finalize, confirmation, cron)."
- **Justification:** `createSubmission` is the entry to the upload/finalize/confirmation path, so its schema and error routing are covered test-first.

### [C23] — Repo decisions D5 and D13 (visibility)

- **Relevant File(s):** `lib/visibility.ts`, `app/share/share-form.tsx`, `app/m/[claimToken]/claim-form.tsx`, `docs/plans/2026-11-03-share-redesign.md`, `docs/plans/phase1-ledger.md`
- **Change Summary:** Contributor forms show two options ("Everyone", "Family", ruling 3); stored values stay unchanged; the claim page still edits its own memory.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/9ffdb8e/docs/plans/2026-11-03-share-redesign.md#L28-L36
- **Verbatim Quote:**
  > "| D5 | "Who can see this?" | Asked once per send. Each claim page can change its own memory. |"
  > "| D13 | Visibility option labels | Plainer: "Everyone who visits jowray.com" · "The whole family" · "Richard, Rob and Tracy only". Applies to the share and claim forms; the stored values are unchanged [C59, C60]. |"
- **Justification:** The new two-option list amends D13 for the same two forms, keeps the stored enum, and preserves D5 by letting a PRIVATE memory's claim page keep its current value.

### [C24] — Repo decision: error summary links move focus

- **Relevant File(s):** `app/share/share-form.tsx`
- **Change Summary:** Summary keeps `role="alert"` and its links; they now trigger the reveal effect; name and email join the list.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/9ffdb8e/docs/plans/2026-11-03-share-redesign.md#L134
- **Verbatim Quote:**
  > "- The summary lists one link per problem; each link moves focus to the field. Fields get `aria-invalid` and `aria-describedby` [C49, C50]."
- **Justification:** The contributor issues reuse the already-approved summary pattern rather than adding a second mechanism (and why G9.2 is a non-goal).

### [C25] — Repo decision: the "only copy" thank-you line

- **Relevant File(s):** `app/share/thank-you-client.tsx`, `docs/plans/2026-11-03-share-redesign.md`
- **Change Summary:** With email required, only the "couldn't email you just now" variant remains.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/9ffdb8e/docs/plans/2026-11-03-share-redesign.md#L180
- **Verbatim Quote:**
  > "- If nothing was emailed (no address, or capped): "This page is the only copy of these links, so keep it open or save it.""
- **Justification:** The "no address" half of that condition can no longer occur; the capped half keeps the line.

### [C26] — Repo spec: form typography and error copy

- **Relevant File(s):** `app/_components/field-classes.ts`, `lib/validations/memory.ts`, `design/DESIGN.md`
- **Change Summary:** Labels stay 700, inputs become 400, errors stay `jo-red-deep` 17px under the field; the name message is taken verbatim.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/9ffdb8e/design/DESIGN.md#L152-L159
- **Verbatim Quote:**
  > "Labels 19px 700 above the input, helper text 400 `walnut-soft` inline in the label. Inputs: 56px min height, 20px text, 2px `wood` border, 12px radius, white inside, placeholder `wood`. … Errors: `jo-red-deep` text at 17px under the field, kind in tone ("We'll need a name so the family knows who to thank")."
- **Justification:** The spec gives a weight to labels only, so `font-normal` on inputs is consistent with it; the quoted error line is `NAME_REQUIRED_MESSAGE` and sets the tone of the email messages.

### [C27] — Repo spec: placeholder copy mapping

- **Relevant File(s):** `design/DESIGN.md`, `app/share/share-form.tsx`, `app/share/memory-card-client.tsx`
- **Change Summary:** The spec's placeholder examples are updated to the new short strings so code and spec agree.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/9ffdb8e/design/DESIGN.md#L62-L66
- **Verbatim Quote:**
  > "- `relationship` → "How you knew Jo" (placeholder: *former student · church friend · neighbor · family*)
  > - `email` → "Email" (helper: *so we can say thank you*)"
- **Justification:** These are the lines the current placeholders came from; changing the copy without updating them would leave the spec stale.

### [C28] — Repo layering: validation lives in `lib/validations`

- **Relevant File(s):** `features/memories/create-submission.ts`
- **Change Summary:** The required-field rules live in the zod schemas under `lib/validations`; the feature only passes the located issue back.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/9ffdb8e/docs/code-layout.md#L21
- **Verbatim Quote:**
  > "- Route handlers validate input with zod schemas from `lib/validations` and answer `{ success, data }` or `{ error: { code, message } }`."
- **Justification:** Keeps validation in the layer the house rules assign it to; the feature returns `{ ok: false, code, message, field }` in the same spirit.

### [C29] — Withdrawn (ruling 1: no `color-mix()` token). Kept so numbering is stable; no file is changed under this citation.

### [C30] — Repo rule: every change on a branch with a PR

- **Relevant File(s):** all
- **Change Summary:** Two draft PRs from a new worktree off `origin/main`; B stacked on A then retargeted.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/9ffdb8e/AGENTS.md#L60
- **Verbatim Quote:**
  > "- Every change goes on a branch with a PR."
- **Justification:** Governs the delivery shape; the stale main checkout is left untouched.

### [C31] — zod error map for missing input

- **Relevant File(s):** `lib/validations/memory.ts`
- **Change Summary:** `z.string({ error })` returns the required message when the input is `undefined`/`null` and defers otherwise.
- **Source URL:** https://zod.dev/error-customization#error-precedence
- **Verbatim Quote:**
  > "The error param optionally accepts a function. An error customization function is known as an error map in Zod terminology." … "z.string({ error: (iss) => iss.input === undefined ? "Field is required." : "Invalid input." " … "(More specifically, Zod will yield control to the next error map in the precedence chain.) This is useful for selectively customizing certain error messages but not others."
- **Justification:** Without an error map, an omitted field fails `z.string()` with a generic type message and the required-message tests fail (G4.2/O3); returning `undefined` for other issues keeps the `.min`/`.max`/`z.email` messages.

### [C32] — React effects run after commit

- **Relevant File(s):** `app/share/share-form.tsx`
- **Change Summary:** The focus+scroll runs in a `useEffect` keyed on a reveal request, so it sees the committed DOM with `disabled` removed and the error paragraph mounted.
- **Source URL:** https://react.dev/reference/react/useEffect#parameters
- **Verbatim Quote:**
  > "When your component commits, React will run your setup function. After every commit with changed dependencies, React will first run the cleanup function (if you provided it) with the old values, and then run your setup function with the new values." … "If your Effect is caused by an interaction (like a click), React may run your Effect before the browser paints the updated screen."
- **Justification:** Calling `focus()` synchronously in the async handler targets a still-disabled input (G1/O1); the effect runs only after the commit that re-enables it, and for the click-driven case may even run before paint, so the centring is not visibly late.

### [C33] — WCAG 2.2 SC 1.4.11 Non-text Contrast

- **Relevant File(s):** `app/_components/field-classes.ts`, evidence README
- **Change Summary:** The invalid state is identified by the 2px `jo-red-deep` border (≥3:1 against paper); the 40% ring is reinforcement and is measured.
- **Source URL:** https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html#intent
- **Verbatim Quote:**
  > "Also, any visual information necessary to indicate state, such as whether a component is selected or focused must also ensure that the information used to identify the control in that state has a minimum 3:1 contrast ratio."
- **Justification:** G12 showed the 25% ring alone is ~1.6:1; the border carries the state and the ring is raised to 40%, with both recorded.

### [C34] — Repo: "+ Add another memory" is hidden on phones already

- **Relevant File(s):** `app/share/share-form.tsx` (§B4 and bucket 3)
- **Change Summary:** Rendering the button only when every card is open cannot change the phone layout.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/9ffdb8e/app/share/share-form.tsx#L374-L378
- **Verbatim Quote:**
  > "<div className="narrow:hidden">
  >   <SecondaryButton onClick={() => apply({ type: "add" })} disabled={busy || state.cards.length >= MAX_CARDS}>
  >     + Add another memory"
- **Justification:** Settles O7: the wrapper is `narrow:hidden`, so the "390 unchanged" criterion holds and the change is only visible at `wide` widths.

### [C35] — Repo: how to obtain dev env values without overwriting `.env`

- **Relevant File(s):** §Runtime environment (worktree `.env`, gitignored)
- **Change Summary:** Dev-server checks pull Vercel development values to a temp file and merge only missing keys, per the repo's own procedure.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/9ffdb8e/docs/environment.md#L9
- **Verbatim Quote:**
  > "The Neon values come from the Vercel project. To see the current values, run `vercel env pull <tmpfile> --environment=development` and merge in only the keys that are missing. Don't let the tool overwrite `.env`, because other tooling edits that file too."
- **Justification:** Replaces the earlier "copy `.env.local`" shortcut (orchestrator #23) with the documented, non-destructive procedure; the memory note about `vercel` commands overwriting `.env.local` is the reason the temp-file route matters.
