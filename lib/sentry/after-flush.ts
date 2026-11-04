import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";

import { logError, logger } from "@/lib/logger";

/**
 * Runs `callback` in `after()` (post-response) inside one `task` span named
 * `name`, and flushes Sentry (up to 5 s) before the function is allowed to
 * freeze, so events captured in the callback are delivered.
 *
 * The span keeps the deferred work (emails, alerts, hashing, derived copies)
 * in one trace instead of orphan `db` spans at 100 % tracing (plan
 * 2026-11-04 §8.9). The catch and the `finally` flush are as before.
 *
 * EmpathIQ's version also stripped an OpenTelemetry suppress-tracing flag
 * that Sentry 10's transport leaked into `after()`. Sentry 11 suppresses
 * tracing on its own scope instead and never sets that OTel key, so the
 * wrapper was removed here (review finding, 2026-11-03).
 */
export function afterWithFlush(name: string, callback: () => Promise<void>): void {
  after(async () => {
    try {
      await Sentry.startSpan({ name, op: "task" }, callback);
    } catch (error) {
      // Record it before the flush below; an uncaught rejection here would be lost.
      logError("after() callback failed", error, { category: "api", task: name });
    } finally {
      const flushed = await Sentry.flush(5000);
      if (!flushed) {
        logger.warn({ category: "api", action: "sentry_flush_timeout", task: name }, "Sentry flush timed out; events may have been lost");
      }
    }
  });
}
