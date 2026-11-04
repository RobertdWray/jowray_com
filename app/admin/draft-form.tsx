"use client";

import Link from "next/link";
import { useState } from "react";

import type { AdminMemoryStatus } from "@/lib/validations/admin";
import { VISIBILITY_OPTIONS } from "@/lib/visibility";

import { PrimaryButton, SecondaryButton, TertiaryButton } from "../_components/buttons";
import { helperClass, inputClass, labelClass, linkClass, selectClass, textareaClass } from "../_components/field-classes";
import { createDraft, reissueLink } from "./actions";

type Outcome =
  | { kind: "created"; memoryId: string; claimLink: string }
  | { kind: "duplicate"; memoryId: string; status: AdminMemoryStatus; deleted: boolean; claimLink: string | null };

/** The draft-on-behalf form (plan §3.5, §3.8): words pasted verbatim, an email, and a link the family sends by hand. */
export function DraftForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage(null);
    try {
      const result = await createDraft({
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        relationship: String(form.get("relationship") ?? ""),
        note: String(form.get("note") ?? ""),
        approxDateText: String(form.get("approxDateText") ?? ""),
        place: String(form.get("place") ?? ""),
        visibility: String(form.get("visibility") ?? "PUBLIC"),
      });
      if (result.ok) {
        setOutcome({ kind: "created", memoryId: result.memoryId, claimLink: result.claimLink });
        setCopied(false);
        return;
      }
      if (result.code === "duplicate") {
        setOutcome({ kind: "duplicate", memoryId: result.memoryId, status: result.status, deleted: result.deletedAt !== null, claimLink: null });
        return;
      }
      setMessage(
        result.code === "budget_exceeded"
          ? "The site has taken as many memories as it will today; try again tomorrow."
          : result.code === "unauthorized"
            ? "You are signed out. Open your link again."
            : "Please check the email address and the words."
      );
    } catch {
      setMessage("We could not reach the server. Nothing was saved; please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onReissue(memoryId: string) {
    setBusy(true);
    try {
      const result = await reissueLink({ memoryId });
      if (result.ok) {
        setOutcome((previous) => (previous ? { ...previous, claimLink: result.claimLink } : previous));
        setCopied(false);
      } else {
        setMessage(result.code === "not_draft" ? "They have already pressed Share; the link cannot be reissued." : "A new link could not be made.");
      }
    } catch {
      setMessage("We could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setMessage("Copying is blocked in this browser; select the link and copy it by hand.");
    }
  }

  const link = outcome?.kind === "created" ? outcome.claimLink : outcome?.claimLink ?? null;

  return (
    <div className="flex flex-col gap-4">
      {outcome && (
        <div className="flex flex-col gap-3 rounded-card border-[3px] border-wood-light bg-paper p-5 shadow-card" role="status">
          <p className="text-body font-bold">{outcome.kind === "created" ? "Drafted." : outcome.deleted ? "Already drafted; it's in Deleted." : "Already drafted."}</p>
          {link && (
            <>
              <p className="min-w-0 break-all text-small">
                <a href={link} className={linkClass} target="_blank" rel="noopener">
                  {link}
                </a>
              </p>
              <div className="flex flex-wrap gap-2">
                <TertiaryButton onClick={() => copy(link)}>{copied ? "Copied" : "Copy link"}</TertiaryButton>
              </div>
              <p className="text-small text-walnut-soft">The site will not email this. Send it to them yourself.{outcome.kind === "duplicate" && " Any earlier link stops working."}</p>
            </>
          )}
          {outcome.kind === "duplicate" && outcome.status === "DRAFT" && !link && (
            <SecondaryButton onClick={() => onReissue(outcome.memoryId)} disabled={busy} className="self-start">
              New link
            </SecondaryButton>
          )}
          <p className="text-small">
            <Link href={`/admin/memories/${outcome.memoryId}`} prefetch={false} className={linkClass}>
              Open the memory
            </Link>
          </p>
        </div>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-[22px] rounded-form border-[3px] border-wood-light bg-paper p-6 shadow-form" aria-busy={busy}>
        <label className={labelClass}>
          <span>Their email</span>
          <input name="email" type="email" required maxLength={254} className={inputClass} autoComplete="off" />
          <span className={helperClass}>Their link goes to whoever holds it; make sure this is theirs.</span>
        </label>
        <label className={labelClass}>
          <span>Their name</span>
          <input name="name" maxLength={120} className={inputClass} autoComplete="off" />
        </label>
        <label className={labelClass}>
          <span>How they knew Jo</span>
          <input name="relationship" maxLength={120} className={inputClass} autoComplete="off" />
        </label>
        <label className={labelClass}>
          <span>Their words</span>
          <textarea name="note" required rows={10} maxLength={10_000} className={textareaClass} />
          <span className={helperClass}>Pasted from an email, text or card, exactly as they wrote it. Nothing is rewritten.</span>
        </label>
        <label className={labelClass}>
          <span>Roughly when</span>
          <input name="approxDateText" maxLength={120} className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>Where</span>
          <input name="place" maxLength={200} className={inputClass} />
        </label>
        <label className={labelClass}>
          <span>Who can see this?</span>
          <select name="visibility" defaultValue="PUBLIC" className={selectClass}>
            {VISIBILITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <PrimaryButton type="submit" disabled={busy}>
          Draft it and make their link
        </PrimaryButton>
      </form>
      {message && (
        <p role="status" className="text-body">
          {message}
        </p>
      )}
    </div>
  );
}
