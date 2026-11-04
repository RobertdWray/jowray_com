import * as Sentry from "@sentry/nextjs";

/**
 * Identity contract (plan 2026-11-04 §2, §8.1): `user.email` is the key,
 * `user.username` the name, `user.id` the contributor id when known. Memory,
 * media and submission ids are tags, never `user.id`. Browser and server:
 * on the server `setUser` applies to the current request; in the browser to
 * the page session. Rob's authorization for collecting the contributor's
 * email and name: lib/sentry/data-collection.ts.
 */
export interface ContributorIdentity {
  id?: string | null;
  email?: string | null;
  name?: string | null;
}

/** Sets the Sentry user from a contributor; without an email nothing is set (ruling 6). */
export function identifyContributor(contributor: ContributorIdentity): void {
  if (!contributor.email) {
    return;
  }
  Sentry.setUser({
    email: contributor.email,
    ...(contributor.name ? { username: contributor.name } : {}),
    ...(contributor.id ? { id: contributor.id } : {}),
  });
}

export function clearContributor(): void {
  Sentry.setUser(null);
}

export interface TaggableIds {
  memoryId?: string | null;
  mediaId?: string | null;
  submissionId?: string | null;
}

/** Searchable ids on the current scope: `memory_id`, `media_id`, `submission_id`. */
export function tagIds(ids: TaggableIds): void {
  if (ids.memoryId) {
    Sentry.setTag("memory_id", ids.memoryId);
  }
  if (ids.mediaId) {
    Sentry.setTag("media_id", ids.mediaId);
  }
  if (ids.submissionId) {
    Sentry.setTag("submission_id", ids.submissionId);
  }
}
