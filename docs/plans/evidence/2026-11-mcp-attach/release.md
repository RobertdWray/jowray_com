# Release checks (plan §12)

## PR 1, `share_draft` ([#72](https://github.com/RobertdWray/jowray_com/pull/72))

| Check | Result |
|---|---|
| Merge | 2026-11-07 08:44Z, merge commit `59942b2` (head `c8255ff`) |
| `ci` on the PR head | pass; `__tests__/integration/share-draft.test.ts` ran on Postgres (8 tests); 93 / 93 test files |
| Production deploy | Vercel status `success` for `59942b2` |
| `tools/list` against `https://www.jowray.com/api/mcp` (2026-11-07, bearer from the main checkout's `.env`, never printed) | `initialize` 200, `tools/list` 200, **10 tools**: `draft_memory`, `get_memory`, `list_memories`, `reissue_claim_link`, `set_coordinates`, `set_deleted`, `set_status`, `share_draft`, `suggest_places`, `update_memory`; `share_draft` annotations `{ destructiveHint: true, idempotentHint: true }` |
| Migration | none in PR 1 |
| Rob | refresh the connector in claude.ai and set **requires approval** on `share_draft` (seven tools); upload the updated `jowray-draft-memory` skill; see `docs/environment.md`, "MCP connector" |
| Follow-ups filed | [#73](https://github.com/RobertdWray/jowray_com/issues/73) CI deadlock (pre-existing), [#74](https://github.com/RobertdWray/jowray_com/issues/74) F1 public pages, [#75](https://github.com/RobertdWray/jowray_com/issues/75) F5 admin-page buttons; [#71](https://github.com/RobertdWray/jowray_com/issues/71) closed by the merge |
