import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import type { Event, StackFrame, thirdPartyErrorFilterIntegration as ThirdPartyErrorFilterIntegration } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { THIRD_PARTY_FILTER_OPTIONS, untagErrorsWithoutLocatedFrames } from "@/lib/sentry/third-party-filter";

type FilterOptions = Parameters<typeof ThirdPartyErrorFilterIntegration>[0];
type ProcessEvent = NonNullable<ReturnType<typeof ThirdPartyErrorFilterIntegration>["processEvent"]>;

/**
 * The real integration. The Node entry of `@sentry/nextjs` does not export this browser integration, so the test loads
 * `@sentry/core` as resolved from `@sentry/nextjs` (its CommonJS build) without adding a dependency. The browser bundle
 * reaches `@sentry/core` through `@sentry/browser`; the first test below proves both resolve to the same installed
 * copy, so an upgrade that nests a different version fails here instead of testing the wrong code.
 */
const requireHere = createRequire(import.meta.url);
const requireFromNextjs = createRequire(requireHere.resolve("@sentry/nextjs"));
const requireFromBrowser = createRequire(requireFromNextjs.resolve("@sentry/browser"));
const { thirdPartyErrorFilterIntegration } = requireFromNextjs("@sentry/core") as {
  thirdPartyErrorFilterIntegration: typeof ThirdPartyErrorFilterIntegration;
};

/** The SDK attaches this metadata to frames from files the bundler plugin marked with our application key. */
const OUR_BUNDLE = { "_sentryBundlerPluginAppKey:jowray_com": true };

function frame(filename: string, moduleMetadata?: Record<string, unknown>): StackFrame {
  return { filename, lineno: 1, colno: 704, ...(moduleMetadata ? { module_metadata: moduleMetadata } : {}) };
}

/** A browser built-in as the browser stack parser emits it: a filename but no line or column. */
function builtIn(filename: string, fn: string): StackFrame {
  return { filename, function: fn, in_app: true };
}

function errorEvent(type: string, value: string, frames?: StackFrame[]): Event {
  return { exception: { values: [{ type, value, ...(frames ? { stacktrace: { frames } } : {}) }] } };
}

/** The integration's processEvent reads only the event; it never touches the client. */
const UNUSED_CLIENT = {} as Parameters<ProcessEvent>[2];

/** The SDK integration alone. */
async function sdkTag(event: Event, options: FilterOptions): Promise<unknown> {
  const integration = thirdPartyErrorFilterIntegration(options);
  if (!integration.processEvent) {
    throw new Error("thirdPartyErrorFilterIntegration has no processEvent hook");
  }
  const processed = await integration.processEvent(event, {}, UNUSED_CLIENT);
  if (processed === null) {
    throw new Error("the tag behaviours must never drop an event");
  }
  return processed.tags?.third_party_code;
}

/** What the browser sends: the integration with our options, then our `beforeSend` step. */
async function browserTag(event: Event): Promise<unknown> {
  await sdkTag(event, THIRD_PARTY_FILTER_OPTIONS);
  return untagErrorsWithoutLocatedFrames(event).tags?.third_party_code;
}

describe("third-party error filter options", () => {
  it("are tested against the @sentry/core copy the browser bundle uses", () => {
    expect(requireFromBrowser.resolve("@sentry/core")).toBe(requireFromNextjs.resolve("@sentry/core"));
  });

  it("tag, never drop, and only when no frame comes from our bundles", () => {
    expect(THIRD_PARTY_FILTER_OPTIONS).toEqual({
      filterKeys: ["jowray_com"],
      behaviour: "apply-tag-if-exclusively-contains-third-party-frames",
    });
  });

  it("filter on the application key next.config.ts marks our bundles with", () => {
    const nextConfig = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");
    expect(THIRD_PARTY_FILTER_OPTIONS.filterKeys).toHaveLength(1);
    expect(nextConfig).toContain(`applicationKey: "${THIRD_PARTY_FILTER_OPTIONS.filterKeys[0]}"`);
  });

  it("are what the browser init passes to the integration, with the untag step in beforeSend", () => {
    const source = readFileSync(new URL("../../instrumentation-client.ts", import.meta.url), "utf8");
    expect(source).toMatch(
      /import\s*\{\s*THIRD_PARTY_FILTER_OPTIONS,\s*untagErrorsWithoutLocatedFrames\s*\}\s*from\s*["']@\/lib\/sentry\/third-party-filter["']/,
    );
    expect(source).toContain("Sentry.thirdPartyErrorFilterIntegration(THIRD_PARTY_FILTER_OPTIONS)");
    expect(source.match(/thirdPartyErrorFilterIntegration\(/g)).toHaveLength(1);
    expect(source).toContain("beforeSend: (event) => scrubEvent(untagErrorsWithoutLocatedFrames(event)),");
  });
});

describe("third-party tagging in the browser (real SDK)", () => {
  it("tags code a browser injected into the page (JOWRAY_COM-D, Facebook in-app browser on iOS)", async () => {
    const injected = errorEvent("TypeError", "undefined is not an object (evaluating 'window.webkit.messageHandlers')", [
      frame("https://www.jowray.com/"),
      frame("https://www.jowray.com/"),
      frame("https://www.jowray.com/"),
    ]);
    expect(await browserTag(injected)).toBe(true);
  });

  it("never tags an error with one of our frames, even when an extension frame is on the stack", async () => {
    const ours = () =>
      errorEvent("TypeError", "Cannot read properties of undefined (reading 'id')", [
        frame("chrome-extension://abcdefghijklmnop/content.js"),
        frame("https://www.jowray.com/_next/static/immutable/chunks/0k8e2_u348khk.js", OUR_BUNDLE),
      ]);
    expect(await browserTag(ours())).toBeUndefined();
    // The contains-mode options used before 2026-11-08 tagged this same error, so an alert filter on the tag would
    // have silenced our own bug.
    expect(await sdkTag(ours(), { filterKeys: ["jowray_com"], behaviour: "apply-tag-if-contains-third-party-frames" })).toBe(true);
  });

  it("tags a chunk-load failure thrown inside the Turbopack runtime, which carries no key (alert block 2 covers it)", async () => {
    const chunkLoad = errorEvent("ChunkLoadError", "Failed to load chunk /_next/static/immutable/chunks/2c27m_8s-cs6l.js", [
      frame("https://www.jowray.com/_next/static/immutable/chunks/turbopack-0l1ukkt8h7dio.js"),
    ]);
    expect(await browserTag(chunkLoad)).toBe(true);
  });

  it("does not tag an error whose only frames are browser built-ins, although the SDK alone does (review finding 1)", async () => {
    // An unhandled `fetch(u).then((r) => r.text()).then(JSON.parse)` rejection: Chrome's stack is only
    // `at JSON.parse (<anonymous>)`, Safari's only `parse@[native code]`. Nothing says the code is not ours.
    const chrome = () => errorEvent("SyntaxError", "Unexpected token '<'", [builtIn("<anonymous>", "JSON.parse")]);
    const safari = () => errorEvent("SyntaxError", "JSON Parse error: Unrecognized token '<'", [builtIn("[native code]", "parse")]);
    expect(await sdkTag(chrome(), THIRD_PARTY_FILTER_OPTIONS)).toBe(true);
    expect(await sdkTag(safari(), THIRD_PARTY_FILTER_OPTIONS)).toBe(true);
    expect(await browserTag(chrome())).toBeUndefined();
    expect(await browserTag(safari())).toBeUndefined();
  });

  it("does not tag an error without a stack trace", async () => {
    expect(await browserTag(errorEvent("Error", "no stack"))).toBeUndefined();
  });
});

describe("untagErrorsWithoutLocatedFrames", () => {
  it("removes only the third-party tag and keeps the rest of the event", () => {
    const event: Event = {
      ...errorEvent("SyntaxError", "x", [builtIn("<anonymous>", "JSON.parse")]),
      tags: { third_party_code: true, surface: "share" },
    };
    expect(untagErrorsWithoutLocatedFrames(event)).toEqual({ ...event, tags: { surface: "share" } });
  });

  it("leaves untagged events and tagged events with a located frame as they are", () => {
    const untagged = errorEvent("Error", "x", [builtIn("<anonymous>", "JSON.parse")]);
    const located: Event = { ...errorEvent("Error", "x", [frame("https://www.jowray.com/")]), tags: { third_party_code: true } };
    expect(untagErrorsWithoutLocatedFrames(untagged)).toBe(untagged);
    expect(untagErrorsWithoutLocatedFrames(located)).toBe(located);
  });
});
