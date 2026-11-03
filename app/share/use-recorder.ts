import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { detectPlatform, helpFor, type RecorderHelp } from "@/lib/recorder-help";
import {
  audioInputsFor,
  describeActiveInput,
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
  // Latest choice for the async start/refresh paths, written outside render.
  const selectedRef = useRef<string | null>(null);
  useEffect(() => {
    selectedRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

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
      const fallback = next[0]?.label ?? "your microphone";
      setDeviceNotice(`Your chosen microphone was unplugged — using ${fallback}.`);
      setSelectedDeviceId(null);
    }
  }, []);

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
    if (granted) {
      await refreshDevices();
    }
    try {
      await recorder.start({ deviceId: selectedRef.current });
    } catch {
      // The engine already published the error status and help copy.
      return;
    }
    setGranted(true);
    void refreshDevices();
  }, [recorder, granted, refreshDevices]);

  const stop = useCallback(async () => {
    let recording: Recording;
    try {
      recording = await recorder.stop();
    } catch {
      // A failed take keeps the previous accepted clip; the status shows the error.
      return;
    }
    replaceClip({ recording, url: URL.createObjectURL(recording.blob) });
  }, [recorder, replaceClip]);

  const discard = useCallback(() => {
    if (recorder.status.kind === "clip" || recorder.status.kind === "error") {
      recorder.discard();
    } else {
      recorder.cancel();
    }
    replaceClip(null);
  }, [recorder, replaceClip]);

  const selectDevice = useCallback((deviceId: string | null) => {
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

  const help = useMemo<RecorderHelp | null>(() => {
    const status = snapshot.status;
    if (status.kind === "error") {
      return helpFor(status.problem, platform);
    }
    if (status.kind === "recording" && status.hearing === "silent") {
      return helpFor("silent", platform);
    }
    if (clip?.recording.verdict === "suspectedSilent") {
      return helpFor("silent", platform);
    }
    return null;
  }, [snapshot.status, clip, platform]);

  return {
    snapshot,
    recorder,
    clip,
    inputs,
    showPicker: shouldShowPicker(inputs),
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
