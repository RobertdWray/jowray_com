"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { CONTACT_OPT_IN_LABEL, IMPLICIT_CONSENT_NOTE, MAILING_LIST_LABEL, NOTIFY_WHEN_POSTED_LABEL } from "@/lib/consent";
import { durationSecondsFor } from "@/lib/format-duration";
import { type CardMediaItem, type CardsAction, type CardsState, cardsReducer, contentCards, labelFor, MAX_CARDS, type SendIssue, validateForSend } from "@/lib/memory-cards";
import {
  getRememberedServerSnapshot,
  getRememberedSnapshot,
  rememberContributor,
  subscribeRemembered,
} from "@/lib/remembered-contributor";
import type { ShareDraft } from "@/lib/share-draft";
import { type PipelineProgress, runSubmission } from "@/lib/submission-pipeline";
import { uploadWithTicket } from "@/lib/upload-client";
import { VISIBILITY_OPTIONS } from "@/lib/visibility";

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
  | { kind: "done"; memories: SentMemory[]; emailed: boolean; hasEmail: boolean }
  | { kind: "error"; message: string };

const KEEP_OPEN = "Please keep this page open. Videos can take a few minutes on a phone.";
const STILL_GOING = "Still going. Big files take a while.";
const STALL_MS = 20_000;

function subscribeNever(): () => void {
  return () => {};
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
  const [issues, setIssues] = useState<SendIssue[]>([]);
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
    [dispatch],
  );
  const rec = useRecorder({ onClip });
  const recorderActive = rec.snapshot.status.kind === "requesting" || rec.snapshot.status.kind === "recording" || rec.snapshot.status.kind === "finishing";
  const sending = phase.kind === "sending";
  const busy = sending || recorderActive;
  // The card showing the recorder: the one that started it, for as long as the engine is not idle
  // (an error keeps the panel and its help on that card until the person moves on).
  const activeRecordingCardId = rec.snapshot.status.kind === "idle" ? null : recordingCardId;

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
    const found = validateForSend(state.cards);
    setIssues(found);
    if (found.length > 0) {
      document.getElementById(cardIds(found[0]!.cardId).note)?.focus();
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
    const contributor = readContributor(event.currentTarget);
    const visibility = String(form.get("visibility") ?? "PUBLIC");
    const sendInput = {
      ...contributor,
      visibility: (VISIBILITY_OPTIONS.some((o) => o.value === visibility) ? visibility : "PUBLIC") as "PUBLIC" | "FAMILY" | "PRIVATE",
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
        if (result.memoryIndex !== null) {
          const card = cards[result.memoryIndex];
          if (card) {
            setIssues([{ cardId: card.id, position: result.memoryIndex + 1, field: "note", message: result.message }]);
          }
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
      setPhase({ kind: "done", memories, emailed: result.emailed, hasEmail: contributor.email.trim().length > 0 });
    } finally {
      if (stall) {
        clearInterval(stall);
      }
    }
  }

  if (phase.kind === "done") {
    return <ThankYou memories={phase.memories} emailed={phase.emailed} hasEmail={phase.hasEmail} onAnother={resetForm} />;
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
    <section id="form" className="mx-auto flex w-full max-w-[860px] flex-col gap-8 px-[max(16px,5%)] py-[56px]">
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
          <div className="flex flex-wrap gap-5">
            <label className={`${labelClass} flex-[1_1_200px]`}>
              <span>Your name</span>
              <input name="name" maxLength={120} className={inputClass} autoComplete="name" placeholder="Kay Bartholomew" defaultValue={draft?.contributor.name || remembered?.name} disabled={sending} />
            </label>
            <label className={`${labelClass} flex-[1_1_200px]`}>
              <span>
                Email <span className={helperClass}>(optional · so we can say thank you and send your private link)</span>
              </span>
              <input name="email" type="email" maxLength={254} className={inputClass} autoComplete="email" placeholder="So we can say thank you" defaultValue={remembered?.email} disabled={sending} />
            </label>
          </div>
          <label className={labelClass}>
            <span>How you knew Jo</span>
            <input
              name="relationship"
              maxLength={120}
              className={inputClass}
              placeholder="former student · church friend · neighbor · family"
              defaultValue={draft?.contributor.relationship || remembered?.relationship}
              disabled={sending}
            />
          </label>
          <p className="narrow:hidden text-small text-walnut-soft">One memory is plenty. Add more if they come to you.</p>
        </section>

        {state.cards.map((card, index) => {
          const position = openCards.indexOf(card) + 1;
          if (!card.open) {
            return <MemoryPlaceholder key={card.id} position={index + 1} onOpen={() => openPlaceholder(card.id)} disabled={busy} />;
          }
          const isFirst = index === 0;
          return (
            <div key={card.id} className={isFirst ? undefined : "narrow:hidden"}>
              <MemoryCardSection
                card={card}
                position={position}
                isFirst={isFirst}
                disabled={sending}
                issue={issues.find((issue) => issue.cardId === card.id) ?? null}
                recording={{
                  rec,
                  canRecord,
                  isHere: activeRecordingCardId === card.id,
                  elsewhere: activeRecordingCardId !== null && activeRecordingCardId !== card.id ? recordingHeading : null,
                  start: () => startRecording(card.id),
                }}
                progress={progress}
                onField={(field, value) => dispatch({ type: "field", id: card.id, field, value })}
                onAddMedia={(items) => dispatch({ type: "addMedia", id: card.id, items })}
                onRemoveMedia={(mediaId) => dispatch({ type: "removeMedia", id: card.id, mediaId })}
                onRemove={() => apply({ type: "remove", id: card.id })}
                onClear={() => dispatch({ type: "clear", id: card.id })}
                onBeforeCamera={saveDraftNow}
              />
            </div>
          );
        })}

        <div className="narrow:hidden">
          <SecondaryButton onClick={() => apply({ type: "add" })} disabled={busy || state.cards.length >= MAX_CARDS}>
            + Add another memory
          </SecondaryButton>
        </div>

        <section className="flex flex-col gap-[22px] rounded-form border-[3px] border-wood-light bg-paper p-6 shadow-form sm:p-8">
          <label className={labelClass}>
            <span>Who can see {several ? "these" : "this"}?</span>
            <select name="visibility" defaultValue="PUBLIC" className={selectClass} disabled={sending}>
              {VISIBILITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {issues.length > 0 && (
            <div role="alert" className={errorClass}>
              <p>Before we can send {several ? "these" : "this"}:</p>
              <ul className="list-disc pl-6">
                {issues.map((issue) => (
                  <li key={issue.cardId}>
                    <a
                      className={linkClass}
                      href={`#${cardIds(issue.cardId).note}`}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(cardIds(issue.cardId).note)?.focus();
                      }}
                    >
                      {issue.message}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {phase.kind === "error" && (
            <p role="alert" className={errorClass}>
              {phase.message}
            </p>
          )}
          {confirmSilent && (
            <p role="alert" className={errorClass}>
              The recording in {confirmSilent.join(" and ")} sounds silent. Play it back first. Press &quot;Send anyway&quot; to send it as it is, or record it again.
            </p>
          )}
          <PrimaryButton type="submit" disabled={busy}>
            <SolidHeart size={24} fill="#fff" stitch={false} />
            {sendLabel}
          </PrimaryButton>
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
  );
}
