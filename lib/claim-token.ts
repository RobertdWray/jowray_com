import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Claim tokens: 32 random bytes, base64url, handed to the contributor in the
 * claim link and the email. The database stores only the SHA-256 hex hash;
 * lookups go through `hashClaimToken` and comparisons through `safeEqualHex`.
 */

export function newClaimToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashClaimToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two hex strings. Both inputs are hashed again
 * before comparing so unequal lengths never throw and never leak length.
 */
export function safeEqualHex(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}
