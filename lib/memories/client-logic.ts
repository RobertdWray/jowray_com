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
