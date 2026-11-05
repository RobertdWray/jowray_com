import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getMediaServingEnv, resetEnvCache } from "@/server/config/env";

const KEYS = ["MEDIA_FILE_DAILY_MULTIPLE", "MEDIA_FILE_DAILY_MULTIPLE_UNAPPROVED", "MEDIA_DAILY_EGRESS_BYTES", "MEDIA_PROXY_DOWNLOAD_MAX_BYTES", "MEDIA_VIEWER_DAILY_REQUESTS"] as const;
const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  resetEnvCache();
});
afterEach(() => {
  for (const key of KEYS) { if (saved[key] === undefined) { delete process.env[key]; } else { process.env[key] = saved[key]; } }
  resetEnvCache();
});

const DEFAULTS = { MEDIA_FILE_DAILY_MULTIPLE: 100, MEDIA_FILE_DAILY_MULTIPLE_UNAPPROVED: 50, MEDIA_DAILY_EGRESS_BYTES: 50 * 1024 ** 3, MEDIA_PROXY_DOWNLOAD_MAX_BYTES: 25 * 1024 ** 2, MEDIA_VIEWER_DAILY_REQUESTS: 300 };

describe("getMediaServingEnv (issue #45: every allowance is optional and safe unset)", () => {
  it("uses the defaults when nothing is set", () => {
    expect(getMediaServingEnv()).toEqual(DEFAULTS);
  });

  it("treats a blank value like an unset one (a dashboard row left empty must not break media serving)", () => {
    for (const key of KEYS) { process.env[key] = ""; }
    resetEnvCache();
    expect(getMediaServingEnv()).toEqual(DEFAULTS);
  });

  it("parses configured values", () => {
    process.env.MEDIA_FILE_DAILY_MULTIPLE = "40";
    process.env.MEDIA_FILE_DAILY_MULTIPLE_UNAPPROVED = "15";
    process.env.MEDIA_DAILY_EGRESS_BYTES = "1073741824";
    process.env.MEDIA_PROXY_DOWNLOAD_MAX_BYTES = "0";
    process.env.MEDIA_VIEWER_DAILY_REQUESTS = "50";
    resetEnvCache();
    expect(getMediaServingEnv()).toEqual({ MEDIA_FILE_DAILY_MULTIPLE: 40, MEDIA_FILE_DAILY_MULTIPLE_UNAPPROVED: 15, MEDIA_DAILY_EGRESS_BYTES: 1073741824, MEDIA_PROXY_DOWNLOAD_MAX_BYTES: 0, MEDIA_VIEWER_DAILY_REQUESTS: 50 });
  });

  it("still refuses values that are genuinely invalid", () => {
    for (const bad of ["abc", "0", "-1", "1.5"]) {
      process.env.MEDIA_DAILY_EGRESS_BYTES = bad;
      resetEnvCache();
      expect(() => getMediaServingEnv(), bad).toThrow(/MEDIA_DAILY_EGRESS_BYTES/);
    }
  });
});
