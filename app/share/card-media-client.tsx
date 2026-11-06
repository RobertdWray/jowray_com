"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { formatDuration } from "@/lib/format-duration";
import { ACCEPT_ATTRIBUTE, isRenderableIn } from "@/lib/media-types";
import { acceptFiles, type CardMediaItem, type MemoryCard, type Refusal } from "@/lib/memory-cards";

import { SecondaryButton, TertiaryButton } from "../_components/buttons";
import { errorClass, helperClass } from "../_components/field-classes";
import { RecorderPanel } from "./recorder-panel-client";
import type { UseRecorder } from "./use-recorder";

const KIND_TITLE = { PHOTO: "Photo", VIDEO: "Video", VOICE: "Voice recording" } as const;

function formatBytes(size: number): string {
  if (size >= 1024 * 1024) {
    return `${Math.round(size / (1024 * 1024))} MB`;
  }
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

/**
 * Object URLs for the rows' previews: made when a row appears, revoked when it
 * goes, on reset and on unmount (C42), so ten previews never pin their files
 * in memory on an older phone.
 */
function useObjectUrls(media: CardMediaItem[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const current = urlsRef.current;
    let changed = false;
    for (const item of media) {
      if (!current.has(item.id)) {
        current.set(item.id, URL.createObjectURL(item.file));
        changed = true;
      }
    }
    for (const [id, url] of current) {
      if (!media.some((item) => item.id === id)) {
        URL.revokeObjectURL(url);
        current.delete(id);
        changed = true;
      }
    }
    if (changed) {
      setUrls(Object.fromEntries(current));
    }
  }, [media]);
  useEffect(
    () => () => {
      for (const url of urlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      urlsRef.current.clear();
    },
    [],
  );
  return urls;
}

function Preview({ item, url, userAgent }: { item: CardMediaItem; url: string | undefined; userAgent: string | null }) {
  if (!url) {
    return null;
  }
  if (item.kind === "PHOTO") {
    if (!isRenderableIn(item.mimeType, userAgent)) {
      return <p className="text-small text-walnut-soft">We can&apos;t show it here, but the family will see it fine.</p>;
    }
    // A local object URL: never the image optimizer, nothing leaves the device.
    return <Image src={url} alt="" unoptimized width={0} height={0} sizes="100vw" className="h-auto max-h-[220px] w-auto max-w-full rounded" />;
  }
  if (item.kind === "VIDEO") {
    return <video controls playsInline preload="metadata" src={url} className="max-h-[220px] w-auto max-w-full rounded" />;
  }
  return <audio controls src={url} className="w-full min-w-0" />;
}

export interface CardMediaRecording {
  rec: UseRecorder;
  canRecord: boolean;
  /** This card is the one recording (or showing the recorder's error help). */
  isHere: boolean;
  /** Another card is recording: every capture control waits for it. */
  elsewhere: string | null;
  start: () => void;
}

export function CardMedia({
  card,
  heading,
  isFirst,
  disabled,
  recording,
  progress,
  onAdd,
  onRemove,
  onBeforeCamera,
}: {
  card: MemoryCard;
  heading: string;
  isFirst: boolean;
  /** Sending, or any recording on the page. */
  disabled: boolean;
  recording: CardMediaRecording;
  /** Per-row upload progress while sending, 0–100. */
  progress: Record<string, number>;
  onAdd: (items: CardMediaItem[]) => void;
  onRemove: (mediaId: string) => void;
  /** The last reliable moment to save the draft before a picker or the camera app takes the browser away (C45). */
  onBeforeCamera: () => void;
}) {
  const urls = useObjectUrls(card.media);
  const [refused, setRefused] = useState<Refusal[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const userAgent = typeof navigator === "undefined" ? null : navigator.userAgent;
  const idBase = `${card.id}-media`;

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const files = input.files ? [...input.files] : [];
    input.value = "";
    if (files.length === 0) {
      return;
    }
    const outcome = acceptFiles(card, files, () => `${card.id}-${crypto.randomUUID()}`);
    setRefused(outcome.refused);
    if (outcome.accepted.length > 0) {
      onAdd(outcome.accepted);
    }
  }

  /** Any picker can take the browser away on a phone (the camera app most of all), so the draft is saved first (C45). */
  function openPicker(input: HTMLInputElement | null) {
    onBeforeCamera();
    input?.click();
  }

  // Every capture control on the page waits while any card is recording (here or elsewhere).
  const captureDisabled = disabled || recording.isHere || recording.elsewhere !== null;

  return (
    <div id={isFirst ? "record" : undefined} className="flex flex-col gap-3">
      <p className="text-label font-bold" id={`${idBase}-label`}>
        Add a photo, video or voice recording
      </p>

      {card.media.length > 0 && (
        <ul aria-labelledby={`${idBase}-label`} className="flex flex-col gap-3">
          {card.media.map((item, index) => {
            const pct = progress[item.id];
            const rowLabel = `${KIND_TITLE[item.kind]} ${index + 1}, ${heading}`;
            return (
              <li key={item.id} className="flex flex-col gap-2 rounded-card border-[3px] border-wood-light bg-paper p-3">
                <Preview item={item} url={urls[item.id]} userAgent={userAgent} />
                <p className="text-small text-walnut-soft">
                  <span>{KIND_TITLE[item.kind]}</span> · <span>{item.source === "recording" ? `Recorded ${formatDuration((item.durationSeconds ?? 0) * 1000)}` : item.name}</span> ·{" "}
                  <span>{formatBytes(item.size)}</span>
                </p>
                {item.verdict === "suspectedSilent" && (
                  <p role="status" className={errorClass}>This recording sounds silent. Play it back before you send it.</p>
                )}
                {item.verdict === "unchecked" && (
                  <p role="status" className="text-small text-walnut">We couldn&apos;t check this recording — play it back before you send it.</p>
                )}
                {pct !== undefined && (
                  <label className="flex flex-col gap-1 text-small text-walnut-soft">
                    <span>{rowLabel}</span>
                    <progress value={pct} max={100} className="h-3 w-full" />
                  </label>
                )}
                {pct === undefined &&
                  (item.source === "recording" && confirmingId === item.id ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-body">Remove this recording?</span>
                      <TertiaryButton onClick={() => { setConfirmingId(null); onRemove(item.id); }} disabled={disabled}>Yes, remove it</TertiaryButton>
                      <SecondaryButton onClick={() => setConfirmingId(null)} disabled={disabled}>Keep it</SecondaryButton>
                    </div>
                  ) : (
                    <div>
                      <SecondaryButton
                        onClick={() => (item.source === "recording" ? setConfirmingId(item.id) : onRemove(item.id))}
                        disabled={disabled}
                        aria-label={`Remove ${rowLabel}`}
                      >
                        {item.source === "recording" ? "Remove this recording" : "Remove"}
                      </SecondaryButton>
                    </div>
                  ))}
              </li>
            );
          })}
        </ul>
      )}

      {recording.isHere ? (
        <RecorderPanel rec={recording.rec} canRecord={recording.canRecord} disabled={disabled && !recording.isHere} heading={heading} />
      ) : (
        <div className="flex flex-col gap-[10px] rounded-2xl border-[3px] border-dashed border-periwinkle bg-paper px-[22px] py-5">
          <span className="font-display text-lead font-bold">Rather say it than type it?</span>
          {recording.canRecord ? (
            <>
              <TertiaryButton onClick={recording.start} disabled={disabled || recording.elsewhere !== null}>
                Record your voice<span className="sr-only"> for {heading}</span>
              </TertiaryButton>
              {recording.elsewhere !== null && <span className={`text-small ${helperClass}`}>Finish the recording in {recording.elsewhere} first.</span>}
            </>
          ) : (
            <span className="text-small text-walnut-soft">Recording isn&apos;t available in this browser. You can add a voice memo as a file instead.</span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <input ref={cameraRef} type="file" accept="video/*" capture="user" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onPick} disabled={captureDisabled} />
        <input ref={pickerRef} type="file" accept={ACCEPT_ATTRIBUTE} multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onPick} disabled={captureDisabled} />
        <input ref={uploadRef} type="file" accept={ACCEPT_ATTRIBUTE} multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onPick} disabled={captureDisabled} />
        <SecondaryButton onClick={() => openPicker(cameraRef.current)} disabled={captureDisabled} className="wide:hidden">
          Record a video
        </SecondaryButton>
        <SecondaryButton onClick={() => openPicker(pickerRef.current)} disabled={captureDisabled} className="wide:hidden">
          Add photos or videos
        </SecondaryButton>
        <SecondaryButton onClick={() => openPicker(uploadRef.current)} disabled={captureDisabled} className="narrow:hidden">
          Upload photos, videos or recordings
        </SecondaryButton>
      </div>
      {(recording.isHere || recording.elsewhere !== null) && (
        <span className={`text-small ${helperClass}`}>Finish the recording in {recording.isHere ? heading : recording.elsewhere} first.</span>
      )}

      {refused.length > 0 && (
        <p role="status" className={errorClass}>
          {refused.map((r) => r.message).join(" ")}
        </p>
      )}
    </div>
  );
}
