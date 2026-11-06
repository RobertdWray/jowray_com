import Link from "next/link";

import { FAMILY_CONTACT_EMAIL } from "@/lib/contact";

import { ROB_URL, TRACY_URL } from "./external-links";
import { linkClass, quietLinkClass } from "./field-classes";
import { StitchedHeart } from "./hearts";
import { PrivacyNote } from "./privacy-note-client";

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
        <a href={`mailto:${FAMILY_CONTACT_EMAIL}`} className={linkClass}>
          {FAMILY_CONTACT_EMAIL}
        </a>
        .
      </p>
      {/* A <div>, not a <p>: the Privacy note's <dialog> and its headings and paragraphs are flow content, which a
          <p> cannot contain (React reports that nesting as a hydration error). */}
      <div className="text-[18px] text-walnut-soft">
        <Link href="/obituary" className={linkClass}>
          Jo&apos;s obituary
        </Link>
        <span aria-hidden="true"> · </span>
        <Link href="/how-it-was-built" className={linkClass}>
          How this site was built
        </Link>
        <span aria-hidden="true"> · </span>
        <PrivacyNote />
      </div>
    </footer>
  );
}
