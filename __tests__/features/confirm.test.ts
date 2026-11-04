import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { resetEnvCache } from "@/server/config/env";

const TOKEN = "t".repeat(43);
interface MediaRow { id: string; status: "PENDING" | "READY" | "FAILED"; mimeType: string; originalFilename: string | null; durationSeconds: number | null; deletedAt?: Date | null; createdAt?: Date }
interface MemoryRow {
  id: string;
  type: "VOICE" | "VIDEO" | "PHOTO" | "TEXT";
  deletedAt: Date | null;
  claimTokenHash: string;
  contributorNote: string | null;
  approxDateText: string | null;
  place: string | null;
  contributor: { name: string | null; email: string | null; relationship: string | null } | null;
  media: MediaRow[];
  uploadLeaseUntil?: Date | null;
}
let memory: MemoryRow | null = null;
const emailUpdateMock = vi.fn(async (_arg: unknown) => ({ count: 1 }));
const dbStub = {
  memory: {
    findUnique: vi.fn(async ({ include }: { include?: { media?: { where?: { deletedAt?: null } } } } = {}) =>
      memory && include?.media?.where && "deletedAt" in include.media.where ? { ...memory, media: memory.media.filter((m) => (m.deletedAt ?? null) === null) } : memory),
    update: vi.fn(async ({ data }: { data: Partial<MemoryRow> }) => { Object.assign(memory!, data); return memory; }),
  },
  emailLog: { updateMany: (arg: unknown) => emailUpdateMock(arg) },
  $queryRaw: vi.fn(async () => [{ id: "mem_1" }]),
  $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(dbStub)),
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));
const sendMock = vi.fn(async (_arg: unknown): Promise<{ sent: boolean; messageId?: string; skipped?: string }> => ({ sent: true, messageId: "m1" }));
vi.mock("@/services/email", () => ({ sendMemoryConfirmation: (arg: unknown) => sendMock(arg) }));

import { completeSubmission, confirmMemory } from "@/features/memories/confirm";

function readyPhoto(over: Partial<MediaRow> = {}): MediaRow {
  return { id: "med_1", status: "READY", mimeType: "image/jpeg", originalFilename: "IMG_0001.jpg", durationSeconds: null, createdAt: new Date(Date.now() - 60 * 60_000), ...over };
}

beforeEach(() => {
  memory = {
    id: "mem_1",
    type: "PHOTO",
    deletedAt: null,
    claimTokenHash: hashClaimToken(TOKEN),
    contributorNote: null,
    approxDateText: "Summer 1985",
    place: "her classroom",
    contributor: { name: "Jo", email: "jo@example.com", relationship: "former student" },
    media: [readyPhoto()],
    uploadLeaseUntil: null,
  };
  emailUpdateMock.mockClear();
  sendMock.mockClear();
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.jowray.com";
  process.env.CONSENT_VERSION = "2026-11-v1";
  process.env.MEMORIAL_SLUG = "jo";
  resetEnvCache();
});

describe("confirmMemory", () => {
  it("sends the confirmation with the claim link, the contributor's details and what was received", async () => {
    memory!.contributorNote = "She once taught me to quilt.";
    const result = await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN });
    expect(result).toEqual({ sent: true, messageId: "m1" });
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      memoryId: "mem_1",
      to: "jo@example.com",
      name: "Jo",
      relationship: "former student",
      approxDateText: "Summer 1985",
      place: "her classroom",
      note: "She once taught me to quilt.",
      media: [{ kind: "PHOTO", originalFilename: "IMG_0001.jpg", durationSeconds: null, preview: null }],
      claimLink: `https://www.jowray.com/m/${TOKEN}`,
    }));
    const arg = sendMock.mock.calls[0]?.[0] as unknown as { rotateToClaimTokenHash?: string };
    expect(arg.rotateToClaimTokenHash).toBeUndefined();
  });

  it("lists only READY files, in upload order, with their kind and duration", async () => {
    memory!.type = "VOICE";
    memory!.media = [
      readyPhoto({ id: "a", mimeType: "audio/mp4", originalFilename: "voice.m4a", durationSeconds: 134 }),
      readyPhoto({ id: "b", status: "PENDING", mimeType: "video/mp4" }),
      readyPhoto({ id: "c", mimeType: "video/quicktime", originalFilename: "clip.mov" }),
    ];
    await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN });
    const arg = sendMock.mock.calls[0]?.[0] as unknown as { media: Array<{ kind: string; originalFilename: string | null; durationSeconds: number | null }> };
    expect(arg.media).toEqual([
      { kind: "VOICE", originalFilename: "voice.m4a", durationSeconds: 134, preview: null },
      { kind: "VIDEO", originalFilename: "clip.mov", durationSeconds: null, preview: null },
    ]);
  });

  it("skips when there is no email, when the memory is deleted, missing, or has no READY file", async () => {
    memory!.contributor = { name: "Jo", email: null, relationship: null };
    expect(await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).toEqual({ sent: false, skipped: "no_email" });
    memory!.contributor = { name: "Jo", email: "jo@example.com", relationship: null };
    memory!.media = [readyPhoto({ status: "PENDING" })];
    expect(await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).toEqual({ sent: false, skipped: "not_ready" });
    memory!.deletedAt = new Date();
    expect(await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).toEqual({ sent: false, skipped: "deleted" });
    memory = null;
    expect(await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).toEqual({ sent: false, skipped: "not_found" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("a TEXT memory needs no file", async () => {
    memory!.type = "TEXT"; memory!.media = []; memory!.contributorNote = "words";
    expect((await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).sent).toBe(true);
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ media: [], note: "words" }));
  });

  it("rejects a claim token that does not belong to the memory", async () => {
    expect(await confirmMemory({ memoryId: "mem_1", claimToken: "x".repeat(43) })).toEqual({ sent: false, skipped: "not_found" });
  });

  it("without a raw token (cron path) it rotates the token and emails the new link", async () => {
    const before = memory!.claimTokenHash;
    const result = await confirmMemory({ memoryId: "mem_1" });
    expect(result.sent).toBe(true);
    const arg = sendMock.mock.calls[0]?.[0] as unknown as { claimLink: string; rotateToClaimTokenHash?: string };
    const newToken = arg.claimLink.split("/m/")[1]!;
    expect(arg.rotateToClaimTokenHash).toBe(hashClaimToken(newToken));
    expect(arg.rotateToClaimTokenHash).not.toBe(before);
  });

  it("does not rotate the token when the email service skips or fails (cron path)", async () => {
    const before = memory!.claimTokenHash;
    sendMock.mockResolvedValueOnce({ sent: false, skipped: "recipient_capped" } as never);
    expect(await confirmMemory({ memoryId: "mem_1" })).toEqual({ sent: false, skipped: "recipient_capped" });
    sendMock.mockRejectedValueOnce(new Error("sendgrid down"));
    await expect(confirmMemory({ memoryId: "mem_1" })).rejects.toThrow("sendgrid down");
    expect(memory!.claimTokenHash).toBe(before);
    expect(dbStub.memory.update).not.toHaveBeenCalled();
  });

  it("passes through the email service's skip reasons", async () => {
    sendMock.mockResolvedValueOnce({ sent: false, skipped: "already_sent" } as never);
    expect(await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).toEqual({ sent: false, skipped: "already_sent" });
  });
});

describe("rotation bookkeeping and note-only eligibility", () => {
  it("hands the rotated hash to the email service instead of persisting it separately", async () => {
    const before = memory!.claimTokenHash;
    const result = await confirmMemory({ memoryId: "mem_1" });
    expect(result.sent).toBe(true);
    expect(dbStub.memory.update).not.toHaveBeenCalled();
    const arg = sendMock.mock.calls[0]?.[0] as unknown as { claimLink: string; rotateToClaimTokenHash?: string };
    const newToken = arg.claimLink.split("/m/")[1]!;
    expect(arg.rotateToClaimTokenHash).toBe(hashClaimToken(newToken));
    expect(arg.rotateToClaimTokenHash).not.toBe(before);
  });

  it("confirms a memory whose file failed but whose note exists", async () => {
    memory!.media = [readyPhoto({ status: "FAILED" })];
    memory!.contributorNote = "the words were saved";
    expect((await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).sent).toBe(true);
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ media: [], note: "the words were saved" }));
  });
});

describe("removed files", () => {
  it("does not count a removed READY file as something to confirm", async () => {
    memory!.media = [readyPhoto({ deletedAt: new Date() })];
    expect(await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).toEqual({ sent: false, skipped: "not_ready" });
    memory!.media = [readyPhoto({ id: "med_gone", deletedAt: new Date() }), readyPhoto({ id: "med_live", deletedAt: null })];
    expect((await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).sent).toBe(true);
    const arg = sendMock.mock.calls.at(-1)?.[0] as unknown as { media: unknown[] };
    expect(arg.media).toHaveLength(1);
  });
});

describe("multi-file submissions", () => {
  it("waits while a file of this submission is still on its way, unless the submission is being settled", async () => {
    memory!.media = [readyPhoto(), { id: "med_2", status: "PENDING", mimeType: "image/jpeg", originalFilename: "b.jpg", durationSeconds: null, createdAt: new Date() }];
    expect(await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).toEqual({ sent: false, skipped: "not_ready" });
    expect((await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN, settleNow: true })).sent).toBe(true);
    const arg = sendMock.mock.calls.at(-1)?.[0] as unknown as { media: unknown[] };
    expect(arg.media).toHaveLength(1);
  });

  it("does not wait for a reservation older than the ticket lifetime (abandoned upload)", async () => {
    memory!.media = [readyPhoto(), { id: "med_2", status: "PENDING", mimeType: "image/jpeg", originalFilename: "b.jpg", durationSeconds: null, createdAt: new Date(Date.now() - 16 * 60_000) }];
    expect((await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).sent).toBe(true);
  });

  it("the cron path never sends while the submission lease is open, so it cannot rotate a link still in use", async () => {
    memory!.uploadLeaseUntil = new Date(Date.now() + 10 * 60_000);
    expect(await confirmMemory({ memoryId: "mem_1" })).toEqual({ sent: false, skipped: "leased" });
    memory!.uploadLeaseUntil = new Date(Date.now() - 1_000);
    expect((await confirmMemory({ memoryId: "mem_1" })).sent).toBe(true);
  });

  it("completeSubmission closes the lease and sends with the raw token (no rotation), ignoring young reservations", async () => {
    memory!.uploadLeaseUntil = new Date(Date.now() + 60 * 60_000);
    memory!.media = [readyPhoto(), { id: "med_2", status: "PENDING", mimeType: "image/jpeg", originalFilename: "b.jpg", durationSeconds: null, createdAt: new Date() }];
    const result = await completeSubmission({ claimToken: TOKEN });
    expect(result.sent).toBe(true);
    expect(memory!.uploadLeaseUntil).toBeNull();
    const arg = sendMock.mock.calls.at(-1)?.[0] as unknown as { claimLink: string; rotateToClaimTokenHash?: string };
    expect(arg.claimLink.endsWith(`/m/${TOKEN}`)).toBe(true);
    expect(arg.rotateToClaimTokenHash).toBeUndefined();
    expect(await completeSubmission({ claimToken: "x".repeat(43) })).toEqual({ sent: false, skipped: "not_found" });
  });
});
