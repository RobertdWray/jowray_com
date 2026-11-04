import type { ClipVerdict } from "@/lib/audio-level";
import { MAX_FILES_PER_MEMORY, maxBytesFor, memoryTypeFor, normalizeMime, type MediaKind } from "@/lib/media-types";
import { MAX_MEMORIES_PER_SUBMISSION } from "@/lib/validations/memory";

/**
 * The memory cards of the /share form (Task 15), as plain data and a pure
 * reducer so the add/open/remove/edit/restore logic is tested in Node and the
 * component only renders. Browser-safe: no server-only imports.
 */

export const MAX_CARDS = MAX_MEMORIES_PER_SUBMISSION;
/** Cards 1–3 exist from the start: the first open, the next two as compact placeholders (D11). */
const INITIAL_CARDS = 3;

export interface CardMediaItem {
  id: string;
  kind: MediaKind;
  name: string;
  size: number;
  /** Canonical, from `normalizeMime`. */
  mimeType: string;
  /** A picked or captured file, or a clip from the in-page recorder (two-step remove). */
  source: "file" | "recording";
  durationSeconds: number | null;
  file: File;
  /** The recorder's judgement of a clip; null for files. */
  verdict: ClipVerdict | null;
}

export interface MemoryCard {
  id: string;
  /** False for a compact placeholder (cards 2–3 on computers before they are opened). */
  open: boolean;
  approxDateText: string;
  place: string;
  note: string;
  media: CardMediaItem[];
}

export interface CardsState {
  cards: MemoryCard[];
  nextId: number;
  /** A polite announcement for the live region, consumed with `ack`. */
  notice: string | null;
  /** The card whose heading should take focus next, consumed with `ack`. */
  focusId: string | null;
  /** The card just added, whose heading takes focus, consumed with `ack`. */
  lastAddedId: string | null;
}

export type CardTextField = "approxDateText" | "place" | "note";

export interface DraftCard {
  approxDateText: string;
  place: string;
  note: string;
}

export type CardsAction =
  | { type: "open"; id: string }
  | { type: "add" }
  | { type: "remove"; id: string }
  | { type: "clear"; id: string }
  | { type: "field"; id: string; field: CardTextField; value: string }
  | { type: "addMedia"; id: string; items: CardMediaItem[] }
  | { type: "removeMedia"; id: string; mediaId: string }
  | { type: "restore"; cards: DraftCard[] }
  | { type: "reset" }
  | { type: "ack" };

export const MAX_CARDS_NOTICE = "That's the most we can take at once. Send these, then add more.";

function blankCard(id: string, open: boolean): MemoryCard {
  return { id, open, approxDateText: "", place: "", note: "", media: [] };
}

export function initialCardsState(): CardsState {
  return {
    cards: Array.from({ length: INITIAL_CARDS }, (_, i) => blankCard(`c${i + 1}`, i === 0)),
    nextId: INITIAL_CARDS + 1,
    notice: null,
    focusId: null,
    lastAddedId: null,
  };
}

export function hasWords(card: Pick<MemoryCard, "note">): boolean {
  return card.note.trim().length > 0;
}

export function isEmpty(card: MemoryCard): boolean {
  return !hasWords(card) && card.approxDateText.trim().length === 0 && card.place.trim().length === 0 && card.media.length === 0;
}

export function hasContent(card: MemoryCard): boolean {
  return !isEmpty(card);
}

/** The cards that will be sent: open cards with something in them. */
export function contentCards(state: Pick<CardsState, "cards">): MemoryCard[] {
  return state.cards.filter((card) => card.open && hasContent(card));
}

const NOUN: Record<MediaKind, { one: string; many: string }> = {
  PHOTO: { one: "a photo", many: "photos" },
  VIDEO: { one: "a video", many: "videos" },
  VOICE: { one: "a voice recording", many: "voice recordings" },
};

/** "Memory 2 · Summer 1985 · Lake George", else the first six words, else the media kind, else "Memory 2". */
export function labelFor(card: Pick<MemoryCard, "approxDateText" | "place" | "note" | "media">, position: number): string {
  const head = `Memory ${position}`;
  const when = card.approxDateText.trim();
  const where = card.place.trim();
  if (when || where) {
    return [head, when, where].filter((part) => part.length > 0).join(" · ");
  }
  const words = card.note.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length > 0) {
    return `${head} · ${words.slice(0, 6).join(" ")}${words.length > 6 ? "…" : ""}`;
  }
  if (card.media.length > 0) {
    const counts = new Map<MediaKind, number>();
    for (const item of card.media) {
      counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    }
    const parts = (["PHOTO", "VIDEO", "VOICE"] as const)
      .filter((kind) => counts.has(kind))
      .map((kind) => (counts.get(kind) === 1 ? NOUN[kind].one : `${counts.get(kind)} ${NOUN[kind].many}`));
    return `${head} · ${parts.join(" and ")}`;
  }
  return head;
}

export interface SendIssue {
  cardId: string;
  /** 1-based, among the open cards. */
  position: number;
  field: "note";
  message: string;
}

/**
 * What stops a send (WCAG 3.3.1): an open card with a date or place but no
 * file and no words, or nothing at all anywhere. Empty placeholders and empty
 * open cards beyond the first are simply not sent.
 */
export function validateForSend(cards: MemoryCard[]): SendIssue[] {
  const open = cards.filter((card) => card.open);
  const issues: SendIssue[] = [];
  open.forEach((card, i) => {
    const position = i + 1;
    const needsContent = card.media.length === 0 && !hasWords(card);
    if (needsContent && (hasContent(card) || (position === 1 && open.every((c) => isEmpty(c))))) {
      issues.push({ cardId: card.id, position, field: "note", message: `Memory ${position} needs a recording, a file or a few words.` });
    }
  });
  return issues;
}

export type RefusalReason = "unsupported_type" | "too_large" | "duplicate" | "too_many";

export interface Refusal {
  name: string;
  reason: RefusalReason;
  message: string;
}

export const TOO_MANY_FILES_MESSAGE = "That's ten files for this memory, the most one can hold. Start another memory for the rest.";

function tooLargeMessage(kind: MediaKind): string {
  const mb = Math.round(maxBytesFor(kind === "PHOTO" ? "image/jpeg" : kind === "VOICE" ? "audio/mp4" : "video/mp4") / (1024 * 1024));
  if (kind === "VIDEO") {
    return `That video is over ${mb} MB. A shorter clip will fit.`;
  }
  if (kind === "VOICE") {
    return `That recording is over ${mb} MB. A shorter one will fit.`;
  }
  return `That photo is over ${mb} MB. A smaller copy will fit.`;
}

/**
 * Check picked files as they arrive: `accept` only hints (C41), so the type,
 * the size ceiling, duplicates (by name and size, against the card and within
 * the pick) and the ten-file cap are decided here, with the copy the card shows.
 */
export function acceptFiles(card: MemoryCard, files: File[], newId: () => string): { accepted: CardMediaItem[]; refused: Refusal[] } {
  const accepted: CardMediaItem[] = [];
  const refused: Refusal[] = [];
  const seen = new Set(card.media.map((m) => `${m.name}\u0000${m.size}`));
  let room = MAX_FILES_PER_MEMORY - card.media.length;
  for (const file of files) {
    const mimeType = normalizeMime(file.type, file.name);
    if (!mimeType) {
      refused.push({ name: file.name, reason: "unsupported_type", message: `We can't take ${file.name}. Photos, videos and voice recordings are what we can hold.` });
      continue;
    }
    const kind = memoryTypeFor(mimeType);
    if (file.size > maxBytesFor(mimeType)) {
      refused.push({ name: file.name, reason: "too_large", message: tooLargeMessage(kind) });
      continue;
    }
    const key = `${file.name}\u0000${file.size}`;
    if (seen.has(key)) {
      refused.push({ name: file.name, reason: "duplicate", message: "That one's already here." });
      continue;
    }
    if (room <= 0) {
      refused.push({ name: file.name, reason: "too_many", message: TOO_MANY_FILES_MESSAGE });
      continue;
    }
    seen.add(key);
    room -= 1;
    accepted.push({ id: newId(), kind, name: file.name, size: file.size, mimeType, source: "file", durationSeconds: null, file, verdict: null });
  }
  return { accepted, refused };
}

function updateCard(state: CardsState, id: string, change: (card: MemoryCard) => MemoryCard): CardsState {
  return { ...state, cards: state.cards.map((card) => (card.id === id ? change(card) : card)) };
}

export function cardsReducer(state: CardsState, action: CardsAction): CardsState {
  switch (action.type) {
    case "open": {
      // Opening a later placeholder opens the waiting ones before it too, so open cards never straddle a closed one and no heading repeats.
      const index = state.cards.findIndex((card) => card.id === action.id);
      if (index === -1) {
        return state;
      }
      return { ...state, cards: state.cards.map((card, i) => (i <= index && !card.open ? { ...card, open: true } : card)) };
    }
    case "add": {
      // A placeholder still waiting opens before a new card is appended, so open cards never straddle a closed one.
      const waiting = state.cards.find((card) => !card.open);
      if (waiting) {
        return { ...updateCard(state, waiting.id, (card) => ({ ...card, open: true })), lastAddedId: waiting.id, notice: null };
      }
      if (state.cards.length >= MAX_CARDS) {
        return { ...state, notice: MAX_CARDS_NOTICE };
      }
      const id = `c${state.nextId}`;
      return { ...state, cards: [...state.cards, blankCard(id, true)], nextId: state.nextId + 1, lastAddedId: id, notice: null };
    }
    case "remove": {
      const index = state.cards.findIndex((card) => card.id === action.id);
      // The first card is the one every layout shows; it is cleared, never removed.
      if (index <= 0) {
        return state;
      }
      const cards = state.cards.filter((card) => card.id !== action.id);
      // Headings count open cards only, so the announcement does too.
      const position = state.cards.slice(0, index).filter((card) => card.open).length + 1;
      const remaining = cards.filter((card) => card.open).length;
      return { ...state, cards, notice: `Memory ${position} removed. You now have ${remaining} ${remaining === 1 ? "memory" : "memories"}.`, focusId: state.cards[index - 1]!.id };
    }
    case "clear":
      return updateCard(state, action.id, (card) => blankCard(card.id, true));
    case "field":
      return updateCard(state, action.id, (card) => ({ ...card, [action.field]: action.value }));
    case "addMedia":
      return updateCard(state, action.id, (card) => ({ ...card, media: [...card.media, ...action.items] }));
    case "removeMedia":
      return updateCard(state, action.id, (card) => ({ ...card, media: card.media.filter((m) => m.id !== action.mediaId) }));
    case "restore": {
      const count = Math.max(INITIAL_CARDS, Math.min(action.cards.length, MAX_CARDS));
      const cards = Array.from({ length: count }, (_, i) => {
        const draft = action.cards[i];
        const open = i === 0 || (draft !== undefined && i < action.cards.length);
        return { ...blankCard(`c${i + 1}`, open), ...(draft ?? {}) };
      });
      return { ...state, cards, nextId: count + 1 };
    }
    case "reset":
      return initialCardsState();
    case "ack":
      return state.notice === null && state.focusId === null && state.lastAddedId === null ? state : { ...state, notice: null, focusId: null, lastAddedId: null };
  }
}
