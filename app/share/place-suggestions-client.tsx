"use client";

import { type MemoryCard, placeSuggestionsFor } from "@/lib/memory-cards";

import { linkClass } from "../_components/field-classes";

/** Where the OpenStreetMap credit points, as the attribution guidelines ask [C8]. */
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
export const LOOKING_UP_TEXT = "Looking up where your photos were taken…";

/**
 * Place buttons under a card's "Where?" (plan 2026-11-06-photo-gps-places B6). Each is a place found near where one of
 * the card's photos was taken; a tap fills Where, which the person can still edit (R5). Nothing is ever filled
 * automatically (D4): reverse geocoding finds the closest suitable object, which may be a surprise [C6].
 *
 * The polite live region is always mounted, empty until a photo has GPS, so assistive technology announces the status
 * ("Looking up…") and then the buttons as they arrive, without interrupting typing [C29]. Without GPS, or once the
 * lookups found nothing usable, it holds nothing.
 */
export function PlaceSuggestions({
  card,
  value,
  onPick,
  disabled,
}: {
  card: Pick<MemoryCard, "id" | "media">;
  /** The card's current Where text: the button that equals it is pressed. */
  value: string;
  onPick: (label: string) => void;
  disabled: boolean;
}) {
  const { hasGps, pending, labels } = placeSuggestionsFor(card);
  const headingId = `${card.id}-place-suggestions`;
  const show = hasGps && (pending || labels.length > 0);
  return (
    // Rendered even when empty (zero height, never display:none), so the region exists before its first update.
    <div aria-live="polite">
      {show && (
        <div className="mt-3 flex flex-col gap-2">
          {labels.length === 0 ? (
            <p className="text-small font-normal text-walnut-soft">{LOOKING_UP_TEXT}</p>
          ) : (
            <>
              <p id={headingId} className="text-small font-normal text-walnut-soft">
                From your photos:
              </p>
              <div role="group" aria-labelledby={headingId} className="flex flex-wrap gap-2">
                {labels.map((label) => {
                  const pressed = label === value;
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => onPick(label)}
                      disabled={disabled}
                      className={`min-h-tap max-w-full rounded-input border-2 px-4 py-2 text-left text-body font-normal break-words disabled:opacity-60 ${
                        pressed ? "border-periwinkle-deep bg-periwinkle-deep text-white" : "border-wood bg-paper text-walnut"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-small font-normal">
                <a href={OSM_COPYRIGHT_URL} className={linkClass} target="_blank" rel="noreferrer">
                  Place names © OpenStreetMap contributors
                </a>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
