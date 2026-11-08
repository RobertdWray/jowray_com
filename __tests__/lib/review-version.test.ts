import { describe, expect, it } from "vitest";

import { computeReviewVersion, type ReviewFacts } from "@/lib/review-version";

const T0 = new Date("2026-11-08T10:00:00.000Z");
const T1 = new Date("2026-11-08T10:00:00.001Z");
const base: ReviewFacts = {
  memoryUpdatedAt: T0,
  contributorUpdatedAt: T0,
  media: [
    { id: "med_a", status: "READY", updatedAt: T0 },
    { id: "med_b", status: "PENDING", updatedAt: T0 },
  ],
};

describe("computeReviewVersion (TCR round 1, B1-3)", () => {
  it("is a stable opaque string for the same facts", () => {
    const version = computeReviewVersion(base);
    expect(version).toMatch(/^rv1\.[A-Za-z0-9_-]{43}$/);
    expect(computeReviewVersion(structuredClone(base))).toBe(version);
  });

  it("does not depend on the order the files were read in", () => {
    expect(computeReviewVersion({ ...base, media: [...base.media].reverse() })).toBe(computeReviewVersion(base));
  });

  it.each([
    ["the memory changes", { memoryUpdatedAt: T1 }],
    ["the contributor changes", { contributorUpdatedAt: T1 }],
    ["the memory has no contributor", { contributorUpdatedAt: null }],
    ["a file changes", { media: [{ id: "med_a", status: "READY", updatedAt: T1 }, base.media[1]!] }],
    ["a file becomes READY", { media: [base.media[0]!, { id: "med_b", status: "READY", updatedAt: T0 }] }],
    ["a file is added", { media: [...base.media, { id: "med_c", status: "PENDING", updatedAt: T0 }] }],
    ["a file is removed (it leaves the live list)", { media: [base.media[0]!] }],
  ] as const)("changes when %s", (_what, change) => {
    expect(computeReviewVersion({ ...base, ...change })).not.toBe(computeReviewVersion(base));
  });
});
