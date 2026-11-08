import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkTraces, FFMPEG_BINARY, main, MAX_FUNCTION_BYTES, POSTER_ROUTES } from "../../scripts/check-traces";

const SERVER_TRACE = ".next/next-minimal-server.js.nft.json";
const BINARY_BYTES = 4_000;
const SERVER_BYTES = 300;

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
  return checkTraces(root).failures;
}

describe("checkTraces", () => {
  it("passes a build where only the three poster routes carry the ffmpeg binary", () => {
    healthyBuild();

    const report = checkTraces(root);

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

    const upload = checkTraces(root).functions.find((f) => f.route === "/api/upload");

    const entry = "entry".length;
    const shared = "shared".length;
    expect(upload?.bytes).toBe(entry + shared + BINARY_BYTES + "GPL".length + "readme".length + SERVER_BYTES);
    const share = checkTraces(root).functions.find((f) => f.route === "/share");
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

    const report = checkTraces(root);

    expect(report.functions.find((f) => f.route === "/share")?.bytes).toBeGreaterThan(MAX_FUNCTION_BYTES);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain("/share");
    expect(report.failures[0]).toContain("220");
  });

  it("fails loudly when there is no build output", () => {
    const failures = failuresOf();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/\.next\/server\/app.*next build/);
  });

  it("fails loudly when the build has no page or route traces", () => {
    mkdirSync(join(root, ".next/server/app"), { recursive: true });
    file(".next/server/app/page.js", "entry");

    const failures = failuresOf();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("no page or route traces");
  });

  it("fails when the server runtime trace is missing", () => {
    healthyBuild();
    rmSync(join(root, SERVER_TRACE));

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
});

describe("main", () => {
  it("prints each function's size and returns 0 when every rule holds", () => {
    healthyBuild();
    const lines: string[] = [];

    const code = main({ root, log: (line) => lines.push(line), error: (line) => lines.push(line) });

    expect(code).toBe(0);
    const output = lines.join("\n");
    for (const route of [...POSTER_ROUTES, "/share"]) {
      expect(output).toContain(route);
    }
    expect(output).toMatch(/check-traces: OK/);
  });

  it("prints every failure and returns 1 when a rule is broken", () => {
    const errors: string[] = [];

    const code = main({ root, log: () => undefined, error: (line) => errors.push(line) });

    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/\.next\/server\/app.*next build/);
  });
});
