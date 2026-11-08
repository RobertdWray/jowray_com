import { slugify } from "@/lib/memories/slug";
import type { PlaceGroup, PublicMemory, PublicPlace, PublicPoint } from "@/lib/memories/types";

/** Normalize a contributor's place spelling; empty or unsluggable labels have no public place. */
export function normalizePlaceLabel(place: string | null | undefined): string | null {
  if (place === null || place === undefined) {
    return null;
  }
  const label = place.trim().replace(/\s+/g, " ").replace(/[.,;: ]+$/, "");
  return label && placeSlug(label) ? label : null;
}

/** Give a place the shared URL slug used by both places and tags. */
export function placeSlug(label: string): string {
  return slugify(label);
}

/** Build a public place from contributor text, keeping its normalized spelling. */
export function toPublicPlace(place: string | null | undefined): PublicPlace | null {
  const label = normalizePlaceLabel(place);
  return label === null ? null : { label, slug: placeSlug(label) };
}

/** Town-level coordinate grid in degrees (D2); never expose a photo's GPS through these helpers. */
export const POINT_STEP = 0.05;

/** Round a coordinate to the public grid without trailing floating-point noise. */
export function roundCoordinate(value: number): number {
  return Number((Math.round(value / POINT_STEP) * POINT_STEP).toFixed(2));
}

/** Validate Memory coordinates before rounding; an absent or invalid pair has no public point. */
export function roundPoint(
  lat: number | null | undefined,
  lon: number | null | undefined,
): PublicPoint | null {
  if (
    typeof lat !== "number" || typeof lon !== "number" ||
    !Number.isFinite(lat) || !Number.isFinite(lon) ||
    lat < -90 || lat > 90 || lon < -180 || lon > 180
  ) {
    return null;
  }
  return { lat: roundCoordinate(lat), lon: roundCoordinate(lon) };
}

/**
 * Group placed memories by slug, retaining the first label and non-null year range.
 * Average only available public points, round again, then rank by count and English label.
 */
export function groupPlaces(
  memories: ReadonlyArray<Pick<PublicMemory, "place" | "point" | "year">>,
): PlaceGroup[] {
  const groups = new Map<string, {
    group: PlaceGroup;
    latTotal: number;
    lonTotal: number;
    pointCount: number;
  }>();

  for (const memory of memories) {
    if (memory.place === null) {
      continue;
    }
    const { slug, label } = memory.place;
    let entry = groups.get(slug);
    if (!entry) {
      entry = {
        group: { slug, label, count: 0, firstYear: null, lastYear: null, point: null },
        latTotal: 0,
        lonTotal: 0,
        pointCount: 0,
      };
      groups.set(slug, entry);
    }

    const { group } = entry;
    group.count += 1;
    if (memory.year !== null) {
      group.firstYear = group.firstYear === null ? memory.year : Math.min(group.firstYear, memory.year);
      group.lastYear = group.lastYear === null ? memory.year : Math.max(group.lastYear, memory.year);
    }
    if (memory.point !== null) {
      entry.latTotal += memory.point.lat;
      entry.lonTotal += memory.point.lon;
      entry.pointCount += 1;
    }
  }

  return Array.from(groups.values(), ({ group, latTotal, lonTotal, pointCount }) => ({
    ...group,
    point: pointCount === 0 ? null : roundPoint(latTotal / pointCount, lonTotal / pointCount),
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "en"));
}

/** SVG coordinate box copied from the US outline in design/reference/see-memories/Map.dc.html. */
export const US_OUTLINE_VIEWBOX: string = "0 0 1000 560";

/** Contiguous US outline copied verbatim from design/reference/see-memories/Map.dc.html. */
export const US_OUTLINE_PATH: string = "M13.5 30.8 L23.7 63.8 L25.3 114.4 L18.6 154.0 L22.0 178.2 L28.7 224.4 L50.7 264.0 L60.8 290.4 L82.8 334.4 L118.3 347.6 L138.6 369.6 L142.0 380.6 L182.5 376.2 L243.4 407.0 L292.4 407.0 L321.1 396.0 L348.1 424.6 L376.9 457.6 L407.3 440.0 L439.4 490.6 L474.9 525.8 L478.3 484.0 L491.8 470.8 L518.8 451.0 L535.7 442.2 L566.1 444.4 L599.9 455.4 L610.1 431.2 L633.8 424.6 L659.1 426.8 L684.4 442.2 L703.0 435.6 L721.6 457.6 L725.0 484.0 L738.5 512.6 L750.4 541.2 L762.2 541.2 L767.3 508.2 L758.8 470.8 L747.0 437.8 L743.6 420.2 L750.4 391.6 L770.6 374.0 L794.3 349.8 L804.4 343.2 L828.1 332.2 L845.0 319.0 L838.2 290.4 L836.5 275.0 L843.3 261.8 L851.8 250.8 L855.1 237.6 L868.7 215.6 L870.3 202.4 L877.1 200.2 L904.1 191.4 L916.0 182.6 L924.4 180.4 L937.9 178.2 L929.5 158.4 L926.1 147.4 L934.6 134.2 L958.2 118.8 L988.6 110.0 L975.1 90.2 L975.1 59.4 L956.5 55.0 L951.5 52.8 L932.9 81.4 L921.0 99.0 L880.5 105.6 L858.5 105.6 L831.5 123.2 L823.0 136.4 L787.5 143.0 L784.2 147.4 L787.5 151.8 L767.3 162.8 L740.2 182.6 L709.8 178.2 L716.6 169.4 L726.7 149.6 L725.0 127.6 L709.8 96.8 L689.5 88.0 L674.3 103.4 L659.1 123.2 L662.5 147.4 L640.5 173.8 L637.1 151.8 L650.6 107.8 L643.9 72.6 L633.8 63.8 L599.9 68.2 L564.5 66.0 L583.0 50.6 L606.7 39.6 L599.9 37.4 L522.2 24.2 L512.1 17.6 L37.2 17.6 L45.6 33.0 Z";

/** Position as percentages of a map box's width and height, with the origin at its top left. */
export interface MapPercent {
  x: number;
  y: number;
}

/** Project a point onto the US map using the formula shared by both artboards, without clipping. */
export function usPoint(point: PublicPoint): MapPercent {
  return { x: (point.lon + 125.5) * 1.69, y: (49.8 - point.lat) * 3.9286 };
}

/** Whether a projected point fits within the US map box, including its edges. */
export function inUsBounds(point: PublicPoint): boolean {
  const { x, y } = usPoint(point);
  return x >= 0 && x <= 100 && y >= 0 && y <= 100;
}

/** Geographic limits shared by the desktop and phone "Closer to home" artboards. */
export const HOME_BOUNDS = { west: -77.7, east: -74.7, south: 38.1, north: 40.6 } as const;

/** Whether a point belongs in the home inset; the public map includes all four boundary edges. */
export function inHomeBounds(point: PublicPoint): boolean {
  return point.lon >= HOME_BOUNDS.west && point.lon <= HOME_BOUNDS.east &&
    point.lat >= HOME_BOUNDS.south && point.lat <= HOME_BOUNDS.north;
}

/**
 * Project onto the desktop inset's full 0–100% box, without clipping.
 * Phone-Map.dc.html adds presentation padding (8 + x * 0.84, 14 + y * 0.8).
 */
export function homePoint(point: PublicPoint): MapPercent {
  return {
    x: ((point.lon - HOME_BOUNDS.west) / (HOME_BOUNDS.east - HOME_BOUNDS.west)) * 100,
    y: ((HOME_BOUNDS.north - point.lat) / (HOME_BOUNDS.north - HOME_BOUNDS.south)) * 100,
  };
}

/** Heart size in pixels from the plan and phone artboard; selection adds six pixels after rounding. */
export function pinSize(count: number, selected: boolean): number {
  return Math.round(26 + Math.sqrt(count) * 7) + (selected ? 6 : 0);
}
