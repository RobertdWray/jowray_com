/**
 * S0.3 spike for the connector upload (plan docs/plans/2026-11-06-mcp-attach-media.md §6, D1, D3, C3, C6).
 *
 * Mints Vercel Blob presigned PUT URLs with the store's read-write token, the
 * way `presignPut` will, and records what the CDN demands and enforces:
 * - the minimal header set a PUT needs (tried in growing order, each on a fresh pathname);
 * - a second PUT to the same pathname is refused (write-once, `allowOverwrite: false`);
 * - a wrong `content-type` and a body one byte over `maximumSizeInBytes` are refused;
 * - `head()` sees the uploaded blob with the declared type and size;
 * - the same upload works from `curl`, with the URL kept out of argv (a mode-600 `curl -K` config file);
 * - the upload host.
 * Then it deletes every blob it made and reads back an empty `dev/spike/` listing.
 *
 * Writes only under `dev/spike/`. Prints only hosts, paths, query-parameter
 * names, status codes and short error codes: never a URL with its query, a
 * token or a signature.
 *
 * Run from a worktree with dependencies installed:
 *   npx tsx --env-file=/Users/rob/Documents/active_work/jowray_com/.env scripts/e2e/mcp-attach/spike-presign.ts
 */
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { del, head, issueSignedToken, list, presignUrl } from "@vercel/blob";

const PREFIX = "dev/spike/";
const CONTENT_TYPE = "image/jpeg";
const BODY_BYTES = 2048;
const URL_LIFETIME_MS = 10 * 60 * 1000;
const run = promisify(execFile);

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  throw new Error("BLOB_READ_WRITE_TOKEN is not set; pass the main checkout's .env with --env-file");
}
const blobToken: string = token;

type Headers = Record<string, string>;
interface PutOutcome {
  status: number;
  error?: string;
}

/** Anything the API might echo back that looks like a signed parameter is cut before printing. */
function redact(text: string): string {
  return text.replace(/vercel-blob-[a-z-]+=[^&\s"']+/gi, "<redacted>").slice(0, 200);
}

function describeUrl(url: string): { host: string; path: string; queryParameterNames: string[] } {
  const parsed = new URL(url);
  return { host: parsed.host, path: parsed.pathname, queryParameterNames: [...new Set(parsed.searchParams.keys())].sort() };
}

async function mint(pathname: string, contentType: string, maxBytes: number): Promise<string> {
  const validUntil = Date.now() + URL_LIFETIME_MS;
  const signed = await issueSignedToken({
    pathname,
    operations: ["put"],
    allowedContentTypes: [contentType],
    maximumSizeInBytes: maxBytes,
    validUntil,
    token: blobToken,
  });
  const { presignedUrl } = await presignUrl(signed, {
    operation: "put",
    pathname,
    access: "private",
    allowedContentTypes: [contentType],
    maximumSizeInBytes: maxBytes,
    addRandomSuffix: false,
    allowOverwrite: false,
    validUntil,
  });
  return presignedUrl;
}

async function put(url: string, headers: Headers, body: Uint8Array): Promise<PutOutcome> {
  const response = await fetch(url, { method: "PUT", headers, body: new Blob([new Uint8Array(body)]) });
  const text = await response.text();
  if (response.ok) {
    return { status: response.status };
  }
  let error = text;
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    error = [parsed.error?.code, parsed.error?.message].filter(Boolean).join(": ") || text;
  } catch {
    // Not JSON: keep the (redacted) text.
  }
  return { status: response.status, error: redact(error) };
}

function spikePath(label: string): string {
  return `${PREFIX}${randomUUID()}-${label}.jpg`;
}

const HEADER_SETS: Array<{ name: string; headers: (contentType: string) => Headers }> = [
  { name: "content-type", headers: (ct) => ({ "content-type": ct }) },
  { name: "content-type + x-vercel-blob-access", headers: (ct) => ({ "content-type": ct, "x-vercel-blob-access": "private" }) },
  { name: "content-type + x-vercel-blob-access + x-content-type", headers: (ct) => ({ "content-type": ct, "x-vercel-blob-access": "private", "x-content-type": ct }) },
  { name: "content-type + x-vercel-blob-access + x-content-type + x-api-version", headers: (ct) => ({ "content-type": ct, "x-vercel-blob-access": "private", "x-content-type": ct, "x-api-version": "13" }) },
];

async function main(): Promise<void> {
  const created: string[] = [];
  const body = new Uint8Array(randomBytes(BODY_BYTES));
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), bodyBytes: BODY_BYTES, contentType: CONTENT_TYPE };
  try {
    // 1. Header discovery, each attempt on its own pathname so a refusal cannot leave a blob behind for the next.
    const attempts: Array<{ headerSet: string; status: number; error?: string }> = [];
    let winner: { name: string; headers: (contentType: string) => Headers } | null = null;
    let winnerPath: string | null = null;
    let winnerUrl: string | null = null;
    for (const set of HEADER_SETS) {
      const pathname = spikePath("discover");
      const url = await mint(pathname, CONTENT_TYPE, BODY_BYTES);
      report.url ??= describeUrl(url);
      const outcome = await put(url, set.headers(CONTENT_TYPE), body);
      attempts.push({ headerSet: set.name, ...outcome });
      if (outcome.status >= 200 && outcome.status < 300) {
        created.push(pathname);
        winner = set;
        winnerPath = pathname;
        winnerUrl = url;
        break;
      }
    }
    report.headerDiscovery = attempts;
    if (!winner || !winnerPath || !winnerUrl) {
      report.result = "no header set worked";
      return;
    }
    report.minimalHeaderSet = winner.name;

    // 2. Write-once: the same URL and headers again.
    report.secondPutSamePath = await put(winnerUrl, winner.headers(CONTENT_TYPE), body);

    // 3. head() sees the blob.
    const meta = await head(winnerPath, { token: blobToken });
    report.head = { pathnameMatches: meta.pathname === winnerPath, size: meta.size, contentType: meta.contentType, urlHost: new URL(meta.url).host };

    // 4. Wrong type against a URL minted for image/jpeg: once in the plain `content-type` header,
    // once in the SDK's `x-content-type` header. Where a PUT is accepted, record the type the blob was stored with.
    const wrongTypeCases: Array<{ name: string; headers: Headers }> = [
      { name: "content-type: image/png", headers: { "content-type": "image/png" } },
      { name: "content-type: image/jpeg, x-content-type: image/png", headers: { "content-type": CONTENT_TYPE, "x-content-type": "image/png" } },
      { name: "content-type: image/png, x-content-type: image/png", headers: { "content-type": "image/png", "x-content-type": "image/png" } },
    ];
    const wrongTypeResults: Array<Record<string, unknown>> = [];
    for (const wrongCase of wrongTypeCases) {
      const pathname = spikePath("wrongtype");
      const url = await mint(pathname, CONTENT_TYPE, BODY_BYTES);
      const outcome = await put(url, wrongCase.headers, body);
      const entry: Record<string, unknown> = { case: wrongCase.name, ...outcome };
      if (outcome.status < 300) {
        created.push(pathname);
        entry.storedContentType = (await head(pathname, { token: blobToken })).contentType;
      }
      wrongTypeResults.push(entry);
    }
    report.wrongContentType = wrongTypeResults;

    // 4b. The types the connector will upload: does a PUT with only `content-type` store the declared type?
    const kinds = [
      { ext: "heic", type: "image/heic" },
      { ext: "mov", type: "video/quicktime" },
      { ext: "mp4", type: "video/mp4" },
    ];
    const kindResults: Array<Record<string, unknown>> = [];
    for (const kind of kinds) {
      const pathname = `${PREFIX}${randomUUID()}-kind.${kind.ext}`;
      const url = await mint(pathname, kind.type, BODY_BYTES);
      const outcome = await put(url, { "content-type": kind.type }, body);
      const entry: Record<string, unknown> = { ext: kind.ext, declared: kind.type, ...outcome };
      if (outcome.status < 300) {
        created.push(pathname);
        entry.storedContentType = (await head(pathname, { token: blobToken })).contentType;
      }
      kindResults.push(entry);
    }
    report.kinds = kindResults;

    // 5. One byte over the declared maximum.
    const oversizePath = spikePath("oversize");
    const oversizeUrl = await mint(oversizePath, CONTENT_TYPE, BODY_BYTES);
    const oversize = await put(oversizeUrl, winner.headers(CONTENT_TYPE), new Uint8Array(randomBytes(BODY_BYTES + 1)));
    if (oversize.status < 300) {
      created.push(oversizePath);
    }
    report.oversizeBody = oversize;

    // 6. The shell route: curl with the URL in a mode-600 config file, never in argv or the output.
    const curlPath = spikePath("curl");
    const curlUrl = await mint(curlPath, CONTENT_TYPE, BODY_BYTES);
    const dir = await mkdtemp(path.join(tmpdir(), "jowray-spike-"));
    try {
      const configFile = path.join(dir, "curl.cfg");
      const bodyFile = path.join(dir, "body.bin");
      await writeFile(configFile, `url = "${curlUrl}"\n`, { mode: 0o600 });
      await writeFile(bodyFile, body, { mode: 0o600 });
      const headerArgs = Object.entries(winner.headers(CONTENT_TYPE)).flatMap(([key, value]) => ["-H", `${key}: ${value}`]);
      const { stdout } = await run("curl", ["-sS", "-X", "PUT", "-K", configFile, ...headerArgs, "--data-binary", `@${bodyFile}`, "-o", "/dev/null", "-w", "%{http_code}"]);
      const status = Number(stdout.trim());
      if (status >= 200 && status < 300) {
        created.push(curlPath);
        const curlMeta = await head(curlPath, { token: blobToken });
        report.curl = { status, headSize: curlMeta.size, headContentType: curlMeta.contentType };
      } else {
        report.curl = { status };
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    report.result = "ok";
  } finally {
    // 7. Clean up everything this run made, then read the prefix back.
    for (const pathname of created) {
      await del(pathname, { token: blobToken });
    }
    const remaining = await list({ prefix: PREFIX, token: blobToken });
    report.cleanup = { deleted: created.length, remainingUnderPrefix: remaining.blobs.length };
    report.finishedAt = new Date().toISOString();
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(redact(message));
  process.exitCode = 1;
});
