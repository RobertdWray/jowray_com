export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "0:00";
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
