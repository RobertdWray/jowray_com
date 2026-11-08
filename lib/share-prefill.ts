import type { RememberedContributor } from "@/lib/remembered-contributor";

export interface SharePrefill {
  firstName: string;
  name: string;
  email: string;
}

export type ContributorSource = "invite" | "remembered" | "draft" | "none";

/** A shared device must never pair one person's name or relationship with another's email (D3). */
export function initialContributor({ draft, prefill, remembered }: {
  draft: { name: string; relationship: string } | null;
  prefill: SharePrefill | null;
  remembered: RememberedContributor | null;
}): { name: string; email: string; relationship: string; source: ContributorSource } {
  if (prefill) {
    const sameEmail = remembered?.email?.trim().toLowerCase() === prefill.email.trim().toLowerCase();
    const name = sameEmail && remembered?.name?.trim() ? remembered.name : prefill.name;
    const sameName = draft?.name.trim().toLowerCase() === name.trim().toLowerCase();
    return {
      name,
      email: prefill.email,
      relationship: sameEmail
        ? sameName && draft?.relationship.trim() ? draft.relationship : remembered?.relationship || ""
        : sameName ? draft?.relationship || "" : "",
      source: sameEmail ? "remembered" : "invite",
    };
  }

  // Without an invite, preserve the existing /share draft and remembered defaults.
  return {
    name: draft?.name || remembered?.name || "",
    email: remembered?.email || "",
    relationship: draft?.relationship || remembered?.relationship || "",
    source: remembered ? "remembered" : draft?.name ? "draft" : "none",
  };
}
