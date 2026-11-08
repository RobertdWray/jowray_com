// Checks the build's file traces after `next build` (video posters plan, D1), and the ffmpeg binary itself:
//   (a) each of the three poster routes carries the ffmpeg binary;
//   (b) no other function carries any ffmpeg-static file, whether through its own trace or the files every function
//       shares;
//   (c) no function's traced files, with the files every function shares, exceed 220 MB;
//   (d) the binary is byte for byte the reviewed build: its size and SHA-256 match the pin for this platform (TCR B1-1).
// It reads `.next/server/app/**/{page,route}.js.nft.json` (one per function; each `files` entry is relative to its
// trace). Missing build output, a missing or unreadable function trace, or a traced file that is not on disk fails the
// check: it never passes without having read the traces.
//
// The files every function shares are size addends (and are checked for ffmpeg-static files), each read when present:
// - `.next/next-minimal-server.js.nft.json`, the server runtime. Without a build adapter (local and CI builds), Next
//   writes it, and Vercel's pre-adapter builder adds those files to every function (vercel/vercel#15677). With a build
//   adapter, Next 16.3+ under Turbopack writes neither `next-server.js.nft.json` nor this file (vercel/next.js#93684:
//   "When using an adapter, we don't need to generate any server NFTs as build-complete doesn't use them at all").
//   Vercel builds through its adapter: `@vercel/next` sets `NEXT_ADAPTER_PATH` (vercel/next.js#96657), and the PR #99
//   preview build log shows "Running onBuildComplete from Vercel" before check-traces failed on the missing file
//   (2026-11-08). So when the file is absent, sizes exclude it and the CLI says so.
// - `.next/server/instrumentation.js.nft.json` and `.next/required-server-files.json`'s `files`: the adapter's
//   `getSharedNodeAssets` (next/dist/build/adapter/build-complete.js) adds the instrumentation hook's trace and every
//   required server file to each function, adapter or not (TCR B2-2).
// A shared file that is present but unreadable, or that lists a file not on disk, fails the check.
// Usage: npx tsx scripts/check-traces.ts (`npm run build` runs it after `next build`). Reads files only.
import { createHash } from "node:crypto";
import { closeSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The only functions that may carry ffmpeg (plan D1); next.config.ts adds the binary to exactly these. */
export const POSTER_ROUTES = ["/api/upload", "/api/mcp", "/api/cron/reconcile-uploads"] as const;
export const FFMPEG_BINARY = "node_modules/ffmpeg-static/ffmpeg";
const FFMPEG_PACKAGE = "node_modules/ffmpeg-static";
/** Vercel allows 250 MB uncompressed per function; 220 MB (decimal, the stricter reading) keeps headroom. */
export const MAX_FUNCTION_BYTES = 220_000_000;

export interface BinaryPin {
  /** Lower-case hex SHA-256 of the uncompressed binary. */
  sha256: string;
  bytes: number;
}

/**
 * The reviewed ffmpeg binaries `ffmpeg-static` 5.3.0 installs (its `b6.1.1` release), keyed by
 * `${process.platform}-${process.arch}` of the machine that installs and builds. Each digest is the GitHub release
 * asset digest of the uncompressed `ffmpeg-<platform>-<arch>`; install.js downloads `<name>.gz` and gunzips it to those
 * bytes (checked 2026-11-08 by hashing the gunzipped `ffmpeg-linux-x64.gz`, and the installed darwin-arm64 binary).
 * linux-x64 is CI and Vercel: FFmpeg 7.0.2, a John Van Sickle static build. darwin-arm64 is local development: 6.0.
 * A new binary is a new review: record it in docs/dependencies.md before adding or changing a pin.
 */
export const FFMPEG_BINARY_PINS: Readonly<Record<string, BinaryPin>> = {
  "linux-x64": { sha256: "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99", bytes: 79_826_272 },
  "darwin-arm64": { sha256: "a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584", bytes: 45_568_216 },
};

const APP_DIR = ".next/server/app";
const SERVER_TRACE = ".next/next-minimal-server.js.nft.json";
const INSTRUMENTATION_TRACE = ".next/server/instrumentation.js.nft.json";
const REQUIRED_SERVER_FILES = ".next/required-server-files.json";
const FUNCTION_TRACE = /^(page|route)\.js\.nft\.json$/;

export interface TracedFunction {
  /** The app path, e.g. `/api/upload` or `/s/[inviteToken]`. */
  route: string;
  kind: "page" | "route";
  /** The trace file, relative to the project root. */
  trace: string;
  /** On-disk bytes of every traced file, plus the files every function shares, each physical file counted once. */
  bytes: number;
  /** Whether the function's files (its own and the shared ones) include the ffmpeg binary. */
  hasFfmpeg: boolean;
}

export interface TraceReport {
  functions: TracedFunction[];
  failures: string[];
  /** Whether sizes include the server runtime trace; undefined when it was unreadable or never reached. */
  serverRuntime?: "included" | "absent";
  /** The shared files read and added to every function's size, in reading order. */
  sharedSources?: string[];
  /** The binary, when it matched its pin. */
  binary?: { platform: string } & BinaryPin;
}

export interface CheckOptions {
  /** `${process.platform}-${process.arch}` by default: the build machine, whose binary npm installed. */
  platform?: string;
  pins?: Readonly<Record<string, BinaryPin>>;
}

export type BinaryCheck = { ok: true; binary: { platform: string } & BinaryPin } | { ok: false; failure: string };

class TraceError extends Error {}

const toPosix = (path: string) => path.split(sep).join("/");
const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(1);

function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function isTrace(value: unknown): value is { files: string[] } {
  if (typeof value !== "object" || value === null || !("files" in value) || !Array.isArray(value.files)) {
    return false;
  }
  return value.files.every((file: unknown) => typeof file === "string");
}

/** The physical files a trace lists (symlinks resolved, so an alias and its target count once), and those not on disk. */
function readTrace(root: string, tracePath: string): { files: string[]; missing: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(root, tracePath), "utf8"));
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new TraceError(`${tracePath} is not a readable nft JSON file (${reason})`);
  }
  if (!isTrace(parsed)) {
    throw new TraceError(`${tracePath} has no "files" list of strings`);
  }
  if ("additionalRoots" in parsed) {
    throw new TraceError(`${tracePath} uses "additionalRoots", which check-traces does not read; extend it before relying on it`);
  }
  const traceDir = dirname(join(root, tracePath));
  const files: string[] = [];
  const missing: string[] = [];
  for (const entry of parsed.files) {
    const path = resolve(traceDir, entry);
    try {
      files.push(realpathSync(path));
    } catch {
      missing.push(toPosix(relative(root, path)));
    }
  }
  return { files, missing };
}

/** `.next/required-server-files.json`'s `files`, paths relative to the project root, resolved like a trace's. */
function readRequiredServerFiles(root: string): { files: string[]; missing: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(root, REQUIRED_SERVER_FILES), "utf8"));
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new TraceError(`${REQUIRED_SERVER_FILES} is not a readable JSON file (${reason})`);
  }
  if (!isTrace(parsed)) {
    throw new TraceError(`${REQUIRED_SERVER_FILES} has no "files" list of strings`);
  }
  const files: string[] = [];
  const missing: string[] = [];
  for (const entry of parsed.files) {
    const path = resolve(root, entry);
    try {
      files.push(realpathSync(path));
    } catch {
      missing.push(toPosix(relative(root, path)));
    }
  }
  return { files, missing };
}

/** The SHA-256 of a file, read in 1 MiB chunks. */
function sha256Of(path: string): string {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    for (let read = readSync(fd, chunk); read > 0; read = readSync(fd, chunk)) {
      hash.update(chunk.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * Whether `node_modules/ffmpeg-static/ffmpeg` is the reviewed build for `platform`: its size, then its SHA-256. A
 * platform with no pin fails: an unreviewed binary never passes. `ffmpeg-static`'s install script checks nothing, so
 * this is what catches a stale cached download, an `FFMPEG_BINARIES_URL` or `FFMPEG_BINARY_RELEASE` override at install
 * time, or a release whose bytes changed.
 */
export function verifyFfmpegBinary(projectRoot: string, platform: string, pins: Readonly<Record<string, BinaryPin>> = FFMPEG_BINARY_PINS): BinaryCheck {
  const pin = pins[platform];
  if (pin === undefined) {
    return {
      ok: false,
      failure: `No pinned SHA-256 for the ${platform} ffmpeg binary, so it cannot be verified. Review that build, then add its digest and size to FFMPEG_BINARY_PINS in scripts/check-traces.ts (docs/dependencies.md).`,
    };
  }
  const path = join(projectRoot, FFMPEG_BINARY);
  const stats = statSync(path, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isFile()) {
    return {
      ok: false,
      failure: `${FFMPEG_BINARY} is missing, so it cannot be verified: npm did not run ffmpeg-static's install script (allowScripts in package.json).`,
    };
  }
  const fix = `Reinstall ffmpeg-static from a clean cache, or review the new binary and update its pin in FFMPEG_BINARY_PINS (docs/dependencies.md). Never set FFMPEG_BINARIES_URL or FFMPEG_BINARY_RELEASE.`;
  if (stats.size !== pin.bytes) {
    return { ok: false, failure: `${FFMPEG_BINARY} is ${stats.size} bytes, not the ${pin.bytes} of the reviewed ${platform} build. ${fix}` };
  }
  const sha256 = sha256Of(path);
  if (sha256 !== pin.sha256) {
    return { ok: false, failure: `${FFMPEG_BINARY} has SHA-256 ${sha256}, not the reviewed ${platform} build's ${pin.sha256}. ${fix}` };
  }
  return { ok: true, binary: { platform, ...pin } };
}

/** Every `{page,route}.js.nft.json` under the app output, as root-relative paths, sorted. */
function findFunctionTraces(root: string): string[] {
  return readdirSync(join(root, APP_DIR), { recursive: true, encoding: "utf8" })
    .filter((path) => FUNCTION_TRACE.test(basename(path)))
    .map((path) => toPosix(join(APP_DIR, path)))
    .sort();
}

function describeFunction(tracePath: string): Pick<TracedFunction, "route" | "kind"> {
  const kind = basename(tracePath).startsWith("page.") ? "page" : "route";
  const dir = toPosix(relative(APP_DIR, dirname(tracePath)));
  return { route: dir === "" ? "/" : `/${dir}`, kind };
}

function listSome(paths: string[]): string {
  const shown = paths.slice(0, 5).join(", ");
  return paths.length > 5 ? `${shown} and ${paths.length - 5} more` : shown;
}

export function checkTraces(projectRoot: string, { platform = `${process.platform}-${process.arch}`, pins = FFMPEG_BINARY_PINS }: CheckOptions = {}): TraceReport {
  const root = realpathOr(resolve(projectRoot));
  const binaryCheck = verifyFfmpegBinary(root, platform, pins);
  const report = checkFunctionTraces(root);
  if (!binaryCheck.ok) {
    return { ...report, failures: [binaryCheck.failure, ...report.failures] };
  }
  return { ...report, binary: binaryCheck.binary };
}

function checkFunctionTraces(root: string): TraceReport {
  try {
    if (!statSync(join(root, APP_DIR)).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    return { functions: [], failures: [`No build output at ${APP_DIR}; run \`next build\` first (check-traces reads its file traces).`] };
  }
  const traces = findFunctionTraces(root);
  if (traces.length === 0) {
    return {
      functions: [],
      failures: [`Found no page or route traces (*.nft.json) under ${APP_DIR}; the build output layout may have changed, so the traces were not checked.`],
    };
  }

  const failures: string[] = [];
  const binary = realpathOr(join(root, FFMPEG_BINARY));
  const ffmpegPackage = realpathOr(join(root, FFMPEG_PACKAGE));
  const isFfmpegFile = (path: string) => path === ffmpegPackage || path.startsWith(ffmpegPackage + sep);
  const names = (paths: string[]) => [...new Set(paths)].map((path) => toPosix(relative(root, path)));

  // The files every function shares. Each source is read only when present; a present one that cannot be read fails.
  let serverRuntime: TraceReport["serverRuntime"];
  const sharedSources: string[] = [];
  const sharedFiles: string[] = [];
  const readShared = (source: string, read: () => { files: string[]; missing: string[] }): boolean => {
    try {
      const { files, missing } = read();
      sharedSources.push(source);
      sharedFiles.push(...files);
      if (missing.length > 0) {
        failures.push(`${source} lists files that are not on disk: ${listSome(missing)}`);
      }
      const leaked = files.filter(isFfmpegFile);
      if (leaked.length > 0) {
        failures.push(
          `${source} carries ffmpeg-static files (${listSome(names(leaked))}), and every function gets it; only ${POSTER_ROUTES.join(", ")} may (plan D1). Find the import that reaches the poster code from shared server code.`,
        );
      }
      return true;
    } catch (error) {
      failures.push(error instanceof TraceError ? error.message : String(error));
      return false;
    }
  };
  const present = (path: string) => statSync(join(root, path), { throwIfNoEntry: false }) !== undefined;
  if (!present(SERVER_TRACE)) {
    serverRuntime = "absent"; // an adapter build (see the header): nothing to add
  } else if (readShared(SERVER_TRACE, () => readTrace(root, SERVER_TRACE))) {
    serverRuntime = "included";
  }
  if (present(INSTRUMENTATION_TRACE)) {
    readShared(INSTRUMENTATION_TRACE, () => readTrace(root, INSTRUMENTATION_TRACE));
  }
  if (present(REQUIRED_SERVER_FILES)) {
    readShared(REQUIRED_SERVER_FILES, () => readRequiredServerFiles(root));
  }
  const sharedSize = sharedSources.length > 0 ? `with the files every function shares (${sharedSources.join(", ")})` : "with no shared server files found to add";

  const sizes = new Map<string, number>();
  const sizeOf = (path: string) => {
    let size = sizes.get(path);
    if (size === undefined) {
      const stats = statSync(path);
      // Directories (symlinked package aliases) weigh nothing themselves; their files are listed on their own.
      size = stats.isFile() ? stats.size : 0;
      sizes.set(path, size);
    }
    return size;
  };

  const functions: TracedFunction[] = [];
  const traced = new Set<string>();
  for (const trace of traces) {
    const { route, kind } = describeFunction(trace);
    traced.add(`${kind} ${route}`);
    let files: string[];
    try {
      const read = readTrace(root, trace);
      files = read.files;
      if (read.missing.length > 0) {
        failures.push(`${route} (${trace}) lists files that are not on disk: ${listSome(read.missing)}`);
      }
    } catch (error) {
      failures.push(error instanceof TraceError ? error.message : String(error));
      continue;
    }

    const unique = new Set([...files, ...sharedFiles]);
    let bytes = 0;
    for (const path of unique) {
      bytes += sizeOf(path);
    }
    const hasFfmpeg = unique.has(binary);
    functions.push({ route, kind, trace, bytes, hasFfmpeg });

    const isPosterRoute = kind === "route" && (POSTER_ROUTES as readonly string[]).includes(route);
    if (isPosterRoute && !hasFfmpeg) {
      failures.push(
        `${route} (${trace}) lacks ${FFMPEG_BINARY}, so it cannot make posters. Check outputFileTracingIncludes in next.config.ts, and that npm ran ffmpeg-static's install script (allowScripts in package.json).`,
      );
    }
    // A shared file is reported once, above, for its source; this is the function's own trace.
    const leaked = files.filter(isFfmpegFile);
    if (!isPosterRoute && leaked.length > 0) {
      failures.push(
        `${route} (${kind}) carries ffmpeg-static files (${listSome(names(leaked))}); only ${POSTER_ROUTES.join(", ")} may (plan D1). Find the import that reaches the poster code from this ${kind}.`,
      );
    }
    if (bytes > MAX_FUNCTION_BYTES) {
      failures.push(
        `${route} (${kind}) traces ${megabytes(bytes)} MB ${sharedSize}, over the ${megabytes(MAX_FUNCTION_BYTES)} MB limit (Vercel allows 250 MB uncompressed per function).`,
      );
    }
  }

  for (const route of POSTER_ROUTES) {
    if (!traced.has(`route ${route}`)) {
      failures.push(`${route} has no route trace under ${APP_DIR}, so the ffmpeg binary cannot be in its function.`);
    }
  }
  return { functions, failures, serverRuntime, sharedSources };
}

export function main({
  root = join(import.meta.dirname, ".."),
  platform,
  pins,
  log = console.log,
  error = console.error,
}: CheckOptions & {
  root?: string;
  log?: (line: string) => void;
  error?: (line: string) => void;
} = {}): number {
  const { functions, failures, serverRuntime, sharedSources = [], binary } = checkTraces(root, { platform, pins });
  if (binary) {
    log(`check-traces: The ffmpeg binary matches its ${binary.platform} pin (sha256 ${binary.sha256}, ${binary.bytes} bytes).`);
  }
  if (serverRuntime === "included") {
    log(`check-traces: Sizes include the server runtime (${SERVER_TRACE}).`);
  } else if (serverRuntime === "absent") {
    log(
      `check-traces: ${SERVER_TRACE} is absent (Next writes no server traces when a build adapter is set, as on Vercel), so sizes exclude the server runtime.`,
    );
  }
  if (sharedSources.length > 0) {
    log(`check-traces: Every function's size includes the files it shares from ${sharedSources.join(", ")}.`);
  }
  if (functions.length > 0) {
    log("check-traces: traced size per function (largest first)");
    const bySize = [...functions].sort((a, b) => b.bytes - a.bytes || a.route.localeCompare(b.route));
    for (const { bytes, kind, route, hasFfmpeg } of bySize) {
      log(`  ${megabytes(bytes).padStart(6)} MB  ${kind.padEnd(5)}  ${route}${hasFfmpeg ? "  (ffmpeg)" : ""}`);
    }
  }
  if (failures.length > 0) {
    error(`check-traces: FAILED (${failures.length} ${failures.length === 1 ? "problem" : "problems"})`);
    for (const failure of failures) {
      error(`  - ${failure}`);
    }
    return 1;
  }
  log(
    `check-traces: OK (${functions.length} functions; ffmpeg only in ${POSTER_ROUTES.join(", ")}; binary sha256 verified; each at most ${megabytes(MAX_FUNCTION_BYTES)} MB)`,
  );
  return 0;
}

/**
 * Whether the module at `moduleUrl` is the process's entry script (`tsx scripts/check-traces.ts`), compared by real
 * path, so a symlinked or relative argv[1] still counts and another file with the same name never does (TCR B2-7: a
 * missed match would skip the gate and let the build pass).
 */
export function isEntrypoint(moduleUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) {
    return false;
  }
  const entry = statSync(argv1, { throwIfNoEntry: false });
  return entry !== undefined && realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  process.exitCode = main();
}
