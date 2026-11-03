export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "0:00";
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Seconds to store for a recording: at least 1 for any real clip, so a 400 ms clip never rounds to 0; undefined when ms is not a finite positive number. */
export function durationSecondsFor(ms: number): number | undefined {
  return Number.isFinite(ms) && ms > 0 ? Math.max(1, Math.round(ms / 1000)) : undefined;
}
