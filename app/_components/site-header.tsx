import Link from "next/link";
import { Suspense } from "react";

import { SolidHeart } from "./hearts";
import { NavLink } from "./nav-link-client";

const plainLinkClass = "py-[10px] text-walnut no-underline";

function Links({ showMemories, active }: { showMemories: boolean; active: boolean }) {
  const items = [...(showMemories ? [{ href: "/memories", label: "See memories" }] : []), { href: "/share", label: "Leave a memory" }, { href: "/#story", label: "Jo’s story" }];
  return (
    <nav aria-label="Site" className="flex flex-wrap gap-x-7 gap-y-2 text-label font-bold">
      {items.map((item) =>
        active ? (
          <NavLink key={item.href} href={item.href}>
            {item.label}
          </NavLink>
        ) : (
          <Link key={item.href} href={item.href} className={plainLinkClass}>
            {item.label}
          </Link>
        ),
      )}
    </nav>
  );
}

/**
 * The site header. "See memories" comes first, only while the pages are on (plan 2026-11-08 D9, D15): the root
 * layout reads the launch flag and passes it in, because this folder never reads env (it is shared with Client
 * Components) and turning the flag on or off is a redeploy anyway. The current page's link is marked with
 * `aria-current` by `NavLink` (`usePathname`), which must sit inside `<Suspense>` so routes with dynamic params keep
 * their static shell; the fallback is the same links, unmarked (C8).
 */
export function SiteHeader({ showMemories = false }: { showMemories?: boolean }) {
  return (
    // The side padding sits on the full-width landmark and the 1200px cap on the box inside it: on one box, the 5%
    // resolved against the whole window and ate into the cap as the window grew (item 7, 2026-11-04).
    <header className="px-[max(16px,5%)] py-5">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <Link href="/" className="flex items-center gap-3 text-walnut no-underline">
          <SolidHeart size={44} />
          <span className="font-display text-[30px] font-bold tracking-[-0.01em]">Jo Wray</span>
        </Link>
        <Suspense fallback={<Links showMemories={showMemories} active={false} />}>
          <Links showMemories={showMemories} active />
        </Suspense>
      </div>
    </header>
  );
}
