// Drafts a memory on a sender's behalf through the site's admin API, or
// reissues a draft's claim link. Driven by the jowray-draft-memory skill
// (docs/skills/jowray-draft-memory/SKILL.md).
//
// Usage:
//   npx tsx --env-file=.env scripts/draft-memory.ts --prod --input <json-file>
//   npx tsx --env-file=.env scripts/draft-memory.ts --prod --reissue <memoryId>
//   ADMIN_API_URL=http://localhost:3000 npx tsx --env-file=.env scripts/draft-memory.ts --input <json-file>
//
// Env: ADMIN_API_SECRET (bearer; never printed). There is no default target:
// production (https://www.jowray.com) needs the explicit --prod flag, anything
// else needs ADMIN_API_URL (http only to loopback), so a forgotten variable can
// never create rows in production. Redirects are refused: the apex 308s to
// www, and a cross-origin redirect drops the Authorization header, which would
// surface as a confusing 401. Pure module: imports nothing guarded by
// `server-only`; only `main()` touches the environment.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { gmailSourceRef, otherSourceRef, smsSourceRef } from "../lib/source-ref";

const PRODUCTION_TARGET = "https://www.jowray.com";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type Args = { mode: "draft"; inputPath: string; prod: boolean } | { mode: "reissue"; memoryId: string; prod: boolean };

export function parseArgs(argv: string[]): Args {
  const usage = "usage: draft-memory.ts [--prod] --input <json-file> | [--prod] --reissue <memoryId>";
  const prod = argv.includes("--prod");
  const rest = argv.filter((a) => a !== "--prod");
  if (rest.length !== 2) {
    throw new Error(usage);
  }
  const [flag, value] = rest;
  if (flag === "--input" && value) {
    return { mode: "draft", inputPath: value, prod };
  }
  if (flag === "--reissue" && value) {
    return { mode: "reissue", memoryId: value, prod };
  }
  throw new Error(usage);
}

/**
 * The site to call. `--prod` means production and forbids ADMIN_API_URL;
 * without it ADMIN_API_URL is required (plain http only to loopback, for a
 * local `next dev`). No default, so nothing reaches production by accident.
 */
export function resolveTarget(raw: string | undefined, prod: boolean): URL {
  const given = raw && raw.trim().length > 0 ? raw : undefined;
  if (prod) {
    if (given) {
      throw new Error("--prod and ADMIN_API_URL cannot both be set; drop one");
    }
    return new URL(PRODUCTION_TARGET);
  }
  if (!given) {
    throw new Error("No target: pass --prod for production, or set ADMIN_API_URL (for example http://localhost:3000)");
  }
  const url = new URL(given);
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

/**
 * Where the words came from, in the input JSON. The script turns this into
 * `source` + `sourceRef` through the canonical builders in lib/source-ref.ts,
 * so the skill never reproduces the hashing by hand. An input may instead
 * carry `source` and `sourceRef` itself (a replay of an earlier payload).
 */
export type SourceInput =
  | { kind: "gmail"; messageId: string }
  | { kind: "sms"; number: string; sentAt: string; text: string }
  | { kind: "other"; email: string; originalText: string };

function stringField(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`sourceInput.${key} must be a non-empty string`);
  }
  return value;
}

function sourceFor(input: Record<string, unknown>, contributorEmail: string | undefined): { source: "EMAIL" | "SMS" | "OTHER"; sourceRef: string } {
  switch (input.kind) {
    case "gmail":
      return { source: "EMAIL", sourceRef: gmailSourceRef(stringField(input, "messageId")) };
    case "sms":
      return { source: "SMS", sourceRef: smsSourceRef(stringField(input, "number"), stringField(input, "sentAt"), stringField(input, "text")) };
    case "other": {
      // The dedup key is the stored contributor's address; a different one would let the same person be drafted twice.
      const email = typeof input.email === "string" && input.email.length > 0 ? input.email : contributorEmail;
      if (!email) {
        throw new Error("sourceInput.email or contributor.email is required for kind other");
      }
      if (contributorEmail && email.trim().toLowerCase() !== contributorEmail.trim().toLowerCase()) {
        throw new Error("sourceInput.email must match contributor.email (the dedup key is the stored address)");
      }
      return { source: "OTHER", sourceRef: otherSourceRef(email, stringField(input, "originalText")) };
    }
    default:
      throw new Error(`sourceInput.kind must be gmail, sms or other (got ${String(input.kind)})`);
  }
}

/** Every output line goes through here: the configured secret never reaches the terminal, whatever a proxy or error page echoes. */
export function redactSecret(lines: string[], secret: string): string[] {
  if (secret.length === 0) {
    return lines;
  }
  return lines.map((line) => line.split(secret).join("[redacted]"));
}

/** The JSON file's object, with `sourceInput` replaced by `source` + `sourceRef`. */
export function prepareInput(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("The input file must hold a JSON object");
  }
  const { sourceInput, ...rest } = raw as Record<string, unknown> & { sourceInput?: unknown };
  const explicit = "source" in rest || "sourceRef" in rest;
  if (sourceInput !== undefined && explicit) {
    throw new Error("Give either sourceInput or source + sourceRef, not both");
  }
  if (sourceInput === undefined) {
    if (!("source" in rest) || !("sourceRef" in rest)) {
      throw new Error("The input needs sourceInput ({ kind: gmail | sms | other, … }) or source + sourceRef");
    }
    return rest;
  }
  if (typeof sourceInput !== "object" || sourceInput === null) {
    throw new Error("sourceInput.kind must be gmail, sms or other");
  }
  const contributor = rest.contributor as { email?: unknown } | undefined;
  const contributorEmail = typeof contributor?.email === "string" ? contributor.email : undefined;
  return { ...rest, ...sourceFor(sourceInput as Record<string, unknown>, contributorEmail) };
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
  const target = resolveTarget(process.env.ADMIN_API_URL, args.prod);
  console.log(`target: ${describeTarget(target)}`);
  const call =
    args.mode === "draft"
      ? callAdmin({ target, secret, path: "/api/admin/memories", body: prepareInput(JSON.parse(readFileSync(args.inputPath, "utf8"))) })
      : callAdmin({ target, secret, path: `/api/admin/memories/${encodeURIComponent(args.memoryId)}/claim-link`, body: null });
  const { status, body } = await call;
  for (const line of redactSecret(summarize(status, body), secret)) {
    console.log(line);
  }
  if (status !== 200) {
    process.exitCode = 1;
  }
}

const isEntrypoint = basename(process.argv[1] ?? "").replace(/\.ts$/, "") === "draft-memory";
if (isEntrypoint) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(redactSecret([message], process.env.ADMIN_API_SECRET ?? "")[0]);
    process.exitCode = 1;
  });
}
