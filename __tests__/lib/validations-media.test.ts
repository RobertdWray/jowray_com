import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { claimMediaRefSchema, replaceRequestSchema } from "@/lib/validations/media";

const TOKEN = "t".repeat(43);

describe("claimMediaRefSchema", () => {
  it("accepts a claim token and a media uuid", () => {
    const mediaId = randomUUID();
    expect(claimMediaRefSchema.parse({ claimToken: TOKEN, mediaId })).toEqual({ claimToken: TOKEN, mediaId });
  });

  it("rejects a short token, a non-uuid media id and extra shapes", () => {
    expect(claimMediaRefSchema.safeParse({ claimToken: "short", mediaId: randomUUID() }).success).toBe(false);
    expect(claimMediaRefSchema.safeParse({ claimToken: TOKEN, mediaId: "med_1" }).success).toBe(false);
    expect(claimMediaRefSchema.safeParse({ claimToken: TOKEN }).success).toBe(false);
    expect(claimMediaRefSchema.safeParse(null).success).toBe(false);
  });
});

describe("replaceRequestSchema", () => {
  it("requires the file the browser picked", () => {
    const base = { claimToken: TOKEN, mediaId: randomUUID() };
    expect(replaceRequestSchema.safeParse(base).success).toBe(false);
    expect(replaceRequestSchema.parse({ ...base, file: { name: "b.jpg", type: "image/jpeg", size: 10 } }).file).toEqual({ name: "b.jpg", type: "image/jpeg", size: 10 });
  });
});
