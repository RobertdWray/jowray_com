import { beforeEach, describe, expect, it } from "vitest";

import { mintUploadTicket, verifyUploadTicket, type UploadTicket } from "@/lib/upload-ticket";
import { resetEnvCache } from "@/server/config/env";

const claims = {
  mediaId: "med_1",
  memoryId: "mem_1",
  pathname: "originals/mem_1/abc.m4a",
  mimeType: "audio/mp4",
  maxBytes: 100 * 1024 * 1024,
};

beforeEach(() => {
  process.env.UPLOAD_TICKET_SECRET = "s".repeat(32);
  process.env.DAILY_MEMORY_BUDGET = "200";
  process.env.DAILY_BYTE_BUDGET = String(20 * 1024 ** 3);
  resetEnvCache();
});

describe("upload tickets", () => {
  it("mints a ticket with a 15-minute expiry in epoch ms and verifies it", () => {
    const before = Date.now();
    const ticket = mintUploadTicket(claims);
    expect(ticket.expiresAt).toBeGreaterThanOrEqual(before + 15 * 60_000 - 5);
    expect(ticket.expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 60_000 + 5);
    expect(ticket.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyUploadTicket(ticket)).toEqual({ ok: true, claims: { ...claims, expiresAt: ticket.expiresAt } });
  });

  it("rejects a tampered field", () => {
    const ticket = mintUploadTicket(claims);
    const tampered: UploadTicket = { ...ticket, maxBytes: 999 * 1024 * 1024 };
    expect(verifyUploadTicket(tampered)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyUploadTicket({ ...ticket, pathname: "originals/other/x.m4a" })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects an expired ticket", () => {
    const ticket = mintUploadTicket(claims, { now: Date.now() - 16 * 60_000 });
    expect(verifyUploadTicket(ticket)).toEqual({ ok: false, reason: "expired" });
  });

  it("is independent of key order (canonical JSON)", () => {
    const ticket = mintUploadTicket(claims);
    const reordered = JSON.parse(JSON.stringify(ticket, Object.keys(ticket).sort().reverse())) as UploadTicket;
    expect(verifyUploadTicket(reordered).ok).toBe(true);
  });

  it("rejects garbage without throwing", () => {
    expect(verifyUploadTicket({} as UploadTicket)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyUploadTicket(null as unknown as UploadTicket)).toEqual({ ok: false, reason: "malformed" });
  });
});
