"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AdminMemoryView } from "@/features/admin/get-memory";
import type { AdminMemoryEditable } from "@/features/admin/update-memory";
import { VISIBILITY_OPTIONS } from "@/lib/visibility";

import { PrimaryButton, SecondaryButton } from "../_components/buttons";
import { inputClass, labelClass, selectClass, textareaClass } from "../_components/field-classes";
import { saveMemory } from "./actions";

type Values = Pick<AdminMemoryEditable, "name" | "relationship" | "approxDateText" | "place" | "note" | "visibility">;
type Versions = Pick<AdminMemoryEditable, "memoryVersion" | "contributorVersion">;
const KEYS = ["name", "relationship", "approxDateText", "place", "note", "visibility"] as const;
const LABEL: Record<keyof Values, string> = { name: "name", relationship: "relationship", approxDateText: "when", place: "where", note: "words", visibility: "visibility" };

function valuesOf(memory: AdminMemoryView): Values {
  return {
    name: memory.contributor?.name ?? null,
    relationship: memory.contributor?.relationship ?? null,
    approxDateText: memory.approxDateText,
    place: memory.place,
    note: memory.contributorNote,
    visibility: memory.visibility,
  };
}

/** The form's text for a stored value (null is an empty field) and back (a trimmed empty field is null). */
function text(value: string | null): string {
  return value ?? "";
}
function stored(value: string): string | null {
  return value.trim().length === 0 ? null : value;
}

/**
 * The words-and-fields editor (plan §3.8, §4.3). Uncontrolled inputs; on submit
 * only the keys whose value differs from what the form opened with are sent,
 * with both versions. `stale` keeps every input as typed, adopts the server's
 * versions and names what changed there; Save again sends the same dirty keys;
 * Reload re-reads the page, which remounts the form through its key.
 */
export function MemoryEditForm({ memory }: { memory: AdminMemoryView }) {
  const [message, setMessage] = useState<string | null>(null);
  const contributorVersion = memory.contributor?.contributorVersion ?? null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <EditFields key={`${memory.memoryVersion}|${contributorVersion ?? ""}`} memory={memory} onMessage={setMessage} />
      {message && (
        <p role="status" className="text-body">
          {message}
        </p>
      )}
    </div>
  );
}

function EditFields({ memory, onMessage }: { memory: AdminMemoryView; onMessage: (message: string | null) => void }) {
  const router = useRouter();
  const [initial] = useState<Values>(() => valuesOf(memory));
  const [versions, setVersions] = useState<Versions>({ memoryVersion: memory.memoryVersion, contributorVersion: memory.contributor?.contributorVersion ?? null });
  const [serverChanged, setServerChanged] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const hasContributor = memory.contributor !== null;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const typed: Values = {
      name: stored(String(form.get("name") ?? "")),
      relationship: stored(String(form.get("relationship") ?? "")),
      approxDateText: stored(String(form.get("approxDateText") ?? "")),
      place: stored(String(form.get("place") ?? "")),
      note: stored(String(form.get("note") ?? "")),
      visibility: String(form.get("visibility") ?? initial.visibility) as Values["visibility"],
    };
    const changes: Partial<Record<keyof Values, string | null>> = {};
    for (const key of KEYS) {
      if (typed[key] !== initial[key]) {
        changes[key] = typed[key] === null ? "" : typed[key];
      }
    }
    if (Object.keys(changes).length === 0) {
      onMessage("Nothing changed.");
      return;
    }
    setBusy(true);
    onMessage(null);
    try {
      const result = await saveMemory({ memoryId: memory.id, ...versions, changes });
      if (result.ok) {
        setServerChanged(null);
        onMessage(result.written.length === 0 ? "Already saved." : "Saved.");
        router.refresh();
        return;
      }
      if (result.code === "stale") {
        const { current } = result;
        setVersions({ memoryVersion: current.memoryVersion, contributorVersion: current.contributorVersion });
        setServerChanged(KEYS.filter((key) => current[key] !== initial[key]).map((key) => LABEL[key]));
        return;
      }
      onMessage(
        result.code === "last_words"
          ? "Those words are all this memory has. Keep a few, or wait for a file to arrive."
          : result.code === "not_found"
            ? "This memory is no longer here. Reload the page."
            : result.code === "unauthorized"
              ? "You are signed out. Open your link again."
              : "Could not save. Please check the fields."
      );
    } catch {
      onMessage("We could not reach the server. Your changes are still in the form; please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex min-w-0 flex-col gap-[22px] rounded-form border-[3px] border-wood-light bg-paper p-6 shadow-form" aria-busy={busy}>
      {serverChanged !== null && (
        <div className="flex flex-col gap-3 rounded-card border-[3px] border-goldenrod bg-muslin p-4" role="alert">
          <p className="text-body">
            Someone changed {serverChanged.length > 0 ? serverChanged.join(" and ") : "this memory"} since you opened this. Your edits are still here; press Save to keep them, or Reload to discard them.
          </p>
          <SecondaryButton onClick={() => router.refresh()} disabled={busy}>
            Reload
          </SecondaryButton>
        </div>
      )}
      {hasContributor && (
        <>
          {memory.submissionId !== null && (
            <p className="text-small text-walnut-soft">The name and relationship are shared by every memory sent together, so a change here changes them everywhere.</p>
          )}
          <label className={labelClass}>
            <span>Their name</span>
            <input name="name" defaultValue={text(initial.name)} maxLength={120} className={inputClass} />
          </label>
          <label className={labelClass}>
            <span>How they knew Jo</span>
            <input name="relationship" defaultValue={text(initial.relationship)} maxLength={120} className={inputClass} />
          </label>
        </>
      )}
      <label className={labelClass}>
        <span>Roughly when</span>
        <input name="approxDateText" defaultValue={text(initial.approxDateText)} maxLength={120} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span>Where</span>
        <input name="place" defaultValue={text(initial.place)} maxLength={200} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span>Their words</span>
        <textarea name="note" defaultValue={text(initial.note)} rows={10} maxLength={10_000} className={textareaClass} />
      </label>
      <label className={labelClass}>
        <span>Who can see this?</span>
        <select name="visibility" defaultValue={initial.visibility} className={selectClass}>
          {VISIBILITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <PrimaryButton type="submit" disabled={busy}>
        Save changes
      </PrimaryButton>
    </form>
  );
}
