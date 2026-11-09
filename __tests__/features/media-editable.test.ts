import { beforeEach, describe, expect, it } from "vitest";

import { mediaEditableView, REMOVED_MEDIA_GRACE_MS } from "@/features/admin/media-editable";

import { createMediaToolsFakeDb, fakeMedia, fakeMemory } from "../helpers/media-tools-fake-db";

/** `current` of the MCP photo tools (plan 2026-11-08-mcp-media-tools §3.1, D7, D12). */

const MEM = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const REMOVED_AT = new Date("2026-11-08T15:00:00.000Z");
const fake = createMediaToolsFakeDb();
type Db = Parameters<typeof mediaEditableView>[0];

beforeEach(() => {
  fake.reset();
  fake.memories.push(fakeMemory({ id: MEM, status: "APPROVED", visibility: "FAMILY" }));
});

describe("mediaEditableView", () => {
  it("lists the visible files in display order and the restorable removed files, with the memory's version, status and visibility", async () => {
    fake.media.push(
      fakeMedia({ id: "m-b", memoryId: MEM, sortOrder: 1, caption: "B" }),
      fakeMedia({ id: "m-a", memoryId: MEM, sortOrder: 0, caption: "A", approxDateText: "1990", place: "Baltimore" }),
      // Equal slot and creation time: the id decides (D9).
      fakeMedia({ id: "m-c2", memoryId: MEM, sortOrder: 2 }),
      fakeMedia({ id: "m-c1", memoryId: MEM, sortOrder: 2 }),
      fakeMedia({ id: "m-failed", memoryId: MEM, sortOrder: 3, status: "FAILED" }),
      // Not visible: a pending replacement, a claim-page removal, another memory's file.
      fakeMedia({ id: "m-repl", memoryId: MEM, sortOrder: 0, status: "PENDING", replacesMediaId: "m-a" }),
      fakeMedia({ id: "m-claim-removed", memoryId: MEM, deletedAt: REMOVED_AT }),
      fakeMedia({ id: "m-other", memoryId: OTHER }),
      // Restorable: removed through MCP, READY, not purged.
      fakeMedia({ id: "m-removed", memoryId: MEM, caption: "R", deletedAt: REMOVED_AT, purgeAfter: new Date(REMOVED_AT.getTime() + REMOVED_MEDIA_GRACE_MS) }),
      // Not restorable: already purged; a cancelled replacement that became READY.
      fakeMedia({ id: "m-purged", memoryId: MEM, status: "FAILED", deletedAt: REMOVED_AT, purgeAfter: REMOVED_AT, purgedAt: REMOVED_AT }),
      fakeMedia({ id: "m-cancelled-repl", memoryId: MEM, deletedAt: REMOVED_AT, replacesMediaId: "m-b" }),
    );
    const view = await mediaEditableView(fake.db as unknown as Db, MEM);
    expect(view).toEqual({
      memoryVersion: "2026-11-08T14:36:08.673Z",
      status: "APPROVED",
      visibility: "FAMILY",
      media: [
        { id: "m-a", status: "READY", mimeType: "image/jpeg", originalFilename: "m-a.jpg", caption: "A", approxDateText: "1990", place: "Baltimore", sortOrder: 0 },
        { id: "m-b", status: "READY", mimeType: "image/jpeg", originalFilename: "m-b.jpg", caption: "B", approxDateText: null, place: null, sortOrder: 1 },
        { id: "m-c1", status: "READY", mimeType: "image/jpeg", originalFilename: "m-c1.jpg", caption: null, approxDateText: null, place: null, sortOrder: 2 },
        { id: "m-c2", status: "READY", mimeType: "image/jpeg", originalFilename: "m-c2.jpg", caption: null, approxDateText: null, place: null, sortOrder: 2 },
        { id: "m-failed", status: "FAILED", mimeType: "image/jpeg", originalFilename: "m-failed.jpg", caption: null, approxDateText: null, place: null, sortOrder: 3 },
      ],
      removedMedia: [
        { id: "m-removed", mimeType: "image/jpeg", originalFilename: "m-removed.jpg", caption: "R", approxDateText: null, removedAt: REMOVED_AT, restorableUntil: new Date(REMOVED_AT.getTime() + REMOVED_MEDIA_GRACE_MS) },
      ],
    });
  });

  it("answers null for a missing memory", async () => {
    expect(await mediaEditableView(fake.db as unknown as Db, OTHER)).toBeNull();
  });

  it("keeps the 30-day grace in step with the deleted-memory grace of cron step (f)", () => {
    expect(REMOVED_MEDIA_GRACE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
