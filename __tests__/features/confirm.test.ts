import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { resetEnvCache } from "@/server/config/env";

const TOKEN = "t".repeat(43);
interface MediaRow { id: string; status: "PENDING" | "READY" | "FAILED"; mimeType: string; originalFilename: string | null; durationSeconds: number | null }
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
}
let memory: MemoryRow | null = null;
const emailUpdateMock = vi.fn(async (_arg: unknown) => ({ count: 1 }));
const dbStub = {
  memory: {
    findUnique: vi.fn(async () => memory),
    update: vi.fn(async ({ data }: { data: { claimTokenHash: string } }) => { memory!.claimTokenHash = data.claimTokenHash; return memory; }),
  },
  emailLog: { updateMany: (arg: unknown) => emailUpdateMock(arg) },
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));
const sendMock = vi.fn(async (_arg: unknown): Promise<{ sent: boolean; messageId?: string; skipped?: string }> => ({ sent: true, messageId: "m1" }));
vi.mock("@/services/email", () => ({ sendMemoryConfirmation: (arg: unknown) => sendMock(arg) }));

import { confirmMemory } from "@/features/memories/confirm";

function readyPhoto(over: Partial<MediaRow> = {}): MediaRow {
  return { id: "med_1", status: "READY", mimeType: "image/jpeg", originalFilename: "IMG_0001.jpg", durationSeconds: null, ...over };
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
