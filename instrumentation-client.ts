import * as Sentry from "@sentry/nextjs";

import { DATA_COLLECTION } from "@/lib/sentry/data-collection";
import { REPLAY_OPTIONS } from "@/lib/sentry/replay-options";
import { scrubBreadcrumb, scrubEvent, scrubLog, scrubRecordingEvent, scrubReplayEvent, scrubSpan } from "@/lib/sentry/scrub";
import { THIRD_PARTY_FILTER_OPTIONS } from "@/lib/sentry/third-party-filter";

/**
 * Browser init for the family alpha: every trace, every session replayed and
 * unmasked, browser profiles, the "Report a problem" button, console
 * warnings as logs. Same data policy as the server
 * (lib/sentry/data-collection.ts). Plan: docs/plans/2026-11-04-sentry-full-telemetry.md.
 *
 * Rob, 2026-11-04, verbatim:
 *
 * > I have deliberately authorized and pushed for 100 % tracking and error
 * > data collection. The family has approved these aggressive tracking
 * > measures since it is an alpha, vibe-coded website and only family will
 * > be using it. Intensive logging to rapidly fix errors is more important
 * > than security and privacy.
 *
 * Bearer secrets still never leave the browser: `scrub*` runs on every event,
 * span, log and breadcrumb, on the replay's URL list and on every replay
 * custom event (network bodies, console). Two residuals Rob accepted on
 * 2026-11-04 (extended by R5, 2026-11-07): `/m/<token>` and `/s/<token>`
 * page URLs inside replay DOM recordings (rrweb's meta event, which no hook
 * scrubs) and user-taken feedback screenshots. Text, inputs and media are
 * unmasked, including placeholders and title/aria-label attributes (R12, D20).
 * The SDK still masks password inputs. The values for after the alpha are in plan §13.
 *
 * Everything here is synchronous top-level code, as the Next.js convention
 * requires; the 16 ms dev-init warning is expected with these integrations.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 1.0,
  // Browser profiles ride on sampled root spans (Chromium only); the server sends Document-Policy: js-profiling.
  profileSessionSampleRate: 1.0,
  profileLifecycle: "trace",
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,
  normalizeDepth: 6,
  dataCollection: DATA_COLLECTION,
  integrations: [
    Sentry.replayIntegration({
      ...REPLAY_OPTIONS,
      // Same-origin only: Server Function and media requests, never the Blob uploads.
      networkDetailAllowUrls: [window.location.origin],
      beforeAddRecordingEvent: scrubRecordingEvent,
    }),
    Sentry.feedbackIntegration({
      colorScheme: "system",
      showBranding: false,
      triggerLabel: "Report a problem",
      formTitle: "Report a problem",
      submitButtonLabel: "Send",
      messagePlaceholder: "What happened? What did you expect?",
      successMessageText: "Thank you. Rob will take a look.",
      isEmailRequired: false,
      tags: { surface: "feedback-widget" },
      // Screenshots stay on (the SDK default); Rob accepted that residual.
    }),
    Sentry.browserProfilingIntegration(),
    // Tagged, never dropped (Rob, 2026-11-04). Only errors with no frame from our bundles are tagged, so the issue
    // alert can skip them (extensions, in-app browser scripts) without silencing our own bugs.
    Sentry.thirdPartyErrorFilterIntegration(THIRD_PARTY_FILTER_OPTIONS),
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],
  beforeSend: (event) => scrubEvent(event),
  // v11 streams spans: beforeSendTransaction is ignored, beforeSendSpan runs per span.
  beforeSendSpan: (span) => scrubSpan(span),
  beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  beforeSendLog: (log) => scrubLog(log),
});
// `beforeSend` never sees replay events; this keeps claim and invite tokens out of the replay's URL list.
Sentry.addEventProcessor(scrubReplayEvent);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
