import { isAllowedMime } from "@/lib/media-types";
import type { Playable } from "@/lib/memories/types";

/**
 * Which originals may be streamed to a public visitor as they are. Shared by
 * `features/media/serve-media.ts` (the gate on `/api/public-media`) and
 * `features/memories/public.ts` (what the pages offer), so the page never
 * offers a file the route would refuse.
 *
 * - Videos and recordings of every accepted type play as they were recorded,
 *   including any location a phone saved in the file. Rob, 2026-11-08, after
 *   a search found no open-source tool that hides it at serve time without a
 *   second copy or a processing step: "If that isn't available, we'll just
 *   publish the videos with GPS locations." This amends the see-memories
 *   plan's D16 location gate and closes its follow-up F1 (stripped copies).
 * - Photos never stream their original: only the server-made copies, which
 *   carry no metadata.
 */
export function originalPlayablePublicly(mimeType: string): boolean {
  return isAllowedMime(mimeType) && !mimeType.startsWith("image/");
}

/** What the public pages may offer for one file: a photo needs its server-made copy; anything else follows `originalPlayablePublicly`. */
export function publicPlayability({ mimeType, webCopyReady }: { mimeType: string; webCopyReady: boolean }): Playable {
  if (mimeType.startsWith("image/")) {
    return webCopyReady ? "yes" : "waiting";
  }
  return originalPlayablePublicly(mimeType) ? "yes" : "waiting";
}
