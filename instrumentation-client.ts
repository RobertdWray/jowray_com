import * as Sentry from "@sentry/nextjs";

import { DATA_COLLECTION } from "@/lib/sentry/data-collection";
import { scrubBreadcrumb, scrubEvent } from "@/lib/sentry/scrub";

// Browser init with the same data controls as the server: page-load
// transactions, breadcrumbs and errors on /m/<token> would otherwise carry
// the claim token. No Session Replay.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  dataCollection: DATA_COLLECTION,
  beforeSend: (event) => scrubEvent(event),
  beforeSendTransaction: (event) => scrubEvent(event),
  beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
