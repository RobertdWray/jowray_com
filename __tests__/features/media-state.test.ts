import { beforeEach, describe, expect, it, vi } from "vitest";

import { appendClaimRevision, appendRevision } from "@/features/memories/media-state";

interface Rev { memoryId: string; changedVia: string; before: Record<string, unknown>; after: Record<string, unknown> }
const revisions: Rev[] = [];
const tx = {
  memoryRevision: {
    count: vi.fn(async () => revisions.length),
    create: vi.fn(async ({ data }: { data: Rev }) => { revisions.push(data); return data; }),
  },
} as unknown as Parameters<typeof appendRevision>[0];

beforeEach(() => { revisions.length = 0; });

describe("appendRevision", () => {
  it("writes the revision with the given changedVia and records the consent version on a memory's first revision only", async () => {
    await appendRevision(tx, { memoryId: "mem_1", changedVia: "ADMIN", before: { status: "PENDING" }, after: { status: "APPROVED" }, consentVersion: "2026-11-v2" });
    await appendRevision(tx, { memoryId: "mem_1", changedVia: "ADMIN", before: { place: null }, after: { place: "Baltimore" }, consentVersion: "2026-11-v2" });
    expect(revisions[0]).toEqual({ memoryId: "mem_1", changedVia: "ADMIN", before: { status: "PENDING" }, after: { status: "APPROVED", consentVersion: "2026-11-v2" } });
    expect(revisions[1]).toEqual({ memoryId: "mem_1", changedVia: "ADMIN", before: { place: null }, after: { place: "Baltimore" } });
  });

  it("appendClaimRevision is the CLAIM_LINK wrapper", async () => {
    await appendClaimRevision(tx, { memoryId: "mem_1", before: {}, after: { note: "x" }, consentVersion: "v" });
    expect(revisions[0]).toMatchObject({ changedVia: "CLAIM_LINK", after: { note: "x", consentVersion: "v" } });
  });
});
