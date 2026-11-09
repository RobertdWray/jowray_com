// Checks the client build after `next build` (third-party alerts plan, A4): the chunk that holds our Sentry init's
// third-party filter options must carry the `jowray_com` application key.
//
// Why: the SDK tags an error `third_party_code` when none of its stack frames comes from a file the build marked with
// that key, and the production issue alert skips tagged new issues. If the build stopped marking our files (the SDK's
// Turbopack rule runs only for Next.js versions it recognises), every browser error would look third-party and stop
// emailing, silently. This check turns that into a failed build.
//
// It reads `.next/static/**/*.js`. Missing build output, or no chunk containing our init, fails the check: it never
// passes without having found the init.
// Usage: npx tsx scripts/check-sentry-app-key.ts (`npm run build` runs it after check-traces). Reads files only.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { THIRD_PARTY_FILTER_OPTIONS } from "../lib/sentry/third-party-filter";
import { isEntrypoint } from "./check-traces";

/** The SDK's bundler-plugin prefix (`BUNDLER_PLUGIN_APP_KEY_PREFIX` in @sentry/core) followed by our key. */
export const APP_KEY_MARK = `_sentryBundlerPluginAppKey:${THIRD_PARTY_FILTER_OPTIONS.filterKeys[0]}`;
/** Only our init's options contain this literal; the SDK's runtime code never compares against it. */
export const INIT_MARK = THIRD_PARTY_FILTER_OPTIONS.behaviour;
export const STATIC_DIR = ".next/static";

export interface ClientChunk {
  /** Relative to `.next/static`. */
  path: string;
  source: string;
}

export interface AppKeyReport {
  totalChunks: number;
  keyedChunks: number;
  initChunks: string[];
  failures: string[];
}

export function checkAppKey(chunks: readonly ClientChunk[]): AppKeyReport {
  const initChunks = chunks.filter((chunk) => chunk.source.includes(INIT_MARK)).map((chunk) => chunk.path);
  const keyed = new Set(chunks.filter((chunk) => chunk.source.includes(APP_KEY_MARK)).map((chunk) => chunk.path));
  const failures: string[] = [];
  if (initChunks.length === 0) {
    failures.push(`No client chunk contains our Sentry init ("${INIT_MARK}"), so the application key could not be checked.`);
  }
  for (const path of initChunks) {
    if (!keyed.has(path)) {
      failures.push(
        `${path} holds our Sentry init but not "${APP_KEY_MARK}": the build stopped marking our files, so every browser error would be tagged third_party_code and skipped by the issue alert.`,
      );
    }
  }
  return { totalChunks: chunks.length, keyedChunks: keyed.size, initChunks, failures };
}

/** Every `.js` file under `.next/static`, at any depth. */
export function readClientChunks(root: string): ClientChunk[] {
  const base = join(root, STATIC_DIR);
  const chunks: ClientChunk[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        chunks.push({ path: relative(base, path), source: readFileSync(path, "utf8") });
      }
    }
  };
  walk(base);
  return chunks;
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
  if (!statSync(join(root, STATIC_DIR), { throwIfNoEntry: false })?.isDirectory()) {
    error(`check-sentry-app-key: FAILED (no build output at ${STATIC_DIR}; run next build first)`);
    return 1;
  }
  const { totalChunks, keyedChunks, initChunks, failures } = checkAppKey(readClientChunks(root));
  if (failures.length > 0) {
    error(`check-sentry-app-key: FAILED (${failures.length} ${failures.length === 1 ? "problem" : "problems"})`);
    for (const failure of failures) {
      error(`  - ${failure}`);
    }
    return 1;
  }
  log(`check-sentry-app-key: OK (${APP_KEY_MARK} in ${keyedChunks} of ${totalChunks} client chunks, including our Sentry init in ${initChunks.join(", ")})`);
  return 0;
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  process.exitCode = main();
}
