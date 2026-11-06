"use client";

import Link from "next/link";
import { useId, useRef, type MouseEvent, type PointerEvent } from "react";

import { SecondaryButton } from "./buttons";
import { linkClass } from "./field-classes";

// The footer's "Privacy" button and Rob's short note (Rob, 2026-11-06). The note describes the alpha telemetry in
// AGENTS.md § Sentry: when the alpha settings end, update it in the same commit as the "One honest note" bullet on
// app/how-it-was-built/page.tsx. Plan: docs/plans/2026-11-06-privacy-note-and-diagram-viewer.md.
//
// A native <dialog> opened with showModal(): the browser supplies the top layer, the inert page behind it, Esc to
// close and focus return to this button [C6, C7]. The note is several paragraphs, so focus starts on the title
// (tabIndex -1) and the dialog has no aria-describedby (WAI-ARIA APG dialog pattern) [C8].
export function PrivacyNote() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();

  function open() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) {
      return;
    }
    dialog.showModal();
    titleRef.current?.focus();
  }

  function close() {
    dialogRef.current?.close();
  }

  // The padding lives on the inner wrapper and the dialog itself is p-0, so an event whose target is the <dialog>
  // can only be on the backdrop around it. Both the press and the click must be there: selecting text inside the
  // note and letting go over the backdrop also fires a click on the <dialog>, and must not close it.
  function notePressed(event: PointerEvent<HTMLDialogElement>) {
    pressedOnBackdrop.current = event.target === event.currentTarget;
  }

  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (pressedOnBackdrop.current && event.target === event.currentTarget) {
      close();
    }
    pressedOnBackdrop.current = false;
  }

  return (
    <>
      {/* Looks like its neighbouring footer links; 44px tall for touch (DESIGN.md § 6). Tailwind v4 buttons
          default to the arrow cursor, hence cursor-pointer [C10]. */}
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={open}
        className={`${linkClass} inline-flex min-h-[44px] cursor-pointer items-center`}
      >
        Privacy
      </button>
      {/* m-auto: Preflight zeroes every margin, which would undo the browser's centring of a modal dialog [C9]. */}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onPointerDown={notePressed}
        onClick={closeOnBackdrop}
        className="m-auto max-h-[calc(100%-32px)] w-[min(560px,calc(100%-32px))] overflow-y-auto rounded-card border-[3px] border-dashed border-wood bg-paper p-0 text-left text-walnut shadow-card backdrop:bg-walnut/50"
      >
        <div className="flex flex-col gap-4 p-6 sm:p-8">
          <h2
            id={titleId}
            ref={titleRef}
            tabIndex={-1}
            className="font-display text-card-title font-bold focus:outline-none"
          >
            Privacy, the short version
          </h2>
          <p className="text-body leading-[1.6]">
            This website was vibe coded. We track everything to fix bugs. If you use the website, you accept that
            we record the screen, the logs and what you click and type, to make the site better.
          </p>
          <p className="text-body leading-[1.6]">
            This is just for family and friends, so I&apos;m not doing a big nutso legal disclaimer that you have
            to click OK on. <span className="whitespace-nowrap">— Rob</span>
          </p>
          <p className="text-body leading-[1.6]">
            To see how this site works or read the source code, go to{" "}
            {/* The footer sits in the root layout, which survives client navigation: close the note first [C11]. */}
            <Link href="/how-it-was-built" onClick={close} className={linkClass}>
              How this site was built
            </Link>
            .
          </p>
          {/* Sticky: on a short phone screen the note scrolls inside the dialog, and Close stays in reach at the
              bottom. The negative margins let its paper background run edge to edge over the scrolled text. */}
          <div className="sticky bottom-0 -mx-6 -mb-6 flex justify-end bg-paper px-6 pb-6 pt-2 sm:-mx-8 sm:-mb-8 sm:px-8 sm:pb-8">
            <SecondaryButton onClick={close}>Close</SecondaryButton>
          </div>
        </div>
      </dialog>
    </>
  );
}
