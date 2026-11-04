import { connection } from "next/server";
import { Suspense } from "react";

import { adminStatusCounts, listMemoriesForAdmin } from "@/features/admin/list-memories";

import { hasAdminSession } from "./_session";
import { AdminShell } from "./admin-shell";
import { MemoryList } from "./memory-list";
import { SignedOut } from "./signed-out";

// Static shell; the cookie and the query string are read at request time inside <Suspense>.
export const maxDuration = 30;

export default function AdminPage(props: PageProps<"/admin">) {
  return (
    <Suspense fallback={<p className="text-body text-walnut-soft">Loading…</p>}>
      <AdminList searchParams={props.searchParams} />
    </Suspense>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function AdminList({ searchParams }: { searchParams: PageProps<"/admin">["searchParams"] }) {
  await connection();
  if (!(await hasAdminSession())) {
    return <SignedOut />;
  }
  const params = await searchParams;
  const raw = { status: first(params.status), q: first(params.q), deleted: first(params.deleted) };
  const [list, counts] = await Promise.all([listMemoriesForAdmin(raw), adminStatusCounts()]);
  // A hand-edited query string that fails validation shows the plain list rather than an error.
  const shown = list.ok ? list : await listMemoriesForAdmin({});
  if (!shown.ok) {
    throw new Error("the empty admin query must parse");
  }
  return (
    <AdminShell
      showList="always"
      list={<MemoryList rows={shown.rows} query={shown.query} counts={counts} shown={shown.shown} total={shown.total} />}
      detail={<p className="text-body text-walnut-soft">Choose a memory to read or edit it.</p>}
    />
  );
}
