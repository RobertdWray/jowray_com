/** Earliest four-digit year accepted from a memory's free-text date. */
export const MIN_YEAR = 1900;

/**
 * Finds the first valid year in a memory's free-text date, using UTC for the
 * current year. Apostrophe years prefer the 2000s unless that is in the future;
 * four-digit years must be between MIN_YEAR and the current year, inclusive,
 * and cannot be part of a longer digit run.
 */
export function parseApproxYear(text: string | null | undefined, now: Date = new Date()): number | null {
  if (!text) {
    return null;
  }

  const currentYear = now.getUTCFullYear();
  for (const match of text.matchAll(/['‘’](\d{2})(?!\d)|\d+/g)) {
    if (match[1] !== undefined) {
      const shortYear = Number(match[1]);
      const year = 2000 + shortYear;
      return year <= currentYear ? year : 1900 + shortYear;
    }

    if (match[0].length !== 4) {
      continue;
    }

    const year = Number(match[0]);
    if (year >= MIN_YEAR && year <= currentYear) {
      return year;
    }
  }

  return null;
}

/** Uses the family's explicit year when present, otherwise parses the date text. */
export function displayYear(
  memory: { approxYear: number | null; approxDateText: string | null },
  now: Date = new Date(),
): number | null {
  return memory.approxYear ?? parseApproxYear(memory.approxDateText, now);
}

/** Finds the first year of the decade containing a year for timeline grouping. */
export function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}
