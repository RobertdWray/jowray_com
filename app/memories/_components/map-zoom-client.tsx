"use client";

import { useState, type ReactNode } from "react";

/** Switch the phone map's scale while keeping both server-rendered maps readable without JavaScript. */
export function MapZoom({ home, us }: { home: ReactNode; us: ReactNode }) {
  const [view, setView] = useState<"home" | "us">("home");

  return (
    <>
      <div role="group" aria-label="How far out" className="flex gap-2">
        {(["home", "us"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={view === option}
            onClick={() => setView(option)}
            className={`flex-1 min-h-13 rounded-full text-label font-bold ${view === option ? "bg-periwinkle-deep text-white shadow-[0_4px_0_#26406a]" : "border-[3px] border-dashed border-periwinkle bg-paper text-walnut"}`}
          >
            {option === "home" ? "Close to home" : "Whole country"}
          </button>
        ))}
      </div>
      <div data-zoom-slot hidden={view !== "home"}>{home}</div>
      <div data-zoom-slot hidden={view !== "us"}>{us}</div>
      <noscript><style>{"[data-zoom-slot]{display:block!important}"}</style></noscript>
    </>
  );
}
