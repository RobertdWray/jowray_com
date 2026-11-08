/**
 * Only the hash is stored (R3). The token is a bearer value that must never
 * reach logs, Sentry or analytics (R10).
 */
import { randomBytes } from "node:crypto";

import { hashClaimToken } from "@/lib/claim-token";

export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{12}$/;

export function newInviteToken(): string {
  return randomBytes(9).toString("base64url");
}

export function isInviteToken(value: string): boolean {
  return INVITE_TOKEN_PATTERN.test(value);
}

export function hashInviteToken(token: string): string {
  return hashClaimToken(token);
}
