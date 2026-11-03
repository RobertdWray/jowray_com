import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { buildLogger } from "@/lib/logger";

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

  it("createLogger adds the child context to every line", () => {
    const { sink, lines } = capture();
    const log = buildLogger({ destination: sink, level: "info" });
    log.child({ service: "upload" }).info({ action: "ticket" }, "minted");
    const parsed = JSON.parse(lines()[0]) as Record<string, unknown>;
    expect(parsed.service).toBe("upload");
    expect(parsed.action).toBe("ticket");
  });
});
