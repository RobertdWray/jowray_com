import { beforeEach, describe, expect, it } from "vitest";

import { derivedKeyFor, isStagingKey, posterStagingKeyFor } from "@/lib/derived-keys";
import { resetEnvCache } from "@/server/config/env";

beforeEach(() => {
  delete process.env.VERCEL_ENV;
  resetEnvCache();
});

describe("derivedKeyFor", () => {
  it("places a fresh uuid under this environment's derived prefix and the original's memory folder", () => {
    const key = derivedKeyFor("dev/originals/mem_1/0f6a1c7e-3f1a-4b5e-9c2d-1234567890ab.heic", "jpg");
    expect(key).toMatch(/^dev\/derived\/mem_1\/[0-9a-f-]{36}\.jpg$/);
    expect(key).not.toBe(derivedKeyFor("dev/originals/mem_1/0f6a1c7e-3f1a-4b5e-9c2d-1234567890ab.heic", "jpg"));
  });

  it("uses the environment prefix, not the original's", () => {
    process.env.VERCEL_ENV = "preview"; resetEnvCache();
    expect(derivedKeyFor("originals/mem_9/0f6a1c7e-3f1a-4b5e-9c2d-1234567890ab.jpg", "png")).toMatch(/^preview\/derived\/mem_9\//);
  });
});

describe("posterStagingKeyFor / isStagingKey", () => {
  it("is deterministic from the original key and ends in .upload.jpg", () => {
    const key = posterStagingKeyFor("dev/originals/mem_1/0f6a1c7e-3f1a-4b5e-9c2d-1234567890ab.mov");
    expect(key).toBe("dev/derived/mem_1/0f6a1c7e-3f1a-4b5e-9c2d-1234567890ab.upload.jpg");
    expect(posterStagingKeyFor("dev/originals/mem_1/0f6a1c7e-3f1a-4b5e-9c2d-1234567890ab.mov")).toBe(key);
  });

  it("recognises only staging keys", () => {
    expect(isStagingKey("dev/derived/mem_1/x.upload.jpg")).toBe(true);
    expect(isStagingKey("dev/derived/mem_1/x.jpg")).toBe(false);
    expect(isStagingKey("dev/originals/mem_1/x.upload.jpg.heic")).toBe(false);
  });
});
