import { describe, expect, it } from "vitest";

import { MAX_SCRUB_TEXT_LENGTH, OVERSIZED, scrubSecrets, scrubString } from "@/lib/sentry/scrub";

/**
 * Public-repo audit, issue #43 (T3): the member scanner in lib/sentry/scrub.ts
 * must stay linear in the input length. The previous implementation was a
 * backtracking regex (`[^"\\]*(?:token|ticket)[^"\\]*`) that took 9 ms for a
 * 10,001-character adversarial string and 1,908 ms for 160,001 characters
 * (x4 per doubling, measured 2026-11-05); at the 200,000 characters used here
 * it took 3,162 ms (plain) and 5,257 ms (escaped). The linear scanner takes
 * 0–9 ms. The budget below is at least 15x under the old code and 20x over
 * the new, and each measurement is the fastest of three runs so a scheduler
 * pause on a CI runner cannot fail the required `ci` check (PR #47 review,
 * George #3 and Oscar #5). A 2x-input growth ratio is deliberately not
 * asserted: the worst shapes finish in well under a millisecond, where any
 * ratio is noise; the absolute budget is what separates linear from quadratic.
 */

const TEST_TOKEN = "SENTRYTEST_" + "a".repeat(32);
const FILTERED = "[Filtered]";
const BUDGET_MS = 200;
const RUNS = 3;
// Below the oversized cap, so the scanner itself is exercised.
const ADVERSARIAL_LENGTH = 200_000;

/** The fastest of `RUNS` executions and the (identical) value they produce. */
function fastest<T>(run: () => T): { ms: number; value: T } {
  let best: { ms: number; value: T } | undefined;
  for (let n = 0; n < RUNS; n += 1) {
    const t0 = performance.now();
    const value = run();
    const ms = performance.now() - t0;
    if (!best || ms < best.ms) {
      best = { ms, value };
    }
  }
  return best as { ms: number; value: T };
}

function repeatTo(unit: string, length: number): string {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

describe("the member scanner is linear on adversarial text (issue #43, T3)", () => {
  const unchanged = (name: string, text: string): { name: string; text: string; expected: string } => ({ name, text, expected: text });
  const unterminatedValue = `{"claimToken":{"a":[${repeatTo("1,", ADVERSARIAL_LENGTH)}`;
  const shapes = [
    // One opening quote and then the fragment forever: the old regex's worst case. No close, so nothing to scrub.
    unchanged("an unterminated key made of the fragment", `"${repeatTo("token", ADVERSARIAL_LENGTH)}`),
    unchanged("the same in escaped (double-encoded) context", `\\"${repeatTo("ticket", ADVERSARIAL_LENGTH)}`),
    // Many candidate keys, none secret, each followed by a colon: every member kept.
    unchanged("many ordinary members", repeatTo('"note":"keep",', ADVERSARIAL_LENGTH)),
    // Many keys that look secret but are not followed by a colon: not members, kept.
    unchanged("secret-looking keys without a colon", repeatTo('"token" x ', ADVERSARIAL_LENGTH)),
    // A secret key whose value never ends: replaced to the end of the text (fail closed).
    { name: "a secret key with an unterminated object value", text: unterminatedValue, expected: `{"claimToken":"${FILTERED}"` },
    // Quotes everywhere, no keys.
    unchanged("only quotes", repeatTo('"', ADVERSARIAL_LENGTH)),
    // Whitespace runs between quote and colon, and no colon.
    unchanged("long whitespace after each key", repeatTo(`"ticket"${" ".repeat(50)}`, ADVERSARIAL_LENGTH)),
  ];

  for (const { name, text, expected } of shapes) {
    it(`scrubs ${name} (${text.length} chars) within ${BUDGET_MS} ms and to the expected text`, () => {
      const { ms, value } = fastest(() => scrubSecrets({ note: text }));
      expect(value).toEqual({ note: expected });
      expect(ms).toBeLessThan(BUDGET_MS);
    });
  }

  it("still filters a real secret member that follows a long adversarial run", () => {
    const text = `${repeatTo('"token" x ', ADVERSARIAL_LENGTH)},"claimToken":"${TEST_TOKEN}","ok":1`;
    const { ms, value } = fastest(() => scrubString(text));
    expect(value).not.toContain(TEST_TOKEN);
    expect(value.endsWith(`,"claimToken":"${FILTERED}","ok":1`)).toBe(true);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe("oversized text is bounded before scanning", () => {
  it("replaces a string longer than the cap with the oversized marker, quickly, wherever it sits", () => {
    const huge = `"${repeatTo("token", MAX_SCRUB_TEXT_LENGTH * 4)}`;
    const { ms, value } = fastest(() => scrubSecrets({ note: huge, nested: [{ deeper: huge }], ok: 1 }));
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
