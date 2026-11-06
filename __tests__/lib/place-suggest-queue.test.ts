/**
 * lib/places/suggest-queue.ts (plan 2026-11-06-photo-gps-places B6, review fix round 1): the browser's scheduling for
 * place suggestions on /share, pure (no React, no DOM). A limiter runs queued work first in, first out, a few at a
 * time, and skips work whose photo is gone by its turn; a per-point share sends one request per point while it is in
 * flight, keeps answers, and forgets "no answer" so a later ask tries again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTaskLimiter, pointKey, settleLookup, sharePerPoint } from "@/lib/places/suggest-queue";

const LIBERTY = { latitude: 40.689247, longitude: -74.044502 };
const BOLOGNA = { latitude: 44.50155, longitude: 11.33989 };

/** A promise with its resolve and reject in hand. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every queued promise callback run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

let unhandled: ReturnType<typeof vi.fn<(reason: unknown) => void>>;
beforeEach(() => {
  unhandled = vi.fn<(reason: unknown) => void>();
  process.on("unhandledRejection", unhandled);
});
afterEach(() => {
  process.off("unhandledRejection", unhandled);
});

describe("createTaskLimiter", () => {
  it("runs at most `concurrency` tasks at once; each finished task lets the next one start", async () => {
    const limiter = createTaskLimiter(2, vi.fn());
    const gates = Array.from({ length: 5 }, () => deferred());
    let running = 0;
    let most = 0;
    const started: number[] = [];
    gates.forEach((gate, index) =>
      limiter.push(async () => {
        started.push(index);
        running += 1;
        most = Math.max(most, running);
        await gate.promise;
        running -= 1;
      }),
    );
    expect(started).toEqual([0, 1]);
    gates[1]!.resolve();
    await settle();
    expect(started).toEqual([0, 1, 2]);
    gates[0]!.resolve();
    gates[2]!.resolve();
    await settle();
    expect(started).toEqual([0, 1, 2, 3, 4]);
    gates[3]!.resolve();
    gates[4]!.resolve();
    await settle();
    expect(most).toBe(2);
    expect(running).toBe(0);
  });

  it("starts tasks first in, first out, including tasks pushed while others run", async () => {
    const limiter = createTaskLimiter(1, vi.fn());
    const order: string[] = [];
    const gate = deferred();
    limiter.push(async () => {
      order.push("a");
      await gate.promise;
    });
    limiter.push(async () => {
      order.push("b");
    });
    limiter.push(async () => {
      order.push("c");
    });
    expect(order).toEqual(["a"]);
    gate.resolve();
    await settle();
    limiter.push(async () => {
      order.push("d");
    });
    await settle();
    expect(order).toEqual(["a", "b", "c", "d"]);
  });

  it("asks stillWanted just before a task's turn, not when it is pushed: a task whose photo is gone by then never runs", async () => {
    const limiter = createTaskLimiter(1, vi.fn());
    const gate = deferred();
    const removed = new Set<string>();
    const ran: string[] = [];
    limiter.push(async () => {
      ran.push("first");
      await gate.promise;
    });
    for (const id of ["gone", "kept"]) {
      limiter.push(
        async () => {
          ran.push(id);
        },
        () => !removed.has(id),
      );
    }
    removed.add("gone"); // removed while it waited
    gate.resolve();
    await settle();
    expect(ran).toEqual(["first", "kept"]);
  });

  it("a skipped task does not hold a slot: the next task starts in its place at once", async () => {
    const limiter = createTaskLimiter(1, vi.fn());
    const ran: string[] = [];
    limiter.push(
      async () => {
        ran.push("gone");
      },
      () => false,
    );
    limiter.push(async () => {
      ran.push("next");
    });
    expect(ran).toEqual(["next"]);
  });

  it("a task that rejects or throws goes to onError, frees its slot and leaves no unhandled rejection", async () => {
    const onError = vi.fn();
    const limiter = createTaskLimiter(1, onError);
    const rejected = new Error("rejected");
    const thrown = new Error("thrown");
    const ran: string[] = [];
    limiter.push(async () => {
      throw rejected;
    });
    limiter.push(() => {
      throw thrown;
    });
    limiter.push(async () => {
      ran.push("after");
    });
    await settle();
    expect(onError.mock.calls).toEqual([[rejected], [thrown]]);
    expect(ran).toEqual(["after"]);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("refuses a concurrency below 1 (nothing would ever run)", () => {
    expect(() => createTaskLimiter(0, vi.fn())).toThrow(RangeError);
  });
});

describe("pointKey", () => {
  it("is the point in degrees × 1e6, rounded, as the server's cache keys it", () => {
    expect(pointKey(LIBERTY)).toBe("40689247,-74044502");
    expect(pointKey({ latitude: 40.6892472, longitude: -74.0445021 })).toBe("40689247,-74044502");
  });
});

describe("sharePerPoint", () => {
  it("asks for the same point (to 1e-6 degree) while a request is in flight share it: one request", async () => {
    const answer = deferred<string[] | null>();
    const request = vi.fn(() => answer.promise);
    const labelsFor = sharePerPoint(request);
    const first = labelsFor(LIBERTY);
    const second = labelsFor({ latitude: 40.6892472, longitude: -74.0445021 });
    answer.resolve(["New York, New York"]);
    expect(await Promise.all([first, second])).toEqual([["New York, New York"], ["New York, New York"]]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps an answer for the page: a later photo at the same point costs no request; another point asks its own", async () => {
    const request = vi.fn(async (point: typeof LIBERTY) => (point === BOLOGNA ? ["Bologna, Emilia-Romagna"] : []));
    const labelsFor = sharePerPoint(request);
    expect(await labelsFor(LIBERTY)).toEqual([]);
    expect(await labelsFor(LIBERTY)).toEqual([]);
    expect(await labelsFor(BOLOGNA)).toEqual(["Bologna, Emilia-Romagna"]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not keep a null answer: asks during the request share it, the first ask after it sends a new request", async () => {
    const answer = deferred<string[] | null>();
    const request = vi.fn().mockReturnValueOnce(answer.promise).mockResolvedValueOnce(["New York, New York"]);
    const labelsFor = sharePerPoint<string[]>(request);
    const first = labelsFor(LIBERTY);
    const during = labelsFor(LIBERTY);
    answer.resolve(null);
    expect(await first).toBeNull();
    expect(await during).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(await labelsFor(LIBERTY)).toEqual(["New York, New York"]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not keep a rejection: the callers see it, the next ask tries again, and nothing is left unhandled", async () => {
    const failure = new Error("offline");
    const request = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(["New York, New York"]);
    const labelsFor = sharePerPoint<string[]>(request);
    await expect(labelsFor(LIBERTY)).rejects.toBe(failure);
    expect(await labelsFor(LIBERTY)).toEqual(["New York, New York"]);
    expect(request).toHaveBeenCalledTimes(2);
    await settle();
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("settleLookup (final review, item 6)", () => {
  it("settles the photo with the labels the lookup answered", async () => {
    const onSettled = vi.fn();
    await settleLookup(async () => ["New York, New York"], onSettled);
    expect(onSettled.mock.calls).toEqual([[["New York, New York"]]]);
  });

  it("a lookup that throws still settles the photo (no suggestions), then the error goes on to the limiter's onError", async () => {
    const failure = new Error("reportClientError threw");
    const onSettled = vi.fn();
    const onError = vi.fn();
    const limiter = createTaskLimiter(1, onError);
    limiter.push(() =>
      settleLookup(async () => {
        throw failure;
      }, onSettled),
    );
    await settle();
    expect(onSettled.mock.calls).toEqual([[null]]);
    expect(onError.mock.calls).toEqual([[failure]]);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
