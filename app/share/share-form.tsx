"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { CONTACT_OPT_IN_LABEL, IMPLICIT_CONSENT_NOTE, MAILING_LIST_LABEL, NOTIFY_WHEN_POSTED_LABEL } from "@/lib/consent";
import { durationSecondsFor } from "@/lib/format-duration";
import {
  type CardIssue,
  type CardMediaItem,
  type CardsAction,
  type CardsState,
  cardsReducer,
  contentCards,
  hasContent,
  issuesFromSendFailure,
  labelFor,
  MAX_CARDS,
  type SendIssue,
  validateContributor,
  validateForSend,
} from "@/lib/memory-cards";
import {
  getRememberedServerSnapshot,
  getRememberedSnapshot,
  rememberContributor,
  subscribeRemembered,
} from "@/lib/remembered-contributor";
import type { ShareDraft } from "@/lib/share-draft";
import { revealScrollDelta, unionRect } from "@/lib/reveal-scroll";
import { type PipelineProgress, runSubmission } from "@/lib/submission-pipeline";
import { uploadWithTicket } from "@/lib/upload-client";
import { contributorVisibilityOptions, isContributorVisibility } from "@/lib/visibility";

import { PrimaryButton, SecondaryButton } from "../_components/buttons";
import { errorClass, helperClass, inputClass, labelClass, linkClass, selectClass } from "../_components/field-classes";
import { SolidHeart } from "../_components/hearts";
import { completeSubmission, createSubmission, finalizeUpload, issueUploadTicket } from "./actions";
import { cardIds, headingFor, MemoryCardSection, MemoryPlaceholder } from "./memory-card-client";
import { pickRecordingType, type Recording } from "./recorder";
import { type SentMemory, ThankYou } from "./thank-you-client";
import { useMemoryCards } from "./use-memory-cards";
import { useRecorder } from "./use-recorder";
import { useShareDraft } from "./use-share-draft";

type Phase =
  | { kind: "idle" }
  | { kind: "sending"; text: string }
  | { kind: "done"; memories: SentMemory[]; emailed: boolean }
  | { kind: "error"; message: string };

const KEEP_OPEN = "Please keep this page open. Videos can take a few minutes on a phone.";
const STILL_GOING = "Still going. Big files take a while.";
const STALL_MS = 20_000;

function subscribeNever(): () => void {
  return () => {};
}

/** The input an issue points at, so the summary links and the reveal agree on the target. */
function idFor(issue: SendIssue): string {
  switch (issue.target) {
    case "name":
      return "contributor-name";
    case "email":
      return "contributor-email";
    case "note":
      return cardIds(issue.cardId).note;
  }
}

/** One key per issue, for React and for the set of fields typed in since the last Send. */
function keyFor(issue: SendIssue): string {
  return issue.target === "note" ? `note:${issue.cardId}` : issue.target;
}

/** Reads the elements themselves, not FormData, which leaves disabled fields out: a draft saved while sending must keep the name. */
function readContributor(form: HTMLFormElement | null) {
  const text = (name: string) => {
    const element = form?.elements.namedItem(name);
    return element instanceof HTMLInputElement ? element.value : "";
  };
  return { name: text("name"), relationship: text("relationship"), email: text("email") };
}

/**
 * The /share form as memory cards (Task 15): the contributor once, then one
 * card on phones or several on computers (the split is CSS only, D1), one
 * recorder for the whole form (C12), a draft on this device, and a sequential
 * send with progress. Everything the person typed survives a failed send.
 */
export function ShareForm({ intro }: { intro: ReactNode }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // Set on Send (by the browser's check or the server's refusal) and never changed by typing, so the alert is read once (G9.1).
  const [issues, setIssues] = useState<SendIssue[]>([]);
  // The issues whose field has been typed in since: their inline state goes, the summary stays as it was.
  const [cleared, setCleared] = useState<ReadonlySet<string>>(() => new Set());
  // A request to show one field. The DOM work runs in an effect, after React has committed the render that
  // re-enabled the inputs and mounted the error line; a synchronous focus() in the handler would find them disabled.
  const [reveal, setReveal] = useState<{ id: string; n: number } | null>(null);
  // The request already carried out, so a later change of phase (a send that fails with no field named) never
  // re-runs it and pulls focus to a field that is no longer wrong (review finding, 2026-11-04).
  const revealed = useRef<{ id: string; n: number } | null>(null);
  const [confirmSilent, setConfirmSilent] = useState<string[] | null>(null);
  const [live, setLive] = useState("");
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [recordingCardId, setRecordingCardId] = useState<string | null>(null);

  // The cards, with the saved draft applied once during render (C10). The
  // draft hook reads the latest cards through a ref written in an effect.
  const cardsRef = useRef<CardsState["cards"]>([]);
  const getCurrentDraft = useCallback(
    (): ShareDraft => ({
      contributor: { name: readContributor(formRef.current).name, relationship: readContributor(formRef.current).relationship },
      cards: cardsRef.current.filter((card) => card.open).map((card) => ({ approxDateText: card.approxDateText, place: card.place, note: card.note })),
    }),
    [],
  );
  const { draft, save: saveDraft, saveNow: saveDraftNow, clear: clearDraft } = useShareDraft(getCurrentDraft);
  const { state, dispatch, restored } = useMemoryCards(draft);
  useEffect(() => {
    cardsRef.current = state.cards;
  }, [state.cards]);

  /** Dispatch, then carry out the reducer's announcement and focus request and clear them (C46, C48). */
  function apply(action: CardsAction) {
    const next = cardsReducer(state, action);
    dispatch(action);
    if (next.notice) {
      setLive(next.notice);
    }
    const target = next.lastAddedId ?? next.focusId;
    if (target) {
      requestAnimationFrame(() => document.getElementById(cardIds(target).heading)?.focus());
    }
    if (next.notice || next.focusId || next.lastAddedId) {
      dispatch({ type: "ack" });
    }
  }

  // Name, email and relationship from an earlier memory on this device; null on the server and until hydration.
  const remembered = useSyncExternalStore(subscribeRemembered, getRememberedSnapshot, getRememberedServerSnapshot);
  // Server snapshot is false, client snapshot asks the browser: same markup on both sides at hydration (C9).
  const canRecord = useSyncExternalStore(subscribeNever, () => pickRecordingType() !== null, () => false);

  /** The field has been worked on since the last Send: its inline state goes, the summary stays as it was. */
  const clearFieldIssue = useCallback((key: string) => {
    setCleared((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  // One recorder for the whole form; a finished take becomes a row on the card that started it.
  const recordingCardRef = useRef<string | null>(null);
  const onClip = useCallback(
    (recording: Recording) => {
      const cardId = recordingCardRef.current;
      recordingCardRef.current = null;
      setRecordingCardId(null);
      if (!cardId) {
        return;
      }
      // A recording answers "needs a recording, a file or a few words" as well as typing does.
      clearFieldIssue(`note:${cardId}`);
      const item: CardMediaItem = {
        id: `${cardId}-${crypto.randomUUID()}`,
        kind: "VOICE",
        name: recording.file.name,
        size: recording.file.size,
        mimeType: recording.mimeType.split(";")[0] ?? recording.mimeType,
        source: "recording",
        durationSeconds: durationSecondsFor(recording.durationMs) ?? null,
        file: recording.file,
        verdict: recording.verdict,
      };
      dispatch({ type: "addMedia", id: cardId, items: [item] });
    },
    [clearFieldIssue, dispatch],
  );
  const rec = useRecorder({ onClip });
  const recorderActive = rec.snapshot.status.kind === "requesting" || rec.snapshot.status.kind === "recording" || rec.snapshot.status.kind === "finishing";
  const sending = phase.kind === "sending";
  const busy = sending || recorderActive;
  // The card showing the recorder: the one that started it, for as long as the engine is not idle
  // (an error keeps the panel and its help on that card until the person moves on).
  const activeRecordingCardId = rec.snapshot.status.kind === "idle" ? null : recordingCardId;

  useEffect(() => {
    if (!reveal || reveal === revealed.current || phase.kind === "sending") {
      return;
    }
    revealed.current = reveal;
    const input = document.getElementById(reveal.id);
    if (!input) {
      return;
    }
    // Label text, field and error line are measured as content, not as their wrapper: at `roomy` the words cell and
    // its label stretch to the card row's height, and centring that would put the label above the fold and the error
    // line below it on a short window (review finding, 2026-11-04).
    const block = input.closest("[data-field]") ?? input;
    const label = block instanceof HTMLLabelElement ? block : block.querySelector("label");
    const error = input.getAttribute("aria-describedby") ? document.getElementById(input.getAttribute("aria-describedby")!) : null;
    const parts = [label?.firstElementChild ?? label, input, error].filter((el): el is Element => el !== null);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    input.focus({ preventScroll: true });
    window.scrollBy({ top: revealScrollDelta(unionRect(parts.map((el) => el.getBoundingClientRect())), window.innerHeight), behavior: reduce ? "auto" : "smooth" });
  }, [reveal, phase.kind]);

  const shownIssue = (key: string) => issues.find((issue) => keyFor(issue) === key && !cleared.has(key)) ?? null;
  const nameIssue = shownIssue("name");
  const emailIssue = shownIssue("email");
  const cardIssueFor = (cardId: string): CardIssue | null =>
    issues.find((issue): issue is CardIssue => issue.target === "note" && issue.cardId === cardId && !cleared.has(keyFor(issue))) ?? null;

  // A desktop safeguard only while unsent media exists (C44); phones rely on the draft instead.
  const hasUnsentMedia = phase.kind !== "done" && state.cards.some((card) => card.media.length > 0);
  useEffect(() => {
    if (!hasUnsentMedia) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsentMedia]);

  function resetForm() {
    rec.discard();
    recordingCardRef.current = null;
    setRecordingCardId(null);
    clearDraft();
    dispatch({ type: "reset" });
    setIssues([]);
    setCleared(new Set());
    setReveal(null);
    setConfirmSilent(null);
    setProgress({});
    setLive("");
    setPhase({ kind: "idle" });
    formRef.current?.reset();
  }

  function startRecording(cardId: string) {
    // Set and start in the same tap: iOS only grants the microphone inside a user gesture.
    recordingCardRef.current = cardId;
    setRecordingCardId(cardId);
    void rec.start();
  }

  function openPlaceholder(cardId: string) {
    apply({ type: "open", id: cardId });
    requestAnimationFrame(() => document.getElementById(cardIds(cardId).date)?.focus());
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    const contributor = readContributor(event.currentTarget);
    // The form's order: who is sending, then the cards. The first problem is the one brought into view.
    const found: SendIssue[] = [...validateContributor(contributor), ...validateForSend(state.cards)];
    setIssues(found);
    setCleared(new Set());
    if (found.length > 0) {
      // A pending "sounds silent" warning is withdrawn too: the next Send that passes asks again if it still applies.
      setConfirmSilent(null);
      setPhase({ kind: "idle" });
      setReveal({ id: idFor(found[0]!), n: Date.now() });
      return;
    }
    const cards = contentCards(state);
    const silent = cards
      .filter((card) => card.media.some((item) => item.verdict === "suspectedSilent"))
      .map((card) => headingFor(state.cards.filter((c) => c.open).indexOf(card) + 1));
    if (silent.length > 0 && confirmSilent === null) {
      setConfirmSilent(silent);
      return;
    }
    setConfirmSilent(null);
    const form = new FormData(event.currentTarget);
    const visibility = String(form.get("visibility") ?? "PUBLIC");
    const sendInput = {
      ...contributor,
      visibility: isContributorVisibility(visibility) ? visibility : "PUBLIC",
      contactOptIn: form.get("contactOptIn") === "on",
      notifyWhenPosted: form.get("notifyWhenPosted") === "on",
      mailingListOptIn: form.get("mailingListOptIn") === "on",
      cards,
    };
    const fileCount = cards.reduce((n, card) => n + card.media.length, 0);
    setPhase({ kind: "sending", text: "Sending…" });
    setProgress(Object.fromEntries(cards.flatMap((card) => card.media.map((item) => [item.id, 0]))));
    if (fileCount > 0) {
      setLive(KEEP_OPEN);
    }

    let lastStep = 0;
    let lastChangeAt = Date.now();
    const stall = fileCount > 0 ? setInterval(() => {
      if (Date.now() - lastChangeAt > STALL_MS) {
        setLive(STILL_GOING);
        lastChangeAt = Date.now();
      }
    }, 5_000) : null;
    const onProgress = (p: PipelineProgress) => {
      lastChangeAt = Date.now();
      setPhase({ kind: "sending", text: p.text });
      setProgress((prev) => ({ ...prev, [p.mediaId]: p.percent }));
      // Announce at file boundaries and about every 25%, never every percent (C47).
      const step = Math.floor(p.percent / 25) + p.fileNumber * 10;
      if (step !== lastStep) {
        lastStep = step;
        setLive(`${p.text}. ${KEEP_OPEN}`);
      }
    };

    try {
      const result = await runSubmission(
        sendInput,
        {
          createSubmission,
          issueUploadTicket,
          upload: (grant, file, onPct) => uploadWithTicket(grant, file, onPct),
          finalizeUpload,
          completeSubmission,
        },
        {
          origin: window.location.origin,
          onProgress,
          onFileDone: (_cardId, mediaId, ok) => setProgress((prev) => ({ ...prev, [mediaId]: ok ? 100 : prev[mediaId] ?? 0 })),
        },
      );
      if (!result.ok) {
        // Back to editable rows: a stuck progress bar would hide every Remove button.
        setProgress({});
        setPhase({ kind: "error", message: result.message });
        // A refusal that names a field or a card lands there (summary, inline line, focus); any other shows above the button.
        const located = issuesFromSendFailure(result, cards);
        setIssues(located);
        if (located[0]) {
          setReveal({ id: idFor(located[0]), n: Date.now() });
        }
        setLive("");
        return;
      }
      rememberContributor(contributor);
      clearDraft();
      const openCards = state.cards.filter((card) => card.open);
      const memories: SentMemory[] = result.memories.map((memory) => {
        const card = cards.find((c) => c.id === memory.cardId)!;
        return { position: memory.position, label: labelFor(card, openCards.indexOf(card) + 1), claimLink: memory.claimLink, failedFiles: memory.failedFiles };
      });
      setLive("");
      setPhase({ kind: "done", memories, emailed: result.emailed });
    } finally {
      if (stall) {
        clearInterval(stall);
      }
    }
  }

  if (phase.kind === "done") {
    return <ThankYou memories={phase.memories} emailed={phase.emailed} onAnother={resetForm} />;
  }

  const openCards = state.cards.filter((card) => card.open);
  const filledCount = contentCards(state).length;
  const several = filledCount > 1;
  const sendLabel = sending
    ? phase.text
    : confirmSilent
      ? "Send anyway"
      : several
        ? `Send these ${filledCount} memories to Jo's family`
        : "Send this to Jo's family";
  const recordingHeading = activeRecordingCardId ? headingFor(openCards.findIndex((c) => c.id === activeRecordingCardId) + 1) : null;

  return (
    // Side padding on the full-width box, the cap on the box inside it (item 7, 2026-11-04): on one box the 5% resolved
    // against the whole window and the usable column shrank as the window grew (604px at 2560). `roomy` widens to 1040px.
    <div className="px-[max(16px,5%)] py-[56px]">
      <section id="form" className="mx-auto flex w-full max-w-[860px] roomy:max-w-[1040px] flex-col gap-8">
        <div className="flex flex-col gap-[18px]">{intro}</div>
        <form ref={formRef} onSubmit={onSubmit} onInput={saveDraft} className="flex flex-col gap-8" aria-busy={busy} noValidate>
          <p aria-live="polite" className={live ? "text-body text-walnut-soft" : "sr-only"}>
            {live}
          </p>
          {restored && (
            <p role="status" className="text-small text-walnut-soft">
              We kept the words you typed last time. Change anything you like before you send.
            </p>
          )}

          <section aria-labelledby="about-you" className="flex flex-col gap-[22px] rounded-form border-[3px] border-wood-light bg-paper p-6 shadow-form sm:p-8">
            <h2 id="about-you" className="font-display text-card-title font-bold">
              About you
            </h2>
            {/* Name and email are required (Rob, 2026-11-04). `required` is for assistive tech: the form is noValidate and
                shows its own words. The error line is a sibling of the label, so it is described, not part of the name. */}
            <div className="grid gap-5 sm:grid-cols-2 roomy:grid-cols-3">
              <div data-field className={labelClass}>
                <label htmlFor="contributor-name">Your name</label>
                <input
                  id="contributor-name"
                  name="name"
                  maxLength={120}
                  required
                  className={inputClass}
                  autoComplete="name"
                  placeholder="Jane Doe"
                  defaultValue={draft?.contributor.name || remembered?.name}
                  disabled={sending}
                  aria-invalid={nameIssue ? "true" : undefined}
                  aria-describedby={nameIssue ? "contributor-name-error" : undefined}
                  onInput={() => clearFieldIssue("name")}
                />
                {nameIssue && (
                  <p id="contributor-name-error" className={errorClass}>
                    {nameIssue.message}
                  </p>
                )}
              </div>
              <div data-field className={labelClass}>
                <label htmlFor="contributor-email">Email</label>
                <input
                  id="contributor-email"
                  name="email"
                  type="email"
                  maxLength={254}
                  required
                  className={inputClass}
                  autoComplete="email"
                  placeholder="your@email.com"
                  defaultValue={remembered?.email}
                  disabled={sending}
                  aria-invalid={emailIssue ? "true" : undefined}
                  aria-describedby={emailIssue ? "contributor-email-error" : undefined}
                  onInput={() => clearFieldIssue("email")}
                />
                {emailIssue && (
                  <p id="contributor-email-error" className={errorClass}>
                    {emailIssue.message}
                  </p>
                )}
              </div>
              {/* Full width on two columns, one of three with room to spare, so it never orphans at half width. */}
              <div data-field className={`${labelClass} sm:col-span-2 roomy:col-span-1`}>
                <label htmlFor="contributor-relationship">
                  How you knew Jo <span className={helperClass}>(optional)</span>
                </label>
                <input
                  id="contributor-relationship"
                  name="relationship"
                  maxLength={120}
                  className={inputClass}
                  placeholder="former student"
                  defaultValue={draft?.contributor.relationship || remembered?.relationship}
                  disabled={sending}
                />
              </div>
            </div>
            <p className="narrow:hidden text-small text-walnut-soft">One memory is plenty. Add more if they come to you.</p>
          </section>

          {/* With room to spare the placeholders sit two abreast and an open card spans both columns (item 7). */}
          <div className="flex flex-col gap-8 roomy:grid roomy:grid-cols-2">
            {state.cards.map((card, index) => {
              const position = openCards.indexOf(card) + 1;
              if (!card.open) {
                return <MemoryPlaceholder key={card.id} position={index + 1} onOpen={() => openPlaceholder(card.id)} disabled={busy} />;
              }
              const isFirst = index === 0;
              // The phone layout hides the extra empty cards only: a card with something in it (a desktop window made
              // narrow, a restored draft) stays visible, because it will be sent and may need its error shown.
              return (
                <div key={card.id} className={isFirst || hasContent(card) ? "roomy:col-span-2" : "narrow:hidden roomy:col-span-2"}>
                  <MemoryCardSection
                    card={card}
                    position={position}
                    isFirst={isFirst}
                    disabled={sending}
                    issue={cardIssueFor(card.id)}
                    recording={{
                      rec,
                      canRecord,
                      isHere: activeRecordingCardId === card.id,
                      elsewhere: activeRecordingCardId !== null && activeRecordingCardId !== card.id ? recordingHeading : null,
                      start: () => startRecording(card.id),
                    }}
                    progress={progress}
                    onField={(field, value) => {
                      dispatch({ type: "field", id: card.id, field, value });
                      if (field === "note") {
                        clearFieldIssue(`note:${card.id}`);
                      }
                    }}
                    onAddMedia={(items) => {
                      dispatch({ type: "addMedia", id: card.id, items });
                      clearFieldIssue(`note:${card.id}`);
                    }}
                    onRemoveMedia={(mediaId) => {
                      dispatch({ type: "removeMedia", id: card.id, mediaId });
                      clearFieldIssue(`note:${card.id}`);
                    }}
                    onRemove={() => apply({ type: "remove", id: card.id })}
                    onClear={() => {
                      dispatch({ type: "clear", id: card.id });
                      clearFieldIssue(`note:${card.id}`);
                    }}
                    onBeforeCamera={saveDraftNow}
                  />
                </div>
              );
            })}

            {/* While a placeholder is waiting it already offers "Add a … memory"; the duplicate button appears once every card is open. */}
            {state.cards.every((card) => card.open) && (
              <div className="narrow:hidden roomy:col-span-2">
                <SecondaryButton onClick={() => apply({ type: "add" })} disabled={busy || state.cards.length >= MAX_CARDS}>
                  + Add another memory
                </SecondaryButton>
              </div>
            )}
          </div>

          <section className="flex flex-col gap-[22px] rounded-form border-[3px] border-wood-light bg-paper p-6 shadow-form sm:p-8">
            {issues.length > 0 && (
              <div role="alert" className={errorClass}>
                <p>We couldn&apos;t send this yet:</p>
                <ul className="list-disc pl-6">
                  {issues.map((issue) => (
                    <li key={keyFor(issue)}>
                      <a
                        className={linkClass}
                        href={`#${idFor(issue)}`}
                        onClick={(e) => {
                          e.preventDefault();
                          setReveal({ id: idFor(issue), n: Date.now() });
                        }}
                      >
                        {issue.message}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* A refusal that landed on a field or a card is already in the summary above; only a general one is shown here. */}
            {phase.kind === "error" && issues.length === 0 && (
              <p role="alert" className={errorClass}>
                {phase.message}
              </p>
            )}
            {confirmSilent && (
              <p role="alert" className={errorClass}>
                The recording in {confirmSilent.join(" and ")} sounds silent. Play it back first. Press &quot;Send anyway&quot; to send it as it is, or record it again.
              </p>
            )}
            {/* The alerts sit above this row; with room to spare the audience and the Send button share it (item 7). */}
            <div className="flex flex-col gap-[22px] roomy:flex-row roomy:items-end roomy:gap-5">
              <label className={`${labelClass} roomy:flex-1`}>
                <span>Who can see {several ? "these" : "this"}?</span>
                {/* Everyone (default) or Family; the admin-only third value is never offered here (Rob's item 5, ruling 3). */}
                <select name="visibility" defaultValue="PUBLIC" className={selectClass} disabled={sending}>
                  {contributorVisibilityOptions().map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <PrimaryButton type="submit" disabled={busy}>
                <SolidHeart size={24} fill="#fff" stitch={false} />
                {sendLabel}
              </PrimaryButton>
            </div>
            <p className="text-small text-walnut-soft">
              Memories go to Richard, Rob and Tracy first. Later, with your okay, they&apos;ll join a shared collection the whole family can read.
            </p>
            <label className="flex items-start gap-3 text-small">
              <input name="contactOptIn" type="checkbox" defaultChecked className="mt-1 size-6 accent-jo-red" disabled={sending} />
              <span>{CONTACT_OPT_IN_LABEL}</span>
            </label>
            <label className="flex items-start gap-3 text-small">
              <input name="notifyWhenPosted" type="checkbox" defaultChecked className="mt-1 size-6 accent-jo-red" disabled={sending} />
              <span>{NOTIFY_WHEN_POSTED_LABEL}</span>
            </label>
            <label className="flex items-start gap-3 text-small">
              <input name="mailingListOptIn" type="checkbox" className="mt-1 size-6 accent-jo-red" disabled={sending} />
              <span>{MAILING_LIST_LABEL}</span>
            </label>
            <p className="text-small text-walnut-soft">{IMPLICIT_CONSENT_NOTE}</p>
          </section>
        </form>
      </section>
    </div>
  );
}
