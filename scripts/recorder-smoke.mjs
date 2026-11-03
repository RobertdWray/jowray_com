#!/usr/bin/env node
/**
 * Headless-Chromium smoke test for the /share recorder, driven over the
 * DevTools protocol with no dependencies (Node 22's WebSocket).
 *
 *   node scripts/recorder-smoke.mjs --url http://localhost:3101/share --expect hearing
 *   node scripts/recorder-smoke.mjs --url http://localhost:3101/share --expect silent \
 *        --audio-file scripts/fixtures/silence-1s.wav
 *
 * Chrome's fake media device emits an audible beep pattern; with
 * --use-file-for-fake-audio-capture it plays the given 16-bit PCM WAV instead
 * (looped), so a WAV of zeros reproduces the silent-microphone incident.
 * Exit code 0 when the observed status, verdict and player match `--expect`.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith("--")) {
      pairs.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]);
    }
    return pairs;
  }, []),
);
const url = args.url ?? "http://localhost:3101/share";
const expect = args.expect ?? "hearing";
const chrome = args.chrome ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const audioFile = args["audio-file"] ? resolve(args["audio-file"]) : null;
const recordMs = Number(args["record-ms"] ?? 5000);
/** Optional: PNGs of the recording and clip states land here (for the PR). */
const screenshotDir = args["screenshot-dir"] ? resolve(args["screenshot-dir"]) : null;

const userDataDir = mkdtempSync(join(tmpdir(), "recorder-smoke-"));
const flags = [
  "--headless=new",
  "--remote-debugging-port=0",
  `--user-data-dir=${userDataDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  "--mute-audio",
];
if (audioFile) {
  flags.push(`--use-file-for-fake-audio-capture=${audioFile}`);
}
flags.push("about:blank");

const proc = spawn(chrome, flags, { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((resolveUrl, reject) => {
  let buffer = "";
  proc.stderr.on("data", (chunk) => {
    buffer += chunk.toString();
    const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) {
      resolveUrl(match[1]);
    }
  });
  proc.on("exit", (code) => reject(new Error(`Chrome exited early (${code}): ${buffer}`)));
  setTimeout(() => reject(new Error("Chrome did not start")), 15000);
});

const ws = new WebSocket(wsUrl);
await new Promise((ok, fail) => {
  ws.addEventListener("open", ok, { once: true });
  ws.addEventListener("error", fail, { once: true });
});
let nextId = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { ok, fail } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      fail(new Error(message.error.message));
    } else {
      ok(message.result);
    }
  }
});
function send(method, params = {}, sessionId) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((ok, fail) => pending.set(id, { ok, fail }));
}

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 1100, deviceScaleFactor: 2, mobile: false }, sessionId);
await send("Page.navigate", { url }, sessionId);

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "evaluate failed");
  }
  return result.result.value;
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function screenshot(name) {
  if (!screenshotDir) {
    return;
  }
  mkdirSync(screenshotDir, { recursive: true });
  await evaluate(`document.querySelector("#record")?.scrollIntoView({ block: "center" })`);
  const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
  writeFileSync(join(screenshotDir, `${expect}-${name}.png`), Buffer.from(data, "base64"));
}
async function waitFor(expression, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(expression);
    if (value) {
      return value;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
/** A trusted click (real input event) so the AudioContext starts inside a user gesture. */
async function click(buttonText) {
  const rect = await waitFor(
    `(() => { const b = [...document.querySelectorAll("button")].find((el) => el.textContent.includes(${JSON.stringify(buttonText)})); if (!b || b.disabled) return null; const r = b.getBoundingClientRect(); b.scrollIntoView({ block: "center" }); const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`,
    15000,
    `button "${buttonText}"`,
  );
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x: rect.x, y: rect.y, button: "left", clickCount: 1 }, sessionId);
  }
}

const report = { url, expect, audioFile };
try {
  await waitFor(`document.querySelector("#record") !== null`, 30000, "the recorder panel");
  await click("Start recording");
  await waitFor(`document.querySelector("#record [aria-live]") !== null`, 10000, "the meter");
  await sleep(recordMs);
  await screenshot("recording");
  report.status = await evaluate(`document.querySelector("#record [aria-live]")?.textContent.trim() ?? null`);
  report.timer = await evaluate(`document.querySelector("#record .tabular-nums")?.textContent.trim() ?? null`);
  report.usingLine = await evaluate(`[...document.querySelectorAll("#record span")].map((s) => s.textContent).find((t) => t.startsWith("Using:")) ?? null`);
  await click("Stop recording");
  await waitFor(`document.querySelector("#record audio") !== null`, 15000, "the player");
  report.player = await evaluate(`(async () => { const a = document.querySelector("#record audio"); if (!a) return null; if (!Number.isFinite(a.duration) || a.duration === 0) { await new Promise((ok) => { a.addEventListener("loadedmetadata", ok, { once: true }); a.load(); setTimeout(ok, 5000); }); } return { duration: a.duration, src: a.currentSrc.slice(0, 5) }; })()`);
  report.recorded = await evaluate(`[...document.querySelectorAll("#record span")].map((s) => s.textContent).find((t) => t.startsWith("Recorded")) ?? null`);
  report.verdictLine = await evaluate(`[...document.querySelectorAll('#record [role="status"]')].map((p) => p.textContent.trim()).join(" | ") || null`);
  await screenshot("clip");
  report.sendButton = await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Send"))?.textContent.trim() ?? null`);

  const checks = [];
  if (expect === "hearing") {
    checks.push(["status is Hearing you", report.status === "Hearing you"]);
    checks.push(["no silent verdict", !(report.verdictLine ?? "").includes("sounds silent")]);
  } else {
    checks.push(["status warns about silence", report.status === "We're not hearing anything"]);
    checks.push(["clip flagged as suspected silent", (report.verdictLine ?? "").includes("sounds silent")]);
  }
  checks.push(["player has a finite non-zero duration", Boolean(report.player) && Number.isFinite(report.player.duration) && report.player.duration > 0]);
  checks.push(["timer advanced", /^0:0[1-9]|^0:[1-9]/.test(report.timer ?? "")]);
  report.checks = checks;
  report.ok = checks.every(([, passed]) => passed);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.ok = false;
} finally {
  ws.close();
  // Let Chrome finish writing its profile before the directory goes away.
  const exited = new Promise((ok) => proc.once("exit", ok));
  proc.kill("SIGTERM");
  await Promise.race([exited, sleep(5000)]);
  rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
