import Link from "next/link";

import { pillOffClass, pillOnClass } from "./chips";
import { PUBLIC_PATHS } from "./hrefs";

export type ViewName = "explore" | "map" | "timeline" | "tags";

const VIEWS: ReadonlyArray<{ name: ViewName; label: string; short: string }> = [
  { name: "explore", label: "Everything", short: "Everything" },
  { name: "map", label: "By place", short: "By place" },
  { name: "timeline", label: "By year", short: "By year" },
  { name: "tags", label: "By what she loved", short: "What she loved" },
];

function ViewIcon({ name }: { name: ViewName }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "explore") {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    );
  }
  if (name === "map") {
    return (
      <svg {...common}>
        <path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" />
        <circle cx="12" cy="11" r="2.2" />
      </svg>
    );
  }
  if (name === "timeline") {
    return (
      <svg {...common}>
        <path d="M3 12h18" />
        <circle cx="7" cy="12" r="2.2" />
        <circle cx="17" cy="12" r="2.2" />
        <path d="M7 9.8V5M17 14.2V19" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M3 11V4h7l10 10-7 7L3 11z" />
      <circle cx="7.5" cy="8.5" r="1.4" />
    </svg>
  );
}

/**
 * The four view pills (plan D5, C5, C31): links with the default prefetch, the current one marked
 * `aria-current="page"`. A horizontally scrolling row on phones; wraps from `sm`.
 */
export function ViewNav({ current, icons = false }: { current: ViewName; icons?: boolean }) {
  return (
    <nav aria-label="View" className="-mx-[max(16px,5%)] overflow-x-auto px-[max(16px,5%)] pb-2 scrollbar-none sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0">
      <ul className="flex gap-2 sm:flex-wrap sm:gap-[10px]">
        {VIEWS.map((view) => {
          const active = view.name === current;
          return (
            <li key={view.name} className="flex-none">
              <Link href={PUBLIC_PATHS[view.name]} aria-current={active ? "page" : undefined} className={active ? pillOnClass : pillOffClass}>
                {icons && (
                  <span className={active ? "text-white" : "text-jo-red-deep"}>
                    <ViewIcon name={view.name} />
                  </span>
                )}
                <span className="sm:hidden">{view.short}</span>
                <span className="hidden sm:inline">{view.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
