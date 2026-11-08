import { decadeOf } from "@/lib/memories/approx-year";
import { decadeRange, oldestFirst } from "@/lib/memories/explore";
import { memoriesText } from "@/lib/memories/format";
import type { PublicKind, PublicMemory } from "@/lib/memories/types";

/** Approved family copy for the baseline decades; extended decades have no era description. */
export const ERAS: Readonly<Record<number, string>> = {
  1950: "Growing up on Army posts",
  1960: "Last Army years, then Towson",
  1970: "A Christmas Eve wedding, and a classroom",
  1980: "The teaching years",
  1990: "The teaching years",
  2000: "The teaching years, then retirement",
  2010: "Quilts, bargains and Santa",
  2020: "Grandma Jo",
};

/** Approved date ranges and descriptions for the Explore page's overview of Jo's life. */
export const ERA_LINE: ReadonlyArray<{ range: string; text: string }> = [
  { range: "1949–66", text: "Growing up on Army posts" },
  { range: "1967–71", text: "Towson, and a tall guy named Richard" },
  { range: "1971–2008", text: "The teaching years" },
  { range: "2009–17", text: "Quilts, bargains and Santa" },
  { range: "2018–", text: "Grandma Jo" },
];

/** One dated year, with a visitor-facing count and its memories in oldest-first order. */
export interface TimelineYear {
  year: number;
  countText: string;
  memories: PublicMemory[];
}

/** A decade section with accessible element ids, optional era copy and ascending years. */
export interface TimelineDecade {
  decade: number;
  id: string;
  headingId: string;
  bodyId: string;
  era: string | null;
  count: number;
  countText: string;
  years: TimelineYear[];
}

/** Timeline content and navigation; the title and decade range ignore the optional kind filter. */
export interface TimelineModel {
  title: string | null;
  jumps: Array<{ decade: number; id: string; count: number; label: string; shortLabel: string }>;
  maxCount: number;
  decades: TimelineDecade[];
  undated: { id: "undated"; count: number; countText: string; memories: PublicMemory[] } | null;
  kind: PublicKind | null;
  openDecade: number | null;
}

/**
 * Build all decade sections and a separate undated group without mutating memories.
 * Kind filters affect counts and cards only; the fullest decade opens first, with ties favoring the earliest.
 */
export function buildTimeline(memories: readonly PublicMemory[], kind?: PublicKind): TimelineModel {
  let first: number | null = null;
  let last: number | null = null;
  for (const memory of memories) {
    if (memory.year !== null) {
      first = first === null ? memory.year : Math.min(first, memory.year);
      last = last === null ? memory.year : Math.max(last, memory.year);
    }
  }
  const title = first === null || last === null
    ? null
    : first === last ? `Jo stories from ${first}` : `${last - first} years of Jo stories, ${first} to ${last}`;

  const byYear = new Map<number, PublicMemory[]>();
  const undatedMemories: PublicMemory[] = [];
  for (const memory of oldestFirst(memories.filter((memory) => !kind || memory.kind === kind))) {
    if (memory.year === null) {
      undatedMemories.push(memory);
    } else {
      const yearMemories = byYear.get(memory.year);
      if (yearMemories) {
        yearMemories.push(memory);
      } else {
        byYear.set(memory.year, [memory]);
      }
    }
  }
  const byDecade = new Map<number, TimelineYear[]>();
  for (const [year, yearMemories] of byYear) {
    const decade = decadeOf(year);
    const entry = { year, countText: memoriesText(yearMemories.length), memories: yearMemories };
    const years = byDecade.get(decade);
    if (years) {
      years.push(entry);
    } else {
      byDecade.set(decade, [entry]);
    }
  }
  const decades = decadeRange(memories.map((memory) => memory.year)).map((decade) => {
    const years = byDecade.get(decade) ?? [];
    const count = years.reduce((total, year) => total + year.memories.length, 0);
    return {
      decade,
      id: `d${decade}`,
      headingId: `h${decade}`,
      bodyId: `b${decade}`,
      era: ERAS[decade] ?? null,
      count,
      countText: count > 0 ? memoriesText(count) : "nothing yet",
      years,
    };
  });
  const jumps = decades.map(({ decade, id, count }) => ({
    decade, id, count, label: `${decade}s`, shortLabel: `’${String(decade % 100).padStart(2, "0")}`,
  }));
  let maxCount = 0;
  let openDecade: number | null = null;
  for (const decade of decades) {
    if (decade.count > maxCount) {
      maxCount = decade.count;
      openDecade = decade.decade;
    }
  }
  return {
    title, jumps, maxCount, decades,
    undated: undatedMemories.length > 0
      ? { id: "undated", count: undatedMemories.length, countText: memoriesText(undatedMemories.length), memories: undatedMemories }
      : null,
    kind: kind ?? null,
    openDecade,
  };
}
