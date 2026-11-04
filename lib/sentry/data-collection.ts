import type * as Sentry from "@sentry/nextjs";

import { SECRET_FIELD_KEYS, SECRET_HEADER_KEYS, SECRET_KEY_FRAGMENTS } from "@/lib/sentry/secrets";

type DataCollection = NonNullable<NonNullable<Parameters<typeof Sentry.init>[0]>["dataCollection"]>;

/**
 * The alpha data policy (plan docs/plans/2026-11-04-sentry-full-telemetry.md
 * §2a, §3, §7.5), shared by the server and the browser init.
 *
 * Rob, 2026-11-04, verbatim:
 *
 * > I have deliberately authorized and pushed for 100 % tracking and error
 * > data collection. The family has approved these aggressive tracking
 * > measures since it is an alpha, vibe-coded website and only family will
 * > be using it. Intensive logging to rapidly fix errors is more important
 * > than security and privacy.
 *
 * Bearer secrets (claim tokens, upload tickets, Vercel bypass header) are
 * still scrubbed; see lib/sentry/scrub.ts and
 * docs/plans/2026-11-04-sentry-full-telemetry.md §3.
 *
 * This supersedes the Phase 1 policy (2026-11-02 plan, item S7: everything
 * off, Replay off). `__tests__/lib/sentry-envelope.test.ts` is the gate: the
 * real server SDK with this policy and the production hooks must send the
 * contributor's email and never a synthetic token.
 */
export const DATA_COLLECTION: DataCollection = {
  // user.email / user.username set by identifyContributor are wanted (ruling 1).
  userInfo: true,
  // The site sets no cookies.
  cookies: false,
  // `t=` is removed by scrubUrl before anything is sent.
  urlQueryParams: true,
  // Prisma bound parameters and result data.
  databaseQueryData: true,
  // Request bodies in; Server Function responses are *outgoing* responses
  // (the SDK records a Server Function result only with "outgoingResponse").
  httpBodies: ["incomingRequest", "outgoingResponse"],
  httpHeaders: { request: { deny: [...SECRET_HEADER_KEYS] }, response: true },
  genAI: { inputs: true, outputs: true },
  // Local variables in stack frames, minus anything named like a secret.
  stackFrameVariables: { deny: [...SECRET_FIELD_KEYS, ...SECRET_KEY_FRAGMENTS] },
};
