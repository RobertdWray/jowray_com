import type { httpIntegration } from "@sentry/nextjs";

import { FRAME_SERVER_PREFIX } from "@/lib/video-frames";

/**
 * The server init's Http integration (video-posters plan, Task 4, [C25]).
 *
 * - `disableIncomingRequestSpans: true` is what @sentry/nextjs 11.11 sets on the Http integration it adds by
 *   default (`build/cjs/server/index.js`: "Next.js does that by itself"). An Http integration in `integrations`
 *   replaces that default, so leaving the option out would give every incoming request a second, `http.server`
 *   span (`__tests__/lib/sentry-http-options.test.ts` shows it).
 * - `ignoreIncomingRequests` keeps the poster frame server's loopback requests (ffmpeg's Range requests to
 *   `/__frames/<nonce>`) span-free even if incoming request spans are ever turned on. In 11.11 the callback only
 *   gates span creation (`httpServerSpansIntegration`), which the option above already disables.
 */
export const SERVER_HTTP_OPTIONS = {
  disableIncomingRequestSpans: true,
  ignoreIncomingRequests: (urlPath: string) => urlPath.startsWith(FRAME_SERVER_PREFIX),
} satisfies NonNullable<Parameters<typeof httpIntegration>[0]>;
