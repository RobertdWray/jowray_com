"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ClaimView } from "@/features/memories/claim";
import { ACCEPT_ATTRIBUTE } from "@/lib/media-types";

import { addFileTicket, finalizeAddedFile, updateMemory } from "./actions";

export function ClaimForm({ claimToken, memory }: { claimToken: string; memory: ClaimView }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
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
    setBusy(false);
    setMessage(result.ok ? "Saved." : "Could not save. Please check the fields and try again.");
    if (result.ok) {
      router.refresh();
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
      const { ticket, pathname } = ticketed.upload;
      await upload(pathname, file, {
        access: "private",
        handleUploadUrl: "/api/upload",
        multipart: true,
        contentType: ticket.mimeType,
        clientPayload: JSON.stringify(ticket),
      });
      const finalized = await finalizeAddedFile({ ticket, claimToken });
      setMessage(finalized.status === "READY" ? "File added." : "The file could not be accepted.");
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
      <form onSubmit={onSave} className="space-y-3" aria-busy={busy}>
        <label className="block"><span>Your name</span><input name="name" defaultValue={memory.contributor?.name ?? ""} maxLength={120} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="block"><span>Relationship</span><input name="relationship" defaultValue={memory.contributor?.relationship ?? ""} maxLength={120} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="block"><span>Roughly when</span><input name="approxDateText" defaultValue={memory.approxDateText ?? ""} maxLength={120} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="block"><span>Where</span><input name="place" defaultValue={memory.place ?? ""} maxLength={200} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="block"><span>Your words</span><textarea name="note" defaultValue={memory.contributorNote ?? ""} rows={6} maxLength={10_000} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="block"><span>Who can see this?</span>
          <select name="visibility" defaultValue={memory.visibility} className="mt-1 block rounded border p-2">
            <option value="FAMILY">The family</option>
            <option value="PUBLIC">Everyone who visits the memorial</option>
            <option value="PRIVATE">Only me and the family admins</option>
          </select>
        </label>
        <button type="submit" disabled={busy} className="rounded bg-black px-4 py-2 text-white">Save changes</button>
      </form>
      <label className="block">
        <span>Add another photo, video or recording</span>
        <input type="file" accept={ACCEPT_ATTRIBUTE} onChange={onAddFile} disabled={busy} className="mt-1 block" />
      </label>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
