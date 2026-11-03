/**
 * In-browser audio recording with live feedback.
 *
 * The engine owns the MediaStream, the MediaRecorder and a small Web Audio
 * graph (source → analyser → muted gain → destination) that samples the
 * microphone every TICK_MS so the page can show a level meter and judge
 * silence while the contributor talks. Phase changes go through the pure
 * reducer in lib/recorder-state so the double-tap, OS-interrupted-stop and
 * error orderings are unit-tested; React reads an immutable snapshot via
 * useSyncExternalStore and the hot level data stays out of it.
 *
 * iOS Safari before 18.4 supports only `audio/mp4`; newer browsers prefer
 * Opus in WebM. Chrome's WebM carries no duration header, so WebM clips are
 * patched with fix-webm-duration before the File is built.
 *
 * Browser objects come in through `RecorderDeps` (defaults wrap the globals)
 * so the lifecycle can be tested in Node with fakes.
 */

import fixWebmDuration from "fix-webm-duration";

import {
  byteSampleToFloat,
  clipVerdict,
  createSilenceState,
  hearingVerdict,
  observeLevel,
  rmsDbfs,
  SILENCE_FLOOR_DBFS,
  TICK_MS,
  type ClipVerdict,
  type SilenceState,
} from "@/lib/audio-level";
import { problemFromError, type RecorderProblem } from "@/lib/recorder-help";
import { audioConstraintsFor } from "@/lib/recording-devices";
import { IDLE, reduceRecorder, type RecorderStatus } from "@/lib/recorder-state";

const CANDIDATES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];

/** How many level samples the meter can read back (60 × 100 ms = 6 s). */
export const LEVEL_HISTORY = 60;

function defaultIsTypeSupported(type: string): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof MediaRecorder.isTypeSupported === "function" &&
    MediaRecorder.isTypeSupported(type)
  );
}

/** First recordable MIME type, or null when this browser cannot record. */
export function pickRecordingType(isTypeSupported: (type: string) => boolean = defaultIsTypeSupported): string | null {
  return CANDIDATES.find((type) => isTypeSupported(type)) ?? null;
}

export interface Recording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  file: File;
  verdict: ClipVerdict;
  /** True when the recorder reported an error before it stopped; the clip may be cut short. */
  partial: boolean;
}

/** The input the browser handed us, as reported by the live track. */
export interface ActiveInput {
  label: string;
  deviceId: string | null;
}

export interface RecorderSnapshot {
  status: RecorderStatus;
  activeInput: ActiveInput | null;
}

export interface RecorderDeps {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioContext: () => AudioContext;
  createMediaRecorder: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  isTypeSupported: (type: string) => boolean;
  /** Monotonic milliseconds (performance.now()); never Date.now(). */
  now: () => number;
}

function browserDeps(): RecorderDeps {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createAudioContext: () => new AudioContext(),
    createMediaRecorder: (stream, options) => new MediaRecorder(stream, options),
    isTypeSupported: defaultIsTypeSupported,
    now: () => performance.now(),
  };
}

const SERVER_SNAPSHOT: RecorderSnapshot = Object.freeze({ status: IDLE, activeInput: null });

type Settle = { resolve: (r: Recording) => void; reject: (e: Error) => void };

export class AudioRecorder {
  private readonly deps: RecorderDeps;
  private snapshot: RecorderSnapshot = SERVER_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private readonly levelListeners = new Set<(dbfs: number) => void>();
  private readonly levels = new Float32Array(LEVEL_HISTORY).fill(SILENCE_FLOOR_DBFS);
  private levelsHead = 0;

  /** Bumped by start() and cancel(); every async continuation checks it. */
  private session = 0;
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private context: AudioContext | null = null;
  private nodes: AudioNode[] = [];
  private analyser: AnalyserNode | null = null;
  private sampleBuffer: Float32Array<ArrayBuffer> | null = null;
  private byteBuffer: Uint8Array<ArrayBuffer> | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private error: Error | null = null;
  private silence: SilenceState | null = null;
  private startedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private finished: Promise<Recording> | null = null;
  private settle: Settle | null = null;
  private trackHandlers: Array<[string, EventListener]> = [];

  constructor(deps: Partial<RecorderDeps> = {}) {
    this.deps = { ...browserDeps(), ...deps };
  }

  // ----- store API (useSyncExternalStore) ---------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): RecorderSnapshot => this.snapshot;

  static getServerSnapshot(): RecorderSnapshot {
    return SERVER_SNAPSHOT;
  }

  /**
   * Copy the level ring (dBFS per tick) into `target` and return the index of
   * the oldest sample; the newest is at `(head + LEVEL_HISTORY - 1) % LEVEL_HISTORY`.
   * Kept outside the React snapshot on purpose: it changes every 100 ms.
   */
  readLevels(target: Float32Array): number {
    target.set(this.levels.subarray(0, Math.min(target.length, LEVEL_HISTORY)));
    return this.levelsHead;
  }

  /** Called once per analysed tick with the tick's dBFS (reduced-motion meter). */
  onLevel(listener: (dbfs: number) => void): () => void {
    this.levelListeners.add(listener);
    return () => {
      this.levelListeners.delete(listener);
    };
  }

  get status(): RecorderStatus {
    return this.snapshot.status;
  }

  get isRecording(): boolean {
    return this.snapshot.status.kind === "recording";
  }

  /** True once the OS or an error stopped the recorder before stop() was called. */
  get hasFinishedClip(): boolean {
    return this.finished !== null && this.recorder === null;
  }

  // ----- lifecycle --------------------------------------------------------

  /**
   * Ask for the microphone and start recording. Resolves once recording;
   * rejects (after publishing an `error` status) when the browser refuses.
   * A second call while requesting/recording/finishing is ignored.
   */
  async start({ deviceId = null }: { deviceId?: string | null } = {}): Promise<void> {
    if (!this.dispatch({ type: "start" })) {
      return;
    }
    const session = ++this.session;
    const mimeType = pickRecordingType(this.deps.isTypeSupported);
    if (!mimeType) {
      this.fail("unsupported");
      throw new Error("Recording is not supported in this browser");
    }
    // Created synchronously inside the tap: Web Audio started outside a user
    // input handler is subject to autoplay rules and may stay suspended.
    const context = this.deps.createAudioContext();
    this.context = context;
    void context.resume().catch(() => {});

    let stream: MediaStream;
    try {
      stream = await this.acquire(deviceId);
    } catch (error) {
      if (session === this.session) {
        this.release();
        this.fail(problemFromError(error));
      }
      throw error instanceof Error ? error : new Error("Microphone unavailable");
    }
    if (session !== this.session) {
      // Cancelled (or restarted) while the permission prompt was open.
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    this.stream = stream;
    this.track = stream.getAudioTracks()[0] ?? null;
    this.attachTrack(session);
    this.buildGraph(context, stream);

    this.chunks = [];
    this.error = null;
    let recorder: MediaRecorder;
    try {
      recorder = this.deps.createMediaRecorder(stream, { mimeType });
    } catch (error) {
      this.release();
      this.fail(problemFromError(error));
      throw error instanceof Error ? error : new Error("Recording failed to start");
    }
    this.recorder = recorder;
    this.finished = new Promise<Recording>((resolve, reject) => {
      this.settle = { resolve, reject };
    });
    // Observed by whoever calls stop(); a cancel must not surface as unhandled.
    this.finished.catch(() => {});
    // Handlers before start() so an OS-triggered stop still finalises the clip.
    recorder.ondataavailable = (event: BlobEvent) => {
      if (session === this.session && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    // Spec order on failure is error → dataavailable → stop: remember the
    // error here, collect the last chunk, finalise once in onstop.
    recorder.onerror = (event: Event) => {
      if (session !== this.session) {
        return;
      }
      const detail = (event as ErrorEvent).error;
      this.error = detail instanceof Error ? detail : new Error("Recording failed");
    };
    recorder.onstop = () => {
      if (session === this.session) {
        this.finish();
      }
    };

    const now = this.deps.now();
    this.startedAt = now;
    this.silence = createSilenceState(now);
    this.levels.fill(SILENCE_FLOOR_DBFS);
    this.levelsHead = 0;
    recorder.start(1000);
    this.timer = setInterval(() => this.sample(session), TICK_MS);
    this.dispatch({ type: "granted", now });
  }

  /**
   * Resolves with the recording. If the OS already stopped the recorder the
   * clip is waiting in `finished`; otherwise stop() lets the final
   * `dataavailable` + `stop` events finish it. A second tap returns the same
   * promise (never truncates).
   */
  stop(): Promise<Recording> {
    const finished = this.finished;
    if (!finished) {
      return Promise.reject(new Error("Not recording"));
    }
    this.dispatch({ type: "stop" });
    const recorder = this.recorder;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    return finished;
  }

  /** Stop everything and drop the clip (unmount, "Remove recording", restart). */
  cancel(): void {
    this.session += 1;
    const recorder = this.recorder;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Already stopping; nothing to release here.
        }
      }
    }
    this.release();
    this.settle?.reject(new Error("Recording cancelled"));
    this.settle = null;
    this.finished = null;
    this.dispatch({ type: "cancel" });
  }

  /** Forget a finished clip so the next start() begins clean. */
  discard(): void {
    this.finished = null;
    this.settle = null;
    this.dispatch({ type: "discard" });
  }

  // ----- internals --------------------------------------------------------

  private async acquire(deviceId: string | null): Promise<MediaStream> {
    try {
      return await this.deps.getUserMedia(audioConstraintsFor(deviceId));
    } catch (error) {
      // The chosen microphone vanished: fall back to the default one.
      if (deviceId !== null && problemFromError(error) === "overconstrained") {
        return this.deps.getUserMedia(audioConstraintsFor(null));
      }
      throw error;
    }
  }

  private attachTrack(session: number): void {
    const track = this.track;
    if (!track) {
      return;
    }
    const on = (type: string, handler: EventListener) => {
      track.addEventListener(type, handler);
      this.trackHandlers.push([type, handler]);
    };
    // A phone call or screen lock mutes the track without ending it.
    on("mute", () => {
      if (session === this.session) {
        this.dispatch({ type: "interrupted" });
      }
    });
    on("unmute", () => {
      if (session === this.session) {
        this.dispatch({ type: "resumed" });
      }
    });
    // The OS took the microphone away: finish with what we have.
    on("ended", () => {
      if (session !== this.session) {
        return;
      }
      this.dispatch({ type: "ended" });
      const recorder = this.recorder;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      } else {
        this.finish();
      }
    });
    const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
    this.publish({ activeInput: { label: track.label, deviceId: settings.deviceId ?? null } });
  }

  private buildGraph(context: AudioContext, stream: MediaStream): void {
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    // A zero-gain path to the destination keeps the graph pulled on engines
    // that do not drive a dangling analyser, and cannot feed back.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(analyser);
    analyser.connect(mute);
    mute.connect(context.destination);
    this.nodes = [source, analyser, mute];
    this.analyser = analyser;
    this.sampleBuffer = new Float32Array(analyser.fftSize);
    this.byteBuffer = null;
  }

  private sample(session: number): void {
    if (session !== this.session || !this.silence) {
      return;
    }
    const now = this.deps.now();
    this.dispatch({ type: "tick", now });
    const context = this.context;
    const analyser = this.analyser;
    // Suspended or interrupted context: no data to judge. The gap it leaves
    // is what marks the clip "unchecked" rather than "silent".
    if (!context || context.state !== "running" || !analyser) {
      return;
    }
    const dbfs = this.readDbfs(analyser);
    this.levels[this.levelsHead] = dbfs;
    this.levelsHead = (this.levelsHead + 1) % LEVEL_HISTORY;
    this.silence = observeLevel(this.silence, dbfs, now);
    this.levelListeners.forEach((listener) => listener(dbfs));
    this.dispatch({ type: "hearing", hearing: hearingVerdict(this.silence, now) });
  }

  private readDbfs(analyser: AnalyserNode): number {
    if (typeof analyser.getFloatTimeDomainData === "function" && this.sampleBuffer) {
      analyser.getFloatTimeDomainData(this.sampleBuffer);
      return rmsDbfs(this.sampleBuffer);
    }
    // Old WebKit: byte samples only.
    if (!this.byteBuffer) {
      this.byteBuffer = new Uint8Array(analyser.fftSize);
    }
    analyser.getByteTimeDomainData(this.byteBuffer);
    return rmsDbfs(Array.from(this.byteBuffer, byteSampleToFloat));
  }

  private finish(): void {
    const recorder = this.recorder;
    const settle = this.settle;
    if (!recorder || !settle) {
      return;
    }
    // An OS-triggered stop arrives without a stop()/ended transition.
    if (this.snapshot.status.kind === "recording") {
      this.dispatch({ type: "ended" });
    }
    const mimeType = recorder.mimeType || "audio/webm";
    const blob = new Blob(this.chunks, { type: mimeType });
    const durationMs = Math.max(0, Math.round(this.deps.now() - this.startedAt));
    const verdict = this.silence ? clipVerdict(this.silence) : "unchecked";
    const error = this.error;
    const session = this.session;
    this.release();
    if (blob.size === 0) {
      const problem: RecorderProblem = error ? problemFromError(error) : "unknown";
      this.settle = null; // `finished` stays until discard()/cancel()/next start()
      this.dispatch({ type: "failed", problem });
      settle.reject(error ?? new Error("Nothing was recorded"));
      return;
    }
    // `settle` stays set while finalising so a cancel() in the meantime can
    // still reject the pending stop() promise.
    void this.finalize(blob, mimeType, durationMs, verdict, error !== null).then(
      (recording) => {
        if (session !== this.session) {
          return;
        }
        this.settle = null;
        this.dispatch({ type: "finished", durationMs, verdict, partial: recording.partial });
        settle.resolve(recording);
      },
      (reason: unknown) => {
        if (session !== this.session) {
          return;
        }
        this.settle = null;
        this.dispatch({ type: "failed", problem: "unknown" });
        settle.reject(reason instanceof Error ? reason : new Error("Recording failed"));
      },
    );
  }

  private async finalize(
    source: Blob,
    mimeType: string,
    durationMs: number,
    verdict: ClipVerdict,
    partial: boolean,
  ): Promise<Recording> {
    let blob = source;
    if (mimeType.startsWith("audio/webm") && durationMs > 0) {
      try {
        // The library also swallows its own failures and returns the original
        // blob; either way playback works, only the timeline may stay odd.
        blob = await fixWebmDuration(source, durationMs, { logger: false });
      } catch {
        blob = source;
      }
    }
    const extension = mimeType.startsWith("audio/mp4") ? "m4a" : "webm";
    const file = new File([blob], `recording-${Date.now()}.${extension}`, { type: mimeType });
    return { blob, mimeType, durationMs, file, verdict, partial };
  }

  private fail(problem: RecorderProblem): void {
    this.dispatch({ type: "failed", problem });
  }

  private release(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const track = this.track;
    if (track) {
      this.trackHandlers.forEach(([type, handler]) => track.removeEventListener(type, handler));
    }
    this.trackHandlers = [];
    this.nodes.forEach((node) => {
      try {
        node.disconnect();
      } catch {
        // Already disconnected.
      }
    });
    this.nodes = [];
    this.analyser = null;
    this.sampleBuffer = null;
    this.byteBuffer = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") {
      // The source node otherwise keeps the stream alive and iOS caps live contexts.
      void context.close().catch(() => {});
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.recorder = null;
    this.silence = null;
  }

  /** Run the reducer; publish only when the status object changed. Returns whether it did. */
  private dispatch(event: Parameters<typeof reduceRecorder>[1]): boolean {
    const next = reduceRecorder(this.snapshot.status, event);
    if (next === this.snapshot.status) {
      return false;
    }
    this.publish({ status: next });
    return true;
  }

  private publish(patch: Partial<RecorderSnapshot>): void {
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    this.listeners.forEach((listener) => listener());
  }
}
