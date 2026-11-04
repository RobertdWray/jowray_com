import type { AdminMemoryView } from "@/features/admin/get-memory";

import { CHANGED_VIA_LABEL, changedKeys, describeValue, formatDateTime, valueOf } from "./format";

const cell = "min-w-0 break-words whitespace-pre-wrap";

/** Revisions (newest first) as before → after per changed key, then the email log. */
export function History({ revisions, emails }: { revisions: AdminMemoryView["revisions"]; emails: AdminMemoryView["emails"] }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section aria-label="Changes" className="flex min-w-0 flex-col gap-3">
        <h3 className="text-label font-bold">Changes</h3>
        {revisions.length === 0 ? (
          <p className="text-small text-walnut-soft">No changes recorded.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {revisions.map((rev) => (
              <li key={rev.id} className="flex min-w-0 flex-col gap-1 rounded-card border-2 border-wood-light bg-paper p-3">
                <p className="text-small">
                  <span className="rounded-input border-2 border-wood px-2 py-0.5 font-bold">{CHANGED_VIA_LABEL[rev.changedVia]}</span>
                  <span className="text-walnut-soft"> {formatDateTime(rev.createdAt)}</span>
                </p>
                <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-small">
                  {changedKeys(rev.before, rev.after).map((key) => (
                    <div key={key} className="contents">
                      <dt className="font-bold">{key}</dt>
                      <dd className={cell}>
                        <span className="text-walnut-soft">{describeValue(valueOf(rev.before, key))}</span> → {describeValue(valueOf(rev.after, key))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section aria-label="Emails" className="flex min-w-0 flex-col gap-2">
        <h3 className="text-label font-bold">Emails</h3>
        {emails.length === 0 ? (
          <p className="text-small text-walnut-soft">None sent for this memory.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-small">
            {emails.map((row) => (
              <li key={`${row.emailType}-${row.createdAt.toISOString()}`} className={cell}>
                {row.emailType} · {row.status} · {row.sentAt ? formatDateTime(row.sentAt) : `created ${formatDateTime(row.createdAt)}`}
                {row.attempts > 1 && ` · ${row.attempts} attempts`}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
