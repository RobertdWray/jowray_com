import type { ReactNode } from "react";

/**
 * The admin page's columns (docs/plans/2026-11-04-admin-page.md §3.8), CSS only:
 * phones get one column (the list on /admin, the detail alone on a memory's
 * page); from 48rem the list is a sticky rail beside the detail; from 100rem
 * the detail's aside (gallery, status, history) becomes a third column.
 */
export function AdminShell({ list, detail, aside, showList }: { list: ReactNode; detail: ReactNode; aside?: ReactNode; showList: "always" | "wide" }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 wide:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] min-[100rem]:grid-cols-[440px_minmax(0,1fr)_minmax(420px,600px)]">
      <div className={`${showList === "wide" ? "hidden wide:block" : ""} min-w-0 wide:sticky wide:top-4 wide:max-h-[calc(100dvh-2rem)] wide:overflow-y-auto`}>{list}</div>
      {/* Below 100rem the editor and its aside stack in one column; `contents` lifts them into the grid above it. */}
      <div className={`${showList === "always" ? "hidden wide:flex" : "flex"} min-w-0 flex-col gap-6 min-[100rem]:contents`}>
        <div className="min-w-0">{detail}</div>
        {aside !== undefined && <div className="min-w-0">{aside}</div>}
      </div>
    </div>
  );
}
