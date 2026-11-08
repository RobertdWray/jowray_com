import "server-only";

import { LIVE_MEDIA_ORDER } from "@/features/memories/media-state";
import type { AdminMemoryStatus } from "@/lib/validations/admin";
import { coordinatesOf, type Coordinates } from "@/lib/validations/memory";
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
  /**
   * The photo's GPS from its original (plan 2026-11-06-photo-gps-places B7), present only when asked for
   * (`includeCoordinates`, the MCP tools); the admin page never sees it. null: none saved (yet).
   */
  coordinates?: Coordinates | null;
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
  /** The memory's patches (plan 2026-11-08 D3). */
  tags: string[];
  /** The year and month the family set (D4); null = the year is read from `approxDateText`. */
  approxYear: number | null;
  approxMonth: number | null;
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
  revisions: AdminRevisionView[];
  emails: Array<{ emailType: string; status: string; sentAt: Date | null; attempts: number; createdAt: Date }>;
  /** Present only when asked for (`includeCoordinates`, the MCP tools); the admin page never sees it. */
  coordinates?: Coordinates | null;
}

export interface AdminRevisionView {
  id: string;
  changedVia: "WEB" | "SMS" | "CLAIM_LINK" | "ADMIN";
  before: unknown;
  after: unknown;
  createdAt: Date;
}

export interface AdminViewOptions {
  /** Add the memory's coordinates to the view and keep them in revision snapshots. Off for the admin page. */
  includeCoordinates?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A revision snapshot without its `coordinates` key; `stripped` says whether there was one. */
function withoutCoordinates(snapshot: unknown): { value: unknown; stripped: boolean } {
  if (!isPlainObject(snapshot) || !Object.hasOwn(snapshot, "coordinates")) {
    return { value: snapshot, stripped: false };
  }
  const { coordinates: _coordinates, ...rest } = snapshot;
  return { value: rest, stripped: true };
}

function isEmptyObject(value: unknown): boolean {
  return isPlainObject(value) && Object.keys(value).length === 0;
}

/**
 * Coordinates are set through /api/mcp and the admin draft API and read only
 * through /api/mcp (plan 2026-11-06 §4.2), so
 * the admin page's History must not show them: `app/admin/history.tsx` renders
 * every key a revision touched. Remove the key from both snapshots, and drop a
 * revision that held nothing else (a `set_coordinates` write). A revision that
 * was empty before stripping is left as it was. Stripping runs after the
 * `take`, so the History may show fewer rows (accepted, plan §5.6 and §8.3).
 */
function revisionsWithoutCoordinates(revisions: AdminRevisionView[]): AdminRevisionView[] {
  const kept: AdminRevisionView[] = [];
  for (const revision of revisions) {
    const before = withoutCoordinates(revision.before);
    const after = withoutCoordinates(revision.after);
    if ((before.stripped || after.stripped) && isEmptyObject(before.value) && isEmptyObject(after.value)) {
      continue;
    }
    kept.push({ ...revision, before: before.value, after: after.value });
  }
  return kept;
}

/**
 * One memory for the admin detail page, deleted or not (the page decides what
 * to offer). Never includes `claimTokenHash`, `blobUrl`, `storageKey` or `exif`
 * (plan §4.1): the view is serialised to the browser. The MCP `get_memory` tool
 * passes `includeCoordinates`; without it the view carries no coordinates at
 * all: not the memory's, not a photo's, not inside revisions.
 */
export async function getMemoryForAdmin(id: string, options: AdminViewOptions = {}): Promise<AdminMemoryView | null> {
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
          latitude: true,
          longitude: true,
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
  const revisions: AdminRevisionView[] = memory.revisions.map((r) => ({ id: r.id, changedVia: r.changedVia, before: r.before, after: r.after, createdAt: r.createdAt }));
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
    tags: memory.tags,
    approxYear: memory.approxYear,
    approxMonth: memory.approxMonth,
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
      ...(options.includeCoordinates && { coordinates: coordinatesOf(m) }),
    })),
    revisions: options.includeCoordinates ? revisions : revisionsWithoutCoordinates(revisions),
    emails: memory.emails.map((e) => ({ emailType: e.emailType, status: e.status, sentAt: e.sentAt, attempts: e.attempts, createdAt: e.createdAt })),
    ...(options.includeCoordinates && { coordinates: coordinatesOf(memory) }),
  };
}
