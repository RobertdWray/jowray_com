import Link from "next/link";
import { SolidHeart } from "./hearts";

export function SiteHeader() {
  return (
    // The side padding sits on the full-width landmark and the 1200px cap on the box inside it: on one box, the 5%
    // resolved against the whole window and ate into the cap as the window grew (item 7, 2026-11-04).
    <header className="px-[max(16px,5%)] py-5">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <Link href="/" className="flex items-center gap-3 text-walnut no-underline">
          <SolidHeart size={44} />
          <span className="font-display text-[30px] font-bold tracking-[-0.01em]">Jo Wray</span>
        </Link>
        <nav className="flex flex-wrap gap-x-7 gap-y-2 text-label font-bold">
          <Link href="/share" className="py-[10px] text-walnut no-underline">
            Leave a memory
          </Link>
          <Link href="/#story" className="py-[10px] text-walnut no-underline">
            Jo&apos;s story
          </Link>
        </nav>
      </div>
    </header>
  );
}
