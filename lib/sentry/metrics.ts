import * as Sentry from "@sentry/nextjs";

/**
 * Thin wrappers over `Sentry.metrics.*` (plan 2026-11-04 §8.7). No setup
 * beyond the SDK init; `user.*` attributes attach automatically once the
 * contributor is identified.
 */

/** A send created N memories. */
export function memoryCreated(count: number): void {
  Sentry.metrics.count("memory.created", count);
}

/** One upload finalized with the row's resulting status. */
export function uploadFinalized(status: string): void {
  Sentry.metrics.count("upload.finalized", 1, { attributes: { status } });
}

/** One confirmation attempt: `sent`, or the skip reason. */
export function confirmationSent(outcome: string): void {
  Sentry.metrics.count("confirmation.sent", 1, { attributes: { outcome } });
}

/** One reconcile run: how long it took and how many items failed. */
export function reconcileRun(durationMs: number, errors: number): void {
  Sentry.metrics.distribution("reconcile.run", durationMs, { unit: "millisecond", attributes: { errors } });
}
