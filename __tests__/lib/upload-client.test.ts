import { describe, expect, it, vi } from "vitest";

const uploadMock = vi.fn(async (_pathname: string, _file: unknown, _options: Record<string, unknown>) => ({ url: "https://blob.test/x", pathname: "p" }));
vi.mock("@vercel/blob/client", () => ({ upload: (p: string, f: unknown, o: Record<string, unknown>) => uploadMock(p, f, o) }));

import { uploadWithTicket } from "@/lib/upload-client";

const ticket = { mediaId: "med_1", memoryId: "mem_1", pathname: "dev/originals/mem_1/a.jpg", mimeType: "image/jpeg", maxBytes: 10, expiresAt: 1, sig: "s" };

describe("uploadWithTicket", () => {
  it("uploads to the ticket's pathname as a private multipart blob with the ticketed content type and the ticket as payload", async () => {
    const file = new File(["x"], "a.jpg", { type: "" });
    await uploadWithTicket({ pathname: ticket.pathname, ticket }, file);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [pathname, passedFile, options] = uploadMock.mock.calls[0]!;
    expect(pathname).toBe("dev/originals/mem_1/a.jpg");
    expect(passedFile).toBe(file);
    expect(options).toMatchObject({ access: "private", handleUploadUrl: "/api/upload", multipart: true, contentType: "image/jpeg", clientPayload: JSON.stringify(ticket) });
  });

  it("reports whole-number progress percentages when asked", async () => {
    const seen: number[] = [];
    uploadMock.mockImplementationOnce(async (_p, _f, options) => {
      (options.onUploadProgress as (e: { percentage: number }) => void)({ percentage: 42.6 });
      return { url: "u", pathname: "p" };
    });
    await uploadWithTicket({ pathname: ticket.pathname, ticket }, new File(["x"], "a.jpg"), (pct) => seen.push(pct));
    expect(seen).toEqual([43]);
  });
});
