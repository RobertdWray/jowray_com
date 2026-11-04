import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getMemoryForAdmin } from "@/features/admin/get-memory";
import { adminStatusCounts, listMemoriesForAdmin } from "@/features/admin/list-memories";

import { hasAdminSession } from "../../_session";
import { AdminShell } from "../../admin-shell";
import { MemoryAside, MemoryDetail } from "../../memory-detail";
import { MemoryList } from "../../memory-list";
import { SignedOut } from "../../signed-out";

// Static shell; the cookie and the id are read at request time inside <Suspense>.
// The Server Functions in ../../actions.ts inherit this limit.
export const maxDuration = 30;

export default function AdminMemoryPage(props: PageProps<"/admin/memories/[id]">) {
  return (
    <Suspense fallback={<p className="text-body text-walnut-soft">Loading…</p>}>
      <AdminMemory params={props.params} />
    </Suspense>
  );
}

async function AdminMemory({ params }: { params: PageProps<"/admin/memories/[id]">["params"] }) {
  await connection();
  if (!(await hasAdminSession())) {
    return <SignedOut />;
  }
  const { id } = await params;
  const [memory, list, counts] = await Promise.all([getMemoryForAdmin(id), listMemoriesForAdmin({}), adminStatusCounts()]);
  if (!memory) {
    // Streams a 200 with the not-found UI, like /m/[claimToken] (plan [C10]).
    notFound();
  }
  if (!list.ok) {
    throw new Error("the empty admin query must parse");
  }
  return (
    <AdminShell
      showList="wide"
      list={<MemoryList rows={list.rows} query={list.query} counts={counts} shown={list.shown} total={list.total} current={memory.id} />}
      detail={<MemoryDetail memory={memory} />}
      aside={<MemoryAside memory={memory} />}
    />
  );
}
