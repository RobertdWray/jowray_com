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

  async start(): Promise<void> {
    const mimeType = pickRecordingType();
    if (!mimeType) {
      throw new Error("Recording is not supported in this browser");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, { mimeType });
    this.recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    this.startedAt = Date.now();
    this.recorder.start(1000);
  }

  stop(): Promise<Recording> {
    const recorder = this.recorder;
    if (!recorder) {
      return Promise.reject(new Error("Not recording"));
    }
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(this.chunks, { type: mimeType });
        const extension = mimeType.startsWith("audio/mp4") ? "m4a" : "webm";
        const file = new File([blob], `recording-${Date.now()}.${extension}`, { type: mimeType });
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = null;
        this.recorder = null;
        resolve({ blob, mimeType, durationMs: Date.now() - this.startedAt, file });
      };
      recorder.stop();
    });
  }

  get isRecording(): boolean {
    return this.recorder?.state === "recording";
  }
}
