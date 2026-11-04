import Link from "next/link";

import type { AdminListRow, AdminStatusCounts } from "@/features/admin/list-memories";
import type { AdminListQuery } from "@/lib/validations/admin";

import { formatDate } from "./format";
import { ListFilters } from "./list-filters";
import { StatusBadge } from "./status-badge";

function mediaSummary(media: AdminListRow["media"]): string {
  const parts: string[] = [];
  if (media.photos > 0) {
    parts.push(`${media.photos} photo${media.photos === 1 ? "" : "s"}`);
  }
  if (media.videos > 0) {
    parts.push(`${media.videos} video${media.videos === 1 ? "" : "s"}`);
  }
  if (media.audios > 0) {
    parts.push(`${media.audios} recording${media.audios === 1 ? "" : "s"}`);
  }
  if (media.pending > 0) {
    parts.push(`${media.pending} still arriving`);
  }
  if (media.failed > 0) {
    parts.push(`${media.failed} failed`);
  }
  return parts.length === 0 ? "Words only" : parts.join(" · ");
}

/** The list rail: filters, then one card per memory (newest first), the open one marked. */
export function MemoryList({ rows, query, counts, shown, total, current }: { rows: AdminListRow[]; query: AdminListQuery; counts: AdminStatusCounts; shown: number; total: number; current?: string }) {
  return (
    <section aria-label="Memories" className="flex min-w-0 flex-col gap-4">
      <ListFilters query={query} counts={counts} />
      {shown < total && (
        <p className="text-small text-walnut-soft" role="status">
          Showing {shown} of {total}. Narrow the search to see the rest.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-body text-walnut-soft">Nothing here yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const open = row.id === current;
            const who = row.contributor?.name ?? row.contributor?.email ?? "Unnamed";
            return (
              <li key={row.id}>
                <Link
                  href={`/admin/memories/${row.id}`}
                  prefetch={false}
                  aria-current={open ? "page" : undefined}
                  className={`flex min-h-tap min-w-0 flex-col gap-2 rounded-card border-[3px] bg-paper p-4 text-walnut no-underline shadow-card ${open ? "border-walnut" : "border-wood-light hover:border-wood"}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={row.status} deleted={row.deletedAt !== null} />
                    <span className="text-small text-walnut-soft">{formatDate(row.createdAt)}</span>
                  </div>
                  <p className="min-w-0 break-words text-label font-bold">
                    {who}
                    {row.contributor?.relationship && <span className="font-normal text-walnut-soft"> · {row.contributor.relationship}</span>}
                  </p>
                  {row.excerpt.length > 0 && <p className="min-w-0 break-words text-small">{row.excerpt}</p>}
                  <p className="text-small text-walnut-soft">{mediaSummary(row.media)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
