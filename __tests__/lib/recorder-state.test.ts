import { describe, expect, it } from "vitest";

import { IDLE, reduceRecorder, type RecorderEvent, type RecorderStatus } from "@/lib/recorder-state";

const requesting: RecorderStatus = Object.freeze({ kind: "requesting" });
const recording: RecorderStatus = Object.freeze({
  kind: "recording", startedAt: 500, hearing: "unknown", elapsedSeconds: 0, interrupted: false,
});
const finishing: RecorderStatus = Object.freeze({ kind: "finishing" });
const clip: RecorderStatus = Object.freeze({
  kind: "clip", durationMs: 1250, verdict: "heard", partial: false,
});
const error: RecorderStatus = Object.freeze({ kind: "error", problem: "not-allowed" });

describe("reduceRecorder", () => {
  it("starts from idle", () => {
    expect(reduceRecorder(IDLE, { type: "start" })).toStrictEqual({ kind: "requesting" });
  });

  it("starts a new recording from a clip", () => {
    expect(reduceRecorder(clip, { type: "start" })).toStrictEqual({ kind: "requesting" });
  });

  it("retries after an error", () => {
    expect(reduceRecorder(error, { type: "start" })).toStrictEqual({ kind: "requesting" });
  });

  it("begins recording at the grant time with no audio judgement", () => {
    expect(reduceRecorder(requesting, { type: "granted", now: 500 })).toStrictEqual({
      kind: "recording", startedAt: 500, hearing: "unknown", elapsedSeconds: 0, interrupted: false,
    });
  });

  it("reports failure while requesting permission", () => {
    expect(reduceRecorder(requesting, { type: "failed", problem: "not-found" }))
      .toStrictEqual({ kind: "error", problem: "not-found" });
  });

  it("updates the hearing verdict without changing recording time", () => {
    expect(reduceRecorder(recording, { type: "hearing", hearing: "hearing" }))
      .toStrictEqual({ ...recording, hearing: "hearing" });
  });

  it("updates elapsed whole seconds from the clock without needing audio samples", () => {
    expect(reduceRecorder(recording, { type: "tick", now: 3499 }))
      .toStrictEqual({ ...recording, elapsedSeconds: 2 });
  });

  it("marks recording as interrupted", () => {
    expect(reduceRecorder(recording, { type: "interrupted" }))
      .toStrictEqual({ ...recording, interrupted: true });
  });

  it("resumes an interrupted recording", () => {
    expect(reduceRecorder({ ...recording, interrupted: true }, { type: "resumed" }))
      .toStrictEqual(recording);
  });

  it("finishes after a user stop", () => {
    expect(reduceRecorder(recording, { type: "stop" })).toStrictEqual({ kind: "finishing" });
  });

  it("finishes when the track ends without a user stop", () => {
    expect(reduceRecorder(recording, { type: "ended" })).toStrictEqual({ kind: "finishing" });
  });

  it("reports failure while recording", () => {
    expect(reduceRecorder(recording, { type: "failed", problem: "not-readable" }))
      .toStrictEqual({ kind: "error", problem: "not-readable" });
  });

  it("reports failure while finishing", () => {
    expect(reduceRecorder(finishing, { type: "failed", problem: "unknown" }))
      .toStrictEqual({ kind: "error", problem: "unknown" });
  });

  it("retains duration, verdict and partial flag when finishing a clip", () => {
    expect(reduceRecorder(finishing, {
      type: "finished", durationMs: 401, verdict: "suspectedSilent", partial: true,
    })).toStrictEqual({ kind: "clip", durationMs: 401, verdict: "suspectedSilent", partial: true });
  });

  it("keeps an unchecked clip after the track ends", () => {
    const stopped = reduceRecorder(recording, { type: "ended" });
    expect(reduceRecorder(stopped, {
      type: "finished", durationMs: 1400, verdict: "unchecked", partial: false,
    })).toStrictEqual({ kind: "clip", durationMs: 1400, verdict: "unchecked", partial: false });
  });

  it("returns the shared idle instance when a clip is discarded", () => {
    expect(reduceRecorder(clip, { type: "discard" })).toBe(IDLE);
  });

  it.each([requesting, recording, finishing])("cancels $kind to the shared idle instance", (state) => {
    expect(reduceRecorder(state, { type: "cancel" })).toBe(IDLE);
  });

  it.each([requesting, recording, finishing])("ignores a second start during $kind", (state) => {
    expect(reduceRecorder(state, { type: "start" })).toBe(state);
  });

  it("ignores stop while idle", () => {
    expect(reduceRecorder(IDLE, { type: "stop" })).toBe(IDLE);
  });

  it("returns the same reference for a tick within the same second", () => {
    expect(reduceRecorder(recording, { type: "tick", now: 1499 })).toBe(recording);
  });

  it("returns the same reference when hearing has not changed", () => {
    expect(reduceRecorder(recording, { type: "hearing", hearing: "unknown" })).toBe(recording);
  });

  it("returns the same reference when already interrupted", () => {
    const interrupted: RecorderStatus = { ...recording, interrupted: true };
    expect(reduceRecorder(interrupted, { type: "interrupted" })).toBe(interrupted);
  });

  it("returns the same reference when already resumed", () => {
    expect(reduceRecorder(recording, { type: "resumed" })).toBe(recording);
  });

  const ignored: { state: RecorderStatus; event: RecorderEvent }[] = [
    { state: requesting, event: { type: "stop" } },
    { state: requesting, event: { type: "discard" } },
    { state: requesting, event: { type: "hearing", hearing: "hearing" } },
    { state: recording, event: { type: "granted", now: 5000 } },
    { state: recording, event: { type: "finished", durationMs: 1000, verdict: "heard", partial: false } },
    { state: finishing, event: { type: "ended" } },
    { state: finishing, event: { type: "stop" } },
    { state: finishing, event: { type: "tick", now: 5000 } },
    { state: clip, event: { type: "cancel" } },
    { state: clip, event: { type: "failed", problem: "unknown" } },
    { state: error, event: { type: "cancel" } },
    { state: error, event: { type: "discard" } },
  ];

  it.each(ignored)("ignores $event.type in $state.kind", ({ state, event }) => {
    expect(reduceRecorder(state, event)).toBe(state);
  });

  it("never mutates the previous snapshot", () => {
    const before = { ...recording };
    const after = reduceRecorder(recording, { type: "tick", now: 1500 });
    expect(after).not.toBe(recording);
    expect(recording).toStrictEqual(before);
  });

  it("freezes the single idle instance used by the server snapshot", () => {
    expect(Object.isFrozen(IDLE)).toBe(true);
    expect(IDLE).toStrictEqual({ kind: "idle" });
  });
});
