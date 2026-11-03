import { context } from "@opentelemetry/api";
import { unsuppressTracing } from "@opentelemetry/core";
import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";

import { logger } from "@/lib/logger";

/**
 * Runs `callback` in `after()` (post-response) with two guarantees:
 *
 * 1. Sentry is flushed (up to 5 s) before the function is allowed to freeze,
 *    so events captured in the callback are delivered.
 * 2. The inherited OpenTelemetry context has only its suppress-tracing flag
 *    removed. Sentry's transport sets that flag while it sends; `after()`
 *    inherits it through AsyncLocalStorage and would otherwise produce
 *    non-recording spans. Everything else in the context (Sentry's scope
 *    keys) is kept so `captureException` still finds the client.
 *
 * Ported from EmpathIQ `src/lib/sentry/after-flush.ts`.
 * @see https://github.com/getsentry/sentry-javascript/issues/18866
 */
export function afterWithFlush(callback: () => Promise<void>): void {
  after(async () => {
    await context.with(unsuppressTracing(context.active()), async () => {
      try {
        await callback();
      } finally {
        const flushed = await Sentry.flush(5000);
        if (!flushed) {
          logger.warn(
            { category: "api", action: "sentry_flush_timeout" },
            "Sentry flush timed out; events may have been lost"
          );
        }
      }
    });
  });
}
