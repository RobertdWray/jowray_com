/**
 * In-browser audio recording. iOS Safari before 18.4 supports only
 * `audio/mp4`; newer browsers prefer Opus in WebM. The recorder's actual
 * `mimeType` is used for the Blob (with parameters) and, normalized, for the
 * upload ticket. No type supported → `pickRecordingType()` returns null and
 * the form hides the record button.
 */

const CANDIDATES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];

export function pickRecordingType(): string | null {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return null;
  }
  return CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export interface Recording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  file: File;
}

export class AudioRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;
  private stream: MediaStream | null = null;
  private finished: Promise<Recording> | null = null;
  private settle: { resolve: (r: Recording) => void; reject: (e: Error) => void } | null = null;

  async start(): Promise<void> {
    const mimeType = pickRecordingType();
    if (!mimeType) {
      throw new Error("Recording is not supported in this browser");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      this.chunks = [];
      const recorder = new MediaRecorder(this.stream, { mimeType });
      this.recorder = recorder;
      // Lifecycle handlers are attached before start() so an OS-triggered stop
      // (backgrounded tab, phone call, screen lock) still finalises the clip.
      this.finished = new Promise<Recording>((resolve, reject) => {
        this.settle = { resolve, reject };
      });
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };
      recorder.onerror = () => this.finish(new Error("Recording failed"));
      recorder.onstop = () => this.finish();
      this.startedAt = Date.now();
      recorder.start(1000);
    } catch (error) {
      this.release();
      throw error;
    }
  }

  /** Resolves with the recording; works whether we or the OS stopped it. */
  stop(): Promise<Recording> {
    const recorder = this.recorder;
    const finished = this.finished;
    if (!recorder || !finished) {
      return Promise.reject(new Error("Not recording"));
    }
    if (recorder.state !== "inactive") {
      recorder.stop();
    } else {
      this.finish();
    }
    return finished;
  }

  /** Stop everything and drop the clip (component unmount). */
  cancel(): void {
    const recorder = this.recorder;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    this.release();
    this.settle?.reject(new Error("Recording cancelled"));
    this.settle = null;
    this.finished = null;
  }

  get isRecording(): boolean {
    return this.recorder?.state === "recording";
  }

  private finish(error?: Error): void {
    const recorder = this.recorder;
    const settle = this.settle;
    if (!recorder || !settle) {
      return;
    }
    const mimeType = recorder.mimeType || "audio/webm";
    const blob = new Blob(this.chunks, { type: mimeType });
    const durationMs = Date.now() - this.startedAt;
    this.release();
    this.settle = null;
    if (error || blob.size === 0) {
      settle.reject(error ?? new Error("Nothing was recorded"));
      return;
    }
    const extension = mimeType.startsWith("audio/mp4") ? "m4a" : "webm";
    settle.resolve({ blob, mimeType, durationMs, file: new File([blob], `recording-${Date.now()}.${extension}`, { type: mimeType }) });
  }

  private release(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }
}
