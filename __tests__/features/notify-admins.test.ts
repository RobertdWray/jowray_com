import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/server/config/env";

interface MediaRow { id: string; status: "PENDING" | "READY" | "FAILED"; mimeType: string; originalFilename: string | null; durationSeconds: number | null; deletedAt?: Date | null }
interface MemoryRow {
  id: string;
  type: "VOICE" | "VIDEO" | "PHOTO" | "TEXT";
  status: "DRAFT" | "PENDING" | "APPROVED" | "HIDDEN";
  deletedAt: Date | null;
  createdAt: Date;
  claimTokenHash: string;
  contributorNote: string | null;
  approxDateText: string | null;
  place: string | null;
  visibility: "PUBLIC" | "FAMILY" | "PRIVATE";
  notifyWhenPosted: boolean;
  contributor: { name: string | null; email: string | null; relationship: string | null; contactOptIn: boolean; mailingListOptIn: boolean } | null;
  media: MediaRow[];
}
let memory: MemoryRow | null = null;
const dbStub = {
  memory: {
    findUnique: vi.fn(async ({ include }: { include?: { media?: { where?: { deletedAt?: null } } } } = {}) =>
      memory && include?.media?.where && "deletedAt" in include.media.where ? { ...memory, media: memory.media.filter((m) => (m.deletedAt ?? null) === null) } : memory),
    update: vi.fn(async () => memory),
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));
const sendMock = vi.fn(async (_arg: unknown): Promise<{ sent: boolean; messageId?: string; skipped?: string }> => ({ sent: true, messageId: "m1" }));
const confirmationMock = vi.fn();
vi.mock("@/services/email", () => ({ sendAdminNewMemory: (arg: unknown) => sendMock(arg), sendMemoryConfirmation: (arg: unknown) => confirmationMock(arg) }));

import { notifyAdminsOfMemory } from "@/features/memories/notify-admins";

function readyPhoto(over: Partial<MediaRow> = {}): MediaRow {
  return { id: "med_1", status: "READY", mimeType: "image/jpeg", originalFilename: "IMG_0001.jpg", durationSeconds: null, ...over };
}

const SUBMITTED = new Date("2026-11-03T19:38:00Z");

beforeEach(() => {
  memory = {
    id: "mem_1",
    type: "PHOTO",
    status: "PENDING",
    deletedAt: null,
    createdAt: SUBMITTED,
    claimTokenHash: "h".repeat(64),
    contributorNote: null,
    approxDateText: "Summer 1985",
    place: "her classroom",
    visibility: "FAMILY",
    notifyWhenPosted: true,
    contributor: { name: "Jo", email: "jo@example.com", relationship: "former student", contactOptIn: true, mailingListOptIn: false },
    media: [readyPhoto()],
  };
  sendMock.mockClear();
  confirmationMock.mockClear();
  dbStub.memory.update.mockClear();
  process.env.CONSENT_VERSION = "2026-11-v1";
  resetEnvCache();
});

describe("notifyAdminsOfMemory", () => {
  it("builds who, date, memory, media and details from the row and sends", async () => {
    memory!.contributorNote = "She once taught me to quilt.";
    expect(await notifyAdminsOfMemory({ memoryId: "mem_1" })).toEqual({ sent: true, messageId: "m1" });
    expect(sendMock).toHaveBeenCalledWith({
      memoryId: "mem_1",
      submittedAt: SUBMITTED,
      name: "Jo",
      relationship: "former student",
      email: "jo@example.com",
      contactOptIn: true,
      mailingListOptIn: false,
      notifyWhenPosted: true,
      approxDateText: "Summer 1985",
      place: "her classroom",
      note: "She once taught me to quilt.",
      visibility: "FAMILY",
      media: [{ kind: "PHOTO", originalFilename: "IMG_0001.jpg", durationSeconds: null, preview: null }],
      filesNotReady: 0,
    });
  });

  it("sends even when the contributor left no email or no contributor row at all", async () => {
    memory!.contributor = { name: "Jo", email: null, relationship: null, contactOptIn: false, mailingListOptIn: false };
    expect((await notifyAdminsOfMemory({ memoryId: "mem_1" })).sent).toBe(true);
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ email: null, name: "Jo" }));
    memory!.contributor = null;
    expect((await notifyAdminsOfMemory({ memoryId: "mem_1" })).sent).toBe(true);
    expect(sendMock).toHaveBeenLastCalledWith(expect.objectContaining({ name: null, email: null, contactOptIn: false, mailingListOptIn: false }));
  });

  it("lists READY files in order, skips removed ones, and counts files that are not ready", async () => {
    memory!.type = "VOICE";
    memory!.media = [
      readyPhoto({ id: "a", mimeType: "audio/mp4", originalFilename: "voice.m4a", durationSeconds: 134 }),
      readyPhoto({ id: "b", status: "PENDING", mimeType: "video/mp4" }),
      readyPhoto({ id: "c", status: "FAILED", mimeType: "image/heic" }),
      readyPhoto({ id: "d", mimeType: "video/quicktime", originalFilename: "clip.mov", deletedAt: new Date() }),
      readyPhoto({ id: "e", mimeType: "video/quicktime", originalFilename: "keep.mov" }),
    ];
    await notifyAdminsOfMemory({ memoryId: "mem_1" });
    const arg = sendMock.mock.calls[0]?.[0] as { media: unknown[]; filesNotReady: number };
    expect(arg.media).toEqual([
      { kind: "VOICE", originalFilename: "voice.m4a", durationSeconds: 134, preview: null },
      { kind: "VIDEO", originalFilename: "keep.mov", durationSeconds: null, preview: null },
    ]);
    expect(arg.filesNotReady).toBe(2);
  });

  it("a TEXT memory needs no file; a memory whose file failed but whose note exists still alerts", async () => {
    memory!.type = "TEXT"; memory!.media = []; memory!.contributorNote = "words";
    expect((await notifyAdminsOfMemory({ memoryId: "mem_1" })).sent).toBe(true);
    memory!.type = "PHOTO"; memory!.media = [readyPhoto({ status: "FAILED" })]; memory!.contributorNote = "the words were saved";
    expect((await notifyAdminsOfMemory({ memoryId: "mem_1" })).sent).toBe(true);
    expect(sendMock).toHaveBeenLastCalledWith(expect.objectContaining({ media: [], filesNotReady: 1, note: "the words were saved" }));
  });

  it("skips when the memory is missing, deleted, or has nothing ready yet", async () => {
    memory!.media = [readyPhoto({ status: "PENDING" })];
    expect(await notifyAdminsOfMemory({ memoryId: "mem_1" })).toEqual({ sent: false, skipped: "not_ready" });
    memory!.deletedAt = new Date();
    expect(await notifyAdminsOfMemory({ memoryId: "mem_1" })).toEqual({ sent: false, skipped: "deleted" });
    memory = null;
    expect(await notifyAdminsOfMemory({ memoryId: "mem_1" })).toEqual({ sent: false, skipped: "not_found" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("passes through the email service's skip reasons", async () => {
    sendMock.mockResolvedValueOnce({ sent: false, skipped: "no_recipients" } as never);
    expect(await notifyAdminsOfMemory({ memoryId: "mem_1" })).toEqual({ sent: false, skipped: "no_recipients" });
  });

  it("never touches the claim token: no rotation, no link, no contributor confirmation", async () => {
    await notifyAdminsOfMemory({ memoryId: "mem_1" });
    expect(dbStub.memory.update).not.toHaveBeenCalled();
    expect(confirmationMock).not.toHaveBeenCalled();
    const arg = sendMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(arg)).not.toContain("claimLink");
    expect(Object.keys(arg)).not.toContain("rotateToClaimTokenHash");
    expect(JSON.stringify(arg)).not.toContain("h".repeat(64));
  });
});

describe("drafts", () => {
  it("does not alert the admins about a DRAFT: the admin drafted it, and the alert fires when the person shares", async () => {
    memory!.type = "TEXT";
    memory!.status = "DRAFT";
    memory!.contributorNote = "words from a condolence note";
    expect(await notifyAdminsOfMemory({ memoryId: "mem_1" })).toEqual({ sent: false, skipped: "draft" });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
