import Link from "next/link";

import { PrimaryLink } from "../../_components/buttons";
import { StitchedHeart } from "../../_components/hearts";

import { bandClass, innerClass, linkButtonClass } from "./chips";
import { shareHref } from "./hrefs";

/** No memory matches the chosen filters. */
export function EmptyState({ children }: { children?: React.ReactNode }) {
  return (
    <p className="max-w-[40em] rounded-card border-[3px] border-dashed border-periwinkle bg-muslin p-5 text-label sm:p-7 sm:text-lead">
      {children ?? (
        <>
          Nothing here yet for that mix. Try one filter fewer, or{" "}
          <Link href={shareHref} className="text-jo-red-deep underline hover:text-walnut">
            be the first to tell that Jo story
          </Link>
          .
        </>
      )}
    </p>
  );
}

/** "Show 12 more of 57": the same page with more cards; keeps the reader's place. */
export function LoadMore({ href, more, total }: { href: string; more: number; total: number }) {
  return (
    <div className="flex justify-center">
      <Link href={href} scroll={false} prefetch={false} className={`${linkButtonClass} min-h-tap-lg w-full px-8 text-body sm:w-auto`}>
        Show {more} more of {total}
      </Link>
    </div>
  );
}

/** The lake-green band that asks for one more memory. */
export function ShareBand() {
  return (
    <section aria-labelledby="share-band-h" className={`${bandClass} bg-lake-green py-8 text-paper sm:py-16`}>
      <div className={`${innerClass} flex flex-wrap items-center justify-between gap-x-12 gap-y-6`}>
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-[10px]">
          <h2 id="share-band-h" className="font-display text-h2-sm font-bold sm:text-h2">
            Did one of these remind you of your own?
          </h2>
          <p className="text-body leading-[1.6]">Three sentences count. A photo from a shoebox counts. Spelling doesn&rsquo;t count.</p>
        </div>
        <Link
          href={shareHref}
          className="inline-flex min-h-tap-lg w-full items-center justify-center gap-3 rounded-button border-[3px] border-dashed border-[#e7f0e3] px-7 text-body font-bold text-paper no-underline hover:text-paper sm:w-auto"
        >
          <StitchedHeart size={26} color="#fffdf8" />
          Leave a memory of Jo
        </Link>
      </div>
    </section>
  );
}

/** What every See memories page shows while the launch flag is off (plan D15). */
export function OpeningSoon() {
  return (
    <section className={`${bandClass} pb-16`}>
      <div className={`${innerClass} flex flex-col items-start gap-5`}>
        <p className="max-w-[36em] rounded-card border-[3px] border-dashed border-periwinkle bg-paper p-6 text-lead">
          Jo&rsquo;s family is reading every memory first. See memories opens November 10.
        </p>
        <PrimaryLink href={shareHref}>
          <StitchedHeart size={26} color="#fff" />
          Leave a memory of Jo
        </PrimaryLink>
      </div>
    </section>
  );
}
