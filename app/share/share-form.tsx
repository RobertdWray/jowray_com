"use client";

import { upload } from "@vercel/blob/client";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { CONTACT_OPT_IN_LABEL, IMPLICIT_CONSENT_NOTE } from "@/lib/consent";
import { formatDuration } from "@/lib/format-duration";
import { ACCEPT_ATTRIBUTE } from "@/lib/media-types";

import { PrimaryButton, SecondaryButton, TertiaryButton, secondaryButtonClass } from "../_components/buttons";
import {
  errorClass,
  fileInputClass,
  helperClass,
  inputClass,
  labelClass,
  linkClass,
  selectClass,
  textareaClass,
} from "../_components/field-classes";
import { SolidHeart } from "../_components/hearts";
import { createMemory, finalizeUpload } from "./actions";
import { AudioRecorder, pickRecordingType, type Recording } from "./recorder";

type Phase =
  | { kind: "idle" }
  | { kind: "saving"; progress?: number }
  | { kind: "done"; claimLink: string; fileStatus: "READY" | "PENDING" | "FAILED" | "none"; emailed: boolean }
  | { kind: "error"; message: string; claimLink?: string };

function subscribeNever(): () => void {
  return () => {};
}

export function ShareForm({ intro }: { intro: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [clip, setClip] = useState<{ recording: Recording; url: string } | null>(null);
  const clipUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Server snapshot is false, client snapshot asks the browser: same markup on
  // both sides at hydration, then the record button appears where supported.
  const canRecord = useSyncExternalStore(subscribeNever, () => pickRecordingType() !== null, () => false);

  function replaceClip(next: { recording: Recording; url: string } | null) {
    if (clipUrlRef.current) {
      URL.revokeObjectURL(clipUrlRef.current);
    }
    clipUrlRef.current = next?.url ?? null;
    setClip(next);
  }

  // Release the microphone and playback URL when the contributor navigates away.
  useEffect(() => () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    if (clipUrlRef.current) {
      URL.revokeObjectURL(clipUrlRef.current);
      clipUrlRef.current = null;
    }
  }, []);

  async function toggleRecording() {
    setRecorderError(null);
    try {
      if (!recorderRef.current) {
        recorderRef.current = new AudioRecorder();
      }
      if (isRecording) {
        const result = await recorderRef.current.stop();
        replaceClip({ recording: result, url: URL.createObjectURL(result.blob) });
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        setIsRecording(false);
      } else {
        if (isStarting) {
          return;
        }
        setIsStarting(true);
        try {
          await recorderRef.current.start();
          replaceClip(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
          setIsRecording(true);
        } finally {
          setIsStarting(false);
        }
      }
    } catch (error) {
      setIsRecording(false);
      setRecorderError(error instanceof Error ? error.message : "Recording failed");
    }
  }

  function resetForm() {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setIsRecording(false);
    setRecorderError(null);
    replaceClip(null);
    setPhase({ kind: "idle" });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const picked = form.get("file");
    const file = clip?.recording.file ?? (picked instanceof File && picked.size > 0 ? picked : null);
    setPhase({ kind: "saving" });

    let created: Awaited<ReturnType<typeof createMemory>>;
    try {
      created = await createMemory({
      name: String(form.get("name") ?? ""),
      relationship: String(form.get("relationship") ?? ""),
      email: String(form.get("email") ?? ""),
      approxDateText: String(form.get("approxDateText") ?? ""),
      place: String(form.get("place") ?? ""),
      note: String(form.get("note") ?? ""),
      visibility: String(form.get("visibility") ?? "FAMILY"),
      contactOptIn: form.get("contactOptIn") === "on",
      file: file ? { name: file.name, type: file.type, size: file.size } : null,
      });
    } catch {
      // Unknown outcome (network, timeout): do not resubmit automatically.
      setPhase({ kind: "error", message: "We could not reach the server. Please check your connection and try again." });
      return;
    }
    if (!created.ok) {
      setPhase({ kind: "error", message: created.message });
      return;
    }

    if (!created.upload || !file) {
      setPhase({ kind: "done", claimLink: `${window.location.origin}/m/${created.claimToken}`, fileStatus: "none", emailed: created.emailed });
      return;
    }

    const claimLink = `${window.location.origin}/m/${created.claimToken}`;
    try {
      const { ticket, pathname } = created.upload;
      await upload(pathname, file, {
        access: "private",
        handleUploadUrl: "/api/upload",
        multipart: true,
        // Required: the SDK sends the type only when it is set here, and the
        // token allows exactly the ticketed type (recordings have no extension type).
        contentType: ticket.mimeType,
        clientPayload: JSON.stringify(ticket),
        onUploadProgress: ({ percentage }) => setPhase({ kind: "saving", progress: percentage }),
      });
      const finalized = await finalizeUpload({ ticket, claimToken: created.claimToken });
      if (finalized.status === "REJECTED") {
        setPhase({ kind: "error", message: "The upload could not be confirmed. Your words were saved; use your link below.", claimLink });
        return;
      }
      setPhase({ kind: "done", claimLink: finalized.claimLink, fileStatus: finalized.status, emailed: finalized.emailed });
    } catch (error) {
      // The memory is already saved; never lose the link over a failed upload.
      setPhase({ kind: "error", message: `${error instanceof Error ? error.message : "Upload failed"}. Your words were saved; use your link below to try the file again.`, claimLink });
    }
  }

  if (phase.kind === "done") {
    const origin = window.location.origin;
    const mailto = `mailto:?subject=${encodeURIComponent("Tell a Jo story")}&body=${encodeURIComponent(`Jo's family is collecting memories of her. If you knew Jo, tell yours here: ${origin}/`)}`;

    function share(event: React.MouseEvent<HTMLAnchorElement>) {
      if (typeof navigator.share === "function") {
        event.preventDefault();
        void navigator.share({
          title: "Tell us a Jo story",
          text: "Jo's family is collecting memories of her.",
          url: `${origin}/`,
        }).catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }
          window.location.assign(mailto);
        });
      }
    }

    return (
      <section className="flex flex-1 flex-col items-center justify-center px-[max(16px,5%)] pb-20 pt-10">
        <div className="flex w-full max-w-[760px] flex-col items-center gap-7 text-center">
          <div className="patchwork rounded-full p-[14px] shadow-[0_12px_26px_rgb(46_36_32/0.18)]">
            <div className="flex size-[150px] items-center justify-center rounded-full bg-paper">
              <SolidHeart size={96} stitchColor="#fffdf8" label="A stitched red heart" />
            </div>
          </div>
          <h1 className="font-display text-display-sm font-extrabold sm:text-thanks">Jo would have loved this.</h1>
          <p className="max-w-[30em] text-lead">
            Thank you. Your memory is on its way to Richard, Rob and Tracy. We read every single one, usually more than once.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <PrimaryButton onClick={resetForm}>Tell another one</PrimaryButton>
            <a href={mailto} onClick={share} className={secondaryButtonClass}>
              Send this page to someone who knew Jo
            </a>
          </div>
          <div className="flex flex-col gap-3 text-body">
            <p>
              Your private link to see, correct or add to this memory:
              <br />
              <a className={`${linkClass} break-all`} href={phase.claimLink}>
                {phase.claimLink}
              </a>
            </p>
            {phase.emailed && <p>We have also emailed you this link.</p>}
            {phase.fileStatus === "PENDING" && <p>Your file is still being checked; it will appear on your page shortly.</p>}
            {phase.fileStatus === "FAILED" && (
              <p>The file could not be accepted (wrong type or too large), but your words were saved.</p>
            )}
            <p className="text-small text-walnut-soft">Keep this link private: anyone who has it can edit this memory.</p>
          </div>
          <p className="font-display text-body italic text-walnut-soft">Spelling, as promised, did not count.</p>
        </div>
      </section>
    );
  }

  const busy = phase.kind === "saving";
  return (
    <section id="form" className="mx-auto flex w-full max-w-[1200px] flex-wrap items-start gap-x-16 gap-y-10 px-[max(16px,5%)] py-[72px]">
      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-[18px]">
        {intro}
        <div id="record" className="flex flex-col gap-[10px] rounded-2xl border-[3px] border-dashed border-periwinkle bg-paper px-[22px] py-5">
          <span className="font-display text-lead font-bold">Rather say it than type it?</span>
          {canRecord ? (
            <>
              <TertiaryButton onClick={toggleRecording} disabled={busy || isStarting}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="flex-none">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
                {isStarting ? "Starting…" : isRecording ? "Stop recording" : clip ? "Record again" : "Start recording"}
              </TertiaryButton>
              {recorderError && (
                <p role="alert" className={errorClass}>{recorderError}</p>
              )}
              {clip && (
                <>
                  <audio controls src={clip.url} className="w-full min-w-0" />
                  <span className="text-small text-walnut-soft">Recorded {formatDuration(clip.recording.durationMs)}</span>
                  <SecondaryButton onClick={() => replaceClip(null)} disabled={busy || isRecording || isStarting}>
                    Remove recording
                  </SecondaryButton>
                </>
              )}
              <span className="text-small text-walnut-soft">Take your time. You can listen back before you send it.</span>
            </>
          ) : (
            <span className="text-small text-walnut-soft">
              Recording isn&apos;t available in this browser. You can attach a voice memo with the file field instead.
            </span>
          )}
        </div>
      </div>
      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="flex min-w-0 flex-[1_1_440px] flex-col gap-[22px] rounded-form border-[3px] border-wood-light bg-paper p-8 shadow-form"
        aria-busy={busy}
      >
        <div className="flex flex-wrap gap-5">
          <label className={`${labelClass} flex-[1_1_200px]`}>
            <span>Your name</span>
            <input name="name" maxLength={120} className={inputClass} autoComplete="name" placeholder="Kay Bartholomew" />
          </label>
          <label className={`${labelClass} flex-[1_1_200px]`}>
            <span>Email <span className={helperClass}>(optional · so we can say thank you and send your private link)</span></span>
            <input name="email" type="email" maxLength={254} className={inputClass} autoComplete="email" placeholder="So we can say thank you" />
          </label>
        </div>
        <label className={labelClass}>
          <span>How you knew Jo</span>
          <input name="relationship" maxLength={120} className={inputClass} placeholder="former student · church friend · neighbor · family" />
        </label>
        <label className={labelClass}>
          <span>When is this memory from? <span className={helperClass}>(roughly is fine)</span></span>
          <input name="approxDateText" maxLength={120} className={inputClass} placeholder="Summer 1985 · Lake George, late 90s · her classroom" />
        </label>
        <label className={labelClass}>
          <span>Where? <span className={helperClass}>(optional)</span></span>
          <input name="place" maxLength={200} className={inputClass} placeholder="her classroom · Lake George · Broadmead" />
        </label>
        <label className={labelClass}>
          <span>Your memory of Jo</span>
          <textarea name="note" rows={7} maxLength={10_000} className={textareaClass} placeholder="She once…" />
        </label>
        <label className={labelClass}>
          <span>Add a photo, video or voice recording <span className={helperClass}>(optional)</span></span>
          <input ref={fileInputRef} name="file" type="file" accept={ACCEPT_ATTRIBUTE} className={fileInputClass} disabled={busy || isRecording || isStarting || clip !== null} />
        </label>
        <label className={labelClass}>
          <span>Who can see this?</span>
          <select name="visibility" defaultValue="FAMILY" className={selectClass}>
            <option value="FAMILY">The family</option>
            <option value="PUBLIC">Everyone who visits the memorial</option>
            <option value="PRIVATE">Only me and the family admins</option>
          </select>
        </label>

        {phase.kind === "error" && (
          <p role="alert" className={errorClass}>
            {phase.message}
            {phase.claimLink && (
              <>
                {" "}
                <a className={`${linkClass} break-all`} href={phase.claimLink}>
                  {phase.claimLink}
                </a>
              </>
            )}
          </p>
        )}
        <PrimaryButton type="submit" disabled={busy || isRecording || isStarting}>
          <SolidHeart size={24} fill="#fff" stitch={false} />
          {busy ? (phase.progress ? `Uploading… ${phase.progress}%` : "Sending…") : "Send this to Jo's family"}
        </PrimaryButton>
        <p className="text-small text-walnut-soft">
          Memories go to Richard, Rob and Tracy first. Later, with your okay, they&apos;ll join a shared collection the whole family can read.
        </p>
        <label className="flex items-start gap-3 text-small">
          <input name="contactOptIn" type="checkbox" className="mt-1 size-6 accent-jo-red" />
          <span>{CONTACT_OPT_IN_LABEL}</span>
        </label>
        <p className="text-small text-walnut-soft">{IMPLICIT_CONSENT_NOTE}</p>
      </form>
    </section>
  );
}
