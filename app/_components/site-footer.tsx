import Link from "next/link";

import { FAMILY_CONTACT_EMAIL } from "@/lib/contact";

import { ROB_URL, TRACY_URL } from "./external-links";
import { footerLinkClass, linkClass, quietLinkClass } from "./field-classes";
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
      {/* <div>s, not a <p>: the Privacy note's <dialog> and its headings and paragraphs are flow content, which a
          <p> cannot contain (React reports that nesting as a hydration error). A wrapping flex row in which each dot
          belongs to the link after it, so wherever the row breaks a dot never ends a line and every link keeps its
          separator. The closed dialog is display:none and the open one sits in the top layer, so neither takes a
          place in the row. */}
      <div className="flex flex-wrap items-center justify-center gap-x-2 text-[18px] text-walnut-soft">
        <Link href="/obituary" className={footerLinkClass}>
          Jo&apos;s obituary
        </Link>
        <div className="flex items-center gap-x-2">
          <span aria-hidden="true">·</span>
          <Link href="/how-it-was-built" className={footerLinkClass}>
            How this site was built
          </Link>
        </div>
        <div className="flex items-center gap-x-2">
          <span aria-hidden="true">·</span>
          <PrivacyNote />
        </div>
      </div>
    </footer>
  );
}
