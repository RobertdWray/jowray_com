import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_COOKIE, mintAdminCookie } from "@/features/admin/session";
import { resetEnvCache } from "@/server/config/env";

const SECRET = "s".repeat(40);
const MEMORY_ID = "00000000-0000-4000-8000-000000000001";

/** `next/headers` cookies(): one jar the test fills, with set/delete recorded. */
const jar = new Map<string, string>();
const setMock = vi.fn((name: string, value: string, options: Record<string, unknown>) => { jar.set(name, value); return options; });
const deleteMock = vi.fn((input: { name: string; path?: string }) => { jar.delete(input.name); });
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined), set: setMock, delete: deleteMock }),
}));
class RedirectSignal extends Error { constructor(public readonly to: string) { super(`redirect:${to}`); } }
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new RedirectSignal(to); } }));

const features = {
  updateMemoryAsAdmin: vi.fn(async (_raw: unknown) => ({ ok: true, written: ["place"] })),
  setMemoryStatusAsAdmin: vi.fn(async (_raw: unknown) => ({ ok: true })),
  setMemoryDeletedAsAdmin: vi.fn(async (_raw: unknown) => ({ ok: true, purgedFiles: 0 })),
  createDraftAsAdmin: vi.fn(async (_raw: unknown) => ({ ok: true, memoryId: MEMORY_ID, claimLink: "https://www.jowray.com/m/x" })),
  reissueDraftClaimLink: vi.fn(async (_raw: unknown) => ({ ok: true, memoryId: MEMORY_ID, claimLink: "https://www.jowray.com/m/y" })),
};
vi.mock("@/features/admin/update-memory", () => ({ updateMemoryAsAdmin: (raw: unknown) => features.updateMemoryAsAdmin(raw) }));
vi.mock("@/features/admin/set-status", () => ({ setMemoryStatusAsAdmin: (raw: unknown) => features.setMemoryStatusAsAdmin(raw) }));
vi.mock("@/features/admin/set-deleted", () => ({ setMemoryDeletedAsAdmin: (raw: unknown) => features.setMemoryDeletedAsAdmin(raw) }));
vi.mock("@/features/admin/create-draft", () => ({ createDraftAsAdmin: (raw: unknown) => features.createDraftAsAdmin(raw) }));
vi.mock("@/features/memories/draft-memory", () => ({ reissueDraftClaimLink: (raw: unknown) => features.reissueDraftClaimLink(raw) }));

import { createDraft, enterAdmin, leaveAdmin, reissueLink, saveMemory, setDeleted, setStatus } from "@/app/admin/actions";

const saved = { ADMIN_PAGE_SECRET: process.env.ADMIN_PAGE_SECRET, NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL };
beforeEach(() => {
  process.env.ADMIN_PAGE_SECRET = SECRET;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  resetEnvCache();
  jar.clear();
  setMock.mockClear();
  deleteMock.mockClear();
  for (const fn of Object.values(features)) { fn.mockClear(); }
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) { delete process.env[k]; } else { process.env[k] = v; } }
  resetEnvCache();
});

const mutating: Array<[string, () => Promise<unknown>, keyof typeof features]> = [
  ["saveMemory", () => saveMemory({ memoryId: MEMORY_ID, memoryVersion: "x", contributorVersion: null, changes: { place: "x" } }), "updateMemoryAsAdmin"],
  ["setStatus", () => setStatus({ memoryId: MEMORY_ID, status: "APPROVED" }), "setMemoryStatusAsAdmin"],
  ["setDeleted", () => setDeleted({ memoryId: MEMORY_ID, deleted: true }), "setMemoryDeletedAsAdmin"],
  ["createDraft", () => createDraft({ email: "a@b.c", note: "x" }), "createDraftAsAdmin"],
  ["reissueLink", () => reissueLink({ memoryId: MEMORY_ID }), "reissueDraftClaimLink"],
];

describe("admin Server Functions (V14)", () => {
  it.each(mutating)("%s answers unauthorized without a cookie, with a bad one, or with the secret unset, and never calls the feature", async (_name, call, feature) => {
    expect(await call()).toEqual({ ok: false, code: "unauthorized" });
    jar.set(ADMIN_COOKIE, "garbage");
    expect(await call()).toEqual({ ok: false, code: "unauthorized" });
    jar.set(ADMIN_COOKIE, mintAdminCookie());
    delete process.env.ADMIN_PAGE_SECRET;
    resetEnvCache();
    expect(await call()).toEqual({ ok: false, code: "unauthorized" });
    expect(features[feature]).not.toHaveBeenCalled();
  });

  it.each(mutating)("%s calls its feature once with the raw input and returns its result unchanged when the cookie is valid", async (_name, call, feature) => {
    jar.set(ADMIN_COOKIE, mintAdminCookie());
    const result = await call();
    expect(features[feature]).toHaveBeenCalledTimes(1);
    expect(result).toEqual(await features[feature].mock.results[0]!.value);
  });
});

describe("enterAdmin", () => {
  it("sets the session cookie with the house options and redirects to /admin for the right key", async () => {
    await expect(enterAdmin({ key: SECRET })).rejects.toThrow("redirect:/admin");
    expect(setMock).toHaveBeenCalledTimes(1);
    const [name, value, options] = setMock.mock.calls[0]!;
    expect(name).toBe(ADMIN_COOKIE);
    expect(value).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(value).not.toContain(SECRET);
    expect(options).toEqual({ httpOnly: true, secure: false, sameSite: "lax", path: "/admin", maxAge: 30 * 24 * 60 * 60 });
  });

  it("answers unauthorized for a wrong key or an unset secret, and invalid for a bad body, setting nothing", async () => {
    expect(await enterAdmin({ key: "wrong" })).toEqual({ ok: false, code: "unauthorized" });
    expect(await enterAdmin({ key: `${SECRET} ` })).toEqual({ ok: false, code: "unauthorized" });
    expect(await enterAdmin({ key: "x".repeat(257) })).toEqual({ ok: false, code: "invalid" });
    expect(await enterAdmin("nope")).toEqual({ ok: false, code: "invalid" });
    delete process.env.ADMIN_PAGE_SECRET;
    resetEnvCache();
    expect(await enterAdmin({ key: SECRET })).toEqual({ ok: false, code: "unauthorized" });
    expect(setMock).not.toHaveBeenCalled();
  });
});

describe("leaveAdmin", () => {
  it("deletes the cookie on its path and redirects to /admin, whether or not a session exists", async () => {
    jar.set(ADMIN_COOKIE, mintAdminCookie());
    await expect(leaveAdmin()).rejects.toThrow("redirect:/admin");
    expect(deleteMock).toHaveBeenCalledWith({ name: ADMIN_COOKIE, path: "/admin" });
    expect(jar.has(ADMIN_COOKIE)).toBe(false);
    await expect(leaveAdmin()).rejects.toThrow("redirect:/admin");
  });
});
