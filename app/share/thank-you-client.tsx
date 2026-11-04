"use client";

import { useEffect, useRef } from "react";

import { PrimaryButton, secondaryButtonClass } from "../_components/buttons";
import { linkClass } from "../_components/field-classes";
import { SolidHeart } from "../_components/hearts";

export interface SentMemory {
  position: number;
  label: string;
  claimLink: string;
  failedFiles: string[];
}

/**
 * The done screen (D12): the approved copy with plural variants, one private
 * link per memory, partial failures named, and the share button called only
 * from its click (C57). The heading takes focus so the result is announced (C48).
 */
export function ThankYou({ memories, emailed, hasEmail, onAnother }: { memories: SentMemory[]; emailed: boolean; hasEmail: boolean; onAnother: () => void }) {
  const origin = window.location.origin;
  const several = memories.length > 1;
  // Focus once when the screen appears (C48); a re-render of the parent must not pull focus off a link.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const mailto = `mailto:?subject=${encodeURIComponent("Tell a Jo story")}&body=${encodeURIComponent(`Jo's family is collecting memories of her. If you knew Jo, tell yours here: ${origin}/`)}`;
  const failed = memories.flatMap((m) => m.failedFiles);

  function share(event: React.MouseEvent<HTMLAnchorElement>) {
    if (typeof navigator.share === "function") {
      event.preventDefault();
      void navigator
        .share({ title: "Tell us a Jo story", text: "Jo's family is collecting memories of her.", url: `${origin}/` })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }
          window.location.assign(mailto);
        });
    }
  }

  return (
    <section className="flex flex-1 flex-col items-center justify-center px-[max(16px,5%)] pb-20 pt-10">
      <div className="flex w-full max-w-[760px] flex-col items-center gap-7 text-center">
        <div className="patchwork rounded-full p-[14px] shadow-[0_12px_26px_rgb(46_36_32/0.18)]">
          <div className="flex size-[150px] items-center justify-center rounded-full bg-paper">
            <SolidHeart size={96} stitchColor="#fffdf8" label="A stitched red heart" />
          </div>
        </div>
        <h1 tabIndex={-1} ref={headingRef} className="font-display text-display-sm font-extrabold outline-none sm:text-thanks">
          Jo would have loved {several ? "these" : "this"}.
        </h1>
        <p className="max-w-[30em] text-lead">
          Thank you. Your {several ? `${memories.length} memories are` : "memory is"} on {several ? "their" : "its"} way to Richard, Rob and Tracy. We read every single one, usually more than once.
        </p>
        <p className="max-w-[30em] text-body">
          On November 10th, after we have some stories, photos and videos collected, we&apos;ll be sharing them with everyone and will email an update to all who
          have contributed.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <PrimaryButton onClick={onAnother}>Tell another one</PrimaryButton>
          <a href={mailto} onClick={share} className={secondaryButtonClass}>
            Send this page to someone who knew Jo
          </a>
        </div>
        <div className="flex w-full max-w-[36em] flex-col gap-3 text-left text-body">
          <p>{several ? "Your private links to see, correct or add to each memory:" : "Your private link to see, correct or add to this memory:"}</p>
          <ul className="flex flex-col gap-3">
            {memories.map((memory) => (
              <li key={memory.position} className="flex flex-col gap-1 rounded-card border-[3px] border-wood-light bg-paper p-4">
                {several && <span className="font-bold">{memory.label}</span>}
                <a className={`${linkClass} break-all`} href={memory.claimLink}>
                  {memory.claimLink}
                </a>
              </li>
            ))}
          </ul>
          {failed.length > 0 && (
            <p role="status">
              {failed.length === 1 ? `One file didn't make it: ${failed[0]}.` : `${failed.length} files didn't make it: ${failed.join(", ")}.`} Your words and the other files
              are safe. Open {several ? "that memory's" : "the"} link to add {failed.length === 1 ? "it" : "them"} again.
            </p>
          )}
          {emailed ? (
            <p>We have also emailed you {several ? "these links" : "this link"}.</p>
          ) : (
            <p>
              {hasEmail ? "We couldn't email you just now, so this" : "This"} page is the only copy of {several ? "these links" : "this link"}, so keep it open or save
              {several ? " them" : " it"}.
            </p>
          )}
          <p className="text-small text-walnut-soft">Keep {several ? "these links" : "this link"} private: anyone who has {several ? "one" : "it"} can edit that memory.</p>
          <p className="wide:hidden text-small text-walnut-soft">
            Have another? Tap &quot;Tell another one&quot;. On a computer, jowray.com/share lets you send several at once.
          </p>
        </div>
        <p className="font-display text-body italic text-walnut-soft">Spelling, as promised, did not count.</p>
      </div>
    </section>
  );
}
