import type { Coordinates } from "@/lib/validations/memory";

/**
 * The browser's scheduling for place suggestions on /share (plan 2026-11-06-photo-gps-places B6, review fix round 1).
 * Pure: no React and no DOM, so `app/share/use-place-suggestions.ts` stays a thin adapter and this is unit-tested.
 */

export interface TaskLimiter {
  /**
   * Queues `task`. `stillWanted` is asked just before the task's turn, not now: false skips it, so a photo removed
   * while its work waited costs no file read and no request.
   */
  push(task: () => Promise<void>, stillWanted?: () => boolean): void;
}

/**
 * Runs queued tasks first in, first out, at most `concurrency` at once. A task that rejects or throws goes to
 * `onError` and frees its slot like any other, so nothing is left as an unhandled rejection.
 */
export function createTaskLimiter(concurrency: number, onError: (error: unknown) => void): TaskLimiter {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`);
  }
  const queue: Array<{ task: () => Promise<void>; stillWanted: () => boolean }> = [];
  let running = 0;

  const pump = (): void => {
    while (running < concurrency && queue.length > 0) {
      const { task, stillWanted } = queue.shift()!;
      if (!stillWanted()) {
        continue;
      }
      running += 1;
      let run: Promise<void>;
      try {
        run = task();
      } catch (error) {
        run = Promise.reject(error);
      }
      void run.catch(onError).finally(() => {
        running -= 1;
        pump();
      });
    }
  };

  return {
    push(task, stillWanted = () => true) {
      queue.push({ task, stillWanted });
      pump();
    },
  };
}

/** A point's key in degrees × 1e6, rounded: the precision the server's lookup cache keys on. */
export function pointKey(point: Coordinates): string {
  return `${Math.round(point.latitude * 1e6)},${Math.round(point.longitude * 1e6)}`;
}

/**
 * One request per point at a time. Asks for a point whose request is in flight share it, and an answer is kept for
 * the page, so a second photo taken at the same spot costs no request (and no lookup budget). A null answer (a
 * refusal, busy, a network failure) and a rejection are not kept: the next ask for that point, such as the person
 * removing the photo and adding it again, sends a new request.
 */
export function sharePerPoint<T>(request: (point: Coordinates) => Promise<T | null>): (point: Coordinates) => Promise<T | null> {
  const byPoint = new Map<string, Promise<T | null>>();
  return (point) => {
    const key = pointKey(point);
    const known = byPoint.get(key);
    if (known) {
      return known;
    }
    const pending = request(point).then(
      (answer) => {
        if (answer === null) {
          byPoint.delete(key);
        }
        return answer;
      },
      (error: unknown) => {
        byPoint.delete(key);
        throw error;
      },
    );
    byPoint.set(key, pending);
    return pending;
  };
}

/**
 * One photo's lookup as a queued task: the photo is always settled, with the labels or, when the lookup throws, with
 * null (no suggestions, so it stops showing "Looking up…"), and only then does the error go on, so the limiter's
 * `onError` still reports it.
 */
export async function settleLookup(lookup: () => Promise<string[] | null>, onSettled: (labels: string[] | null) => void): Promise<void> {
  let labels: string[] | null;
  try {
    labels = await lookup();
  } catch (error) {
    onSettled(null);
    throw error;
  }
  onSettled(labels);
}

