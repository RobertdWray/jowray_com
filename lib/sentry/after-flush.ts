import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";

import { logger } from "@/lib/logger";

/**
 * Runs `callback` in `after()` (post-response) and flushes Sentry (up to 5 s)
 * before the function is allowed to freeze, so events captured in the
 * callback are delivered.
 *
 * EmpathIQ's version also stripped an OpenTelemetry suppress-tracing flag
 * that Sentry 10's transport leaked into `after()`. Sentry 11 suppresses
 * tracing on its own scope instead and never sets that OTel key, so the
 * wrapper was removed here (review finding, 2026-11-03).
 */
export function afterWithFlush(callback: () => Promise<void>): void {
  after(async () => {
    try {
      await callback();
    } finally {
      const flushed = await Sentry.flush(5000);
      if (!flushed) {
        logger.warn({ category: "api", action: "sentry_flush_timeout" }, "Sentry flush timed out; events may have been lost");
      }
    }
  });
}
