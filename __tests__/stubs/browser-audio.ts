import { vi } from "vitest";

import type { RecorderDeps } from "@/app/share/recorder";

export function deferred<T>() {
  return Promise.withResolvers<T>();
}

export class FakeTrack extends EventTarget {
  readonly kind = "audio";
  readyState: MediaStreamTrackState = "live";

  constructor(readonly label = "Test microphone", readonly deviceId = "test-mic") {
    super();
  }

  stop = vi.fn(() => {
    this.readyState = "ended";
  });

  getSettings = vi.fn(() => ({ deviceId: this.deviceId }));
}

export class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}

  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): FakeTrack[] {
    return this.getTracks();
  }
}

class FakeAudioNode {
  readonly connections: FakeAudioNode[] = [];

  connect = vi.fn((destination: FakeAudioNode) => {
    this.connections.push(destination);
    return destination;
  });

  disconnect = vi.fn(() => {
    this.connections.length = 0;
  });
}

class FakeAnalyser extends FakeAudioNode {
  fftSize = 0;
  smoothingTimeConstant = 0;
  level = 0;

  getFloatTimeDomainData(target: Float32Array): void {
    target.fill(this.level);
  }
}

class FakeGain extends FakeAudioNode {
  readonly gain = { value: 1 };
}

export class FakeAudioContext {
  state: AudioContextState = "suspended";
  readonly source = new FakeAudioNode();
  readonly analyser = new FakeAnalyser();
  readonly gain = new FakeGain();
  readonly destination = new FakeAudioNode();

  constructor(public keepSuspended = false) {}

  resume = vi.fn(async () => {
    if (!this.keepSuspended) {
      this.state = "running";
    }
  });

  close = vi.fn(async () => {
    this.state = "closed";
  });

  createMediaStreamSource = vi.fn((_stream: MediaStream) => this.source);
  createAnalyser = vi.fn(() => this.analyser);
  createGain = vi.fn(() => this.gain);
}

export class FakeMediaRecorder {
  state: RecordingState = "inactive";
  ondataavailable: ((event: Pick<BlobEvent, "data">) => void) | null = null;
  onerror: ((event: Event & { error: Error }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(
    public mimeType = "audio/webm;codecs=opus",
    public stopEmitsNoData = false,
  ) {}

  start = vi.fn((_timeslice?: number) => {
    this.state = "recording";
  });

  stop = vi.fn(() => {
    this.state = "inactive";
    if (!this.stopEmitsNoData) {
      this.emitChunk(1);
    }
    this.onstop?.();
  });

  emitChunk(bytes: number): void {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: this.mimeType }) });
  }

  emitError(error: Error): void {
    this.onerror?.(Object.assign(new Event("error"), { error }));
  }
}

type FakeOptions = Partial<RecorderDeps> & {
  label?: string;
  deviceId?: string;
  mimeType?: string;
  keepSuspended?: boolean;
  stopEmitsNoData?: boolean;
  deferGetUserMedia?: boolean;
};

export function makeDeps(overrides: FakeOptions = {}) {
  const track = new FakeTrack(overrides.label, overrides.deviceId);
  const stream = new FakeStream([track]);
  const context = new FakeAudioContext(overrides.keepSuspended);
  const recorder = new FakeMediaRecorder(overrides.mimeType, overrides.stopEmitsNoData);
  const clock = { now: 0 };

  // Adapt the minimal stream and its tracks only at the injected browser boundary.
  const browserStream = stream as unknown as MediaStream;
  // Adapt the minimal context and its nodes only at the injected browser boundary.
  const browserContext = context as unknown as AudioContext;
  // Adapt the minimal recorder and its event handlers only at the injected browser boundary.
  const browserRecorder = recorder as unknown as MediaRecorder;

  const request = deferred<MediaStream>();
  const permission = { ...request, resolve: () => request.resolve(browserStream) };
  if (!overrides.deferGetUserMedia) {
    permission.resolve();
  }

  const deps = {
    getUserMedia: vi.fn<RecorderDeps["getUserMedia"]>(overrides.getUserMedia ?? (() => permission.promise)),
    createAudioContext: vi.fn<RecorderDeps["createAudioContext"]>(overrides.createAudioContext ?? (() => browserContext)),
    createMediaRecorder: vi.fn<RecorderDeps["createMediaRecorder"]>(overrides.createMediaRecorder ?? (() => browserRecorder)),
    isTypeSupported: vi.fn<RecorderDeps["isTypeSupported"]>(overrides.isTypeSupported ?? ((type) => type === recorder.mimeType)),
    now: vi.fn<RecorderDeps["now"]>(overrides.now ?? (() => clock.now)),
  } satisfies RecorderDeps;

  return { deps, context, recorder, stream, track, clock, permission };
}
