import { z } from "zod";

import { MAX_MEMORIES_PER_SUBMISSION } from "@/lib/validations/memory";

/**
 * The typed words of the /share form, kept on this device so a phone that
 * discards the tab (the camera app, microphone help that says "quit and
 * reopen the browser") never loses them. Version 2 holds the contributor's
 * name and relationship once and every card's three text fields; the email is
 * never stored. `localStorage` never expires on its own (C58), so the draft
 * carries `savedAt` and the code enforces the 30-day TTL. A v1 draft (one
 * memory) is migrated into card 1 once and its key removed.
 */

export const SHARE_DRAFT_KEY = "jowray.share.draft.v2";
export const SHARE_DRAFT_V1_KEY = "jowray.share.draft.v1";
export const SHARE_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface ShareDraftCard {
  approxDateText: string;
  place: string;
  note: string;
}

export interface ShareDraft {
  contributor: { name: string; relationship: string };
  cards: ShareDraftCard[];
}

export const EMPTY_SHARE_DRAFT: ShareDraft = { contributor: { name: "", relationship: "" }, cards: [] };

const draftText = (max: number) => z.string().transform((value) => value.slice(0, max));
const cardSchema = z.object({ approxDateText: draftText(120), place: draftText(200), note: draftText(10_000) });
const contributorSchema = z.object({ name: draftText(120), relationship: draftText(120) });
const draftSchema = z.object({
  contributor: contributorSchema,
  cards: z.array(cardSchema).transform((cards) => cards.slice(0, MAX_MEMORIES_PER_SUBMISSION)),
});
const storedV2Schema = z.object({ v: z.literal(2), savedAt: z.number(), contributor: contributorSchema, cards: z.array(cardSchema) });
const storedV1Schema = z.object({
  v: z.literal(1),
  savedAt: z.number(),
  fields: z.object({ name: draftText(120), relationship: draftText(120), approxDateText: draftText(120), place: draftText(200), note: draftText(10_000) }),
});

/** Capped at the form limits (and ten cards) without touching whitespace. */
export function serializeShareDraft(draft: ShareDraft, now: number): string {
  const clean = draftSchema.parse(draft);
  return JSON.stringify({ v: 2, savedAt: now, contributor: clean.contributor, cards: clean.cards });
}

function fresh(savedAt: number, now: number): boolean {
  return now - savedAt <= SHARE_DRAFT_TTL_MS;
}

/** A v2 draft from storage; invalid, expired or wrong-shaped storage is not a draft, and unknown keys are discarded. */
export function parseShareDraft(raw: string | null, now: number): ShareDraft | null {
  if (raw === null) {
    return null;
  }
  try {
    const parsed = storedV2Schema.safeParse(JSON.parse(raw));
    if (!parsed.success || !fresh(parsed.data.savedAt, now)) {
      return null;
    }
    return draftSchema.parse({ contributor: parsed.data.contributor, cards: parsed.data.cards });
  } catch {
    return null;
  }
}

/** A v1 draft (one memory) as a v2 draft with one card, or null. */
export function migrateShareDraftV1(raw: string | null, now: number): ShareDraft | null {
  if (raw === null) {
    return null;
  }
  try {
    const parsed = storedV1Schema.safeParse(JSON.parse(raw));
    if (!parsed.success || !fresh(parsed.data.savedAt, now)) {
      return null;
    }
    const { name, relationship, approxDateText, place, note } = parsed.data.fields;
    return { contributor: { name, relationship }, cards: [{ approxDateText, place, note }] };
  } catch {
    return null;
  }
}

export interface DraftStore {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

/** The current draft: v2 first; otherwise a v1 draft migrated in place (and its key removed); otherwise null. */
export function readShareDraft(store: DraftStore, now: number): ShareDraft | null {
  const v2 = parseShareDraft(store.getItem(SHARE_DRAFT_KEY), now);
  if (v2) {
    return v2;
  }
  const v1Raw = store.getItem(SHARE_DRAFT_V1_KEY);
  if (v1Raw === null) {
    return null;
  }
  const migrated = migrateShareDraftV1(v1Raw, now);
  store.removeItem(SHARE_DRAFT_V1_KEY);
  return migrated;
}

export function isShareDraftEmpty(draft: ShareDraft): boolean {
  const blank = (value: string) => value.trim().length === 0;
  return blank(draft.contributor.name) && blank(draft.contributor.relationship) && draft.cards.every((card) => blank(card.approxDateText) && blank(card.place) && blank(card.note));
}
