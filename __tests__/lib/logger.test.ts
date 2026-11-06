import { Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

const captureMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureMock(...a), flush: vi.fn(async () => true) }));

import { buildLogger, logError, redactPii } from "@/lib/logger";

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
  it("never serializes an email address, name or phone", () => {
    const { sink, lines } = capture();
    const log = buildLogger({ destination: sink, level: "info" });
    log.info(
      {
        category: "email",
        email: "person@example.com",
        recipientEmail: "someone@example.org",
        name: "Jo Contributor",
        phone: "+15555550123",
        contributor: { email: "nested@example.net" },
        req: { headers: { cookie: "session=abc", authorization: "Bearer xyz" } },
        memoryId: "mem_1",
      },
      "confirmation queued"
    );
    const out = lines().join("\n");
    expect(out).not.toContain("@");
    expect(out).not.toContain("Jo Contributor");
    expect(out).not.toContain("5555550123");
    expect(out).not.toContain("session=abc");
    expect(out).not.toContain("Bearer xyz");
    expect(out).toContain("mem_1");
    expect(out).toContain("[Redacted]");
  });

  it("redacts two levels down (a Prisma include shape)", () => {
    const { sink, lines } = capture();
    const log = buildLogger({ destination: sink, level: "info" });
    log.info({ memory: { contributor: { email: "deep@example.com", name: "Deep Name" } }, memoryId: "mem_2" }, "shape");
    const out = lines().join("\n");
    expect(out).not.toContain("deep@example.com");
    expect(out).not.toContain("Deep Name");
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
  it("replaces PII keys at any depth and leaves ids alone", () => {
    const out = redactPii({ memoryId: "m1", email: "a@b.c", nested: { deep: { phone: "+1", name: "N", mediaId: "x" } }, list: [{ email: "l@b.c" }] }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(/a@b\.c|\+1|"N"|l@b\.c/);
    expect(out.memoryId).toBe("m1");
    expect((out.nested as { deep: { mediaId: string } }).deep.mediaId).toBe("x");
  });
});

describe("logError", () => {
  it("never forwards PII to Sentry extra", () => {
    captureMock.mockClear();
    logError("boom", new Error("x"), { category: "email", memoryId: "m1", recipientEmail: "p@example.com", contributor: { name: "Jo" } });
    expect(captureMock).toHaveBeenCalledTimes(1);
    const extra = JSON.stringify(captureMock.mock.calls[0]?.[1]);
    expect(extra).not.toContain("p@example.com");
    expect(extra).not.toContain("Jo");
    expect(extra).toContain("m1");
  });
});

describe("logger redaction depth", () => {
  it("redacts two and three levels down", () => {
    const { sink, lines } = capture();
    const log = buildLogger({ destination: sink, level: "info" });
    log.info({ memory: { contributor: { email: "deep@example.com" } }, a: { b: { c: { email: "three@example.com" } } }, memoryId: "mem_2" }, "shape");
    const out = lines().join("\n");
    expect(out).not.toContain("deep@example.com");
    expect(out).not.toContain("three@example.com");
    expect(out).toContain("mem_2");
  });
});

describe("contributor content never reaches a log line", () => {
  it("redacts the note, relationship, place, date, filename and claim link at any depth", () => {
    const out = redactPii({ memoryId: "m1", note: "secret words", relationship: "aunt", place: "Lake George", approxDateText: "1998", originalFilename: "IMG_1.jpg", claimLink: "https://x/m/tok", contributorNote: "also words", nested: { note: "deep" } }) as Record<string, unknown>;
    expect(out.memoryId).toBe("m1");
    for (const key of ["note", "relationship", "place", "approxDateText", "originalFilename", "claimLink", "contributorNote"]) {
      expect(out[key]).toBe("[Redacted]");
    }
    expect((out.nested as Record<string, unknown>).note).toBe("[Redacted]");
  });
});

describe("where a photo was taken never reaches a log line (plan 2026-11-06-photo-gps-places B8, C44)", () => {
  // Statue of Liberty fixture; a real photo's point is contributor content, like `place`.
  const LAT = 40.689247;
  const LON = -74.044502;

  it("Pino redacts latitude and longitude at the top level and up to three levels down", () => {
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
    expect(out).not.toContain("40.689247");
    expect(out).not.toContain("74.044502");
    expect(out).toContain("med_1");
    const parsed = JSON.parse(lines()[0]!) as Record<string, Record<string, unknown>>;
    expect(parsed.latitude).toBe("[Redacted]");
    expect(parsed.coordinates!.longitude).toBe("[Redacted]");
  });

  it("redactPii (Sentry extra) redacts them at any depth", () => {
    const out = redactPii({ mediaId: "med_1", latitude: LAT, longitude: LON, deep: { er: { still: { point: { latitude: LAT, longitude: LON } } } } });
    expect(JSON.stringify(out)).not.toContain("40.689247");
    expect(JSON.stringify(out)).not.toContain("74.044502");
    expect((out as Record<string, unknown>).latitude).toBe("[Redacted]");
    expect((out as Record<string, unknown>).mediaId).toBe("med_1");
  });
});
