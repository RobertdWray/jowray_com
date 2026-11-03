"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState, useSyncExternalStore } from "react";

import { ACCEPT_ATTRIBUTE } from "@/lib/media-types";

import { createMemory, finalizeUpload } from "./actions";
import { AudioRecorder, pickRecordingType, type Recording } from "./recorder";

type Phase =
  | { kind: "idle" }
  | { kind: "saving"; progress?: number }
  | { kind: "done"; claimLink: string; fileStatus: "READY" | "PENDING" | "FAILED" | "none"; emailed: boolean }
  | { kind: "error"; message: string; claimLink?: string };

export interface ConsentCopy {
  version: string;
  storage: string;
  contact: string;
}

function subscribeNever(): () => void {
  return () => {};
}

export function ShareForm({ consent }: { consent: ConsentCopy }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [recording, setRecording] = useState<Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Server snapshot is false, client snapshot asks the browser: same markup on
  // both sides at hydration, then the record button appears where supported.
  const canRecord = useSyncExternalStore(subscribeNever, () => pickRecordingType() !== null, () => false);

  async function toggleRecording() {
    try {
      if (!recorderRef.current) {
        recorderRef.current = new AudioRecorder();
      }
      if (isRecording) {
        const result = await recorderRef.current.stop();
        setRecording(result);
        setIsRecording(false);
      } else {
        setRecording(null);
        await recorderRef.current.start();
        setIsRecording(true);
      }
    } catch (error) {
      setIsRecording(false);
      setPhase({ kind: "error", message: error instanceof Error ? error.message : "Recording failed" });
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const picked = form.get("file");
    const file = recording?.file ?? (picked instanceof File && picked.size > 0 ? picked : null);
    setPhase({ kind: "saving" });

    const created = await createMemory({
      name: String(form.get("name") ?? ""),
      relationship: String(form.get("relationship") ?? ""),
      email: String(form.get("email") ?? ""),
      approxDateText: String(form.get("approxDateText") ?? ""),
      place: String(form.get("place") ?? ""),
      note: String(form.get("note") ?? ""),
      visibility: String(form.get("visibility") ?? "FAMILY"),
      storageConsent: form.get("storageConsent") === "on",
      contactOptIn: form.get("contactOptIn") === "on",
      file: file ? { name: file.name, type: file.type, size: file.size } : null,
    });
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
    return (
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Saved. Thank you.</h2>
        {phase.fileStatus === "FAILED" && (
          <p>The file could not be accepted (wrong type or too large), but your words were saved.</p>
        )}
        {phase.fileStatus === "PENDING" && <p>Your file is still being checked; it will appear on your page shortly.</p>}
        <p>
          Your private link to see, correct or add to this memory:
          <br />
          <a className="underline break-all" href={phase.claimLink}>
            {phase.claimLink}
          </a>
        </p>
        {phase.emailed && <p>We have also emailed you this link.</p>}
        <p className="text-sm">Keep this link private: anyone who has it can edit this memory.</p>
      </section>
    );
  }

  const busy = phase.kind === "saving";
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4" aria-busy={busy}>
      <label className="block">
        <span>Your name</span>
        <input name="name" maxLength={120} className="mt-1 block w-full rounded border p-2" autoComplete="name" />
      </label>
      <label className="block">
        <span>Your relationship (friend, cousin, colleague…)</span>
        <input name="relationship" maxLength={120} className="mt-1 block w-full rounded border p-2" />
      </label>
      <label className="block">
        <span>Email (optional; we will send you a private link to your memory)</span>
        <input name="email" type="email" maxLength={254} className="mt-1 block w-full rounded border p-2" autoComplete="email" />
      </label>
      <label className="block">
        <span>Roughly when was this? (for example “Summer 1998”)</span>
        <input name="approxDateText" maxLength={120} className="mt-1 block w-full rounded border p-2" />
      </label>
      <label className="block">
        <span>Where? (optional)</span>
        <input name="place" maxLength={200} className="mt-1 block w-full rounded border p-2" />
      </label>
      <label className="block">
        <span>Your memory, in your own words</span>
        <textarea name="note" rows={6} maxLength={10_000} className="mt-1 block w-full rounded border p-2" />
      </label>

      <fieldset className="space-y-2">
        <legend>Add a photo, video or voice recording (optional)</legend>
        <input name="file" type="file" accept={ACCEPT_ATTRIBUTE} disabled={busy || recording !== null} />
        {canRecord && (
          <div className="flex items-center gap-3">
            <button type="button" onClick={toggleRecording} disabled={busy} className="rounded border px-3 py-1">
              {isRecording ? "Stop recording" : recording ? "Record again" : "Record a voice memory"}
            </button>
            {recording && <span>Recorded {Math.round(recording.durationMs / 1000)} s</span>}
          </div>
        )}
      </fieldset>

      <label className="block">
        <span>Who can see this?</span>
        <select name="visibility" defaultValue="FAMILY" className="mt-1 block rounded border p-2">
          <option value="FAMILY">The family</option>
          <option value="PUBLIC">Everyone who visits the memorial</option>
          <option value="PRIVATE">Only me and the family admins</option>
        </select>
      </label>

      <label className="flex gap-2">
        <input name="storageConsent" type="checkbox" required />
        <span>{consent.storage}</span>
      </label>
      <label className="flex gap-2">
        <input name="contactOptIn" type="checkbox" />
        <span>{consent.contact}</span>
      </label>

      {phase.kind === "error" && (
        <p role="alert" className="text-red-700">
          {phase.message}
          {phase.claimLink && (
            <>
              {" "}
              <a className="underline break-all" href={phase.claimLink}>
                {phase.claimLink}
              </a>
            </>
          )}
        </p>
      )}
      <button type="submit" disabled={busy || isRecording} className="rounded bg-black px-4 py-2 text-white">
        {busy ? (phase.progress ? `Uploading… ${phase.progress}%` : "Saving…") : "Share this memory"}
      </button>
    </form>
  );
}
