export const SILENCE_FLOOR_DBFS = -100;
export const SILENCE_THRESHOLD_DBFS = -60;
export const SILENCE_GRACE_MS = 3000;
export const SILENCE_WINDOW_MS = 3000;
export const MIN_LOUD_MS = 200;
export const TICK_MS = 100;
export const MAX_GAP_MS = 500;

/** Measure signal power on a dB scale, keeping digital silence finite. */
export function rmsDbfs(samples: ArrayLike<number>): number {
  if (samples.length === 0) {
    return SILENCE_FLOOR_DBFS;
  }

  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSquares += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  return Math.max(SILENCE_FLOOR_DBFS, 20 * Math.log10(rms));
}

/** Centre byte samples on zero for browsers without float sample data. */
export function byteSampleToFloat(value: number): number {
  return (value - 128) / 128;
}

/** Scale audible levels to a bounded bar height with a linear dB scale. */
export function levelToBarHeight(dbfs: number, floorDbfs = SILENCE_THRESHOLD_DBFS): number {
  return Math.min(1, Math.max(0, (dbfs - floorDbfs) / -floorDbfs));
}

export interface SilenceState {
  readonly startedAt: number;
  readonly lastObservedAt: number | null;
  readonly runStartedAt: number | null;
  readonly lastLoudAt: number | null;
  readonly loudMs: number;
  readonly observedMs: number;
  readonly coverageGap: boolean;
  readonly peakDbfs: number;
}

/** Begin with no audio evidence; all timestamps use the same monotonic clock. */
export function createSilenceState(now: number): SilenceState {
  return {
    startedAt: now,
    lastObservedAt: null,
    runStartedAt: null,
    lastLoudAt: null,
    loudMs: 0,
    observedMs: 0,
    coverageGap: false,
    peakDbfs: SILENCE_FLOOR_DBFS,
  };
}

/** P1/P17: gaps are missing evidence, so restart grace and retain coverage history. */
export function observeLevel(state: SilenceState, dbfs: number, now: number): SilenceState {
  const loud = dbfs >= SILENCE_THRESHOLD_DBFS;
  const gap = now - (state.lastObservedAt ?? state.startedAt) > MAX_GAP_MS;
  return {
    ...state,
    lastObservedAt: now,
    runStartedAt: gap ? now : state.runStartedAt ?? now,
    lastLoudAt: loud ? now : state.lastLoudAt,
    loudMs: state.loudMs + (loud ? TICK_MS : 0),
    observedMs: state.observedMs + TICK_MS,
    coverageGap: state.coverageGap || gap,
    peakDbfs: Math.max(state.peakDbfs, dbfs),
  };
}

export type Hearing = "unknown" | "listening" | "hearing" | "silent";

/** P1/P17: only fresh, continuous evidence can justify a live silence warning. */
export function hearingVerdict(state: SilenceState, now: number): Hearing {
  if (state.observedMs === 0) {
    return "unknown";
  }
  if (state.lastLoudAt !== null && now - state.lastLoudAt < SILENCE_WINDOW_MS) {
    return "hearing";
  }
  if (
    state.lastObservedAt !== null
    && now - state.lastObservedAt <= MAX_GAP_MS
    && now - (state.runStartedAt ?? now) >= SILENCE_GRACE_MS
    && now - state.startedAt >= SILENCE_GRACE_MS
  ) {
    return "silent";
  }
  return "listening";
}

export type ClipVerdict = "heard" | "suspectedSilent" | "unchecked";

/** P1/P17: missing analysis, including time until Stop, cannot establish silence. */
export function clipVerdict(state: SilenceState, stoppedAt?: number): ClipVerdict {
  if (state.loudMs >= MIN_LOUD_MS) {
    return "heard";
  }
  if (
    state.observedMs === 0
    || state.coverageGap
    || (stoppedAt !== undefined && stoppedAt - (state.lastObservedAt ?? state.startedAt) > MAX_GAP_MS)
  ) {
    return "unchecked";
  }
  return "suspectedSilent";
}
