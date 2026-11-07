// CLI helpers are also imported by offline tests. No environment reads or clients at module scope.
import { open, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SECRET_FIELD_KEYS, SECRET_HEADER_KEYS, SECRET_KEY_FRAGMENTS } from "../../../lib/sentry/secrets";

export interface McpArgs {
  url: string;
  method: "tools/call" | "tools/list";
  params: Record<string, unknown>;
  urlFile?: string;
}

export interface MemoryReadbackInput {
  id: string;
  memorialId: string;
  contributorId: string | null;
  submissionId: string | null;
  status: string;
  analysisStatus: string;
  type: string;
  consentedAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  media: {
    id: string; status: string; mimeType: string; sizeBytes: number | null;
    addedVia: string | null; checksumSha256: string | null; declaredSha256: string | null;
    latitude: number | null; longitude: number | null;
  }[];
  revisions: { id: string; changedVia: string; before: unknown; after: unknown }[];
  emails: { emailType: string; status: string; errorMessage: string | null }[];
}

export interface CleanupStorage {
  list(options: { prefix: string; cursor?: string }): Promise<{
    blobs: { pathname: string }[]; hasMore: boolean; cursor?: string;
  }>;
  del(pathnames: string[]): Promise<void>;
}

/** Only locally constructed diagnostics are safe to print; provider errors can contain credentials. */
export class HarnessError extends Error {}

export function publicError(error: unknown): string {
  if (error instanceof HarnessError) {
    return error.message;
  }
  return "Operation failed; raw provider/OS diagnostics withheld because they may contain credentials. Check connectivity, permissions and the configured environment.";
}

export function isMain(moduleUrl: string): boolean {
  return Boolean(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(moduleUrl));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new HarnessError("Invalid JSON (input omitted to protect credentials).");
  }
}

function parseUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new HarnessError("Invalid URL (value omitted to protect credentials).");
  }
}

export function parseMcpArgs(argv: string[], env: { MCP_URL?: string }): McpArgs {
  const usage = "Usage: mcp-call.ts <tool> '<json object>' [--url-file <new path>] | [--prod] --list";
  const positional: string[] = [];
  const seen = new Set<string>();
  let urlFile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (seen.has(arg) || !["--prod", "--list", "--url-file"].includes(arg)) {
      throw new HarnessError(usage);
    }
    seen.add(arg);
    if (arg === "--url-file") {
      urlFile = argv[++i];
      if (!urlFile?.trim() || urlFile.startsWith("--")) {
        throw new HarnessError(usage);
      }
    }
  }
  const prod = seen.has("--prod");
  if (prod && !seen.has("--list")) {
    throw new HarnessError("--prod is permitted only with --list; production tool calls are refused.");
  }
  if (prod && env.MCP_URL !== undefined) {
    throw new HarnessError("--prod and MCP_URL cannot both be set; unset MCP_URL first.");
  }
  const url = parseUrl(prod ? "https://www.jowray.com/api/mcp" : (env.MCP_URL ?? "http://localhost:3000/api/mcp"));
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash) {
    throw new HarnessError("MCP_URL requires HTTPS (HTTP allowed only on loopback), without credentials, query or fragment.");
  }
  if (seen.has("--list")) {
    if (positional.length || urlFile) {
      throw new HarnessError(usage);
    }
    return { url: url.href, method: "tools/list", params: {} };
  }
  if (positional.length !== 2 || !/^[a-zA-Z0-9_.-]+$/.test(positional[0])) {
    throw new HarnessError(usage);
  }
  const args = parseJson(positional[1]);
  if (!isRecord(args)) {
    throw new HarnessError("Tool arguments must be a JSON object.");
  }
  return { url: url.href, method: "tools/call", params: { name: positional[0], arguments: args }, ...(urlFile ? { urlFile } : {}) };
}

function requireMemoryId(value: string | undefined): string {
  if (!value || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) {
    throw new HarnessError("--memory must be a memory UUID, never a path or prefix.");
  }
  return value;
}

function namedArgs(argv: string[], allowed: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!allowed.includes(key) || values.has(key) || !value?.trim() || value.startsWith("--")) {
      throw new HarnessError(`Required arguments: ${allowed.join(", ")} (one value each).`);
    }
    values.set(key, value);
  }
  if (values.size !== allowed.length) {
    throw new HarnessError(`Required arguments: ${allowed.join(", ")} (one value each).`);
  }
  return values;
}

export function parseReadbackArgs(argv: string[]): { memoryId: string; expectHost: string } {
  const values = namedArgs(argv, ["--memory", "--expect-host"]);
  return { memoryId: requireMemoryId(values.get("--memory")), expectHost: values.get("--expect-host")! };
}

export function parseCleanupArgs(argv: string[]): { memoryId: string } {
  return { memoryId: requireMemoryId(namedArgs(argv, ["--memory"]).get("--memory")) };
}

/** This checks an operator-pinned endpoint, not branch ancestry: confirm the schema-only branch in Neon first. */
export function assertReadbackHost(connectionString: string, expectHost: string): void {
  const url = parseUrl(connectionString);
  const endpoint = url.hostname.split(".")[0];
  const matchesExpected = expectHost === url.hostname
    || (/^ep-[a-z0-9]+(?:-[a-z0-9]+)+$/.test(expectHost)
      && (expectHost === endpoint || expectHost === endpoint.replace(/-pooler$/, "")));
  // Connection options (including Neon's options=endpoint=...) can override host routing.
  const allowedQueryKeys = new Set(["sslmode", "channel_binding", "connect_timeout", "application_name"]);
  if ([...url.searchParams.keys()].some((key) => !allowedQueryKeys.has(key))) {
    throw new HarnessError("DATABASE_URL query keys must be limited to sslmode, channel_binding, connect_timeout and application_name.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !/^ep-[a-z0-9]+(?:-[a-z0-9]+)+\.(?:[a-z0-9-]+\.)*neon\.tech$/.test(url.hostname)
    || !matchesExpected) {
    throw new HarnessError("DATABASE_URL must target the exact Neon hostname or complete ep-... endpoint id supplied by --expect-host.");
  }
}

const secretKeys = new Set<string>([...SECRET_FIELD_KEYS, ...SECRET_HEADER_KEYS, "presignedUrl"].map((key) => key.toLowerCase()));

function secretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return secretKeys.has(lower) || SECRET_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

function embeddedJson(value: string): unknown {
  if (!/^[\s]*[\[{]/.test(value)) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    // A text block need not be JSON; it still goes through string redaction.
    return undefined;
  }
}

/** Redact both MCP representations and any copies of their bearer values in free text. */
export function redactResult(value: unknown, secrets: string[] = []): unknown {
  const hidden = new Set(secrets.filter(Boolean));
  function collect(item: unknown): void {
    if (Array.isArray(item)) {
      item.forEach(collect);
    } else if (isRecord(item)) {
      for (const [key, child] of Object.entries(item)) {
        if (secretKey(key) && typeof child === "string" && child) {
          hidden.add(child);
        }
        collect(child);
      }
    } else if (typeof item === "string") {
      const parsed = embeddedJson(item);
      if (parsed !== undefined) {
        collect(parsed);
      }
    }
  }
  collect(value);
  function visit(item: unknown): unknown {
    if (Array.isArray(item)) {
      return item.map(visit);
    }
    if (isRecord(item)) {
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, secretKey(key) ? "<redacted>" : visit(child)]));
    }
    if (typeof item !== "string") {
      return item;
    }
    const parsed = embeddedJson(item);
    if (parsed !== undefined) {
      return JSON.stringify(visit(parsed));
    }
    let text = item;
    for (const secret of [...hidden].sort((a, b) => b.length - a.length)) {
      text = text.replaceAll(secret, "<redacted>");
    }
    return text
      .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => /[?&](?:vercel-blob-(?:signature|delegation)|t|token|sig)=|\/m\//i.test(url) ? "<redacted>" : url)
      .replace(/\/m\/[^\s/?#"'<>]+|([?&]t=)[^\s&#"'<>]+/g, "<redacted>");
  }
  return visit(value);
}

export function uploadUrlFromResult(result: unknown): string | undefined {
  if (!isRecord(result) || result.isError === true) {
    return undefined;
  }
  if (isRecord(result.upload) && typeof result.upload.presignedUrl === "string") {
    return result.upload.presignedUrl;
  }
  if (isRecord(result.structuredContent)) {
    return uploadUrlFromResult(result.structuredContent);
  }
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
        const url = uploadUrlFromResult(embeddedJson(block.text));
        if (url) { return url; }
      }
    }
  }
  return undefined;
}

/** Exclusive creation also refuses symlinks and avoids inheriting permissive modes on existing files. */
export async function writeCurlConfig(filename: string, url: string): Promise<void> {
  const parsed = parseUrl(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || /[\x00-\x1f\x7f]/.test(url)) {
    throw new HarnessError("Upload URL must be HTTPS without userinfo or control characters.");
  }
  const file = await open(filename, "wx", 0o600);
  try {
    try {
      await file.chmod(0o600);
      await file.writeFile(`url = "${url.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"\n`);
    } finally {
      await file.close();
    }
  } catch (error) {
    await rm(filename);
    throw error;
  }
}

function coordinates(latitude: number | null, longitude: number | null) {
  return latitude === null || longitude === null ? null : {
    latitude: Number(latitude.toFixed(2)), longitude: Number(longitude.toFixed(2)),
  };
}

function revisionIds(snapshot: unknown): string[] {
  if (!isRecord(snapshot)) { return []; }
  const ids = snapshot.readyMediaIds ?? snapshot.mediaIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function emailError(message: string | null): string | null {
  if (message === null) { return null; }
  const safe = redactResult(message);
  return String(safe)
    .replace(/https?:\/\/[^\s"'<>]+/gi, "<redacted>")
    .replace(/(?:"(?:[^"\\]|\\.)*"|[^\s<>"(),;:]+)@[^\s<>"(),;:]+/g, "<redacted>");
}

export function summarizeMemory(memory: MemoryReadbackInput) {
  return {
    id: memory.id, memorialId: memory.memorialId, contributorId: memory.contributorId,
    submissionId: memory.submissionId, status: memory.status, analysisStatus: memory.analysisStatus,
    type: memory.type, consentedAt: memory.consentedAt !== null,
    coordinates: coordinates(memory.latitude, memory.longitude),
    media: memory.media.map((row) => ({
      id: row.id, status: row.status, mimeType: row.mimeType, sizeBytes: row.sizeBytes,
      addedVia: row.addedVia,
      checksumEqualsDeclared: row.checksumSha256 !== null && row.declaredSha256 !== null && row.checksumSha256 === row.declaredSha256,
      coordinates: coordinates(row.latitude, row.longitude),
    })),
    revisions: memory.revisions.filter((row) => row.changedVia === "ADMIN").map((row) => ({
      id: row.id, before: revisionIds(row.before), after: revisionIds(row.after),
    })),
    emails: memory.emails.map((row) => ({ type: row.emailType, status: row.status, errorMessage: emailError(row.errorMessage) })),
  };
}

export async function cleanupOriginals(memoryId: string, storage: CleanupStorage): Promise<{ deleted: number; remaining: number }> {
  const prefix = `dev/originals/${requireMemoryId(memoryId)}/`;
  async function listing(): Promise<string[]> {
    const paths = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await storage.list({ prefix, ...(cursor ? { cursor } : {}) });
      for (const blob of page.blobs) {
        if (!blob.pathname.startsWith(prefix) || blob.pathname.split("/").some((part) => part === "." || part === "..")) {
          throw new HarnessError("Blob listing contained an object outside the permitted dev/originals memory prefix.");
        }
        paths.add(blob.pathname);
      }
      if (!page.hasMore) { break; }
      if (!page.cursor || cursors.has(page.cursor)) {
        throw new HarnessError("Blob pagination failed: missing or repeated cursor.");
      }
      cursor = page.cursor;
      cursors.add(cursor);
    } while (true);
    return [...paths];
  }
  const paths = await listing();
  // Finish pagination before mutating the store, so deletion cannot invalidate a listing cursor.
  for (let i = 0; i < paths.length; i += 1000) {
    await storage.del(paths.slice(i, i + 1000));
  }
  return { deleted: paths.length, remaining: (await listing()).length };
}
