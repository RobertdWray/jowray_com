import { describe, expect, it, vi } from "vitest";

import { gmailSourceRef, otherSourceRef, smsSourceRef } from "../../lib/source-ref";
import { callAdmin, describeTarget, parseArgs, prepareInput, resolveTarget, summarize } from "../../scripts/draft-memory";

describe("resolveTarget", () => {
  it("has no default: production needs the explicit --prod flag, anything else needs ADMIN_API_URL", () => {
    expect(() => resolveTarget(undefined, false)).toThrow(/--prod|ADMIN_API_URL/);
    expect(resolveTarget(undefined, true).href).toBe("https://www.jowray.com/");
    expect(() => resolveTarget("http://localhost:3000", true)).toThrow(/--prod/);
  });

  it("refuses plain http except to loopback", () => {
    expect(() => resolveTarget("http://www.jowray.com", false)).toThrow(/https/);
    expect(resolveTarget("http://localhost:3000", false).host).toBe("localhost:3000");
    expect(resolveTarget("http://127.0.0.1:3000", false).host).toBe("127.0.0.1:3000");
  });

  it("names the host only, never a path or query", () => {
    expect(describeTarget(new URL("https://www.jowray.com/api/x?secret=1"))).toBe("www.jowray.com");
  });
});

describe("parseArgs", () => {
  it("accepts --input <file> or --reissue <memoryId>, with an optional --prod, nothing else", () => {
    expect(parseArgs(["--input", "/tmp/draft.json"])).toEqual({ mode: "draft", inputPath: "/tmp/draft.json", prod: false });
    expect(parseArgs(["--prod", "--input", "/tmp/draft.json"])).toEqual({ mode: "draft", inputPath: "/tmp/draft.json", prod: true });
    expect(parseArgs(["--reissue", "00000000-0000-4000-8000-000000000001", "--prod"])).toEqual({ mode: "reissue", memoryId: "00000000-0000-4000-8000-000000000001", prod: true });
    expect(() => parseArgs([])).toThrow(/usage/);
    expect(() => parseArgs(["--input"])).toThrow(/usage/);
    expect(() => parseArgs(["--prod"])).toThrow(/usage/);
    expect(() => parseArgs(["--input", "a", "--reissue", "b"])).toThrow(/usage/);
  });
});

describe("callAdmin", () => {
  it("POSTs JSON with the bearer, refuses to follow redirects, and returns status and body", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ success: true, data: { memoryId: "m", claimLink: "https://www.jowray.com/m/t" } }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await callAdmin({ target: new URL("https://www.jowray.com"), secret: "s".repeat(32), path: "/api/admin/memories", body: { note: "x" }, fetchImpl });
    expect(result).toEqual({ status: 200, body: { success: true, data: { memoryId: "m", claimLink: "https://www.jowray.com/m/t" } } });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://www.jowray.com/api/admin/memories");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${"s".repeat(32)}`);
    expect(init?.body).toBe(JSON.stringify({ note: "x" }));
  });

  it("returns a non-JSON body as text so a proxy page is readable", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>nope</html>", { status: 502 }));
    expect(await callAdmin({ target: new URL("https://www.jowray.com"), secret: "s".repeat(32), path: "/api/admin/memories", body: null, fetchImpl })).toEqual({ status: 502, body: "<html>nope</html>" });
  });
});

describe("summarize", () => {
  const secret = "s".repeat(32);
  it("prints memoryId and claimLink on 200", () => {
    const lines = summarize(200, { success: true, data: { memoryId: "mem_1", claimLink: "https://www.jowray.com/m/tok" } });
    expect(lines).toEqual(["memoryId: mem_1", "claimLink: https://www.jowray.com/m/tok"]);
  });
  it("prints memoryId and status on 409 duplicate, and the code and message otherwise", () => {
    expect(summarize(409, { error: { code: "duplicate", message: "exists", memoryId: "mem_1", status: "DRAFT" } })).toEqual(["409 duplicate: exists", "memoryId: mem_1", "status: DRAFT"]);
    expect(summarize(401, { error: { code: "unauthorized", message: "Unauthorized" } })).toEqual(["401 unauthorized: Unauthorized"]);
    expect(summarize(502, "<html>")).toEqual(["502: <html>"]);
  });
  it("never echoes the secret", () => {
    expect(summarize(401, { error: { code: "unauthorized", message: `Unauthorized ${secret}` } }).join("\n")).not.toContain(secret);
  });
});

describe("prepareInput", () => {
  const base = { contributor: { email: "pat@example.com" }, note: "Jo was a light." };

  it("derives source and sourceRef from sourceInput through the canonical builders and drops sourceInput", () => {
    expect(prepareInput({ ...base, sourceInput: { kind: "gmail", messageId: "1A1A2317FBA34EEC" } })).toEqual({ ...base, source: "EMAIL", sourceRef: gmailSourceRef("1a1a2317fba34eec") });
    expect(prepareInput({ ...base, sourceInput: { kind: "sms", number: "+14105551234", sentAt: "2026-11-03T10:05-04:00", text: "Jo was a light.\r\n" } })).toEqual({ ...base, source: "SMS", sourceRef: smsSourceRef("+14105551234", "2026-11-03T14:05Z", "Jo was a light.") });
    expect(prepareInput({ ...base, sourceInput: { kind: "other", email: "Pat@Example.com", originalText: "Dear Rob,\r\n\r\nJo was a light.\r\n" } })).toEqual({ ...base, source: "OTHER", sourceRef: otherSourceRef("pat@example.com", "Dear Rob,\n\nJo was a light.") });
  });

  it("passes an input that already carries source and sourceRef through unchanged, and refuses one with neither or both", () => {
    const explicit = { ...base, source: "EMAIL", sourceRef: "gmail:1a1a2317fba34eec" };
    expect(prepareInput(explicit)).toEqual(explicit);
    expect(() => prepareInput(base)).toThrow(/sourceInput/);
    expect(() => prepareInput({ ...explicit, sourceInput: { kind: "gmail", messageId: "1a1a2317fba34eec" } })).toThrow(/sourceInput/);
    expect(() => prepareInput({ ...base, sourceInput: { kind: "fax" } })).toThrow(/kind/);
  });
});
