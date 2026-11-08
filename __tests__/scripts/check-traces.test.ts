import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type BinaryPin, checkTraces, FFMPEG_BINARY, FFMPEG_BINARY_PINS, isEntrypoint, main, MAX_FUNCTION_BYTES, POSTER_ROUTES, verifyFfmpegBinary,
} from "../../scripts/check-traces";

const SERVER_TRACE = ".next/next-minimal-server.js.nft.json";
const INSTRUMENTATION_TRACE = ".next/server/instrumentation.js.nft.json";
const REQUIRED_SERVER_FILES = ".next/required-server-files.json";
const BINARY_BYTES = 4_000;
const SERVER_BYTES = 300;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
/** The fixture binary is a sparse file of zeros; the fixture platform pins exactly those bytes. */
const PLATFORM = "test-x64";
const PINS: Record<string, BinaryPin> = { [PLATFORM]: { sha256: sha256(Buffer.alloc(BINARY_BYTES)), bytes: BINARY_BYTES } };
const OPTIONS = { platform: PLATFORM, pins: PINS };

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "check-traces-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes a file under the fixture root: text, or a sparse file of the given size. */
function file(path: string, content: string | number = "x") {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  if (typeof content === "number") {
    writeFileSync(absolute, "");
    truncateSync(absolute, content);
  } else {
    writeFileSync(absolute, content);
  }
}

/** Writes an nft trace whose `files` are relative to the trace, as Next writes them. */
function trace(tracePath: string, files: string[]) {
  const absolute = join(root, tracePath);
  mkdirSync(dirname(absolute), { recursive: true });
  const traceDir = dirname(absolute);
  writeFileSync(absolute, JSON.stringify({ version: 1, files: files.map((path) => relative(traceDir, join(root, path))) }));
}

function appTracePath(route: string, kind: "page" | "route") {
  return `.next/server/app${route === "/" ? "" : route}/${kind}.js.nft.json`;
}

/** A page or route function: its compiled entry plus the given project files. */
function fn(route: string, kind: "page" | "route", files: string[] = []) {
  const entry = appTracePath(route, kind).replace(/\.nft\.json$/, "");
  file(entry, "entry");
  trace(appTracePath(route, kind), [entry, "node_modules/next/dist/shared.js", ...files]);
}

const FFMPEG_FILES = [FFMPEG_BINARY, "node_modules/ffmpeg-static/ffmpeg.LICENSE", "node_modules/ffmpeg-static/ffmpeg.README"];

/** A build that satisfies every rule: only the three poster routes carry ffmpeg. */
function healthyBuild() {
  file(FFMPEG_BINARY, BINARY_BYTES);
  file("node_modules/ffmpeg-static/ffmpeg.LICENSE", "GPL");
  file("node_modules/ffmpeg-static/ffmpeg.README", "readme");
  file("node_modules/ffmpeg-static/index.js", "module.exports = __dirname");
  file("node_modules/next/dist/shared.js", "shared");
  file("node_modules/next/dist/server.runtime.prod.js", SERVER_BYTES);
  trace(SERVER_TRACE, ["node_modules/next/dist/server.runtime.prod.js", "node_modules/next/dist/shared.js"]);
  for (const route of POSTER_ROUTES) {
    fn(route, "route", FFMPEG_FILES);
  }
  fn("/", "page");
  fn("/share", "page");
  fn("/s/[inviteToken]", "page");
  fn("/api/media/[id]", "route");
}

function failuresOf() {
  return checkTraces(root, OPTIONS).failures;
}

describe("checkTraces", () => {
  it("passes a build where only the three poster routes carry the ffmpeg binary", () => {
    healthyBuild();

    const report = checkTraces(root, OPTIONS);

    expect(report.failures).toEqual([]);
    const byRoute = new Map(report.functions.map((f) => [f.route, f]));
    expect([...byRoute.keys()].sort()).toEqual(
      ["/", "/api/cron/reconcile-uploads", "/api/mcp", "/api/media/[id]", "/api/upload", "/s/[inviteToken]", "/share"],
    );
    for (const route of POSTER_ROUTES) {
      expect(byRoute.get(route)).toMatchObject({ kind: "route", hasFfmpeg: true });
    }
    expect(byRoute.get("/share")).toMatchObject({ kind: "page", hasFfmpeg: false });
    expect(byRoute.get("/")).toMatchObject({ kind: "page", hasFfmpeg: false });
  });

  it("sums each function's files once, together with the server runtime every function carries", () => {
    healthyBuild();
    // The same binary reached again through a symlink (Turbopack lists `.next/node_modules` aliases) counts once.
    symlinkSync(join(root, "node_modules/ffmpeg-static"), join(root, ".next/ffmpeg-alias"));
    trace(appTracePath("/api/upload", "route"), [
      ".next/server/app/api/upload/route.js",
      "node_modules/next/dist/shared.js",
      ...FFMPEG_FILES,
      ".next/ffmpeg-alias/ffmpeg",
      ".next/ffmpeg-alias",
    ]);

    const upload = checkTraces(root, OPTIONS).functions.find((f) => f.route === "/api/upload");

    const entry = "entry".length;
    const shared = "shared".length;
    expect(upload?.bytes).toBe(entry + shared + BINARY_BYTES + "GPL".length + "readme".length + SERVER_BYTES);
    const share = checkTraces(root, OPTIONS).functions.find((f) => f.route === "/share");
    expect(share?.bytes).toBe(entry + shared + SERVER_BYTES);
  });

  it("fails when a poster route's trace lacks the ffmpeg binary", () => {
    healthyBuild();
    fn("/api/mcp", "route", ["node_modules/ffmpeg-static/ffmpeg.LICENSE"]);

    const failures = failuresOf();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("/api/mcp");
    expect(failures[0]).toContain(FFMPEG_BINARY);
  });

  it("fails when a poster route has no trace at all", () => {
    healthyBuild();
    rmSync(join(root, appTracePath("/api/cron/reconcile-uploads", "route")));

    const failures = failuresOf();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("/api/cron/reconcile-uploads");
  });

  it("fails when the ffmpeg binary is traced into a page", () => {
    healthyBuild();
    fn("/share", "page", [FFMPEG_BINARY]);

    const failures = failuresOf();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("/share");
    expect(failures[0]).toContain(FFMPEG_BINARY);
  });

  it("fails when any ffmpeg-static file reaches a function other than the three poster routes", () => {
    healthyBuild();
    fn("/api/media/[id]", "route", ["node_modules/ffmpeg-static/index.js"]);

    const failures = failuresOf();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("/api/media/[id]");
    expect(failures[0]).toContain("node_modules/ffmpeg-static/index.js");
  });

  it("fails when a function's traced files exceed 220 MB", () => {
    expect(MAX_FUNCTION_BYTES).toBe(220_000_000);
    healthyBuild();
    file("node_modules/huge/blob.bin", MAX_FUNCTION_BYTES); // sparse: no real disk use
    fn("/share", "page", ["node_modules/huge/blob.bin"]);

    const report = checkTraces(root, OPTIONS);

    expect(report.functions.find((f) => f.route === "/share")?.bytes).toBeGreaterThan(MAX_FUNCTION_BYTES);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain("/share");
    expect(report.failures[0]).toContain("220");
  });

  it("fails loudly when there is no build output", () => {
    file(FFMPEG_BINARY, BINARY_BYTES);

    const failures = failuresOf();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/\.next\/server\/app.*next build/);
  });

  it("fails loudly when the build has no page or route traces", () => {
    file(FFMPEG_BINARY, BINARY_BYTES);
    mkdirSync(join(root, ".next/server/app"), { recursive: true });
    file(".next/server/app/page.js", "entry");

    const failures = failuresOf();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("no page or route traces");
  });

  it("still checks every rule without the server runtime trace (adapter builds, as on Vercel), and sizes exclude it", () => {
    healthyBuild();
    rmSync(join(root, SERVER_TRACE));

    const report = checkTraces(root, OPTIONS);

    expect(report.failures).toEqual([]);
    expect(report.serverRuntime).toBe("absent");
    expect(report.functions.find((f) => f.route === "/share")?.bytes).toBe("entry".length + "shared".length);
    expect(report.functions.find((f) => f.route === "/api/upload")).toMatchObject({ hasFfmpeg: true });
  });

  it("still fails a broken rule when the server runtime trace is absent", () => {
    healthyBuild();
    rmSync(join(root, SERVER_TRACE));
    fn("/share", "page", [FFMPEG_BINARY]);

    const failures = failuresOf();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("/share");
  });

  it("includes the server runtime in sizes when its trace is present", () => {
    healthyBuild();

    expect(checkTraces(root, OPTIONS).serverRuntime).toBe("included");
  });

  it("fails when the server runtime trace is present but not valid nft JSON", () => {
    healthyBuild();
    writeFileSync(join(root, SERVER_TRACE), "{ not json");

    const report = checkTraces(root, OPTIONS);

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain("next-minimal-server.js.nft.json");
    expect(report.serverRuntime).toBeUndefined();
  });

  it("fails when the server runtime trace is present but has no files list", () => {
    healthyBuild();
    writeFileSync(join(root, SERVER_TRACE), JSON.stringify({ version: 1 }));

    const failures = failuresOf();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("next-minimal-server.js.nft.json");
  });

  it("fails when a trace lists a file that is not on disk", () => {
    healthyBuild();
    fn("/share", "page", ["node_modules/gone/index.js"]);

    const failures = failuresOf();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("/share");
    expect(failures[0]).toContain("node_modules/gone/index.js");
  });

  it("fails when a trace is not valid nft JSON", () => {
    healthyBuild();
    writeFileSync(join(root, appTracePath("/share", "page")), "{ not json");

    const failures = failuresOf();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(appTracePath("/share", "page"));
  });

  describe("files every function shares (TCR B1-3, B2-2)", () => {
    /** The instrumentation hook's trace and entry, and Next's required server files, as a build writes them. */
    function sharedServerFiles({ instrumentationBytes = 500, manifestBytes = 70 } = {}) {
      file(".next/server/instrumentation.js", "instrumentation");
      file("node_modules/@sentry/core/build/index.js", instrumentationBytes);
      trace(INSTRUMENTATION_TRACE, ["node_modules/@sentry/core/build/index.js", "node_modules/next/dist/shared.js"]);
      file(".next/routes-manifest.json", manifestBytes);
      writeFileSync(join(root, REQUIRED_SERVER_FILES), JSON.stringify({ version: 1, files: [".next/routes-manifest.json", ".next/server/instrumentation.js", REQUIRED_SERVER_FILES] }));
    }

    it("adds the instrumentation trace and the required server files to every function's size, without the server runtime too", () => {
      healthyBuild();
      rmSync(join(root, SERVER_TRACE));
      sharedServerFiles();
      const requiredBytes = 70 + "instrumentation".length + JSON.stringify({ version: 1, files: [".next/routes-manifest.json", ".next/server/instrumentation.js", REQUIRED_SERVER_FILES] }).length;

      const report = checkTraces(root, OPTIONS);

      expect(report.failures).toEqual([]);
      expect(report.sharedSources).toEqual([INSTRUMENTATION_TRACE, REQUIRED_SERVER_FILES]);
      // `shared.js` is in the function's own trace and the instrumentation trace: counted once.
      expect(report.functions.find((f) => f.route === "/share")?.bytes).toBe("entry".length + "shared".length + 500 + requiredBytes);
    });

    it("adds them on top of the server runtime when the build wrote it", () => {
      healthyBuild();
      sharedServerFiles();

      const report = checkTraces(root, OPTIONS);

      expect(report.sharedSources).toEqual([SERVER_TRACE, INSTRUMENTATION_TRACE, REQUIRED_SERVER_FILES]);
      expect(report.functions.find((f) => f.route === "/share")?.bytes).toBeGreaterThan("entry".length + "shared".length + SERVER_BYTES + 500);
    });

    it("fails a function that the shared files push over 220 MB", () => {
      healthyBuild();
      rmSync(join(root, SERVER_TRACE));
      sharedServerFiles({ instrumentationBytes: MAX_FUNCTION_BYTES }); // sparse

      const failures = failuresOf();

      expect(failures.length).toBeGreaterThan(0);
      expect(failures.every((failure) => failure.includes("220"))).toBe(true);
      expect(failures.find((failure) => failure.includes("/share"))).toContain(INSTRUMENTATION_TRACE);
    });

    it.each([
      ["the server runtime trace", SERVER_TRACE],
      ["the instrumentation trace", INSTRUMENTATION_TRACE],
    ])("fails once when %s carries an ffmpeg-static file, since every function gets it", (_name, sharedTrace) => {
      healthyBuild();
      sharedServerFiles();
      trace(sharedTrace, ["node_modules/next/dist/shared.js", "node_modules/ffmpeg-static/index.js"]);

      const failures = failuresOf();

      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain(sharedTrace);
      expect(failures[0]).toContain("node_modules/ffmpeg-static/index.js");
      expect(failures[0]).toContain("every function");
    });

    it("fails once when the required server files list an ffmpeg-static file", () => {
      healthyBuild();
      sharedServerFiles();
      writeFileSync(join(root, REQUIRED_SERVER_FILES), JSON.stringify({ version: 1, files: [FFMPEG_BINARY] }));

      const failures = failuresOf();

      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain(REQUIRED_SERVER_FILES);
      expect(failures[0]).toContain(FFMPEG_BINARY);
    });

    it("fails when the instrumentation trace is present but not valid nft JSON", () => {
      healthyBuild();
      sharedServerFiles();
      writeFileSync(join(root, INSTRUMENTATION_TRACE), "{ not json");

      const report = checkTraces(root, OPTIONS);

      expect(report.failures).toHaveLength(1);
      expect(report.failures[0]).toContain(INSTRUMENTATION_TRACE);
    });

    it("fails when the required server files manifest has no files list, or lists a file that is not on disk", () => {
      healthyBuild();
      sharedServerFiles();
      writeFileSync(join(root, REQUIRED_SERVER_FILES), JSON.stringify({ version: 1 }));
      expect(failuresOf()).toEqual([expect.stringContaining(REQUIRED_SERVER_FILES)]);

      writeFileSync(join(root, REQUIRED_SERVER_FILES), JSON.stringify({ version: 1, files: [".next/gone.json"] }));
      const failures = failuresOf();
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain(".next/gone.json");
    });

    it("names no server runtime in the over-limit message when the build wrote none", () => {
      healthyBuild();
      rmSync(join(root, SERVER_TRACE));
      file("node_modules/huge/blob.bin", MAX_FUNCTION_BYTES);
      fn("/share", "page", ["node_modules/huge/blob.bin"]);

      const failures = failuresOf();

      expect(failures).toHaveLength(1);
      expect(failures[0]).not.toContain("server runtime");
      expect(failures[0]).toContain("no shared server files");
    });
  });

  describe("the ffmpeg binary's pinned SHA-256 (TCR B1-1)", () => {
    it("passes, and reports the digest, when the binary is exactly the pinned bytes", () => {
      healthyBuild();

      const report = checkTraces(root, OPTIONS);

      expect(report.failures).toEqual([]);
      expect(report.binary).toEqual({ platform: PLATFORM, sha256: PINS[PLATFORM]!.sha256, bytes: BINARY_BYTES });
    });

    it("fails when the binary has the pinned size but other bytes (a stale cache, an override URL, a changed release)", () => {
      healthyBuild();
      writeFileSync(join(root, FFMPEG_BINARY), Buffer.alloc(BINARY_BYTES, 1));

      const failures = failuresOf();

      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain(FFMPEG_BINARY);
      expect(failures[0]).toContain(sha256(Buffer.alloc(BINARY_BYTES, 1)));
      expect(failures[0]).toContain(PINS[PLATFORM]!.sha256);
    });

    it("fails on a size mismatch without hashing", () => {
      healthyBuild();
      file(FFMPEG_BINARY, BINARY_BYTES + 1);

      const failures = failuresOf();

      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain(`${BINARY_BYTES + 1} bytes`);
      expect(failures[0]).toContain(`${BINARY_BYTES}`);
    });

    it("fails, never passes, on a platform with no pinned hash, and says to add one", () => {
      healthyBuild();

      const failures = checkTraces(root, { platform: "linux-riscv64", pins: PINS }).failures;

      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain("linux-riscv64");
      expect(failures[0]).toContain("FFMPEG_BINARY_PINS");
    });

    it("fails when the binary is missing (the install script did not run)", () => {
      healthyBuild();
      rmSync(join(root, FFMPEG_BINARY));
      for (const route of POSTER_ROUTES) {
        fn(route, "route", FFMPEG_FILES.slice(1));
      }

      const failures = failuresOf();

      expect(failures.some((failure) => failure.includes(`${FFMPEG_BINARY} is missing`))).toBe(true);
    });

    it("pins the reviewed b6.1.1 builds: linux-x64 (CI and Vercel) and darwin-arm64 (local development)", () => {
      expect(FFMPEG_BINARY_PINS["linux-x64"]).toEqual({ sha256: "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99", bytes: 79_826_272 });
      expect(FFMPEG_BINARY_PINS["darwin-arm64"]).toEqual({ sha256: "a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584", bytes: 45_568_216 });
    });

    const here = `${process.platform}-${process.arch}`;
    it.runIf(here in FFMPEG_BINARY_PINS)(`the installed ffmpeg-static binary matches its ${here} pin`, () => {
      expect(verifyFfmpegBinary(resolve(__dirname, "../.."), here)).toEqual({ ok: true, binary: { platform: here, ...FFMPEG_BINARY_PINS[here] } });
    });
  });
});

describe("main", () => {
  it("prints each function's size and returns 0 when every rule holds", () => {
    healthyBuild();
    const lines: string[] = [];

    const code = main({ root, ...OPTIONS, log: (line) => lines.push(line), error: (line) => lines.push(line) });

    expect(code).toBe(0);
    const output = lines.join("\n");
    for (const route of [...POSTER_ROUTES, "/share"]) {
      expect(output).toContain(route);
    }
    expect(output).toMatch(/check-traces: OK/);
    expect(output).toContain("Sizes include the server runtime (.next/next-minimal-server.js.nft.json)");
  });

  it("says so explicitly when the server runtime trace is absent, and still returns 0", () => {
    healthyBuild();
    rmSync(join(root, SERVER_TRACE));
    const lines: string[] = [];

    const code = main({ root, ...OPTIONS, log: (line) => lines.push(line), error: (line) => lines.push(line) });

    expect(code).toBe(0);
    const output = lines.join("\n");
    expect(output).toContain(".next/next-minimal-server.js.nft.json is absent");
    expect(output).toContain("sizes exclude the server runtime");
    expect(output).not.toContain("Sizes include the server runtime");
    expect(output).toMatch(/check-traces: OK/);
  });

  it("names the shared server files the sizes include and the binary's verified digest", () => {
    healthyBuild();
    const lines: string[] = [];

    main({ root, ...OPTIONS, log: (line) => lines.push(line), error: (line) => lines.push(line) });

    const output = lines.join("\n");
    expect(output).toContain(`ffmpeg binary matches its ${PLATFORM} pin (sha256 ${PINS[PLATFORM]!.sha256}`);
    expect(output).toMatch(/check-traces: OK \(.*binary sha256 verified/);
  });

  it("prints every failure and returns 1 when a rule is broken", () => {
    const errors: string[] = [];

    const code = main({ root, ...OPTIONS, log: () => undefined, error: (line) => errors.push(line) });

    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/\.next\/server\/app.*next build/);
  });
});

describe("isEntrypoint (TCR B2-7: the gate must never be skipped silently)", () => {
  const script = resolve(__dirname, "../../scripts/check-traces.ts");

  it("is true for this module run as the entry script, by absolute, relative or symlinked path", () => {
    const url = pathToFileURL(script).href;
    expect(isEntrypoint(url, script)).toBe(true);
    expect(isEntrypoint(url, relative(process.cwd(), script))).toBe(true);
    const link = join(root, "linked-check-traces.ts");
    symlinkSync(script, link);
    expect(isEntrypoint(url, link)).toBe(true);
  });

  it("is false for another script, even one with the same basename, and with no entry script", () => {
    const url = pathToFileURL(script).href;
    const impostor = join(root, "check-traces.ts");
    writeFileSync(impostor, "");
    expect(isEntrypoint(url, impostor)).toBe(false);
    expect(isEntrypoint(url, undefined)).toBe(false);
    expect(isEntrypoint(url, join(root, "missing.ts"))).toBe(false);
  });

  it("runs main when tsx runs the script (as `npm run build` does)", async () => {
    const tsx = resolve(__dirname, "../../node_modules/.bin/tsx");
    const output = await new Promise<string>((resolveOutput, reject) => {
      execFile(tsx, [script], { cwd: root, timeout: 60_000 }, (error, stdout, stderr) => {
        // Exit 1 (a failed check) still proves main ran; only a launch failure or a timeout is an error here.
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolveOutput(`${stdout}${stderr}`);
      });
    });
    expect(output).toMatch(/^check-traces: /m);
  }, 60_000);
});
