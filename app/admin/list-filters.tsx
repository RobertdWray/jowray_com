import Link from "next/link";

import type { AdminStatusCounts } from "@/features/admin/list-memories";
import type { AdminListQuery } from "@/lib/validations/admin";

import { tertiaryButtonClass } from "../_components/buttons";
import { inputClass } from "../_components/field-classes";
import { STATUS_LABEL } from "./format";

const STATUSES = ["DRAFT", "PENDING", "APPROVED", "HIDDEN"] as const;

function chipHref(query: AdminListQuery, patch: Partial<AdminListQuery> & { deleted?: boolean }): string {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  if (next.status) {
    params.set("status", next.status);
  }
  if (next.q) {
    params.set("q", next.q);
  }
  if (next.deleted) {
    params.set("deleted", "on");
  }
  const text = params.toString();
  return text.length === 0 ? "/admin" : `/admin?${text}`;
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-tap items-center rounded-input border-2 px-4 text-label font-bold no-underline ${active ? "border-walnut bg-walnut text-paper" : "border-wood bg-paper text-walnut"}`}
    >
      {children}
    </Link>
  );
}

/** Status chips (plain links) and the search box (a GET form, no JavaScript). */
export function ListFilters({ query, counts }: { query: AdminListQuery; counts: AdminStatusCounts }) {
  const showingDeleted = query.deleted === true;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Chip href={chipHref(query, { status: undefined, deleted: false })} active={!query.status && !showingDeleted}>
          All ({counts.total})
        </Chip>
        {STATUSES.map((status) => (
          <Chip key={status} href={chipHref(query, { status, deleted: false })} active={query.status === status && !showingDeleted}>
            {STATUS_LABEL[status]} ({counts[status]})
          </Chip>
        ))}
        <Chip href={chipHref(query, { status: undefined, deleted: true })} active={showingDeleted}>
          Deleted ({counts.deleted})
        </Chip>
      </div>
      <form method="get" action="/admin" className="flex flex-wrap items-end gap-2">
        {query.status && <input type="hidden" name="status" value={query.status} />}
        {showingDeleted && <input type="hidden" name="deleted" value="on" />}
        <label className="flex min-w-0 flex-1 basis-[200px] flex-col gap-1 text-small font-bold">
          <span>Search words, place, name or email</span>
          <input name="q" type="search" defaultValue={query.q ?? ""} maxLength={100} className={inputClass} />
        </label>
        <button type="submit" className={tertiaryButtonClass}>
          Search
        </button>
      </form>
    </div>
  );
}
