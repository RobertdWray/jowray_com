import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/server/config/env";

const SECRET = "a".repeat(40);
const draftMock = vi.fn(async (_raw: unknown): Promise<unknown> => ({ ok: true, memoryId: "mem_1", claimToken: "t".repeat(43), claimLink: `https://www.jowray.com/m/${"t".repeat(43)}` }));
const reissueMock = vi.fn(async (_raw: unknown): Promise<unknown> => ({ ok: true, memoryId: "mem_1", claimLink: `https://www.jowray.com/m/${"u".repeat(43)}` }));
vi.mock("@/features/memories/draft-memory", () => ({ draftMemory: (raw: unknown) => draftMock(raw), reissueDraftClaimLink: (raw: unknown) => reissueMock(raw) }));

import { POST as reissue } from "@/app/api/admin/memories/[id]/claim-link/route";
import { POST as draft } from "@/app/api/admin/memories/route";

const body = { contributor: { email: "joyce@example.com" }, note: "words", source: "EMAIL", sourceRef: "gmail:1a1a2317fba34eec" };
const ID = "00000000-0000-4000-8000-000000000001";

function postDraft(json: unknown, auth?: string): Promise<Response> {
  return draft(new NextRequest("http://localhost:3000/api/admin/memories", { method: "POST", body: typeof json === "string" ? json : JSON.stringify(json), headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) } }));
}
function postReissue(id: string, auth?: string): Promise<Response> {
  return reissue(new NextRequest(`http://localhost:3000/api/admin/memories/${id}/claim-link`, { method: "POST", headers: auth ? { authorization: auth } : {} }), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  process.env.ADMIN_API_SECRET = SECRET;
  resetEnvCache();
  draftMock.mockClear();
  reissueMock.mockClear();
});

describe("POST /api/admin/memories", () => {
  it("401s with no bearer, the wrong bearer, and fails closed when the secret is unset; the feature is never called", async () => {
    expect((await postDraft(body)).status).toBe(401);
    expect((await postDraft(body, `Bearer ${"b".repeat(40)}`)).status).toBe(401);
    delete process.env.ADMIN_API_SECRET;
    resetEnvCache();
    expect((await postDraft(body, `Bearer ${SECRET}`)).status).toBe(401);
    expect(draftMock).not.toHaveBeenCalled();
  });

  it("drafts the memory and answers the house shape with the id and the claim link", async () => {
    const res = await postDraft(body, `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { memoryId: "mem_1", claimLink: `https://www.jowray.com/m/${"t".repeat(43)}` } });
    expect(draftMock).toHaveBeenCalledWith(body);
  });

  it("400s invalid input and a body that is not JSON", async () => {
    draftMock.mockResolvedValueOnce({ ok: false, code: "invalid", message: "Enter a valid email address" });
    const res = await postDraft({ ...body, contributor: {} }, `Bearer ${SECRET}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid", message: "Enter a valid email address" } });
    const bad = await postDraft("{not json", `Bearer ${SECRET}`);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("invalid");
  });

  it("409s a duplicate with the existing memory's id and status", async () => {
    draftMock.mockResolvedValueOnce({ ok: false, code: "duplicate", memoryId: "mem_old", status: "PENDING" });
    const res = await postDraft(body, `Bearer ${SECRET}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "duplicate", message: "A memory already exists for this source", memoryId: "mem_old", status: "PENDING" } });
  });

  it("429s when the daily budget is spent", async () => {
    draftMock.mockResolvedValueOnce({ ok: false, code: "budget_exceeded" });
    const res = await postDraft(body, `Bearer ${SECRET}`);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("budget_exceeded");
  });
});

describe("POST /api/admin/memories/[id]/claim-link", () => {
  it("401s without the right bearer and never calls the feature", async () => {
    expect((await postReissue(ID)).status).toBe(401);
    expect((await postReissue(ID, `Bearer ${"b".repeat(40)}`)).status).toBe(401);
    expect(reissueMock).not.toHaveBeenCalled();
  });

  it("reissues and answers the new link", async () => {
    const res = await postReissue(ID, `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { memoryId: "mem_1", claimLink: `https://www.jowray.com/m/${"u".repeat(43)}` } });
    expect(reissueMock).toHaveBeenCalledWith({ memoryId: ID });
  });

  it("404s not_found, 409s not_draft, 400s a malformed id", async () => {
    reissueMock.mockResolvedValueOnce({ ok: false, code: "not_found" });
    expect((await postReissue(ID, `Bearer ${SECRET}`)).status).toBe(404);
    reissueMock.mockResolvedValueOnce({ ok: false, code: "not_draft" });
    const conflict = await postReissue(ID, `Bearer ${SECRET}`);
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { error: { code: string } }).error.code).toBe("not_draft");
    reissueMock.mockResolvedValueOnce({ ok: false, code: "invalid" });
    expect((await postReissue("mem_1", `Bearer ${SECRET}`)).status).toBe(400);
  });
});
