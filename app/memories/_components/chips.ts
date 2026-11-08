/**
 * The class strings See memories shares across its pages (plan 2026-11-08 "Shared look", design/reference/see-memories/SPEC.md §1–§2).
 * Every colour, radius, shadow and size is a token from `app/globals.css`; the two raw shadows are the 4px pill and row
 * shadows the boards draw, which have no token.
 */

/** Full-width band with the site's side gutter; its inner box carries the 1200px cap. */
export const bandClass = "px-[max(16px,5%)]";
export const innerClass = "mx-auto w-full max-w-[1200px]";

/** Red, bold, upper-case label above a heading. */
export const eyebrowClass = "text-small font-bold uppercase tracking-[0.08em] text-jo-red-deep sm:text-body";

/** Paper band with a dashed red rule on top (results, selected place or patch, "Close to this one"). */
export const paperBandClass = "border-t-[3px] border-dashed border-jo-red bg-paper";
/** The same with a rule on both sides ("Ways to look", the timeline's jump band). */
export const paperBandBothClass = "border-y-[3px] border-dashed border-jo-red bg-paper";

/** View pills (Everything, By place, By year, By what she loved). */
const pillBase = "inline-flex flex-none items-center justify-center gap-[10px] rounded-full text-label font-bold no-underline min-h-13 px-[18px] sm:min-h-tap sm:px-[22px]";
export const pillOnClass = `${pillBase} bg-periwinkle-deep text-white shadow-[0_4px_0_#26406a]`;
export const pillOffClass = `${pillBase} border-[3px] border-dashed border-periwinkle bg-paper text-walnut`;

/** Filter chips (decade, patch, kind); the count follows in `chipCountClass`. */
const chipBase = "inline-flex flex-none items-center gap-2 min-h-12 rounded-full px-[18px] text-label font-bold no-underline";
export const chipOnClass = `${chipBase} border-[3px] border-solid border-periwinkle-deep bg-periwinkle-deep text-white shadow-[0_4px_0_#26406a]`;
export const chipOffClass = `${chipBase} border-[3px] border-dashed border-periwinkle bg-paper text-walnut`;
export const chipCountClass = "font-normal opacity-90";

/** A small dashed patch on a card, or the selected one filled. */
export const cardTagClass = "inline-flex min-h-8 items-center rounded-full border-2 border-dashed border-periwinkle bg-paper px-3 text-small font-bold text-periwinkle-deep no-underline";
export const cardTagOnClass = "inline-flex min-h-8 items-center rounded-full bg-periwinkle-deep px-3 text-small font-bold text-white no-underline";

/** Place rows (Explore's top places, the map's "Every place"). */
const rowBase = "flex w-full items-center gap-3 rounded-input border-[3px] text-label font-bold no-underline";
export const rowOnClass = `${rowBase} border-periwinkle-deep bg-periwinkle-deep text-white shadow-[0_4px_0_#26406a]`;
export const rowOffClass = `${rowBase} border-wood-light bg-paper text-walnut shadow-[0_4px_0_#e9d9c0]`;

/** Dashed paper link styled as a button ("See all 20 in Everything", "Show everything again"). */
export const linkButtonClass =
  "inline-flex min-h-tap items-center justify-center gap-[10px] rounded-button border-[3px] border-dashed border-wood bg-paper px-5 text-label font-bold text-walnut no-underline";

/** The memory card frame (the home page's card hover). */
export const cardClass =
  "flex min-w-0 flex-1 flex-col gap-4 rounded-card border-[3px] border-wood-light bg-paper p-5 text-walnut no-underline shadow-card motion-safe:transition-[transform,box-shadow] motion-safe:duration-150 motion-safe:hover:-translate-y-[3px] motion-safe:hover:shadow-card-hover";

/** The card grid. */
export const cardGridClass = "grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-start gap-5 sm:gap-6";

/** Section heading sizes. */
export const h2Class = "font-display text-card-title font-bold sm:text-h2-sm";
export const linkClass = "text-label font-bold text-jo-red-deep underline hover:text-walnut";
