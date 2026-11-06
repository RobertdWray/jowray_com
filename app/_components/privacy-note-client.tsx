"use client";

import Link from "next/link";
import { useId, useRef, type MouseEvent, type PointerEvent } from "react";

import { SecondaryButton } from "./buttons";
import { footerLinkClass, linkClass } from "./field-classes";

// The footer's "Privacy" button and Rob's short note (Rob, 2026-11-06). The note describes the alpha telemetry in
// AGENTS.md § Sentry: when the alpha settings end, update it in the same commit as the "One honest note" bullet on
// app/how-it-was-built/page.tsx. Plan: docs/plans/2026-11-06-privacy-note-and-diagram-viewer.md.
//
// A native <dialog> opened with showModal(): the browser supplies the top layer, the inert page behind it, Esc to
// close and focus return to this button [C6, C7]. The note is several paragraphs, so focus starts on the title
// (tabIndex -1) and the dialog has no aria-describedby (WAI-ARIA APG dialog pattern) [C8].

// A press or click on the backdrop targets the <dialog> itself, and so does one on the dialog's own 3px border, so
// the pointer's position tells them apart: the backdrop is everything outside the dialog's border box. A click made
// with the keyboard (Enter or Space on Close or the link) targets that control, so it is never a backdrop click.
function isOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
  const box = event.currentTarget.getBoundingClientRect();
  const outside =
    event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  return event.target === event.currentTarget && outside;
}

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

  // Both the press and the click must be on the backdrop: selecting text inside the note and letting go over the
  // backdrop also fires a click on the <dialog>, and must not close it.
  function notePressed(event: PointerEvent<HTMLDialogElement>) {
    pressedOnBackdrop.current = isOnBackdrop(event);
  }

  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    const pressed = pressedOnBackdrop.current;
    pressedOnBackdrop.current = false;
    if (pressed && isOnBackdrop(event)) {
      close();
    }
  }

  return (
    <>
      {/* Looks like its neighbouring footer links. Tailwind v4 buttons default to the arrow cursor, hence
          cursor-pointer [C10]. */}
      <button type="button" aria-haspopup="dialog" onClick={open} className={`${footerLinkClass} cursor-pointer`}>
        Privacy
      </button>
      {/* m-auto: Preflight zeroes every margin, which would undo the browser's centring of a modal dialog [C9].
          max-w-none: the browser's own dialog max-width (100% - 6px - 2em, at the footer's 18px) would otherwise win
          over the 16px gutters the width asks for.
          open:flex, not flex: a display utility would override the browser's display:none for a closed dialog and
          show the note on the page. Inside, the text scrolls on its own above the Close row, so on a short screen
          Close stays in reach and nothing ever scrolls underneath it. */}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onPointerDown={notePressed}
        onClick={closeOnBackdrop}
        className="m-auto max-h-[calc(100%-32px)] w-[min(560px,calc(100%-32px))] max-w-none overflow-hidden rounded-card border-[3px] border-dashed border-wood bg-paper p-0 text-left text-walnut shadow-card backdrop:bg-walnut/50 open:flex open:flex-col"
      >
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 pb-4 pt-6 sm:px-8 sm:pt-8">
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
        </div>
        <div className="flex shrink-0 justify-end px-6 pb-6 pt-2 sm:px-8 sm:pb-8">
          <SecondaryButton onClick={close}>Close</SecondaryButton>
        </div>
      </dialog>
    </>
  );
}
