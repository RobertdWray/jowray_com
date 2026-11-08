import { describe, expect, it } from "vitest";

import { scrubSecrets as scrubSecretsOnMain } from "../fixtures/scrub-regex-main-73609cf";
import { scrubSecrets } from "@/lib/sentry/scrub";

/**
 * Differential property test (PR #47 regression review): over a generated
 * corpus, the linear scanner never leaves a secret value in its output that
 * the regex scanner on main (73609cf, kept as a test fixture) had filtered.
 * The corpus mixes consistent, escaped and mixed quoting, attacker text beside
 * real secret members, React Flight prefixes and truncation. It is seeded and
 * bounded, so it is deterministic and fast in `ci`.
 */

// mulberry32: small, seedable, deterministic.
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20261105;
const CASES = 700;

const SECRET_KEYS = ["claimToken", "ticket", "sig", "accessToken", "key", "claimTokens", "clientPayload"];
const PLAIN_KEYS = ["note", "ok", "storageKey", "memoryId", "a", "monkey"];
const BENIGN_VALUES = ["keep", "mem_1", "1", "true", "she said hi", "originals/mem_1/a.jpg"];
// What a contributor could type into a note, placed where it can confuse a scanner.
const ATTACKER_VALUES = [
  'x\\"token\\":',
  'x\\"token\\":\\"',
  '\\"ticket\\":{',
  '"claimToken":',
  '\\"',
  '"',
  "\\\\",
  "\\\\\\\"",
  "{",
  "}",
  "[",
  "]",
  ",",
  " ",
  ":",
  "token",
  '" "token":"',
];
const FLIGHT_PREFIXES = ["", "", "1:", '0:["$@1",', "2:T1a,"];

type Quoting = "plain" | "escaped" | "mixedA" | "mixedB";
const CONSISTENT: Quoting[] = ["plain", "escaped"];
const ALL_QUOTING: Quoting[] = ["plain", "escaped", "mixedA", "mixedB"];

function quoted(key: string, value: string, quoting: Quoting): string {
  switch (quoting) {
    case "plain":
      return `"${key}":${value.startsWith("{") || value.startsWith("[") ? value : `"${value}"`}`;
    case "escaped":
      return `\\"${key}\\":${value.startsWith("{") || value.startsWith("[") ? value : `\\"${value}\\"`}`;
    case "mixedA": // escaped key, plain value
      return `\\"${key}":"${value}"`;
    case "mixedB": // plain key, escaped close and value
      return `"${key}\\":\\"${value}\\"`;
  }
}

interface Case {
  text: string;
  secrets: string[];
}

interface CorpusOptions {
  quoting: Quoting[];
  attackerText: boolean;
  truncate: boolean;
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

function makeCase(random: () => number, options: CorpusOptions, index: number): Case {
  const secrets: string[] = [];
  let counter = 0;
  const secret = (): string => {
    const value = `SENTRYTEST_${index.toString().padStart(4, "0")}_${(counter += 1)}`;
    secrets.push(value);
    return value;
  };
  const pieces: string[] = [];
  const count = 2 + Math.floor(random() * 6);
  for (let n = 0; n < count; n += 1) {
    const roll = random();
    const quoting = pick(random, options.quoting);
    if (roll < 0.4) {
      // A real secret member: string, nested object or array value.
      const shape = random();
      const value = shape < 0.6 ? secret() : shape < 0.8 ? `{"sig":"${secret()}","n":1}` : `["${secret()}","${secret()}"]`;
      pieces.push(quoted(pick(random, SECRET_KEYS), value, quoting));
    } else if (roll < 0.8) {
      const value = options.attackerText && random() < 0.6 ? pick(random, ATTACKER_VALUES) : pick(random, BENIGN_VALUES);
      pieces.push(quoted(pick(random, PLAIN_KEYS), value, quoting));
    } else if (options.attackerText) {
      pieces.push(pick(random, ATTACKER_VALUES)); // raw noise between members
    } else {
      pieces.push(quoted(pick(random, PLAIN_KEYS), pick(random, BENIGN_VALUES), quoting));
    }
  }
  const separator = pick(random, [",", ",", ", ", ""]);
  let text = `${pick(random, FLIGHT_PREFIXES)}{${pieces.join(separator)}}`;
  if (options.truncate && random() < 0.4) {
    text = text.slice(0, 1 + Math.floor(random() * (text.length - 1)));
  }
  return { text, secrets };
}

function corpus(options: CorpusOptions): Case[] {
  const random = prng(SEED);
  return Array.from({ length: CASES }, (_, index) => makeCase(random, options, index));
}

function survivors(output: string, secrets: readonly string[]): string[] {
  return secrets.filter((value) => output.includes(value));
}

describe("linear scanner versus the regex scanner on main (differential, seeded)", () => {
  it("never leaves a secret in its output that main had filtered: mixed quoting, attacker text, Flight prefixes, truncation", () => {
    const cases = corpus({ quoting: ALL_QUOTING, attackerText: true, truncate: true });
    const newOnlyLeaks: string[] = [];
    let informative = 0;
    for (const { text, secrets } of cases) {
      expect(text.length).toBeLessThan(2_000);
      const before = scrubSecretsOnMain(text) as string;
      const after = scrubSecrets(text) as string;
      const filteredByMain = secrets.filter((value) => !before.includes(value));
      informative += filteredByMain.length;
      const leaked = survivors(after, filteredByMain);
      if (leaked.length > 0) {
        newOnlyLeaks.push(`${JSON.stringify(text)} -> main ${JSON.stringify(before)} | new ${JSON.stringify(after)} leaks ${leaked.join(",")}`);
      }
    }
    expect(newOnlyLeaks).toEqual([]);
    // The corpus has to exercise the property, not pass vacuously.
    expect(informative).toBeGreaterThan(500);
  });

  it("matches main byte for byte on the full corpus (member boundaries are main's; only the algorithm changed)", () => {
    const differences: string[] = [];
    for (const { text } of [...corpus({ quoting: ALL_QUOTING, attackerText: true, truncate: true }), ...corpus({ quoting: CONSISTENT, attackerText: false, truncate: true })]) {
      const before = scrubSecretsOnMain(text) as string;
      const after = scrubSecrets(text) as string;
      if (before !== after) {
        differences.push(`${JSON.stringify(text)} -> main ${JSON.stringify(before)} | new ${JSON.stringify(after)}`);
      }
    }
    expect(differences).toEqual([]);
  });

  it("is idempotent on everything the full corpus produces", () => {
    for (const { text } of corpus({ quoting: ALL_QUOTING, attackerText: true, truncate: true })) {
      const once = scrubSecrets(text) as string;
      expect(scrubSecrets(once)).toBe(once);
    }
  });
});


describe("invite and tuple surfaces added after the legacy scanner (R10, D21)", () => {
  it("filters new bearer surfaces in objects, JSON, Flight and escaped Flight without losing identity", () => {
    const token = "SENTRYTEST_x";
    for (const key of ["inviteToken", "claimToken"]) {
      const input = { email: "alice@example.com", name: "Alice Example", url: `/s/${token}`, shareUrl: `/s/${token}`, state: [key, token, "d"] };
      const expected = { ...input, url: "/s/[inviteToken]", shareUrl: "[Filtered]", state: [key, "[Filtered]", "d"] };
      expect(scrubSecrets(input)).toEqual(expected);
      for (const encode of [JSON.stringify, (value: unknown) => `1:${JSON.stringify(value)}`, (value: unknown) => `1:${JSON.stringify(JSON.stringify(value))}`]) {
        const before = encode(input);
        const after = scrubSecrets(before);
        expect(before).toContain(token);
        expect(after).toBe(encode(expected));
        expect(scrubSecrets(after)).toBe(after);
      }
    }
  });
});
