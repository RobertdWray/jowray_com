import "server-only";

import { randomUUID } from "node:crypto";

import { derivedPrefix } from "@/lib/site-url";

/**
 * Key scheme for server-made copies (shared with the email plan § 3.1).
 *
 * Invariant D2: final derived keys (`*.<ext>` under the derived prefix) are
 * written only by the server from bytes it decoded and re-encoded; staging
 * keys (`*.upload.jpg`) hold untrusted browser bytes and are never attached to
 * an email or served. Two distinct keys because a blob pathname cannot be
 * overwritten.
 */

const STAGING_SUFFIX = ".upload.jpg";

/** `<memoryId>/<uuid>` from an original's key `<env prefix><memoryId>/<uuid>.<ext>`. */
function originalStem(storageKey: string): { memoryId: string; uuid: string } {
  const segments = storageKey.split("/");
  const filename = segments.at(-1) ?? "";
  const memoryId = segments.at(-2) ?? "";
  const uuid = filename.split(".")[0] ?? "";
  if (!memoryId || !uuid) {
    throw new Error("storageKey is not <prefix><memoryId>/<uuid>.<ext>");
  }
  return { memoryId, uuid };
}

/** A fresh, write-once pathname for a derived copy of the original at `storageKey`. */
export function derivedKeyFor(storageKey: string, extension: string): string {
  const { memoryId } = originalStem(storageKey);
  return `${derivedPrefix()}${memoryId}/${randomUUID()}.${extension}`;
}

/** The one pathname a browser may stage a video poster to, derived from the original's key. */
export function posterStagingKeyFor(storageKey: string): string {
  const { memoryId, uuid } = originalStem(storageKey);
  return `${derivedPrefix()}${memoryId}/${uuid}${STAGING_SUFFIX}`;
}

export function isStagingKey(key: string): boolean {
  return key.endsWith(STAGING_SUFFIX);
}
