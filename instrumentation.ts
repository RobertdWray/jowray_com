import * as Sentry from "@sentry/nextjs";

import { DATA_COLLECTION } from "@/lib/sentry/data-collection";
import { scrubBreadcrumb, scrubEvent, scrubLog, scrubSpan } from "@/lib/sentry/scrub";

// Server-side Sentry init runs here, inside register(), for the Node.js
// runtime only. Nothing runs on the deprecated Edge runtime.
// Data policy and Rob's authorization: lib/sentry/data-collection.ts.
export function register(): void {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      // Alpha: every trace (plan 2026-11-04 §8.4); §13 holds the values for after the alpha.
      tracesSampleRate: 1.0,
      // Server Function inputs and results nest four or five deep (cards → files); the SDK default of 3 would show "[Object]".
      normalizeDepth: 6,
      // Sentry Logs are on by default in SDK v11 (the v10 `enableLogs` option no longer exists).
      dataCollection: DATA_COLLECTION,
      // Every Pino level streams as a log; `fatal` lines also become issues.
      integrations: [Sentry.prismaIntegration(), Sentry.pinoIntegration({ error: { levels: ["fatal"] } })],
      beforeSend: (event) => scrubEvent(event),
      // v11 streams spans: beforeSendTransaction is ignored, beforeSendSpan runs per span.
      beforeSendSpan: (span) => scrubSpan(span),
      beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
      beforeSendLog: (log) => scrubLog(log),
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
