"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { decadeFromHash, decadeFromLink } from "@/lib/memories/client-logic";

/** Server-rendered labels and content for one decade on the timeline. */
export interface TimelineDecadeItem {
  id: string;
  bodyId: string;
  aside: ReactNode;
  toggle: ReactNode;
  body: ReactNode;
}

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readHash() {
  return window.location.hash;
}

function serverHash() {
  return "";
}

/**
 * Show every decade on desktop and one at a time on phones, opening hash-linked decades after hydration and whenever a
 * link to a decade is pressed, even one whose fragment is already current.
 */
export function TimelineDecades({ items, defaultOpen }: { items: TimelineDecadeItem[]; defaultOpen: string | null }) {
  const hash = useSyncExternalStore(subscribeToHash, readHash, serverHash);
  const [selection, setSelection] = useState({ hash: "", openId: defaultOpen });

  // The server snapshot keeps hydration identical. A changed external fragment updates
  // the selection before children render, while an unrelated hash preserves the open decade.
  if (selection.hash !== hash) {
    setSelection({
      hash,
      openId: decadeFromHash(hash, items.map((item) => item.id)) ?? selection.openId,
    });
  }

  // A jump link pressed again (its fragment already current, so no hashchange) must still open its decade (TCR round
  // 1, B2-4): every plain click on a same-page link to a decade opens it. A new fragment is opened by the block above
  // as well; both agree. The listener lives on the document because the jump links are server-rendered elsewhere.
  // A stable dependency for the listener: decade ids are DOM ids, so they never contain a space.
  const ids = items.map((item) => item.id).join(" ");
  useEffect(() => {
    const decadeIds = ids.split(" ");
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) {
        return;
      }
      const link = event.target.closest("a[href]");
      const openId = link ? decadeFromLink(link.getAttribute("href") ?? "", window.location.href, decadeIds) : null;
      if (openId !== null) {
        setSelection({ hash: window.location.hash, openId });
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [ids]);

  return (
    <>
      <noscript><style>{"[data-decade-body]{display:block!important}"}</style></noscript>
      {items.map((item) => {
        const open = selection.openId === item.id;
        return (
          <section key={item.id} id={item.id} className="scroll-mt-6 flex flex-col gap-3 pb-6 sm:flex-row sm:flex-wrap sm:gap-x-10 sm:gap-y-6 sm:pb-14">
            <div className="hidden sm:flex sm:flex-[0_1_220px] sm:min-w-[180px] sm:flex-col sm:gap-[10px] sm:pt-1">
              {item.aside}
            </div>
            <button
              type="button"
              className="sm:hidden flex w-full min-h-tap items-center justify-between gap-3 text-left"
              aria-expanded={open}
              aria-controls={item.bodyId}
              onClick={() => setSelection({ hash, openId: open ? null : item.id })}
            >
              {item.toggle}
              <svg
                width={28}
                height={28}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                aria-hidden="true"
                className={`shrink-0 text-jo-red-deep${open ? " rotate-180" : ""}`}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <div
              id={item.bodyId}
              data-decade-body
              className={open ? "min-w-0 flex-[1_1_640px]" : "hidden min-w-0 flex-[1_1_640px] sm:block"}
            >
              {item.body}
            </div>
          </section>
        );
      })}
    </>
  );
}
