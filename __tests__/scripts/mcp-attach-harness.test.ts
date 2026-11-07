import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertReadbackHost,
  cleanupOriginals,
  parseCleanupArgs,
  parseMcpArgs,
  parseReadbackArgs,
  redactResult,
  summarizeMemory,
  uploadUrlFromResult,
  writeCurlConfig,
} from "../../scripts/e2e/mcp-attach/lib";
import { callMcp } from "../../scripts/e2e/mcp-attach/mcp-call";

const memoryId = "11111111-2222-4333-8444-555555555555";
const unsignedUrl = "https://example.invalid/upload?fixture=unsigned";
const dirs: string[] = [];

async function temporaryDirectory() {
  const dir = await mkdtemp(path.join(tmpdir(), "mcp-harness-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("harness arguments", () => {
  it("defaults to local MCP and parses a tool with object arguments", () => {
    expect(parseMcpArgs(["request_upload", '{"memoryId":"test"}', "--url-file", "/tmp/upload.cfg"], {})).toEqual({
      url: "http://localhost:3000/api/mcp", method: "tools/call",
      params: { name: "request_upload", arguments: { memoryId: "test" } }, urlFile: "/tmp/upload.cfg",
    });
    expect(parseMcpArgs(["--list"], { MCP_URL: "http://localhost:3107/api/mcp" })).toMatchObject({
      url: "http://localhost:3107/api/mcp", method: "tools/list", params: {},
    });
    expect(parseMcpArgs(["--prod", "--list"], {}).url).toBe("https://www.jowray.com/api/mcp");
  });

  it.each([
    [], ["--list", "extra"], ["--list", "--url-file", "file"], ["--list", "--list"],
    ["tool"], ["tool", "null"], ["tool", "[]"], ["tool", "broken"], ["tool", "{}", "extra"],
    ["tool", "{}", "--url-file"], ["--unknown"], ["--prod", "--prod", "--list"],
  ])("refuses ambiguous or malformed MCP arguments: %j", (...args) => {
    expect(() => parseMcpArgs(args, {})).toThrow();
  });

  it("rejects conflicting targets, URL credentials and insecure remote targets", () => {
    for (const MCP_URL of ["", "http://localhost:3000/api/mcp"]) {
      expect(() => parseMcpArgs(["--prod", "--list"], { MCP_URL })).toThrow(/MCP_URL/);
    }
    for (const MCP_URL of ["http://example.invalid/api/mcp", "https://user:pass@example.invalid/api/mcp", "file:///tmp/mcp", "https://example.invalid/api/mcp?secret=fixture"]) {
      expect(() => parseMcpArgs(["--list"], { MCP_URL })).toThrow();
    }
  });

  it.each(["request_upload", "finalize_upload", "get_memory"])("refuses production tool calls: %s", (tool) => {
    expect(() => parseMcpArgs(["--prod", tool, "{}"], {})).toThrow(/--list/);
  });

  it("requires explicit memory and host arguments for readback", () => {
    expect(parseReadbackArgs(["--expect-host", "ep-calm-dawn-a1b2c3d4", "--memory", memoryId])).toEqual({ memoryId, expectHost: "ep-calm-dawn-a1b2c3d4" });
    expect(parseCleanupArgs(["--memory", memoryId])).toEqual({ memoryId });
    for (const args of [[], ["--memory", memoryId], ["--memory", memoryId, "--expect-host", ""], ["--memory", memoryId, "--expect-host", "test", "extra"]]) {
      expect(() => parseReadbackArgs(args)).toThrow();
    }
    for (const value of ["../originals", "", "dev/originals/test/", "test/../../", "not-a-uuid"]) {
      expect(() => parseCleanupArgs(["--memory", value])).toThrow();
    }
    expect(() => parseCleanupArgs(["--memory", memoryId, "--prefix", "originals/"])).toThrow();
  });
});

describe("credential handling", () => {
  it("redacts nested presigned URLs, including MCP's duplicated JSON text, without changing the input", () => {
    const payload = { mediaId: "media-1", upload: { presignedUrl: unsignedUrl, method: "PUT" } };
    const result = { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }], nested: [{ presignedUrl: unsignedUrl }] };
    const redacted = redactResult(result);
    expect(redacted).toEqual({
      structuredContent: { mediaId: "media-1", upload: { presignedUrl: "<redacted>", method: "PUT" } },
      content: [{ type: "text", text: JSON.stringify({ mediaId: "media-1", upload: { presignedUrl: "<redacted>", method: "PUT" } }) }],
      nested: [{ presignedUrl: "<redacted>" }],
    });
    expect(payload.upload.presignedUrl).toBe(unsignedUrl);
    expect(uploadUrlFromResult(result)).toBe(unsignedUrl);
    expect(uploadUrlFromResult({ content: result.content })).toBe(unsignedUrl);
    expect(uploadUrlFromResult({ alreadyAttached: true })).toBeUndefined();
  });

  it("also removes claim links, bearer fields, URL echoes and the configured secret", () => {
    const result = redactResult({ claimLink: "synthetic-claim", authorization: "synthetic-bearer", message: "echo synthetic-secret", upload: { presignedUrl: unsignedUrl }, echo: unsignedUrl }, ["synthetic-secret"]);
    expect(JSON.stringify(result)).not.toMatch(/synthetic-|example\.invalid/);
  });

  it("writes a private curl config and refuses existing files or symlinks", async () => {
    const dir = await temporaryDirectory();
    const config = path.join(dir, "url.cfg");
    await writeCurlConfig(config, unsignedUrl);
    expect((await stat(config)).mode & 0o777).toBe(0o600);
    expect(await readFile(config, "utf8")).toBe(`url = "${unsignedUrl}"\n`);
    await expect(writeCurlConfig(config, "https://example.invalid/other")).rejects.toThrow();
    const link = path.join(dir, "link.cfg");
    await symlink(config, link);
    await expect(writeCurlConfig(link, unsignedUrl)).rejects.toThrow();
    expect(await readFile(config, "utf8")).toBe(`url = "${unsignedUrl}"\n`);
  });

  it("escapes curl config metacharacters and rejects newline directive injection", async () => {
    const config = path.join(await temporaryDirectory(), "url.cfg");
    await writeCurlConfig(config, 'https://example.invalid/upload?q="quoted"\\value');
    expect(await readFile(config, "utf8")).toBe('url = "https://example.invalid/upload?q=\\"quoted\\"\\\\value"\n');
    await expect(writeCurlConfig(`${config}.bad`, `${unsignedUrl}\noutput = "bad"`)).rejects.toThrow();
  });
});

describe("readback", () => {
  it("accepts only a matching Neon endpoint, pooled or unpooled", () => {
    for (const endpoint of ["ep-calm-dawn-a1b2c3d4", "ep-calm-dawn-a1b2c3d4-pooler"]) {
      const host = `${endpoint}.us-east-2.aws.neon.tech`;
      for (const expected of ["ep-calm-dawn-a1b2c3d4", endpoint, host]) {
        expect(() => assertReadbackHost(`postgresql://fixture:fixture@${host}/db?sslmode=require`, expected)).not.toThrow();
      }
    }
  });

  it("allows only the documented connection query options", () => {
    expect(() => assertReadbackHost(
      "postgresql://ep-calm-dawn-a1b2c3d4.us-east-2.aws.neon.tech/db?sslmode=require&channel_binding=require&connect_timeout=10&application_name=mcp-harness",
      "ep-calm-dawn-a1b2c3d4",
    )).not.toThrow();
  });

  it.each(["options=endpoint%3Dep-other-dawn-a9b8c7d6", "unknown_option=value", "ssl=true", "SSLMode=require"])("refuses unapproved database query keys: %s", (query) => {
    expect(() => assertReadbackHost(
      `postgresql://ep-calm-dawn-a1b2c3d4.us-east-2.aws.neon.tech/db?${query}`,
      "ep-calm-dawn-a1b2c3d4",
    )).toThrow();
  });

  it.each([
    ["postgresql://ep-other-dawn-a9b8c7d6.us-east-2.aws.neon.tech/db", "ep-calm-dawn-a1b2c3d4"],
    ["postgresql://ep-calm-dawn-a1b2c3d4.aws.neon.tech.evil.invalid/db", "ep-calm-dawn-a1b2c3d4"],
    ["postgresql://localhost/db", "localhost"],
    ["postgresql://ep-calm-dawn-a1b2c3d4.aws.neon.tech@evil.invalid/db", "ep-calm-dawn-a1b2c3d4"],
    ["https://ep-calm-dawn-a1b2c3d4.aws.neon.tech/db", "ep-calm-dawn-a1b2c3d4"],
    ["postgresql://ep-calm-dawn-a1b2c3d4.aws.neon.tech/db", ""],
    ["postgresql://ep-calm-dawn-a1b2c3d4.aws.neon.tech/db", "neon.tech"],
    ["postgresql://ep-calm-dawn-a1b2c3d4.aws.neon.tech/db", "ep-"],
    ["postgresql://ep-calm-dawn-a1b2c3d4.aws.neon.tech/db", "ep"],
    ["postgresql://ep-calm-dawn-a1b2c3d4.aws.neon.tech/db", "ep-c"],
    ["postgresql://ep-calm-dawn-a1b2c3d4.aws.neon.tech/db", "aw"],
    ["postgresql://ep-calm-dawn-a1b2c3d4.aws.neon.tech/db", "ep-calm-dawn"],
    ["postgresql://ep-calm-dawn-a1b2c3d4.aws.neon.tech/db?host=ep-production-dawn-a9b8c7d6.aws.neon.tech", "ep-calm-dawn-a1b2c3d4"],
    ["postgresql://ep-calm-dawn-a1b2c3d4.aws.neon.tech/db?hostaddr=127.0.0.1", "ep-calm-dawn-a1b2c3d4"],
    ["not a URL", "ep-calm-dawn-a1b2c3d4"],
  ])("rejects an unsafe or mismatched host without echoing credentials", (url, expected) => {
    expect(() => assertReadbackHost(url, expected)).toThrow();
    try { assertReadbackHost(url, expected); } catch (error) { expect(String(error)).not.toContain(url); }
  });

  it("projects only evidence fields, rounds GPS, compares verified hashes, and strips addresses from errors", () => {
    const output = summarizeMemory({
      id: memoryId, memorialId: "memorial", contributorId: "contributor", submissionId: null,
      status: "DRAFT", analysisStatus: "NOT_STARTED", type: "PHOTO", consentedAt: null,
      latitude: 40.689247, longitude: -74.044502,
      media: [
        { id: "media-1", status: "READY", mimeType: "image/heic", sizeBytes: 12, addedVia: "ADMIN", checksumSha256: "same", declaredSha256: "same", latitude: 40.689247, longitude: -74.044502 },
        { id: "media-2", status: "PENDING", mimeType: "video/quicktime", sizeBytes: null, addedVia: "ADMIN", checksumSha256: null, declaredSha256: null, latitude: null, longitude: null },
      ],
      revisions: [{ id: "rev", changedVia: "ADMIN", before: { readyMediaIds: ["media-1"], note: "private" }, after: { readyMediaIds: ["media-1", "media-2"] } }],
      emails: [{ emailType: "ADMIN_NEW_MEMORY", status: "SKIPPED", errorMessage: "outbound_disabled" }, { emailType: "CONFIRMATION", status: "FAILED", errorMessage: 'rejected fixture@example.invalid and "quoted fixture"@example.invalid' }],
    });
    expect(output).toMatchObject({ consentedAt: false, coordinates: { latitude: 40.69, longitude: -74.04 }, media: [{ checksumEqualsDeclared: true }, { checksumEqualsDeclared: false }], revisions: [{ id: "rev", before: ["media-1"], after: ["media-1", "media-2"] }], emails: [{ type: "ADMIN_NEW_MEMORY", status: "SKIPPED", errorMessage: "outbound_disabled" }, { errorMessage: "rejected <redacted> and <redacted>" }] });
    expect(JSON.stringify(output)).not.toMatch(/private|example\.invalid|40\.689247|checksumSha256|declaredSha256/);
  });
});

describe("MCP transport (offline fetch)", () => {
  it.each([400, 404, 500])("continues after notifications/initialized HTTP %i with a credential-safe local note", async (status) => {
    const notes = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } });
      }
      if (body.method === "notifications/initialized") {
        return new Response("fixture-secret", { status });
      }
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "request_upload" }] } });
    };
    await expect(callMcp(parseMcpArgs(["--list"], {}), "fixture-secret", fetchImpl)).resolves.toEqual({ tools: [{ name: "request_upload" }] });
    const printedNotes = notes.mock.calls.flat().join("\n");
    expect(printedNotes).toContain("notifications/initialized");
    expect(printedNotes).toContain(String(status));
    expect(printedNotes).not.toContain("fixture-secret");
  });

  it.each(["tools/list", "tools/call"])("still fails on a %s HTTP error after an accepted initialization", async (method) => {
    const args = method === "tools/list" ? ["--list"] : ["request_upload", "{}"];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } });
      }
      if (body.method === "notifications/initialized") { return new Response(null, { status: 202 }); }
      return new Response("fixture-secret", { status: 503 });
    };
    const call = callMcp(parseMcpArgs(args, {}), "fixture-secret", fetchImpl);
    await expect(call).rejects.toThrow(/HTTP 503/);
    await expect(call).rejects.not.toThrow(/fixture-secret/);
  });

  it.each(["application/json", "text/event-stream"])("initializes, notifies, carries session headers and calls tools over %s", async (contentType) => {
    const requests: Record<string, unknown>[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      const headers = new Headers(init?.headers);
      expect(headers.get("accept")).toBe("application/json, text/event-stream");
      expect(headers.get("authorization")).toBe("Bearer fixture-secret");
      expect(init?.redirect).toBe("error");
      if (body.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } }, { headers: { "mcp-session-id": "fixture-session" } });
      }
      expect(headers.get("mcp-session-id")).toBe("fixture-session");
      expect(headers.get("mcp-protocol-version")).toBe("2025-06-18");
      if (body.method === "notifications/initialized") { return new Response(null, { status: 202 }); }
      const result = { structuredContent: { mediaId: "media-1" } };
      if (contentType === "application/json") { return Response.json({ jsonrpc: "2.0", id: body.id, result }); }
      const data = `: keepalive\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\r\n\r\n`;
      return new Response(new ReadableStream({ start(controller) { const bytes = new TextEncoder().encode(data); controller.enqueue(bytes.slice(0, 31)); controller.enqueue(bytes.slice(31)); } }), { headers: { "content-type": contentType } });
    };
    const result = await callMcp(parseMcpArgs(["finalize_upload", "{}"], {}), "fixture-secret", fetchImpl);
    expect(result).toEqual({ structuredContent: { mediaId: "media-1" } });
    expect(requests.map((r) => r.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(requests[2].params).toEqual({ name: "finalize_upload", arguments: {} });
  });

  it("fails on HTTP, RPC and malformed responses without echoing response bodies", async () => {
    for (const response of [new Response("fixture-secret", { status: 401 }), Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "fixture-secret" } }), new Response("fixture-secret", { headers: { "content-type": "application/json" } })]) {
      const call = callMcp(parseMcpArgs(["--list"], {}), "fixture-secret", async () => response);
      await expect(call).rejects.toThrow();
      await expect(call).rejects.not.toThrow(/fixture-secret/);
    }
  });
});

describe("MCP CLI output (offline fetch preload)", () => {
  it("prints the redacted reservation before a failed URL-config write", async () => {
    const config = path.join(await temporaryDirectory(), "existing.cfg");
    await writeFile(config, "existing file must survive");
    const preload = `globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(init.body);
      if (body.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } });
      }
      if (body.method === "notifications/initialized") { return new Response(null, { status: 202 }); }
      return Response.json({ jsonrpc: "2.0", id: body.id, result: {
        structuredContent: { mediaId: "reserved-media-1", upload: { presignedUrl: ${JSON.stringify(unsignedUrl)} } }
      } });
    };`;
    const result = spawnSync(process.execPath, [
      "--import", "tsx", "--import", `data:text/javascript,${encodeURIComponent(preload)}`,
      path.resolve("scripts/e2e/mcp-attach/mcp-call.ts"), "request_upload", "{}", "--url-file", config,
    ], { encoding: "utf8", env: { ...process.env, MCP_URL: "http://localhost:3000/api/mcp", MCP_API_SECRET: "fixture-secret" } });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("reserved-media-1");
    expect(JSON.parse(result.stdout)).toEqual({ structuredContent: { mediaId: "reserved-media-1", upload: { presignedUrl: "<redacted>" } } });
    expect(result.stderr).toContain("mcp-call:");
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/fixture-secret|example\.invalid/);
    expect(await readFile(config, "utf8")).toBe("existing file must survive");
  });
});

describe("Blob cleanup (offline storage)", () => {
  it("paginates before deleting only the requested prefix and reads back", async () => {
    const prefix = `dev/originals/${memoryId}/`;
    const deleted: string[] = [];
    const cursors: (string | undefined)[] = [];
    const result = await cleanupOriginals(memoryId, {
      list: async (options) => {
        expect(options.prefix).toBe(prefix);
        cursors.push(options.cursor);
        if (deleted.length) { return { blobs: [], hasMore: false }; }
        return options.cursor ? { blobs: [{ pathname: `${prefix}b.jpg` }], hasMore: false } : { blobs: [{ pathname: `${prefix}a.jpg` }], hasMore: true, cursor: "next" };
      },
      del: async (paths) => { deleted.push(...paths); },
    });
    expect(result).toEqual({ deleted: 2, remaining: 0 });
    expect(deleted).toEqual([`${prefix}a.jpg`, `${prefix}b.jpg`]);
    expect(cursors).toEqual([undefined, "next", undefined]);
  });

  it("refuses an out-of-prefix object and propagates deletion failure", async () => {
    await expect(cleanupOriginals(memoryId, { list: async () => ({ blobs: [{ pathname: "originals/production.jpg" }], hasMore: false }), del: async () => { throw new Error("must not delete"); } })).rejects.toThrow(/prefix/);
    await expect(cleanupOriginals(memoryId, { list: async () => ({ blobs: [{ pathname: `dev/originals/${memoryId}/a.jpg` }], hasMore: false }), del: async () => { throw new Error("deletion failed"); } })).rejects.toThrow("deletion failed");
  });
});

describe("upload shell (offline curl substitute)", () => {
  it("refuses swapped arguments without deleting the media file or invoking curl", async () => {
    const dir = await temporaryDirectory();
    const config = path.join(dir, "url.cfg");
    const body = path.join(dir, "irreplaceable video.mov");
    const bodyBytes = Buffer.from([0, 0, 0, 20, 102, 116, 121, 112]);
    const curlMarker = path.join(dir, "curl-called");
    await writeCurlConfig(config, unsignedUrl);
    await writeFile(body, bodyBytes);
    await writeFile(path.join(dir, "curl"), '#!/bin/bash\ntouch "$TEST_CURL_MARKER"\n', { mode: 0o700 });
    const result = spawnSync("bash", [path.resolve("scripts/e2e/mcp-attach/upload.sh"), body, config, "video/quicktime"], {
      encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_CURL_MARKER: curlMarker },
    });
    expect(result.status).not.toBe(0);
    expect(await readFile(body)).toEqual(bodyBytes);
    expect(await readFile(config, "utf8")).toBe(`url = "${unsignedUrl}"\n`);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain(unsignedUrl);
    await expect(stat(curlMarker)).rejects.toThrow();
  });

  it("validates argument count before arming config cleanup", async () => {
    const config = path.join(await temporaryDirectory(), "url.cfg");
    await writeCurlConfig(config, unsignedUrl);
    const result = spawnSync("bash", [path.resolve("scripts/e2e/mcp-attach/upload.sh"), config], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(await readFile(config, "utf8")).toBe(`url = "${unsignedUrl}"\n`);
    expect(result.stdout).toBe("");
  });

  it.each([0, 22])("prints only status and deletes its config when curl exits %i", async (exitCode) => {
    const dir = await temporaryDirectory();
    const config = path.join(dir, "url.cfg");
    const body = path.join(dir, "body file.jpg");
    const argvFile = path.join(dir, "argv");
    await writeCurlConfig(config, unsignedUrl);
    await writeFile(body, "fixture");
    await writeFile(path.join(dir, "curl"), '#!/bin/bash\nprintf "%s\\n" "$@" > "$TEST_CURL_ARGV"\nprintf "%s\\n" "$TEST_CURL_STATUS"\nexit "$TEST_CURL_EXIT"\n', { mode: 0o700 });
    const script = path.resolve("scripts/e2e/mcp-attach/upload.sh");
    const result = spawnSync("bash", [script, config, body, "image/jpeg"], { encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_CURL_ARGV: argvFile, TEST_CURL_STATUS: exitCode ? "403" : "200", TEST_CURL_EXIT: String(exitCode) } });
    expect(result.status).toBe(exitCode);
    expect(result.stdout).toBe(exitCode ? "403\n" : "200\n");
    await expect(stat(config)).rejects.toThrow();
    const args = (await readFile(argvFile, "utf8")).split("\n");
    expect(args).toContain("-K");
    expect(args).toContain(config);
    expect(args).toContain("--fail");
    expect(args).toContain("content-type: image/jpeg");
    expect(args).toContain("x-content-type: image/jpeg");
    expect(args).toContain(`@${body}`);
    expect(args.join(" ")).not.toContain(unsignedUrl);
    expect(() => execFileSync("bash", ["-n", script])).not.toThrow();
  });
});
