"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { ClaimMediaView } from "@/features/memories/claim";
import { formatDuration } from "@/lib/format-duration";
import { ACCEPT_ATTRIBUTE, isRenderableIn } from "@/lib/media-types";
import { uploadWithTicket } from "@/lib/upload-client";

import { SecondaryButton, TertiaryButton } from "../../_components/buttons";
import { fileInputClass, labelClass, linkClass } from "../../_components/field-classes";
import { cancelReservation, finalizeAddedFile, removeFile, replaceFileTicket } from "./actions";

const cardClass = "flex flex-col gap-3 rounded-card border-[3px] border-wood-light bg-paper p-3";

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

/**
 * One card per live file on the claim page: the picture or player, Remove
 * (two-step, inline: the design has no modals), Replace, and for files that
 * never arrived a "not received" note with Cancel. Pending replacements are
 * shown on their target's card. Every change refreshes the server-rendered page.
 */
export function MediaList({ claimToken, media, userAgent }: { claimToken: string; media: ClaimMediaView[]; userAgent: string | null }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // While a photo's sanitized copy is still being made (seconds, normally), re-read the page a few times.
  // The set of photos still waiting for their copy; a new photo restarts the poll, an unchanged set does not.
  const waitingKey = media
    .filter((item) => item.status === "READY" && kindOf(item.mimeType) === "photo" && (item.web.status === "pending" || item.web.status === "none"))
    .map((item) => item.id)
    .join(",");
  const [exhaustedFor, setExhaustedFor] = useState<string | null>(null);
  useEffect(() => {
    if (waitingKey === "") {
      return;
    }
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      router.refresh();
      if (ticks >= 10) {
        clearInterval(timer);
        // State changes only from the timer, never synchronously in the effect body.
        setExhaustedFor(waitingKey);
      }
    }, 3_000);
    return () => clearInterval(timer);
  }, [waitingKey, router]);
  const stillPreparing = waitingKey !== "" && exhaustedFor === waitingKey;

  const replacements = new Map<string, ClaimMediaView>();
  for (const item of media) {
    if (item.replacesMediaId) {
      replacements.set(item.replacesMediaId, item);
    }
  }
  const files = media.filter((item) => item.replacesMediaId === null);

  async function run(mediaId: string, work: () => Promise<string>) {
    setBusyId(mediaId);
    try {
      setMessage(await work());
    } catch {
      setMessage("We could not reach the server. Please check your connection and try again.");
    } finally {
      setBusyId(null);
      setConfirmingId(null);
      // Always re-read the server's view: a failed step may still have changed a row.
      router.refresh();
    }
  }

  function onRemove(item: ClaimMediaView) {
    return run(item.id, async () => {
      const result = await removeFile({ claimToken, mediaId: item.id });
      if (result.ok) {
        return "Removed.";
      }
      if (result.code === "last_file") {
        return "This is the only file in this memory. Add a few words or another file first, or replace it.";
      }
      return "That file could not be removed. Please reload the page and try again.";
    });
  }

  function onCancel(item: ClaimMediaView) {
    return run(item.id, async () => {
      const result = await cancelReservation({ claimToken, mediaId: item.id });
      return result.ok ? "Cancelled." : "That could not be cancelled. Please reload the page and try again.";
    });
  }

  function onReplace(item: ClaimMediaView, event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    return run(item.id, async () => {
      try {
        const ticketed = await replaceFileTicket({ claimToken, mediaId: item.id, file: { name: file.name, type: file.type, size: file.size } });
        if (!ticketed.ok) {
          if (ticketed.code === "replacement_pending") {
            return "A replacement for this file is already on its way.";
          }
          if (ticketed.code === "unsupported_type") {
            return "That kind of file is not supported.";
          }
          if (ticketed.code === "too_large") {
            return "That file is too large.";
          }
          return "That file cannot be used as a replacement right now.";
        }
        setMessage("Uploading the replacement…");
        try {
          await uploadWithTicket(ticketed.upload, file);
        } catch {
          // The reservation exists on the server; free it so the next try is not refused as "already on its way".
          await cancelReservation({ claimToken, mediaId: ticketed.upload.ticket.mediaId }).catch(() => undefined);
          return "The upload did not finish; nothing was changed. Please try again.";
        }
        const finalized = await finalizeAddedFile({ ticket: ticketed.upload.ticket, claimToken });
        if (finalized.status === "READY") {
          return "Replaced.";
        }
        if (finalized.status === "PENDING") {
          return "The replacement is still being checked; it will take the original's place shortly.";
        }
        return "The replacement could not be accepted; the original is still here.";
      } finally {
        input.value = "";
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {files.map((item) => {
        const kind = kindOf(item.mimeType);
        const busy = busyId !== null;
        const pending = replacements.get(item.id);
        if (item.status !== "READY") {
          return (
            <div key={item.id} className={cardClass}>
              <p className="text-body">
                {item.status === "PENDING"
                  ? `${item.originalFilename ?? "This file"} has not been received yet.`
                  : `${item.originalFilename ?? "This file"} could not be received (wrong type or too large).`}
              </p>
              <div className="flex flex-wrap gap-3">
                <SecondaryButton onClick={() => onCancel(item)} disabled={busy}>
                  {item.status === "PENDING" ? "Cancel this upload" : "Clear it"}
                </SecondaryButton>
              </div>
            </div>
          );
        }
        const src = `/api/media/${item.id}?t=${encodeURIComponent(claimToken)}`;
        const download = `${src}&download=1`;
        return (
          <div key={item.id} className={cardClass}>
            {kind === "photo" && item.web.status !== "ready" ? (
              item.web.status === "failed" ? (
                <p className="text-body">
                  We could not prepare this photo for the page.{" "}
                  <a className={linkClass} href={download}>Download {item.originalFilename ?? "the original"}</a>
                </p>
              ) : (
                <p className="text-body text-walnut-soft" role="status">
                  {stillPreparing ? "Still preparing your photo; reload this page in a minute." : "Preparing your photo…"}{" "}
                  <a className={linkClass} href={download}>Download the original</a>
                </p>
              )
            ) : kind === "photo" && !isRenderableIn(item.web.mimeType ?? item.mimeType, userAgent) ? (
              <p>
                <a className={linkClass} href={download}>Download {item.originalFilename ?? "file"}</a> (this browser cannot display {item.web.mimeType ?? item.mimeType})
              </p>
            ) : kind === "photo" ? (
              // Private, token-gated media must not go through the image optimizer (it would cache the bytes).
              <Image src={src} alt={item.originalFilename ?? "photo"} unoptimized width={0} height={0} sizes="100vw" className="h-auto w-full max-w-full rounded" />
            ) : kind === "recording" ? (
              <>
                <audio controls src={src} className="w-full" />
                {item.durationSeconds !== null && <p className="text-small text-walnut-soft">{formatDuration(item.durationSeconds * 1000)}</p>}
              </>
            ) : (
              <video controls src={src} className="max-w-full rounded" />
            )}
            {pending && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-body text-walnut-soft">A replacement ({pending.originalFilename ?? "new file"}) has not been received yet.</p>
                <SecondaryButton onClick={() => onCancel(pending)} disabled={busy}>Cancel it</SecondaryButton>
              </div>
            )}
            {confirmingId === item.id ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-body">Remove this {kind}?</span>
                <TertiaryButton onClick={() => onRemove(item)} disabled={busy}>Yes, remove it</TertiaryButton>
                <SecondaryButton onClick={() => setConfirmingId(null)} disabled={busy}>Keep it</SecondaryButton>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <SecondaryButton onClick={() => setConfirmingId(item.id)} disabled={busy}>Remove</SecondaryButton>
                <label className={`${labelClass} flex-1 basis-[240px]`}>
                  <span>Replace with another file</span>
                  <input type="file" accept={ACCEPT_ATTRIBUTE} onChange={(event) => onReplace(item, event)} disabled={busy || pending?.status === "PENDING"} className={fileInputClass} />
                </label>
              </div>
            )}
          </div>
        );
      })}
      {message && <p role="status" className="text-body">{message}</p>}
    </div>
  );
}
