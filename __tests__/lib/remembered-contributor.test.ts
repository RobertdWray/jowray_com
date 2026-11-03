import { describe, expect, it } from "vitest";

import { parseRemembered, serializeRemembered } from "@/lib/remembered-contributor";

describe("remembered contributor (name, email, how you knew Jo)", () => {
  it("round-trips the three fields", () => {
    const raw = serializeRemembered({ name: "Kay Bartholomew", email: "kay@example.com", relationship: "former student" });
    expect(parseRemembered(raw)).toEqual({ name: "Kay Bartholomew", email: "kay@example.com", relationship: "former student" });
  });

  it("drops empty fields and returns null when nothing is worth remembering", () => {
    expect(serializeRemembered({ name: "  ", email: "", relationship: "" })).toBeNull();
    expect(parseRemembered(serializeRemembered({ name: "Kay", email: "", relationship: " " }))).toEqual({ name: "Kay" });
  });

  it("ignores garbage, wrong shapes and over-long values", () => {
    expect(parseRemembered(null)).toBeNull();
    expect(parseRemembered("not json")).toBeNull();
    expect(parseRemembered(JSON.stringify([1, 2]))).toBeNull();
    expect(parseRemembered(JSON.stringify({ name: 42, email: "a@b.c" }))).toEqual({ email: "a@b.c" });
    expect(parseRemembered(JSON.stringify({ name: "x".repeat(500) }))).toBeNull();
  });
});
