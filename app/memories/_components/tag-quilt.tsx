import Link from "next/link";

import type { QuiltPatch } from "@/lib/memories/explore";
import { memoriesText } from "@/lib/memories/format";

const EDGE: Record<QuiltPatch["edge"], string> = {
  periwinkle: "border-periwinkle",
  goldenrod: "border-goldenrod",
  "lake-green": "border-lake-green",
  "sunhat-pink": "border-sunhat-pink",
  plum: "border-plum",
  wood: "border-wood",
};

/**
 * The quilt of patches (SPEC §2.9): bigger patch, more memories; each tilted and edged in turn. Every patch is a link
 * to the same page with that patch chosen (C5, C31). Size and tilt are per patch, so they are inline values; the
 * tilt is a CSS variable so `hover:rotate-0` can still straighten it.
 */
export function TagQuilt({ patches, hrefFor }: { patches: QuiltPatch[]; hrefFor: (slug: string) => string }) {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-[14px] rounded-card border-[3px] border-wood-light bg-paper px-4 py-6 shadow-card sm:px-8 sm:py-10">
      {patches.map((patch) => (
        <li key={patch.slug}>
          <Link
            href={hrefFor(patch.slug)}
            prefetch={false}
            scroll={false}
            aria-current={patch.selected ? "true" : undefined}
            aria-label={`${patch.name}, ${memoriesText(patch.count)}`}
            className={`inline-flex min-h-tap items-baseline gap-[10px] rounded-button px-[22px] py-[10px] font-display font-bold leading-[1.1] no-underline rotate-[var(--tilt)] motion-safe:transition-transform motion-safe:duration-150 motion-safe:hover:-translate-y-[3px] motion-safe:hover:rotate-0 ${
              patch.selected
                ? "border-[3px] border-periwinkle-deep bg-periwinkle-deep text-white shadow-button-periwinkle"
                : `border-[3px] border-dashed ${EDGE[patch.edge]} bg-paper text-walnut shadow-[0_4px_0_#e9d9c0]`
            }`}
            style={{ fontSize: `${patch.fontPx}px`, "--tilt": patch.tilt } as React.CSSProperties}
          >
            {patch.name}
            <span className="font-body text-small font-bold opacity-85">{patch.count}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
