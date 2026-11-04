"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ClaimView } from "@/features/memories/claim";
import { CONTACT_OPT_IN_LABEL, IMPLICIT_CONSENT_NOTE, NOTIFY_WHEN_POSTED_LABEL } from "@/lib/consent";
import { ACCEPT_ATTRIBUTE } from "@/lib/media-types";
import { contributorVisibilityOptions } from "@/lib/visibility";
import { uploadWithTicket } from "@/lib/upload-client";

import { PrimaryButton } from "../../_components/buttons";
import { fileInputClass, inputClass, labelClass, selectClass, textareaClass } from "../../_components/field-classes";
import { addFileTicket, finalizeAddedFile, updateMemory } from "./actions";

export function ClaimForm({ claimToken, memory }: { claimToken: string; memory: ClaimView }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A DRAFT was saved by the family admin on this person's behalf: one button, Share, which is the act of sharing.
  const draft = memory.status === "DRAFT";

  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = await updateMemory({
        claimToken,
        changes: {
          name: String(form.get("name") ?? ""),
          relationship: String(form.get("relationship") ?? ""),
          approxDateText: String(form.get("approxDateText") ?? ""),
          place: String(form.get("place") ?? ""),
          note: String(form.get("note") ?? ""),
          visibility: String(form.get("visibility") ?? memory.visibility),
          ...(draft && {
            share: true,
            notifyWhenPosted: form.get("notifyWhenPosted") === "on",
            contactOptIn: form.get("contactOptIn") === "on",
          }),
        },
      });
      setMessage(
        result.ok
          ? result.shared
            ? "Thank you. Your memory is with the family."
            : "Saved."
          : result.code === "last_words"
            ? draft
              ? "Keep a few words, or add a photo or a recording first: a memory cannot be empty."
              : "Your words are all this memory has right now. Add a file before clearing them, or keep a few words."
            : "Could not save. Please check the fields and try again."
      );
      if (result.ok) {
        router.refresh();
      }
    } catch {
      setMessage("We could not reach the server. Your changes are still in the form; please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onAddFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setBusy(true);
    setMessage("Uploading…");
    try {
      const ticketed = await addFileTicket({ claimToken, file: { name: file.name, type: file.type, size: file.size } });
      if (!ticketed.ok) {
        setMessage(ticketed.code === "too_many_files" ? "This memory already has the maximum number of files." : "That file cannot be added.");
        return;
      }
      await uploadWithTicket(ticketed.upload, file);
      const finalized = await finalizeAddedFile({ ticket: ticketed.upload.ticket, claimToken });
      setMessage(finalized.status === "READY" ? "File added." : finalized.status === "PENDING" ? "The file is still being checked; it will appear shortly." : "The file could not be accepted.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  const addFile = (
    <label className={labelClass}>
      <span>{draft ? "Add a photo, video or recording" : "Add another photo, video or recording"}</span>
      <input type="file" accept={ACCEPT_ATTRIBUTE} onChange={onAddFile} disabled={busy} className={fileInputClass} />
    </label>
  );

  return (
    <div className="space-y-6">
      {/* A draft's page says "add a photo, then press Share": the file control comes before the button. */}
      {draft && addFile}
      <form
        onSubmit={onSave}
        className="flex flex-col gap-[22px] rounded-form border-[3px] border-wood-light bg-paper p-8 shadow-form"
        aria-busy={busy}
      >
        {memory.submission && memory.submission.count > 1 && (
          <p className="text-small text-walnut-soft">
            This is memory {memory.submission.position} of the {memory.submission.count} you sent together. Your name and how you knew Jo are
            shared by all of them, so a change here changes them everywhere.
          </p>
        )}
        <label className={labelClass}>
          <span>Your name</span>
          <input name="name" defaultValue={memory.contributor?.name ?? ""} maxLength={120} className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>How you knew Jo</span>
          <input name="relationship" defaultValue={memory.contributor?.relationship ?? ""} maxLength={120} className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>Roughly when</span>
          <input name="approxDateText" defaultValue={memory.approxDateText ?? ""} maxLength={120} className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>Where</span>
          <input name="place" defaultValue={memory.place ?? ""} maxLength={200} className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>Your words</span>
          <textarea name="note" defaultValue={memory.contributorNote ?? ""} rows={6} maxLength={10_000} className={textareaClass} />
        </label>
        <label className={labelClass}>
          <span>Who can see this?</span>
          {/* Everyone or Family (ruling 3, 2026-11-04); a memory the family set PRIVATE keeps that choice listed (D5). */}
          <select name="visibility" defaultValue={memory.visibility} className={selectClass}>
            {contributorVisibilityOptions(memory.visibility).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        {draft ? (
          <>
            <label className="flex items-start gap-3 text-small">
              <input name="notifyWhenPosted" type="checkbox" defaultChecked={memory.notifyWhenPosted} className="mt-1 size-6 accent-jo-red" />
              <span>{NOTIFY_WHEN_POSTED_LABEL}</span>
            </label>
            <label className="flex items-start gap-3 text-small">
              {/* A draft stores no opt-in until Share; the box starts on, as on /share, and the press records the person's choice. */}
              <input name="contactOptIn" type="checkbox" defaultChecked className="mt-1 size-6 accent-jo-red" />
              <span>{CONTACT_OPT_IN_LABEL}</span>
            </label>
            <PrimaryButton type="submit" disabled={busy}>Share this memory</PrimaryButton>
            <p className="text-small text-walnut-soft">{IMPLICIT_CONSENT_NOTE}</p>
          </>
        ) : (
          <PrimaryButton type="submit" disabled={busy}>Save changes</PrimaryButton>
        )}
      </form>
      {!draft && addFile}
      {message && <p role="status" className="text-body">{message}</p>}
    </div>
  );
}
