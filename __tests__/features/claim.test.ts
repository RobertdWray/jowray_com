import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";

const TOKEN = "t".repeat(43);
interface Rev { memoryId: string; changedVia: string; before: Record<string, unknown>; after: Record<string, unknown> }
const revisions: Rev[] = [];
let memory: Record<string, unknown> | null;
const tx = {
  memory: {
    findUnique: vi.fn(async ({ where }: { where: { claimTokenHash?: string; id?: string } }) =>
      memory && (where.claimTokenHash ? memory.claimTokenHash === where.claimTokenHash : memory.id === where.id) ? memory : null),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(memory!, data); return memory; }),
  },
  contributor: { update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(memory!.contributor as object, data); return memory!.contributor; }) },
  memoryRevision: {
    count: vi.fn(async () => revisions.length),
    create: vi.fn(async ({ data }: { data: Rev }) => { revisions.push(data); return { id: `rev_${revisions.length}`, ...data }; }),
  },
};
const dbStub = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

import { getMemoryForClaim, updateMemoryFromClaim } from "@/features/memories/claim";

beforeEach(() => {
  revisions.length = 0;
  memory = {
    id: "mem_1", type: "PHOTO", deletedAt: null, claimTokenHash: hashClaimToken(TOKEN), consentVersion: "2026-11-v1",
    approxDateText: "Summer 1998", place: null, contributorNote: "old note", visibility: "FAMILY",
    contributor: { id: "con_1", name: "Jo", relationship: "friend", email: "jo@example.com" },
    media: [{ id: "med_1", status: "READY", mimeType: "image/heic", originalFilename: "a.heic" }, { id: "med_2", status: "PENDING", mimeType: "video/mp4", originalFilename: null }],
  };
});

describe("getMemoryForClaim", () => {
  it("returns the memory with only READY media for a valid token", async () => {
    const found = await getMemoryForClaim(TOKEN);
    expect(found?.id).toBe("mem_1");
    expect(found?.media.map((m) => m.id)).toEqual(["med_1"]);
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
    expect(result).toEqual({ ok: true });
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
