# S0.3 presign spike (2026-11-07)

Plan: [`docs/plans/2026-11-06-mcp-attach-media.md`](../../2026-11-06-mcp-attach-media.md) §6 S0.3, decisions D1 and D3, citations C3 and C6.
Script: [`scripts/e2e/mcp-attach/spike-presign.ts`](../../../../scripts/e2e/mcp-attach/spike-presign.ts), run from worktree W1 with Node v26.13.0 and `@vercel/blob` 2.8.2:

```
npx tsx --env-file=/Users/rob/Documents/active_work/jowray_com/.env scripts/e2e/mcp-attach/spike-presign.ts
```

It mints each URL with `issueSignedToken({ pathname, operations: ["put"], allowedContentTypes: [type], maximumSizeInBytes: size, validUntil })` and `presignUrl(…, { operation: "put", access: "private", addRandomSuffix: false, allowOverwrite: false, … })`, the way `presignPut` will. It wrote only under `dev/spike/` and printed only hosts, paths, query-parameter names, status codes and error codes. No URL, token or signature was printed or saved.

## Results

| Check | Result |
|---|---|
| Upload host | `vercel.com`, path `/api/blob/` (C6) |
| Query-parameter names | `pathname`, `vercel-blob-add-random-suffix`, `vercel-blob-allow-overwrite`, `vercel-blob-allowed-content-types`, `vercel-blob-delegation`, `vercel-blob-maximum-size-in-bytes`, `vercel-blob-signature`. The two secrets are `vercel-blob-signature` and `vercel-blob-delegation` (§8.6 scrub list) |
| Minimal header set | `content-type` alone: 200. `x-vercel-blob-access` is **not** needed; the blob is stored private (its URL host is `<store>.private.blob.vercel-storage.com`) |
| Second PUT to the same pathname | 400 `bad_request: This blob already exists, use allowOverwrite: true …` (write-once holds) |
| Body one byte over `maximumSizeInBytes` | 403 `forbidden: the file length cannot be greater than 2048 bytes` |
| `head()` after the upload | pathname matches, size 2048, `contentType: image/jpeg` |
| `curl -X PUT -K <mode-600 config holding the url> -H "content-type: …" --data-binary @file` | 200; `head()` size 2048, `image/jpeg`. The URL never appears in argv or output |
| Cleanup | 6 blobs deleted, `list({ prefix: "dev/spike/" })` empty |

### Content type: the docs and the CDN differ

C3 says "allowedContentTypes rejects requests whose Content-Type header is not in the list." Measured on a URL minted for `image/jpeg`:

| Headers sent | Result | Stored `contentType` |
|---|---|---|
| `content-type: image/png` | **200** (accepted) | `image/jpeg` |
| `content-type: image/jpeg`, `x-content-type: image/png` | 403 `forbidden: "contentType" image/png is not allowed` | — |
| `content-type: image/png`, `x-content-type: image/png` | 403, same | — |

So the API ignores the plain `content-type` header for typing: it checks and stores the SDK's `x-content-type` header when present, and otherwise types the blob from the pathname's extension. With only `content-type`, each kind the connector uploads was stored with its declared type:

| Pathname extension | Declared (minted) type | Stored `contentType` |
|---|---|---|
| `.heic` | `image/heic` | `image/heic` |
| `.mov` | `video/quicktime` | `video/quicktime` |
| `.mp4` | `video/mp4` | `video/mp4` |

## What PR 2 takes from this

- `request_upload` returns `headers: { "content-type": <type>, "x-content-type": <type> }`. `x-content-type` is the header the CDN enforces against `allowedContentTypes`; `content-type` keeps curl and proxies honest. The pathname's extension comes from the same declared type (`<env prefix><memoryId>/<uuid>.<ext>`), so even a client that drops `x-content-type` gets a blob typed as declared, and `recordMedia`'s existing label check still runs.
- Size: the CDN enforces the maximum (403); `recordMedia` enforces equality (D3, D10).
- Write-once: `allowOverwrite: false` makes a replayed PUT fail with 400, so a leaked URL cannot replace a file.
- Correction to C3's wording for the plan: the enforced header is `x-content-type`, not `Content-Type`.

## Still open

- **Cowork reachability (Rob).** In Cowork, run `curl -sI https://vercel.com/api/blob` before and after adding `vercel.com` to the allowed domains (claude.ai, Settings → Capabilities), and record whether each answer is an HTTP response or a proxy refusal (C14).
