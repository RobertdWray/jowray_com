/** Match a navigation destination or one of its child paths; the root matches only itself. */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

/** Decode a fragment and accept only an exact, case-sensitive id from the rendered decades. */
export function decadeFromHash(hash: string, ids: readonly string[]): string | null {
  let id: string;
  try {
    id = decodeURIComponent(hash.startsWith("#") ? hash.slice(1) : hash);
  } catch {
    // A malformed URL fragment cannot identify a rendered decade.
    return null;
  }
  return ids.includes(id) ? id : null;
}

/** Count whole played bars, clamping progress and treating unusable totals or bar counts as empty. */
export function playedBars(currentSeconds: number, totalSeconds: number | null, count: number): number {
  if (
    totalSeconds === null || !Number.isFinite(totalSeconds) || totalSeconds <= 0 ||
    !Number.isFinite(count) || count <= 0 || Number.isNaN(currentSeconds)
  ) {
    return 0;
  }
  return Math.min(count, Math.max(0, Math.floor(count * currentSeconds / totalSeconds)));
}

/** Preserve an active edit; otherwise follow the current URL, including a cleared query. */
export function syncedQuery(focused: boolean, current: string, fromUrl: string | undefined): string {
  return focused ? current : (fromUrl ?? "");
}

/** Wait for a pause in typing before replacing the Explore URL. */
export const SEARCH_DEBOUNCE_MS = 400;

/** One pending task at a time: scheduling replaces the last one, cancelling drops it. */
export interface Debounce {
  schedule(run: () => void): void;
  cancel(): void;
  isPending(): boolean;
}

/**
 * The search box's pending search (TCR round 1, B2-3). A new keystroke replaces the scheduled search; the box cancels
 * it on submit, when new filters arrive, on unmount and on blur, so a press elsewhere (a filter chip, which moves
 * focus before its navigation starts) abandons unsent typing instead of letting a late timer overwrite the chip.
 */
export function createDebounce(delayMs: number): Debounce {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return {
    schedule(run) {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    },
    cancel,
    isPending: () => timer !== null,
  };
}

/**
 * The decade a clicked link jumps to on this page, or null (TCR round 1, B2-4). Pressing a jump link whose fragment is
 * already the current one fires no `hashchange`, so the timeline asks this on every click: a link to the same page
 * (origin and path) whose fragment names a rendered decade opens it.
 */
export function decadeFromLink(href: string, currentUrl: string, ids: readonly string[]): string | null {
  let target: URL;
  let current: URL;
  try {
    target = new URL(href, currentUrl);
    current = new URL(currentUrl);
  } catch {
    return null;
  }
  if (target.origin !== current.origin || target.pathname !== current.pathname || target.hash.length <= 1) {
    return null;
  }
  return decadeFromHash(target.hash, ids);
}
