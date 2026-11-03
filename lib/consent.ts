/**
 * Consent is implicit for this friends-and-family memorial (Rob, 2026-11-03):
 * sharing a memory means the family may keep it and show it within the
 * memorial and do other creative, respectful things to help remember Jo
 * (wording `2026-11-v2`, Rob, 2026-11-03). No consent checkbox is shown; the
 * contact checkbox below is a preference and is on by default (Rob, 2026-11-03).
 * CONSENT_VERSION is still stored on every memory so a later change of terms
 * can be told apart from this one; the text of each version lives in
 * docs/consent/<CONSENT_VERSION>.md.
 */
export const IMPLICIT_CONSENT_NOTE =
  "By sharing, you let the family keep this memory and show it within the memorial, and do other creative, respectful things to help us remember Jo.";

export const CONTACT_OPT_IN_LABEL = "The family may contact me at this email address about this memory.";

/** Per memory; on by default (Rob, 2026-11-03). Stored as Memory.notifyWhenPosted. */
export const NOTIFY_WHEN_POSTED_LABEL = "Let me know when my story is posted in Jo's story collection.";

/** Per contributor; off by default (Rob, 2026-11-03). Stored as Contributor.mailingListOptIn. */
export const MAILING_LIST_LABEL = "Sign up for our weekly mailing list to be notified when new memories are posted.";
