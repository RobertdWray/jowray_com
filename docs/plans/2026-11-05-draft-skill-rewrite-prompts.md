# jowray-draft-memory skill: verbatim-or-light-rewrite choice, prompts for missing details, and a self-verifying `originalNote`

**This file is the authoritative plan** (branch `feat/draft-skill-rewrite-prompts`, worktree `../jowray_wt_draft-skill`, base `origin/main` 73609cf). A pre-approval draft lived at `~/.claude-work/plans/can-you-please-modify-immutable-sedgewick.md`; it is superseded by this copy.

**Status: APPROVED by Rob (2026-11-05)** with three answers recorded in §1 and §10: "Yes, proceed as sorted"; the response-echo deployment gate: "feel free to do what you need to to make this a great skill. we don't need to have backward compatibility"; micro-tests: "All ten". Rob also noted, for clarity, that Jo was his mother. Build in progress; see the ledger (§2).

---

## 0. Cold start (read this first if you are a resumed or new agent)

1. Repo: `/Users/rob/Documents/active_work/jowray_com` (GitHub `RobertdWray/jowray_com`). Read `AGENTS.md` first (layers, Cache Components rule, no `eslint-disable`, no band-aids, every change on a branch with a PR).
2. The main checkout is shared with other agents and may be on another branch. Never edit there. Work in a worktree: `git -C /Users/rob/Documents/active_work/jowray_com worktree add ../jowray_wt_draft-skill -b feat/draft-skill-rewrite-prompts origin/main` after `git fetch origin main`. If `../jowray_wt_draft-skill` already exists, `git -C ../jowray_wt_draft-skill status` and `git log --oneline -3` first; reuse it only if it is on `feat/draft-skill-rewrite-prompts` and its changes match the ledger (§2). Record the base SHA in the ledger.
3. Runtime: CI runs Node 26 with `npm ci`, then `npm run lint`, `npm run type-check`, `npm run test:run`, `npm run build` [C33]. Locally Rob's machine has Node 22; use `nvm use 26` (or accept 22 for iteration and let CI be the gate). The three repo checks are `npm run validate`, `npm run test:run`, `npm run build:offline`, run with no `.env*` present and `DATABASE_URL` unset (`AGENTS.md` "Checks").
4. Before any step with an outside effect (admin POST, Gmail draft, Vercel), run its done-check in §2 first.
5. Preserve the unrelated untracked file `docs/memory-drafter.md` in the main checkout; it is an early draft of the original plan and is not part of this change.
6. Who's who, from the obituary: "Jo leaves behind her husband Richard Wray, her son Robert Wray and his wife, Tracy Gold" [C31]. Jo is the deceased; Richard is her husband ("Dad" in the condolence notes); Rob is her son; Tracy is Rob's wife. The three are the family admins (`lib/visibility.ts` PRIVATE label "Richard, Rob and Tracy only" [C9]).

## 1. Context and decisions (do not re-ask)

The `jowray-draft-memory` skill (`docs/skills/jowray-draft-memory/SKILL.md`, symlinked into `~/.claude/skills/`) turns a condolence email or text into a DRAFT memory on jowray.com. Today it copies the sender's paragraphs **verbatim** [C1] and only *shows* Rob the relationship, date and place it found; it never asks, and it never passes visibility (the API already accepts it, default PUBLIC [C4]).

**Rob decided (2026-11-05)** [C14]:
1. Per memory, Rob chooses a **verbatim copy or a very light rewrite** so the memory reads as the sender speaking about Jo on a shared family site rather than a letter to Rob ("I remember when your mom and dad…"). The rewriting agent has discretion; edits are "as light and as surgical as possible"; Rob edits before anything is saved.
2. When a rewrite is saved, the **verbatim excerpt is kept in the memory's revision history** (`originalNote`).
3. The skill **prompts for roughly when, where, relationship and visibility** (PUBLIC / FAMILY / PRIVATE).

This reverses the 2026-11-03 ruling "verbatim, never rewritten" (plan §1 decision 2 [C11], §10 non-goal [C12], schema comment [C7], feature doc [C13]). Rob confirmed the reversal. The admin page (PR #31) can already edit a draft's words with an ADMIN revision [C27], so the row is not pristine today either.

**Agent's calls, flagged for Rob's veto (what, why, cost if wrong):**
- **The API echoes `originalNoteRecorded`** (§3.1) instead of an out-of-band "is production new enough" check. Why: zod strips unknown keys by default [C29], so an old production build would accept a payload with `originalNote`, drop it silently and answer 200; the skill's preflight only compares the local checkout with `origin/main` [C35]; and the Vercel CLI reports status and age but not the commit a production deployment was built from [C37]. A response field makes every save self-verifying and covers rollbacks for free. Cost if wrong: one boolean on a response the skill already parses.
- **`before: { note: originalNote }`** on the creation revision (§3.1), not a separate key. Why: the admin History renders "before → after per changed key" [C8], so the verbatim → rewritten diff appears with no UI change. Cost if wrong: a one-line change in `draftMemory` and one test.
- **The old plan is not rewritten.** The README's house rule is "The plans are frozen once executed; the feature docs summarise them." [C41]. The 2026-11-03 plan gets a two-line "Amended 2026-11-05 by docs/plans/2026-11-05-…" pointer at §1 decision 2 and §10; the ruling itself and its reasons live in this plan (§1) and in `docs/features/draft-on-behalf.md`. Cost if wrong: a pointer that is easy to expand.

## 2. Progress ledger (update as you go; one row per step with an outside effect)

| Step | Status | Commit / evidence | Done-check |
|---|---|---|---|
| Rob approved the §10 bucket sort | **yes** (2026-11-05, "Yes, proceed as sorted") | chat | recorded in §10 |
| Plan copied to `docs/plans/2026-11-05-draft-skill-rewrite-prompts.md` | **yes** | first commit on the branch | file on the branch |
| Worktree + branch from `origin/main` (base SHA: 73609cf) | **yes** (2026-11-05) | | `git -C ../jowray_wt_draft-skill branch --show-current` = `feat/draft-skill-rewrite-prompts` |
| Tests written RED (§3.1, §9.1) | **yes** (2026-11-05: 5 failed, 77 passed across the four files before any code change) | commit 71959e5 | `npm run test:run` fails on exactly the new cases |
| Code GREEN | **yes** (2026-11-05: `npm run validate` clean; `test:run` 62 files / 1090 tests; `build:offline` exit 0, run with no `.env*`) | commit 71959e5 | the three checks pass with no `.env*` |
| SKILL.md rewritten (§4) | **yes** (158 lines) | commit 71959e5 | `wc -l` under 500; §9.2 micro-tests pass |
| Docs amended (§5) | **yes** | commit 71959e5 | grep for "verbatim" in the five files returns only the amended sentences |
| Original-text retrieval proof (§8 item 3) | **yes** (2026-11-05, local `next dev` :3105 against the Neon `dev` branch `ep-solitary-tree`, admin page entered with a throwaway `ADMIN_PAGE_SECRET` set on the dev process so no real secret entered a tool call) | `docs/plans/evidence/2026-11-05-draft-skill/00-03` | script printed `originalNote: recorded`; revision row `before.note` = letter, `after.note` = rewrite; History page shows the same |
| Skill micro-tests (§9.2), ten scenarios + three re-tests after one tightening round | **yes** (2026-11-05; all pass) | `docs/plans/evidence/2026-11-05-draft-skill/README.md`, `micro-tests/01-13` | every scenario's pass criterion met; re-tests show the tightened cut and question order |
| PR opened, `ci` green, Team Code Review bucketed | PR [#51](https://github.com/RobertdWray/jowray_com/pull/51) opened 2026-11-05; ci and review pending | PR #51 | `gh pr checks 51` |
| Merged; production deployment **Ready** for the merge commit | no | `vercel ls --environment production` age/URL | the newest Production row is younger than the merge |
| Installed skill is the merged text | no | | `diff ~/.claude/skills/jowray-draft-memory/SKILL.md <(git show origin/main:docs/skills/jowray-draft-memory/SKILL.md)` is empty (the symlink makes this automatic once the main checkout is on `origin/main`) |
| `CONSENT_VERSION=2026-11-v2` in Vercel Production and `.env` | **no** (checked 2026-11-05: `grep -c '^CONSENT_VERSION=2026-11-v2' .env` = 0 [C42]) | | the grep = 1 and `vercel env ls` shows it |
| First real run (Joyce's note), rewrite or verbatim chosen at the prompt | no | memoryId only, never the token | script output carries `originalNote: recorded` when a rewrite was saved |

Separate states, never conflated: implemented → tested → merged → deployed → exercised with a real note.

## 3. Design

### 3.1 Code (TDD; write the tests first and watch them fail)

**`lib/validations/memory.ts`** — `draftMemoryInputSchema` gains
`originalNote: z.string().max(10_000).refine((v) => v.trim().length > 0, { message: "The original needs some words" }).optional()` [C2, C3], the same shape as `note` and untrimmed like it [C4]. Comment: the sender's verbatim excerpt when `note` is a light rewrite of it; recorded in the ADMIN revision, never stored on the row. The `note` comment "Verbatim: … never trimmed or rewritten here" [C4] becomes "The words to store (verbatim, or Rob's approved light rewrite); never trimmed here".

**`features/memories/draft-memory.ts`** —
- Revision: `before: input.originalNote === undefined ? {} : { note: input.originalNote }` (a plain object written to the `Json` column, like today's `after` [C5, C6]); `after.note` stays the stored text.
- `DraftMemoryResult` success gains `originalNoteRecorded: boolean` (`input.originalNote !== undefined`).
- Doc comment: "the sender's verbatim words" → "the sender's words, verbatim or a light rewrite Rob approved; the verbatim excerpt is in the revision's `before`" [C6].

**`app/api/admin/memories/route.ts`** — the 200 body becomes `{ memoryId, claimLink, originalNoteRecorded }`; update the doc comment's response shape [C40]. Status codes unchanged.

**`scripts/draft-memory.ts`** — `summarize()` prints a third line `originalNote: recorded` when `data.originalNoteRecorded === true` and `originalNote: NOT recorded` when the field is `false`; prints nothing about it when the field is absent (old server) [C39]. `prepareInput` is unchanged: it forwards every key other than `sourceInput` [C18].

**`prisma/schema.prisma:131`** — comment only, no migration (`//` comments are "not present in the abstract syntax tree" [C19]): `contributorNote // the person's words: as typed on /share, or an admin-drafted excerpt (verbatim, or a light rewrite the sender edits before Share; the verbatim text is in the ADMIN revision)` [C7].

**Tests:**
- `__tests__/features/draft-memory.test.ts`: new case "records the verbatim excerpt as the revision's before and reports originalNoteRecorded when the stored note is a rewrite" (`toMatchObject({ before: { note: original } })` [C10]; `after.note` and row `contributorNote` = rewritten; result `originalNoteRecorded: true`). The existing case keeps `before: {}` [C15] and asserts `originalNoteRecorded: false`.
- `__tests__/api/admin-memories.test.ts`: the 200 body includes `originalNoteRecorded`.
- `__tests__/lib/validations-memory.test.ts` (`describe("draftMemoryInputSchema")`, fixture at line 222 [C16]): accepts `originalNote`; rejects blank and 10 001 characters; absent → `undefined`.
- `__tests__/scripts/draft-memory.test.ts`: `prepareInput` passes `originalNote` and `visibility` through unchanged (line 75 pattern [C17]); `summarize` prints the three forms above.

Unchanged: `features/admin/create-draft.ts` (browser paste form stays verbatim; its helper "Nothing is rewritten" stays true), `app/m/[claimToken]/*` ("A memory of Jo, in your words" holds: the sender edits before Share), `features/admin/get-memory.ts` (see §10 bucket 4 for the 25-revision cap).

### 3.2 Data contract (what each text is, and where it goes)

| Text | Where it comes from | Where it goes |
|---|---|---|
| **Original source message** (whole email, whole text message, whole pasted note) | Gmail `get_thread`, or Rob's paste | Never stored by the site. Gmail: identified by `sourceInput.messageId`; SMS/other: hashed into `sourceRef` by `lib/source-ref.ts`. Dedup key. |
| **Verbatim excerpt** (the sender's paragraphs about Jo, hard-wraps joined, nothing else changed) | Step 2 cut, approved by Rob | `note` when Rob chooses verbatim; `originalNote` when Rob chooses a rewrite |
| **Approved note** (verbatim excerpt, or the rewrite as Rob approved or edited it) | Step 2b answer | `note` → `Memory.contributorNote` and the ADMIN revision's `after.note` |

Synthetic examples (fictional people). Verbatim save:

```json
{
  "contributor": { "name": "Pat Example", "email": "pat@example.org", "relationship": "Neighbor at Broadmead" },
  "note": "Jo always stopped to watch the birds at my feeder.\n\nShe knew every one by name.",
  "place": "Broadmead",
  "visibility": "PUBLIC",
  "sourceInput": { "kind": "gmail", "messageId": "1a1a000000000001" }
}
```

Rewrite save (the verbatim cut travels as `originalNote`; `approxDateText` omitted because Rob chose "leave blank"):

```json
{
  "contributor": { "name": "Pat Example", "email": "pat@example.org", "relationship": "Neighbor at Broadmead" },
  "note": "Jo always stopped to watch the birds at my feeder.\n\nShe knew every one by name.",
  "originalNote": "Dear Rob,\n\nYour mom always stopped to watch the birds at my feeder.\n\nShe knew every one by name. Thinking of you all.",
  "place": "Broadmead",
  "visibility": "FAMILY",
  "sourceInput": { "kind": "gmail", "messageId": "1a1a000000000001" }
}
```

Existing drafts are not backfilled: a memory drafted before this change has `before: {}` and no `originalNote` anywhere; its words were verbatim by the rule then in force.

## 4. The skill (`docs/skills/jowray-draft-memory/SKILL.md`)

Keep the frontmatter (`disable-model-invocation: true`: Rob invokes, Claude never does on its own [C20]) and the structure (Prerequisites, Preflight, Hard rules, Procedure 1–5, What the site does). Write new guidance as standing rules: Claude Code does not re-read the skill on later turns [C21]. Keep the file under 500 lines [C21].

**Prerequisites** — add: "Rewrites need the production site to be at or past the merge of PR #<this> (the script prints `originalNote: recorded`). Until then save verbatim only."

**Hard rules** — replace "**Verbatim.**" [C1] with:
- "**Their words, their choice.** Each memory is saved either as a verbatim copy of the sender's paragraphs about Jo or as a light rewrite that Rob picks and approves, text in hand, before anything is saved. A rewrite is as light and surgical as the note allows (step 2); the verbatim excerpt is always sent as `originalNote` so it sits in the memory's history. Never save text Rob has not seen." [C14]
- "**Only an answered question authorises a save.** A question that was cancelled, timed out, closed with partial selections, or answered in chat with an instruction rather than a choice does not authorise anything. PUBLIC being the API default is not a visibility choice. Re-ask." [C30]
- "**Rob's typed text is either a replacement or an instruction.** Text that reads as the memory itself ("Jo always stopped…") is the approved note. Text that reads as a direction ("use the rewrite but keep 'Dad'") is an instruction: produce a revised proposal and ask again. Newly generated wording always goes back through step 2b." [C30]
- "**Never tell the sender the words are exactly theirs when they were rewritten.** The reply says what was done (step 4)." [C22]
- "**A 409 means nothing from this attempt was saved.** Not the words, not the visibility, not the details. Never describe them as saved, never write a reply that assumes them, never change the source identity to get past the duplicate. Resume from the existing draft (step 3)." [C34]
- "**A rewrite that was sent but not recorded is a defect, not a success.** If the script printed `originalNote: NOT recorded`, or printed no `originalNote:` line after a payload that carried one, production is older than this skill: stop, tell Rob the row holds only the rewrite, and leave the fix to the admin page (edit the words or delete the draft) [C27]."

**Who's who** (new block after Hard rules) — the six-line summary from §0 item 6 [C31], plus: "Resolve every pronoun from *this* message. 'You' in a letter to Rob is Rob; 'you both' may be Rob and Tracy, or Rob and Richard: if the note does not settle it, ask Rob in step 2b before rewriting it. Never substitute names by rule."

**Step 2 "Propose the excerpt"** [C23] → "Propose the text", a recipe stating what the output IS:
1. The verbatim cut in a fenced block, exactly as today (one normalisation: join hard-wrapped lines) [C23].
2. When the verbatim text addresses the family rather than speaking about Jo, a **light rewrite** in a second fenced block, followed by a one-line change list ("your mom → Jo ×2; dropped 'Dear Rob' and the closing line; 'you' → 'Rob'"). What a light rewrite is: the sender's own sentences, order, tense, vocabulary and paragraph breaks, with only the changes needed for the memory to make sense on a shared family website [C14]: addressee references become the person's name as the message establishes it [C31], direct address and condolence framing that is not part of the memory itself is dropped ("Dear Rob", "I'm so sorry", "thinking of you all"), pronouns fixed only where a change requires it. No new facts, no added adjectives, no summarising, no reordering, no smoothing of style; typos left alone unless they obscure meaning. If the verbatim text already reads as a memory about Jo, say so and offer no rewrite. If a pronoun's referent is unclear, leave it unchanged in the rewrite and list it as an open question.
3. Proposed relationship (no street or unit details), proposed "roughly when" and "where" with the phrase in the note they come from, or "not stated".
4. Whether the message has an attachment.

**Step 2b "Ask Rob"** (new): one `AskUserQuestion` call [C24] with two to four questions; every question has two to four options [C36]. If a question tool is not available, ask the same questions in one chat message and wait for choices.
- **Words** (always): "Verbatim copy" and, **only when step 2 showed a rewrite**, "Light rewrite (as shown)". When no rewrite was shown the second option is "Propose a light rewrite" (then step 2 runs again with one). Rob's own text arrives through the free-text row [C30]; apply the replacement-or-instruction rule.
- **Who may see it** (always): "Everyone who visits jowray.com (PUBLIC, default)" / "The whole family (FAMILY)" / "Richard, Rob and Tracy only (PRIVATE)" [C9].
- **Roughly when**: the proposed value when the note states one; always "Leave blank (the sender can fill it in)"; and "Ask the sender in the reply" (adds one line to step 4's body). With nothing stated the question still has those two options.
- **Where**: likewise.
- **Open pronouns** (only when step 2 listed one): one question per unclear referent with the candidates as options.
A second call only if needed: **Relationship** (proposed wording / leave blank) and **Name** when the signature and the From line disagree or no name is known. Skip any question Rob already answered in chat for this memory. If Rob edited the text, show the final text once more in a fenced block and get a plain yes before step 3.

**Step 3 "Save the draft"** — the JSON gains `"visibility"` [C4] and, when the saved text is not the verbatim cut, `"originalNote"` (§3.2). Omit `originalNote` for a verbatim save; omit `relationship`, `approxDateText`, `place` when Rob chose "leave blank" or "ask the sender". Read the script's output: the success lines are `memoryId`, `claimLink` and, for a rewrite, `originalNote: recorded` [C39]. **409 handling**: keep today's Gmail check [C35 ff.], and add the rule above: the existing draft already has words, visibility and details; Rob's new choices were not applied; offer the admin page edit for changes [C27], reissue only per the existing rules, and never alter `sourceInput` to force a second row.

**Step 4 "Draft Rob's reply"** [C22] — body rules gain two conditional lines: when the text was rewritten, say so plainly ("I trimmed your note lightly so it reads as your memory of Jo on the page rather than a letter to me; please change anything that isn't how you'd say it."); when verbatim, keep "in your own words". When Rob chose "Ask the sender in the reply" for when or where, one line asks ("If you remember roughly when this was, there's a spot for it on the page."). The "Change anything… press Share" and clean-exit lines stay.

**Step 5 "Report"** — add: verbatim or rewritten, visibility chosen, whether `originalNote: recorded` was printed, and which details were left for the sender.

**"What the site does with a draft"** — add: a rewritten draft carries the verbatim excerpt in its first ADMIN revision (`before.note`); the admin page History shows the newest 25 revisions [C32], so the creation revision stays visible until a memory has been edited more than 24 times, after which it is still in the database (`MemoryRevision`) but not on the page. The sender's claim page never shows History. A verbatim draft's first revision has an empty `before` [C15].

## 5. Docs

- **New** `docs/plans/2026-11-05-draft-skill-rewrite-prompts.md`: this plan, authoritative from the first commit.
- `docs/plans/2026-11-03-draft-memory-on-behalf.md`: two-line pointers only (frozen plan [C41]) at §1 decision 2 [C11] and §10 first bullet [C12]: "Amended 2026-11-05: verbatim or light rewrite, Rob's choice per memory, verbatim kept in the revision; see docs/plans/2026-11-05-draft-skill-rewrite-prompts.md §1."
- `docs/features/draft-on-behalf.md` (new on `origin/main`): step 2 of "What we built" [C13] gains the verbatim-or-rewrite choice and the prompts; Key decisions table [C13] gets a row for Rob's 2026-11-05 amendment [C14] linking this plan; the mermaid node "Skill proposes a verbatim excerpt" [C13] becomes "Skill proposes the text (verbatim or light rewrite) and asks when, where, relationship, visibility"; Status line names the new PR; "Known gaps" gains the History cap note (§10 bucket 4).
- `docs/admin.md` "Drafts" paragraph [C27]: one sentence that a skill draft may be a light rewrite and that History shows the sender's exact words as the first revision's "before".
- `README.md:130` [C28]: "in the sender's own words" → "in the sender's own words (verbatim, or lightly reworded with their exact words kept in the history)".
- `docs/environment.md`: no change (no new env).

## 6. Rollout and ownership

| Step | Owner |
|---|---|
| Branch, tests, code, skill text, docs; three checks green; PR with §11 and §10 buckets 3 and 4 in the description | agent |
| `/team-code-review`; four-bucket triage; fix buckets 1 and 2 in the same session | agent, Rob confirms buckets |
| Merge after `ci` (ruleset: PR + ci required, no bypass) | Rob |
| Confirm the Production deployment for the merge commit is **Ready** (`vercel ls --environment production`: newest row younger than the merge, status Ready [C37]) | Rob or agent (read-only) |
| Main checkout on `origin/main` so the `~/.claude/skills` symlink serves the merged skill (ledger done-check) | agent |
| `CONSENT_VERSION=2026-11-v2` in Vercel Production and `.env`: **still not set** as of 2026-11-05 [C42]; required before the first real run because Share stamps whatever is in env | Rob |
| First real run (Joyce's note), choosing at the prompt; watch for `originalNote: recorded` | Rob, with the skill |

Order that matters: merge → deployment Ready → installed skill is the merged text → rewritten drafts allowed. The `originalNoteRecorded` echo enforces this at run time; the order is still written here so nobody tries a rewrite against an old deployment on purpose. If production is ever rolled back below this merge, the echo disappears and the hard rule stops rewrites.

## 7. Interruption recovery (for the skill runner)

| Where it stopped | What to do |
|---|---|
| Before the POST | Nothing was written anywhere. Start again from step 1; re-propose; re-ask. |
| POST sent, result unknown (session died) | Run the same payload again. A 200 means the first attempt did not write (sourceRef is unique, the duplicate check runs before any write [C34]); a 409 with `status: DRAFT` means it did: continue with the existing memoryId through step 3's 409 branch (Gmail check first). |
| 200 received, no Gmail draft yet | Step 4 as normal; `list_drafts` first in case one exists. |
| Gmail draft exists | Follow step 4's existing rules (carries this link → show and stop; Rob's own words → `update_draft`). |
| Rewrite sent, `originalNote: recorded` missing | Hard rule: stop and tell Rob; admin page edit or delete; no reply drafted. |

Record in the ledger only `memoryId`s, Gmail `viewUrl`s and outcomes. Never a claim token, never the note text, never a real sender's address.

## 8. Acceptance (what "done" means)

1. Three checks green with no `.env*` and `DATABASE_URL` unset; new tests listed in §3.1 exist and failed first.
2. Synthetic workflow evidence (§9.2) for the listed scenarios, including the final JSON and reply text, saved under `docs/plans/evidence/2026-11-05-draft-skill/` with fictional people only.
3. Original-text retrieval proof: in a local `next dev` against the Neon dev branch, draft a rewrite with the script, open `/admin` for that memory, and screenshot History showing `note: <verbatim> → <rewrite>` on the ADMIN revision.
4. Deployment evidence in the ledger (§2 rows "Merged; production Ready" and "Installed skill").
5. Stop conditions: any `originalNote: NOT recorded`; any 409 treated as success; any rewrite that adds words or reorders sentences in the micro-tests; the plan is wrong (fix the plan first, then the code).

## 9. Verification

### 9.1 Unit (TDD)
The tests in §3.1. Run `npm run test:run` RED before the code, GREEN after.

### 9.2 Skill micro-tests (writing-skills RED/GREEN)
One fresh subagent per scenario, given the new SKILL.md and a **synthetic** note (fictional sender and address), told to run steps 1–3 with a stubbed script result (no Gmail, no network) and to print (a) the questions it would pose with their options, (b) the final JSON, (c) the reply body it would draft. Scenarios:
1. Letter to Rob ("your mom planted…"), Rob picks **verbatim** → JSON has `note` = cut, no `originalNote`; reply says "in your own words".
2. Same note, Rob picks **rewrite** → `originalNote` = cut, `note` = rewrite with no new words or reordering; reply carries the disclosure line.
3. Rob answers Words with **replacement text** → that text is `note`; verbatim cut is `originalNote`.
4. Rob answers Words with an **instruction** ("keep 'Dad'") → a revised proposal and a second question, not a save.
5. Note **already about Jo** → no rewrite offered; Words options are "Verbatim copy" / "Propose a light rewrite".
6. Note with **no date or place** → When/Where offer "Leave blank" and "Ask the sender in the reply"; the reply gains the asking line when chosen.
7. **"you both"** with an unclear referent → open-pronoun question; the rewrite leaves it unchanged until answered.
8. **Cancelled / timed-out** question (stub returns no choice) → no JSON, re-ask.
9. Stubbed **409 DRAFT** with different proposed content → the agent reports nothing saved, does not describe the new choices as applied, offers the admin page, keeps `sourceInput` unchanged.
10. Stubbed **200 without `originalNoteRecorded`** after a rewrite → stop and report, no reply.
Baseline (current SKILL.md) offers no rewrite and never asks visibility, by construction [C1, C23]. Variance across reps is the signal: if five runs of scenario 2 give five different rewrite shapes, tighten the recipe before adding words.

Limit of the micro-tests: a subagent's description of the questions does not prove the real `AskUserQuestion` dialog; the first real run (ledger) is where the actual tool interaction is observed, in the main session.

### 9.3 Manual
The admin History proof (§8 item 3), and `scripts/draft-memory.ts --input` against local `next dev` with both JSON examples from §3.2 (verbatim → no `originalNote:` line; rewrite → `originalNote: recorded`).

## 10. Friend's review, sorted (2026-11-05) — **Rob confirmed the sort and chose all ten micro-tests**

Each point was checked against source before sorting. Verdicts: six of the friend's factual claims hold; one was overstated (AskUserQuestion waits by default; the timeout is opt-in [C30]); one was a direct hit on my plan (the "you both → Jo and Richard" example could change facts).

**Bucket 1 · Must do (folded into §3, §4, §6, §7 above)**
- **Deployment gate.** Claim verified: zod strips unknown keys [C29]; preflight checks only local vs `origin/main` [C35]; Vercel CLI shows no commit [C37]. Done differently from the suggestion: a run-time `originalNoteRecorded` echo (§3.1) plus the written order in §6, because the skill cannot read production's commit and a response field also covers rollbacks. The friend's reverse rule is a consequence of the echo.
- **History promise narrowed.** Claim verified: `REVISION_TAKE = 25`, newest first [C32]. The skill and docs now say "first ADMIN revision, visible in History until more than 24 later edits; always in the database; never on the sender's page" (§4). The code change is bucket 4.
- **Approval independent of the tool.** Timeout is opt-in and auto-submits partial selections [C30]: the standing rule "only an answered question authorises a save; PUBLIC default is not a choice" costs one paragraph (§4 Hard rules). Replacement-vs-instruction rule added; free text is relayed verbatim to Claude [C30].
- **Duplicate semantics.** Verified: the duplicate check returns before any write [C34]. Rule added (§4 Hard rules, step 3): nothing from the attempt was applied; never manufacture a different `sourceRef`; resume through the admin page edit [C27].
- **Pronouns per message, obituary as the source.** Verified [C31]: Richard is Jo's husband, Rob her son, Tracy Rob's wife; my earlier "family admins" inference is replaced; "you both" is ambiguous by design. Who's who rewritten (§4); unclear referents become a step 2b question.
- **Prompt edge cases.** `AskUserQuestion` takes 2–4 options per question and 1–4 questions [C36]: "Light rewrite (as shown)" only when shown, otherwise "Propose a light rewrite"; When/Where always have "Leave blank" and "Ask the sender in the reply" (§4).
- **Verification through payload and reply**, core scenarios 1, 2, 9, 10 of §9.2, plus the admin History proof (§8).
- **Context survival**: authoritative copy in `docs/plans/`, cold start, runtime (Node 26 [C33]), ledger, data contract with two JSON examples, interruption recovery, ownership, acceptance (§0, §2, §3.2, §6, §7, §8). `CONSENT_VERSION` re-checked today, still unset [C42].

**Bucket 2 · Nice to do**
- The full ten-scenario micro-test matrix (§9.2 items 3–8), beyond the four core ones. Worth it if time allows; each is one subagent run with a synthetic note.
- A `Who's who` note in `docs/features/draft-on-behalf.md` pointing at the obituary, so the next skill edit does not re-infer it.

**Bucket 3 · Don't do (and why, for the PR description)**
- **Always include the creation revision or paginate History** as part of this PR: it is an admin-UI change with its own test surface, unrelated to the skill; the narrowed promise (bucket 1) is honest today and the data is never lost. Tracked in bucket 4 instead.
- **Rewriting the frozen 2026-11-03 plan** in place: the README rule is that executed plans are frozen and feature docs summarise them [C41]; pointers only.
- **A Vercel-API or commit-header deployment check** from the skill: more moving parts (token, API shape) than the response echo, and it would not catch a rollback after the check.
- **Making the admin API reject unknown keys (`z.strictObject`)**: it cannot protect against an *older* server, which is the failure in question, and it would break the replay form of the input (`source` + `sourceRef`) that the script already accepts [C18].

**Bucket 4 · Real, out of scope → file as issues after merge (`https://github.com/RobertdWray/jowray_com/issues`); copy into the PR description**
- **Low.** History shows only the newest 25 revisions (`features/admin/get-memory.ts:8,95`) [C32]; a memory edited more than 24 times hides its creation revision, and with it the verbatim original of a rewritten draft, from the page. Fix: always include the oldest revision (second `findMany` with `orderBy createdAt asc, take 1`, merged when not already present) or paginate History; add a test with 26 revisions asserting the first is shown. Pick-up needs: `features/admin/get-memory.ts`, `app/admin/history.tsx`, `__tests__/features/admin-memories.test.ts`.
- **Low.** No admin control to copy a draft's `originalNote` apart from reading it in History (follows from the above; same files).
- **Medium, pre-existing (F11 in the 2026-11-03 plan).** The skill runs from the shared main checkout and can pick up a stale or branch-switched script; the preflight guard is the interim. Fix: a detached tools worktree at `origin/main` that the skill fetches and resets before each run, and move the `~/.claude/skills` symlink there.

## 11. Non-goals (unchanged from the original plan unless listed)
- No AI rewriting **without Rob's per-memory choice and approval**; no rewriting on the admin page's paste form or the public share form.
- No site email to admin-drafted memories; no automatic attachment ingestion; no "save for later" on a draft's page.
- No backfill of `originalNote` for existing drafts.

## 12. Citations

Internal sources are quoted from the repo at the stated path and line (local HEAD `a12aa0c`, or `origin/main` `73609cf` where marked); external quotes were fetched live on 2026-11-05. The accepted primary-source list (Auth.js, Next.js, Sentry, BAML, EmpathIQ) has no bearing on this change: no auth, routing, telemetry or prompt code moves. External sources are the maintainers' own docs for what is touched (Zod 4.6.7, Prisma 7.10.1, Vitest 5.1.0, Claude Code).

### [C1] — Current "Verbatim" hard rule in the skill
- **Relevant File(s):** `docs/skills/jowray-draft-memory/SKILL.md:31`
- **Change Summary:** The hard rule being replaced by "Their words, their choice".
- **Source URL:** repo file (internal), `docs/skills/jowray-draft-memory/SKILL.md` line 31
- **Verbatim Quote:**
  > "- **Verbatim.** The memory text is the sender's own paragraphs about Jo, copied exactly. Never paraphrase, polish or summarise. Rob approves the cut before anything is saved."
- **Justification:** This is the sentence that forbids a rewrite today; the plan edits it rather than adding a contradictory rule elsewhere.

### [C2] — Zod optional fields
- **Relevant File(s):** `lib/validations/memory.ts`
- **Change Summary:** `originalNote` is an optional key so a verbatim save can omit it.
- **Source URL:** https://zod.dev/api?id=optionals
- **Verbatim Quote:**
  > "To make a schema optional (that is, to allow undefined inputs)." … "This returns a ZodOptional instance that wraps the original schema."
- **Justification:** `.optional()` is the documented way to let the key be absent; `draftMemory` then branches on `input.originalNote === undefined`.

### [C3] — Zod refinements
- **Relevant File(s):** `lib/validations/memory.ts`
- **Change Summary:** The non-blank check on `originalNote` mirrors the one on `note`.
- **Source URL:** https://zod.dev/api?id=refinements
- **Verbatim Quote:**
  > "Every Zod schema stores an array of refinements. Refinements are a way to perform custom validation that Zod doesn't provide a native API for." … "Refinement functions should never throw. Instead they should return a falsy value to signal failure."
- **Justification:** "Not only whitespace" has no native string check, so `.refine()` returning a boolean is the documented mechanism, exactly as the existing `note` field does.

### [C4] — Existing draft input schema (`note`, `visibility`, the verbatim comment)
- **Relevant File(s):** `lib/validations/memory.ts:166-172`
- **Change Summary:** `originalNote` copies `note`'s shape; the skill starts passing `visibility`; the "never rewritten" comment is reworded.
- **Source URL:** repo file (internal), `lib/validations/memory.ts` lines 166–172
- **Verbatim Quote:**
  > "// Verbatim: the sender's own paragraphs, never trimmed or rewritten here.
  > note: z.string().max(10_000).refine((value) => value.trim().length > 0, { message: "The note needs some words" }),
  > …
  > visibility: z.enum(["PUBLIC", "FAMILY", "PRIVATE"]).default("PUBLIC"),"
- **Justification:** The exact shape to duplicate for `originalNote` (untrimmed, 10 000 max, non-blank); proves `visibility` already exists with a PUBLIC default, so the visibility prompt is skill-only.

### [C5] — Prisma: writing a Json field
- **Relevant File(s):** `features/memories/draft-memory.ts`
- **Change Summary:** The revision's `before` becomes a plain object instead of `{}`.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-client/special-fields-and-types/working-with-json-fields#writing-to-a-json-field
- **Verbatim Quote:**
  > "Note: JavaScript objects (for example, { extendedPetsData: "none"}) are automatically converted to JSON." … "Prisma's Json fields are untyped by default."
- **Justification:** `MemoryRevision.before` is a `Json` column; a `{ note: string }` object is written the same way today's `after` object is, with no schema or migration change.

### [C6] — Current revision write in `draftMemory`
- **Relevant File(s):** `features/memories/draft-memory.ts` (revision block and doc comment)
- **Change Summary:** The line that changes, and the doc comment that must stop saying "verbatim".
- **Source URL:** repo file (internal), `features/memories/draft-memory.ts`
- **Verbatim Quote:**
  > "// Everything the draft wrote, so the revision history starts from a complete picture." … "await tx.memoryRevision.create({ data: { memoryId: memory.id, changedVia: "ADMIN", before: {}, after } });" and, in the doc comment, "a DRAFT TEXT memory holding the sender's verbatim words"
- **Justification:** `before: {}` is the one expression that becomes conditional on `input.originalNote`; the doc comment is updated so the code does not contradict the new ruling.

### [C7] — Schema comment on `contributorNote`
- **Relevant File(s):** `prisma/schema.prisma:131`
- **Change Summary:** Comment-only edit; no migration.
- **Source URL:** repo file (internal), `prisma/schema.prisma` line 131
- **Verbatim Quote:**
  > "contributorNote String?        // exactly as typed; never rewritten"
- **Justification:** The comment is cited by the old plan's non-goal [C12] as the reason rewriting was forbidden; leaving it would contradict the new behaviour.

### [C8] — Admin History renders before → after per key
- **Relevant File(s):** `app/admin/history.tsx:7` (read only; no change)
- **Change Summary:** Why `before: { note }` needs no UI work.
- **Source URL:** repo file (internal), `app/admin/history.tsx` line 7
- **Verbatim Quote:**
  > "/** Revisions (newest first) as before → after per changed key, then the email log. */"
- **Justification:** Putting the verbatim text under `before.note` and the rewrite under `after.note` makes the existing component show "what the sender wrote → what was saved" with no new code.

### [C9] — Visibility labels
- **Relevant File(s):** `lib/visibility.ts` (read only), `docs/skills/jowray-draft-memory/SKILL.md` (visibility question)
- **Change Summary:** The option labels the skill shows Rob.
- **Source URL:** repo file (internal), `lib/visibility.ts` `VISIBILITY_OPTIONS`
- **Verbatim Quote:**
  > "{ value: "PUBLIC", label: "Everyone who visits jowray.com" },
  > { value: "FAMILY", label: "The whole family" },
  > { value: "PRIVATE", label: "Richard, Rob and Tracy only" },"
- **Justification:** The skill's visibility prompt reuses the site's own wording so Rob chooses the same thing the admin forms offer.

### [C10] — Vitest `toMatchObject`
- **Relevant File(s):** `__tests__/features/draft-memory.test.ts`, `__tests__/lib/validations-memory.test.ts`
- **Change Summary:** The assertion style for the new revision-shape case.
- **Source URL:** https://vitest.dev/api/expect.html#tomatchobject
- **Verbatim Quote:**
  > "toMatchObject asserts if an object matches a subset of the properties of an object."
- **Justification:** The new test checks `before: { note: original }` and `after.note` without re-asserting every other revision key, matching the existing case at line 75.

### [C11] — Old plan §1 decision 2 (the ruling being amended)
- **Relevant File(s):** `docs/plans/2026-11-03-draft-memory-on-behalf.md:38`
- **Change Summary:** Two-line "Amended 2026-11-05" pointer.
- **Source URL:** repo file (internal), plan line 38
- **Verbatim Quote:**
  > "2. The memory text is a verbatim excerpt: only the sender's paragraphs about Jo, copied exactly. Claude proposes the cut, Rob approves before anything is saved. `contributorNote` stays "exactly as typed; never rewritten"."
- **Justification:** The plan's "do not re-ask" table is what downstream agents read; it must point at the amendment.

### [C12] — Old plan §10 non-goal "No AI rewriting"
- **Relevant File(s):** `docs/plans/2026-11-03-draft-memory-on-behalf.md:352`
- **Change Summary:** Pointer added; text kept for history.
- **Source URL:** repo file (internal), plan line 352
- **Verbatim Quote:**
  > "- **No AI rewriting of anyone's words.** The memory text is a verbatim excerpt the sender can edit. `contributorNote` is "exactly as typed; never rewritten" (schema). A polished draft would stop being theirs."
- **Justification:** Reviewers are told "do not re-raise them unless the reason below is wrong"; the pointer says the reason changed and where the new one lives.

### [C13] — New feature doc on `origin/main` still says verbatim
- **Relevant File(s):** `docs/features/draft-on-behalf.md` lines 10, 30, 41 (at `origin/main` `73609cf`)
- **Change Summary:** Amend step 2, the Key decisions table and the mermaid node.
- **Source URL:** repo file (internal), `git show origin/main:docs/features/draft-on-behalf.md`
- **Verbatim Quote:**
  > line 10: "It finds the sender's message, proposes a **verbatim** excerpt of the paragraphs about Jo, and waits for Rob's yes. The one change allowed is joining lines a mail client hard-wrapped."
  > line 30: "| "The memory text is a verbatim excerpt... Claude proposes the cut, Rob approves before anything is saved." (Rob, 2026-11-03) | [plan §1](...) |"
  > line 41: "A[Condolence note arrives<br/>in Rob's Gmail] --> B[Skill proposes a<br/>verbatim excerpt]"
- **Justification:** This file did not exist when the session started; without these edits the feature doc, the plan and the skill would disagree.

### [C14] — Rob's ruling of 2026-11-05 (this session)
- **Relevant File(s):** `docs/skills/jowray-draft-memory/SKILL.md`, `docs/plans/2026-11-05-draft-skill-rewrite-prompts.md` §1, `docs/features/draft-on-behalf.md`
- **Change Summary:** The decision that authorises the reversal and sets the rewrite's limits, the audit trail and the prompt list.
- **Source URL:** this planning session (Rob's answers to the three questions)
- **Verbatim Quote:**
  > "The agent who does the re-writing should have discretion about what light editing is depending on the note and context. then the skill user can edit as needed. For example, it might say, I remember when your mom and dad... There might be a lot of dynamic adjustments here that need to be made on these memories. in general, I'd like the edits to be as light and as surical as possbile to have the memory make sense on a shared family website."
  > "Yes, store originalNote (Recommended)"
  > "Roughly when (approxDateText), Where (place), Relationship, Visibility" … "Love the idea of prompting the skill user if this should be public, private or family. if that doesn't exist, let's add that."
- **Justification:** Quoted into §1 as the ruling's source, following the repo's practice of recording Rob's product calls verbatim with a date.

### [C15] — Existing revision assertion in the draft test
- **Relevant File(s):** `__tests__/features/draft-memory.test.ts:75`
- **Change Summary:** The existing expectation stays; a sibling case covers the rewrite path.
- **Source URL:** repo file (internal), test line 75
- **Verbatim Quote:**
  > "expect(revisions[0]).toMatchObject({ memoryId: memory.id, changedVia: "ADMIN", before: {} });"
- **Justification:** Pins that a verbatim save still writes `before: {}`, so the change is additive.

### [C16] — Validation test fixture to extend
- **Relevant File(s):** `__tests__/lib/validations-memory.test.ts:221-227`
- **Change Summary:** New cases for `originalNote` reuse this `valid` object.
- **Source URL:** repo file (internal), test lines 221–227
- **Verbatim Quote:**
  > "describe("draftMemoryInputSchema", () => {
  >   const valid = {
  >     contributor: { name: "Joyce", email: "Joyce@Example.com", relationship: "Friend from church" },
  >     note: "Jo always had a kind word.",
  >     source: "EMAIL",
  >     sourceRef: "gmail:1a1a2317fba34eec",
  >   };"
- **Justification:** Names the exact describe block and fixture so the new cases land beside the existing `note` cases.

### [C17] — Script test's `prepareInput` block
- **Relevant File(s):** `__tests__/scripts/draft-memory.test.ts:71-77`
- **Change Summary:** One added assertion for key pass-through; new `summarize` cases.
- **Source URL:** repo file (internal), test line 75
- **Verbatim Quote:**
  > "expect(prepareInput({ ...base, sourceInput: { kind: "gmail", messageId: "1A1A2317FBA34EEC" } })).toEqual({ ...base, source: "EMAIL", sourceRef: gmailSourceRef("1a1a2317fba34eec") });"
- **Justification:** The new assertion adds `originalNote` and `visibility` to `base` and expects them unchanged in the result.

### [C18] — `prepareInput` spreads unknown keys through
- **Relevant File(s):** `scripts/draft-memory.ts:176` (read only; no change)
- **Change Summary:** Why the script needs no edit for the two new JSON keys, and why `strictObject` on the API would break the replay form.
- **Source URL:** repo file (internal), `scripts/draft-memory.ts` lines 106–110 and 176
- **Verbatim Quote:**
  > "An input may instead carry `source` and `sourceRef` itself (a replay of an earlier payload)." … "return { ...rest, ...sourceFor(sourceInput as Record<string, unknown>, contributorEmail) };"
- **Justification:** Every key other than `sourceInput` is forwarded to the admin API, so `originalNote` and `visibility` reach `draftMemoryInputSchema` without script changes.

### [C19] — Prisma schema comments are not part of the schema AST
- **Relevant File(s):** `prisma/schema.prisma:131`
- **Change Summary:** Editing a `//` comment needs no migration.
- **Source URL:** https://www.prisma.io/docs/orm/v7/prisma-schema/overview#comments
- **Verbatim Quote:**
  > "// comment : This comment is for the reader's clarity and is not present in the abstract syntax tree (AST) of the schema."
- **Justification:** Confirms the comment change is documentation only and `prisma migrate` sees no difference.

### [C20] — Claude Code skills: `disable-model-invocation`
- **Relevant File(s):** `docs/skills/jowray-draft-memory/SKILL.md` frontmatter (kept)
- **Change Summary:** The frontmatter is left as is; only the body changes.
- **Source URL:** https://code.claude.com/docs/en/skills#control-who-invokes-a-skill
- **Verbatim Quote:**
  > "| disable-model-invocation: true | Yes | Not on its own | Description not in context, full skill loads when invoked |"
- **Justification:** The skill must stay user-invoked only (it writes to production); the plan changes nothing that would alter that.

### [C21] — Claude Code skills: standing instructions and length
- **Relevant File(s):** `docs/skills/jowray-draft-memory/SKILL.md` (Hard rules, steps 2–4)
- **Change Summary:** Rules are phrased as standing instructions; file stays under 500 lines.
- **Source URL:** https://code.claude.com/docs/en/skills#where-you-write-the-skill%E2%80%99s-name and https://code.claude.com/docs/en/skills#add-supporting-files
- **Verbatim Quote:**
  > "Claude Code does not re-read the skill file on later turns, so write guidance that should apply throughout a task as standing instructions rather than one-time steps." … "Keep SKILL.md under 500 lines. Move detailed reference material to separate files."
- **Justification:** The reply in step 4 happens several turns after step 2; the rules about what the reply may claim and what a 409 means therefore live in Hard rules.

### [C22] — Current reply-body rule in the skill
- **Relevant File(s):** `docs/skills/jowray-draft-memory/SKILL.md:111`
- **Change Summary:** Gains the conditional disclosure and "ask the sender" lines.
- **Source URL:** repo file (internal), SKILL.md line 111
- **Verbatim Quote:**
  > "- `body`: plain text, in Rob's voice. Short, warm, first person. Thank them for the specific memory (name it in a few words, do not quote the note back at length). One line that it is saved to Jo's memorial in their own words."
- **Justification:** "in their own words" becomes false for a rewrite; the line is made conditional so Rob's reply never misstates what was saved.

### [C23] — Current step 2 of the skill
- **Relevant File(s):** `docs/skills/jowray-draft-memory/SKILL.md:57-65`
- **Change Summary:** Rewritten as the "Propose the text" recipe plus step 2b.
- **Source URL:** repo file (internal), SKILL.md lines 59 and 63
- **Verbatim Quote:**
  > "Show Rob, and wait for his yes or edits:" … "The **one** normalisation allowed: join lines that a mail client hard-wrapped inside a paragraph; keep the blank-line paragraph breaks."
- **Justification:** The hard-wrap normalisation is kept for the verbatim block; the free-form "wait for his yes" becomes a structured prompt.

### [C24] — Claude Code `AskUserQuestion`
- **Relevant File(s):** `docs/skills/jowray-draft-memory/SKILL.md` step 2b
- **Change Summary:** The tool the skill names for the structured prompt.
- **Source URL:** https://code.claude.com/docs/en/tools-reference#askuserquestion-tool-behavior
- **Verbatim Quote:**
  > "Claude uses AskUserQuestion to ask you multiple-choice questions when it needs a decision or a clarification. Answer by picking an option, or type your own text through the Other row or the notes field."
- **Justification:** Verbatim-vs-rewrite, visibility, when and where are decisions only Rob can make.

### [C25] — Free-text answers to `AskUserQuestion` (SDK view)
- **Relevant File(s):** `docs/skills/jowray-draft-memory/SKILL.md` step 2b
- **Change Summary:** Why the Words question can accept Rob's own text.
- **Source URL:** https://code.claude.com/docs/en/agent-sdk/user-input#handle-clarifying-questions
- **Verbatim Quote:**
  > "Display an additional "Other" choice after Claude's options that accepts text input" … "Use the user's custom text as the answer value (not the word "Other")"
- **Justification:** Rob's typed text arrives as the answer value, so the skill must decide whether it is a replacement or an instruction (§4).

### [C26] — Old plan §3.7 step 2 "Never paraphrase"
- **Relevant File(s):** `docs/plans/2026-11-03-draft-memory-on-behalf.md:162`
- **Change Summary:** Covered by the §1/§10 pointers; not edited in place (frozen plan).
- **Source URL:** repo file (internal), plan line 162
- **Verbatim Quote:**
  > "2. **Propose the excerpt.** Show Rob: sender name, email, suggested relationship with no street or unit details … the verbatim paragraphs about Jo … Wait for Rob's yes or edits. Never paraphrase."
- **Justification:** Records that the old procedure text is superseded by this plan's §4 without rewriting history.

### [C27] — `docs/admin.md` "Drafts" paragraph
- **Relevant File(s):** `docs/admin.md:38`
- **Change Summary:** One added sentence; also the fallback path for a rewrite whose original was not recorded.
- **Source URL:** repo file (internal), `docs/admin.md` line 38
- **Verbatim Quote:**
  > "A DRAFT is a memory the family saved on someone's behalf (from this page, or from the `jowray-draft-memory` skill). It is invisible and silent until that person opens their link and presses Share, which is their consent; the admin page can edit a draft's words and make a new link (any earlier link stops working), but cannot approve it."
- **Justification:** The admin page's edit-the-words capability is the recovery path for a 409 with new choices and for an unrecorded `originalNote`.

### [C28] — README feature table cell
- **Relevant File(s):** `README.md:130` (at `origin/main`)
- **Change Summary:** Parenthetical added.
- **Source URL:** repo file (internal), `git show origin/main:README.md` line 130
- **Verbatim Quote:**
  > "| ✉️ | [Draft on behalf](docs/features/draft-on-behalf.md) | Turn a condolence email or card into a draft memory in the sender's own words; the site stays silent until the sender presses Share, which is their consent. |"
- **Justification:** The README should not imply every draft is verbatim once the option exists.

### [C29] — Zod strips unrecognized keys by default
- **Relevant File(s):** `features/memories/draft-memory.ts`, `app/api/admin/memories/route.ts`, `scripts/draft-memory.ts` (the `originalNoteRecorded` echo)
- **Change Summary:** Why a payload with `originalNote` against an older production build would succeed and silently drop the original.
- **Source URL:** https://zod.dev/api?id=objects
- **Verbatim Quote:**
  > "By default, unrecognized keys are stripped from the parsed result:"
- **Justification:** The failure the friend described is real; the echo makes the skill detect it from the response instead of guessing the deployment.

### [C30] — `AskUserQuestion` waits by default; opt-in timeout; free text relayed
- **Relevant File(s):** `docs/skills/jowray-draft-memory/SKILL.md` Hard rules ("Only an answered question authorises a save", "replacement or instruction")
- **Change Summary:** Standing rules for unanswered or partial answers and for typed text.
- **Source URL:** https://code.claude.com/docs/en/tools-reference#askuserquestion-tool-behavior
- **Verbatim Quote:**
  > "Questions stay open until you answer them. If you want a question you leave unanswered to eventually close and let Claude continue without you, set the askUserQuestionTimeout setting to 60s, 5m, or 10m" … "After a question sits that long with no input, the dialog closes on its own: it submits any options you'd already selected and tells Claude you may be away from your keyboard, so Claude proceeds on its own judgment" … "When you answer by typing your own text, Claude Code relays the answer with neutral wording so Claude follows what you wrote, including a request to wait or explain first."
- **Justification:** The default is safe; the rule covers the opt-in timeout (partial selections submitted) and tells the skill that typed text may be an instruction to follow rather than the memory's body.

### [C31] — Obituary: the family's relationships
- **Relevant File(s):** `docs/skills/jowray-draft-memory/SKILL.md` "Who's who"; `docs/plans/2026-11-05-…` §0
- **Change Summary:** The names a rewrite may use, from the site's own text rather than an inferred label.
- **Source URL:** repo file (internal), `git show origin/main:app/obituary/page.tsx` line 33
- **Verbatim Quote:**
  > "Jo leaves behind her husband Richard Wray, her son Robert Wray and his wife, Tracy Gold, and"
- **Justification:** Settles Richard (husband), Rob (son) and Tracy (Rob's wife); shows why "you both" in a letter to Rob is ambiguous and must be resolved per message.

### [C32] — Admin History shows the newest 25 revisions
- **Relevant File(s):** `features/admin/get-memory.ts:8,95` (read only); SKILL.md "What the site does"; `docs/features/draft-on-behalf.md` Known gaps
- **Change Summary:** The History promise is narrowed; the cap itself is bucket 4.
- **Source URL:** repo file (internal), `features/admin/get-memory.ts` lines 8 and 95
- **Verbatim Quote:**
  > "const REVISION_TAKE = 25;" … "revisions: { select: { id: true, changedVia: true, before: true, after: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: REVISION_TAKE },"
- **Justification:** The creation revision (holding the verbatim text) leaves the page after 25 later revisions; the docs must say so.

### [C33] — CI runtime and commands
- **Relevant File(s):** `.github/workflows/ci.yml:15-29`
- **Change Summary:** Cold-start runtime section.
- **Source URL:** repo file (internal), `.github/workflows/ci.yml`
- **Verbatim Quote:**
  > "node-version: 26" … "- run: npm ci / - run: npm run lint / - run: npm run type-check / - run: npm run test:run / - run: npm run build"
- **Justification:** The next agent needs the exact gate CI applies; local Node is 22 (`node --version` on 2026-11-05).

### [C34] — Duplicate check returns before any write
- **Relevant File(s):** `features/memories/draft-memory.ts:57-59`; SKILL.md 409 rule; §7 recovery
- **Change Summary:** "A 409 means nothing from this attempt was saved."
- **Source URL:** repo file (internal), `features/memories/draft-memory.ts` lines 57–59
- **Verbatim Quote:**
  > "const existing = await tx.memory.findUnique({ where: { sourceRef: input.sourceRef }, select: { id: true, status: true } });
  > if (existing) {
  >   return { duplicate: { memoryId: existing.id, status: existing.status } };"
- **Justification:** New words, visibility or details sent with a duplicate `sourceRef` are discarded; the skill must not report them as saved.

### [C35] — The skill's preflight compares local files with `origin/main`
- **Relevant File(s):** `docs/skills/jowray-draft-memory/SKILL.md:24`
- **Change Summary:** Why the preflight is not a production check.
- **Source URL:** repo file (internal), SKILL.md line 24
- **Verbatim Quote:**
  > "cd /Users/rob/Documents/active_work/jowray_com && git fetch -q origin main && git diff --quiet origin/main -- scripts/draft-memory.ts lib/source-ref.ts docs/skills/jowray-draft-memory/SKILL.md && echo "script matches origin/main" || echo "STOP: the checkout's script or skill differs from origin/main""
- **Justification:** It establishes that the local script and skill match `origin/main`, not that production serves that commit.

### [C36] — `AskUserQuestion` input limits
- **Relevant File(s):** `docs/skills/jowray-draft-memory/SKILL.md` step 2b
- **Change Summary:** Every question has 2–4 options; a call has 1–4 questions.
- **Source URL:** the tool's JSON schema as served to this session (Claude Code, 2026-11-05)
- **Verbatim Quote:**
  > "options": … "The available choices for this question. Must have 2-4 options." … "questions": "Questions to ask the user (1-4 questions)"
- **Justification:** Forces the "Leave blank" + "Ask the sender" pair when nothing is stated, and the "Propose a light rewrite" option when none was shown.

### [C37] — Vercel CLI reports deployment status and age, not the commit
- **Relevant File(s):** §1 agent's call; §6 rollout
- **Change Summary:** Why the deployment gate is a response echo plus a written order, not a CLI check.
- **Source URL:** `vercel inspect www.jowray.com` and `vercel ls --prod` run read-only on 2026-11-05 (Vercel CLI 65.9.0)
- **Verbatim Quote:**
  > "target	production / status	● Ready / created	Wed Nov 04 2026 19:33:44 GMT-0500" (no commit, branch or meta field in the output) … "! --prod is deprecated. Use --environment production."
- **Justification:** The skill cannot learn production's commit from the CLI; status and age are enough for Rob's manual "Ready after merge" check, and the echo covers the rest.

### [C39] — Script output lines
- **Relevant File(s):** `scripts/draft-memory.ts:180-198` (`summarize`)
- **Change Summary:** A third success line for the echo.
- **Source URL:** repo file (internal), `scripts/draft-memory.ts` lines 182–184
- **Verbatim Quote:**
  > "const { data, error } = body as { data?: { memoryId?: string; claimLink?: string }; … };
  > if (status === 200 && data) {
  >   return [`memoryId: ${data.memoryId ?? "?"}`, `claimLink: ${data.claimLink ?? "?"}`];"
- **Justification:** The type and the returned array gain `originalNoteRecorded`; the absent-field case must print nothing so an old server is distinguishable from `false`.

### [C40] — Admin route response shape
- **Relevant File(s):** `app/api/admin/memories/route.ts:13-16`
- **Change Summary:** 200 body gains `originalNoteRecorded`; doc comment updated.
- **Source URL:** repo file (internal), `app/api/admin/memories/route.ts` lines 13–16
- **Verbatim Quote:**
  > "* Draft a memory on a sender's behalf (the jowray-draft-memory skill, through
  >  * scripts/draft-memory.ts). Bearer `ADMIN_API_SECRET`. Body: draftMemoryInputSchema.
  >  * 200 { memoryId, claimLink } · 400 invalid · 409 duplicate { memoryId, status } · 429 budget_exceeded."
- **Justification:** The comment is the route's contract; it must list the new field.

### [C41] — Plans are frozen once executed
- **Relevant File(s):** `docs/plans/2026-11-03-draft-memory-on-behalf.md` (pointers only); new `docs/plans/2026-11-05-…`
- **Change Summary:** Why the amendment lives in a new plan and the feature doc.
- **Source URL:** repo file (internal), `git show origin/main:README.md` line 252
- **Verbatim Quote:**
  > "The plans are frozen once executed; the feature docs summarise them."
- **Justification:** Rewriting the 2026-11-03 plan in place would break the repo's own convention; pointers keep the record honest.

### [C42] — `CONSENT_VERSION` still not v2 locally
- **Relevant File(s):** §2 ledger, §6 rollout
- **Change Summary:** The real-run prerequisite is re-checked, not inherited from the old ledger.
- **Source URL:** `grep -c '^CONSENT_VERSION=2026-11-v2' .env` run on 2026-11-05 (count only; no values printed)
- **Verbatim Quote:**
  > "0"
- **Justification:** The old plan's ledger row "no" is still true today; the first real run must wait for Rob to set it in Vercel Production and `.env`.
