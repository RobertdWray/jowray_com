// Drafts a memory on a sender's behalf through the site's admin API, or
// reissues a draft's claim link. Driven by the jowray-draft-memory skill
// (docs/skills/jowray-draft-memory/SKILL.md).
//
// Usage:
//   npx tsx --env-file=.env scripts/draft-memory.ts --input <json-file>
//   npx tsx --env-file=.env scripts/draft-memory.ts --reissue <memoryId>
//
// Env: ADMIN_API_SECRET (bearer; never printed), ADMIN_API_URL (default
// https://www.jowray.com; http only to loopback). Redirects are refused: the
// apex 308s to www, and a cross-origin redirect drops the Authorization
// header, which would surface as a confusing 401. Pure module: imports
// nothing guarded by `server-only`; only `main()` touches the environment.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const DEFAULT_TARGET = "https://www.jowray.com";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type Args = { mode: "draft"; inputPath: string } | { mode: "reissue"; memoryId: string };

export function parseArgs(argv: string[]): Args {
  const usage = "usage: draft-memory.ts --input <json-file> | --reissue <memoryId>";
  if (argv.length !== 2) {
    throw new Error(usage);
  }
  const [flag, value] = argv;
  if (flag === "--input" && value) {
    return { mode: "draft", inputPath: value };
  }
  if (flag === "--reissue" && value) {
    return { mode: "reissue", memoryId: value };
  }
  throw new Error(usage);
}

/** The site to call. Plain http is allowed only to loopback (a local `next dev`). */
export function resolveTarget(raw: string | undefined): URL {
  const url = new URL(raw && raw.trim().length > 0 ? raw : DEFAULT_TARGET);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) {
    throw new Error(`ADMIN_API_URL must use https (got ${url.protocol}//${url.host}); http is allowed only for localhost`);
  }
  return url;
}

/** What is printed before a call: the host, never a path or query. */
export function describeTarget(target: URL): string {
  return target.host;
}

export interface AdminResponse {
  status: number;
  body: unknown;
}

export async function callAdmin({
  target,
  secret,
  path,
  body,
  fetchImpl = fetch,
}: {
  target: URL;
  secret: string;
  path: string;
  body: unknown;
  fetchImpl?: typeof fetch;
}): Promise<AdminResponse> {
  const response = await fetchImpl(new URL(path, target), {
    method: "POST",
    redirect: "error",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", accept: "application/json" },
    body: body === null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A proxy or error page: keep the text so it is readable.
  }
  return { status: response.status, body: parsed };
}

/** Lines for the terminal. The secret is never part of a response, so nothing here can echo it. */
export function summarize(status: number, body: unknown): string[] {
  if (typeof body === "object" && body !== null) {
    const { data, error } = body as { data?: { memoryId?: string; claimLink?: string }; error?: { code?: string; message?: string; memoryId?: string; status?: string } };
    if (status === 200 && data) {
      return [`memoryId: ${data.memoryId ?? "?"}`, `claimLink: ${data.claimLink ?? "?"}`];
    }
    if (error) {
      const lines = [`${status} ${error.code ?? "error"}: ${(error.message ?? "").replace(/\S{32,}/g, "[redacted]")}`];
      if (error.memoryId) {
        lines.push(`memoryId: ${error.memoryId}`);
      }
      if (error.status) {
        lines.push(`status: ${error.status}`);
      }
      return lines;
    }
  }
  return [`${status}: ${typeof body === "string" ? body.slice(0, 500) : JSON.stringify(body)}`];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) {
    throw new Error("ADMIN_API_SECRET is not set (run with --env-file=.env)");
  }
  const target = resolveTarget(process.env.ADMIN_API_URL);
  console.log(`target: ${describeTarget(target)}`);
  const call =
    args.mode === "draft"
      ? callAdmin({ target, secret, path: "/api/admin/memories", body: JSON.parse(readFileSync(args.inputPath, "utf8")) as unknown })
      : callAdmin({ target, secret, path: `/api/admin/memories/${encodeURIComponent(args.memoryId)}/claim-link`, body: null });
  const { status, body } = await call;
  for (const line of summarize(status, body)) {
    console.log(line);
  }
  if (status !== 200) {
    process.exitCode = 1;
  }
}

const isEntrypoint = basename(process.argv[1] ?? "").replace(/\.ts$/, "") === "draft-memory";
if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
