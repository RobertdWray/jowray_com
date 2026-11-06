import { describe, expect, it } from "vitest";

import {
  acceptFiles,
  cardsReducer,
  contentCards,
  hasContent,
  initialCardsState,
  isEmpty,
  issuesFromSendFailure,
  gpsReadsDue,
  labelFor,
  lookupsDue,
  MAX_CARDS,
  MAX_PLACE_SUGGESTIONS,
  type MemoryCard,
  type CardMediaItem,
  placeSuggestionsFor,
  toDraftCards,
  validateContributor,
  validateForSend,
} from "@/lib/memory-cards";
import { serializeShareDraft } from "@/lib/share-draft";
import { EMAIL_INVALID_MESSAGE, EMAIL_REQUIRED_MESSAGE, NAME_REQUIRED_MESSAGE } from "@/lib/validations/memory";

const MB = 1024 * 1024;
function file(name: string, type: string, size = 10): File {
  return new File([new Uint8Array(size)], name, { type });
}
function item(over: Partial<CardMediaItem> = {}): CardMediaItem {
  return { id: "m1", kind: "PHOTO", name: "IMG_1.jpg", size: 10, mimeType: "image/jpeg", source: "file", durationSeconds: null, file: file("IMG_1.jpg", "image/jpeg"), verdict: null, ...over };
}
function card(over: Partial<MemoryCard> = {}): MemoryCard {
  return { id: "c1", open: true, approxDateText: "", place: "", note: "", media: [], ...over };
}

describe("initial state and helpers", () => {
  it("starts with three deterministic cards: the first open, the next two placeholders", () => {
    const state = initialCardsState();
    expect(state.cards.map((c) => [c.id, c.open])).toEqual([["c1", true], ["c2", false], ["c3", false]]);
    expect(MAX_CARDS).toBe(10);
  });

  it("tells an empty card from one with words, a date, a place or a file", () => {
    expect(isEmpty(card())).toBe(true);
    expect(isEmpty(card({ note: "   " }))).toBe(true);
    expect(hasContent(card({ note: "x" }))).toBe(true);
    expect(hasContent(card({ approxDateText: "1985" }))).toBe(true);
    expect(hasContent(card({ place: "Lake George" }))).toBe(true);
    expect(hasContent(card({ media: [item()] }))).toBe(true);
    const state = { ...initialCardsState(), cards: [card({ id: "c1", note: "a" }), card({ id: "c2", open: true }), card({ id: "c3", open: true, media: [item()] })] };
    expect(contentCards(state).map((c) => c.id)).toEqual(["c1", "c3"]);
  });

  it("labels a memory by its position, date and place, then its first words, then its media kind", () => {
    expect(labelFor(card({ approxDateText: "Summer 1985", place: "Lake George" }), 2)).toBe("Memory 2 · Summer 1985 · Lake George");
    expect(labelFor(card({ place: "Lake George" }), 1)).toBe("Memory 1 · Lake George");
    expect(labelFor(card({ note: "She once taught me to quilt on a rainy afternoon in May" }), 3)).toBe("Memory 3 · She once taught me to quilt…");
    expect(labelFor(card({ note: "Short one." }), 1)).toBe("Memory 1 · Short one.");
    expect(labelFor(card({ media: [item({ kind: "VOICE" })] }), 4)).toBe("Memory 4 · a voice recording");
    expect(labelFor(card({ media: [item(), item({ id: "m2" })] }), 4)).toBe("Memory 4 · 2 photos");
    expect(labelFor(card(), 5)).toBe("Memory 5");
  });
});

describe("validateForSend", () => {
  it("names each card that has details but neither files nor words, and passes when every open card has content or is empty", () => {
    const cards = [card({ id: "c1", note: "words" }), card({ id: "c2", open: true, approxDateText: "1985" }), card({ id: "c3", open: true }), card({ id: "c4", open: true, media: [item()] })];
    expect(validateForSend(cards)).toEqual([{ target: "note", cardId: "c2", position: 2, message: "Memory 2 needs a recording, a file or a few words." }]);
    expect(validateForSend([card({ id: "c1", note: "words" }), card({ id: "c2", open: true })])).toEqual([]);
  });

  it("asks for something when nothing at all was given, in the card's own words", () => {
    expect(validateForSend([card()])).toEqual([{ target: "note", cardId: "c1", position: 1, message: "Memory 1 needs a recording, a file or a few words." }]);
  });
});

describe("validateContributor (Rob's items 1 and 6: the browser says what is missing before the server does)", () => {
  it("names the name first, then the email, in the form's own order", () => {
    expect(validateContributor({ name: "", email: "" })).toEqual([
      { target: "name", message: NAME_REQUIRED_MESSAGE },
      { target: "email", message: EMAIL_REQUIRED_MESSAGE },
    ]);
  });

  it("judges the trimmed values with the server's schemas, so a padded address passes and spaces alone do not", () => {
    expect(validateContributor({ name: "   ", email: "  kay@example.com " })).toEqual([{ target: "name", message: NAME_REQUIRED_MESSAGE }]);
    expect(validateContributor({ name: "Kay", email: "kay@" })).toEqual([{ target: "email", message: EMAIL_INVALID_MESSAGE }]);
  });

  it("passes a valid pair", () => {
    expect(validateContributor({ name: "Jane Doe", email: "jane@example.com" })).toEqual([]);
  });
});

describe("issuesFromSendFailure (the server's refusal lands on the field or the card it names)", () => {
  const cards = [card({ id: "c1", note: "one" }), card({ id: "c2", note: "two" })];

  it("maps a contributor field to that field", () => {
    expect(issuesFromSendFailure({ field: "email", memoryIndex: null, message: "Add your email" }, cards)).toEqual([{ target: "email", message: "Add your email" }]);
    expect(issuesFromSendFailure({ field: "name", memoryIndex: 0, message: "Need a name" }, cards)).toEqual([{ target: "name", message: "Need a name" }]);
  });

  it("maps a memory index to that card's words", () => {
    expect(issuesFromSendFailure({ field: null, memoryIndex: 1, message: "Too long" }, cards)).toEqual([{ target: "note", cardId: "c2", position: 2, message: "Too long" }]);
  });

  it("maps nothing when the refusal names neither, or names a card that is not there", () => {
    expect(issuesFromSendFailure({ field: null, memoryIndex: null, message: "Busy" }, cards)).toEqual([]);
    expect(issuesFromSendFailure({ field: null, memoryIndex: 5, message: "?" }, cards)).toEqual([]);
  });
});

describe("acceptFiles", () => {
  const empty = card();

  it("accepts photos, videos and recordings with their kind, size and normalized type, in the order given", () => {
    const { accepted, refused } = acceptFiles(empty, [file("a.jpg", "image/jpeg", 5), file("clip.webm", "audio/webm;codecs=opus", 7), file("IMG_1.HEIC", "", 9)], () => "id");
    expect(refused).toEqual([]);
    expect(accepted.map((a) => [a.kind, a.mimeType, a.size, a.source])).toEqual([["PHOTO", "image/jpeg", 5, "file"], ["VOICE", "audio/webm", 7, "file"], ["PHOTO", "image/heic", 9, "file"]]);
  });

  it("refuses unsupported types and oversized files with plain copy, and keeps the rest", () => {
    const { accepted, refused } = acceptFiles(empty, [file("x.exe", "application/x-msdownload"), file("big.mp4", "video/mp4", 501 * MB), file("big.jpg", "image/jpeg", 26 * MB), file("ok.png", "image/png")], () => "id");
    expect(accepted.map((a) => a.name)).toEqual(["ok.png"]);
    expect(refused).toEqual([
      { name: "x.exe", reason: "unsupported_type", message: "We can't take x.exe. Photos, videos and voice recordings are what we can hold." },
      { name: "big.mp4", reason: "too_large", message: "That video is over 500 MB. A shorter clip will fit." },
      { name: "big.jpg", reason: "too_large", message: "That photo is over 25 MB. A smaller copy will fit." },
    ]);
  });

  it("refuses a duplicate by name and size, within the pick and against the card", () => {
    const withOne = card({ media: [item({ name: "a.jpg", size: 5 })] });
    const { accepted, refused } = acceptFiles(withOne, [file("a.jpg", "image/jpeg", 5), file("b.jpg", "image/jpeg", 5), file("b.jpg", "image/jpeg", 5)], () => "id");
    expect(accepted.map((a) => a.name)).toEqual(["b.jpg"]);
    expect(refused.map((r) => [r.name, r.reason, r.message])).toEqual([["a.jpg", "duplicate", "That one's already here."], ["b.jpg", "duplicate", "That one's already here."]]);
  });

  it("stops at ten files per memory with the limit copy", () => {
    const nine = card({ media: Array.from({ length: 9 }, (_, i) => item({ id: `m${i}`, name: `p${i}.jpg`, size: i + 1 })) });
    const { accepted, refused } = acceptFiles(nine, [file("ten.jpg", "image/jpeg", 100), file("eleven.jpg", "image/jpeg", 101)], () => "id");
    expect(accepted.map((a) => a.name)).toEqual(["ten.jpg"]);
    expect(refused).toEqual([{ name: "eleven.jpg", reason: "too_many", message: "That's ten files for this memory, the most one can hold. Start another memory for the rest." }]);
  });
});

describe("cardsReducer", () => {
  const start = initialCardsState();

  it("opens a placeholder, adds cards up to ten (a waiting placeholder opens first), and reports the limit", () => {
    let state = cardsReducer(start, { type: "open", id: "c2" });
    expect(state.cards[1]!.open).toBe(true);
    state = cardsReducer(state, { type: "add" });
    expect(state.cards).toHaveLength(3);
    expect(state.cards[2]!.open).toBe(true);
    expect(state.lastAddedId).toBe("c3");
    for (let i = 0; i < 7; i += 1) {
      state = cardsReducer(state, { type: "add" });
    }
    expect(state.cards).toHaveLength(10);
    expect(state.cards.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10"]);
    expect(state.cards.every((c) => c.open)).toBe(true);
    expect(state.lastAddedId).toBe("c10");
    const full = cardsReducer(state, { type: "add" });
    expect(full.cards).toHaveLength(10);
    expect(full.notice).toBe("That's the most we can take at once. Send these, then add more.");
  });

  it("opening a later placeholder opens the waiting ones before it, so headings never repeat on the page", () => {
    const state = cardsReducer(start, { type: "open", id: "c3" });
    expect(state.cards.map((c) => [c.id, c.open])).toEqual([["c1", true], ["c2", true], ["c3", true]]);
  });

  it("counts only open cards when announcing a removal", () => {
    // c2 opened and filled, c3 still a placeholder, c4 added: removing c4 leaves two open cards.
    let state = cardsReducer(start, { type: "open", id: "c2" });
    state = cardsReducer(state, { type: "field", id: "c2", field: "note", value: "second" });
    state = { ...state, cards: [...state.cards, { id: "c4", open: true, approxDateText: "", place: "", note: "", media: [] }], nextId: 5 };
    state = cardsReducer(state, { type: "remove", id: "c4" });
    expect(state.notice).toBe("Memory 3 removed. You now have 2 memories.");
  });

  it("edits fields, adds and removes media, on the right card only", () => {
    let state = cardsReducer(start, { type: "field", id: "c1", field: "note", value: "hello" });
    state = cardsReducer(state, { type: "field", id: "c1", field: "approxDateText", value: "1985" });
    state = cardsReducer(state, { type: "addMedia", id: "c1", items: [item({ id: "m1" }), item({ id: "m2", name: "b.jpg" })] });
    expect(state.cards[0]).toMatchObject({ note: "hello", approxDateText: "1985" });
    expect(state.cards[0]!.media.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(state.cards[1]!.media).toEqual([]);
    state = cardsReducer(state, { type: "removeMedia", id: "c1", mediaId: "m1" });
    expect(state.cards[0]!.media.map((m) => m.id)).toEqual(["m2"]);
  });

  it("removes a card and renumbers the rest, announcing it; never removes the first card, which is cleared instead", () => {
    let state = cardsReducer(start, { type: "open", id: "c2" });
    state = cardsReducer(state, { type: "field", id: "c2", field: "note", value: "second" });
    state = cardsReducer(state, { type: "add" }); // opens c3
    state = cardsReducer(state, { type: "add" }); // appends c4
    state = cardsReducer(state, { type: "remove", id: "c2" });
    expect(state.cards.map((c) => c.id)).toEqual(["c1", "c3", "c4"]);
    expect(state.notice).toBe("Memory 2 removed. You now have 3 memories.");
    expect(state.focusId).toBe("c1");
    const cleared = cardsReducer(cardsReducer(state, { type: "field", id: "c1", field: "note", value: "x" }), { type: "clear", id: "c1" });
    expect(cleared.cards[0]).toMatchObject({ id: "c1", open: true, note: "", media: [] });
    expect(cardsReducer(state, { type: "remove", id: "c1" }).cards.map((c) => c.id)).toEqual(["c1", "c3", "c4"]);
  });

  it("restores a draft into the cards (card 1 always open, extra cards opened as needed) and resets to the start", () => {
    const restored = cardsReducer(start, { type: "restore", cards: [{ approxDateText: "1985", place: "", note: "one" }, { approxDateText: "", place: "", note: "two" }, { approxDateText: "", place: "x", note: "" }, { approxDateText: "", place: "", note: "four" }] });
    expect(restored.cards.map((c) => [c.id, c.open, c.note])).toEqual([["c1", true, "one"], ["c2", true, "two"], ["c3", true, ""], ["c4", true, "four"]]);
    expect(restored.cards[2]!.place).toBe("x");
    expect(cardsReducer(restored, { type: "reset" })).toEqual(initialCardsState());
  });

  it("clears a transient notice and focus request once consumed", () => {
    const state = cardsReducer(cardsReducer(start, { type: "add" }), { type: "ack" });
    expect(state.notice).toBeNull();
    expect(state.focusId).toBeNull();
    expect(state.lastAddedId).toBeNull();
  });
});

describe("photo place suggestions (plan 2026-11-06-photo-gps-places B6)", () => {
  const LIBERTY = { latitude: 40.689247, longitude: -74.044502 };
  const photo = (id: string, over: Partial<CardMediaItem> = {}) => item({ id, name: `${id}.jpg`, ...over });
  const stateWith = (media: CardMediaItem[]) => ({ ...initialCardsState(), cards: [card({ media }), card({ id: "c2", open: false })] });

  it("setMediaGps records the photo's point (found) or null (none or failed) on that item only", () => {
    const state = stateWith([photo("m1"), photo("m2")]);
    const found = cardsReducer(state, { type: "setMediaGps", id: "c1", mediaId: "m1", gps: LIBERTY });
    expect(found.cards[0]!.media.map((m) => m.gps)).toEqual([LIBERTY, undefined]);
    const none = cardsReducer(found, { type: "setMediaGps", id: "c1", mediaId: "m2", gps: null });
    expect(none.cards[0]!.media.map((m) => m.gps)).toEqual([LIBERTY, null]);
  });

  it("setMediaPlaces records the labels, [] for looked up with nothing usable, or null for none or failed", () => {
    let state = stateWith([photo("m1", { gps: LIBERTY }), photo("m2", { gps: LIBERTY }), photo("m3", { gps: LIBERTY })]);
    state = cardsReducer(state, { type: "setMediaPlaces", id: "c1", mediaId: "m1", labels: ["New York, New York"] });
    state = cardsReducer(state, { type: "setMediaPlaces", id: "c1", mediaId: "m2", labels: [] });
    state = cardsReducer(state, { type: "setMediaPlaces", id: "c1", mediaId: "m3", labels: null });
    expect(state.cards[0]!.media.map((m) => m.placeLabels)).toEqual([["New York, New York"], [], null]);
  });

  it("drops a result for a photo that was removed meanwhile, or a card that is gone: the state is returned unchanged", () => {
    const state = stateWith([photo("m1")]);
    expect(cardsReducer(state, { type: "setMediaGps", id: "c1", mediaId: "gone", gps: LIBERTY })).toBe(state);
    expect(cardsReducer(state, { type: "setMediaPlaces", id: "c1", mediaId: "gone", labels: ["X"] })).toBe(state);
    expect(cardsReducer(state, { type: "setMediaGps", id: "c9", mediaId: "m1", gps: LIBERTY })).toBe(state);
    const removed = cardsReducer(state, { type: "removeMedia", id: "c1", mediaId: "m1" });
    expect(cardsReducer(removed, { type: "setMediaPlaces", id: "c1", mediaId: "m1", labels: ["X"] })).toBe(removed);
  });

  it("gpsReadsDue: picked photos not read yet, on any card; never videos, voice notes or recordings, never twice", () => {
    const state = {
      ...initialCardsState(),
      cards: [
        card({ media: [photo("p1"), item({ id: "v1", kind: "VIDEO", mimeType: "video/mp4", name: "v.mp4" }), photo("p2", { gps: null }), photo("p3", { gps: LIBERTY })] }),
        card({ id: "c2", media: [photo("p4"), item({ id: "a1", kind: "VOICE", mimeType: "audio/webm", source: "recording", name: "r.webm" })] }),
      ],
    };
    expect(gpsReadsDue(state.cards).map((due) => [due.cardId, due.item.id])).toEqual([["c1", "p1"], ["c2", "p4"]]);
  });

  it("lookupsDue: photos with a point and no labels yet; never a photo without GPS or already looked up", () => {
    const cards = [card({ media: [photo("p1", { gps: LIBERTY }), photo("p2", { gps: null }), photo("p3", { gps: LIBERTY, placeLabels: [] }), photo("p4"), photo("p5", { gps: LIBERTY, placeLabels: null })] })];
    expect(lookupsDue(cards).map((due) => [due.cardId, due.item.id, due.point])).toEqual([["c1", "p1", LIBERTY]]);
  });

  it("placeSuggestionsFor: nothing without GPS (none found, or still being read)", () => {
    expect(placeSuggestionsFor(card({ media: [] }))).toEqual({ hasGps: false, pending: false, labels: [] });
    expect(placeSuggestionsFor(card({ media: [photo("p1"), photo("p2", { gps: null })] }))).toEqual({ hasGps: false, pending: false, labels: [] });
  });

  it("placeSuggestionsFor: pending while a photo with GPS waits for its labels; settled with none usable", () => {
    expect(placeSuggestionsFor(card({ media: [photo("p1", { gps: LIBERTY })] }))).toEqual({ hasGps: true, pending: true, labels: [] });
    expect(placeSuggestionsFor(card({ media: [photo("p1", { gps: LIBERTY, placeLabels: [] })] }))).toEqual({ hasGps: true, pending: false, labels: [] });
    expect(placeSuggestionsFor(card({ media: [photo("p1", { gps: LIBERTY, placeLabels: null })] }))).toEqual({ hasGps: true, pending: false, labels: [] });
  });

  it("placeSuggestionsFor: unique labels card-wide, in photo order, at most six", () => {
    const media = [
      photo("p1", { gps: LIBERTY, placeLabels: ["Statue of Liberty, New York, New York", "New York, New York"] }),
      item({ id: "v1", kind: "VIDEO", mimeType: "video/mp4", name: "v.mp4", placeLabels: ["Not A Photo"] }),
      photo("p2", { gps: LIBERTY, placeLabels: ["New York, New York", "Ellis Island, Jersey City, New Jersey"] }),
      photo("p3", { gps: LIBERTY, placeLabels: ["A, B", "C, D"] }),
      photo("p4", { gps: LIBERTY, placeLabels: ["E, F", "G, H"] }),
      photo("p5", { gps: LIBERTY }),
    ];
    const suggestions = placeSuggestionsFor(card({ media }));
    expect(MAX_PLACE_SUGGESTIONS).toBe(6);
    expect(suggestions).toEqual({
      hasGps: true,
      pending: true,
      labels: ["Statue of Liberty, New York, New York", "New York, New York", "Ellis Island, Jersey City, New Jersey", "A, B", "C, D", "E, F"],
    });
  });

  it("never reaches the saved draft: toDraftCards keeps the three typed fields of open cards, and the stored draft has no GPS or labels", () => {
    const cards = [
      card({ place: "Liberty Island", note: "We took the ferry.", media: [photo("p1", { gps: LIBERTY, placeLabels: ["Statue of Liberty, New York, New York"] })] }),
      card({ id: "c2", open: false, media: [photo("p2", { gps: LIBERTY })] }),
    ];
    const draftCards = toDraftCards(cards);
    expect(draftCards).toEqual([{ approxDateText: "", place: "Liberty Island", note: "We took the ferry." }]);
    const stored = serializeShareDraft({ contributor: { name: "A", relationship: "" }, cards: draftCards }, 0);
    expect(stored).not.toMatch(/gps|placeLabels|latitude|longitude|40\.68|74\.04|Statue of Liberty/);
    // Even a card object passed straight to the serializer loses everything but its three fields.
    const leaky = serializeShareDraft({ contributor: { name: "A", relationship: "" }, cards: cards as unknown as typeof draftCards }, 0);
    expect(leaky).not.toMatch(/gps|placeLabels|latitude|40\.68|media/);
  });

  it("a restored draft holds no files, so no GPS read or lookup is due", () => {
    const restored = cardsReducer(initialCardsState(), { type: "restore", cards: [{ approxDateText: "1985", place: "Lake George", note: "words" }] });
    expect(gpsReadsDue(restored.cards)).toEqual([]);
    expect(lookupsDue(restored.cards)).toEqual([]);
  });
});
