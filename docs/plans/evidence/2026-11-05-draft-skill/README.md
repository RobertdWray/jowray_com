# Evidence: draft skill, verbatim-or-light-rewrite (2026-11-05)

Plan: `docs/plans/2026-11-05-draft-skill-rewrite-prompts.md` (§8 acceptance, §9 verification). Everyone named here is fictional; no real sender, address or token appears.

## Storage proof (plan §8 item 3)

Runtime: `next dev` on `:3105` from the worktree, env copied from the main checkout (`.env` + the `.env.local` Neon `dev`-branch override, endpoint `ep-solitary-tree`), then removed before the final no-env checks. The admin page was entered with a throwaway `ADMIN_PAGE_SECRET` set on the dev process only, so no real secret entered a tool call.

| File | What it shows |
|---|---|
| `00-payload-rewrite.json` | The JSON the skill would write for a rewrite: `note` = rewrite, `originalNote` = the sender's letter, `visibility: FAMILY`, `sourceInput.kind: other`. |
| `01-script-output.txt` | `scripts/draft-memory.ts` against `ADMIN_API_URL=http://localhost:3105`: `memoryId`, `claimLink` (token redacted) and `originalNote: recorded`. |
| `02-revision-row.json` | The `Memory` row (DRAFT, FAMILY, `contributorNote` = rewrite) and its one ADMIN `MemoryRevision`: `before.note` = the letter, `after.note` = the rewrite. Read with a one-off `@neondatabase/serverless` query that refuses any host other than `ep-solitary-tree`. |
| `03-admin-history-rewrite.jpg` | `/admin/memories/<id>` on the dev server: "Changes" lists `note` as the letter → the rewrite; "Who can see this?" = The whole family; status "Waiting for them to press Share". |

The synthetic row (`49e2f7a2-2e95-47ac-8a16-843de7eacd71`, Pat Example, `pat.example.synthetic@example.org`) stays on the dev branch like the earlier runs' rows; safe to delete.

## Skill micro-tests (plan §9.2)

Ten fresh Explore subagents, each given the new `SKILL.md`, a synthetic note and scripted answers from "Rob"; Gmail, the script and `AskUserQuestion` were stubbed (the agents printed what they would send). Reports in `micro-tests/`. Limit: a subagent's description of the questions does not exercise the real `AskUserQuestion` dialog; the first real run does.

| # | Scenario | Pass? | Notes |
|---|---|---|---|
| 1 | Letter to Rob, Rob picks **verbatim** | pass | JSON had `note` = cut and no `originalNote`; reply said "in your own words"; `originalNote: NOT recorded` read as correct for verbatim. |
| 2 | Same note, Rob picks **rewrite** | pass | `originalNote` = cut, `note` = rewrite with no new words or reordering; reply carried the disclosure line. |
| 3 | Rob answers Words with **replacement text** | pass | Classified as replacement; became `note`; cut kept as `originalNote`. |
| 4 | Rob answers Words with an **instruction** | pass | Classified as instruction; revised proposal and a second question; nothing saved, no reply. |
| 5 | Note **already about Jo** (and a street address in the signature) | pass | No rewrite shown; Words options "Verbatim copy" / "Propose a light rewrite"; address dropped with the signature; street name inside the note flagged. |
| 6 | Text message with **no date or place**, Rob picks "Ask the sender" | pass | When/Where offered "Leave blank" and "Ask the sender in the reply"; reply gained the asking line; full `sms` sourceInput. |
| 7 | **"you both" / "you two"** | pass | "your mom and dad" → "Jo and Richard"; "you two" asked and resolved to "Rob and Tracy"; final text shown for a yes. |
| 8 | **Timed-out** question with a partial selection | pass | No JSON, no reply; "a half-finished dialog is not your choice"; re-asks all four. |
| 9 | **409 DRAFT** with new choices, Gmail draft already carries a link | pass | Reported nothing saved; did not claim PRIVATE or the rewrite applied; refused to alter `sourceInput`; offered the admin page; no new reply. |
| 10 | Rewrite, script prints **no `originalNote:` line** | pass | Stopped, no reply; told Rob the row holds only the rewrite and to fix it on the admin page. |

**Refactor after the first round.** The agents' "unclear" sections (F) converged on the same guesses, so `SKILL.md` was tightened before the PR: whole-sentence cut rules (condolence sentences inside a paragraph drop; the change list is measured against the cut); the Relationship question is asked when the relationship is inferred, "Leave blank" first; question priority Words → Visibility → Pronoun → When → Where → Relationship → Name with overflow into a second call; 12-character headers; a proposable time names a period ("Summer 1998", "every Fourth of July"), a bare season does not; street or unit names inside the cut are flagged because the note is PUBLIC by default; the two reply sentence forms are spelled out; the missing-echo rule is scoped to a 200 after a rewrite and says what happens to the live link. Re-tests 1, 2 and 7 against the tightened text are in `micro-tests/11-13`.
