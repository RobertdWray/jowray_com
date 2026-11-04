import * as Sentry from "@sentry/nextjs";

import { DATA_COLLECTION } from "@/lib/sentry/data-collection";
import { scrubBreadcrumb, scrubEvent, scrubLog, scrubSpan } from "@/lib/sentry/scrub";

// Browser init with the same data policy as the server (lib/sentry/data-collection.ts
// carries Rob's authorization): page-load transactions, breadcrumbs and errors
// on /m/<token> would otherwise carry the claim token. Replay, feedback and
// profiling arrive with plan 2026-11-04 PR 3.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  // Alpha: every trace (plan 2026-11-04 §8.4); §13 holds the values for after the alpha.
  tracesSampleRate: 1.0,
  normalizeDepth: 6,
  dataCollection: DATA_COLLECTION,
  // console.warn / console.error (the two levels ESLint allows) become Sentry Logs.
  integrations: [Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] })],
  beforeSend: (event) => scrubEvent(event),
  // v11 streams spans: beforeSendTransaction is ignored, beforeSendSpan runs per span.
  beforeSendSpan: (span) => scrubSpan(span),
  beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  beforeSendLog: (log) => scrubLog(log),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
