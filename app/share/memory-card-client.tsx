"use client";

import { useState } from "react";

import { hasContent, type CardTextField, type MemoryCard, type SendIssue } from "@/lib/memory-cards";

import { SecondaryButton, TertiaryButton } from "../_components/buttons";
import { errorClass, helperClass, inputClass, labelClass, textareaClass } from "../_components/field-classes";
import { CardMedia, type CardMediaRecording } from "./card-media-client";

/** Ids a card's parts share: derived from the card's deterministic id, so server and client agree (C5, C56). */
export function cardIds(cardId: string) {
  return {
    heading: `${cardId}-heading`,
    date: `${cardId}-date`,
    place: `${cardId}-place`,
    note: `${cardId}-note`,
    error: `${cardId}-error`,
  };
}

export function headingFor(position: number): string {
  return `Memory ${position}`;
}

const ORDINAL = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"] as const;

/** A compact placeholder for cards 2–3 on computers (D11); hidden on phones (C52). */
export function MemoryPlaceholder({ position, onOpen, disabled }: { position: number; onOpen: () => void; disabled: boolean }) {
  return (
    <section aria-label={headingFor(position)} className="narrow:hidden flex items-center justify-between gap-4 rounded-form border-[3px] border-dashed border-wood bg-muslin px-6 py-5">
      <span className="font-display text-lead font-bold text-walnut-soft">{headingFor(position)}</span>
      <SecondaryButton onClick={onOpen} disabled={disabled}>
        Add a {ORDINAL[position] ?? "another"} memory
      </SecondaryButton>
    </section>
  );
}

export function MemoryCardSection({
  card,
  position,
  isFirst,
  disabled,
  issue,
  recording,
  progress,
  onField,
  onAddMedia,
  onRemoveMedia,
  onRemove,
  onClear,
  onBeforeCamera,
}: {
  card: MemoryCard;
  position: number;
  isFirst: boolean;
  disabled: boolean;
  issue: SendIssue | null;
  recording: CardMediaRecording;
  progress: Record<string, number>;
  onField: (field: CardTextField, value: string) => void;
  onAddMedia: Parameters<typeof CardMedia>[0]["onAdd"];
  onRemoveMedia: (mediaId: string) => void;
  onRemove: () => void;
  onClear: () => void;
  onBeforeCamera: () => void;
}) {
  const ids = cardIds(card.id);
  const heading = headingFor(position);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const filled = hasContent(card);

  return (
    <section aria-labelledby={ids.heading} className="flex flex-col gap-[22px] rounded-form border-[3px] border-wood-light bg-paper p-6 shadow-form sm:p-8">
      <h2 id={ids.heading} tabIndex={-1} className="font-display text-card-title font-bold outline-none focus-visible:ring-4 focus-visible:ring-periwinkle">
        {isFirst ? (
          <>
            <span className="narrow:hidden">{heading}</span>
            <span className="wide:hidden">Your memory</span>
          </>
        ) : (
          heading
        )}
      </h2>
      <div className="flex flex-wrap gap-5">
        <label htmlFor={ids.date} className={`${labelClass} flex-[1_1_220px]`}>
          <span>When is this memory from? <span className={helperClass}>(roughly is fine)</span></span>
          <input
            id={ids.date}
            value={card.approxDateText}
            onChange={(e) => onField("approxDateText", e.target.value)}
            maxLength={120}
            className={inputClass}
            placeholder="Summer 1985 · Lake George, late 90s · her classroom"
            disabled={disabled}
          />
        </label>
        <label htmlFor={ids.place} className={`${labelClass} flex-[1_1_220px]`}>
          <span>Where? <span className={helperClass}>(optional)</span></span>
          <input
            id={ids.place}
            value={card.place}
            onChange={(e) => onField("place", e.target.value)}
            maxLength={200}
            className={inputClass}
            placeholder="her classroom · Lake George · Broadmead"
            disabled={disabled}
          />
        </label>
      </div>

      <CardMedia
        card={card}
        heading={heading}
        isFirst={isFirst}
        disabled={disabled}
        recording={recording}
        progress={progress}
        onAdd={onAddMedia}
        onRemove={onRemoveMedia}
        onBeforeCamera={onBeforeCamera}
      />

      <label htmlFor={ids.note} className={labelClass}>
        <span>Your memory of Jo</span>
        <textarea
          id={ids.note}
          value={card.note}
          onChange={(e) => onField("note", e.target.value)}
          rows={7}
          maxLength={10_000}
          className={textareaClass}
          placeholder="She once…"
          aria-invalid={issue ? "true" : undefined}
          aria-describedby={issue ? ids.error : undefined}
          disabled={disabled}
        />
      </label>
      {issue && (
        <p id={ids.error} className={errorClass}>
          {issue.message}
        </p>
      )}

      {isFirst
        ? filled && (
            <div>
              <SecondaryButton onClick={onClear} disabled={disabled || recording.isHere}>Clear this memory</SecondaryButton>
            </div>
          )
        : confirmingRemove ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-body">Remove {heading}?</span>
              <TertiaryButton onClick={onRemove} disabled={disabled}>Yes, remove it</TertiaryButton>
              <SecondaryButton onClick={() => setConfirmingRemove(false)} disabled={disabled}>Keep it</SecondaryButton>
            </div>
          ) : (
            <div>
              <SecondaryButton onClick={() => (filled ? setConfirmingRemove(true) : onRemove())} disabled={disabled || recording.isHere}>
                Remove {heading}
              </SecondaryButton>
            </div>
          )}
    </section>
  );
}
