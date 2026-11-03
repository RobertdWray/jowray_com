import * as Sentry from "@sentry/nextjs";

import { DATA_COLLECTION } from "@/lib/sentry/data-collection";
import { scrubBreadcrumb, scrubEvent } from "@/lib/sentry/scrub";

// Server-side Sentry init runs here, inside register(), for the Node.js
// runtime only. Nothing runs on the deprecated Edge runtime.
export function register(): void {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      // Sentry Logs are on by default in SDK v11 (the v10 `enableLogs` option no longer exists).
      dataCollection: DATA_COLLECTION,
      integrations: [Sentry.prismaIntegration(), Sentry.pinoIntegration()],
      beforeSend: (event) => scrubEvent(event),
      beforeSendTransaction: (event) => scrubEvent(event),
      beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
