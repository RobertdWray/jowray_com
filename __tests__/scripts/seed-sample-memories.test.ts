import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { assertLoopback, parseSample } from "@/scripts/seed-sample-memories";

describe("seed-sample-memories (plan 2026-11-08 finding #14: local databases only)", () => {
  it.each(["postgresql://postgres@127.0.0.1:54329/db", "postgresql://u:p@localhost/db", "postgresql://u@[::1]:5432/db"])("accepts the loopback host in %s", (url) => {
    expect(() => assertLoopback(url)).not.toThrow();
  });

  it.each([
    "postgresql://u:p@ep-cool-name-123.us-east-1.aws.neon.tech/neondb?sslmode=require",
    "postgresql://u@10.0.0.5/db",
    "postgresql://u@127.0.0.1.evil.example/db",
    "postgresql://u@localhost.example.com/db",
  ])("refuses %s", (url) => {
    expect(() => assertLoopback(url)).toThrow(/refusing host/);
  });

  it("parses the canvas seed as data: 100 invented memories, 23 places", () => {
    const data = parseSample(readFileSync(new URL("../../design/reference/see-memories/data/memories.js", import.meta.url), "utf8"));
    expect(data.memories).toHaveLength(100);
    expect(data.places).toHaveLength(23);
    expect(data.memories[0]).toMatchObject({ id: "m001", type: "TEXT" });
  });
});
