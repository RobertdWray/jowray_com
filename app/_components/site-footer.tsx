import { linkClass } from "./field-classes";
import { StitchedHeart } from "./hearts";

export function SiteFooter() {
  return (
    <footer className="flex flex-col items-center gap-[14px] px-[max(16px,5%)] pb-12 pt-10 text-center">
      <StitchedHeart size={40} />
      <p className="font-display text-lead">Made with love by Richard, Rob, Tracy and Ava.</p>
      <p className="text-[18px] text-walnut-soft">
        Questions, or a memory that won&apos;t fit in a box? Email{" "}
        <a href="mailto:robwray@gmail.com" className={linkClass}>
          robwray@gmail.com
        </a>
        .
      </p>
    </footer>
  );
}
