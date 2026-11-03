import { createHmac } from "node:crypto";

import { getPayloadFromClientToken } from "@vercel/blob/client";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mintUploadTicket } from "@/lib/upload-ticket";
import { resetEnvCache } from "@/server/config/env";

const RW_TOKEN = "vercel_blob_rw_storeid_secretsecretsecret";

interface MediaRow { id: string; status: "PENDING" | "READY"; deletedAt: Date | null; memory: { deletedAt: Date | null } }
let media: MediaRow[] = [];
const events: Record<string, unknown>[] = [];
const dbStub = {
  media: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => media.find((m) => m.id === where.id) ?? null) },
  webhookEvent: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return { id: "evt_1", ...data }; }), update: vi.fn(async (_arg: unknown) => ({})) },
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));
const recordMediaMock = vi.fn(async (_arg: { mediaId: string }) => ({ status: "READY", mediaId: "med_1", memoryId: "mem_1", sizeBytes: 5 }));
vi.mock("@/features/memories/ingest-upload", () => ({ recordMedia: (arg: { mediaId: string }) => recordMediaMock(arg) }));
const afterCalls: Array<() => Promise<void>> = [];
vi.mock("@/lib/sentry/after-flush", () => ({ afterWithFlush: (cb: () => Promise<void>) => { afterCalls.push(cb); } }));

import { POST } from "@/app/api/upload/route";

const claims = { mediaId: "med_1", memoryId: "mem_1", pathname: "originals/mem_1/abc.m4a", mimeType: "audio/mp4", maxBytes: 100 * 1024 * 1024 };

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const raw = JSON.stringify(body);
  const req = new NextRequest("http://localhost:3000/api/upload", { method: "POST", body: raw, headers: { "content-type": "application/json", ...headers } });
  return POST(req);
}

function tokenRequest(ticketOverride?: Record<string, unknown>, pathname = claims.pathname) {
  const ticket = { ...mintUploadTicket(claims), ...ticketOverride };
  return post({ type: "blob.generate-client-token", payload: { pathname, callbackUrl: "http://localhost:3000/api/upload", clientPayload: JSON.stringify(ticket), multipart: true } });
}

beforeEach(() => {
  media = [{ id: "med_1", status: "PENDING", deletedAt: null, memory: { deletedAt: null } }];
  events.length = 0; afterCalls.length = 0; recordMediaMock.mockClear();
  process.env.BLOB_READ_WRITE_TOKEN = RW_TOKEN;
  process.env.UPLOAD_TICKET_SECRET = "s".repeat(32);
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.jowray.com";
  resetEnvCache();
});

describe("POST /api/upload (token exchange)", () => {
  it("issues a client token scoped to the ticket", async () => {
    const res = await tokenRequest();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; clientToken: string };
    expect(body.type).toBe("blob.generate-client-token");
    const payload = getPayloadFromClientToken(body.clientToken) as Record<string, unknown>;
    expect(payload.pathname).toBe(claims.pathname);
    expect(payload.allowedContentTypes).toEqual(["audio/mp4"]);
    expect(payload.maximumSizeInBytes).toBe(claims.maxBytes);
    expect(payload.addRandomSuffix).toBe(false);
    expect(payload.allowOverwrite).toBe(false);
    expect(typeof payload.validUntil).toBe("number");
    expect((payload.onUploadCompleted as { callbackUrl: string; tokenPayload: string }).callbackUrl).toBe("https://www.jowray.com/api/upload");
    expect((payload.onUploadCompleted as { tokenPayload: string }).tokenPayload).toBe(JSON.stringify({ mediaId: "med_1" }));
  });

  it("gives the Blob token a transfer lifetime well beyond the 15-minute ticket exchange window", async () => {
    const ticket = mintUploadTicket(claims);
    const res = await post({ type: "blob.generate-client-token", payload: { pathname: claims.pathname, clientPayload: JSON.stringify(ticket), multipart: false } });
    const body = (await res.json()) as { clientToken: string };
    const validUntil = (getPayloadFromClientToken(body.clientToken) as { validUntil: number }).validUntil;
    expect(validUntil).toBeGreaterThanOrEqual(ticket.expiresAt + 45 * 60_000); // ≥ 60 min total
    expect(validUntil).toBeLessThanOrEqual(Date.now() + 2 * 60 * 60_000);
  });

  it("rejects a tampered ticket, an expired ticket, a pathname mismatch, a missing ticket, and a non-PENDING row", async () => {
    expect((await tokenRequest({ maxBytes: 1 })).status).toBe(403);
    expect((await tokenRequest({ expiresAt: Date.now() - 1, sig: mintUploadTicket(claims, { now: Date.now() - 20 * 60_000 }).sig })).status).toBe(403);
    expect((await tokenRequest(undefined, "originals/other/abc.m4a")).status).toBe(403);
    expect((await post({ type: "blob.generate-client-token", payload: { pathname: claims.pathname, clientPayload: null, multipart: false } })).status).toBe(403);
    media[0]!.status = "READY";
    expect((await tokenRequest()).status).toBe(403);
  });
});

describe("POST /api/upload (upload completed callback)", () => {
  it("records the event and schedules recordMedia for a correctly signed body", async () => {
    const body = JSON.stringify({ type: "blob.upload-completed", payload: { blob: { url: "https://blob.test/originals/mem_1/abc.m4a", downloadUrl: "https://blob.test/x", pathname: claims.pathname, contentType: "audio/mp4", contentDisposition: "inline" }, tokenPayload: JSON.stringify({ mediaId: "med_1" }) } });
    const signature = createHmac("sha256", RW_TOKEN).update(body).digest("hex");
    const req = new NextRequest("http://localhost:3000/api/upload", { method: "POST", body, headers: { "content-type": "application/json", "x-vercel-signature": signature } });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(events[0]).toMatchObject({ provider: "vercel-blob", kind: "upload_completed" });
    expect(afterCalls).toHaveLength(1);
    await afterCalls[0]!();
    expect(recordMediaMock).toHaveBeenCalledWith({ mediaId: "med_1" });
  });

  it("leaves the event unprocessed when the blob is not visible yet, and abandons payloads without a mediaId", async () => {
    recordMediaMock.mockResolvedValueOnce({ status: "PENDING", mediaId: "med_1", memoryId: "mem_1" } as never);
    const body = JSON.stringify({ type: "blob.upload-completed", payload: { blob: { url: "u", downloadUrl: "d", pathname: claims.pathname, contentType: "audio/mp4", contentDisposition: "inline" }, tokenPayload: JSON.stringify({ mediaId: "med_1" }) } });
    const signature = createHmac("sha256", RW_TOKEN).update(body).digest("hex");
    await POST(new NextRequest("http://localhost:3000/api/upload", { method: "POST", body, headers: { "content-type": "application/json", "x-vercel-signature": signature } }));
    await afterCalls[0]!();
    const update = dbStub.webhookEvent.update.mock.calls.at(-1)?.[0] as unknown as { data: { processedAt?: Date; error?: string | null } };
    expect(update.data.processedAt).toBeUndefined();

    const body2 = JSON.stringify({ type: "blob.upload-completed", payload: { blob: { url: "u", downloadUrl: "d", pathname: claims.pathname, contentType: "audio/mp4", contentDisposition: "inline" }, tokenPayload: "not json" } });
    const sig2 = createHmac("sha256", RW_TOKEN).update(body2).digest("hex");
    await POST(new NextRequest("http://localhost:3000/api/upload", { method: "POST", body: body2, headers: { "content-type": "application/json", "x-vercel-signature": sig2 } }));
    const update2 = dbStub.webhookEvent.update.mock.calls.at(-1)?.[0] as unknown as { data: { attempts: number } };
    expect(update2.data.attempts).toBeGreaterThanOrEqual(3);
  });

  it("rejects an unsigned callback", async () => {
    const res = await post({ type: "blob.upload-completed", payload: { blob: { url: "u", downloadUrl: "d", pathname: claims.pathname, contentType: "audio/mp4", contentDisposition: "inline" }, tokenPayload: JSON.stringify({ mediaId: "med_1" }) } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(events).toHaveLength(0);
  });
});

describe("cancelled reservations", () => {
  it("refuses a token for a PENDING row the contributor cancelled", async () => {
    media = [{ id: "med_1", status: "PENDING", deletedAt: new Date(), memory: { deletedAt: null } }];
    const res = await tokenRequest();
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_pending");
  });
});
