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

## PR 2, `request_upload` + `finalize_upload` ([#76](https://github.com/RobertdWray/jowray_com/pull/76))

| Check | Result |
|---|---|
| Merge | 2026-11-07 13:23Z, merge commit `4f0a9a2` (head `06b3f3e`) |
| `ci` on the PR head | pass, including the real-Postgres attach-media, budget and share-draft integration suites |
| Production deploy | Vercel status `success` for `4f0a9a2` |
| Migration | `20261107000000_media_admin_upload` finished in production (`_prisma_migrations`) |
| `tools/list` against `https://www.jowray.com/api/mcp` | **12 tools**: the PR 1 list plus `request_upload` and `finalize_upload`; both have annotations `{ destructiveHint: false, idempotentHint: true }` |
| E2E | **13/13** on the schema-only Neon branch: tool count, three READY attachments and VIDEO type, photo GPS and stub place labels, dedupe, cron recovery with hash and one ADMIN revision, unchanged draft/consent and no email, APPROVED attach and terminal alert suppression through cron, `not_ready` refusal and no presign signature in the dev log; [results](pr2-e2e-results.json), [cleanup](pr2-e2e-cleanup.json) (5 blobs deleted, 0 remaining across the three test memories) |
| E2E limits | The claim-page browser upload after `share_draft` was not run here; the results point to PR #72's real-Postgres lifecycle test in CI. Video location belongs to PR 3. |
| Rob | add `vercel.com` to the allowed domains, then run the Cowork `curl -sI` check; refresh the connector (upload-tool approvals at his choice); upload the skill; run the production smoke |
| Follow-ups filed | [#77](https://github.com/RobertdWray/jowray_com/issues/77), [#78](https://github.com/RobertdWray/jowray_com/issues/78), [#79](https://github.com/RobertdWray/jowray_com/issues/79), [#80](https://github.com/RobertdWray/jowray_com/issues/80), [#81](https://github.com/RobertdWray/jowray_com/issues/81) |

## PR 3, video location ([#82](https://github.com/RobertdWray/jowray_com/pull/82))

| Check | Result |
|---|---|
| Merge | 2026-11-07 16:52Z, merge commit `e7601b6` (head `3f3827f`) |
| First `ci` run | `a37cfa1` failed real-Postgres A11 in `attach-media.test.ts`: the storage fake had no `readRange` and still expected the photo-only `gps`. Reproduced on local Postgres 18 (159/160); repair `3f3827f` passed (160/160). |
| `ci` on the PR head | pass on `3f3827f` |
| Production deploy | Vercel status `success` for `e7601b6` |
| Production MCP | `tools/list`: **12 tools**; `suggest_places` is titled "Suggest places from photos and videos"; an unauthenticated POST gets 401 |
| Migration | none in PR 3 |
| E2E | **8/8** on [`f6a773a`](pr3-e2e-video-results-f6a773a.json) and again on [`a37cfa1`](pr3-e2e-video-results-a37cfa1.json): tool count, three READY videos, GPS found/found/none, stub place labels, cron (h) backfill, VIDEO type with DRAFT and no email, rounded Liberty points and no presign signature in the dev log; each run deleted 3 blobs and read back 0 remaining |
| E2E notes | The first attempt on `f6a773a` failed two assertions because the driver read latitude/longitude instead of the readback's rounded `coordinates` object; after the driver fix it passed 8/8, and the failed attempt's 3 blobs were also removed. Cron (h) met three PR 2 video rows whose blobs had been cleaned up: `OriginalMissingError`, `failed`, no stamp, attempt 1 then attempt 2 on the rerun (cap 3, A21). The `a37cfa1` rerun followed the zero-coordinate, first UTF-8 child, range-guard and case-insensitive `Content-Range` repairs. |
| Fixtures | committed synthetic fixtures, by Rob's ruling on 2026-11-07; places provider `stub` |
| Rob | device pass with a real iPhone and Android clip; OK to delete the Neon E2E branch |
| Watch after deploy | cron step (h) backfills existing READY videos, 10 per run, oldest first |
| Follow-ups filed | [#83](https://github.com/RobertdWray/jowray_com/issues/83), [#84](https://github.com/RobertdWray/jowray_com/issues/84), [#85](https://github.com/RobertdWray/jowray_com/issues/85), [#86](https://github.com/RobertdWray/jowray_com/issues/86), [#87](https://github.com/RobertdWray/jowray_com/issues/87) |
