"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { CONTACT_OPT_IN_LABEL, IMPLICIT_CONSENT_NOTE, MAILING_LIST_LABEL, NOTIFY_WHEN_POSTED_LABEL } from "@/lib/consent";
import { durationSecondsFor } from "@/lib/format-duration";
import { ACCEPT_ATTRIBUTE } from "@/lib/media-types";
import { uploadWithTicket } from "@/lib/upload-client";
import {
  getRememberedServerSnapshot,
  getRememberedSnapshot,
  rememberContributor,
  subscribeRemembered,
} from "@/lib/remembered-contributor";

import { PrimaryButton, secondaryButtonClass } from "../_components/buttons";
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
import { pickRecordingType } from "./recorder";
import { RecorderPanel } from "./recorder-panel-client";
import { useRecorder } from "./use-recorder";
import { useShareDraft } from "./use-share-draft";

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rec = useRecorder();
  // Destructured: a value passed as `ref` is treated as a ref by the React Compiler.
  const { attachForm, restored: draftRestored, onInput: saveDraft, clear: clearDraft } = useShareDraft();
  // A clip that sounds silent needs a second press of the send button; the
  // acknowledgement is tied to that clip's URL so a new take resets it.
  const [acknowledgedClipUrl, setAcknowledgedClipUrl] = useState<string | null>(null);
  // Server snapshot is false, client snapshot asks the browser: same markup on
  // both sides at hydration, then the record button appears where supported.
  const canRecord = useSyncExternalStore(subscribeNever, () => pickRecordingType() !== null, () => false);
  // Name, email and relationship from an earlier memory on this device; null on the server and until hydration.
  const remembered = useSyncExternalStore(subscribeRemembered, getRememberedSnapshot, getRememberedServerSnapshot);

  const clip = rec.clip;
  const confirmSilent = clip !== null && clip.recording.verdict === "suspectedSilent" && acknowledgedClipUrl === clip.url;
  const recorderActive =
    rec.snapshot.status.kind === "requesting" || rec.snapshot.status.kind === "recording" || rec.snapshot.status.kind === "finishing";
  const busy = phase.kind === "saving" || recorderActive;

  // A clip always wins over the file field, so the field is cleared and locked while one exists.
  useEffect(() => {
    if (clip && fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [clip]);

  function resetForm() {
    rec.discard();
    clearDraft();
    setAcknowledgedClipUrl(null);
    setPhase({ kind: "idle" });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (clip?.recording.verdict === "suspectedSilent" && !confirmSilent) {
      setAcknowledgedClipUrl(clip.url);
      return;
    }
    const form = new FormData(event.currentTarget);
    const picked = form.get("file");
    const file = clip?.recording.file ?? (picked instanceof File && picked.size > 0 ? picked : null);
    const durationSeconds = clip ? durationSecondsFor(clip.recording.durationMs) : undefined;
    const contributor = {
      name: String(form.get("name") ?? ""),
      relationship: String(form.get("relationship") ?? ""),
      email: String(form.get("email") ?? ""),
    };
    setPhase({ kind: "saving" });

    let created: Awaited<ReturnType<typeof createMemory>>;
    try {
      created = await createMemory({
        ...contributor,
        approxDateText: String(form.get("approxDateText") ?? ""),
        place: String(form.get("place") ?? ""),
        note: String(form.get("note") ?? ""),
        visibility: String(form.get("visibility") ?? "PUBLIC"),
        contactOptIn: form.get("contactOptIn") === "on",
        notifyWhenPosted: form.get("notifyWhenPosted") === "on",
        mailingListOptIn: form.get("mailingListOptIn") === "on",
        file: file ? { name: file.name, type: file.type, size: file.size, durationSeconds } : null,
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
    rememberContributor(contributor);

    if (!created.upload || !file) {
      clearDraft();
      setPhase({ kind: "done", claimLink: `${window.location.origin}/m/${created.claimToken}`, fileStatus: "none", emailed: created.emailed });
      return;
    }

    const claimLink = `${window.location.origin}/m/${created.claimToken}`;
    try {
      const { ticket } = created.upload;
      await uploadWithTicket(created.upload, file, (percentage) => setPhase({ kind: "saving", progress: percentage }));
      const finalized = await finalizeUpload({ ticket, claimToken: created.claimToken });
      clearDraft();
      if (finalized.status === "REJECTED") {
        setPhase({ kind: "error", message: "The upload could not be confirmed. Your words were saved; use your link below.", claimLink });
        return;
      }
      setPhase({ kind: "done", claimLink: finalized.claimLink, fileStatus: finalized.status, emailed: finalized.emailed });
    } catch (error) {
      // The memory is already saved; never lose the link over a failed upload.
      clearDraft();
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
          <p className="max-w-[30em] text-body">
            On November 10th, after we have some stories, photos and videos collected, we&apos;ll be sharing them with
            everyone and will email an update to all who have contributed.
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

  const saving = phase.kind === "saving";
  const sendLabel = saving
    ? phase.progress
      ? `Uploading… ${phase.progress}%`
      : "Sending…"
    : confirmSilent
      ? "Send anyway"
      : "Send this to Jo's family";

  return (
    <section id="form" className="mx-auto flex w-full max-w-[1200px] flex-wrap items-start gap-x-16 gap-y-10 px-[max(16px,5%)] py-[72px]">
      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-[18px]">
        {intro}
        <RecorderPanel rec={rec} canRecord={canRecord} disabled={saving} />
      </div>
      <form
        ref={attachForm}
        onSubmit={onSubmit}
        onInput={saveDraft}
        className="flex min-w-0 flex-[1_1_440px] flex-col gap-[22px] rounded-form border-[3px] border-wood-light bg-paper p-8 shadow-form"
        aria-busy={busy}
      >
        {draftRestored && (
          <p role="status" className="text-small text-walnut-soft">
            We kept the words you typed last time. Change anything you like before you send.
          </p>
        )}
        <div className="flex flex-wrap gap-5">
          <label className={`${labelClass} flex-[1_1_200px]`}>
            <span>Your name</span>
            <input name="name" maxLength={120} className={inputClass} autoComplete="name" placeholder="Kay Bartholomew" defaultValue={remembered?.name} />
          </label>
          <label className={`${labelClass} flex-[1_1_200px]`}>
            <span>Email <span className={helperClass}>(optional · so we can say thank you and send your private link)</span></span>
            <input name="email" type="email" maxLength={254} className={inputClass} autoComplete="email" placeholder="So we can say thank you" defaultValue={remembered?.email} />
          </label>
        </div>
        <label className={labelClass}>
          <span>How you knew Jo</span>
          <input name="relationship" maxLength={120} className={inputClass} placeholder="former student · church friend · neighbor · family" defaultValue={remembered?.relationship} />
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
          <input ref={fileInputRef} name="file" type="file" accept={ACCEPT_ATTRIBUTE} className={fileInputClass} disabled={busy || clip !== null} />
        </label>
        <label className={labelClass}>
          <span>Who can see this?</span>
          <select name="visibility" defaultValue="PUBLIC" className={selectClass}>
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
        {confirmSilent && (
          <p role="alert" className={errorClass}>
            This recording sounds silent. Play it back first. Press &quot;Send anyway&quot; to send it as it is, or record it again.
          </p>
        )}
        <PrimaryButton type="submit" disabled={busy}>
          <SolidHeart size={24} fill="#fff" stitch={false} />
          {sendLabel}
        </PrimaryButton>
        <p className="text-small text-walnut-soft">
          Memories go to Richard, Rob and Tracy first. Later, with your okay, they&apos;ll join a shared collection the whole family can read.
        </p>
        <label className="flex items-start gap-3 text-small">
          <input name="contactOptIn" type="checkbox" defaultChecked className="mt-1 size-6 accent-jo-red" />
          <span>{CONTACT_OPT_IN_LABEL}</span>
        </label>
        <label className="flex items-start gap-3 text-small">
          <input name="notifyWhenPosted" type="checkbox" defaultChecked className="mt-1 size-6 accent-jo-red" />
          <span>{NOTIFY_WHEN_POSTED_LABEL}</span>
        </label>
        <label className="flex items-start gap-3 text-small">
          <input name="mailingListOptIn" type="checkbox" className="mt-1 size-6 accent-jo-red" />
          <span>{MAILING_LIST_LABEL}</span>
        </label>
        <p className="text-small text-walnut-soft">{IMPLICIT_CONSENT_NOTE}</p>
      </form>
    </section>
  );
}
