import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getUploadEnv } from "@/server/config/env";

/**
 * An upload ticket binds one Media row to one Blob pathname, MIME type and
 * size limit for 15 minutes. It is minted by `createMemory()` /
 * `createUploadTicket()` and verified by `/api/upload` (token exchange) and
 * `finalizeUpload()`. The signature is HMAC-SHA256 over canonical JSON of
 * the claims (fixed key order), keyed by UPLOAD_TICKET_SECRET.
 */

export const TICKET_TTL_MS = 15 * 60 * 1000;

export interface TicketClaims {
  mediaId: string;
  memoryId: string;
  pathname: string;
  mimeType: string;
  maxBytes: number;
  /** Epoch milliseconds. Also used as the client token's `validUntil`. */
  expiresAt: number;
}

export interface UploadTicket extends TicketClaims {
  sig: string;
}

export type TicketVerification =
  | { ok: true; claims: TicketClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

const CLAIM_KEYS = ["mediaId", "memoryId", "pathname", "mimeType", "maxBytes", "expiresAt"] as const;

function canonical(claims: TicketClaims): string {
  const ordered: Record<string, unknown> = {};
  for (const key of CLAIM_KEYS) {
    ordered[key] = claims[key];
  }
  return JSON.stringify(ordered);
}

function sign(claims: TicketClaims): string {
  return createHmac("sha256", getUploadEnv().UPLOAD_TICKET_SECRET).update(canonical(claims)).digest("hex");
}

export function mintUploadTicket(
  claims: Omit<TicketClaims, "expiresAt">,
  options: { now?: number } = {}
): UploadTicket {
  const full: TicketClaims = { ...claims, expiresAt: (options.now ?? Date.now()) + TICKET_TTL_MS };
  return { ...full, sig: sign(full) };
}

function isClaims(value: unknown): value is UploadTicket {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.mediaId === "string" &&
    typeof v.memoryId === "string" &&
    typeof v.pathname === "string" &&
    typeof v.mimeType === "string" &&
    typeof v.maxBytes === "number" &&
    Number.isFinite(v.maxBytes) &&
    typeof v.expiresAt === "number" &&
    Number.isFinite(v.expiresAt) &&
    typeof v.sig === "string"
  );
}

export function verifyUploadTicket(ticket: UploadTicket, now: number = Date.now()): TicketVerification {
  if (!isClaims(ticket)) {
    return { ok: false, reason: "malformed" };
  }
  const claims: TicketClaims = {
    mediaId: ticket.mediaId,
    memoryId: ticket.memoryId,
    pathname: ticket.pathname,
    mimeType: ticket.mimeType,
    maxBytes: ticket.maxBytes,
    expiresAt: ticket.expiresAt,
  };
  const expected = Buffer.from(sign(claims), "hex");
  const given = Buffer.from(ticket.sig, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad_signature" };
  }
  if (claims.expiresAt <= now) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, claims };
}

/** Parse a ticket that arrived as a JSON string (clientPayload); never throws. */
export function parseTicket(raw: string | null | undefined): UploadTicket | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isClaims(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
