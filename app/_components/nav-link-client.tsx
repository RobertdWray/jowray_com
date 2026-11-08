"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { isActivePath } from "@/lib/memories/client-logic";

/** Share the pure path matcher with consumers of the navigation component. */
export { isActivePath } from "@/lib/memories/client-logic";

/** Underline the current page or section; the header supplies the routing Suspense boundary. */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const active = isActivePath(usePathname(), href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`text-walnut no-underline ${active ? "border-b-[3px] border-dashed border-jo-red pb-[7px] pt-[10px]" : "py-[10px]"}`}
    >
      {children}
    </Link>
  );
}
