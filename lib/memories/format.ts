import type { PublicKind } from "@/lib/memories/types";

/** Label a count, using the singular only for one and a supplied irregular plural when needed. */
export function countNoun(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Label a memory count with the correct irregular plural. */
export function memoriesText(n: number): string {
  return countNoun(n, "memory", "memories");
}

/** Label a positive duration in seconds below a minute, otherwise in rounded minutes. */
export function durationText(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return seconds < 60 ? `${seconds} sec` : `${Math.round(seconds / 60)} min`;
}

/** Show the playback clock as minutes and whole seconds, flooring fractions and rejecting invalid times. */
export function clockText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

/** The shared visitor-facing labels for filters, counts, badges and memory headings. */
export const KIND_TEXT: Record<PublicKind, {
  chip: string;
  singular: string;
  plural: string;
  badge: string;
  eyebrow: string;
}> = {
  PHOTO: { chip: "Photos", singular: "photo", plural: "photos", badge: "Photos", eyebrow: "A memory from" },
  VOICE: { chip: "Voices", singular: "voice", plural: "voices", badge: "A voice", eyebrow: "A voice memory from" },
  VIDEO: { chip: "Videos", singular: "video", plural: "videos", badge: "A video", eyebrow: "A video memory from" },
  TEXT: { chip: "Written", singular: "written memory", plural: "written memories", badge: "In writing", eyebrow: "A memory from" },
};

/**
 * Decorative waveform heights, seeded with unsigned 32-bit FNV-1a over the id's UTF-16 code units.
 * Count is a nonnegative integer; modulo is a positive integer pixel range. Reduce terms before summing.
 */
export function fakeBars(id: string, count: number, modulo = 40, base = 8): number[] {
  let seed = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    seed = Math.imul(seed ^ id.charCodeAt(index), 16777619) >>> 0;
  }
  const seedTerm = ((seed % modulo) * 37) % modulo;
  return Array.from({ length: count }, (_, index) => {
    const k = index % modulo;
    const linearTerm = (k * 53) % modulo;
    const squareTerm = (((k * k) % modulo) * 11) % modulo;
    return base + ((seedTerm + linearTerm + squareTerm) % modulo);
  });
}

/** Size a decade bar relative to the maximum, with separate minimum and empty heights. */
export function barHeight(count: number, max: number, fullPx: number, minPx: number, emptyPx: number): number {
  return count > 0 ? Math.max(minPx, Math.round(count / Math.max(1, max) * fullPx)) : emptyPx;
}
