# Connector upload E2E harness

Run from the repository root with installed dependencies and a generated Prisma client. These standalone scripts run with `npx tsx`; they do not load `.env` files, application telemetry or the app's `server-only` modules. The offline tests use temporary files and substitute fetch/Blob/curl implementations; they make no network requests.

References: [plan §5, §8.6, §11.2 and §12](../../../docs/plans/2026-11-06-mcp-attach-media.md), [presign spike](../../../docs/plans/evidence/2026-11-mcp-attach/s03-spike.md), and [C44 evidence convention](../../../docs/plans/evidence/2026-11-photo-gps/README.md).

## Environment

Script inputs (names only):

| Script | Environment variables |
| --- | --- |
| `mcp-call.ts` | `MCP_URL`, `MCP_API_SECRET` |
| `upload.sh` | No application environment variables; curl uses the process's standard proxy/CA environment |
| `readback.ts` | `DATABASE_URL` |
| `cleanup.ts` | `BLOB_READ_WRITE_TOKEN` |

The orchestrator provisions the **schema-only** Neon branch named `mcp-attach-e2e-YYYYMMDD`, applies migrations, seeds its memorial, and starts local `next dev` using plan §5. Its environment includes `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BLOB_READ_WRITE_TOKEN`, `MCP_API_SECRET`, `CRON_SECRET`, `OUTBOUND_ENABLED`, `OUTBOUND_ALLOWLIST`, `ADMIN_ALERT_EMAILS`, `PLACES_PROVIDER` and any other required app configuration. Outbound email must be off **and the allowlist empty**, admin alert recipients must be synthetic, and places must use the stub. Use throwaway MCP/cron secrets and a non-working SendGrid key if required by the env schema. Keep secrets in the process environment, never command arguments, terminal output, logs, evidence or committed files.

Before connecting, identify the branch's specific `ep-...` endpoint in Neon. `readback.ts` requires its **full hostname or complete endpoint id** via `--expect-host`, checks the Neon domain and Postgres scheme, and refuses substrings such as `ep-c`, `aw` or a truncated endpoint id. Pooled and unpooled hosts both work; the endpoint id can omit the hostname's `-pooler` suffix. Database URL query keys are limited to `sslmode`, `channel_binding`, `connect_timeout` and `application_name`; every other key is refused, including `host`, `hostaddr` and Neon's `options=endpoint=...` routing override. **The guard cannot establish branch ancestry or distinguish production if the caller deliberately supplies production's endpoint.** Verify the schema-only branch first and copy its complete hostname or endpoint id.

## Run order (plan §11.2)

1. Confirm the dev process uses the isolated database and §5 settings. Set the harness's MCP secret to the same throwaway secret. `MCP_URL` defaults to `http://localhost:3000/api/mcp`; set it for another local port. List the tools:

   ```sh
   npx tsx scripts/e2e/mcp-attach/mcp-call.ts --list
   ```

2. Call `draft_memory` with a synthetic contributor and unique test words/source input (the source is deduplicated). Record the returned memory id. For example, change the run marker each time:

   ```sh
   npx tsx scripts/e2e/mcp-attach/mcp-call.ts draft_memory '{"contributor":{"name":"Upload harness","email":"mcp-e2e@example.invalid"},"note":"Synthetic connector upload run RUN_MARKER","sourceInput":{"kind":"other","originalText":"Synthetic connector upload run RUN_MARKER"}}'
   ```

   The client initializes MCP, sends `notifications/initialized`, and then calls the tool. It handles JSON and streamed SSE responses, carries session/protocol headers and refuses redirects. A non-2xx HTTP response to `notifications/initialized` produces a short local note on stderr and the tool request continues; HTTP/RPC errors for initialization or tool requests, and tool error results, remain fatal. Printed results redact `presignedUrl` recursively, including the duplicate JSON text blocks, as well as claim links and bearer fields. A claim link therefore cannot be obtained from this output; use the orchestrator's authorized local browser/claim-page setup for step 8.

3. For each file, calculate SHA-256 (`shasum -a 256`) and byte count (`wc -c`) locally; use the matching MIME type. Photo coverage uses `__tests__/fixtures/gps.heic` and a Liberty JPEG made with exiftool. Video coverage, after PR 3, adds the sanitized iPhone MOV and Rob's real iPhone MOV (local only). Use one memory for all these files.

   Create a private temporary directory, **not an existing config file**; the writer refuses existing paths and symlinks:

   ```sh
   upload_tmp=$(mktemp -d "${TMPDIR:-/tmp}/jowray-mcp-attach.XXXXXX")
   url_config="$upload_tmp/upload.curl"
   trap 'rm -f -- "$url_config"; rmdir -- "$upload_tmp"' EXIT
   ```

   Replace the memory id, byte count and hash placeholders below before running (the byte count must be a JSON number):

   ```sh
   npx tsx scripts/e2e/mcp-attach/mcp-call.ts request_upload '{"memoryId":"<MEMORY_UUID>","file":{"name":"gps.heic","type":"image/heic","size":<BYTES>,"sha256":"<SHA256>"}}' --url-file "$url_config"
   scripts/e2e/mcp-attach/upload.sh "$url_config" __tests__/fixtures/gps.heic image/heic
   npx tsx scripts/e2e/mcp-attach/mcp-call.ts finalize_upload '{"memoryId":"<MEMORY_UUID>","mediaId":"<MEDIA_UUID>"}'
   ```

   Save the returned media id between request and finalize. The redacted result is printed **before** the config is written, so a failed write (existing file or permissions) still leaves the reserved media id available for recovery. Check the command's exit status before uploading; after a failed write, inspect the reservation and retry with a new writable config path. Run `upload.sh` only when the request returned `upload`: on `alreadyAttached` or `uploaded: true`, no config is created and no PUT is needed. The config holds `url = "..."` with mode 600, the only temporary credential file in this flow. Do not open, echo or commit it.

   `upload.sh` first requires exactly three arguments and an existing first file whose first 15 bytes are `url = "https://`. The check prints no file contents. Only then does it arm cleanup, so swapped arguments or invalid invocations leave the input files untouched. It passes the config via `curl -K` (the URL stays out of argv), supplies both `content-type` and `x-content-type`, discards the response body, and prints just the HTTP status to stdout. Curl errors remain on stderr with a failing exit status. Once validation succeeds, an EXIT trap removes the config on success or failure; HUP/INT/TERM also exit through that trap. After an untrappable process termination (SIGKILL or power loss), remove any orphaned config before resuming. Never run this flow under shell tracing or curl verbose/trace mode.

   For a pending/verifying finalize, inspect readback and retry or let cron reconcile; do not treat PENDING as success. Once all file types are attached after PR 3, expect READY rows and memory type VIDEO. The photo-only PR 2 run expects PHOTO.

4. Call `suggest_places` with the memory id. Expect GPS on the eligible rows and the stub's `Photo location found near {lat}, {lon} (test)` labels. Pending video location before PR 3 is not evidence that video GPS works. Produce a safe database snapshot:

   ```sh
   npx tsx scripts/e2e/mcp-attach/mcp-call.ts suggest_places '{"memoryId":"<MEMORY_UUID>"}'
   npx tsx scripts/e2e/mcp-attach/readback.ts --memory '<MEMORY_UUID>' --expect-host '<E2E_EP_ENDPOINT>'
   ```

   Readback selects ids/statuses/type, renders `consentedAt` as a boolean, reports each media row's MIME/bytes/`addedVia` and `checksumEqualsDeclared`, rounds coordinates to two decimals, projects ADMIN revision snapshots to before/after media-id lists, and projects EmailLog to type/status/errorMessage. Addresses in error text are redacted; recipient columns are never selected. An absent checksum is **false**, not proof of a mismatch; larger files may wait for cron hashing. Empty revision lists can also represent a non-media ADMIN revision (such as draft/share).

5. Repeat an identical `request_upload`; expect `alreadyAttached` and no extra media row. Keep the original request metadata for retry testing without keeping its URL.

6. For a fresh file, stop the client session after PUT but before finalize. Invoke `GET /api/cron/reconcile-uploads` on the **local** server with the throwaway cron bearer through the orchestrator's credential-safe runner (never put the bearer in argv). Read back READY, the checksum and exactly one ADMIN media revision. A subsequent finalize must converge on that same row.

7. Read back the original memory: still DRAFT, `consentedAt: false`, and no new EmailLog rows or only SKIPPED `outbound_disabled` rows. On separate synthetic memories, exercise an APPROVED attachment (ADMIN revision; status and consent preserved) and a `not_ready` refusal (no media reservation).

8. On a synthetic DRAFT, read its current `memoryVersion` using `get_memory`, then call `share_draft` with that version and APPROVED under the test's authorization. Add a file through its claim page in the browser, then invoke local cron again. Read back the terminal alert row `SKIPPED/admin_shared`. Production consent must still follow the explicit authorization contract in the tool description.

9. Check the local dev log for `vercel-blob-signature` without printing matching lines (`rg -c 'vercel-blob-signature' next-dev.log`; no matches exits 1 and means zero occurrences). Any occurrence fails the gate. Record sanitized evidence as described below.

10. Stop uploading, then clean **each** test memory's originals and save the counts:

    ```sh
    npx tsx scripts/e2e/mcp-attach/cleanup.ts --memory '<MEMORY_UUID>'
    ```

    Cleanup accepts only a UUID and constructs exactly `dev/originals/<id>/`; there is no arbitrary-prefix option. It paginates the full listing before deleting, verifies each pathname, then lists again and prints `{ "deleted": <count>, "remaining": <count> }`. Nonzero remaining fails the command. This script does not delete derived prefixes or database rows. Neon branch deletion requires Rob's OK under §12; production smoke uses `set_deleted` and the normal cron grace period, never this cleanup script.

## Evidence and production use

Evidence belongs in `docs/plans/evidence/2026-11-mcp-attach/e2e-results.json` and `cleanup.json`. Per **C44**, identifying evidence is **ids and two-decimal points only**, alongside the statuses/counts/booleans needed to establish the checks. No family media, names, addresses, claim links, secrets, credentialed URLs, hashes, env dumps or full-precision GPS go into evidence. Review error messages before saving them. The generic MCP output is redacted for credentials but may contain contributor text and full-precision GPS; **never redirect it wholesale into evidence**. Use the readback projection and record only the needed safe fields. Fixtures use the public Statue of Liberty point and stripped metadata.

For the orchestrator's separately authorized post-merge tool listing (plan §12), `mcp-call.ts --prod --list` targets `https://www.jowray.com/api/mcp`. **`--prod` supports `--list` only; every tool call with `--prod` is refused.** It also refuses if `MCP_URL` is set, even to an empty string; unset it first and use the production MCP secret only for that authorized listing. The separate production upload smoke uses the authorized connector workflow and requires the `vercel.com` allowlist/Cowork check in the plan. These scripts alone do not prove browser behavior, absence of outbound email, production latency or successful live cleanup.

Offline checks:

```sh
npx vitest run __tests__/scripts/mcp-attach-harness.test.ts
bash -n scripts/e2e/mcp-attach/upload.sh
npm run validate
```
