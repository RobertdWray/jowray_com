import { describe, expect, it } from "vitest";

import {
  byteSampleToFloat,
  clipVerdict,
  createSilenceState,
  hearingVerdict,
  levelToBarHeight,
  observeLevel,
  rmsDbfs,
} from "@/lib/audio-level";

function sine(amplitude: number): Float32Array {
  return Float32Array.from({ length: 1024 }, (_, i) =>
    amplitude * Math.sin((2 * Math.PI * i) / 1024),
  );
}

describe("rmsDbfs", () => {
  it("clamps empty samples and digital silence to the floor", () => {
    expect(rmsDbfs([])).toBe(-100);
    expect(rmsDbfs(new Float32Array(32))).toBe(-100);
  });

  it("measures a full-scale square wave at 0 dBFS", () => {
    expect(Math.abs(rmsDbfs([1, -1, 1, -1]))).toBeLessThan(0.01);
  });

  it("measures a full-scale sine wave at about -3.01 dBFS", () => {
    expect(Math.abs(rmsDbfs(sine(1)) - -3.01)).toBeLessThan(0.05);
  });

  it("measures a sine with peak amplitude 0.001 at about -63.01 dBFS", () => {
    // Peak amplitude 0.001 has RMS 0.001 / sqrt(2), not 0.001.
    expect(Math.abs(rmsDbfs(sine(0.001)) - -63.01)).toBeLessThan(0.1);
  });

  it("measures a sine with RMS amplitude 0.001 at about -60 dBFS", () => {
    expect(Math.abs(rmsDbfs(sine(Math.SQRT2 * 0.001)) - -60)).toBeLessThan(0.1);
  });

  it("clamps very quiet nonzero samples to the floor", () => {
    expect(rmsDbfs([0.000001, -0.000001])).toBe(-100);
  });
});

describe("byteSampleToFloat", () => {
  it.each([
    [128, 0],
    [0, -1],
    [255, 0.9921875],
  ])("converts byte %i to %s", (value, expected) => {
    expect(byteSampleToFloat(value)).toBe(expected);
  });
});

describe("levelToBarHeight", () => {
  it.each([
    [-100, 0],
    [-60, 0],
    [-30, 0.5],
    [0, 1],
    [3, 1],
  ])("maps %i dBFS to height %s", (dbfs, expected) => {
    expect(levelToBarHeight(dbfs)).toBe(expected);
  });

  it("uses a custom floor for a linear dB scale", () => {
    expect(levelToBarHeight(-40, -80)).toBe(0.5);
    expect(levelToBarHeight(-90, -80)).toBe(0);
  });
});

describe("silence judgement", () => {
  it("starts unknown and unchecked even after the grace period without samples", () => {
    const state = createSilenceState(1200);
    expect(state).toStrictEqual({
      startedAt: 1200,
      lastObservedAt: null,
      lastLoudAt: null,
      loudMs: 0,
      observedMs: 0,
      coverageGap: false,
      peakDbfs: -100,
    });
    expect(hearingVerdict(state, 1200)).toBe("unknown");
    expect(hearingVerdict(state, 10_000)).toBe("unknown");
    expect(clipVerdict(state)).toBe("unchecked");
  });

  it("waits until 3000 ms before declaring silence", () => {
    let state = createSilenceState(0);
    for (let i = 1; i <= 29; i++) {
      state = observeLevel(state, -100, i * 100);
    }
    expect(state.observedMs).toBe(2900);
    expect(hearingVerdict(state, 2900)).toBe("listening");
    expect(hearingVerdict(state, 3000)).toBe("silent");
  });

  it("hears one loud tick immediately, even at time zero", () => {
    const state = observeLevel(createSilenceState(0), -20, 0);
    expect(hearingVerdict(state, 0)).toBe("hearing");
    expect(clipVerdict(state)).toBe("suspectedSilent");
    expect(state.loudMs).toBe(100);
  });

  it("returns to silence after 30 silent ticks following a loud tick", () => {
    let state = observeLevel(createSilenceState(0), -20, 0);
    for (let i = 1; i <= 30; i++) {
      state = observeLevel(state, -100, i * 100);
    }
    expect(hearingVerdict(state, 2999)).toBe("hearing");
    expect(hearingVerdict(state, 3000)).toBe("silent");
  });

  it("counts two loud ticks as heard", () => {
    let state = observeLevel(createSilenceState(0), -20, 0);
    state = observeLevel(state, -20, 100);
    expect(state.loudMs).toBe(200);
    expect(clipVerdict(state)).toBe("heard");
  });

  it("includes the -60 dBFS boundary as loud", () => {
    const state = observeLevel(createSilenceState(0), -60, 100);
    expect(state.loudMs).toBe(100);
    expect(hearingVerdict(state, 100)).toBe("hearing");
  });

  it("does not count a value just below the threshold as loud", () => {
    const state = observeLevel(createSilenceState(0), -60.01, 100);
    expect(state.loudMs).toBe(0);
    expect(hearingVerdict(state, 100)).toBe("listening");
  });

  it("marks a 600 ms gap as unchecked and credits only the analysed ticks", () => {
    let state = observeLevel(createSilenceState(0), -100, 0);
    state = observeLevel(state, -100, 600);
    expect(state.coverageGap).toBe(true);
    expect(state.observedMs).toBe(200);
    expect(clipVerdict(state)).toBe("unchecked");
  });

  it("keeps the coverage gap after normal sampling resumes", () => {
    let state = observeLevel(createSilenceState(0), -100, 0);
    state = observeLevel(state, -100, 600);
    state = observeLevel(state, -100, 700);
    expect(state.coverageGap).toBe(true);
    expect(clipVerdict(state)).toBe("unchecked");
  });

  it("allows a gap of exactly 500 ms", () => {
    let state = observeLevel(createSilenceState(0), -100, 0);
    state = observeLevel(state, -100, 500);
    expect(state.coverageGap).toBe(false);
    expect(clipVerdict(state)).toBe("suspectedSilent");
  });

  it("keeps a heard verdict despite a coverage gap", () => {
    let state = observeLevel(createSilenceState(0), -20, 0);
    state = observeLevel(state, -20, 600);
    expect(state.coverageGap).toBe(true);
    expect(state.loudMs).toBe(200);
    expect(clipVerdict(state)).toBe("heard");
  });

  it("tracks the highest observed peak and latest loud tick", () => {
    let state = observeLevel(createSilenceState(0), -80, 0);
    state = observeLevel(state, -25, 100);
    state = observeLevel(state, -15, 200);
    state = observeLevel(state, -100, 300);
    expect(state.peakDbfs).toBe(-15);
    expect(state.lastObservedAt).toBe(300);
    expect(state.lastLoudAt).toBe(200);
  });

  it("returns a new state without mutating the input", () => {
    const state = Object.freeze(createSilenceState(0));
    const before = { ...state };
    const next = observeLevel(state, -20, 100);
    expect(next).not.toBe(state);
    expect(state).toStrictEqual(before);
    expect(next.observedMs).toBe(100);
  });
});
