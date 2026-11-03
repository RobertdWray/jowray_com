"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ClaimView } from "@/features/memories/claim";
import { ACCEPT_ATTRIBUTE } from "@/lib/media-types";
import { uploadWithTicket } from "@/lib/upload-client";

import { PrimaryButton } from "../../_components/buttons";
import { fileInputClass, inputClass, labelClass, selectClass, textareaClass } from "../../_components/field-classes";
import { addFileTicket, finalizeAddedFile, updateMemory } from "./actions";

export function ClaimForm({ claimToken, memory }: { claimToken: string; memory: ClaimView }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        },
      });
      setMessage(
        result.ok
          ? "Saved."
          : result.code === "last_words"
            ? "Your words are all this memory has right now. Add a file before clearing them, or keep a few words."
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

  return (
    <div className="space-y-6">
      <form
        onSubmit={onSave}
        className="flex flex-col gap-[22px] rounded-form border-[3px] border-wood-light bg-paper p-8 shadow-form"
        aria-busy={busy}
      >
        <label className={labelClass}>
          <span>Your name</span>
          <input name="name" defaultValue={memory.contributor?.name ?? ""} maxLength={120} className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>Relationship</span>
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
          <select name="visibility" defaultValue={memory.visibility} className={selectClass}>
            <option value="FAMILY">The family</option>
            <option value="PUBLIC">Everyone who visits the memorial</option>
            <option value="PRIVATE">Only me and the family admins</option>
          </select>
        </label>
        <PrimaryButton type="submit" disabled={busy}>Save changes</PrimaryButton>
      </form>
      <label className={labelClass}>
        <span>Add another photo, video or recording</span>
        <input type="file" accept={ACCEPT_ATTRIBUTE} onChange={onAddFile} disabled={busy} className={fileInputClass} />
      </label>
      {message && <p role="status" className="text-body">{message}</p>}
    </div>
  );
}
