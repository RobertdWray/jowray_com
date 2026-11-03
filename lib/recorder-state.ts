import type { ClipVerdict, Hearing } from "@/lib/audio-level";
import type { RecorderProblem } from "@/lib/recorder-help";

export type RecorderStatus =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "recording"; startedAt: number; hearing: Hearing; elapsedSeconds: number; interrupted: boolean }
  | { kind: "finishing" }
  | { kind: "clip"; durationMs: number; verdict: ClipVerdict; partial: boolean }
  | { kind: "error"; problem: RecorderProblem };

export type RecorderEvent =
  | { type: "start" }
  | { type: "granted"; now: number }
  | { type: "failed"; problem: RecorderProblem }
  | { type: "hearing"; hearing: Hearing }
  | { type: "tick"; now: number }
  | { type: "interrupted" }
  | { type: "resumed" }
  | { type: "stop" }
  | { type: "ended" }
  | { type: "finished"; durationMs: number; verdict: ClipVerdict; partial: boolean }
  | { type: "cancel" }
  | { type: "discard" };

export const IDLE: RecorderStatus = Object.freeze({ kind: "idle" });

/** Preserve unchanged snapshots so duplicate taps and late events have no effect. */
export function reduceRecorder(state: RecorderStatus, event: RecorderEvent): RecorderStatus {
  switch (event.type) {
    case "start":
      if (state.kind === "idle" || state.kind === "clip" || state.kind === "error") {
        return { kind: "requesting" };
      }
      break;
    case "granted":
      if (state.kind === "requesting") {
        return {
          kind: "recording",
          startedAt: event.now,
          hearing: "unknown",
          elapsedSeconds: 0,
          interrupted: false,
        };
      }
      break;
    case "failed":
      if (state.kind === "requesting" || state.kind === "recording" || state.kind === "finishing") {
        return { kind: "error", problem: event.problem };
      }
      break;
    case "hearing":
      if (state.kind === "recording" && state.hearing !== event.hearing) {
        return { ...state, hearing: event.hearing };
      }
      break;
    case "tick":
      if (state.kind === "recording") {
        const elapsedSeconds = Math.floor((event.now - state.startedAt) / 1000);
        if (state.elapsedSeconds !== elapsedSeconds) {
          return { ...state, elapsedSeconds };
        }
      }
      break;
    case "interrupted":
    case "resumed":
      if (state.kind === "recording") {
        const interrupted = event.type === "interrupted";
        if (state.interrupted !== interrupted) {
          return { ...state, interrupted };
        }
      }
      break;
    case "stop":
    case "ended":
      if (state.kind === "recording") {
        return { kind: "finishing" };
      }
      break;
    case "finished":
      if (state.kind === "finishing") {
        return {
          kind: "clip",
          durationMs: event.durationMs,
          verdict: event.verdict,
          partial: event.partial,
        };
      }
      break;
    case "cancel":
      if (state.kind === "requesting" || state.kind === "recording" || state.kind === "finishing") {
        return IDLE;
      }
      break;
    case "discard":
      if (state.kind === "clip") {
        return IDLE;
      }
      break;
  }
  return state;
}
