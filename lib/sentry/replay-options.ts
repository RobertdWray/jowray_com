import type { replayIntegration } from "@sentry/nextjs";

/**
 * R12, D20 (2026-11-07): record form placeholders and title/aria-label too.
 * Replay 11.11.0 defaults maskAttributes to ["title", "placeholder", "aria-label"]
 * and masks them even with maskAllText: false. Runtime callbacks/URLs stay in the init.
 */
export const REPLAY_OPTIONS = {
  maskAllText: false,
  maskAllInputs: false,
  blockAllMedia: false,
  maskAttributes: [],
  networkCaptureBodies: true,
} satisfies NonNullable<Parameters<typeof replayIntegration>[0]>;
