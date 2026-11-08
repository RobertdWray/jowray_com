import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as AdminPreviewsModule from "@/features/memories/admin-previews";
import type * as LoggerModule from "@/lib/logger";
import { resetEnvCache } from "@/server/config/env";
import type * as EmailModule from "@/services/email";

interface MediaRow { id: string; status: "PENDING" | "READY" | "FAILED"; mimeType: string; originalFilename: string | null; durationSeconds: number | null; deletedAt?: Date | null; createdAt?: Date }
interface MemoryRow {
  id: string;
  type: "VOICE" | "VIDEO" | "PHOTO" | "TEXT";
  status: "DRAFT" | "PENDING" | "APPROVED" | "HIDDEN";
  deletedAt: Date | null;
  createdAt: Date;
  consentedAt: Date | null;
  claimTokenHash: string;
  contributorNote: string | null;
  approxDateText: string | null;
  place: string | null;
  visibility: "PUBLIC" | "FAMILY" | "PRIVATE";
  notifyWhenPosted: boolean;
  uploadLeaseUntil?: Date | null;
  contributor: { name: string | null; email: string | null; relationship: string | null; contactOptIn: boolean; mailingListOptIn: boolean } | null;
  media: MediaRow[];
}
let memory: MemoryRow | null = null;
/** The alert's EmailLog row, as the advisory read sees it. */
let alertRow: { status: "PENDING" | "SENDING" | "SENT" | "FAILED" | "SKIPPED"; updatedAt: Date; errorMessage: string | null } | null = null;
const dbStub = {
  emailLog: { findUnique: vi.fn(async (_arg: unknown) => alertRow) },
  memory: {
    findUnique: vi.fn(async ({ include }: { include?: { media?: { where?: { deletedAt?: null } } } } = {}) =>
      memory && include?.media?.where && "deletedAt" in include.media.where ? { ...memory, media: memory.media.filter((m) => (m.deletedAt ?? null) === null) } : memory),
    update: vi.fn(async () => memory),
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));
const sendMock = vi.fn(async (_arg: unknown): Promise<{ sent: boolean; messageId?: string; skipped?: string }> => ({ sent: true, messageId: "m1" }));
const confirmationMock = vi.fn();
// The real EmailLog rules (deliveryClosed); only the sends are stubbed.
vi.mock("@/services/email", async (importOriginal) => ({
  ...(await importOriginal<typeof EmailModule>()),
  sendAdminNewMemory: (arg: unknown) => sendMock(arg),
  sendMemoryConfirmation: (arg: unknown) => confirmationMock(arg),
}));
type Preview = { contentId: string; contentBase64: string; width: number; height: number };
const waitMock = vi.fn(async (_arg: { memoryId: string; until: number }) => undefined);
const loadMock = vi.fn(async (_media: unknown, _signal: AbortSignal) => new Map<string, Preview>());
vi.mock("@/features/memories/admin-previews", async (importOriginal) => ({
  ...(await importOriginal<typeof AdminPreviewsModule>()),
  waitForAdminPreviews: (arg: { memoryId: string; until: number }) => waitMock(arg),
  loadAdminPreviews: (media: unknown, signal: AbortSignal) => loadMock(media, signal),
}));

// Every logger keeps its real behaviour; `info` lines are also recorded.
const logInfo = vi.fn();
vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof LoggerModule>();
  return {
    ...actual,
    createLogger: (context: Record<string, unknown>) => {
      const real = actual.createLogger(context);
      return Object.assign(Object.create(real) as typeof real, { info: (...args: unknown[]) => { logInfo(...args); } });
    },
  };
});

import { PREVIEW_COPIES, PREVIEW_READ_TIMEOUT_MS } from "@/features/memories/admin-previews";
import { notifyAdminsOfMemory } from "@/features/memories/notify-admins";

function readyPhoto(over: Partial<MediaRow> = {}): MediaRow {
  return { id: "med_1", status: "READY", mimeType: "image/jpeg", originalFilename: "IMG_0001.jpg", durationSeconds: null, createdAt: new Date(Date.now() - 60 * 60_000), ...over };
}

const SUBMITTED = new Date("2026-11-03T19:38:00Z");

beforeEach(() => {
  memory = {
    id: "mem_1",
    type: "PHOTO",
    status: "PENDING",
    deletedAt: null,
    createdAt: SUBMITTED,
    consentedAt: SUBMITTED,
    claimTokenHash: "h".repeat(64),
    contributorNote: null,
    approxDateText: "Summer 1985",
    place: "her classroom",
    visibility: "FAMILY",
    notifyWhenPosted: true,
    uploadLeaseUntil: null,
    contributor: { name: "Jo", email: "jo@example.com", relationship: "former student", contactOptIn: true, mailingListOptIn: false },
    media: [readyPhoto()],
  };
  alertRow = null;
  sendMock.mockClear();
  confirmationMock.mockClear();
  dbStub.memory.update.mockClear();
  dbStub.memory.findUnique.mockClear();
  dbStub.emailLog.findUnique.mockClear();
  waitMock.mockReset();
  waitMock.mockResolvedValue(undefined);
  loadMock.mockReset();
  loadMock.mockResolvedValue(new Map());
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
  it("dates a shared draft by the moment the person pressed Share, not the moment the admin drafted it", async () => {
    const SHARED = new Date("2026-11-05T09:00:00Z");
    memory!.type = "TEXT";
    memory!.contributorNote = "words from a condolence note";
    memory!.consentedAt = SHARED;
    await notifyAdminsOfMemory({ memoryId: "mem_1" });
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ submittedAt: SHARED }));
  });

  it("does not alert the admins about a DRAFT: the admin drafted it, and the alert fires when the person shares", async () => {
    memory!.type = "TEXT";
    memory!.status = "DRAFT";
    memory!.contributorNote = "words from a condolence note";
    expect(await notifyAdminsOfMemory({ memoryId: "mem_1" })).toEqual({ sent: false, skipped: "draft" });
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("multi-file submissions", () => {
  it("waits while the submission is still sending files (lease open, or a reservation younger than a ticket lifetime), unless settled", async () => {
    memory!.uploadLeaseUntil = new Date(Date.now() + 30 * 60_000);
    memory!.media = [readyPhoto(), { id: "med_2", status: "PENDING", mimeType: "image/jpeg", originalFilename: "b.jpg", durationSeconds: null, createdAt: new Date(Date.now() - 40 * 60_000) }];
    expect(await notifyAdminsOfMemory({ memoryId: "mem_1" })).toEqual({ sent: false, skipped: "not_ready" });
    memory!.uploadLeaseUntil = null;
    memory!.media[1]!.createdAt = new Date();
    expect(await notifyAdminsOfMemory({ memoryId: "mem_1" })).toEqual({ sent: false, skipped: "not_ready" });
    expect(sendMock).not.toHaveBeenCalled();
    expect((await notifyAdminsOfMemory({ memoryId: "mem_1", settleNow: true })).sent).toBe(true);
    expect(sendMock.mock.calls[0]![0]).toMatchObject({ filesNotReady: 1 });
  });

  it("does not wait for an abandoned reservation once the lease is closed", async () => {
    memory!.uploadLeaseUntil = new Date(Date.now() - 1_000);
    memory!.media = [readyPhoto(), { id: "med_2", status: "PENDING", mimeType: "image/jpeg", originalFilename: "b.jpg", durationSeconds: null, createdAt: new Date(Date.now() - 16 * 60_000) }];
    expect((await notifyAdminsOfMemory({ memoryId: "mem_1" })).sent).toBe(true);
  });
});

describe("admin alert previews (video posters T14)", () => {
  const PREVIEW: Preview = { contentId: "preview-med_1", contentBase64: "/9j/AA==", width: 1000, height: 562 };
  const order = (mock: { mock: { invocationCallOrder: number[] } }, call = 0) => mock.mock.invocationCallOrder[call]!;
  const sentMedia = () => (sendMock.mock.calls.at(-1)?.[0] as { media: Array<{ preview: unknown }> }).media;

  it("loads the previews and passes them through to the alert; with no deadline (the cron) it never waits", async () => {
    memory!.media = [readyPhoto(), readyPhoto({ id: "med_2", mimeType: "video/quicktime", originalFilename: "clip.mov" })];
    loadMock.mockResolvedValueOnce(new Map([["med_2", PREVIEW]]));
    expect((await notifyAdminsOfMemory({ memoryId: "mem_1" })).sent).toBe(true);
    expect(waitMock).not.toHaveBeenCalled();
    expect(dbStub.memory.findUnique).toHaveBeenCalledTimes(1);
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect((loadMock.mock.calls[0]![0] as Array<{ id: string }>).map((m) => m.id)).toEqual(["med_1", "med_2"]);
    expect(sentMedia()).toEqual([
      { kind: "PHOTO", originalFilename: "IMG_0001.jpg", durationSeconds: null, preview: null },
      { kind: "VIDEO", originalFilename: "clip.mov", durationSeconds: null, preview: PREVIEW },
    ]);
  });

  it("selects each file's READY THUMBNAIL and POSTER rows for the loader", async () => {
    await notifyAdminsOfMemory({ memoryId: "mem_1" });
    const query = dbStub.memory.findUnique.mock.calls[0]![0] as { include: { media: { select: Record<string, unknown> } } };
    expect(query.include.media.select.derivatives).toEqual(PREVIEW_COPIES);
    expect(query.include.media.select.id).toBe(true);
  });

  describe("the read budget (R18)", () => {
    const T0 = new Date("2026-11-08T12:00:00Z").getTime();
    /** A load whose reads stall until the signal it was given aborts; records when that happened. */
    function stallLoad() {
      const abortedAt: number[] = [];
      loadMock.mockImplementationOnce((_media, signal) => new Promise((resolve) => {
        signal.addEventListener("abort", () => { abortedAt.push(Date.now()); resolve(new Map()); }, { once: true });
      }));
      return abortedAt;
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(T0);
      logInfo.mockClear();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("without a read deadline (the finalize alert after its wait, the cron), the reads get PREVIEW_READ_TIMEOUT_MS of their own", async () => {
      expect(PREVIEW_READ_TIMEOUT_MS).toBe(5_000);
      const abortedAt = stallLoad();
      const done = notifyAdminsOfMemory({ memoryId: "mem_1" });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(abortedAt).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(abortedAt).toEqual([T0 + 5_000]);
      expect((await done).sent).toBe(true);
    });

    it("with a read deadline, the reads stop at it, and the timer is cleared once they finish", async () => {
      const abortedAt = stallLoad();
      const done = notifyAdminsOfMemory({ memoryId: "mem_1", previewsReadUntil: T0 + 2_000 });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(abortedAt).toEqual([T0 + 2_000]);
      await done;
      // A quick load leaves no timer behind.
      loadMock.mockResolvedValueOnce(new Map());
      await notifyAdminsOfMemory({ memoryId: "mem_1", previewsReadUntil: T0 + 60_000 });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("a spent read deadline loads nothing: logged at info with the memoryId, then sent without previews", async () => {
      expect((await notifyAdminsOfMemory({ memoryId: "mem_1", previewsReadUntil: T0 })).sent).toBe(true);
      expect(loadMock).not.toHaveBeenCalled();
      expect(logInfo).toHaveBeenCalledWith(expect.objectContaining({ action: "admin_alert_previews_skipped", memoryId: "mem_1", reason: "read_budget_spent" }), expect.any(String));
      expect(sentMedia()[0]!.preview).toBeNull();
    });
  });

  it("with previewsUntil, waits for the copies first, then re-reads the memory and its copies, then loads and sends", async () => {
    const until = Date.now() + 15_000;
    loadMock.mockResolvedValueOnce(new Map([["med_1", PREVIEW]]));
    expect((await notifyAdminsOfMemory({ memoryId: "mem_1", previewsUntil: until })).sent).toBe(true);
    expect(waitMock).toHaveBeenCalledWith({ memoryId: "mem_1", until });
    expect(dbStub.memory.findUnique).toHaveBeenCalledTimes(2);
    expect(order(waitMock)).toBeLessThan(order(dbStub.memory.findUnique, 1));
    expect(order(dbStub.memory.findUnique, 1)).toBeLessThan(order(loadMock));
    expect(order(loadMock)).toBeLessThan(order(sendMock));
    expect(sentMedia()[0]!.preview).toEqual(PREVIEW);
  });

  it("never waits on a deadline that has already passed (a long send used it up); it still loads", async () => {
    await notifyAdminsOfMemory({ memoryId: "mem_1", previewsUntil: Date.now() - 1 });
    expect(waitMock).not.toHaveBeenCalled();
    expect(dbStub.memory.findUnique).toHaveBeenCalledTimes(1);
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  it("re-checks readiness after the wait: a memory deleted meanwhile gets no alert", async () => {
    waitMock.mockImplementationOnce(async () => { memory!.deletedAt = new Date(); });
    expect(await notifyAdminsOfMemory({ memoryId: "mem_1", previewsUntil: Date.now() + 15_000 })).toEqual({ sent: false, skipped: "deleted" });
    expect(loadMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it.each([
    ["already SENT", { status: "SENT" as const, updatedAt: new Date(Date.now() - 60 * 60_000), errorMessage: null }],
    ["being sent (a fresh SENDING claim)", { status: "SENDING" as const, updatedAt: new Date(Date.now() - 60_000), errorMessage: null }],
    ["terminally skipped (an on-behalf share)", { status: "SKIPPED" as const, updatedAt: new Date(), errorMessage: "admin_shared" }],
  ])("skips the wait and the load when the alert is %s, and lets the email service answer", async (_label, row) => {
    alertRow = row;
    sendMock.mockResolvedValueOnce({ sent: false, skipped: "already_sent" });
    expect(await notifyAdminsOfMemory({ memoryId: "mem_1", previewsUntil: Date.now() + 15_000 })).toEqual({ sent: false, skipped: "already_sent" });
    expect(dbStub.emailLog.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { memoryId_emailType: { memoryId: "mem_1", emailType: "ADMIN_NEW_MEMORY" } } }));
    expect(waitMock).not.toHaveBeenCalled();
    expect(loadMock).not.toHaveBeenCalled();
    expect(sentMedia()[0]!.preview).toBeNull();
  });

  it.each([
    ["no row yet", null],
    ["a stale SENDING claim (abandoned)", { status: "SENDING" as const, updatedAt: new Date(Date.now() - 16 * 60_000), errorMessage: null }],
    ["FAILED (retrying)", { status: "FAILED" as const, updatedAt: new Date(), errorMessage: "SendGrid 503" }],
    ["an ordinary skip", { status: "SKIPPED" as const, updatedAt: new Date(), errorMessage: "outbound_disabled" }],
  ])("waits and loads when the alert row is %s", async (_label, row) => {
    alertRow = row;
    await notifyAdminsOfMemory({ memoryId: "mem_1", previewsUntil: Date.now() + 15_000 });
    expect(waitMock).toHaveBeenCalledTimes(1);
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  it("runs the readiness checks before anything else: a memory that gets no alert reads no EmailLog, waits for and loads nothing", async () => {
    memory!.media = [readyPhoto({ status: "PENDING" })];
    expect(await notifyAdminsOfMemory({ memoryId: "mem_1", previewsUntil: Date.now() + 15_000 })).toEqual({ sent: false, skipped: "not_ready" });
    memory!.status = "DRAFT";
    expect(await notifyAdminsOfMemory({ memoryId: "mem_1", previewsUntil: Date.now() + 15_000 })).toEqual({ sent: false, skipped: "draft" });
    memory = null;
    expect(await notifyAdminsOfMemory({ memoryId: "mem_1", previewsUntil: Date.now() + 15_000 })).toEqual({ sent: false, skipped: "not_found" });
    expect(dbStub.emailLog.findUnique).not.toHaveBeenCalled();
    expect(waitMock).not.toHaveBeenCalled();
    expect(loadMock).not.toHaveBeenCalled();
  });
});
