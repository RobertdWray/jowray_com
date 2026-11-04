import "server-only";

import { LIVE_MEDIA_ORDER } from "@/features/memories/media-state";
import type { AdminMemoryStatus } from "@/lib/validations/admin";
import { getDb } from "@/server/db/client";

/** Revisions shown on the detail page, newest first. */
const REVISION_TAKE = 25;

export interface AdminMediaView {
  id: string;
  status: "PENDING" | "READY" | "FAILED";
  mimeType: string;
  originalFilename: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  approxDateText: string | null;
  place: string | null;
  sortOrder: number;
  webReady: boolean;
  thumbReady: boolean;
  /** `purgedAt` is set: the bytes are gone or being removed (cron step (f)); the row never serves again. */
  purged: boolean;
}

export interface AdminContributorView {
  id: string;
  name: string | null;
  email: string | null;
  relationship: string | null;
  phone: string | null;
  contactOptIn: boolean;
  mailingListOptIn: boolean;
  /** `Contributor.updatedAt` as ISO; sent back with a save so a concurrent change is noticed. */
  contributorVersion: string;
}

export interface AdminMemoryView {
  id: string;
  status: AdminMemoryStatus;
  type: "VOICE" | "VIDEO" | "PHOTO" | "TEXT";
  source: "PHONE_CALL" | "SMS" | "WEB_UPLOAD" | "EMAIL" | "OTHER";
  sourceRef: string | null;
  visibility: "PUBLIC" | "FAMILY" | "PRIVATE";
  approxDateText: string | null;
  place: string | null;
  contributorNote: string | null;
  notifyWhenPosted: boolean;
  consentVersion: string;
  consentedAt: Date | null;
  submissionId: string | null;
  submissionIndex: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /** `Memory.updatedAt` as ISO; sent back with a save. */
  memoryVersion: string;
  contributor: AdminContributorView | null;
  media: AdminMediaView[];
  revisions: Array<{ id: string; changedVia: "WEB" | "SMS" | "CLAIM_LINK" | "ADMIN"; before: unknown; after: unknown; createdAt: Date }>;
  emails: Array<{ emailType: string; status: string; sentAt: Date | null; attempts: number; createdAt: Date }>;
}

/**
 * One memory for the admin detail page, deleted or not (the page decides what
 * to offer). Never includes `claimTokenHash`, `blobUrl`, `storageKey` or `exif`
 * (plan §4.1): the view is serialised to the browser.
 */
export async function getMemoryForAdmin(id: string): Promise<AdminMemoryView | null> {
  const memory = await getDb().memory.findUnique({
    where: { id },
    include: {
      contributor: { select: { id: true, name: true, email: true, relationship: true, phone: true, contactOptIn: true, mailingListOptIn: true, updatedAt: true } },
      media: {
        where: { deletedAt: null },
        select: {
          id: true,
          status: true,
          mimeType: true,
          originalFilename: true,
          durationSeconds: true,
          width: true,
          height: true,
          caption: true,
          approxDateText: true,
          place: true,
          sortOrder: true,
          purgedAt: true,
          derivatives: { where: { status: "READY" }, select: { kind: true } },
        },
        orderBy: [...LIVE_MEDIA_ORDER],
      },
      revisions: { select: { id: true, changedVia: true, before: true, after: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: REVISION_TAKE },
      emails: { select: { emailType: true, status: true, sentAt: true, attempts: true, createdAt: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!memory) {
    return null;
  }
  return {
    id: memory.id,
    status: memory.status,
    type: memory.type,
    source: memory.source,
    sourceRef: memory.sourceRef,
    visibility: memory.visibility,
    approxDateText: memory.approxDateText,
    place: memory.place,
    contributorNote: memory.contributorNote,
    notifyWhenPosted: memory.notifyWhenPosted,
    consentVersion: memory.consentVersion,
    consentedAt: memory.consentedAt,
    submissionId: memory.submissionId,
    submissionIndex: memory.submissionIndex,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    deletedAt: memory.deletedAt,
    memoryVersion: memory.updatedAt.toISOString(),
    contributor: memory.contributor
      ? {
          id: memory.contributor.id,
          name: memory.contributor.name,
          email: memory.contributor.email,
          relationship: memory.contributor.relationship,
          phone: memory.contributor.phone,
          contactOptIn: memory.contributor.contactOptIn,
          mailingListOptIn: memory.contributor.mailingListOptIn,
          contributorVersion: memory.contributor.updatedAt.toISOString(),
        }
      : null,
    media: memory.media.map((m) => ({
      id: m.id,
      status: m.status,
      mimeType: m.mimeType,
      originalFilename: m.originalFilename,
      durationSeconds: m.durationSeconds,
      width: m.width,
      height: m.height,
      caption: m.caption,
      approxDateText: m.approxDateText,
      place: m.place,
      sortOrder: m.sortOrder,
      webReady: m.derivatives.some((d) => d.kind === "WEB_IMAGE"),
      thumbReady: m.derivatives.some((d) => d.kind === "THUMBNAIL"),
      purged: m.purgedAt !== null,
    })),
    revisions: memory.revisions.map((r) => ({ id: r.id, changedVia: r.changedVia, before: r.before, after: r.after, createdAt: r.createdAt })),
    emails: memory.emails.map((e) => ({ emailType: e.emailType, status: e.status, sentAt: e.sentAt, attempts: e.attempts, createdAt: e.createdAt })),
  };
}
