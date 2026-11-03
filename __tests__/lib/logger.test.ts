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
