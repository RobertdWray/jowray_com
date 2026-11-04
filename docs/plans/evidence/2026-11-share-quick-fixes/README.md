# Evidence: share form quick fixes (items 1–7, 2026-11-04)

Plan: `docs/plans/2026-11-04-share-form-quick-fixes.md`. PR A = items 1–6 (this folder's `a-*` files); PR B = item 7 (`b-*` files, added from worktree B).

Runtime: `next dev` on port 3077 from the worktree, env copied from the main checkout (`.env` + the `.env.local` Neon `dev`-branch override `br-holy-rice-bbz4t50l`, host `ep-solitary-tree`), `OUTBOUND_ENABLED=false`, Chrome via the chrome-devtools MCP with an isolated context. Values are never written here; the claim link of the test memory is not recorded (the row is the PENDING memory whose words start "Runtime check for the share form quick fixes", safe to delete).

## Rob's inputs

- `rob-item4-cropped-placeholders.png` — item 4: two cropped, bold placeholders.
- `rob-item7-desktop-2000.png` — item 7: the whole page in a 2000px-wide window.

## PR A — offline checks (no `.env` needed)

- `npm run validate` clean, `npm run test:run` 1000/1000 (baseline 969), `npm run build:offline` passes. Output tails are in the PR description.

## PR A — runtime checks (plan § Verification part 2)

| Check | Result | File |
|---|---|---|
| 390×844: placeholders fit, regular weight; "Email" has no "(optional …)"; "(optional)" on "How you knew Jo" only | Labels: "Your name", "Email", "How you knew Jo (optional)". Every input `font-weight: 400` at 20px (was 700 via Preflight `font: inherit`); placeholders "Jane Doe", "your@email.com", "former student", "Summer 1985", "her classroom", "She once…"; `scrollWidth` 293 ≤ `clientWidth` 293 on every field (nothing cropped); `name` and `email` carry `required` | `a-390-blank.png` |
| Blank form + Send | `document.activeElement.id === "contributor-name"`; Name block centre 422px = viewport centre 422px (`scrollIntoView` block center); `aria-invalid="true"` + `aria-describedby="contributor-name-error"` on name and email; inline lines "We'll need a name so the family knows who to thank." / "Add your email address, please. It's where your private link goes."; summary "We couldn't send this yet:" lists name, email, then "Memory 1 needs a recording, a file or a few words." | `a-390-blank-send-name-focused.png` |
| Type in a field, then Send with a name | Typing "Jane Doe" clears the name's `aria-invalid` and inline line; the email keeps its state; the `role="alert"` summary text is unchanged until the next Send. Send → `activeElement === "contributor-email"`, block centre 422 = 422; summary now lists email, then Memory 1 | (script output, this table) |
| `kay@` | Inline and summary: "That email address doesn't look quite right. Have a look for a typo."; email stays focused | (script output) |
| Valid name + email (` Jane@Example.COM `) with an empty card | `activeElement === "c1-note"`, textarea `aria-invalid="true"`, `#c1-error` "Memory 1 needs a recording, a file or a few words."; email's inline state gone | `a-390-empty-card-note-focused.png` |
| Reduced motion | With `prefers-reduced-motion: reduce` emulated, Send from scroll-top centres the block within 60 ms (422 = 422): `behavior: "auto"` | (script output) |
| Server path | Unit: `issuesFromSendFailure` (memory-cards.test), `field: "email"` / `"name"` (create-submission.test), pass-through (submission-pipeline.test). Browser: devtools Offline during Send → "We couldn't get through just now…" above the button, every input re-enabled, the words kept, button back to "Send this to Jo's family" | `a-390-offline-unreachable.png` |
| "Who can see this?" | Options Everyone (selected), Family; nothing else. One PUBLIC words-only memory created through the form | (script output) |
| Thank-you page | "We couldn't email you just now, so this page is the only copy of this link, so keep it open or save it." (example.com is not allowlisted, so not emailed; the `hasEmail` variant is gone) | `a-390-thank-you-not-emailed.png` |
| Claim page of that memory | Two options, Everyone selected; inputs regular weight | (script output) |
| Claim page, memory set PRIVATE | Set by `UPDATE "Memory" SET visibility='PRIVATE'` on the Neon `dev` branch (ruling R10: keeps `ADMIN_PAGE_SECRET` out of the transcript; the admin page's own form is unchanged). Three options, "Richard, Rob and Tracy only" selected | `a-1280-claim-private-three-options.png` |
| Contrast (SC 1.4.3, 1.4.11) | Placeholder `wood` #8a7259 on white **4.53:1** (AA floor; stays, ruling 1). Invalid border `jo-red-deep` #a50d26: 7.82:1 on white, 7.69:1 on paper (the state indicator). Ring at 40% (#db9ea8 blended): 2.22:1 white / 2.18:1 paper, reinforcement only. Computed `box-shadow` on the invalid textarea: `oklab(… / 0.4) 0 0 0 4px` | (script output) |
| F2: focus outline over the invalid ring | The 3px walnut outline (offset 2px) sits outside the 4px ring; the name field in `a-390-blank-send-name-focused.png` is not muddy. No change | `a-390-blank-send-name-focused.png` |
| Accessibility tree | Chrome a11y snapshot of /share at 1280×800 | `a-1280-a11y-tree.txt` |
| Console | No errors or warnings across all of the above (preserved messages over the last navigations: none) | — |
| 1280 baseline for PR B | /share blank at 1280×800 | `a-1280-blank.png` |

### Desktop baseline measured on PR A (for PR B's before/after)

| Window | `scrollHeight` | Screens | `#form` width | "About you" section width |
|---|---|---|---|---|
| 1440×900 | 2837px | 3.15 | 860 | 716 |
| 2560×1440 | 2904px | 2.02 | 860 | 604 |

The About-you width shrinking from 716 to 604 as the window grows is the `px-[max(16px,5%)]`-on-the-capped-box bug named in the plan.

## PR B — desktop layout (item 7), from worktree B

Dev server on port 3078 (worktree B at PR A's head plus B0–B5), same Chrome context. `npm run validate` clean, `npm run test:run` 1000/1000, `npm run build:offline` passes (no new tests: PR B is markup and CSS only; its done-check is the table below, ruling R12).

### Expected-layout table (plan § B1), measured

| Window | `narrow` | `wide` | `roomy` | `#form` width | About-you columns | Card interior | Words textarea | Send row | Placeholders shown | `scrollHeight` (screens) | File |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 390×844 | yes | no | no | 351 | 1 | stacked (flex) | 297×238 | stacked | 0 | 3139 (3.72) | `b-390x844.png` |
| 1280×470 | yes (height < 480) | no | no | 860 | 2 | stacked | 790×238 | stacked | 0 | 2350 (5.0) | `b-1280x470.png` |
| 1279×900 | no | yes | no | 860 | 2 | stacked | 790×238 | stacked | 2 (full width) | 2680 (2.98) | `b-1279x900.png` |
| 1280×600 | no | yes | **yes** | 1040 | 3 | grid 391 + 547 | 547×515 (≈52 ch) | row | 2 abreast (504 each) | 2190 (3.65) | `b-1280x600.png` |
| 1440×900 | no | yes | yes | 1040 | 3 | grid 391 + 547 | 547×515 | row | 2 abreast | 2190 (2.43) | `b-1440x900.png`, `b-1440x900-full.jpeg` |
| 2560×1440 | no | yes | yes | 1040 (About-you 1040, was 604) | 3 | grid 391 + 547 | 547×515 | row | 2 abreast | 2190 (1.52) | `b-2560x1440.jpeg` |

Before (PR A, same pages): 1440×900 → 2837px (3.15 screens); 2560×1440 → 2904px (2.02 screens). After: 2190px at every `roomy` width, 23–25% shorter; the plan's estimate was 1,910–2,000px, the difference being the media block (recorder box + file field) that sets the card row's height.

### Other PR B checks

| Check | Result | File |
|---|---|---|
| 390 identical to PR A | Pixel compare of `a-390-blank.png` and `b-390x844.png` (both 780×1688): the only difference is the "How you knew Jo" row sitting 2px higher (the About-you grid's 20px row gap replaces the former 22px section gap between the email row and that field; name→email stays 20px). Everything above is byte-identical; `narrow` is unchanged (ruling R12) | `b-390x844.png` |
| Three cards open at 1440×900 | Each open card spans both columns (`grid-column: span 2`, width 1040); "+ Add another memory" appears only once every card is open; blank Send → name focused, `aria-invalid`, summary as on PR A; the walnut focus outline sits cleanly outside the red ring (F2, roomy) | `b-1440x900-three-open-blank-send.png`, `b-1440x900-three-open-full.jpeg` |
| Header on every page | `/`, `/obituary`, a claim page, `/admin` (signed-out shell): at 1280×800 the inner box is 1152px with 64px side padding (unchanged); at 2560×1440 it is the full 1200px (was 1200 − 2×128 = 944), centred at x = 680; nothing else moves | `b-header-{home,obituary,claim,admin}-{1280.png,2560.jpeg}` |
| Console | No errors or warnings across the PR B checks | — |

## Team Code Review round 1 (George on gemini-4-argon, Oscar on codex; 2026-11-04)

Findings numbered George #1–#4, Oscar #1 (= George #4). Fixes: PR A `0d441b5`, PR B (this folder's commit). Log: `~/Downloads/team-review-20261104-135752-jowray_com-stack-35-36-09d2b0a.md`.

| Finding | Fix | Verified | File |
|---|---|---|---|
| George #1: a failed client check left a pending "sounds silent" warning and the "Send anyway" label in place | `setConfirmSilent(null)` in the failed-check branch | By reading: the branch now withdraws the warning; a silent clip needs the recorder smoke script to reproduce, so not scripted | — |
| George #2: a card's inline error cleared only when its words were typed | `clearFieldIssue` on add/remove media, a recording, and clear | 390×844: after an empty-card Send, adding `photo.jpg` through the file input clears `aria-invalid` and the error line; the summary is unchanged | (script output) |
| George #3: a 121-character name got zod's default "Too big…" | `NAME_TOO_LONG_MESSAGE` on `.max(120, …)`, test in `validations-memory.test.ts` | RED → GREEN, suite 1004/1004 | — |
| George #4 / Oscar #1: centring the stretched words cell put the label above and the error line below the fold on a short `roomy` window | `lib/reveal-scroll.ts` (pure, tested): the reveal measures label text, field and error line and scrolls by the exact delta; a block taller than the window has its top aligned. PR B: the words block takes the contributor fields' shape (label text, textarea, error line in one growing box) with the textarea capped at `calc(100dvh - 14rem)`, so the error line always sits 8px under the textarea | 1280×480: label top 55, textarea 92–392 (capped to the 300px minimum), error line 400–424, all on screen, weight 400. 1440×900: textarea 482 with the error line, block centred (450 = 450); without an error the textarea is 515 as before, card and grid heights unchanged | `b-1280x480-empty-card-reveal.png`, `b-1440x900-empty-card-reveal.png` |
| 390×844 regression after the scroll change | — | blank Send, with a name, and an empty card each land centred (422 = 422); a failed send with no field named leaves focus on Send with the alert on screen | (script output) |
| Deferred minor (bold error lines) | `font-normal` on `errorClass`, needed once the card's error line moved inside the bold wrapper | computed weight 400 on `#c1-error` | — |

## Part 3 — assistive technology and devices (owner: Rob; does not gate the drafts)

Not run: VoiceOver (iPhone Safari, macOS Chrome), TalkBack, iOS reduced motion. Checklist in the plan § Verification part 3.
