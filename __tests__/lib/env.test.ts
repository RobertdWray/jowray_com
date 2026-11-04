import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { derivedPrefix, getSiteUrl, storagePrefix } from "@/lib/site-url";
import {
  csvList,
  getAdminAlertEnv,
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
  "ADMIN_ALERT_EMAILS",
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

describe("getAdminAlertEnv", () => {
  it("defaults to no recipients when ADMIN_ALERT_EMAILS is unset", () => {
    expect(getAdminAlertEnv().ADMIN_ALERT_EMAILS).toEqual([]);
  });

  it("splits, trims and lower-cases the list", () => {
    process.env.ADMIN_ALERT_EMAILS = " RobWray@gmail.com , rjwray@Hotmail.com ,";
    expect(getAdminAlertEnv().ADMIN_ALERT_EMAILS).toEqual(["robwray@gmail.com", "rjwray@hotmail.com"]);
  });

  it("rejects an entry that is not an email address, naming the sub-schema", () => {
    process.env.ADMIN_ALERT_EMAILS = "robwray@gmail.com, not-an-address";
    expect(() => getAdminAlertEnv()).toThrow(/Invalid environment \(adminAlert\)/);
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

  it("requires https for NEXT_PUBLIC_SITE_URL in production and rejects non-web schemes", () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "http://www.jowray.com";
    expect(() => getSiteUrl()).toThrow(/https/);
    resetEnvCache();
    process.env.NEXT_PUBLIC_SITE_URL = "ftp://www.jowray.com";
    expect(() => getSiteUrl()).toThrow();
    resetEnvCache();
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.jowray.com";
    expect(getSiteUrl()).toBe("https://www.jowray.com");
  });

  it("refuses to fall back to localhost in production, and to guess on a preview without a branch url", () => {
    process.env.VERCEL_ENV = "production";
    expect(() => getSiteUrl()).toThrow(/NEXT_PUBLIC_SITE_URL/);
    resetEnvCache();
    process.env.VERCEL_ENV = "preview";
    expect(() => getSiteUrl()).toThrow(/VERCEL_BRANCH_URL/);
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

describe("storagePrefix", () => {
  it("separates production, preview and local uploads", () => {
    process.env.VERCEL_ENV = "production";
    expect(storagePrefix()).toBe("originals/");
    resetEnvCache();
    process.env.VERCEL_ENV = "preview";
    expect(storagePrefix()).toBe("preview/originals/");
    resetEnvCache();
    delete process.env.VERCEL_ENV;
    expect(storagePrefix()).toBe("dev/originals/");
  });
});

describe("derivedPrefix", () => {
  it("mirrors storagePrefix under derived/ so purge stays environment-scoped", () => {
    process.env.VERCEL_ENV = "production"; resetEnvCache();
    expect(derivedPrefix()).toBe("derived/");
    process.env.VERCEL_ENV = "preview"; resetEnvCache();
    expect(derivedPrefix()).toBe("preview/derived/");
    delete process.env.VERCEL_ENV; resetEnvCache();
    expect(derivedPrefix()).toBe("dev/derived/");
  });
});
