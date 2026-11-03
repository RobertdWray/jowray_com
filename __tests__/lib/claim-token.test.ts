import { describe, expect, it } from "vitest";

import { hashClaimToken, newClaimToken, safeEqualHex } from "@/lib/claim-token";

describe("claim tokens", () => {
  it("mints 32 random bytes as base64url", () => {
    const a = newClaimToken();
    const b = newClaimToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("hashes to 64 lower-case hex characters, deterministically", () => {
    const t = newClaimToken();
    expect(hashClaimToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashClaimToken(t)).toBe(hashClaimToken(t));
    expect(hashClaimToken(t)).not.toBe(hashClaimToken(newClaimToken()));
  });

  it("safeEqualHex compares without throwing on unequal lengths", () => {
    const h = hashClaimToken("x");
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, h.slice(0, 10))).toBe(false);
    expect(safeEqualHex("", h)).toBe(false);
    expect(safeEqualHex(h, h.toUpperCase())).toBe(false);
  });
});
