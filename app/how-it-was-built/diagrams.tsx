import type { ReactNode } from "react";

// The plain-language diagrams on /how-it-was-built are real text in lists, not SVG or Mermaid: a scaled SVG would
// shrink its labels under the 17px floor on a phone (design/DESIGN.md §4). Lists reflow at any width and screen
// readers announce them as lists, so these stay the accessible summary for everyone. Plan:
// docs/plans/2026-11-06-why-and-how-built.md §5c. README.md's Mermaid diagrams appear further down, for technical
// readers, as unscaled static SVG in sideways-scrolling regions (detailed-diagrams.tsx, ruling R9).
//
// `role="list"` is explicit because Safari/VoiceOver drops list semantics once the markers are styled away.
// Number badges and the stitched connectors are aria-hidden: the list already says "1 of 5", and the lines are
// decoration.

export interface DiagramItem {
  title: string;
  body: ReactNode;
}

const figcaptionClass = "max-w-[40em] text-body text-walnut-soft";
const threadClass = "border-l-[3px] border-dashed border-periwinkle";

/** A numbered vertical timeline: red badges joined by a dashed "stitched thread", one card per step. */
export function StitchedSteps({
  label,
  steps,
  caption,
}: {
  label: string;
  steps: readonly DiagramItem[];
  caption?: ReactNode;
}) {
  return (
    <figure className="flex max-w-[760px] flex-col gap-5">
      <ol role="list" aria-label={label} className="flex list-none flex-col p-0">
        {steps.map((step, index) => (
          <li key={step.title} className="relative flex gap-4 pb-6 last:pb-0">
            {index < steps.length - 1 ? (
              <span aria-hidden="true" className={`absolute bottom-0 left-[22px] top-12 ${threadClass}`} />
            ) : null}
            <span
              aria-hidden="true"
              className="relative flex size-12 shrink-0 items-center justify-center rounded-full bg-jo-red font-display text-[24px] font-bold text-white shadow-pill"
            >
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-card border-[3px] border-wood-light bg-paper px-5 py-4 shadow-card">
              <h3 className="font-display text-[24px] font-bold leading-[1.2]">{step.title}</h3>
              <p className="text-body leading-[1.5]">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      {caption ? <figcaption className={figcaptionClass}>{caption}</figcaption> : null}
    </figure>
  );
}

/** Tiers stacked top to bottom with dashed connectors; the last tier is a row of service cards. */
export function StackDiagram({
  label,
  tiers,
  services,
  servicesLabel,
  caption,
}: {
  label: string;
  tiers: readonly DiagramItem[];
  services: readonly DiagramItem[];
  servicesLabel: string;
  caption?: ReactNode;
}) {
  return (
    <figure className="flex flex-col gap-5">
      <ul role="list" aria-label={label} className="flex list-none flex-col items-center p-0">
        {tiers.map((tier, index) => (
          <li key={tier.title} className="flex w-full flex-col items-center">
            <div
              className={`flex w-full max-w-[760px] flex-col gap-1 rounded-card px-5 py-4 ${
                index === tiers.length - 1
                  ? "bg-lake-green text-paper shadow-card"
                  : "border-[3px] border-wood-light bg-paper shadow-card"
              }`}
            >
              <h3 className="font-display text-[24px] font-bold leading-[1.2]">{tier.title}</h3>
              <p className="text-body leading-[1.5]">{tier.body}</p>
            </div>
            <span aria-hidden="true" className={`h-8 ${threadClass}`} />
          </li>
        ))}
        <li className="w-full">
          <ul
            role="list"
            aria-label={servicesLabel}
            className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4"
          >
            {services.map((service) => (
              <li
                key={service.title}
                className="flex min-w-0 flex-col gap-1 rounded-card border-[3px] border-dashed border-periwinkle bg-paper px-5 py-4"
              >
                <h3 className="font-display text-[24px] font-bold leading-[1.2]">{service.title}</h3>
                <p className="text-body leading-[1.5]">{service.body}</p>
              </li>
            ))}
          </ul>
        </li>
      </ul>
      {caption ? <figcaption className={figcaptionClass}>{caption}</figcaption> : null}
    </figure>
  );
}
