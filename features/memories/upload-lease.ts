import "server-only";

import type { Tx } from "@/features/memories/lock";
import { UPLOAD_LEASE_MS } from "@/lib/upload-ticket";

/** The columns the lease helpers read from a memory row. */
export interface LeaseHolder {
  submissionId: string | null;
}

/**
 * Push the send's upload lease out by `UPLOAD_LEASE_MS` from now, on the
 * anchor (index 0) only. Legacy memories have no send and no lease.
 *
 * It is one `UPDATE`, whose row lock serialises it against completion and
 * against the cron's rotation. Every writer that touches several memories of
 * a send takes the anchor first, then the others in ascending index, so this
 * must be the first statement of a claim-page ticket transaction, before
 * `lockMemory(k)` (C24, C25).
 */
export async function renewUploadLease(tx: Tx, memory: LeaseHolder, now = Date.now()): Promise<void> {
  if (memory.submissionId === null) {
    return;
  }
  await tx.memory.updateMany({
    where: { submissionId: memory.submissionId, submissionIndex: 0 },
    data: { uploadLeaseUntil: new Date(now + UPLOAD_LEASE_MS) },
  });
}
