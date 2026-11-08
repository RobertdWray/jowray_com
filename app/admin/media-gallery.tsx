import Image from "next/image";

import type { AdminMediaView } from "@/features/admin/get-memory";
import { formatDuration } from "@/lib/format-duration";

import { linkClass } from "../_components/field-classes";

const cardClass = "flex min-w-0 flex-col gap-2 rounded-card border-[3px] border-wood-light bg-paper p-3";

function kindOf(mimeType: string): "photo" | "recording" | "video" | "file" {
  if (mimeType.startsWith("image/")) {
    return "photo";
  }
  if (mimeType.startsWith("audio/")) {
    return "recording";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  return "file";
}

function Words({ item }: { item: AdminMediaView }) {
  const bits = [item.caption, item.approxDateText, item.place].filter((v): v is string => typeof v === "string" && v.length > 0);
  if (bits.length === 0) {
    return null;
  }
  return <p className="min-w-0 whitespace-pre-wrap break-words text-small text-walnut-soft">{bits.join(" · ")}</p>;
}

/**
 * View-only media (D4): thumbnails open the web copy, recordings and videos
 * play inline (a video over its poster once one is READY), and every state
 * that is not "ready" is labelled. Files are
 * served by /admin/media/[id] (cookie-gated) and never optimised: private
 * bytes must not pass through the image optimiser's cache.
 */
export function MediaGallery({ media }: { media: AdminMediaView[] }) {
  if (media.length === 0) {
    return <p className="text-body text-walnut-soft">No files.</p>;
  }
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
      {media.map((item) => {
        const kind = kindOf(item.mimeType);
        const src = `/admin/media/${item.id}`;
        const name = item.originalFilename ?? (kind === "photo" ? "photo" : kind === "recording" ? "recording" : "file");
        let body: React.ReactNode;
        if (item.purged) {
          body = <p className="text-small text-jo-red-deep">File removed after 30 days.</p>;
        } else if (item.status === "PENDING") {
          body = <p className="text-small text-walnut-soft">Not received yet.</p>;
        } else if (item.status === "FAILED") {
          body = <p className="text-small text-jo-red-deep">Could not be received.</p>;
        } else if (kind === "photo") {
          body = item.webReady ? (
            <a href={`${src}?v=web`} target="_blank" rel="noopener" className="relative block aspect-square overflow-hidden rounded">
              <Image src={`${src}?v=${item.thumbReady ? "thumb" : "web"}`} alt={name} unoptimized fill sizes="240px" className="object-cover" />
            </a>
          ) : (
            <p className="text-small text-walnut-soft">Preparing the photo…</p>
          );
        } else if (kind === "recording") {
          body = <audio controls preload="none" src={src} className="w-full" />;
        } else if (kind === "video") {
          // `preload="none"` loads no frame before play, so a READY POSTER stands in through `poster` ([C26]); `?v=thumb`
          // answers a video with its POSTER image or a 404, never the video (D7).
          body = <video controls preload="none" poster={item.posterReady ? `${src}?v=thumb` : undefined} src={src} className="max-w-full rounded" />;
        } else {
          body = (
            <a href={`${src}?download=1`} className={linkClass}>
              Download {name}
            </a>
          );
        }
        return (
          <li key={item.id} className={cardClass}>
            {body}
            <p className="min-w-0 break-words text-small">
              {name}
              {item.durationSeconds !== null && <span className="text-walnut-soft"> · {formatDuration(item.durationSeconds * 1000)}</span>}
            </p>
            <Words item={item} />
          </li>
        );
      })}
    </ul>
  );
}
