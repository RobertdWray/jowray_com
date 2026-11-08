import Link from "next/link";

import type { AdminMemoryView } from "@/features/admin/get-memory";

import { linkClass } from "../_components/field-classes";
import { formatDateTime, SOURCE_LABEL } from "./format";
import { History } from "./history";
import { MediaGallery } from "./media-gallery";
import { MemoryEditForm } from "./memory-edit-form";
import { StatusActions } from "./status-actions-client";
import { StatusBadge } from "./status-badge";

const cell = "min-w-0 break-words whitespace-pre-wrap";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function Facts({ memory }: { memory: AdminMemoryView }) {
  const contributor = memory.contributor;
  return (
    <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-small">
      <dt className="font-bold">Sent</dt>
      <dd className={cell}>{formatDateTime(memory.createdAt)}</dd>
      <dt className="font-bold">How</dt>
      <dd className={cell}>{SOURCE_LABEL[memory.source]}</dd>
      {memory.tags.length > 0 && (
        <>
          <dt className="font-bold">Patches</dt>
          <dd className="min-w-0">
            <ul className="flex flex-wrap gap-2" aria-label="Patches">
              {memory.tags.map((tag) => (
                <li key={tag} className="rounded-full border-2 border-dashed border-periwinkle bg-paper px-3 break-words">
                  {tag}
                </li>
              ))}
            </ul>
          </dd>
        </>
      )}
      {memory.approxYear !== null && (
        <>
          <dt className="font-bold">Timeline</dt>
          <dd className={cell}>{memory.approxMonth !== null ? `${MONTH_NAMES[memory.approxMonth - 1]} ${memory.approxYear}` : memory.approxYear}</dd>
        </>
      )}
      {memory.consentedAt !== null && (
        <>
          <dt className="font-bold">Shared</dt>
          <dd className={cell}>{formatDateTime(memory.consentedAt)} (terms {memory.consentVersion})</dd>
        </>
      )}
      {contributor && (
        <>
          <dt className="font-bold">Email</dt>
          <dd className={cell}>{contributor.email ?? "(none)"}</dd>
          <dt className="font-bold">Preferences</dt>
          <dd className={cell}>
            {memory.notifyWhenPosted ? "Tell them when it is posted" : "No posting notice"} · {contributor.contactOptIn ? "May be contacted" : "No contact"} ·{" "}
            {contributor.mailingListOptIn ? "On the mailing list" : "Not on the mailing list"}
          </dd>
        </>
      )}
      {memory.submissionId !== null && (
        <>
          <dt className="font-bold">Send</dt>
          <dd className={cell}>Memory {(memory.submissionIndex ?? 0) + 1} of a send; the name and relationship are shared by every memory sent together.</dd>
        </>
      )}
      <dt className="font-bold">Id</dt>
      <dd className={`${cell} font-mono text-[15px]`}>{memory.id}</dd>
    </dl>
  );
}

/** The editor column: facts, then the edit form (or the read-only words for a deleted memory). */
export function MemoryDetail({ memory }: { memory: AdminMemoryView }) {
  const deleted = memory.deletedAt !== null;
  return (
    <article className="flex min-w-0 max-w-[72ch] flex-col gap-5">
      <p className="wide:hidden">
        <Link href="/admin" prefetch={false} className={`${linkClass} inline-flex min-h-tap items-center`}>
          ← All memories
        </Link>
      </p>
      <header className="flex flex-wrap items-center gap-3">
        <StatusBadge status={memory.status} deleted={deleted} />
        <h2 className="min-w-0 break-words font-display text-card-title font-bold">{memory.contributor?.name ?? memory.contributor?.email ?? "Unnamed"}</h2>
      </header>
      {deleted && (
        <p className="rounded-card border-[3px] border-jo-red-deep bg-paper p-4 text-body" role="status">
          Deleted {formatDateTime(memory.deletedAt)}. It has left the family&rsquo;s view and its link no longer works. Restore within 30 days keeps the files; after that the words come back and the files are gone.
        </p>
      )}
      <Facts memory={memory} />
      {deleted ? (
        <section className="flex min-w-0 flex-col gap-2">
          <h3 className="text-label font-bold">Their words</h3>
          <blockquote className={`${cell} rounded-card border-[3px] border-wood-light bg-paper p-5 text-body`}>{memory.contributorNote ?? "(no words)"}</blockquote>
          {(memory.approxDateText || memory.place) && (
            <p className="text-small text-walnut-soft">{[memory.approxDateText, memory.place].filter(Boolean).join(" · ")}</p>
          )}
        </section>
      ) : (
        <MemoryEditForm memory={memory} />
      )}
    </article>
  );
}

/** The aside column: status actions, the gallery and the history. */
export function MemoryAside({ memory }: { memory: AdminMemoryView }) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-label="Status" className="flex min-w-0 flex-col gap-3">
        <h3 className="text-label font-bold">Status</h3>
        <StatusActions memory={{ id: memory.id, status: memory.status, deleted: memory.deletedAt !== null, purgedFiles: memory.media.filter((m) => m.purged).length, reviewVersion: memory.reviewVersion }} />
      </section>
      <section aria-label="Files" className="flex min-w-0 flex-col gap-3">
        <h3 className="text-label font-bold">Files</h3>
        <MediaGallery media={memory.media} />
      </section>
      <History revisions={memory.revisions} emails={memory.emails} />
    </div>
  );
}
