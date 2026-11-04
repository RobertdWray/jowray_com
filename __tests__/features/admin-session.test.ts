import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADMIN_COOKIE, ADMIN_SESSION_MS, adminCookieOptions, isAdminCookie, isAdminKey, mintAdminCookie } from "@/features/admin/session";
import { resetEnvCache } from "@/server/config/env";

const SECRET = "s".repeat(40);
const NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
const KEYS = ["ADMIN_PAGE_SECRET", "NEXT_PUBLIC_SITE_URL", "VERCEL_ENV", "VERCEL_BRANCH_URL"] as const;
const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.ADMIN_PAGE_SECRET = SECRET;
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

describe("mintAdminCookie", () => {
  it("is `issuedAtMs.hmac` with HMAC-SHA256(secret, 'v1:' + issuedAtMs) in hex, never the secret itself", () => {
    const value = mintAdminCookie(NOW);
    const expected = createHmac("sha256", SECRET).update(`v1:${NOW}`).digest("hex");
    expect(value).toBe(`${NOW}.${expected}`);
    expect(value).not.toContain(SECRET);
    expect(mintAdminCookie(NOW)).toBe(value);
  });

  it("throws when the secret is unset (nothing to sign with)", () => {
    delete process.env.ADMIN_PAGE_SECRET;
    resetEnvCache();
    expect(() => mintAdminCookie(NOW)).toThrow(/ADMIN_PAGE_SECRET/);
  });
});

describe("isAdminCookie", () => {
  it("accepts a fresh cookie and refuses a wrong, empty, missing or malformed one", () => {
    const value = mintAdminCookie(NOW);
    expect(isAdminCookie(value, NOW + 1_000)).toBe(true);
    expect(isAdminCookie(undefined, NOW)).toBe(false);
    expect(isAdminCookie("", NOW)).toBe(false);
    expect(isAdminCookie("garbage", NOW)).toBe(false);
    expect(isAdminCookie(`${NOW}.`, NOW)).toBe(false);
    expect(isAdminCookie(`${NOW}.${"0".repeat(64)}`, NOW)).toBe(false);
    expect(isAdminCookie(`abc.${value.split(".")[1]}`, NOW)).toBe(false);
  });

  it("refuses a forged timestamp (the HMAC is over the timestamp) and an expired one", () => {
    const value = mintAdminCookie(NOW);
    const [, hmac] = value.split(".");
    expect(isAdminCookie(`${NOW + 1}.${hmac}`, NOW)).toBe(false);
    expect(isAdminCookie(value, NOW + ADMIN_SESSION_MS)).toBe(true);
    expect(isAdminCookie(value, NOW + ADMIN_SESSION_MS + 1)).toBe(false);
    // A cookie "from the future" is not a valid session either.
    expect(isAdminCookie(value, NOW - 1)).toBe(false);
  });

  it("refuses every cookie once the secret changes or is unset", () => {
    const value = mintAdminCookie(NOW);
    process.env.ADMIN_PAGE_SECRET = "t".repeat(40);
    resetEnvCache();
    expect(isAdminCookie(value, NOW)).toBe(false);
    delete process.env.ADMIN_PAGE_SECRET;
    resetEnvCache();
    expect(isAdminCookie(value, NOW)).toBe(false);
  });
});

describe("isAdminKey", () => {
  it("accepts the secret, refuses anything else, and fails closed when unset", () => {
    expect(isAdminKey(SECRET)).toBe(true);
    expect(isAdminKey(`${SECRET} `)).toBe(false);
    expect(isAdminKey(SECRET.slice(0, -1))).toBe(false);
    expect(isAdminKey("")).toBe(false);
    expect(isAdminKey(null)).toBe(false);
    delete process.env.ADMIN_PAGE_SECRET;
    resetEnvCache();
    expect(isAdminKey(SECRET)).toBe(false);
    expect(isAdminKey("")).toBe(false);
  });
});

describe("adminCookieOptions", () => {
  it("is httpOnly, lax, scoped to /admin, 30 days, and secure only on an https site", () => {
    expect(ADMIN_COOKIE).toBe("jowray_admin");
    expect(adminCookieOptions()).toEqual({ httpOnly: true, secure: false, sameSite: "lax", path: "/admin", maxAge: 30 * 24 * 60 * 60 });
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.jowray.com";
    resetEnvCache();
    expect(adminCookieOptions().secure).toBe(true);
    expect(ADMIN_SESSION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
