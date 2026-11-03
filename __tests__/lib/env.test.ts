import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSiteUrl } from "@/lib/site-url";
import {
  csvList,
  getDbEnv,
  getSiteEnv,
  resetEnvCache,
  strictBoolean,
} from "@/server/config/env";

const KEYS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "NEXT_PUBLIC_SITE_URL",
  "VERCEL_ENV",
  "VERCEL_BRANCH_URL",
] as const;
const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  resetEnvCache();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = saved[k];
    }
  }
  resetEnvCache();
});

describe("strictBoolean", () => {
  it("accepts only the literal strings true and false", () => {
    expect(strictBoolean.parse("true")).toBe(true);
    expect(strictBoolean.parse("false")).toBe(false);
    expect(() => strictBoolean.parse("yes")).toThrow();
    expect(() => strictBoolean.parse("1")).toThrow();
    expect(() => strictBoolean.parse("TRUE")).toThrow();
  });
});

describe("csvList", () => {
  it("splits, trims, lower-cases and drops empty entries", () => {
    expect(csvList.parse(" A@Example.com, b@example.ORG ,, ")).toEqual([
      "a@example.com",
      "b@example.org",
    ]);
    expect(csvList.parse("")).toEqual([]);
  });
});

describe("getDbEnv", () => {
  it("is lazy: a missing DATABASE_URL only fails when called", () => {
    expect(() => getDbEnv()).toThrow(/DATABASE_URL/);
    process.env.DATABASE_URL = "postgresql://u:p@host/db?sslmode=require";
    resetEnvCache();
    expect(getDbEnv().DATABASE_URL).toContain("postgresql://");
  });

  it("memoizes after the first successful parse", () => {
    process.env.DATABASE_URL = "postgresql://u:p@host/db";
    const first = getDbEnv();
    process.env.DATABASE_URL = "postgresql://changed@host/db";
    expect(getDbEnv()).toBe(first);
  });
});

describe("getSiteEnv / getSiteUrl", () => {
  it("prefers NEXT_PUBLIC_SITE_URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.jowray.com";
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_BRANCH_URL = "jowray-git-feat.vercel.app";
    expect(getSiteUrl()).toBe("https://www.jowray.com");
  });

  it("uses the branch URL on previews", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_BRANCH_URL = "jowray-git-feat.vercel.app";
    expect(getSiteUrl()).toBe("https://jowray-git-feat.vercel.app");
  });

  it("falls back to localhost", () => {
    expect(getSiteUrl()).toBe("http://localhost:3000");
    expect(getSiteEnv().VERCEL_ENV).toBeUndefined();
  });

  it("rejects a NEXT_PUBLIC_SITE_URL that is not an absolute URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "www.jowray.com";
    expect(() => getSiteUrl()).toThrow();
  });

  it("strips a trailing slash from NEXT_PUBLIC_SITE_URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.jowray.com/";
    expect(getSiteUrl()).toBe("https://www.jowray.com");
  });
});
