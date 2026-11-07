# Feature name

One or two sentences: what the feature is, who uses it, and where it lives (page, route or tool).

## Before you start (delete this section)

Copy this file to `docs/features/<kebab-name>.md`, replace every placeholder, delete every `>` instruction block, and keep the headings in this order. Aim for one to two pages; [Draft on behalf](./draft-on-behalf.md) and [MCP connector](./mcp.md) are worked examples.

House rules for every feature document:

- **Source of truth.** The code on the branch first, then the plan and its ledger. Where they disagree, write what the code does and list the difference under Known gaps.
- **Links.** PRs as `[PR #60](https://github.com/RobertdWray/jowray_com/pull/60)`, issues as `[issue #38](https://github.com/RobertdWray/jowray_com/issues/38)`, plans by relative path with the section (`[plan §4.5](../plans/2026-11-06-mcp-endpoint.md)`), sibling docs as `./name.md`. Code paths repo-relative in backticks.
- **Secrets.** Never write a secret value, claim token, claim link, upload ticket or connection string. Name the env key (`MCP_API_SECRET`) and link [`docs/environment.md`](../environment.md) for its procedure instead of copying it.
- **Public repo.** No private family details: no sender names, addresses, emails or message text. Use placeholders (`<memoryId>`, `<sender email>`).
- **Dates and attribution.** Absolute dates (2026-11-06). Quote Rob's rulings verbatim with the date; label an agent's call as one and say whether Rob accepted it.
- **Status words stay apart:** implemented, tested, merged, deployed, exercised with real data. Claim only what a PR, ledger row or evidence file records.
- **Index it.** Add a row to [`docs/features/README.md`](./README.md) (emoji, link, what it covers, the delivering PRs) and one sentence to the Features table in the root [`README.md`](../../README.md). Editing a `mermaid` block in the root README also needs `npx tsx scripts/make-readme-diagrams.ts` and the regenerated `public/diagrams/` in the same commit, or `__tests__/lib/readme-diagrams.test.ts` fails.
- **Checks.** Run `npm run validate` and `npm run test:run` even for a docs-only change, with no `.env*` file present.

How to write one:

1. **Decide whether it needs its own document.** One feature, one document. When sibling documents already cover a feature that spans several of them, add a short pointer section to [`docs/features/README.md`](./README.md) instead of a new file. Rob, 2026-11-06: "I don't want documents just to create documents." Photo GPS is the example: [Media uploads](./media-uploads.md#photo-gps) covers reading it from photos, and [Share form](./share-form.md#place-suggestions-from-photos) and [MCP connector](./mcp.md) cover the place lookups.
2. **Gather sources, in this order.**
   - The code at `HEAD`: routes, features, validations, migrations and tests. Where a source disagrees, the code wins.
   - Merge commits: `git log --merges --oneline --grep "#62"` gives a PR's merge SHA, and `git log -1 --format=%cs <sha>` gives its date.
   - The plan and its ledger in `docs/plans/`, and its folder under `docs/plans/evidence/`.
   - The PR description and comments (`gh pr view <N> --comments`), only where no plan exists. They are then the only record of the steps left for Rob, the follow-ups and the check results.
   - Runbooks for operations: `docs/environment.md`, `docs/domain.md`, `docs/admin.md`, `docs/dependencies.md`. Link the section; don't copy its tables.
   - Sibling feature documents, so you link to what they already say instead of repeating it.
3. **Verify every claim before you write it.** Every path in backticks exists, and every function, env key and route you name is found by `git grep`. Each PR number matches its title. Each quote is copied from its source, not paraphrased. Limits, timeouts and counts come from the code, not the plan. To list backticked paths that don't exist (any missing path is a lead to check, not always an error):

   ```sh
   grep -o '`[^` ]*/[^` ]*`' docs/features/<name>.md | tr -d '`' | grep -v -E '^(/|https?:|<)' | sort -u \
     | while read -r p; do git --literal-pathspecs ls-files --error-unmatch "$p" >/dev/null 2>&1 || echo "missing: $p"; done
   ```

4. **Review it before the PR.**
   - [ ] Every `>` block and this section are deleted, and the headings are in order.
   - [ ] Status keeps implemented, tested, merged, deployed and exercised apart, and names what is still Rob's.
   - [ ] Tests and evidence ends with a **NOT RUN** line.
   - [ ] No secret value, token, claim link or private family detail.
   - [ ] Every relative link resolves and every path in backticks exists.
   - [ ] One to two pages; [MCP connector](./mcp.md) is the upper bound.
   - [ ] A reviewer can trace each claim to a file, a plan section or a PR.
   - [ ] It is indexed, as the house rules above say.

**Status:** [PR #N](https://github.com/RobertdWray/jowray_com/pull/N) (what it delivered; merged YYYY-MM-DD, or open). Plan: [`docs/plans/<plan>.md`](../plans/). Then where it stands.

> **Write:** every delivering PR with what it brought and its merge date; whether it is merged, deployed, configured (env keys by name) and used for real; what is still Rob's. **Leave out:** test counts and review rounds (they go in Tests and evidence).

## What we built

1. First thing the user, or the calling system, does or sees.
2. Next step.

> **Write:** a numbered walk-through in the order a user meets the feature, one step per item, naming the page, route, Server Function or feature function in backticks. **Leave out:** the why, and internals that belong in How it works.

## Why we built it

> **Write:** the problem, quoted briefly from the plan or issue with a link, and what the feature unblocks. **Leave out:** the alternatives considered (the plan holds them) and anyone's private details.

## Key decisions (Rob)

| Decision | Source |
|---|---|
| "Rob's ruling, quoted." (Rob, YYYY-MM-DD) | [plan §N](../plans/<plan>.md) |

> **Write:** one row per decision that shaped the build: Rob's rulings verbatim; agent's calls labelled, with whether Rob accepted or still has to rule; declined options worth knowing, with the reason. **Leave out:** implementation details nobody decided.

## How it works

> **Write:** what a maintainer needs to change the feature safely. A Mermaid diagram when a flow has more than three hops; then the contracts (inputs, outputs, error and status codes, as tables), the invariants (locks, constraints, idempotency, ordering), what is logged and what reaches Sentry, and what is never exposed. Use `###` subsections when there are several. **Leave out:** line-by-line code narration and anything the Key files table already says.

## Operations and rollback

> **Write:** setup steps, env keys by name with a link to their row in `docs/environment.md`, how to turn the feature off, rotation, the rollback path and any rollback floor, and the checks to run after a deploy. With nothing to operate, write "None: no secrets, switches or manual steps." **Leave out:** secret values, and procedures that already live in `docs/environment.md` or `docs/admin.md` (link them).

## Key files

| Path | Role |
|---|---|
| **app** | |
| `app/<route>/route.ts` | What it does, in a few words |
| **features** | |
| **lib + server** | |
| **tests** | |
| **Prisma** | `prisma/schema.prisma`, the migration folder, or "none" |

> **Write:** every file a maintainer would open, grouped by layer (app, features, services + integrations, lib + server, scripts and docs, tests, Prisma, packages); drop a group the feature does not use. **Leave out:** files the feature only touches in passing.

## Tests and evidence

> **Write:** the tests that pin the behaviour and what each proves; the recorded results of `npm run validate`, `npm run test:run` (with its count), `npm run build:offline` and CI, with the commit or PR they ran on; manual and end-to-end runs, summarised, with a link to the ledger or `docs/plans/evidence/`; then a **NOT RUN** line listing every planned check with no record. **Leave out:** claims without a record.

## Known gaps and follow-ups

> **Write:** one bullet per open item, with its id (debt-catalog id, plan follow-up number or issue link), severity, and owner when it is Rob's. Include any disagreement between the code and the plan. **Leave out:** items that are done.

## Related

> **Write:** sibling feature docs, the plans and their evidence, the runbooks, `docs/environment.md` with the keys this feature uses, and `docs/code-layout.md`.
