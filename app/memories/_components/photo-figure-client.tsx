"use client";

import Image from "next/image";
import { useState } from "react";

import { publicMediaHref } from "./hrefs";

/** A public photo and its optional caption for the memory page's figure. */
export interface FigurePhoto {
  id: string;
  width: number | null;
  height: number | null;
  alt: string;
  caption: string | null;
}

/** Display a selected photo in its patchwork frame, with a thumbnail button for every photo. */
export function PhotoFigure({ photos, pill }: { photos: FigurePhoto[]; pill: string | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = photos.find((photo) => photo.id === selectedId) ?? photos[0];
  if (!selected) {
    return null;
  }

  return (
    <figure className="flex min-w-0 max-w-[600px] flex-[1_1_440px] -rotate-[1.5deg] flex-col items-center">
      <div className="patchwork w-full rounded-[6px] p-4 shadow-photo">
        <div className="flex flex-col gap-3 rounded-[3px] bg-paper px-[14px] pb-[18px] pt-[14px]">
          <Image
            src={publicMediaHref(selected.id, "web")}
            alt={selected.alt}
            width={selected.width ?? 1600}
            height={selected.height ?? 1200}
            unoptimized
            loading="eager"
            className="h-auto w-full rounded-[3px]"
          />
          {selected.caption !== null && (
            <figcaption className="text-center font-display text-body leading-[1.35]">
              {selected.caption}
            </figcaption>
          )}
        </div>
      </div>
      {pill && (
        <p className="relative -top-7 inline-block rotate-[4deg] rounded-full bg-jo-red px-[14px] py-2 text-small font-bold text-paper shadow-pill">
          {pill}
        </p>
      )}
      {photos.length > 1 && (
        <ul aria-label="The other photos" className="-mt-2 flex flex-wrap justify-center gap-3">
          {photos.map((photo, index) => (
            <li key={photo.id}>
              <button
                type="button"
                aria-pressed={selected.id === photo.id}
                aria-label={`Photo ${index + 1} of ${photos.length}`}
                onClick={() => setSelectedId(photo.id)}
                className={`size-24 rounded-[4px] p-[5px] patchwork-sm ${index % 2 === 0 ? "rotate-[2deg]" : "-rotate-[2deg]"}`}
              >
                <span className="relative block size-full overflow-hidden rounded-[2px] bg-paper">
                  <Image src={publicMediaHref(photo.id, "thumb")} unoptimized fill alt="" sizes="86px" className="object-cover" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
