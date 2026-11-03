import * as Sentry from "@sentry/nextjs";

import { DATA_COLLECTION } from "@/lib/sentry/data-collection";
import { scrubBreadcrumb, scrubEvent, scrubLog, scrubSpan } from "@/lib/sentry/scrub";

// Browser init with the same data controls as the server: page-load
// transactions, breadcrumbs and errors on /m/<token> would otherwise carry
// the claim token. No Session Replay.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  dataCollection: DATA_COLLECTION,
  beforeSend: (event) => scrubEvent(event),
  // v11 streams spans: beforeSendTransaction is ignored, beforeSendSpan runs per span.
  beforeSendSpan: (span) => scrubSpan(span),
  beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  beforeSendLog: (log) => scrubLog(log),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
