import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { resetEnvCache } from "@/server/config/env";

const TOKEN = "t".repeat(43);
interface MemoryRow { id: string; type: "VOICE" | "VIDEO" | "PHOTO" | "TEXT"; deletedAt: Date | null; claimTokenHash: string; contributorNote: string | null; contributor: { name: string | null; email: string | null } | null; media: Array<{ status: "PENDING" | "READY" | "FAILED" }> }
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

beforeEach(() => {
  memory = { id: "mem_1", type: "PHOTO", deletedAt: null, claimTokenHash: hashClaimToken(TOKEN), contributorNote: null, contributor: { name: "Jo", email: "jo@example.com" }, media: [{ status: "READY" }] };
  emailUpdateMock.mockClear();
  sendMock.mockClear();
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.jowray.com";
  process.env.CONSENT_VERSION = "2026-11-v1";
  process.env.MEMORIAL_SLUG = "jo";
  resetEnvCache();
});

describe("confirmMemory", () => {
  it("sends the confirmation with the claim link, what was received and the usage sentence", async () => {
    const result = await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN });
    expect(result).toEqual({ sent: true, messageId: "m1" });
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      memoryId: "mem_1",
      to: "jo@example.com",
      name: "Jo",
      received: { type: "PHOTO", fileCount: 1 },
      claimLink: `https://www.jowray.com/m/${TOKEN}`,
      usageSentence: expect.stringMatching(/.+/),
    }));
    expect(dbStub.memory.update).not.toHaveBeenCalled();
  });

  it("skips when there is no email, when the memory is deleted, missing, or has no READY file", async () => {
    memory!.contributor = { name: "Jo", email: null };
    expect(await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).toEqual({ sent: false, skipped: "no_email" });
    memory!.contributor = { name: "Jo", email: "jo@example.com" };
    memory!.media = [{ status: "PENDING" }];
    expect(await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).toEqual({ sent: false, skipped: "not_ready" });
    memory!.deletedAt = new Date();
    expect(await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).toEqual({ sent: false, skipped: "deleted" });
    memory = null;
    expect(await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).toEqual({ sent: false, skipped: "not_found" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("a TEXT memory needs no file", async () => {
    memory!.type = "TEXT"; memory!.media = [];
    expect((await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).sent).toBe(true);
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ received: { type: "TEXT", fileCount: 0 } }));
  });

  it("rejects a claim token that does not belong to the memory", async () => {
    expect(await confirmMemory({ memoryId: "mem_1", claimToken: "x".repeat(43) })).toEqual({ sent: false, skipped: "not_found" });
  });

  it("without a raw token (cron path) it rotates the token and emails the new link", async () => {
    const before = memory!.claimTokenHash;
    const result = await confirmMemory({ memoryId: "mem_1" });
    expect(result.sent).toBe(true);
    expect(dbStub.memory.update).toHaveBeenCalledTimes(1);
    expect(memory!.claimTokenHash).not.toBe(before);
    const arg = sendMock.mock.calls[0]?.[0] as unknown as { claimLink: string };
    const newToken = arg.claimLink.split("/m/")[1]!;
    expect(hashClaimToken(newToken)).toBe(memory!.claimTokenHash);
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
  it("marks the email FAILED when the rotated hash cannot be persisted after a send", async () => {
    dbStub.memory.update.mockRejectedValueOnce(new Error("neon blip"));
    const result = await confirmMemory({ memoryId: "mem_1" });
    expect(result.sent).toBe(false);
    expect(emailUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  });

  it("confirms a memory whose file failed but whose note exists", async () => {
    memory!.media = [{ status: "FAILED" }];
    memory!.contributorNote = "the words were saved";
    expect((await confirmMemory({ memoryId: "mem_1", claimToken: TOKEN })).sent).toBe(true);
  });
});
