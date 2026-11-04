"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { CONTACT_OPT_IN_LABEL, IMPLICIT_CONSENT_NOTE, MAILING_LIST_LABEL, NOTIFY_WHEN_POSTED_LABEL } from "@/lib/consent";
import { durationSecondsFor } from "@/lib/format-duration";
import { ACCEPT_ATTRIBUTE, MAX_FILES_PER_MEMORY } from "@/lib/media-types";
import { uploadWithTicket } from "@/lib/upload-client";
import {
  getRememberedServerSnapshot,
  getRememberedSnapshot,
  rememberContributor,
  subscribeRemembered,
} from "@/lib/remembered-contributor";

import { PrimaryButton, SecondaryButton, secondaryButtonClass } from "../_components/buttons";
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
import { completeSubmission, createMemory, finalizeUpload, issueUploadTicket } from "./actions";
import { pickRecordingType } from "./recorder";
import { RecorderPanel } from "./recorder-panel-client";
import { useRecorder } from "./use-recorder";
import { useShareDraft } from "./use-share-draft";

/** One file the contributor chose, with the words that belong to that file. */
interface FileRow {
  id: string;
  file: File;
  /** Object URL for a browser-renderable image; null for everything else (HEIC previews only draw in Safari). */
  previewUrl: string | null;
  caption: string;
  approxDateText: string;
  place: string;
}

type FileOutcome = "READY" | "PENDING" | "FAILED" | "ERROR";

type Phase =
  | { kind: "idle" }
  /** `claimLink` is set as soon as the memory exists: it survives every later failure and a closed tab. */
  | { kind: "saving"; claimLink?: string; current?: number; total?: number; progress?: number }
  | { kind: "done"; claimLink: string; emailed: boolean; hadWords: boolean; outcomes: Array<{ name: string; status: FileOutcome }> }
  | { kind: "error"; message: string; claimLink?: string };

function subscribeNever(): () => void {
  return () => {};
}

function canPreview(file: File): boolean {
  const type = file.type.toLowerCase();
  return type.startsWith("image/") && type !== "image/heic" && type !== "image/heif";
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ShareForm({ intro }: { intro: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [rows, setRows] = useState<FileRow[]>([]);
  const [rowsError, setRowsError] = useState<string | null>(null);
  // Mirror of `rows` for the unmount cleanup (refs are not read during render).
  const rowsRef = useRef<FileRow[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
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
  const saving = phase.kind === "saving";
  const busy = saving || recorderActive;
  // The recording is one more file; it counts against the same cap.
  const fileCount = rows.length + (clip ? 1 : 0);
  const slotsLeft = Math.max(0, MAX_FILES_PER_MEMORY - fileCount);

  // Object URLs are released when the component goes away; removal and reset release theirs as they go.
  useEffect(() => {
    return () => {
      for (const row of rowsRef.current) {
        if (row.previewUrl) {
          URL.revokeObjectURL(row.previewUrl);
        }
      }
    };
  }, []);

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) {
      return;
    }
    const picked = Array.from(list).filter((f) => f.size > 0);
    const room = slotsLeft;
    const accepted = picked.slice(0, room);
    setRowsError(picked.length > room ? `You can add up to ${MAX_FILES_PER_MEMORY} files to one memory; the first ${room} were kept.` : null);
    // Ids and object URLs are made here, outside the updater (updaters may run twice in development).
    const added: FileRow[] = accepted.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: canPreview(file) ? URL.createObjectURL(file) : null,
      caption: "",
      approxDateText: "",
      place: "",
    }));
    setRows((current) => [...current, ...added]);
  }

  function removeRow(id: string) {
    setRows((current) => {
      const row = current.find((r) => r.id === id);
      if (row?.previewUrl) {
        URL.revokeObjectURL(row.previewUrl);
      }
      return current.filter((r) => r.id !== id);
    });
    setRowsError(null);
  }

  function updateRow(id: string, patch: Partial<Pick<FileRow, "caption" | "approxDateText" | "place">>) {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function clearRows() {
    for (const row of rowsRef.current) {
      if (row.previewUrl) {
        URL.revokeObjectURL(row.previewUrl);
      }
    }
    setRows([]);
    setRowsError(null);
  }

  function resetForm() {
    rec.discard();
    clearDraft();
    clearRows();
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
    const contributor = {
      name: String(form.get("name") ?? ""),
      relationship: String(form.get("relationship") ?? ""),
      email: String(form.get("email") ?? ""),
    };
    // Snapshot of what will be sent, in order: picked files first, then the recording.
    const batch: Array<{ file: File; caption: string; approxDateText: string; place: string; durationSeconds?: number }> = rows.map((r) => ({
      file: r.file,
      caption: r.caption,
      approxDateText: r.approxDateText,
      place: r.place,
    }));
    if (clip) {
      batch.push({ file: clip.recording.file, caption: "", approxDateText: "", place: "", durationSeconds: durationSecondsFor(clip.recording.durationMs) });
    }
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
        files: batch.map((b) => ({
          name: b.file.name,
          type: b.file.type,
          size: b.file.size,
          durationSeconds: b.durationSeconds,
          caption: b.caption,
          approxDateText: b.approxDateText,
          place: b.place,
        })),
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
    const claimLink = `${window.location.origin}/m/${created.claimToken}`;
    const hadWords = String(form.get("note") ?? "").trim().length > 0;
    // The memory is saved: whatever happens to the files now, the link survives and is shown from here on.
    clearDraft();
    setPhase({ kind: "saving", claimLink });

    if (created.media.length === 0) {
      setPhase({ kind: "done", claimLink, emailed: created.emailed, hadWords, outcomes: [] });
      return;
    }

    // One file at a time: ticket just before the upload (tickets expire), then upload, then finalize.
    const outcomes: Array<{ name: string; status: FileOutcome }> = [];
    let emailed = created.emailed;
    const byOrder = [...created.media].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const [index, entry] of byOrder.entries()) {
      const item = batch[index];
      if (!item) {
        break;
      }
      setPhase({ kind: "saving", claimLink, current: index + 1, total: byOrder.length });
      try {
        const ticketed = await issueUploadTicket({ claimToken: created.claimToken, mediaId: entry.mediaId });
        if (!ticketed.ok) {
          outcomes.push({ name: item.file.name, status: "ERROR" });
          continue;
        }
        await uploadWithTicket(ticketed.upload, item.file, (percentage) => setPhase({ kind: "saving", claimLink, current: index + 1, total: byOrder.length, progress: percentage }));
        const finalized = await finalizeUpload({ ticket: ticketed.upload.ticket, claimToken: created.claimToken });
        outcomes.push({ name: item.file.name, status: finalized.status === "REJECTED" ? "ERROR" : finalized.status });
        emailed = emailed || (finalized.status !== "REJECTED" && finalized.emailed);
      } catch {
        outcomes.push({ name: item.file.name, status: "ERROR" });
      }
    }
    try {
      // Closes the submission and sends the one email with everything that arrived; the link is never rotated here.
      // "already_sent" means the last finalize sent it a moment ago.
      const completed = await completeSubmission({ claimToken: created.claimToken });
      emailed = emailed || completed.sent || (!completed.sent && completed.skipped === "already_sent");
    } catch {
      // The reconcile cron sends later; the contributor keeps the link either way.
    }
    clearRows();
    // Anything typed into the story during the upload belongs to a memory that is already sent.
    clearDraft();
    setPhase({ kind: "done", claimLink, emailed, hadWords, outcomes });
  }

  if (phase.kind === "done") {
    const origin = window.location.origin;
    const mailto = `mailto:?subject=${encodeURIComponent("Tell a Jo story")}&body=${encodeURIComponent(`Jo's family is collecting memories of her. If you knew Jo, tell yours here: ${origin}/`)}`;
    const pending = phase.outcomes.filter((o) => o.status === "PENDING");
    const failed = phase.outcomes.filter((o) => o.status === "FAILED" || o.status === "ERROR");
    // Files only, and none of them arrived: nothing is on its way yet; the link is how they try again.
    const nothingArrived = phase.outcomes.length > 0 && failed.length === phase.outcomes.length && !phase.hadWords;

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
          <h1 className="font-display text-display-sm font-extrabold sm:text-thanks">{nothingArrived ? "Almost there." : "Jo would have loved this."}</h1>
          <p className="max-w-[30em] text-lead">
            {nothingArrived
              ? "Your memory was saved, but none of the files arrived. Open your private link below to add them again; nothing else is needed."
              : "Thank you. Your memory is on its way to Richard, Rob and Tracy. We read every single one, usually more than once."}
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
            {pending.length > 0 && (
              <p>
                {pending.length === 1 ? "One file is" : `${pending.length} files are`} still being checked; they will appear on your page shortly.
              </p>
            )}
            {failed.length > 0 && !nothingArrived && (
              <p>
                {failed.length === 1 ? "One file could not be received" : `${failed.length} files could not be received`} ({failed.map((f) => f.name).join(", ")}).
                {phase.hadWords ? " Your words were saved;" : ""} use your link to try again.
              </p>
            )}
            <p className="text-small text-walnut-soft">Keep this link private: anyone who has it can edit this memory.</p>
          </div>
          <p className="font-display text-body italic text-walnut-soft">Spelling, as promised, did not count.</p>
        </div>
      </section>
    );
  }

  const sendLabel = saving
    ? phase.total
      ? `Uploading ${phase.current ?? 1} of ${phase.total}…${phase.progress ? ` ${phase.progress}%` : ""}`
      : "Sending…"
    : confirmSilent
      ? "Send anyway"
      : "Send this to Jo's family";

  return (
    <section id="form" className="mx-auto flex w-full max-w-[1200px] flex-wrap items-start gap-x-16 gap-y-10 px-[max(16px,5%)] py-[72px]">
      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-[18px]">
        {intro}
        <RecorderPanel rec={rec} canRecord={canRecord} disabled={saving || (slotsLeft === 0 && clip === null)} />
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
        <fieldset disabled={saving} className="contents">
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

        <div className="flex flex-col gap-3">
          <label className={labelClass}>
            <span>
              Add photos, videos or voice recordings <span className={helperClass}>(optional · up to {MAX_FILES_PER_MEMORY}; {slotsLeft} more can be added)</span>
            </span>
            <input
              type="file"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              className={fileInputClass}
              disabled={busy || slotsLeft === 0}
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          {rowsError && (
            <p role="alert" className={errorClass}>
              {rowsError}
            </p>
          )}
          {rows.length > 0 && (
            <ul className="flex flex-wrap gap-4">
              {rows.map((row, index) => (
                <li key={row.id} className="flex min-w-0 flex-[1_1_300px] flex-col gap-3 rounded-card border-[3px] border-wood-light bg-muslin p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {row.previewUrl ? (
                      // Local preview of the file the contributor just chose; nothing has been uploaded yet, and a blob: URL is never optimized.
                      <Image src={row.previewUrl} alt="" width={72} height={72} unoptimized className="size-[72px] rounded object-cover" />
                    ) : (
                      <span className="flex size-[72px] items-center justify-center rounded bg-paper text-small text-walnut-soft">{index + 1}</span>
                    )}
                    <span className="min-w-0 flex-1 break-words text-small">
                      {row.file.name} <span className={helperClass}>({formatSize(row.file.size)})</span>
                    </span>
                    <SecondaryButton onClick={() => removeRow(row.id)} disabled={busy}>
                      Remove
                    </SecondaryButton>
                  </div>
                  <label className={labelClass}>
                    <span>About this one <span className={helperClass}>(optional)</span></span>
                    <textarea rows={2} maxLength={2000} className={textareaClass} value={row.caption} disabled={busy} onChange={(e) => updateRow(row.id, { caption: e.target.value })} placeholder="Who is in it, what was happening" />
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <label className={`${labelClass} flex-[1_1_120px]`}>
                      <span>When <span className={helperClass}>(roughly)</span></span>
                      <input maxLength={120} className={inputClass} value={row.approxDateText} disabled={busy} onChange={(e) => updateRow(row.id, { approxDateText: e.target.value })} placeholder="Summer 1985" />
                    </label>
                    <label className={`${labelClass} flex-[1_1_120px]`}>
                      <span>Where</span>
                      <input maxLength={200} className={inputClass} value={row.place} disabled={busy} onChange={(e) => updateRow(row.id, { place: e.target.value })} placeholder="Lake George" />
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className={labelClass}>
          <span>Who can see this?</span>
          <select name="visibility" defaultValue="PUBLIC" className={selectClass}>
            <option value="FAMILY">The family</option>
            <option value="PUBLIC">Everyone who visits the memorial</option>
            <option value="PRIVATE">Only me and the family admins</option>
          </select>
        </label>
        </fieldset>
        {saving && phase.claimLink && (
          <p role="status" className="text-body">
            Your memory is saved. Your private link, in case this page closes:{" "}
            <a className={`${linkClass} break-all`} href={phase.claimLink}>
              {phase.claimLink}
            </a>
          </p>
        )}

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
