import "server-only";

import { hashInviteToken, isInviteToken } from "@/lib/invite-token";
import { getDb } from "@/server/db/client";

export interface InvitePrefill {
  firstName: string;
  name: string;
  email: string;
}

/** Read-only: link scanners and prefetches must not change an invite. */
export async function getInvitePrefill(token: string): Promise<InvitePrefill | null> {
  if (!isInviteToken(token)) {
    return null;
  }
  const invite = await getDb().invite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: { firstName: true, lastName: true, email: true, revokedAt: true },
  });
  if (!invite || invite.revokedAt) {
    return null;
  }
  const { firstName, lastName, email } = invite;
  return { firstName, name: [firstName, lastName].filter(Boolean).join(" "), email };
}
