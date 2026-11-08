"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AdminMemoryStatus } from "@/lib/validations/admin";

import { PrimaryButton, SecondaryButton, TertiaryButton } from "../_components/buttons";
import { linkClass } from "../_components/field-classes";
import { reissueLink, setDeleted, setStatus } from "./actions";

export interface StatusActionsProps {
  id: string;
  status: AdminMemoryStatus;
  deleted: boolean;
  /** Live files whose bytes are gone or going (`purgedAt` set). */
  purgedFiles: number;
}

type Confirm = "delete" | "restore" | "reissue" | null;

/**
 * Approve / Hide / Back to pending, Delete / Restore (two-step, inline: the
 * design has no modals), and for a DRAFT the "New link" button. Every change
 * re-reads the server-rendered page.
 */
export function StatusActions({ memory }: { memory: StatusActionsProps }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Confirm>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(work: () => Promise<string | null>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await work());
    } catch {
      setMessage("We could not reach the server. Please try again.");
    } finally {
      setBusy(false);
      setConfirming(null);
      router.refresh();
    }
  }

  function unauthorizedOr(code: string, fallback: string): string {
    return code === "unauthorized" ? "You are signed out. Open your link again." : code === "not_found" ? "This memory is no longer here. Reload the page." : fallback;
  }

  function onStatus(status: "PENDING" | "APPROVED" | "HIDDEN") {
    return run(async () => {
      const result = await setStatus({ memoryId: memory.id, status });
      if (result.ok) {
        return status === "APPROVED" ? "Approved." : status === "HIDDEN" ? "Hidden." : "Back to pending.";
      }
      return result.code === "draft" ? "Only the person who sent this can share it; wait for them to press Share." : unauthorizedOr(result.code, "That could not be changed.");
    });
  }

  function onDelete(deleted: boolean) {
    return run(async () => {
      const result = await setDeleted({ memoryId: memory.id, deleted });
      if (!result.ok) {
        return unauthorizedOr(result.code, "That could not be changed.");
      }
      if (deleted) {
        return "Deleted. It can be restored from the Deleted list.";
      }
      return result.purgedFiles > 0
        ? `Restored. ${result.purgedFiles === 1 ? "One file was" : `${result.purgedFiles} files were`} removed after 30 days and cannot come back; the words are here.`
        : "Restored.";
    });
  }

  function onReissue() {
    return run(async () => {
      const result = await reissueLink({ memoryId: memory.id });
      if (result.ok) {
        setFreshLink(result.claimLink);
        setCopied(false);
        return null;
      }
      return result.code === "not_draft" ? "They have already pressed Share; the link cannot be reissued." : unauthorizedOr(result.code, "A new link could not be made.");
    });
  }

  async function copyLink() {
    if (!freshLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(freshLink);
      setCopied(true);
    } catch {
      setMessage("Copying is blocked in this browser; select the link and copy it by hand.");
    }
  }

  if (memory.deleted) {
    return (
      <div className="flex flex-col gap-3">
        {confirming === "restore" ? (
          <div className="flex flex-wrap gap-3">
            <PrimaryButton onClick={() => onDelete(false)} disabled={busy}>
              Yes, restore it
            </PrimaryButton>
            <SecondaryButton onClick={() => setConfirming(null)} disabled={busy}>
              Keep it deleted
            </SecondaryButton>
          </div>
        ) : (
          <PrimaryButton onClick={() => setConfirming("restore")} disabled={busy}>
            Restore
          </PrimaryButton>
        )}
        {memory.purgedFiles > 0 && (
          <p className="text-small text-walnut-soft">
            {memory.purgedFiles === 1 ? "One file has" : `${memory.purgedFiles} files have`} already been removed (deleted more than 30 days ago); restoring brings back the words.
          </p>
        )}
        {message && (
          <p role="status" className="text-body">
            {message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {memory.status === "DRAFT" ? (
        <div className="flex flex-col gap-3">
          <p className="text-body">Waiting for them to press Share. Nothing is visible to anyone until they do.</p>
          {freshLink ? (
            <div className="flex flex-col gap-2 rounded-card border-[3px] border-wood-light bg-paper p-4">
              <p className="text-small font-bold">Their new link (shown once):</p>
              <p className="min-w-0 break-all text-small">
                <a href={freshLink} className={linkClass} target="_blank" rel="noopener">
                  {freshLink}
                </a>
              </p>
              <div className="flex flex-wrap gap-2">
                <TertiaryButton onClick={copyLink}>{copied ? "Copied" : "Copy link"}</TertiaryButton>
              </div>
              <p className="text-small text-walnut-soft">Any earlier link stops working. The site will not email this; send it to them yourself.</p>
            </div>
          ) : confirming === "reissue" ? (
            <div className="flex flex-wrap gap-3">
              <PrimaryButton onClick={onReissue} disabled={busy}>
                Yes, make a new link
              </PrimaryButton>
              <SecondaryButton onClick={() => setConfirming(null)} disabled={busy}>
                Cancel
              </SecondaryButton>
            </div>
          ) : (
            <SecondaryButton onClick={() => setConfirming("reissue")} disabled={busy}>
              New link
            </SecondaryButton>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            {memory.status !== "APPROVED" && (
              <PrimaryButton onClick={() => onStatus("APPROVED")} disabled={busy}>
                Approve
              </PrimaryButton>
            )}
            {memory.status !== "HIDDEN" && (
              <SecondaryButton onClick={() => onStatus("HIDDEN")} disabled={busy}>
                Hide
              </SecondaryButton>
            )}
            {memory.status !== "PENDING" && (
              <SecondaryButton onClick={() => onStatus("PENDING")} disabled={busy}>
                Back to pending
              </SecondaryButton>
            )}
          </div>
          <p className="text-small text-walnut-soft">Approving shows the memory on See memories once its visibility is Everyone and the family has turned the pages on.</p>
        </div>
      )}
      <div className="flex flex-col gap-2 border-t-2 border-wood-light pt-4">
        {confirming === "delete" ? (
          <div className="flex flex-col gap-3">
            <p className="text-body">It leaves the family&rsquo;s view now. Restore within 30 days keeps the files.</p>
            <div className="flex flex-wrap gap-3">
              <PrimaryButton onClick={() => onDelete(true)} disabled={busy}>
                Yes, delete it
              </PrimaryButton>
              <SecondaryButton onClick={() => setConfirming(null)} disabled={busy}>
                Keep it
              </SecondaryButton>
            </div>
          </div>
        ) : (
          <SecondaryButton onClick={() => setConfirming("delete")} disabled={busy} className="self-start">
            Delete
          </SecondaryButton>
        )}
      </div>
      {message && (
        <p role="status" className="text-body">
          {message}
        </p>
      )}
    </div>
  );
}
