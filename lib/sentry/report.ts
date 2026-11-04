import * as Sentry from "@sentry/nextjs";

import { scrubSecrets } from "@/lib/sentry/scrub";

export interface ClientErrorContext {
  /** Which UI the error happened in: `share-form`, `claim-form`, `media-list`, `recorder`, `share-draft`, `submission-pipeline`. */
  surface: string;
  /** What was being attempted: `create`, `upload`, `finalize`, `complete`, `stop`, `storage`, … */
  step: string;
  [key: string]: unknown;
}

/**
 * Reports an error the UI swallows on purpose (the user-facing message stays
 * the same) so it is still diagnosable from Sentry (plan 2026-11-04 §8.6).
 * `surface` and `step` become tags; everything else goes to `extra` after
 * the secret scrubber. Returns the event id.
 */
export function reportClientError(error: unknown, context: ClientErrorContext): string {
  const { surface, step, ...rest } = context;
  return Sentry.captureException(error, {
    tags: { surface, step },
    extra: scrubSecrets(rest) as Record<string, unknown>,
  });
}
