import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { resetEnvCache } from "@/server/config/env";

const TOKEN = "t".repeat(43);
interface Rev { memoryId: string; changedVia: string; before: Record<string, unknown>; after: Record<string, unknown> }
const revisions: Rev[] = [];
let memory: Record<string, unknown> | null;
type MediaRow = { id: string; memoryId: string; status: string; mimeType: string; originalFilename: string | null; sortOrder: number; deletedAt: Date | null; replacesMediaId: string | null; createdAt: Date; durationSeconds: number | null; maxBytes?: number; caption?: string | null; approxDateText?: string | null; place?: string | null; derivatives?: Array<{ kind: string; status: string; mimeType: string | null }> };
const mediaRows: MediaRow[] = [];
const lockCalls: string[] = [];
/** Other memories of the same send, for the submission count. */
let siblings: Array<{ id: string; submissionId: string | null; deletedAt: Date | null }> = [];
function matchesMedia(row: MediaRow, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "status" && typeof v === "object" && v !== null && "in" in v) { if (!(v as { in: string[] }).in.includes(row.status)) { return false; } continue; }
    if ((row as Record<string, unknown>)[k] !== v) { return false; }
  }
  return true;
}
const tx = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => { lockCalls.push(`${strings.join("?")}|${String(values[0])}`); return [{ id: values[0] }]; }),
  media: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => mediaRows.find((r) => matchesMedia(r, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => mediaRows.filter((r) => matchesMedia(r, where))),
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => mediaRows.filter((r) => matchesMedia(r, where)).length),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MediaRow> }) => { const row = mediaRows.find((r) => r.id === where.id)!; Object.assign(row, data); return row; }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<MediaRow> }) => { const rows = mediaRows.filter((r) => matchesMedia(r, where)); for (const r of rows) { Object.assign(r, data); } return { count: rows.length }; }),
  },
  memory: {
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => { if (!memory || memory.id !== where.id) { throw Object.assign(new Error("not found"), { code: "P2025" }); } return memory; }),
    findUnique: vi.fn(async ({ where, include }: { where: { claimTokenHash?: string; id?: string }; include?: { media?: { where?: Record<string, unknown> } } }) => {
      if (!memory || !(where.claimTokenHash ? memory.claimTokenHash === where.claimTokenHash : memory.id === where.id)) { return null; }
      if (include?.media) {
        const w = include.media.where ?? {};
        return { ...memory, media: mediaRows.filter((r) => r.memoryId === memory!.id && matchesMedia(r, w)).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime()) };
      }
      // A snapshot, like a real pre-lock read: later mutations are only visible through findUniqueOrThrow.
      return { ...memory, contributor: memory.contributor ? { ...(memory.contributor as object) } : null };
    }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(memory!, data); return memory; }),
    count: vi.fn(async ({ where }: { where: { submissionId: string; deletedAt: null } }) => siblings.filter((m) => m.submissionId === where.submissionId && m.deletedAt === null).length),
  },
  contributor: { update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(memory!.contributor as object, data); return memory!.contributor; }) },
  memoryRevision: {
    count: vi.fn(async () => revisions.length),
    create: vi.fn(async ({ data }: { data: Rev }) => { revisions.push(data); return { id: `rev_${revisions.length}`, ...data }; }),
  },
};
const dbStub = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

import { cancelReservation, getMemoryForClaim, removeMediaFromClaim, updateMediaFromClaim, updateMemoryFromClaim } from "@/features/memories/claim";

beforeEach(() => {
  revisions.length = 0;
  lockCalls.length = 0;
  siblings = [];
  mediaRows.length = 0;
  mediaRows.push(
    { id: "med_1", memoryId: "mem_1", status: "READY", mimeType: "image/heic", originalFilename: "a.heic", sortOrder: 0, deletedAt: null, replacesMediaId: null, createdAt: new Date("2026-11-03T10:00:00Z"), durationSeconds: 24, maxBytes: 25 * 1024 * 1024, derivatives: [{ kind: "WEB_IMAGE", status: "READY", mimeType: "image/jpeg" }, { kind: "THUMBNAIL", status: "READY", mimeType: "image/jpeg" }] },
    { id: "med_2", memoryId: "mem_1", status: "PENDING", mimeType: "video/mp4", originalFilename: null, sortOrder: 1, deletedAt: null, replacesMediaId: null, createdAt: new Date("2026-11-03T10:00:01Z"), durationSeconds: null, maxBytes: 500 * 1024 * 1024 },
    { id: "med_gone", memoryId: "mem_1", status: "READY", mimeType: "image/jpeg", originalFilename: "old.jpg", sortOrder: 2, deletedAt: new Date("2026-11-03T11:00:00Z"), replacesMediaId: null, createdAt: new Date("2026-11-03T10:00:02Z"), durationSeconds: null },
    { id: "med_other", memoryId: "mem_2", status: "READY", mimeType: "image/jpeg", originalFilename: "x.jpg", sortOrder: 0, deletedAt: null, replacesMediaId: null, createdAt: new Date("2026-11-03T10:00:03Z"), durationSeconds: null },
  );
  memory = {
    id: "mem_1", type: "PHOTO", status: "PENDING", deletedAt: null, claimTokenHash: hashClaimToken(TOKEN), consentVersion: "2026-11-v1", consentedAt: new Date("2026-11-03T10:00:00Z"), submissionId: null, submissionIndex: null,
    approxDateText: "Summer 1998", place: null, contributorNote: "old note", visibility: "FAMILY", notifyWhenPosted: true,
    contributor: { id: "con_1", name: "Jo", relationship: "friend", email: "jo@example.com", contactOptIn: true },
    media: [{ id: "med_1", status: "READY", mimeType: "image/heic", originalFilename: "a.heic", durationSeconds: 24 }, { id: "med_2", status: "PENDING", mimeType: "video/mp4", originalFilename: null, durationSeconds: null }],
  };
});

describe("getMemoryForClaim", () => {
  it("tells the page the memory's status and the two preferences", async () => {
    const found = await getMemoryForClaim(TOKEN);
    expect(found).toMatchObject({ status: "PENDING", notifyWhenPosted: true, contributor: { contactOptIn: true } });
  });

  it("returns every live file with its status, in sort order, and hides removed ones", async () => {
    const found = await getMemoryForClaim(TOKEN);
    expect(found?.id).toBe("mem_1");
    expect(found?.media.map((m) => [m.id, m.status, m.sortOrder])).toEqual([["med_1", "READY", 0], ["med_2", "PENDING", 1]]);
    expect(found?.media[0]?.durationSeconds).toBe(24);
  });

  it("reports the state of each file's sanitized web copy", async () => {
    const found = await getMemoryForClaim(TOKEN);
    expect(found?.media[0]?.web).toEqual({ status: "ready", mimeType: "image/jpeg" });
    expect(found?.media[1]?.web).toEqual({ status: "none", mimeType: null });
    mediaRows[0]!.derivatives = [{ kind: "WEB_IMAGE", status: "FAILED", mimeType: null }];
    expect((await getMemoryForClaim(TOKEN))?.media[0]?.web).toEqual({ status: "failed", mimeType: null });
    mediaRows[0]!.derivatives = [{ kind: "WEB_IMAGE", status: "PENDING", mimeType: null }];
    expect((await getMemoryForClaim(TOKEN))?.media[0]?.web).toEqual({ status: "pending", mimeType: null });
  });

  it("returns null for a wrong token or a deleted memory", async () => {
    expect(await getMemoryForClaim("x".repeat(43))).toBeNull();
    memory!.deletedAt = new Date();
    expect(await getMemoryForClaim(TOKEN)).toBeNull();
  });
});

describe("updateMemoryFromClaim", () => {
  it("writes the change and appends one revision with before/after; the first revision records the consent version", async () => {
    const result = await updateMemoryFromClaim({ claimToken: TOKEN, changes: { name: "Jo Friend", approxDateText: "Autumn 1998", note: "new note", visibility: "PRIVATE" } });
    expect(result).toEqual({ ok: true, shared: false });
    expect(memory).toMatchObject({ approxDateText: "Autumn 1998", contributorNote: "new note", visibility: "PRIVATE" });
    expect(memory!.contributor).toMatchObject({ name: "Jo Friend", relationship: "friend" });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ memoryId: "mem_1", changedVia: "CLAIM_LINK" });
    expect(revisions[0]!.before).toMatchObject({ approxDateText: "Summer 1998", contributorNote: "old note", name: "Jo" });
    expect(revisions[0]!.after).toMatchObject({ approxDateText: "Autumn 1998", contributorNote: "new note", name: "Jo Friend", consentVersion: "2026-11-v1" });
  });

  it("stores an emptied note as null so nothing selects on an empty string", async () => {
    await updateMemoryFromClaim({ claimToken: TOKEN, changes: { note: "   " } });
    expect(memory!.contributorNote).toBeNull();
  });

  it("rejects a wrong token, a deleted memory and invalid input without writing", async () => {
    expect(await updateMemoryFromClaim({ claimToken: "x".repeat(43), changes: { note: "x" } })).toEqual({ ok: false, code: "not_found" });
    expect(await updateMemoryFromClaim({ claimToken: TOKEN, changes: { visibility: "EVERYONE" } })).toEqual({ ok: false, code: "invalid" });
    memory!.deletedAt = new Date();
    expect(await updateMemoryFromClaim({ claimToken: TOKEN, changes: { note: "x" } })).toEqual({ ok: false, code: "not_found" });
    expect(revisions).toHaveLength(0);
  });
});

describe("removeMediaFromClaim", () => {
  const VALID = { claimToken: TOKEN, mediaId: "00000000-0000-4000-8000-000000000001" };
  beforeEach(() => { mediaRows[0]!.id = VALID.mediaId; });

  it("soft-deletes the file under the memory lock, cancels its pending replacement, recomputes the type and writes a revision", async () => {
    mediaRows.push({ id: "med_rep", memoryId: "mem_1", status: "PENDING", mimeType: "image/jpeg", originalFilename: "new.jpg", sortOrder: 0, deletedAt: null, replacesMediaId: VALID.mediaId, createdAt: new Date(), durationSeconds: null });
    memory!.contributorNote = "some words";
    const result = await removeMediaFromClaim(VALID);
    expect(result).toEqual({ ok: true });
    expect(lockCalls[0]).toContain("FOR UPDATE|mem_1");
    expect(mediaRows.find((r) => r.id === VALID.mediaId)!.deletedAt).toBeInstanceOf(Date);
    expect(mediaRows.find((r) => r.id === "med_rep")!.deletedAt).toBeInstanceOf(Date);
    expect(memory!.type).toBe("TEXT");
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.before).toMatchObject({ mediaIds: [VALID.mediaId, "med_2"], type: "PHOTO" });
    expect(revisions[0]!.after).toMatchObject({ mediaIds: ["med_2"], type: "TEXT" });
  });

  it("refuses to remove the only live file of a memory without words", async () => {
    memory!.contributorNote = null;
    expect(await removeMediaFromClaim(VALID)).toEqual({ ok: false, code: "last_file" });
    expect(mediaRows.find((r) => r.id === VALID.mediaId)!.deletedAt).toBeNull();
    expect(revisions).toHaveLength(0);
  });

  it("rejects a wrong token, another memory's file, an already-removed file and invalid input without writing", async () => {
    expect(await removeMediaFromClaim({ ...VALID, claimToken: "x".repeat(43) })).toEqual({ ok: false, code: "not_found" });
    mediaRows.find((r) => r.id === "med_other")!.id = "00000000-0000-4000-8000-00000000000f";
    expect(await removeMediaFromClaim({ ...VALID, mediaId: "00000000-0000-4000-8000-00000000000f" })).toEqual({ ok: false, code: "not_found" });
    mediaRows.find((r) => r.id === "med_gone")!.id = "00000000-0000-4000-8000-00000000000e";
    expect(await removeMediaFromClaim({ ...VALID, mediaId: "00000000-0000-4000-8000-00000000000e" })).toEqual({ ok: false, code: "not_found" });
    expect(await removeMediaFromClaim({ claimToken: TOKEN, mediaId: "med_1" })).toEqual({ ok: false, code: "invalid" });
    expect(revisions).toHaveLength(0);
  });
});

describe("cancelReservation", () => {
  const PENDING_ID = "00000000-0000-4000-8000-000000000002";
  beforeEach(() => { mediaRows[1]!.id = PENDING_ID; });

  it("soft-deletes a PENDING reservation and writes a revision", async () => {
    expect(await cancelReservation({ claimToken: TOKEN, mediaId: PENDING_ID })).toEqual({ ok: true });
    expect(mediaRows.find((r) => r.id === PENDING_ID)!.deletedAt).toBeInstanceOf(Date);
    expect(revisions[0]!.after).toMatchObject({ mediaIds: ["med_1"] });
  });

  it("does not cancel a READY file", async () => {
    mediaRows[0]!.id = "00000000-0000-4000-8000-000000000001";
    expect(await cancelReservation({ claimToken: TOKEN, mediaId: "00000000-0000-4000-8000-000000000001" })).toEqual({ ok: false, code: "not_found" });
    expect(mediaRows[0]!.deletedAt).toBeNull();
  });
});

describe("updateMemoryFromClaim non-empty invariant", () => {
  it("refuses to clear the note when no live READY file remains", async () => {
    mediaRows[0]!.deletedAt = new Date();
    expect(await updateMemoryFromClaim({ claimToken: TOKEN, changes: { note: "" } })).toEqual({ ok: false, code: "last_words" });
    expect(memory!.contributorNote).toBe("old note");
  });

  it("allows clearing the note while a READY file remains and recomputes the type", async () => {
    memory!.type = "TEXT";
    expect(await updateMemoryFromClaim({ claimToken: TOKEN, changes: { note: "" } })).toEqual({ ok: true, shared: false });
    expect(memory!.contributorNote).toBeNull();
    expect(memory!.type).toBe("PHOTO");
  });
});

describe("invariants are evaluated after the lock", () => {
  it("a removal through a link rotated while waiting for the lock is refused", async () => {
    const VALID = { claimToken: TOKEN, mediaId: "00000000-0000-4000-8000-000000000001" };
    mediaRows[0]!.id = VALID.mediaId;
    memory!.contributorNote = "words";
    tx.$queryRaw.mockImplementationOnce(async (strings: TemplateStringsArray, ...values: unknown[]) => { memory!.claimTokenHash = hashClaimToken("rotated".padEnd(43, "x")); lockCalls.push(`${strings.join("?")}|${String(values[0])}`); return [{ id: values[0] }]; });
    expect(await removeMediaFromClaim(VALID)).toEqual({ ok: false, code: "not_found" });
    expect(mediaRows.find((r) => r.id === VALID.mediaId)!.deletedAt).toBeNull();
  });

  it("sees a note cleared by a concurrent editor and refuses to remove the last file", async () => {
    const VALID = { claimToken: TOKEN, mediaId: "00000000-0000-4000-8000-000000000001" };
    mediaRows[0]!.id = VALID.mediaId;
    memory!.contributorNote = "words that will be gone by the time we hold the lock";
    tx.$queryRaw.mockImplementationOnce(async (strings: TemplateStringsArray, ...values: unknown[]) => { memory!.contributorNote = null; lockCalls.push(`${strings.join("?")}|${String(values[0])}`); return [{ id: values[0] }]; });
    expect(await removeMediaFromClaim(VALID)).toEqual({ ok: false, code: "last_file" });
    expect(mediaRows.find((r) => r.id === VALID.mediaId)!.deletedAt).toBeNull();
  });
});

describe("revision bookkeeping", () => {
  const VALID = { claimToken: TOKEN, mediaId: "00000000-0000-4000-8000-000000000001" };

  it("records the consent version on the first revision even when that revision is a removal", async () => {
    mediaRows[0]!.id = VALID.mediaId;
    memory!.contributorNote = "words";
    await removeMediaFromClaim(VALID);
    expect(revisions[0]!.after).toMatchObject({ consentVersion: "2026-11-v1" });
    await updateMemoryFromClaim({ claimToken: TOKEN, changes: { place: "Baltimore" } });
    expect(revisions[1]!.after).not.toHaveProperty("consentVersion");
  });

  it("names the cancelled replacement in its revision instead of writing identical snapshots", async () => {
    const REP = "00000000-0000-4000-8000-000000000009";
    mediaRows.push({ id: REP, memoryId: "mem_1", status: "PENDING", mimeType: "image/jpeg", originalFilename: "new.jpg", sortOrder: 0, deletedAt: null, replacesMediaId: "med_1", createdAt: new Date(), durationSeconds: null });
    expect(await cancelReservation({ claimToken: TOKEN, mediaId: REP })).toEqual({ ok: true });
    expect(revisions[0]!.after).toMatchObject({ cancelledReplacementOf: "med_1" });
  });

  it("takes contributor name and relationship from the post-lock read", async () => {
    tx.$queryRaw.mockImplementationOnce(async (strings: TemplateStringsArray, ...values: unknown[]) => { (memory!.contributor as { name: string }).name = "Renamed meanwhile"; lockCalls.push(`${strings.join("?")}|${String(values[0])}`); return [{ id: values[0] }]; });
    await updateMemoryFromClaim({ claimToken: TOKEN, changes: { place: "Baltimore" } });
    expect(revisions[0]!.before).toMatchObject({ name: "Renamed meanwhile" });
    expect((memory!.contributor as { name: string }).name).toBe("Renamed meanwhile");
  });
});

describe("a DRAFT becomes the person's own by pressing Share", () => {
  const DRAFTED = new Date("2026-11-04T12:00:00Z");
  beforeEach(() => {
    memory!.type = "TEXT";
    memory!.status = "DRAFT";
    memory!.consentedAt = null;
    memory!.createdAt = DRAFTED;
    mediaRows.length = 0;
    process.env.MEMORIAL_SLUG = "jo";
    process.env.CONSENT_VERSION = "2026-11-v2";
    resetEnvCache();
  });

  it("share: DRAFT → PENDING with consent stamped now, at the version in force, recorded in the revision; no email is sent", async () => {
    const before = Date.now();
    const result = await updateMemoryFromClaim({ claimToken: TOKEN, changes: { note: "my words, lightly edited", share: true } });
    expect(result).toEqual({ ok: true, shared: true });
    expect(memory).toMatchObject({ status: "PENDING", consentVersion: "2026-11-v2", contributorNote: "my words, lightly edited" });
    expect((memory!.consentedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.before).toMatchObject({ status: "DRAFT", consentedAt: null });
    expect(revisions[0]!.after).toMatchObject({ status: "PENDING", consentVersion: "2026-11-v2" });
    expect(revisions[0]!.after.consentedAt).toBeInstanceOf(Date);
  });

  it("an edit without share leaves the memory a DRAFT with no consent stamp", async () => {
    expect(await updateMemoryFromClaim({ claimToken: TOKEN, changes: { place: "Broadmead" } })).toEqual({ ok: true, shared: false });
    expect(memory).toMatchObject({ status: "DRAFT", consentedAt: null, place: "Broadmead" });
    expect(revisions[0]!.after).not.toHaveProperty("status");
  });

  it("share on a memory that is no longer a DRAFT is ignored: consent is never restamped", async () => {
    const stamped = new Date("2026-11-04T13:00:00Z");
    memory!.status = "PENDING";
    memory!.consentedAt = stamped;
    memory!.consentVersion = "2026-11-v1";
    expect(await updateMemoryFromClaim({ claimToken: TOKEN, changes: { share: true, note: "again" } })).toEqual({ ok: true, shared: false });
    expect(memory).toMatchObject({ status: "PENDING", consentedAt: stamped, consentVersion: "2026-11-v1" });
  });

  it("stores the two preferences from the claim page", async () => {
    expect(await updateMemoryFromClaim({ claimToken: TOKEN, changes: { share: true, notifyWhenPosted: false, contactOptIn: false } })).toEqual({ ok: true, shared: true });
    expect(memory!.notifyWhenPosted).toBe(false);
    expect((memory!.contributor as { contactOptIn: boolean }).contactOptIn).toBe(false);
    expect(revisions[0]!.before).toMatchObject({ notifyWhenPosted: true, contactOptIn: true });
    expect(revisions[0]!.after).toMatchObject({ notifyWhenPosted: false, contactOptIn: false });
  });

  it("a revoked link cannot share: the token is re-checked under the lock (reissue won the race)", async () => {
    tx.$queryRaw.mockImplementationOnce(async (strings: TemplateStringsArray, ...values: unknown[]) => { memory!.claimTokenHash = hashClaimToken("rotated-by-reissue".padEnd(43, "x")); lockCalls.push(`${strings.join("?")}|${String(values[0])}`); return [{ id: values[0] }]; });
    expect(await updateMemoryFromClaim({ claimToken: TOKEN, changes: { share: true } })).toEqual({ ok: false, code: "not_found" });
    expect(memory).toMatchObject({ status: "DRAFT", consentedAt: null });
    expect(revisions).toHaveLength(0);
  });

  it("a share-less edit of a DRAFT cannot record preferences: those are given by pressing Share", async () => {
    (memory!.contributor as { contactOptIn: boolean }).contactOptIn = false;
    expect(await updateMemoryFromClaim({ claimToken: TOKEN, changes: { place: "Broadmead", contactOptIn: true, notifyWhenPosted: false } })).toEqual({ ok: true, shared: false });
    expect(memory).toMatchObject({ status: "DRAFT", place: "Broadmead", notifyWhenPosted: true });
    expect((memory!.contributor as { contactOptIn: boolean }).contactOptIn).toBe(false);
    expect(revisions[0]!.after).toMatchObject({ notifyWhenPosted: true, contactOptIn: false });
  });

  it("the draft's words cannot be cleared before a file exists (same last_words rule)", async () => {
    expect(await updateMemoryFromClaim({ claimToken: TOKEN, changes: { note: "", share: true } })).toEqual({ ok: false, code: "last_words" });
    expect(memory!.status).toBe("DRAFT");
  });
});

describe("getMemoryForClaim: reservation size (Task 15)", () => {
  it("carries each file's ticketed ceiling so the claim page can refuse a bigger 'same file' before uploading", async () => {
    const found = await getMemoryForClaim(TOKEN);
    expect(found?.media.map((m) => m.maxBytes)).toEqual([25 * 1024 * 1024, 500 * 1024 * 1024]);
  });
});

describe("getMemoryForClaim: memories sent together (Task 15)", () => {
  it("reports the memory's place in its send and how many live memories share the contributor", async () => {
    memory!.submissionId = "sub_1"; memory!.submissionIndex = 1;
    siblings = [
      { id: "mem_1", submissionId: "sub_1", deletedAt: null },
      { id: "mem_0", submissionId: "sub_1", deletedAt: null },
      { id: "mem_2", submissionId: "sub_1", deletedAt: new Date() },
    ];
    expect((await getMemoryForClaim(TOKEN))?.submission).toEqual({ position: 2, count: 2 });
  });

  it("is null for a legacy memory", async () => {
    expect((await getMemoryForClaim(TOKEN))?.submission).toBeNull();
    expect(dbStub.memory.count).not.toHaveBeenCalled();
  });
});

describe("updateMediaFromClaim", () => {
  const ID = "00000000-0000-4000-8000-000000000001";
  beforeEach(() => { mediaRows[0]!.id = ID; mediaRows[0]!.caption = "old words"; mediaRows[0]!.approxDateText = null; mediaRows[0]!.place = "the lake"; });

  it("edits one file's caption, date and place under the lock and appends a revision with before/after", async () => {
    expect(await updateMediaFromClaim({ claimToken: TOKEN, mediaId: ID, changes: { caption: "  her classroom ", approxDateText: "1985", place: "" } })).toEqual({ ok: true });
    expect(mediaRows[0]).toMatchObject({ caption: "her classroom", approxDateText: "1985", place: null });
    expect(lockCalls[0]).toContain("FOR UPDATE|mem_1");
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.before).toMatchObject({ mediaId: ID, caption: "old words", approxDateText: null, place: "the lake" });
    expect(revisions[0]!.after).toMatchObject({ mediaId: ID, caption: "her classroom", approxDateText: "1985", place: null, consentVersion: "2026-11-v1" });
  });

  it("carries the edit onto a live PENDING replacement of that file, so the swap does not restore stale words", async () => {
    mediaRows.push(
      { id: "med_repl", memoryId: "mem_1", status: "PENDING", mimeType: "image/jpeg", originalFilename: "new.jpg", sortOrder: 0, deletedAt: null, replacesMediaId: ID, createdAt: new Date(), durationSeconds: null, caption: "old words", approxDateText: null, place: "the lake" },
      { id: "med_repl_gone", memoryId: "mem_1", status: "PENDING", mimeType: "image/jpeg", originalFilename: "x.jpg", sortOrder: 0, deletedAt: new Date(), replacesMediaId: ID, createdAt: new Date(), durationSeconds: null, caption: "old words", approxDateText: null, place: "the lake" },
    );
    expect(await updateMediaFromClaim({ claimToken: TOKEN, mediaId: ID, changes: { caption: "her classroom", place: "" } })).toEqual({ ok: true });
    expect(mediaRows.find((r) => r.id === "med_repl")).toMatchObject({ caption: "her classroom", approxDateText: null, place: null });
    expect(mediaRows.find((r) => r.id === "med_repl_gone")).toMatchObject({ caption: "old words", place: "the lake" });
  });

  it("answers invalid to garbage input instead of throwing", async () => {
    expect(await updateMediaFromClaim(null)).toEqual({ ok: false, code: "invalid" });
    expect(await updateMediaFromClaim({ claimToken: TOKEN })).toEqual({ ok: false, code: "invalid" });
  });

  it("leaves fields that were not sent alone", async () => {
    await updateMediaFromClaim({ claimToken: TOKEN, mediaId: ID, changes: { place: "Broadmead" } });
    expect(mediaRows[0]).toMatchObject({ caption: "old words", approxDateText: null, place: "Broadmead" });
  });

  it("rejects a removed file, a wrong token and invalid input without writing", async () => {
    expect(await updateMediaFromClaim({ claimToken: "x".repeat(43), mediaId: ID, changes: { caption: "x" } })).toEqual({ ok: false, code: "not_found" });
    expect(await updateMediaFromClaim({ claimToken: TOKEN, mediaId: ID, changes: { caption: "x".repeat(2001) } })).toEqual({ ok: false, code: "invalid" });
    mediaRows[0]!.deletedAt = new Date();
    expect(await updateMediaFromClaim({ claimToken: TOKEN, mediaId: ID, changes: { caption: "x" } })).toEqual({ ok: false, code: "not_found" });
    mediaRows[0]!.deletedAt = null; mediaRows[0]!.status = "PENDING";
    expect(await updateMediaFromClaim({ claimToken: TOKEN, mediaId: ID, changes: { caption: "x" } })).toEqual({ ok: false, code: "not_found" });
    expect(revisions).toHaveLength(0);
  });

  it("exposes the per-file words on the claim view", async () => {
    const found = await getMemoryForClaim(TOKEN);
    expect(found?.media[0]).toMatchObject({ caption: "old words", approxDateText: null, place: "the lake" });
  });
});
