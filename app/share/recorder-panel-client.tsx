"use client";

import { useId } from "react";

import { formatDuration } from "@/lib/format-duration";
import type { RecorderHelp } from "@/lib/recorder-help";

import { SecondaryButton, TertiaryButton } from "../_components/buttons";
import { errorClass, helperClass, selectClass } from "../_components/field-classes";
import { LevelMeter, usePrefersReducedMotion } from "./level-meter-client";
import type { UseRecorder } from "./use-recorder";

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="flex-none">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function HelpBox({ help, tone }: { help: RecorderHelp; tone: "warning" | "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="flex flex-col gap-2 rounded-input border-[3px] border-dashed border-periwinkle bg-muslin px-4 py-3"
    >
      <p className={`text-label font-bold ${tone === "error" ? "text-jo-red-deep" : "text-walnut"}`}>{help.title}</p>
      <p className={`text-small ${helperClass}`}>{help.body}</p>
      <ol className="flex list-decimal flex-col gap-1 pl-6 text-small text-walnut">
        {help.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

function buttonLabel(status: UseRecorder["snapshot"]["status"], hasClip: boolean): string {
  switch (status.kind) {
    case "requesting":
      return "Starting…";
    case "recording":
      return "Stop recording";
    case "finishing":
      return "Finishing…";
    case "error":
      return "Try again";
    case "clip":
      return "Record again";
    case "idle":
      return hasClip ? "Record again" : "Start recording";
  }
}

/**
 * The "Rather say it than type it?" box: record button, microphone picker,
 * live meter while recording, playback and verdict for the clip, and the
 * help copy for whatever went wrong. All state comes from useRecorder().
 */
export function RecorderPanel({ rec, canRecord, disabled }: { rec: UseRecorder; canRecord: boolean; disabled: boolean }) {
  const reducedMotion = usePrefersReducedMotion();
  const pickerId = useId();
  const { status } = rec.snapshot;
  const active = status.kind === "requesting" || status.kind === "recording" || status.kind === "finishing";
  const verdict = rec.clip?.recording.verdict;
  // A kept clip stays playable during the next take, but its verdict and help
  // belong to that take only.
  const showVerdict = rec.clip !== null && !active && status.kind !== "error";

  function toggle() {
    if (status.kind === "recording") {
      void rec.stop();
    } else if (!active) {
      void rec.start();
    }
  }

  return (
    <div id="record" className="flex flex-col gap-[10px] rounded-2xl border-[3px] border-dashed border-periwinkle bg-paper px-[22px] py-5">
      <span className="font-display text-lead font-bold">Rather say it than type it?</span>
      {canRecord ? (
        <>
          <TertiaryButton onClick={toggle} disabled={disabled || status.kind === "requesting" || status.kind === "finishing"}>
            <MicIcon />
            {buttonLabel(status, rec.clip !== null)}
          </TertiaryButton>

          {rec.showPicker && (
            <label htmlFor={pickerId} className="flex flex-col gap-2 text-label font-bold">
              <span>Microphone</span>
              <select
                id={pickerId}
                className={selectClass}
                value={rec.selectedDeviceId ?? ""}
                onChange={(event) => rec.selectDevice(event.target.value === "" ? null : event.target.value)}
                disabled={active}
              >
                <option value="">Let the browser choose</option>
                {rec.inputs.map((input) => (
                  <option key={input.deviceId} value={input.deviceId}>
                    {input.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {rec.activeInputLabel && (
            <span className="text-small text-walnut-soft">Using: {rec.activeInputLabel}</span>
          )}
          {rec.deviceNotice && (
            <p role="status" className="text-small text-walnut">{rec.deviceNotice}</p>
          )}

          {status.kind === "recording" && (
            <LevelMeter
              recorder={rec.recorder}
              hearing={status.hearing}
              interrupted={status.interrupted}
              elapsedSeconds={status.elapsedSeconds}
              reducedMotion={reducedMotion}
            />
          )}

          {status.kind === "recording" && status.hearing === "silent" && rec.help && <HelpBox help={rec.help} tone="warning" />}
          {status.kind === "error" && rec.help && <HelpBox help={rec.help} tone="error" />}

          {rec.clip && (
            <>
              <audio controls src={rec.clip.url} className="w-full min-w-0" />
              <span className="text-small text-walnut-soft">Recorded {formatDuration(rec.clip.recording.durationMs)}</span>
              {showVerdict && verdict === "suspectedSilent" && (
                <p role="status" className={errorClass}>
                  This recording sounds silent. Play it back before you send it.
                </p>
              )}
              {showVerdict && verdict === "unchecked" && (
                <p role="status" className="text-small text-walnut">
                  We couldn&apos;t check this recording — play it back before you send it.
                </p>
              )}
              {showVerdict && rec.clip.recording.partial && (
                <p role="status" className="text-small text-walnut">
                  The recording was cut short; what we have is here.
                </p>
              )}
              {showVerdict && verdict === "suspectedSilent" && rec.help && <HelpBox help={rec.help} tone="warning" />}
              <SecondaryButton onClick={rec.discard} disabled={disabled || active}>
                Remove recording
              </SecondaryButton>
            </>
          )}
          <span className="text-small text-walnut-soft">Take your time. You can listen back before you send it.</span>
        </>
      ) : (
        <span className="text-small text-walnut-soft">
          Recording isn&apos;t available in this browser. You can attach a voice memo with the file field instead.
        </span>
      )}
    </div>
  );
}
