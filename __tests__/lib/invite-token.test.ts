import { describe, expect, it } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { hashInviteToken, INVITE_TOKEN_PATTERN, isInviteToken, newInviteToken } from "@/lib/invite-token";

describe("invite tokens", () => {
  it("generates 12-character base64url tokens with no collisions in 10,000 samples", () => {
    const tokens = Array.from({ length: 10_000 }, () => newInviteToken());
    for (const token of tokens) {
      expect(token).toHaveLength(12);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token).toMatch(INVITE_TOKEN_PATTERN);
    }
    expect(new Set(tokens).size).toBe(10_000);
  });

  it("uses the shared SHA-256 hex hash", () => {
    const token = newInviteToken();
    expect(hashInviteToken(token)).toBe(hashClaimToken(token));
    expect(hashInviteToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts generated tokens and both URL-safe punctuation characters", () => {
    expect(isInviteToken(newInviteToken())).toBe(true);
    expect(isInviteToken("Ab01234567_-")).toBe(true);
  });

  it.each([
    "", "a".repeat(11), "a".repeat(13),
    "a".repeat(11) + "+", "a".repeat(11) + "/", "a".repeat(11) + "=",
    "a".repeat(11) + " ", " " + "a".repeat(12),
  ])("rejects malformed token %j", (token) => {
    expect(isInviteToken(token)).toBe(false);
  });
});
