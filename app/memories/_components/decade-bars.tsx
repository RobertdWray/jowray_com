import Link from "next/link";

import { barHeight, memoriesText } from "@/lib/memories/format";

import { chipCountClass } from "./chips";

/** One decade bar: its count, whether it is the chosen one, and where a press leads. */
export interface DecadeBar {
  decade: number;
  count: number;
  selected: boolean;
  href: string;
}

const shortLabel = (decade: number) => `’${String(decade % 100).padStart(2, "0")}`;

/**
 * The "When" chart (SPEC §2.8): a bar per decade, a chip under it and, from `sm`, the count. Below `sm` the bars are
 * shorter and the chips read ’50, ’60. Each item is one link (C5): on Explore it toggles the decade filter, on the
 * timeline it jumps to the decade's section.
 */
export function DecadeBars({ bars, max, variant }: { bars: DecadeBar[]; max: number; variant: "filter" | "jump" }) {
  const full = variant === "filter" ? { px: 80, min: 8, empty: 4, phone: 48 } : { px: 56, min: 6, empty: 3, phone: 44 };
  return (
    <ul className={`flex items-end gap-[6px] sm:flex-wrap ${variant === "filter" ? "rounded-card border-[3px] border-wood-light bg-paper px-3 pb-3 pt-4 shadow-card sm:gap-[10px] sm:px-4 sm:pb-4 sm:pt-5" : "sm:gap-2"}`}>
      {bars.map((bar) => {
        const phoneHeight = barHeight(bar.count, max, full.phone, 6, 3);
        const height = barHeight(bar.count, max, full.px, full.min, full.empty);
        const colour = bar.selected ? "bg-periwinkle-deep" : bar.count > 0 ? "bg-periwinkle" : "bg-wood-light";
        const label = `${bar.decade}s`;
        return (
          <li key={bar.decade} className={`flex min-w-0 flex-[1_1_0] flex-col items-center gap-[6px] ${variant === "filter" ? "sm:flex-[1_1_110px] sm:gap-[10px]" : "sm:flex-[1_1_90px] sm:gap-2"}`}>
            <Link
              href={bar.href}
              prefetch={false}
              scroll={variant === "jump" ? undefined : false}
              aria-current={bar.selected ? "true" : undefined}
              aria-label={`${label}, ${memoriesText(bar.count)}`}
              className="flex w-full flex-col items-center gap-[6px] text-walnut no-underline sm:gap-[10px]"
            >
              <span className={`flex w-full items-end justify-center ${variant === "filter" ? "h-12 sm:h-20" : "h-11 sm:h-14"}`} aria-hidden="true">
                <span
                  className={`block w-[70%] rounded-t-[6px] sm:w-[58%] sm:rounded-t-[8px] ${colour} h-[var(--bar-phone)] sm:h-[var(--bar)]`}
                  style={{ "--bar-phone": `${phoneHeight}px`, "--bar": `${height}px` } as React.CSSProperties}
                />
              </span>
              <span
                className={`inline-flex min-h-10 w-full items-center justify-center rounded-[10px] border-2 text-small font-bold sm:min-h-11 sm:w-auto sm:rounded-full sm:border-[3px] sm:px-[14px] sm:text-label ${
                  bar.selected ? "border-solid border-periwinkle-deep bg-periwinkle-deep text-white" : "border-dashed border-periwinkle bg-paper"
                }`}
              >
                <span className="sm:hidden" aria-hidden="true">
                  {shortLabel(bar.decade)}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </span>
            </Link>
            {variant === "filter" && <span className="hidden text-small text-walnut-soft sm:inline">{bar.count > 0 ? memoriesText(bar.count) : "none yet"}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** A chip with its count (decade, patch or kind). */
export function CountChip({ href, label, count, selected, className }: { href: string; label: string; count?: number; selected: boolean; className: string }) {
  return (
    <Link href={href} prefetch={false} scroll={false} aria-current={selected ? "true" : undefined} className={className}>
      {label}
      {count !== undefined && <span className={chipCountClass}>{count}</span>}
    </Link>
  );
}
