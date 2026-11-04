/**
 * Who can see a memory, in the plain words the forms use. The stored values
 * are unchanged; only the labels are plainer: the audience is largely 70+ and
 * should know exactly whom they are choosing (WCAG 3.3.2). The order is the
 * form's order, public first.
 *
 * D13 (2026-11-03) gave the share and claim forms three options. Amended on
 * 2026-11-04 (Rob's item 5, ruling 3): contributors see two, "Everyone" and
 * "Family", Everyone first and default; PRIVATE is the family admins' to set,
 * so the admin forms keep all three (`VISIBILITY_OPTIONS`) and a claim page
 * whose memory is already PRIVATE keeps that value selectable (D5).
 */
export type Visibility = "PUBLIC" | "FAMILY" | "PRIVATE";

export const VISIBILITY_OPTIONS: ReadonlyArray<{ value: Visibility; label: string }> = [
  { value: "PUBLIC", label: "Everyone who visits jowray.com" },
  { value: "FAMILY", label: "The whole family" },
  { value: "PRIVATE", label: "Richard, Rob and Tracy only" },
];

/** The values a contributor may choose on /share and a claim page. */
export const CONTRIBUTOR_VISIBILITIES = ["PUBLIC", "FAMILY"] as const;
export type ContributorVisibility = (typeof CONTRIBUTOR_VISIBILITIES)[number];

export function isContributorVisibility(value: string): value is ContributorVisibility {
  return (CONTRIBUTOR_VISIBILITIES as ReadonlyArray<string>).includes(value);
}

const CONTRIBUTOR_OPTIONS: ReadonlyArray<{ value: Visibility; label: string }> = [
  { value: "PUBLIC", label: "Everyone" },
  { value: "FAMILY", label: "Family" },
];

/**
 * The options a contributor form shows: Everyone and Family, plus the memory's
 * current PRIVATE so a claim page's save never changes it behind the person's back.
 */
export function contributorVisibilityOptions(current?: Visibility): ReadonlyArray<{ value: Visibility; label: string }> {
  if (current === "PRIVATE") {
    return [...CONTRIBUTOR_OPTIONS, VISIBILITY_OPTIONS[2]!];
  }
  return CONTRIBUTOR_OPTIONS;
}
