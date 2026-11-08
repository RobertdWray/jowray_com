import { createHmac } from "node:crypto";

import { getPayloadFromClientToken } from "@vercel/blob/client";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as LoggerModule from "@/lib/logger";
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
const deriveMock = vi.fn(async (_arg: unknown) => ({ WEB_IMAGE: "derived", THUMBNAIL: "derived" }));
vi.mock("@/features/memories/derive-media", () => ({ deriveMedia: (arg: unknown) => deriveMock(arg) }));
const extractGpsMock = vi.fn(async (_arg: unknown) => "found");
vi.mock("@/features/media/extract-photo-gps", () => ({ extractPhotoGps: (arg: unknown) => extractGpsMock(arg) }));
const afterCalls: Array<() => Promise<void>> = [];
/** The task name of each scheduled callback, index for index with afterCalls. */
const afterNames: string[] = [];
vi.mock("@/lib/sentry/after-flush", () => ({ afterWithFlush: (name: string, cb: () => Promise<void>) => { afterNames.push(name); afterCalls.push(cb); } }));
const identifyMock = vi.fn();
const tagIdsMock = vi.fn();
vi.mock("@/lib/sentry/user", () => ({ identifyContributor: (...a: unknown[]) => identifyMock(...a), tagIds: (...a: unknown[]) => tagIdsMock(...a) }));
// Captures the route's warn lines (the real logger is silent under test), so a test can prove what never reaches the logs.
const warnLines: unknown[][] = [];
vi.mock("@/lib/logger", async (importOriginal) => {
  const mod = await importOriginal<typeof LoggerModule>();
  const createLogger: typeof mod.createLogger = (...args) => {
    const real = mod.createLogger(...args);
    const capturing: typeof real = Object.create(real) as typeof real;
    capturing.warn = ((...line: unknown[]) => {
      warnLines.push(line);
    }) as typeof real.warn;
    return capturing;
  };
  return { ...mod, createLogger };
});

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
  events.length = 0; afterCalls.length = 0; afterNames.length = 0; recordMediaMock.mockClear(); deriveMock.mockClear(); extractGpsMock.mockClear();
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

  it("answers 400, not an unhandled error, when the body is not JSON (issue #43: a 500 here became a Sentry error event per request)", async () => {
    for (const raw of ["not json", "", "{"]) {
      const req = new NextRequest("http://localhost:3000/api/upload", { method: "POST", body: raw, headers: { "content-type": "application/json" } });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { code: "invalid_json", message: "The body must be JSON" } });
    }
  });

  it("logs a fixed reason for a malformed body, never the body text (PR #47 review: V8 quotes the raw body in SyntaxError.message)", async () => {
    warnLines.length = 0;
    const fragment = `"sig":"SENTRYTEST_${"a".repeat(32)}"`;
    const req = new NextRequest("http://localhost:3000/api/upload", { method: "POST", body: `{${fragment}`, headers: { "content-type": "application/json" } });
    expect((await POST(req)).status).toBe(400);
    expect(warnLines).toHaveLength(1);
    expect(warnLines[0]?.[0]).toEqual({ action: "invalid_json", reason: "SyntaxError" });
    expect(JSON.stringify(warnLines)).not.toContain("SENTRYTEST_");
    expect(JSON.stringify(warnLines)).not.toContain("sig");
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
    expect(deriveMock).toHaveBeenCalledWith({ mediaId: "med_1", deadlineMs: 15_000 });
  });

  /** A signed upload-completed callback for a blob of `contentType`. */
  async function completed(contentType: string): Promise<void> {
    const body = JSON.stringify({ type: "blob.upload-completed", payload: { blob: { url: "u", downloadUrl: "d", pathname: claims.pathname, contentType, contentDisposition: "inline" }, tokenPayload: JSON.stringify({ mediaId: "med_1" }) } });
    const signature = createHmac("sha256", RW_TOKEN).update(body).digest("hex");
    await POST(new NextRequest("http://localhost:3000/api/upload", { method: "POST", body, headers: { "content-type": "application/json", "x-vercel-signature": signature } }));
  }

  it("schedules the photo GPS step as its own after() task once the photo is recorded, never waited on ahead of the copies (final review, item 3)", async () => {
    deriveMock.mockRejectedValueOnce(new Error("decoder crashed"));
    await completed("image/jpeg");
    expect(extractGpsMock).not.toHaveBeenCalled(); // nothing runs before the response
    await afterCalls[0]!();
    // The callback task records the file and makes the copies; it only schedules the GPS step.
    expect(recordMediaMock).toHaveBeenCalledWith({ mediaId: "med_1" });
    expect(deriveMock).toHaveBeenCalledTimes(1);
    expect(extractGpsMock).not.toHaveBeenCalled();
    expect(afterNames).toEqual(["upload.callback", "upload.callback.photo_gps"]);
    const update = dbStub.webhookEvent.update.mock.calls.at(-1)?.[0] as unknown as { data: { processedAt?: Date; error?: string | null } };
    expect(update.data.processedAt).toBeInstanceOf(Date);
    // Its own task runs it, whatever the copies did.
    await afterCalls[1]!();
    expect(extractGpsMock).toHaveBeenCalledTimes(1);
    expect(extractGpsMock).toHaveBeenCalledWith({ mediaId: "med_1" });
  });

  it.each(["video/quicktime", "video/mp4"])("schedules the GPS task after recording a %s video", async (contentType) => {
    await completed(contentType);
    expect(extractGpsMock).not.toHaveBeenCalled();
    await afterCalls[0]!();
    expect(afterNames).toEqual(["upload.callback", "upload.callback.photo_gps"]);
    expect(extractGpsMock).not.toHaveBeenCalled();
    await afterCalls[1]!();
    expect(extractGpsMock).toHaveBeenCalledExactlyOnceWith({ mediaId: "med_1" });
  });

  // audio/mp4 is an MP4 container with a location reader now (plan 2026-11-08 D16); browser WebM recordings are not.
  it.each(["audio/webm", "video/webm"])("schedules no photo GPS step for a blob of type %s (final review, item 4)", async (contentType) => {
    await completed(contentType);
    await afterCalls[0]!();
    expect(afterNames).toEqual(["upload.callback"]);
    expect(extractGpsMock).not.toHaveBeenCalled();
    expect(deriveMock).toHaveBeenCalledTimes(1);
  });

  it("does not schedule the photo GPS step while the photo is not recorded yet", async () => {
    recordMediaMock.mockResolvedValueOnce({ status: "PENDING", mediaId: "med_1", memoryId: "mem_1" } as never);
    await completed("image/jpeg");
    await afterCalls[0]!();
    expect(afterNames).toEqual(["upload.callback"]);
    expect(extractGpsMock).not.toHaveBeenCalled();
  });

  it("keeps the event processed when the derived copies fail after a successful record", async () => {
    deriveMock.mockRejectedValueOnce(new Error("db hiccup"));
    const body = JSON.stringify({ type: "blob.upload-completed", payload: { blob: { url: "u", downloadUrl: "d", pathname: claims.pathname, contentType: "audio/mp4", contentDisposition: "inline" }, tokenPayload: JSON.stringify({ mediaId: "med_1" }) } });
    const signature = createHmac("sha256", RW_TOKEN).update(body).digest("hex");
    await POST(new NextRequest("http://localhost:3000/api/upload", { method: "POST", body, headers: { "content-type": "application/json", "x-vercel-signature": signature } }));
    await afterCalls[0]!();
    const update = dbStub.webhookEvent.update.mock.calls.at(-1)?.[0] as unknown as { data: { processedAt?: Date; error?: string | null } };
    expect(update.data.processedAt).toBeInstanceOf(Date);
    expect(update.data.error).toBeNull();
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

describe("Sentry tags (plan §8.2)", () => {
  it("the upload-completed callback tags the file it records", async () => {
    tagIdsMock.mockClear();
    const body = JSON.stringify({ type: "blob.upload-completed", payload: { blob: { url: "https://blob.test/originals/mem_1/abc.m4a", downloadUrl: "https://blob.test/x", pathname: claims.pathname, contentType: "audio/mp4", contentDisposition: "inline" }, tokenPayload: JSON.stringify({ mediaId: "med_1" }) } });
    const signature = createHmac("sha256", RW_TOKEN).update(body).digest("hex");
    const res = await POST(new NextRequest("http://localhost:3000/api/upload", { method: "POST", body, headers: { "content-type": "application/json", "x-vercel-signature": signature } }));
    expect(res.status).toBe(200);
    expect(tagIdsMock).toHaveBeenCalledWith({ mediaId: "med_1" });
    expect(identifyMock).not.toHaveBeenCalled();
  });
});
