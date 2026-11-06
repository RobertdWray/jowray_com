import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { derivedPrefix, getSiteUrl, storagePrefix } from "@/lib/site-url";
import {
  csvList,
  getAdminAlertEnv,
  getAdminEnv,
  getAdminPageEnv,
  getDbEnv,
  getMcpEnv,
  getOutboundEnv,
  getPlacesEnv,
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
  "ADMIN_ALERT_HOURLY_CAP",
  "OUTBOUND_HOURLY_CAP",
  "OUTBOUND_DAILY_CAP",
  "ADMIN_API_SECRET",
  "ADMIN_PAGE_SECRET",
  "MCP_API_SECRET",
  "PLACES_PROVIDER",
  "PLACES_LOOKUP_URL",
  "PLACES_DAILY_PROVIDER_CALLS",
  "PLACES_VIEWER_DAILY_REQUESTS",
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

describe("getAdminEnv", () => {
  it("is optional: unset means the admin API is off", () => {
    expect(getAdminEnv().ADMIN_API_SECRET).toBeUndefined();
  });

  it("treats an empty value as unset (the `KEY=` convention), so the routes fail closed with 401 rather than 500", () => {
    process.env.ADMIN_API_SECRET = "";
    resetEnvCache();
    expect(getAdminEnv().ADMIN_API_SECRET).toBeUndefined();
  });

  it("requires at least 32 characters when set", () => {
    process.env.ADMIN_API_SECRET = "short";
    resetEnvCache();
    expect(() => getAdminEnv()).toThrow(/ADMIN_API_SECRET/);
    process.env.ADMIN_API_SECRET = "a".repeat(32);
    resetEnvCache();
    expect(getAdminEnv().ADMIN_API_SECRET).toBe("a".repeat(32));
  });
});

describe("getMcpEnv (plan 2026-11-06 §4.4)", () => {
  it("is optional: unset means /api/mcp answers 401 to everything", () => {
    expect(getMcpEnv().MCP_API_SECRET).toBeUndefined();
  });

  it("treats an empty value as unset (the `KEY=` convention), so the route fails closed with 401 rather than 500", () => {
    process.env.MCP_API_SECRET = "";
    resetEnvCache();
    expect(getMcpEnv().MCP_API_SECRET).toBeUndefined();
  });

  it("requires at least 32 characters when set", () => {
    process.env.MCP_API_SECRET = "short";
    resetEnvCache();
    expect(() => getMcpEnv()).toThrow(/MCP_API_SECRET/);
    process.env.MCP_API_SECRET = "m".repeat(32);
    resetEnvCache();
    expect(getMcpEnv().MCP_API_SECRET).toBe("m".repeat(32));
  });

  it("is separate from ADMIN_API_SECRET: neither one configures the other", () => {
    process.env.ADMIN_API_SECRET = "a".repeat(32);
    resetEnvCache();
    expect(getMcpEnv().MCP_API_SECRET).toBeUndefined();
    process.env.MCP_API_SECRET = "m".repeat(32);
    delete process.env.ADMIN_API_SECRET;
    resetEnvCache();
    expect(getAdminEnv().ADMIN_API_SECRET).toBeUndefined();
  });
});

describe("getAdminPageEnv", () => {
  it("is optional: unset means every admin page check fails closed", () => {
    expect(getAdminPageEnv().ADMIN_PAGE_SECRET).toBeUndefined();
  });

  it("treats an empty value as unset (the `KEY=` convention), so the page shows signed-out rather than 500", () => {
    process.env.ADMIN_PAGE_SECRET = "";
    resetEnvCache();
    expect(getAdminPageEnv().ADMIN_PAGE_SECRET).toBeUndefined();
  });

  it("requires at least 32 characters when set", () => {
    process.env.ADMIN_PAGE_SECRET = "short";
    resetEnvCache();
    expect(() => getAdminPageEnv()).toThrow(/ADMIN_PAGE_SECRET/);
    process.env.ADMIN_PAGE_SECRET = "p".repeat(32);
    resetEnvCache();
    expect(getAdminPageEnv().ADMIN_PAGE_SECRET).toBe("p".repeat(32));
  });
});

describe("outbound ceilings and the admin hourly cap (issue #46)", () => {
  it("default to 60 an hour and 300 a day for contributor email, and 20 admin alerts an hour, so a deploy needs no new env", () => {
    expect(getOutboundEnv()).toMatchObject({ OUTBOUND_HOURLY_CAP: 60, OUTBOUND_DAILY_CAP: 300 });
    expect(getAdminAlertEnv().ADMIN_ALERT_HOURLY_CAP).toBe(20);
  });

  it("read positive integers and treat an empty value as unset (the `KEY=` convention)", () => {
    process.env.OUTBOUND_HOURLY_CAP = "5";
    process.env.OUTBOUND_DAILY_CAP = "";
    process.env.ADMIN_ALERT_HOURLY_CAP = " 7 ";
    expect(getOutboundEnv()).toMatchObject({ OUTBOUND_HOURLY_CAP: 5, OUTBOUND_DAILY_CAP: 300 });
    expect(getAdminAlertEnv().ADMIN_ALERT_HOURLY_CAP).toBe(7);
  });

  it("fall back to the default for zero, negatives, fractions and words, never throwing: a typo in Vercel must not stop receipts", () => {
    for (const bad of ["0", "-1", "2.5", "many", "1e400"]) {
      process.env.OUTBOUND_HOURLY_CAP = bad;
      process.env.OUTBOUND_DAILY_CAP = "12";
      resetEnvCache();
      expect(getOutboundEnv()).toMatchObject({ OUTBOUND_HOURLY_CAP: 60, OUTBOUND_DAILY_CAP: 12 });
    }
    delete process.env.OUTBOUND_HOURLY_CAP;
    process.env.ADMIN_ALERT_HOURLY_CAP = "0";
    resetEnvCache();
    expect(getAdminAlertEnv().ADMIN_ALERT_HOURLY_CAP).toBe(20);
  });
});

describe("getPlacesEnv (plan 2026-11-06-photo-gps-places B4)", () => {
  it("defaults to off, the public Nominatim host, 500 provider calls and 60 viewer requests a day, so a deploy needs no new env", () => {
    expect(getPlacesEnv()).toEqual({
      PLACES_PROVIDER: "off",
      PLACES_LOOKUP_URL: "https://nominatim.openstreetmap.org",
      PLACES_DAILY_PROVIDER_CALLS: 500,
      PLACES_VIEWER_DAILY_REQUESTS: 60,
    });
  });

  it("reads each provider, a switchable lookup URL without its trailing slash, and the two ceilings; blank means unset", () => {
    for (const provider of ["nominatim", "stub", "off"] as const) {
      process.env.PLACES_PROVIDER = provider;
      resetEnvCache();
      expect(getPlacesEnv().PLACES_PROVIDER).toBe(provider);
    }
    process.env.PLACES_PROVIDER = "";
    process.env.PLACES_LOOKUP_URL = "https://geocoder.example.org/nominatim/";
    process.env.PLACES_DAILY_PROVIDER_CALLS = " 250 ";
    process.env.PLACES_VIEWER_DAILY_REQUESTS = "";
    resetEnvCache();
    expect(getPlacesEnv()).toEqual({
      PLACES_PROVIDER: "off",
      PLACES_LOOKUP_URL: "https://geocoder.example.org/nominatim",
      PLACES_DAILY_PROVIDER_CALLS: 250,
      PLACES_VIEWER_DAILY_REQUESTS: 60,
    });
    process.env.PLACES_LOOKUP_URL = "";
    resetEnvCache();
    expect(getPlacesEnv().PLACES_LOOKUP_URL).toBe("https://nominatim.openstreetmap.org");
  });

  it("refuses an unknown provider and a lookup URL that is not http(s), naming the key", () => {
    process.env.PLACES_PROVIDER = "google";
    resetEnvCache();
    expect(() => getPlacesEnv()).toThrow(/PLACES_PROVIDER/);
    delete process.env.PLACES_PROVIDER;
    for (const bad of ["nominatim.openstreetmap.org", "ftp://nominatim.openstreetmap.org"]) {
      process.env.PLACES_LOOKUP_URL = bad;
      resetEnvCache();
      expect(() => getPlacesEnv()).toThrow(/PLACES_LOOKUP_URL/);
    }
  });

  it("falls back to the default ceiling for zero, negatives, fractions and words, never throwing", () => {
    for (const bad of ["0", "-1", "2.5", "lots"]) {
      process.env.PLACES_DAILY_PROVIDER_CALLS = bad;
      process.env.PLACES_VIEWER_DAILY_REQUESTS = bad;
      resetEnvCache();
      expect(getPlacesEnv()).toMatchObject({ PLACES_DAILY_PROVIDER_CALLS: 500, PLACES_VIEWER_DAILY_REQUESTS: 60 });
    }
  });
});
