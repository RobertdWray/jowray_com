"use client";

import { useState } from "react";

import { type CardIssue, hasContent, type CardTextField, type MemoryCard } from "@/lib/memory-cards";

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
  issue: CardIssue | null;
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
  // A recording cannot be picked again, so clearing or removing a card that holds one always asks first.
  const holdsRecording = card.media.some((item) => item.source === "recording");

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
      {/* Item 7 (2026-11-04): with room to spare (`roomy`) the card is two columns, when/where and the media on the
          left, the words on the right filling the row's height (about 52 characters a line, SC 1.4.8 guidance). */}
      <div className="flex flex-col gap-[22px] roomy:grid roomy:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] roomy:gap-x-8">
        <div className="flex flex-col gap-[22px]">
          <div className="flex flex-wrap gap-5 roomy:flex-col">
            <label htmlFor={ids.date} className={`${labelClass} flex-[1_1_220px] roomy:flex-none`}>
              <span>When is this memory from? <span className={helperClass}>(roughly is fine)</span></span>
              <input
                id={ids.date}
                value={card.approxDateText}
                onChange={(e) => onField("approxDateText", e.target.value)}
                maxLength={120}
                className={inputClass}
                placeholder="Summer 1985"
                disabled={disabled}
              />
            </label>
            <label htmlFor={ids.place} className={`${labelClass} flex-[1_1_220px] roomy:flex-none`}>
              <span>Where? <span className={helperClass}>(optional)</span></span>
              <input
                id={ids.place}
                value={card.place}
                onChange={(e) => onField("place", e.target.value)}
                maxLength={200}
                className={inputClass}
                placeholder="her classroom"
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
        </div>

        <div className="flex flex-col gap-[22px]">
          <label htmlFor={ids.note} className={`${labelClass} roomy:flex-1`} data-field>
            <span>Your memory of Jo</span>
            <textarea
              id={ids.note}
              value={card.note}
              onChange={(e) => onField("note", e.target.value)}
              rows={7}
              maxLength={10_000}
              className={`${textareaClass} roomy:min-h-[300px] roomy:flex-1`}
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
        </div>
      </div>

      {isFirst
        ? filled &&
          (confirmingRemove ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-body">Clear this memory, recording included?</span>
              <TertiaryButton onClick={() => { setConfirmingRemove(false); onClear(); }} disabled={disabled}>Yes, clear it</TertiaryButton>
              <SecondaryButton onClick={() => setConfirmingRemove(false)} disabled={disabled}>Keep it</SecondaryButton>
            </div>
          ) : (
            <div>
              <SecondaryButton onClick={() => (holdsRecording ? setConfirmingRemove(true) : onClear())} disabled={disabled || recording.isHere}>
                Clear this memory
              </SecondaryButton>
            </div>
          ))
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
