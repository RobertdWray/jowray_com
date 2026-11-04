import type { Metadata } from "next";
import Link from "next/link";

import { leaveAdmin } from "./actions";

// Everything under /admin is private: never indexed, never prefetched
// (200 list rows behind a cookie; connection() would block a prefetch anyway).
export const metadata: Metadata = {
  title: "Family admin",
  robots: { index: false, follow: false },
};
export const prefetch = "force-disabled";

const barLinkClass = "min-h-tap inline-flex items-center px-2 text-label font-bold text-walnut no-underline hover:text-jo-red-deep";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <main className="flex w-full flex-1 flex-col gap-6 px-[max(16px,2%)] py-6">
      <nav aria-label="Family admin" className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b-[3px] border-wood-light pb-3">
        <Link href="/admin" prefetch={false} className="font-display text-card-title font-bold text-walnut no-underline">
          Family admin
        </Link>
        <Link href="/admin" prefetch={false} className={barLinkClass}>
          All memories
        </Link>
        <Link href="/admin/new" prefetch={false} className={barLinkClass}>
          Draft for someone
        </Link>
        {/* Rendered whether or not a session exists: a stale cookie is cleared the same way. */}
        <form action={leaveAdmin} className="ml-auto">
          <button type="submit" className={barLinkClass}>
            Sign out
          </button>
        </form>
      </nav>
      {children}
    </main>
  );
}
