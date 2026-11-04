import { describe, expect, it } from "vitest";

import { contributorVisibilityOptions, isContributorVisibility, VISIBILITY_OPTIONS } from "@/lib/visibility";

describe("contributorVisibilityOptions (Rob's item 5, ruling 3, 2026-11-04)", () => {
  it("offers Everyone then Family, nothing else, Everyone first so it is the default", () => {
    expect(contributorVisibilityOptions()).toEqual([
      { value: "PUBLIC", label: "Everyone" },
      { value: "FAMILY", label: "Family" },
    ]);
  });

  it("keeps a memory's current PRIVATE as a third option, so a claim page never changes it behind the person's back (D5)", () => {
    expect(contributorVisibilityOptions("PRIVATE")).toEqual([
      { value: "PUBLIC", label: "Everyone" },
      { value: "FAMILY", label: "Family" },
      { value: "PRIVATE", label: "Richard, Rob and Tracy only" },
    ]);
  });

  it("a current PUBLIC or FAMILY adds nothing", () => {
    expect(contributorVisibilityOptions("PUBLIC")).toHaveLength(2);
    expect(contributorVisibilityOptions("FAMILY")).toHaveLength(2);
  });

  it("the admin forms keep all three stored values", () => {
    expect(VISIBILITY_OPTIONS.map((o) => o.value)).toEqual(["PUBLIC", "FAMILY", "PRIVATE"]);
  });

  it("isContributorVisibility accepts the two contributor values only", () => {
    expect(isContributorVisibility("PUBLIC")).toBe(true);
    expect(isContributorVisibility("FAMILY")).toBe(true);
    expect(isContributorVisibility("PRIVATE")).toBe(false);
    expect(isContributorVisibility("FRIENDS")).toBe(false);
  });
});
