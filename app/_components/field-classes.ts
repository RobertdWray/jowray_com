export const labelClass = "flex min-w-0 flex-col gap-2 text-label font-bold";
export const helperClass = "font-normal text-walnut-soft";
// `font-normal`: Preflight gives form controls `font: inherit`, so without it every field inside a bold label is bold too
// (Rob's item 4). `aria-[invalid=true]`: the invalid state is set by the form after a failed Send (never on first paint,
// MDN); the 2px jo-red-deep border is the 3:1 state indicator (SC 1.4.11), the 40% ring reinforces it.
export const inputClass =
  "min-h-tap w-full rounded-input border-2 border-wood bg-white px-4 py-3 text-body font-normal text-walnut aria-[invalid=true]:border-jo-red-deep aria-[invalid=true]:ring-4 aria-[invalid=true]:ring-jo-red-deep/40";
export const textareaClass = inputClass + " resize-y leading-[1.5]";
export const selectClass = inputClass;
export const fileInputClass =
  "min-h-tap w-full rounded-input border-2 border-dashed border-wood bg-muslin px-4 py-3 text-[18px] text-walnut file:mr-3 file:rounded-input file:border-0 file:bg-paper file:px-3 file:py-2 file:text-label file:font-bold disabled:cursor-not-allowed disabled:opacity-60";
// `font-normal`: an error line sits inside the field's bold wrapper and must not inherit its weight (DESIGN.md § 5.4).
export const errorClass = "text-small font-normal text-jo-red-deep";
export const linkClass = "text-jo-red-deep underline hover:text-walnut break-words";
// The footer's row of links, and the Privacy button styled like them: 44px tall for touch (DESIGN.md § 6), so the row
// keeps one height wherever it wraps.
export const footerLinkClass = `${linkClass} inline-flex min-h-[44px] items-center`;
// Links to a person's own website (Rob, Tracy): noticeable but quiet, because the site is about Jo, not them. The text
// keeps the sentence's color (Preflight gives links `color: inherit`), so red stays for actions and links into the
// site; the 1px `wood` underline is the non-color cue SC 1.4.1 asks for (at least 3.3:1 against muslin, the darkest
// gingham square and paper). Hover and keyboard focus darken and thicken the underline; the global 3px walnut focus outline still
// applies. Tailwind v4 `hover:` only matches devices that can hover, so a tap on a phone doesn't stick it.
// Plan: docs/plans/2026-11-06-why-and-how-built.md, ruling E20.
export const quietLinkClass =
  "underline decoration-wood decoration-1 underline-offset-4 break-words hover:decoration-walnut hover:decoration-2 focus-visible:decoration-walnut focus-visible:decoration-2";
