import { describe, expect, it } from "vitest";

import { claimSaveMessage, REVIEW_AGAIN } from "@/lib/memories/review-again";

describe("claimSaveMessage (plan 2026-11-08 D17, TCR round 1 B1-2)", () => {
  it("says Saved. when nothing went back for review", () => {
    expect(claimSaveMessage({ reopened: false, reopenedOthers: 0 })).toBe("Saved.");
  });

  it("keeps the D17 message when only this memory went back", () => {
    expect(claimSaveMessage({ reopened: true, reopenedOthers: 0 })).toBe(REVIEW_AGAIN);
  });

  it.each([
    [1, "Saved. Your name and relationship also show on one other memory; the family will take another look at it before it is back on See memories."],
    [3, "Saved. Your name and relationship also show on 3 other memories; the family will take another look at them before they are back on See memories."],
  ])("names the %s other memories that went back when this one did not", (reopenedOthers, message) => {
    expect(claimSaveMessage({ reopened: false, reopenedOthers })).toBe(message);
  });

  it.each([
    [1, "Saved. The family will take another look at this memory and the other one with your name before they are back on See memories."],
    [2, "Saved. The family will take another look at this memory and the 2 others with your name before they are back on See memories."],
  ])("names this memory and the %s others when both went back", (reopenedOthers, message) => {
    expect(claimSaveMessage({ reopened: true, reopenedOthers })).toBe(message);
  });
});

describe("claimSaveMessage after Share (TCR round 1 regression review, item a)", () => {
  it("thanks the sender when nothing else went back", () => {
    expect(claimSaveMessage({ shared: true, reopened: false, reopenedOthers: 0 })).toBe("Thank you. Your memory is with the family.");
  });

  it.each([
    [1, "Thank you. Your memory is with the family. Your name and relationship also show on one other memory; the family will take another look at it before it is back on See memories."],
    [2, "Thank you. Your memory is with the family. Your name and relationship also show on 2 other memories; the family will take another look at them before they are back on See memories."],
  ])("also names the %s other memories a name change in the same save sent back", (reopenedOthers, message) => {
    expect(claimSaveMessage({ shared: true, reopened: false, reopenedOthers })).toBe(message);
  });
});
