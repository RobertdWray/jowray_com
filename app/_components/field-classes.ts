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
export const errorClass = "text-small text-jo-red-deep";
export const linkClass = "text-jo-red-deep underline hover:text-walnut break-words";
