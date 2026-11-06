import Link from "next/link";

import { ROB_URL, TRACY_URL } from "./external-links";
import { linkClass, quietLinkClass } from "./field-classes";
import { StitchedHeart } from "./hearts";

export function SiteFooter() {
  return (
    <footer className="flex flex-col items-center gap-[14px] px-[max(16px,5%)] pb-12 pt-10 text-center">
      <StitchedHeart size={40} />
      <p className="font-display text-lead">
        Made with love by Richard, Kay,{" "}
        <a href={ROB_URL} className={quietLinkClass}>
          Rob
        </a>
        ,{" "}
        <a href={TRACY_URL} className={quietLinkClass}>
          Tracy
        </a>{" "}
        and Ava.
      </p>
      <p className="text-[18px] text-walnut-soft">
        Questions, or a memory that won&apos;t fit in a box? Email{" "}
        <a href="mailto:robwray@gmail.com" className={linkClass}>
          robwray@gmail.com
        </a>
        .
      </p>
      <p className="text-[18px] text-walnut-soft">
        <Link href="/obituary" className={linkClass}>
          Jo&apos;s obituary
        </Link>
        <span aria-hidden="true"> · </span>
        <Link href="/how-it-was-built" className={linkClass}>
          How this site was built
        </Link>
      </p>
    </footer>
  );
}
