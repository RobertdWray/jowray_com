import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { THIRD_PARTY_FILTER_OPTIONS } from "@/lib/sentry/third-party-filter";

import { APP_KEY_MARK, checkAppKey, INIT_MARK, main } from "../../scripts/check-sentry-app-key";

const INIT_CHUNK = `var o={filterKeys:["jowray_com"],behaviour:"${THIRD_PARTY_FILTER_OPTIONS.behaviour}"};`;
const METADATA = `e._sentryModuleMetadata[n]=Object.assign({},e._sentryModuleMetadata[n],{"${APP_KEY_MARK}":!0});`;

describe("marks", () => {
  it("are the application key the SDK looks for and the literal only our init contains", () => {
    expect(APP_KEY_MARK).toBe("_sentryBundlerPluginAppKey:jowray_com");
    expect(INIT_MARK).toBe("apply-tag-if-exclusively-contains-third-party-frames");
  });
});

describe("checkAppKey", () => {
  it("passes when every chunk with our Sentry init also carries the application key", () => {
    const report = checkAppKey([
      { path: "chunks/a.js", source: `${METADATA}${INIT_CHUNK}` },
      { path: "chunks/b.js", source: METADATA },
      { path: "chunks/polyfills.js", source: "!function(){}();" },
    ]);
    expect(report.failures).toEqual([]);
    expect(report.initChunks).toEqual(["chunks/a.js"]);
    expect(report.keyedChunks).toBe(2);
    expect(report.totalChunks).toBe(3);
  });

  it("fails when the chunk with our Sentry init lost the application key", () => {
    const report = checkAppKey([
      { path: "chunks/a.js", source: INIT_CHUNK },
      { path: "chunks/b.js", source: METADATA },
    ]);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain("chunks/a.js");
    expect(report.failures[0]).toContain(APP_KEY_MARK);
  });

  it("fails when no chunk contains our Sentry init, so it never passes without having found it", () => {
    const report = checkAppKey([{ path: "chunks/b.js", source: METADATA }]);
    expect(report.initChunks).toEqual([]);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain(INIT_MARK);
  });
});

describe("main", () => {
  let root: string;
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "check-sentry-app-key-"));
    lines.length = 0;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function file(path: string, content: string) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }

  it("fails without build output", () => {
    expect(main({ root, log, error: log })).toBe(1);
    expect(lines.join("\n")).toContain(".next/static");
  });

  it("reads JavaScript files under .next/static at any depth and passes a marked build", () => {
    file(".next/static/immutable/chunks/a.js", `${METADATA}${INIT_CHUNK}`);
    file(".next/static/immutable/chunks/b.js", METADATA);
    file(".next/static/immutable/media/font.woff2", INIT_CHUNK);
    expect(main({ root, log, error: log })).toBe(0);
    expect(lines.join("\n")).toContain("check-sentry-app-key: OK");
    expect(lines.join("\n")).toContain("2 of 2 client chunks");
  });

  it("fails a build whose init chunk is unmarked", () => {
    file(".next/static/immutable/chunks/a.js", INIT_CHUNK);
    expect(main({ root, log, error: log })).toBe(1);
    expect(lines.join("\n")).toContain("check-sentry-app-key: FAILED");
  });
});
