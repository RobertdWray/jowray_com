import { z } from "zod";

export const SHARE_DRAFT_KEY = "jowray.share.draft.v1";
export const SHARE_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface ShareDraft {
  name: string;
  relationship: string;
  approxDateText: string;
  place: string;
  note: string;
}

export const EMPTY_SHARE_DRAFT: ShareDraft = {
  name: "",
  relationship: "",
  approxDateText: "",
  place: "",
  note: "",
};

const draftText = (max: number) => z.string().transform((value) => value.slice(0, max));
const fieldsSchema = z.object({
  name: draftText(120),
  relationship: draftText(120),
  approxDateText: draftText(120),
  place: draftText(200),
  note: draftText(10_000),
});
const storedDraftSchema = z.object({
  v: z.literal(1),
  savedAt: z.number(),
  fields: fieldsSchema,
});

/** Store only the five text fields, capped at their form limits without removing whitespace. */
export function serializeShareDraft(draft: ShareDraft, now: number): string {
  return JSON.stringify({ v: 1, savedAt: now, fields: fieldsSchema.parse(draft) });
}

/** Invalid or expired storage is not a draft; unknown keys are discarded. */
export function parseShareDraft(raw: string | null, now: number): ShareDraft | null {
  if (raw === null) {
    return null;
  }
  try {
    const parsed = storedDraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || now - parsed.data.savedAt > SHARE_DRAFT_TTL_MS) {
      return null;
    }
    return parsed.data.fields;
  } catch {
    return null;
  }
}

export function isShareDraftEmpty(draft: ShareDraft): boolean {
  return Object.values(draft).every((value) => value.trim().length === 0);
}
