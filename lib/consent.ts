/**
 * The consent sentences in force, keyed by CONSENT_VERSION. The human copy of
 * each version is committed as docs/consent/<version>.md; the two must match.
 * A version with no entry here fails closed: nothing can be submitted.
 */
export interface ConsentText {
  /** Required checkbox on the form. */
  storage: string;
  /** Optional checkbox on the form; feeds Contributor.contactOptIn. */
  contact: string;
  /** "How memories are used" sentence in the confirmation email. */
  usage: string;
}

export const CONSENT_TEXTS: Record<string, ConsentText> = {
  // DRAFT wording pending Rob's approval (plan Task 0 step 6).
  "2026-11-v1": {
    storage:
      "I agree that this memory, and my name and relationship as I have given them, may be stored and shared with the family as part of this memorial.",
    contact: "The family may contact me at this email address about this memory.",
    usage:
      "Memories are kept privately for the family; they are shared only within the memorial unless you choose otherwise.",
  },
};

export function consentTextFor(version: string): ConsentText {
  const text = CONSENT_TEXTS[version];
  if (!text) {
    throw new Error(`No consent text is defined for CONSENT_VERSION "${version}"`);
  }
  return text;
}
