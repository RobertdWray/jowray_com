import { describe, expect, it } from "vitest";

import { MAX_SCRUB_TEXT_LENGTH, OVERSIZED, scrubSecrets, scrubString } from "@/lib/sentry/scrub";

/**
 * Public-repo audit, issue #43 (T3): the member scanner in lib/sentry/scrub.ts
 * must stay linear in the input length. The previous implementation was a
 * backtracking regex (`[^"\\]*(?:token|ticket)[^"\\]*`) that took 9 ms for a
 * 10,001-character adversarial string and 1,908 ms for 160,001 characters
 * (x4 per doubling, measured 2026-11-05). `scrubSecrets` runs on the raw input
 * of every public Server Function before validation, so that was a one-request
 * CPU exhaustion. Budgets below are 10x or more above what the linear scanner
 * needs on a laptop and at least 10x below what the old code took.
 */

const TEST_TOKEN = "SENTRYTEST_" + "a".repeat(32);
const BUDGET_MS = 200;
// Below the oversized cap, so the scanner itself is exercised.
const ADVERSARIAL_LENGTH = 200_000;

function timed<T>(run: () => T): { ms: number; value: T } {
  const t0 = performance.now();
  const value = run();
  return { ms: performance.now() - t0, value };
}

function repeatTo(unit: string, length: number): string {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

describe("the member scanner is linear on adversarial text (issue #43, T3)", () => {
  const shapes: Array<[name: string, text: string]> = [
    // One opening quote and then the fragment forever: the old regex's worst case.
    ["an unterminated key made of the fragment", `"${repeatTo("token", ADVERSARIAL_LENGTH)}`],
    ["the same in escaped (double-encoded) context", `\\"${repeatTo("ticket", ADVERSARIAL_LENGTH)}`],
    // Many candidate keys, none secret, each followed by a colon.
    ["many ordinary members", repeatTo('"note":"keep",', ADVERSARIAL_LENGTH)],
    // Many keys that look secret but are not followed by a colon.
    ["secret-looking keys without a colon", repeatTo('"token" x ', ADVERSARIAL_LENGTH)],
    // A secret key whose value never ends (fail-closed path through valueEnd).
    ["a secret key with an unterminated object value", `{"claimToken":{"a":[${repeatTo("1,", ADVERSARIAL_LENGTH)}`],
    // Quotes everywhere, no keys.
    ["only quotes", repeatTo('"', ADVERSARIAL_LENGTH)],
    // Whitespace runs between quote and colon.
    ["long whitespace after each key", repeatTo(`"ticket"${" ".repeat(50)}`, ADVERSARIAL_LENGTH)],
  ];

  for (const [name, text] of shapes) {
    it(`scrubs ${name} (${text.length} chars) within ${BUDGET_MS} ms`, () => {
      const { ms } = timed(() => scrubSecrets({ note: text }));
      expect(ms).toBeLessThan(BUDGET_MS);
    });
  }

  it("grows roughly linearly: 2x the input costs well under 4x the time", () => {
    const small = `"${repeatTo("token", ADVERSARIAL_LENGTH / 2)}`;
    const large = `"${repeatTo("token", ADVERSARIAL_LENGTH)}`;
    // Warm up the JIT so the first measurement is not the slow one.
    scrubString(small);
    const a = timed(() => scrubString(small)).ms;
    const b = timed(() => scrubString(large)).ms;
    // A quadratic scanner gives ~4x; allow generous jitter on slow runners but reject quadratic growth.
    expect(b).toBeLessThan(Math.max(3 * a, 20));
  });
});

describe("oversized text is bounded before scanning", () => {
  it("replaces a string longer than the cap with the oversized marker, quickly, wherever it sits", () => {
    const huge = `"${repeatTo("token", MAX_SCRUB_TEXT_LENGTH * 4)}`;
    const { ms, value } = timed(() => scrubSecrets({ note: huge, nested: [{ deeper: huge }], ok: 1 }));
    expect(value).toEqual({ note: OVERSIZED, nested: [{ deeper: OVERSIZED }], ok: 1 });
    expect(ms).toBeLessThan(50);
    expect(scrubString(huge)).toBe(OVERSIZED);
  });

  it("never lets a secret through inside oversized text", () => {
    const huge = `{"claimToken":"${TEST_TOKEN}","pad":"${"x".repeat(MAX_SCRUB_TEXT_LENGTH)}"}`;
    expect(scrubSecrets(huge)).toBe(OVERSIZED);
    expect(JSON.stringify(scrubSecrets({ body: huge }))).not.toContain(TEST_TOKEN);
  });

  it("leaves the largest legitimate payload alone: a 10,000-character note and a 10 x 10,000 submission body", () => {
    const note = repeatTo("The token of her love was a note. ", 10_000);
    expect(scrubSecrets({ note })).toEqual({ note });
    const body = JSON.stringify({ memories: Array.from({ length: 10 }, () => ({ note, files: [] })) });
    expect(body.length).toBeLessThan(MAX_SCRUB_TEXT_LENGTH);
    expect(scrubSecrets(body)).toBe(body);
  });
});
