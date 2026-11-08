import Link from "next/link";

import { memoriesText } from "@/lib/memories/format";
import { homePoint, inHomeBounds, inUsBounds, pinSize, US_OUTLINE_PATH, US_OUTLINE_VIEWBOX, usPoint } from "@/lib/memories/places";
import type { PublicPoint } from "@/lib/memories/types";

import { SolidHeart } from "../../_components/hearts";

/** One place on a map: where it goes, how many memories, and where a press leads. */
export interface MapPin {
  slug: string;
  label: string;
  count: number;
  point: PublicPoint | null;
  selected: boolean;
  href: string;
}

/** The place label up to its first comma: "Towson, MD" → "Towson". */
export function townOf(label: string): string {
  return label.split(",", 1)[0]!.trim();
}

function PinLink({ pin, x, y, size, label }: { pin: MapPin; x: number; y: number; size: number; label: React.ReactNode }) {
  return (
    <Link
      href={pin.href}
      prefetch={false}
      scroll={false}
      aria-label={`${pin.label}: ${memoriesText(pin.count)}`}
      aria-current={pin.selected ? "true" : undefined}
      className="group absolute flex min-h-11 min-w-11 -translate-x-1/2 -translate-y-[82%] flex-col items-center text-walnut no-underline"
      // The selected pin sits above its neighbours so its name pill is never covered (SPEC §8, defect 2).
      style={{ left: `${x.toFixed(1)}%`, top: `${y.toFixed(1)}%`, zIndex: pin.selected ? 3 : 1 }}
    >
      <span className="motion-safe:transition-[filter] group-hover:brightness-110">
        <SolidHeart size={size} fill={pin.selected ? "#a50d26" : "#c8102e"} />
      </span>
      {label}
    </Link>
  );
}

const selectedPill = "-mt-[6px] whitespace-nowrap rounded-full bg-walnut px-3 py-0.5 text-small font-bold text-paper shadow-pill";
const countPill = "-mt-2 rounded-full border-2 border-wood-light bg-paper px-[9px] text-small font-bold leading-[1.4] text-jo-red-deep";
const townPill = "-mt-[6px] whitespace-nowrap rounded-full border-2 border-wood-light bg-paper px-[9px] text-small font-bold leading-[1.4] text-walnut";

/**
 * The lower 48 (plan C5, C31; SPEC §2.7): a decorative SVG outline with HTML pins on top, so every label is real
 * text at 17px or more and every pin is a link of at least 44px. Places outside the box (Alaska, Hawaii, abroad) and
 * places without a point are not pinned; they still appear in the place lists.
 */
export function UsMap({ pins, labels = true, className = "" }: { pins: MapPin[]; labels?: boolean; className?: string }) {
  const placed = pins.filter((pin): pin is MapPin & { point: PublicPoint } => pin.point !== null && inUsBounds(pin.point));
  return (
    <div className={`relative aspect-[1000/560] w-full rounded-card border-[3px] border-wood-light bg-paper shadow-card ${className}`}>
      <svg viewBox={US_OUTLINE_VIEWBOX} className="absolute inset-0 size-full" aria-hidden="true">
        <path d={US_OUTLINE_PATH} fill="#f6efe3" stroke="#c8102e" strokeWidth={3} strokeDasharray="9 7" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {placed.map((pin) => {
        const { x, y } = usPoint(pin.point);
        const label = pin.selected ? <span className={selectedPill}>{pin.label}</span> : labels && pin.count > 1 ? <span className={countPill}>{pin.count}</span> : null;
        return <PinLink key={pin.slug} pin={pin} x={x} y={y} size={pinSize(pin.count, pin.selected)} label={label} />;
      })}
    </div>
  );
}

/**
 * "Closer to home": Maryland and its neighbours, where most memories happened (SPEC §2.7). `pad` keeps edge pins and
 * their pills inside the box: the percentages are `pad.x + x × pad.w / 100` and `pad.y + y × pad.h / 100`.
 */
export function HomeInset({ pins, pad = { x: 8, w: 84, y: 12, h: 76 }, caption, className = "" }: { pins: MapPin[]; pad?: { x: number; w: number; y: number; h: number }; caption?: string; className?: string }) {
  const placed = pins.filter((pin): pin is MapPin & { point: PublicPoint } => pin.point !== null && inHomeBounds(pin.point));
  return (
    <div className={`relative aspect-square w-full overflow-visible rounded-input bg-muslin ${className}`}>
      {caption && <p className="absolute left-[14px] top-3 text-small font-bold text-walnut-soft">{caption}</p>}
      {placed.map((pin) => {
        const point = homePoint(pin.point);
        const x = pad.x + (point.x * pad.w) / 100;
        const y = pad.y + (point.y * pad.h) / 100;
        const town = townOf(pin.label);
        const label = <span className={pin.selected ? selectedPill : townPill}>{pin.selected ? pin.label : `${town} · ${pin.count}`}</span>;
        return <PinLink key={pin.slug} pin={pin} x={x} y={y} size={Math.max(24, pinSize(pin.count, pin.selected) - 4)} label={label} />;
      })}
    </div>
  );
}

/** Whether any pin falls in the home box (the inset is drawn only then). */
export function hasHomePins(pins: MapPin[]): boolean {
  return pins.some((pin) => pin.point !== null && inHomeBounds(pin.point));
}
