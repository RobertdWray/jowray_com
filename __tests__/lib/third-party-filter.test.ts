import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import type { Event, StackFrame, thirdPartyErrorFilterIntegration as ThirdPartyErrorFilterIntegration } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { THIRD_PARTY_FILTER_OPTIONS } from "@/lib/sentry/third-party-filter";

type FilterOptions = Parameters<typeof ThirdPartyErrorFilterIntegration>[0];
type ProcessEvent = NonNullable<ReturnType<typeof ThirdPartyErrorFilterIntegration>["processEvent"]>;

/**
 * The real integration, from the `@sentry/core` copy that `@sentry/nextjs` itself loads. The Node entry of
 * `@sentry/nextjs` does not export this browser integration, and resolving from `@sentry/nextjs`'s own location keeps
 * the test on exactly the code the app ships, without a new dependency.
 */
const requireHere = createRequire(import.meta.url);
const requireFromNextjs = createRequire(requireHere.resolve("@sentry/nextjs"));
const { thirdPartyErrorFilterIntegration } = requireFromNextjs("@sentry/core") as {
  thirdPartyErrorFilterIntegration: typeof ThirdPartyErrorFilterIntegration;
};

/** The SDK attaches this metadata to frames from files the bundler plugin marked with our application key. */
const OUR_BUNDLE = { "_sentryBundlerPluginAppKey:jowray_com": true };

function frame(filename: string, moduleMetadata?: Record<string, unknown>): StackFrame {
  return { filename, lineno: 1, colno: 704, ...(moduleMetadata ? { module_metadata: moduleMetadata } : {}) };
}

function errorEvent(type: string, value: string, frames?: StackFrame[]): Event {
  return { exception: { values: [{ type, value, ...(frames ? { stacktrace: { frames } } : {}) }] } };
}

/** The integration's processEvent reads only the event; it never touches the client. */
const UNUSED_CLIENT = {} as Parameters<ProcessEvent>[2];

async function thirdPartyTag(event: Event, options: FilterOptions = THIRD_PARTY_FILTER_OPTIONS): Promise<unknown> {
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

describe("third-party error filter options", () => {
  it("tags, never drops, and only when no frame comes from our bundles", () => {
    expect(THIRD_PARTY_FILTER_OPTIONS).toEqual({
      filterKeys: ["jowray_com"],
      behaviour: "apply-tag-if-exclusively-contains-third-party-frames",
    });
  });

  it("filters on the application key next.config.ts marks our bundles with", () => {
    const nextConfig = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");
    expect(THIRD_PARTY_FILTER_OPTIONS.filterKeys).toHaveLength(1);
    expect(nextConfig).toContain(`applicationKey: "${THIRD_PARTY_FILTER_OPTIONS.filterKeys[0]}"`);
  });

  it("is what the browser init passes to the integration", () => {
    const source = readFileSync(new URL("../../instrumentation-client.ts", import.meta.url), "utf8");
    expect(source).toMatch(/import\s*\{\s*THIRD_PARTY_FILTER_OPTIONS\s*\}\s*from\s*["']@\/lib\/sentry\/third-party-filter["']/);
    expect(source).toContain("Sentry.thirdPartyErrorFilterIntegration(THIRD_PARTY_FILTER_OPTIONS)");
    expect(source.match(/thirdPartyErrorFilterIntegration\(/g)).toHaveLength(1);
  });
});

describe("third-party error filter behaviour (real SDK)", () => {
  it("tags code a browser injected into the page (JOWRAY_COM-D, Facebook in-app browser on iOS)", async () => {
    const injected = errorEvent("TypeError", "undefined is not an object (evaluating 'window.webkit.messageHandlers')", [
      frame("https://www.jowray.com/"),
      frame("https://www.jowray.com/"),
      frame("https://www.jowray.com/"),
    ]);
    expect(await thirdPartyTag(injected)).toBe(true);
  });

  it("never tags an error with one of our frames, even when an extension frame is on the stack", async () => {
    const ours = () =>
      errorEvent("TypeError", "Cannot read properties of undefined (reading 'id')", [
        frame("chrome-extension://abcdefghijklmnop/content.js"),
        frame("https://www.jowray.com/_next/static/immutable/chunks/0k8e2_u348khk.js", OUR_BUNDLE),
      ]);
    expect(await thirdPartyTag(ours())).toBeUndefined();
    // The contains-mode options used before 2026-11-08 tagged this same error, so an alert filter on the tag would
    // have silenced our own bug.
    expect(await thirdPartyTag(ours(), { filterKeys: ["jowray_com"], behaviour: "apply-tag-if-contains-third-party-frames" })).toBe(true);
  });

  it("tags a chunk-load failure thrown inside the Turbopack runtime, which carries no key (alert block 2 covers it)", async () => {
    const chunkLoad = errorEvent("ChunkLoadError", "Failed to load chunk /_next/static/immutable/chunks/2c27m_8s-cs6l.js", [
      frame("https://www.jowray.com/_next/static/immutable/chunks/turbopack-0l1ukkt8h7dio.js"),
    ]);
    expect(await thirdPartyTag(chunkLoad)).toBe(true);
  });

  it("does not tag an error without a stack trace", async () => {
    expect(await thirdPartyTag(errorEvent("Error", "no stack"))).toBeUndefined();
  });
});
