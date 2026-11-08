import { Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

const captureMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureMock(...a), flush: vi.fn(async () => true) }));

import { buildLogger, logError, redactPii } from "@/lib/logger";
import { SECRET_FIELD_KEYS, SECRET_HEADER_KEYS } from "@/lib/sentry/secrets";

function capture(): { sink: Writable; lines: () => string[] } {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { sink, lines: () => chunks.join("").split("\n").filter(Boolean) };
}

describe("logger redaction", () => {
  it("records contributor identity but redacts request credentials (R13)", () => {
    const { sink, lines } = capture();
    const log = buildLogger({ destination: sink, level: "info" });
    log.info(
      {
        category: "email",
        email: "person@example.com",
        recipientEmail: "someone@example.com",
        name: "Alice Example",
        phone: "+15555550123",
        contributor: { email: "nested@example.com" },
        req: { headers: { cookie: "session=abc", authorization: "Bearer xyz" } },
        memoryId: "mem_1",
      },
      "confirmation queued"
    );
    const out = lines().join("\n");
    expect(out).toContain("person@example.com");
    expect(out).toContain("someone@example.com");
    expect(out).toContain("nested@example.com");
    expect(out).toContain("Alice Example");
    expect(out).toContain("5555550123");
    expect(out).not.toContain("session=abc");
    expect(out).not.toContain("Bearer xyz");
    expect(out).toContain("mem_1");
    expect(out).toContain("[Redacted]");
  });

  it("records contributor identity two levels down (R13)", () => {
    const { sink, lines } = capture();
    const log = buildLogger({ destination: sink, level: "info" });
    log.info({ memory: { contributor: { email: "deep@example.com", name: "Bob Sample" } }, memoryId: "mem_2" }, "shape");
    const out = lines().join("\n");
    expect(out).toContain("deep@example.com");
    expect(out).toContain("Bob Sample");
    expect(out).toContain("mem_2");
  });

  it("createLogger adds the child context to every line", () => {
    const { sink, lines } = capture();
    const log = buildLogger({ destination: sink, level: "info" });
    log.child({ service: "upload" }).info({ action: "ticket" }, "minted");
    const parsed = JSON.parse(lines()[0]) as Record<string, unknown>;
    expect(parsed.service).toBe("upload");
    expect(parsed.action).toBe("ticket");
  });
});

describe("redactPii", () => {
  it("retains contributor fields and ids at any depth (R13)", () => {
    const out = redactPii({ memoryId: "m1", email: "alice@example.com", nested: { deep: { phone: "+1", name: "Alice Example", mediaId: "x" } }, list: [{ email: "bob@example.com" }] }) as Record<string, unknown>;
    expect(out).toEqual({ memoryId: "m1", email: "alice@example.com", nested: { deep: { phone: "+1", name: "Alice Example", mediaId: "x" } }, list: [{ email: "bob@example.com" }] });
    expect(out.memoryId).toBe("m1");
    expect((out.nested as { deep: { mediaId: string } }).deep.mediaId).toBe("x");
  });
});

describe("logError", () => {
  it("forwards contributor fields to Sentry extra but redacts bearer credentials (R13)", () => {
    captureMock.mockClear();
    logError("boom", new Error("x"), { category: "email", memoryId: "m1", recipientEmail: "p@example.com", contributor: { name: "Alice Example", inviteToken: "SENTRYTEST_x" }, shareUrl: "https://www.example.com/s/SENTRYTEST_x" });
    expect(captureMock).toHaveBeenCalledTimes(1);
    const extra = JSON.stringify(captureMock.mock.calls[0]?.[1]);
    expect(extra).toContain("p@example.com");
    expect(extra).toContain("Alice Example");
    expect(extra).not.toContain("SENTRYTEST_");
    expect(extra).toContain("[Redacted]");
    expect(extra).toContain("m1");
  });
});

describe("logger redaction depth", () => {
  it("records contributor fields two and three levels down (R13)", () => {
    const { sink, lines } = capture();
    const log = buildLogger({ destination: sink, level: "info" });
    log.info({ memory: { contributor: { email: "deep@example.com" } }, a: { b: { c: { email: "three@example.com" } } }, memoryId: "mem_2" }, "shape");
    const out = lines().join("\n");
    expect(out).toContain("deep@example.com");
    expect(out).toContain("three@example.com");
    expect(out).toContain("mem_2");
  });
});

describe("presigned Blob URLs never reach a log line (MCP attach A19)", () => {
  const urls = [
    { method: "PUT", url: "https://vercel.com/api/blob/?pathname=dev%2Foriginals%2Fm%2Fx.jpg&vercel-blob-delegation=SENTRYTEST_D&vercel-blob-signature=SENTRYTEST_S&vercel-blob-maximum-size-in-bytes=10" },
    { method: "GET", url: "https://test.private.blob.vercel-storage.com/dev/originals/m/x.jpg?vercel-blob-delegation=SENTRYTEST_D&vercel-blob-signature=SENTRYTEST_S" },
  ];

  it.each(urls)("Pino redacts a $method presignedUrl at the top level and up to three levels down", ({ url }) => {
    const { sink, lines } = capture();
    const log = buildLogger({ destination: sink, level: "info" });
    log.info({ presignedUrl: url, upload: { presignedUrl: url }, result: { upload: { presignedUrl: url } }, a: { b: { upload: { presignedUrl: url } } }, mediaId: "med_1" }, "upload ready");
    const out = lines().join("\n");
    expect(out).not.toContain("SENTRYTEST_");
    expect(JSON.parse(lines()[0]!)).toMatchObject({
      presignedUrl: "[Redacted]",
      upload: { presignedUrl: "[Redacted]" },
      result: { upload: { presignedUrl: "[Redacted]" } },
      a: { b: { upload: { presignedUrl: "[Redacted]" } } },
      mediaId: "med_1",
      msg: "upload ready",
    });
  });

  it.each(urls)("redactPii filters a $method presignedUrl in nested Sentry extra", ({ url }) => {
    const out = redactPii({ mediaId: "med_1", presignedUrl: url, a: { b: { c: { uploads: [{ presignedUrl: url }] } } } });
    expect(out).toEqual({ mediaId: "med_1", presignedUrl: "[Redacted]", a: { b: { c: { uploads: [{ presignedUrl: "[Redacted]" }] } } } });
  });
});

describe("contributor content is allowed in logs (R13)", () => {
  it("retains note, relationship, place, date and filename but redacts the claim link", () => {
    const input = { memoryId: "m1", note: "example words", relationship: "aunt", place: "Example Lake", approxDateText: "1998", originalFilename: "IMG_1.jpg", claimLink: "https://www.example.com/m/SENTRYTEST_example", contributorNote: "also words", nested: { note: "deep" } };
    expect(redactPii(input)).toEqual({ ...input, claimLink: "[Redacted]" });
  });
});

describe("photo coordinates are allowed in logs (R13 supersedes B8, C44)", () => {
  // Synthetic coordinates; contributor content is allowed under R13.
  const LAT = 12.345678;
  const LON = 23.456789;

  it("Pino records latitude and longitude at the top level and up to three levels down", () => {
    const { sink, lines } = capture();
    const log = buildLogger({ destination: sink, level: "info" });
    log.info(
      {
        latitude: LAT,
        longitude: LON,
        coordinates: { latitude: LAT, longitude: LON },
        media: { gps: { latitude: LAT, longitude: LON } },
        a: { b: { point: { latitude: LAT, longitude: LON } } },
        mediaId: "med_1",
      },
      "gps"
    );
    const out = lines().join("\n");
    expect(out).toContain("12.345678");
    expect(out).toContain("23.456789");
    expect(out).toContain("med_1");
    const parsed = JSON.parse(lines()[0]!) as Record<string, Record<string, unknown>>;
    expect(parsed.latitude).toBe(LAT);
    expect(parsed.coordinates!.longitude).toBe(LON);
  });

  it("redactPii (Sentry extra) retains them at any depth", () => {
    const out = redactPii({ mediaId: "med_1", latitude: LAT, longitude: LON, deep: { er: { still: { point: { latitude: LAT, longitude: LON } } } } });
    expect(JSON.stringify(out)).toContain("12.345678");
    expect(JSON.stringify(out)).toContain("23.456789");
    expect((out as Record<string, unknown>).latitude).toBe(LAT);
    expect((out as Record<string, unknown>).mediaId).toBe("med_1");
  });
});

describe("R13 bearer-only redaction", () => {
  const contributor = {
    email: "alice@example.com", recipientEmail: "bob@example.com", name: "Alice Example", phone: "+15555550123",
    note: "Example story", contributorNote: "Example correction", relationship: "friend", place: "Example Lake",
    approxDateText: "2001", originalFilename: "example.jpg", latitude: 12.345678, longitude: 23.456789,
  };
  const bearer = { claimLink: "SENTRYTEST_x", presignedUrl: "SENTRYTEST_x", shareUrl: "SENTRYTEST_x", token: "SENTRYTEST_x", inviteToken: "SENTRYTEST_x" };
  const filteredBearer = Object.fromEntries(Object.keys(bearer).map((key) => [key, "[Redacted]"]));
  const headers = Object.fromEntries(SECRET_HEADER_KEYS.map((key) => [key, "SENTRYTEST_x"]));
  const filteredHeaders = Object.fromEntries(SECRET_HEADER_KEYS.map((key) => [key, "[Redacted]"]));

  it("keeps every contributor field and redacts every bearer key at each supported Pino depth", () => {
    const { sink, lines } = capture();
    const log = buildLogger({ destination: sink, level: "info" });
    const fields = { ...contributor, ...bearer };
    const expected = { ...contributor, ...filteredBearer };
    const input = { ...fields, nested: fields, a: { b: fields }, x: { y: { z: fields } }, headers, req: { headers }, request: { headers } };
    log.info(input, "invite created");
    expect(JSON.parse(lines()[0]!)).toMatchObject({ ...expected, nested: expected, a: { b: expected }, x: { y: { z: expected } }, headers: filteredHeaders, req: { headers: filteredHeaders }, request: { headers: filteredHeaders } });
    expect(lines().join("\n")).not.toContain("SENTRYTEST_");
    expect(input.token).toBe("SENTRYTEST_x");
  });

  it("redactPii follows the same bearer/header set through nested arrays in Sentry extra", () => {
    const fields = { ...contributor, ...bearer, headers };
    const expected = { ...contributor, ...filteredBearer, headers: filteredHeaders };
    expect(redactPii({ ...fields, nested: [{ deep: fields }] })).toEqual({ ...expected, nested: [{ deep: expected }] });
  });
});


describe("shared bearer-field inventory (NIT4)", () => {
  it.each([...SECRET_FIELD_KEYS.filter((key) => key !== "key"), "token"])("redacts %s in Pino and Sentry extra at every supported depth", (field) => {
    const { sink, lines } = capture();
    const log = buildLogger({ destination: sink, level: "info" });
    const secret = { [field]: field === "claimTokens" ? ["SENTRYTEST_x"] : "SENTRYTEST_x", email: "alice@example.com" };
    const safe = { [field]: "[Redacted]", email: "alice@example.com" };
    const input = { ...secret, a: secret, b: { c: secret }, d: { e: { f: secret } } };
    const expected = { ...safe, a: safe, b: { c: safe }, d: { e: { f: safe } } };
    log.info(input, "bearer fixture");
    expect(JSON.parse(lines()[0]!)).toMatchObject(expected);
    expect(redactPii(input)).toEqual(expected);
    expect(lines().join("\n")).not.toContain("SENTRYTEST_");
  });

  it("keeps the audited non-secret environment-variable key field", () => {
    // server/config/env.ts: lenientPositiveInt logs the setting's name, not its value.
    const fields = { key: "OUTBOUND_DAILY_CAP", fallback: 300 };
    const { sink, lines } = capture();
    buildLogger({ destination: sink, level: "info" }).warn(fields, "invalid setting");
    expect(JSON.parse(lines()[0]!)).toMatchObject(fields);
    expect(redactPii(fields)).toEqual(fields);
  });
});
