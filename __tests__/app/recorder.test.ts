import fixWebmDuration from "fix-webm-duration";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AudioRecorder, LEVEL_HISTORY, type Recording } from "@/app/share/recorder";
import { deferred, makeDeps } from "@/__tests__/stubs/browser-audio";

vi.mock("fix-webm-duration", () => ({ default: vi.fn(async (blob: Blob) => blob) }));

let engines: AudioRecorder[];

function setup(overrides: Parameters<typeof makeDeps>[0] = {}) {
  const fakes = makeDeps(overrides);
  const engine = new AudioRecorder(fakes.deps);
  engines.push(engine);
  return { ...fakes, engine };
}

function ticks(clock: { now: number }, count: number): void {
  for (let tick = 0; tick < count; tick += 1) {
    clock.now += 100;
    vi.advanceTimersByTime(100);
  }
}

function observeStatuses(engine: AudioRecorder): string[] {
  const statuses: string[] = [];
  let previous = engine.status;
  engine.subscribe(() => {
    // activeInput also publishes a snapshot, retaining the same status object.
    if (engine.status !== previous) {
      statuses.push(engine.status.kind);
      previous = engine.status;
    }
  });
  return statuses;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.mocked(fixWebmDuration).mockReset();
  vi.mocked(fixWebmDuration).mockImplementation(async (blob: Blob) => blob);
  engines = [];
});

afterEach(() => {
  engines.forEach((engine) => engine.cancel());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("AudioRecorder lifecycle", () => {
  it("start publishes requesting then recording and connects the analyser graph", async () => {
    const { engine, deps, context, recorder, stream, track } = setup();
    const statuses = observeStatuses(engine);

    const starting = engine.start({ deviceId: track.deviceId });
    expect(engine.status).toEqual({ kind: "requesting" });
    expect(context.resume).toHaveBeenCalledTimes(1);
    await starting;

    expect(statuses).toEqual(["requesting", "recording"]);
    expect(engine.getSnapshot().activeInput).toEqual({ label: track.label, deviceId: track.deviceId });
    expect(engine.isRecording).toBe(true);
    expect(context.state).toBe("running");
    expect(deps.getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: { deviceId: { exact: track.deviceId } } });
    expect(context.createMediaStreamSource).toHaveBeenCalledExactlyOnceWith(stream);
    expect(context.createAnalyser).toHaveBeenCalledTimes(1);
    expect(context.createGain).toHaveBeenCalledTimes(1);
    expect(context.source.connections).toEqual([context.analyser]);
    expect(context.analyser.connections).toEqual([context.gain]);
    expect(context.gain.connections).toEqual([context.destination]);
    expect(context.gain.gain.value).toBe(0);
    expect(context.analyser.fftSize).toBe(2048);
    expect(context.analyser.smoothingTimeConstant).toBe(0);
    expect(deps.createMediaRecorder).toHaveBeenCalledExactlyOnceWith(stream, { mimeType: recorder.mimeType });
    expect(recorder.start).toHaveBeenCalledExactlyOnceWith(1000);
  });

  it("rejects an unsupported browser without requesting the microphone", async () => {
    const { engine, deps } = setup({ isTypeSupported: () => false });

    await expect(engine.start()).rejects.toThrow("Recording is not supported");

    expect(engine.status).toEqual({ kind: "error", problem: "unsupported" });
    expect(deps.getUserMedia).not.toHaveBeenCalled();
    expect(deps.createAudioContext).not.toHaveBeenCalled();
    expect(deps.createMediaRecorder).not.toHaveBeenCalled();
  });

  it("reports permission denial and closes the context", async () => {
    const denied = new DOMException("denied", "NotAllowedError");
    const { engine, deps, context } = setup();
    deps.getUserMedia.mockRejectedValueOnce(denied);

    await expect(engine.start()).rejects.toBe(denied);

    expect(engine.status).toEqual({ kind: "error", problem: "not-allowed" });
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(context.state).toBe("closed");
    expect(deps.createMediaRecorder).not.toHaveBeenCalled();
  });

  it("falls back to the default microphone when the selected device vanishes", async () => {
    const { engine, deps } = setup();
    deps.getUserMedia.mockRejectedValueOnce(new DOMException("device vanished", "OverconstrainedError"));

    await engine.start({ deviceId: "x" });

    expect(deps.getUserMedia).toHaveBeenCalledTimes(2);
    expect(deps.getUserMedia).toHaveBeenNthCalledWith(1, { audio: { deviceId: { exact: "x" } } });
    expect(deps.getUserMedia).toHaveBeenNthCalledWith(2, { audio: true });
    expect(engine.status.kind).toBe("recording");
  });

  it("cancel before the permission prompt resolves stops the late stream", async () => {
    const { engine, deps, context, track, permission } = setup({ deferGetUserMedia: true });
    const starting = engine.start({});
    expect(engine.status.kind).toBe("requesting");
    expect(deps.getUserMedia).toHaveBeenCalledTimes(1);

    engine.cancel();
    expect(engine.status).toEqual({ kind: "idle" });
    expect(context.state).toBe("closed");
    expect(track.stop).not.toHaveBeenCalled();
    permission.resolve();
    await starting;

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(track.readyState).toBe("ended");
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(engine.status).toEqual({ kind: "idle" });
    expect(deps.createMediaRecorder).not.toHaveBeenCalled();
    expect(context.createMediaStreamSource).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("updates the hearing verdict, elapsed time, level history and level listeners", async () => {
    const { engine, context, clock } = setup();
    const onLevel = vi.fn();
    engine.onLevel(onLevel);
    await engine.start();

    context.analyser.level = 0;
    ticks(clock, 31);
    expect(engine.status).toMatchObject({ kind: "recording", hearing: "silent", elapsedSeconds: 3 });
    expect(onLevel).toHaveBeenCalledTimes(31);
    expect(onLevel.mock.calls.map(([dbfs]) => dbfs)).toEqual(Array(31).fill(-100));

    context.analyser.level = 0.5;
    ticks(clock, 1);
    expect(engine.status).toMatchObject({ kind: "recording", hearing: "hearing", elapsedSeconds: 3 });
    expect(onLevel).toHaveBeenCalledTimes(32);
    expect(onLevel.mock.lastCall?.[0]).toBeCloseTo(20 * Math.log10(0.5));
    const levels = new Float32Array(LEVEL_HISTORY);
    const head = engine.readLevels(levels);
    expect(head).toBe(32);
    const newest = levels[(head + LEVEL_HISTORY - 1) % LEVEL_HISTORY];
    expect(newest).toBeGreaterThan(-60);
    expect(newest).toBeCloseTo(onLevel.mock.lastCall?.[0]);
  });

  it("stop resolves a heard clip and fixes its WebM duration", async () => {
    const { engine, context, clock, recorder } = setup();
    await engine.start();
    context.analyser.level = 0.5;
    ticks(clock, 5);
    recorder.emitChunk(2);

    const recording = await engine.stop();

    expect(recording).toMatchObject({ verdict: "heard", partial: false, mimeType: recorder.mimeType });
    expect(recording.durationMs).toBeCloseTo(500);
    expect(recording.blob.size).toBe(3); // The earlier chunk plus stop's final byte.
    expect(recording.file).toBeInstanceOf(File);
    expect(recording.file.name).toMatch(/\.webm$/);
    expect(recording.file.type).toBe(recorder.mimeType);
    expect(await recording.file.arrayBuffer()).toEqual(await recording.blob.arrayBuffer());
    expect(fixWebmDuration).toHaveBeenCalledExactlyOnceWith(recording.blob, 500, { logger: false });
    expect(engine.status).toEqual({ kind: "clip", durationMs: 500, verdict: "heard", partial: false });
    expect(engine.isRecording).toBe(false);
  });

  it("mp4 skips the duration fix and uses an m4a filename", async () => {
    const { engine, clock, recorder } = setup({ mimeType: "audio/mp4" });
    await engine.start();
    ticks(clock, 5);

    const recording = await engine.stop();

    expect(recording.durationMs).toBe(500);
    expect(recording.mimeType).toBe(recorder.mimeType);
    expect(recording.file.type).toBe("audio/mp4");
    expect(recording.file.name).toMatch(/\.m4a$/);
    expect(fixWebmDuration).not.toHaveBeenCalled();
  });

  it("keeps a suspected-silent clip instead of rejecting it", async () => {
    const { engine, context, clock } = setup();
    await engine.start();
    context.analyser.level = 0;
    ticks(clock, 31);

    const recording = await engine.stop();

    expect(recording.verdict).toBe("suspectedSilent");
    expect(recording.blob.size).toBeGreaterThan(0);
    expect(engine.status).toMatchObject({ kind: "clip", verdict: "suspectedSilent" });
  });

  it("uses unchecked when the context stays suspended while wall-clock time advances", async () => {
    const { engine, context, clock } = setup({ keepSuspended: true });
    const onLevel = vi.fn();
    engine.onLevel(onLevel);
    await engine.start();
    context.analyser.level = 0.5;
    ticks(clock, 31);

    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.state).toBe("suspended");
    expect(engine.status).toMatchObject({ kind: "recording", hearing: "unknown", elapsedSeconds: 3 });
    expect(onLevel).not.toHaveBeenCalled();
    const recording = await engine.stop();
    expect(recording.verdict).toBe("unchecked");
    expect(recording.durationMs).toBe(3100);
  });

  // An OS stop (screen lock, phone call) arrives as onstop with no stop()/ended
  // transition; finish() dispatches `ended` itself so the clip is published.
  it("an OS stop publishes finishing then clip and retains the same recording", async () => {
    const { engine, recorder } = setup();
    await engine.start();
    const statuses = observeStatuses(engine);

    recorder.stop();
    await vi.advanceTimersByTimeAsync(0);
    const afterOsStop = { statuses: [...statuses], status: engine.status };

    expect(engine.hasFinishedClip).toBe(true);
    const recording = await engine.stop();
    expect(await engine.stop()).toBe(recording);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(afterOsStop).toEqual({
      statuses: ["finishing", "clip"],
      status: { kind: "clip", durationMs: 0, verdict: "unchecked", partial: false },
    });
  });

  it("track ended publishes finishing then clip", async () => {
    const { engine, track, recorder } = setup();
    await engine.start();
    const statuses = observeStatuses(engine);

    track.dispatchEvent(new Event("ended"));
    expect(engine.status.kind).toBe("finishing");
    await vi.advanceTimersByTimeAsync(0);

    expect(statuses).toEqual(["finishing", "clip"]);
    expect(engine.status.kind).toBe("clip");
    expect(engine.hasFinishedClip).toBe(true);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it("mute and unmute update the interrupted flag", async () => {
    const { engine, track } = setup();
    await engine.start();

    track.dispatchEvent(new Event("mute"));
    expect(engine.status).toMatchObject({ kind: "recording", interrupted: true });
    track.dispatchEvent(new Event("unmute"));
    expect(engine.status).toMatchObject({ kind: "recording", interrupted: false });
  });

  it("error then final data then stop retains a partial clip", async () => {
    const { engine, recorder } = setup();
    await engine.start();

    recorder.emitError(new Error("boom"));
    expect(engine.status.kind).toBe("recording");
    const recording = await engine.stop();

    expect(recording.partial).toBe(true);
    expect(recording.blob.size).toBe(1);
    expect(engine.status).toMatchObject({ kind: "clip", partial: true });
  });

  it("error with no data rejects and reports an unknown problem", async () => {
    const { engine, recorder } = setup({ stopEmitsNoData: true });
    const error = new Error("boom");
    await engine.start();

    recorder.emitError(error);
    await expect(engine.stop()).rejects.toBe(error);

    expect(engine.status).toEqual({ kind: "error", problem: "unknown" });
  });

  it("double stop returns the same promise and only stops the recorder once", async () => {
    const { engine, recorder } = setup();
    await engine.start();

    const first = engine.stop();
    const second = engine.stop();

    expect(second).toBe(first);
    expect(await second).toBe(await first);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it("releases the timer, tracks, context, graph and track listeners after stop", async () => {
    const { engine, context, track, clock } = setup();
    const added = vi.spyOn(track, "addEventListener");
    const removed = vi.spyOn(track, "removeEventListener");
    const onLevel = vi.fn();
    engine.onLevel(onLevel);
    await engine.start();
    ticks(clock, 5);
    expect(vi.getTimerCount()).toBe(1);
    expect(added.mock.calls.map(([type]) => type)).toEqual(["mute", "unmute", "ended"]);

    await engine.stop();

    expect(vi.getTimerCount()).toBe(0);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(track.readyState).toBe("ended");
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(context.state).toBe("closed");
    for (const node of [context.source, context.analyser, context.gain]) {
      expect(node.disconnect).toHaveBeenCalledTimes(1);
      expect(node.connections).toEqual([]);
    }
    expect(removed.mock.calls).toEqual(added.mock.calls);
    const snapshot = engine.getSnapshot();
    track.dispatchEvent(new Event("mute"));
    track.dispatchEvent(new Event("unmute"));
    track.dispatchEvent(new Event("ended"));
    ticks(clock, 10);
    expect(engine.getSnapshot()).toBe(snapshot);
    expect(onLevel).toHaveBeenCalledTimes(5);
  });

  // cancel() rejects a pending stop() with "Recording cancelled" even while the
  // clip is still being finalised: the settle callback lives until then.
  it("cancel releases resources, returns to idle and rejects a pending stop", async () => {
    const active = setup();
    await active.engine.start();
    expect(active.engine.status.kind).toBe("recording");
    active.engine.cancel();
    expect(active.engine.status).toEqual({ kind: "idle" });
    expect(active.track.stop).toHaveBeenCalledTimes(1);
    expect(active.context.state).toBe("closed");
    expect(active.recorder.stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    // With synchronous stop events, an outstanding stop is already finalizing.
    const { engine, context, track, recorder, clock } = setup();
    const fixing = deferred<Blob>();
    vi.mocked(fixWebmDuration).mockReturnValueOnce(fixing.promise);
    await engine.start();
    ticks(clock, 1);

    const stopped = engine.stop();
    let outcome: { kind: "pending" } | { kind: "resolved"; recording: Recording } | { kind: "rejected"; error: unknown } = { kind: "pending" };
    void stopped.then(
      (recording) => { outcome = { kind: "resolved", recording }; },
      (error: unknown) => { outcome = { kind: "rejected", error }; },
    );
    engine.cancel();

    expect(engine.status).toEqual({ kind: "idle" });
    expect(engine.hasFinishedClip).toBe(false);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(context.state).toBe("closed");
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    fixing.resolve(new Blob(["audio"], { type: recorder.mimeType }));
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.status).toEqual({ kind: "idle" });
    expect(outcome).toEqual({ kind: "rejected", error: new Error("Recording cancelled") });
  });

  it("ignores a second start while recording", async () => {
    const { engine, deps, recorder } = setup();
    await engine.start();
    const snapshot = engine.getSnapshot();

    await expect(engine.start()).resolves.toBeUndefined();

    expect(deps.getUserMedia).toHaveBeenCalledTimes(1);
    expect(deps.createAudioContext).toHaveBeenCalledTimes(1);
    expect(deps.createMediaRecorder).toHaveBeenCalledTimes(1);
    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(engine.status.kind).toBe("recording");
    expect(engine.getSnapshot()).toBe(snapshot);
  });

  it("getServerSnapshot is the frozen idle snapshot shared before start", () => {
    const { engine, deps } = setup();
    const snapshot = AudioRecorder.getServerSnapshot();

    expect(snapshot).toEqual({ status: { kind: "idle" }, activeInput: null });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.status)).toBe(true);
    expect(AudioRecorder.getServerSnapshot()).toBe(snapshot);
    expect(engine.getSnapshot()).toBe(snapshot);
    expect(engine.isRecording).toBe(false);
    expect(engine.hasFinishedClip).toBe(false);
    expect(deps.getUserMedia).not.toHaveBeenCalled();
  });
});
