/**
 * Who can see a memory, in the plain words the share and claim forms use
 * (D13, 2026-11-03). The stored values are unchanged; only the labels are
 * plainer: the audience is largely 70+ and should know exactly whom they are
 * choosing (WCAG 3.3.2). The order is the form's order, public first.
 */
export type Visibility = "PUBLIC" | "FAMILY" | "PRIVATE";

export const VISIBILITY_OPTIONS: ReadonlyArray<{ value: Visibility; label: string }> = [
  { value: "PUBLIC", label: "Everyone who visits jowray.com" },
  { value: "FAMILY", label: "The whole family" },
  { value: "PRIVATE", label: "Richard, Rob and Tracy only" },
];
