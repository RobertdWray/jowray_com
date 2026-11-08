import "server-only";

import { TX_OPTIONS } from "@/features/memories/create-memory";
import { hashInviteToken, newInviteToken } from "@/lib/invite-token";
import { createLogger } from "@/lib/logger";
import { getSiteUrl } from "@/lib/site-url";
import type { CreateInvitesInput } from "@/lib/validations/invite";
import { getMemorialEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "api" });

export type InviteResultStatus = "created" | "exists" | "rotated" | "revoked";

export interface InviteResult {
  index: number;
  status: InviteResultStatus;
  token?: string;
  shareUrl?: string;
}

/** Callers validate and normalize the batch with createInvitesInputSchema. */
export async function createInvites(input: CreateInvitesInput): Promise<InviteResult[]> {
  const emails = new Set<string>();
  for (const { email } of input.invites) {
    if (emails.has(email)) {
      throw new Error("Duplicate email in invite batch");
    }
    emails.add(email);
  }

  const { MEMORIAL_SLUG } = getMemorialEnv();
  const db = getDb();
  const memorial = await db.memorial.findUnique({ where: { slug: MEMORIAL_SLUG } });
  if (!memorial) {
    throw new Error(`Memorial "${MEMORIAL_SLUG}" is not seeded`);
  }

  const prepared = input.invites.map((invite, index) => {
    const token = newInviteToken();
    return { ...invite, index, token, tokenHash: hashInviteToken(token) };
  });
  // Validate the link origin before committing any newly issued credentials.
  const siteUrl = getSiteUrl();

  const results = await db.$transaction(async (tx) => {
    const inserted = await tx.invite.createManyAndReturn({
      data: prepared.map(({ tokenHash, firstName, lastName, email }) => ({
        memorialId: memorial.id, tokenHash, firstName, lastName: lastName ?? null, email,
      })),
      skipDuplicates: true,
      select: { tokenHash: true },
    });
    // Skipped duplicates and the database's return order cannot shift indexes.
    const insertedHashes = new Set(inserted.map(({ tokenHash }) => tokenHash));
    const skipped = prepared.filter(({ tokenHash }) => !insertedHashes.has(tokenHash));
    const existing = skipped.length === 0 ? [] : await tx.invite.findMany({
      where: { memorialId: memorial.id, email: { in: skipped.map(({ email }) => email) } },
    });
    const existingByEmail = new Map(existing.map((invite) => [invite.email, invite]));

    const batch: InviteResult[] = [];
    for (const { index, email, token, tokenHash } of prepared) {
      if (insertedHashes.has(tokenHash)) {
        batch.push({ index, status: "created", token, shareUrl: `${siteUrl}/s/${token}` });
        continue;
      }
      const invite = existingByEmail.get(email);
      if (!invite) {
        throw new Error(`Invite invariant violated at index ${index}: neither inserted nor found`);
      }
      if (invite.revokedAt) {
        batch.push({ index, status: "revoked" });
      } else if (input.rotate) {
        const { count } = await tx.invite.updateMany({ where: { id: invite.id, revokedAt: null }, data: { tokenHash } });
        if (count === 0) {
          batch.push({ index, status: "revoked" });
        } else {
          batch.push({ index, status: "rotated", token, shareUrl: `${siteUrl}/s/${token}` });
        }
      } else {
        batch.push({ index, status: "exists" });
      }
    }
    return batch;
  }, TX_OPTIONS);

  const counts: Record<InviteResultStatus, number> = { created: 0, exists: 0, rotated: 0, revoked: 0 };
  for (const { status } of results) {
    counts[status] += 1;
  }
  log.info({ action: "invites_created", ...counts }, "invite batch processed");
  return results;
}
