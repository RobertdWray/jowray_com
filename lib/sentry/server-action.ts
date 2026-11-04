import "server-only";

import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";

import { scrubSecrets } from "@/lib/sentry/scrub";

/**
 * Wraps a Server Function so it shows up in traces as `serverAction/<name>`,
 * linked to the browser's trace, with its JSON input as the scrubbed
 * `server_action_input` context and its result recorded by the SDK as
 * `extra.server_action_result` (scrubbed again by `scrubEvent` before it
 * leaves). Server Actions are not instrumented automatically (plan
 * 2026-11-04 §8.5, [C3][C4]). The caller still receives the unscrubbed result.
 */
export async function instrumentedAction<T>(name: string, input: unknown, run: () => Promise<T>): Promise<T> {
  Sentry.setContext("server_action_input", scrubSecrets(input) as Record<string, unknown>);
  return Sentry.withServerActionInstrumentation(name, { headers: await headers(), recordResponse: true }, run);
}
