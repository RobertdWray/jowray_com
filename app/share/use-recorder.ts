import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { detectPlatform, helpFor, type RecorderHelp } from "@/lib/recorder-help";
import {
  audioInputsFor,
  describeActiveInput,
  friendlyInputLabel,
  resolveSelectedDevice,
  shouldShowPicker,
  type AudioInputInfo,
} from "@/lib/recording-devices";

import { AudioRecorder, type Recording, type RecorderSnapshot } from "./recorder";

export interface Clip {
  recording: Recording;
  url: string;
}

export interface UseRecorder {
  snapshot: RecorderSnapshot;
  recorder: AudioRecorder;
  clip: Clip | null;
  /** Labelled microphones, once permission has been granted at least once. */
  inputs: AudioInputInfo[];
  showPicker: boolean;
  selectedDeviceId: string | null;
  /** "Using: …" once a stream has been granted. */
  activeInputLabel: string | null;
  /** Set when the chosen microphone disappeared; cleared on the next choice. */
  deviceNotice: string | null;
  help: RecorderHelp | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  discard: () => void;
  selectDevice: (deviceId: string | null) => void;
}

function subscribeNever(): () => void {
  return () => {};
}

/**
 * React side of the recorder: owns the engine, the clip's object URL, the
 * microphone list (which outlives any single recording, so a headset plugged
 * in between takes still shows up) and the help copy for the current problem.
 */
export function useRecorder(): UseRecorder {
  // One engine per mounted form; constructing it has no side effects.
  const [recorder] = useState(() => new AudioRecorder());
  const snapshot = useSyncExternalStore(recorder.subscribe, recorder.getSnapshot, AudioRecorder.getServerSnapshot);
  const platform = useSyncExternalStore(
    subscribeNever,
    () => detectPlatform(navigator.userAgent, navigator.maxTouchPoints),
    () => "other" as const,
  );

  const [clip, setClip] = useState<Clip | null>(null);
  const clipUrlRef = useRef<string | null>(null);
  const [inputs, setInputs] = useState<AudioInputInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null);
  const [granted, setGranted] = useState(false);
  // Latest choice for the async start/refresh paths; written in the same
  // handlers that set the state so it is never one commit behind.
  const selectedRef = useRef<string | null>(null);
  // The Recording already published as `clip`, so manual and automatic
  // completion share one publication path without publishing twice.
  const publishedRef = useRef<Recording | null>(null);

  const replaceClip = useCallback((next: Clip | null) => {
    if (clipUrlRef.current) {
      URL.revokeObjectURL(clipUrlRef.current);
    }
    clipUrlRef.current = next?.url ?? null;
    setClip(next);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    let devices: MediaDeviceInfo[];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      return;
    }
    const next = audioInputsFor(devices);
    setInputs(next);
    const chosen = selectedRef.current;
    if (chosen !== null && resolveSelectedDevice(chosen, next) === null) {
      const fallback = friendlyInputLabel(next[0]?.label ?? "") || "your microphone";
      setDeviceNotice(`Your chosen microphone was unplugged — using ${fallback}.`);
      selectedRef.current = null;
      setSelectedDeviceId(null);
    }
  }, []);

  // One place publishes a finished clip, whether the contributor tapped Stop
  // or the OS ended the take (screen lock, call, unplugged microphone).
  useEffect(() => {
    if (snapshot.status.kind !== "clip") {
      return;
    }
    let cancelled = false;
    recorder.stop().then(
      (recording) => {
        if (cancelled || publishedRef.current === recording) {
          return;
        }
        publishedRef.current = recording;
        replaceClip({ recording, url: URL.createObjectURL(recording.blob) });
      },
      () => {
        // Rejected takes keep the previous accepted clip; the status shows the error.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [snapshot.status, recorder, replaceClip]);

  // The list is refreshed for the panel's lifetime once permission exists:
  // on plug/unplug, on coming back to the tab, and before every start.
  useEffect(() => {
    if (!granted || typeof navigator === "undefined" || !navigator.mediaDevices) {
      return;
    }
    const onChange = () => {
      void refreshDevices();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshDevices();
      }
    };
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [granted, refreshDevices]);

  // Release the microphone and playback URL when the contributor navigates away.
  useEffect(
    () => () => {
      recorder.cancel();
      if (clipUrlRef.current) {
        URL.revokeObjectURL(clipUrlRef.current);
        clipUrlRef.current = null;
      }
    },
    [recorder],
  );

  const start = useCallback(async () => {
    // Synchronous into the engine: the AudioContext must be created inside the
    // tap. A device that vanished since the last refresh falls back in acquire().
    try {
      await recorder.start({ deviceId: selectedRef.current });
    } catch {
      // The engine already published the error status and help copy.
      return;
    }
    setGranted(true);
    void refreshDevices();
  }, [recorder, refreshDevices]);

  const stop = useCallback(async () => {
    try {
      await recorder.stop();
    } catch {
      // A failed take keeps the previous accepted clip; the status shows the error.
    }
    // The clip itself is published by the status effect above.
  }, [recorder]);

  const discard = useCallback(() => {
    if (recorder.status.kind === "clip" || recorder.status.kind === "error") {
      recorder.discard();
    } else {
      recorder.cancel();
    }
    replaceClip(null);
  }, [recorder, replaceClip]);

  const selectDevice = useCallback((deviceId: string | null) => {
    selectedRef.current = deviceId;
    setSelectedDeviceId(deviceId);
    setDeviceNotice(null);
  }, []);

  const activeInputLabel = useMemo(() => {
    const active = snapshot.activeInput;
    if (!active) {
      return null;
    }
    return describeActiveInput({ label: active.label, deviceId: active.deviceId ?? undefined }, inputs);
  }, [snapshot.activeInput, inputs]);

  // Help for the current phase only: a kept silent clip's steps do not follow
  // the contributor into their next take.
  const help = useMemo<RecorderHelp | null>(() => {
    const status = snapshot.status;
    if (status.kind === "error") {
      return helpFor(status.problem, platform, "error");
    }
    if (status.kind === "recording" || status.kind === "requesting" || status.kind === "finishing") {
      return status.kind === "recording" && status.hearing === "silent" ? helpFor("silent", platform, "recording") : null;
    }
    if (clip?.recording.verdict === "suspectedSilent") {
      return helpFor("silent", platform, "clip");
    }
    return null;
  }, [snapshot.status, clip, platform]);

  return {
    snapshot,
    recorder,
    clip,
    inputs,
    showPicker: shouldShowPicker(inputs, platform),
    selectedDeviceId,
    activeInputLabel,
    deviceNotice,
    help,
    start,
    stop,
    discard,
    selectDevice,
  };
}
