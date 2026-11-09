import type { Event, thirdPartyErrorFilterIntegration } from "@sentry/nextjs";

/**
 * Options for the browser's third-party error filter (instrumentation-client.ts). Plan:
 * docs/plans/2026-11-08-third-party-alerts.md.
 *
 * Tagged, never dropped (Rob, 2026-11-04): every error still reaches Sentry. The SDK tags an event
 * `third_party_code: True` only when none of its stack frames comes from a file our build marked with the
 * `jowray_com` application key (next.config.ts). That is code we did not ship: browser extensions and the scripts
 * that in-app browsers inject into the page. Example: JOWRAY_COM-D (2026-11-08), Facebook's iPhone browser failing
 * on `window.webkit.messageHandlers`, the bridge to its own app. An error with even one of our frames is never
 * tagged, so the production issue alert can skip tagged new issues without silencing our bugs. Hide them in the
 * issue stream with `!third_party_code:True`. `untagErrorsWithoutLocatedFrames` (below) covers the one case where
 * the SDK tags an error without evidence.
 *
 * `ignoreSentryInternalFrames` stays off: the SDK warns that it can mistake an application frame for its own
 * wrapper frame, which here would tag one of our errors.
 *
 * scripts/check-sentry-app-key.ts fails the build if the chunk holding these options loses the application key.
 */
export const THIRD_PARTY_FILTER_OPTIONS = {
  filterKeys: ["jowray_com"],
  behaviour: "apply-tag-if-exclusively-contains-third-party-frames",
} satisfies Parameters<typeof thirdPartyErrorFilterIntegration>[0];

/**
 * The SDK judges only frames with a filename and a line, column or instruction address, then tags when every one of
 * them lacks our key. A stack of browser built-ins alone leaves nothing to judge, and "every" over nothing is true:
 * an unhandled `fetch(u).then((r) => r.text()).then(JSON.parse)` rejection, whose stack is only
 * `at JSON.parse (<anonymous>)` in Chrome or `parse@[native code]` in Safari, gets tagged although nothing says
 * the code is not ours. This removes the tag from such events so they still alert (PR #100 review, finding 1).
 *
 * It runs in `beforeSend`, which Sentry guarantees runs after every event processor, so after the integration.
 */
export function untagErrorsWithoutLocatedFrames<E extends Event>(event: E): E {
  if (event.tags?.third_party_code !== true) {
    return event;
  }
  const frames = event.exception?.values?.flatMap((value) => value.stacktrace?.frames ?? []) ?? [];
  const located = frames.some(
    (frame) =>
      Boolean(frame.filename) &&
      (typeof frame.lineno === "number" || typeof frame.colno === "number" || typeof frame.instruction_addr === "string"),
  );
  if (located) {
    return event;
  }
  const tags = { ...event.tags };
  delete tags.third_party_code;
  return { ...event, tags };
}
