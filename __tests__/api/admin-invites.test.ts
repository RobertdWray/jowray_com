import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InviteResult } from "@/features/invites/create-invites";
import { createInvitesInputSchema } from "@/lib/validations/invite";
import { resetEnvCache } from "@/server/config/env";

const { createMock, info, warn } = vi.hoisted(() => ({
  createMock: vi.fn<() => Promise<InviteResult[]>>(),
  info: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@/features/invites/create-invites", () => ({ createInvites: createMock }));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ info, warn }) }));

import { GET, maxDuration, POST } from "@/app/api/admin/invites/route";

const SECRET = "a".repeat(40);
const invite = { email: "alice@example.com", firstName: "Alice Example" };

function request(body: unknown, auth: string | undefined = `Bearer ${SECRET}`): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/invites", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("ADMIN_API_SECRET", SECRET);
  vi.stubEnv("MEMORIAL_SLUG", "example-memorial");
  vi.stubEnv("CONSENT_VERSION", "test-v1");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com");
  resetEnvCache();
  vi.clearAllMocks();
  createMock.mockResolvedValue([{ index: 0, status: "exists" }]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("POST /api/admin/invites", () => {
  it("authenticates before reading JSON, and never calls the feature for missing or wrong bearers", async () => {
    expect(maxDuration).toBe(30);
    for (const auth of ["", "Bearer wrong"]) {
      const req = request("{bad", auth);
      const json = vi.spyOn(req, "json");
      expect((await POST(req)).status).toBe(401);
      expect(json).not.toHaveBeenCalled();
    }
    vi.stubEnv("ADMIN_API_SECRET", "");
    resetEnvCache();
    expect((await POST(request({ invites: [invite] }))).status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(request("{bad"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "invalid", message: "The body must be JSON" } });
    expect(createMock).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", { invites: [] }],
    ["oversized", { invites: Array.from({ length: 201 }, (_, i) => ({ ...invite, email: `person${i}@example.com` })) }],
    ["duplicate", { invites: [invite, { ...invite, email: " ALICE@Example.com " }] }],
    ["blank name", { invites: [{ ...invite, firstName: "  " }] }],
    ["bad email", { invites: [{ ...invite, email: "not-an-email" }] }],
  ])("rejects %s input using the first schema message, without echoing input", async (_label, body) => {
    const parsed = createInvitesInputSchema.safeParse(body);
    expect(parsed.success).toBe(false);
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: { code: "invalid", message: parsed.error?.issues[0]?.message } });
    expect(text).not.toContain("@");
    expect(text).not.toContain("Alice");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("passes parsed names and normalized emails and preserves every result status without returning emails", async () => {
    const results: InviteResult[] = [
      { index: 0, status: "created", token: "A123456789_-", shareUrl: "https://example.com/s/A123456789_-" },
      { index: 1, status: "rotated", token: "B123456789_-", shareUrl: "https://example.com/s/B123456789_-" },
      { index: 2, status: "exists" },
      { index: 3, status: "revoked" },
    ];
    createMock.mockResolvedValueOnce(results);
    const body = {
      invites: [
        { email: " ALICE@Example.com ", firstName: " Alice Example ", lastName: " " },
        { email: "bob@example.com", firstName: "Bob", lastName: " Sample " },
        { email: "carol@example.com", firstName: "Carol Example" },
        { email: "dana@example.com", firstName: "Dana Example" },
      ],
      rotate: true,
    };
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ success: true, data: { results, memorialSlug: "example-memorial", siteUrl: "https://example.com" } });
    expect(text).not.toContain("@");
    expect(createMock).toHaveBeenCalledWith(createInvitesInputSchema.parse(body));
    expect(JSON.stringify(createMock.mock.calls)).not.toContain("ALICE");
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("lets unexpected feature failures propagate", async () => {
    const failure = new Error("database unavailable");
    createMock.mockRejectedValueOnce(failure);
    await expect(POST(request({ invites: [invite] }))).rejects.toBe(failure);
  });
});

describe("GET /api/admin/invites preflight", () => {
  it("checks the bearer before reading site or memorial configuration", async () => {
    vi.stubEnv("MEMORIAL_SLUG", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "not a URL");
    resetEnvCache();
    for (const auth of ["", "Bearer wrong"]) {
      const response = await GET(new NextRequest("http://localhost:3000/api/admin/invites", { headers: { authorization: auth } }));
      expect(response.status).toBe(401);
    }
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns only the server binding, without reading the body or creating invites", async () => {
    const req = new NextRequest("http://localhost:3000/api/admin/invites", { headers: { authorization: `Bearer ${SECRET}` } });
    const json = vi.spyOn(req, "json");
    const response = await GET(req);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ success: true, data: { memorialSlug: "example-memorial", siteUrl: "https://example.com" } });
    expect(text).not.toContain("@");
    expect(json).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });
});
