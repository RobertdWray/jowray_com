// Checks the build's file traces after `next build` (video posters plan, D1):
//   (a) each of the three poster routes carries the ffmpeg binary;
//   (b) no other function carries any ffmpeg-static file;
//   (c) no function's traced files, together with the server runtime every function carries, exceed 220 MB.
// It reads `.next/server/app/**/{page,route}.js.nft.json` (one per function; each `files` entry is relative to its
// trace) and `.next/next-minimal-server.js.nft.json`, which Vercel's builder adds to every function
// (vercel/vercel#15677). Missing build output, a missing or unreadable trace, or a traced file that is not on disk
// fails the check: it never passes without having read the traces.
// Usage: npx tsx scripts/check-traces.ts (`npm run build` runs it after `next build`). Reads files only.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

/** The only functions that may carry ffmpeg (plan D1); next.config.ts adds the binary to exactly these. */
export const POSTER_ROUTES = ["/api/upload", "/api/mcp", "/api/cron/reconcile-uploads"] as const;
export const FFMPEG_BINARY = "node_modules/ffmpeg-static/ffmpeg";
const FFMPEG_PACKAGE = "node_modules/ffmpeg-static";
/** Vercel allows 250 MB uncompressed per function; 220 MB (decimal, the stricter reading) keeps headroom. */
export const MAX_FUNCTION_BYTES = 220_000_000;

const APP_DIR = ".next/server/app";
const SERVER_TRACE = ".next/next-minimal-server.js.nft.json";
const FUNCTION_TRACE = /^(page|route)\.js\.nft\.json$/;

export interface TracedFunction {
  /** The app path, e.g. `/api/upload` or `/s/[inviteToken]`. */
  route: string;
  kind: "page" | "route";
  /** The trace file, relative to the project root. */
  trace: string;
  /** On-disk bytes of every traced file plus the server runtime, each physical file counted once. */
  bytes: number;
  /** Whether the trace includes the ffmpeg binary. */
  hasFfmpeg: boolean;
}

export interface TraceReport {
  functions: TracedFunction[];
  failures: string[];
}

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

export function checkTraces(projectRoot: string): TraceReport {
  const root = realpathOr(resolve(projectRoot));
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
  let serverFiles: string[] = [];
  try {
    const server = readTrace(root, SERVER_TRACE);
    serverFiles = server.files;
    if (server.missing.length > 0) {
      failures.push(`${SERVER_TRACE} lists files that are not on disk: ${listSome(server.missing)}`);
    }
  } catch (error) {
    failures.push(error instanceof TraceError ? error.message : String(error));
  }

  const binary = realpathOr(join(root, FFMPEG_BINARY));
  const ffmpegPackage = realpathOr(join(root, FFMPEG_PACKAGE));
  const isFfmpegFile = (path: string) => path === ffmpegPackage || path.startsWith(ffmpegPackage + sep);
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

    const unique = new Set([...files, ...serverFiles]);
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
    const leaked = files.filter(isFfmpegFile);
    if (!isPosterRoute && leaked.length > 0) {
      const names = [...new Set(leaked)].map((path) => toPosix(relative(root, path)));
      failures.push(
        `${route} (${kind}) carries ffmpeg-static files (${listSome(names)}); only ${POSTER_ROUTES.join(", ")} may (plan D1). Find the import that reaches the poster code from this ${kind}.`,
      );
    }
    if (bytes > MAX_FUNCTION_BYTES) {
      failures.push(
        `${route} (${kind}) traces ${megabytes(bytes)} MB with the server runtime, over the ${megabytes(MAX_FUNCTION_BYTES)} MB limit (Vercel allows 250 MB uncompressed per function).`,
      );
    }
  }

  for (const route of POSTER_ROUTES) {
    if (!traced.has(`route ${route}`)) {
      failures.push(`${route} has no route trace under ${APP_DIR}, so the ffmpeg binary cannot be in its function.`);
    }
  }
  return { functions, failures };
}

export function main({
  root = join(import.meta.dirname, ".."),
  log = console.log,
  error = console.error,
}: {
  root?: string;
  log?: (line: string) => void;
  error?: (line: string) => void;
} = {}): number {
  const { functions, failures } = checkTraces(root);
  if (functions.length > 0) {
    log("check-traces: traced size per function, with the server runtime (largest first)");
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
    `check-traces: OK (${functions.length} functions; ffmpeg only in ${POSTER_ROUTES.join(", ")}; each at most ${megabytes(MAX_FUNCTION_BYTES)} MB)`,
  );
  return 0;
}

const isEntrypoint = basename(process.argv[1] ?? "").replace(/\.ts$/, "") === "check-traces";
if (isEntrypoint) {
  process.exitCode = main();
}
