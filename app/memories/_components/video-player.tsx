import { durationText } from "@/lib/memories/format";
import type { PublicMediaItem } from "@/lib/memories/types";

import { publicMediaHref } from "./hrefs";
import { PlayBadge } from "./memory-card";

/**
 * A playable public video on the memory page, in a native player (plan D6 as amended, C34): `preload="none"`, so
 * nothing is requested, or counted against the public allowance, until the visitor presses play. The caption's
 * duration comes from the database, not the element.
 */
export function VideoPlayer({ item }: { item: PublicMediaItem }) {
  return (
    <figure className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-[16px] border-[3px] border-dashed border-wood bg-wood-light p-2">
        <video controls preload="none" playsInline className="aspect-video w-full rounded-[10px] bg-walnut">
          {/* No `type`: with one source the hint can only make a browser skip a file it could play by sniffing (Chrome skips `video/quicktime`, plan C50). */}
          <source src={publicMediaHref(item.id, "web")} />
        </video>
      </div>
      <figcaption className="flex items-center gap-2 text-small text-walnut-soft">
        <PlayBadge size={24} />
        {[item.caption, durationText(item.durationSeconds)].filter(Boolean).join(" · ") || "Nothing plays until you press it."}
      </figcaption>
    </figure>
  );
}
