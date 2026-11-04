/**
 * How far the page scrolls to show a revealed field: its label, the field and
 * its error line together. Pure, so the arithmetic is tested in Node; the form
 * measures the boxes and calls `window.scrollBy`. A block that fits is centred
 * (label, field and words all on screen). A block taller than the window has
 * its top aligned, so the label and the start of the field, where the caret
 * is, are visible rather than a middle slice with neither end.
 */
export interface Box {
  top: number;
  bottom: number;
}

/** Breathing room above a block that is aligned to the top. */
const EDGE = 16;

export function unionRect(boxes: ReadonlyArray<Box>): Box {
  return boxes.reduce((acc, box) => ({ top: Math.min(acc.top, box.top), bottom: Math.max(acc.bottom, box.bottom) }), {
    top: Number.POSITIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY,
  });
}

export function revealScrollDelta(block: Box, viewportHeight: number): number {
  if (block.bottom - block.top > viewportHeight) {
    return Math.round(block.top - EDGE);
  }
  return Math.round((block.top + block.bottom) / 2 - viewportHeight / 2);
}
