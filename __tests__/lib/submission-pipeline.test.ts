import { describe, expect, it, vi } from "vitest";

import type { CardMediaItem, MemoryCard } from "@/lib/memory-cards";
import { type PipelineDeps, progressText, runSubmission } from "@/lib/submission-pipeline";

function file(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}
function media(id: string, kind: CardMediaItem["kind"], size: number): CardMediaItem {
  const mime = kind === "PHOTO" ? "image/jpeg" : kind === "VIDEO" ? "video/mp4" : "audio/webm";
  return { id, kind, name: `${id}.bin`, size, mimeType: mime, source: "file", durationSeconds: null, file: file(`${id}.bin`, mime, size), verdict: null };
}
function card(id: string, items: CardMediaItem[], note = "words"): MemoryCard {
  return { id, open: true, approxDateText: "", place: "", note, media: items };
}
const contributor = { name: "Kay", relationship: "", email: "kay@example.com", visibility: "PUBLIC" as const, contactOptIn: true, mailingListOptIn: false, notifyWhenPosted: true };
const T = (n: number) => String.fromCharCode(97 + n).repeat(43);

/** Fake Server Functions and uploader that log every call; `uploadFails` holds the ids whose first upload throws. */
function fakeDeps(options: { uploadFails?: string[]; finalizeAfterFail?: "READY" | "PENDING"; createFails?: boolean; finalizeStatus?: Record<string, "READY" | "FAILED"> } = {}) {
  const calls: string[] = [];
  const failed = new Set(options.uploadFails ?? []);
  let ticketSerial = 0;
  const deps: PipelineDeps = {
    createSubmission: vi.fn(async (input: unknown) => {
      calls.push("create");
      if (options.createFails) {
        return { ok: false as const, code: "budget_exceeded" as const, message: "Busy", memoryIndex: null, fileIndex: null };
      }
      const cards = (input as { memories: Array<{ files: unknown[] }> }).memories;
      return {
        ok: true as const,
        submissionId: "sub_1",
        memories: cards.map((m, i) => ({ index: i, memoryId: `mem_${i}`, claimToken: T(i), files: m.files.map((_, f) => ({ fileIndex: f, mediaId: `med_${i}_${f}` })) })),
        emailed: false,
      };
    }),
    issueUploadTicket: vi.fn(async ({ mediaId }: { claimToken: string; mediaId: string }) => {
      ticketSerial += 1;
      calls.push(`ticket:${mediaId}#${ticketSerial}`);
      return { ok: true as const, upload: { pathname: `p/${mediaId}`, ticket: { mediaId, memoryId: "m", pathname: `p/${mediaId}`, mimeType: "x", maxBytes: 1, expiresAt: 1, sig: `s${ticketSerial}` } } };
    }),
    upload: vi.fn(async (grant: { ticket: { mediaId: string } }, _file: File, onProgress: (pct: number) => void) => {
      calls.push(`upload:${grant.ticket.mediaId}`);
      onProgress(50);
      if (failed.has(grant.ticket.mediaId)) {
        failed.delete(grant.ticket.mediaId);
        throw new Error("network");
      }
      onProgress(100);
    }),
    finalizeUpload: vi.fn(async ({ ticket }: { ticket: { mediaId: string; sig: string }; claimToken: string }) => {
      calls.push(`finalize:${ticket.mediaId}`);
      const forced = options.finalizeStatus?.[ticket.mediaId];
      if (forced) {
        return { status: forced, claimLink: "l", emailed: false };
      }
      // After a failed upload the file is not there (PENDING) unless the test says it landed anyway.
      const justFailed = calls.at(-2) === `upload:${ticket.mediaId}` && (options.uploadFails ?? []).includes(ticket.mediaId) && !calls.slice(0, -2).includes(`finalize:${ticket.mediaId}`);
      return { status: justFailed ? (options.finalizeAfterFail ?? "PENDING") : "READY", claimLink: "l", emailed: false };
    }),
    completeSubmission: vi.fn(async ({ claimTokens }: { claimTokens: string[] }) => {
      calls.push(`complete:${claimTokens.length}`);
      return { ok: true as const, emailed: true };
    }),
  };
  return { deps, calls };
}

describe("runSubmission", () => {
  it("creates once, then sends one file at a time, photos first, each ticket issued right before its upload, then completes exactly once", async () => {
    const { deps, calls } = fakeDeps();
    const cards = [card("c1", [media("v1", "VIDEO", 100), media("p1", "PHOTO", 10)]), card("c2", [media("a1", "VOICE", 20), media("p2", "PHOTO", 10)])];
    const progress: string[] = [];
    const result = await runSubmission({ ...contributor, cards }, deps, { origin: "https://www.jowray.com", onProgress: (p) => progress.push(p.text) });
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(calls).toEqual([
      "create",
      "ticket:med_0_1#1", "upload:med_0_1", "finalize:med_0_1",
      "ticket:med_1_1#2", "upload:med_1_1", "finalize:med_1_1",
      "ticket:med_0_0#3", "upload:med_0_0", "finalize:med_0_0",
      "ticket:med_1_0#4", "upload:med_1_0", "finalize:med_1_0",
      "complete:2",
    ]);
    expect(result.memories.map((m) => [m.position, m.claimLink, m.failedFiles])).toEqual([[1, `https://www.jowray.com/m/${T(0)}`, []], [2, `https://www.jowray.com/m/${T(1)}`, []]]);
    expect(result.emailed).toBe(true);
    expect(deps.completeSubmission).toHaveBeenCalledTimes(1);
    expect(deps.completeSubmission).toHaveBeenCalledWith({ claimTokens: [T(0), T(1)] });
    // Byte-weighted: the two 10-byte photos first, then 20, then 100 (140 in all).
    expect(progress[0]).toBe("Sending file 1 of 4 · 0% done");
    expect(progress[1]).toBe("Sending file 1 of 4 · 4% done");
    expect(progress.at(-1)).toBe("Sending file 4 of 4 · 100% done");
  });

  it("on an upload error it finalizes first (the file may have landed), then retries once with a fresh ticket", async () => {
    const { deps, calls } = fakeDeps({ uploadFails: ["med_0_0"] });
    const result = await runSubmission({ ...contributor, cards: [card("c1", [media("p1", "PHOTO", 10)])] }, deps, { origin: "https://x" });
    expect(calls).toEqual(["create", "ticket:med_0_0#1", "upload:med_0_0", "finalize:med_0_0", "ticket:med_0_0#2", "upload:med_0_0", "finalize:med_0_0", "complete:1"]);
    expect(result.ok && result.memories[0]!.failedFiles).toEqual([]);
    const landed = fakeDeps({ uploadFails: ["med_0_0"], finalizeAfterFail: "READY" });
    await runSubmission({ ...contributor, cards: [card("c1", [media("p1", "PHOTO", 10)])] }, landed.deps, { origin: "https://x" });
    expect(landed.calls.filter((c) => c.startsWith("ticket")).length).toBe(1);
  });

  it("a file that fails twice is named, and the rest of the send still goes through and completes", async () => {
    const { deps, calls } = fakeDeps({ uploadFails: ["med_0_0", "med_0_0"], finalizeStatus: { med_0_0: "FAILED" } });
    deps.upload = vi.fn(async (grant: { ticket: { mediaId: string } }) => { calls.push(`upload:${grant.ticket.mediaId}`); if (grant.ticket.mediaId === "med_0_0") { throw new Error("network"); } });
    const result = await runSubmission({ ...contributor, cards: [card("c1", [media("p1", "PHOTO", 10), media("p2", "PHOTO", 10)]), card("c2", [], "second")] }, deps, { origin: "https://x" });
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.memories[0]!.failedFiles).toEqual(["p1.bin"]);
    expect(result.memories[1]!.failedFiles).toEqual([]);
    expect(calls.filter((c) => c === "upload:med_0_1")).toHaveLength(1);
    expect(calls.at(-1)).toBe("complete:2");
  });

  it("a retry that finds the row already READY (the first upload landed late) counts as a success", async () => {
    const { deps, calls } = fakeDeps({ uploadFails: ["med_0_0"] });
    const issue = deps.issueUploadTicket;
    deps.issueUploadTicket = vi.fn(async (input: { claimToken: string; mediaId: string }) => (calls.some((c) => c.startsWith("ticket:med_0_0")) ? { ok: false as const, code: "not_pending" } : issue(input)));
    const result = await runSubmission({ ...contributor, cards: [card("c1", [media("p1", "PHOTO", 10)])] }, deps, { origin: "https://x" });
    expect(result.ok && result.memories[0]!.failedFiles).toEqual([]);
    expect(calls.at(-1)).toBe("complete:1");
  });

  it("completes exactly once even when a step throws unexpectedly", async () => {
    const { deps, calls } = fakeDeps();
    deps.issueUploadTicket = vi.fn(async () => { throw new Error("boom"); });
    const result = await runSubmission({ ...contributor, cards: [card("c1", [media("p1", "PHOTO", 10)])] }, deps, { origin: "https://x" });
    expect(result.ok).toBe(true);
    expect(result.ok && result.memories[0]!.failedFiles).toEqual(["p1.bin"]);
    expect(calls.filter((c) => c.startsWith("complete"))).toEqual(["complete:1"]);
  });

  it("when create fails nothing is uploaded, nothing is completed, and the card is named", async () => {
    const { deps, calls } = fakeDeps({ createFails: true });
    const result = await runSubmission({ ...contributor, cards: [card("c1", [media("p1", "PHOTO", 10)])] }, deps, { origin: "https://x" });
    expect(result).toEqual({ ok: false, code: "budget_exceeded", message: "Busy", memoryIndex: null, fileIndex: null });
    expect(calls).toEqual(["create"]);
    const { deps: offline } = fakeDeps();
    offline.createSubmission = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await runSubmission({ ...contributor, cards: [card("c1", [])] }, offline, { origin: "https://x" })).toEqual({ ok: false, code: "unreachable", message: "We couldn't get through just now. Nothing was lost; your words are still here. Check your connection and press Send again.", memoryIndex: null, fileIndex: null });
  });

  it("a send with no files completes on the server: no completion call from the browser", async () => {
    const { deps, calls } = fakeDeps();
    deps.createSubmission = vi.fn(async () => ({ ok: true as const, submissionId: "s", memories: [{ index: 0, memoryId: "m", claimToken: T(0), files: [] }], emailed: true }));
    const result = await runSubmission({ ...contributor, cards: [card("c1", [])] }, deps, { origin: "https://x" });
    expect(calls).toEqual([]);
    expect(deps.createSubmission).toHaveBeenCalledTimes(1);
    expect(deps.completeSubmission).not.toHaveBeenCalled();
    expect(result.ok && result.emailed).toBe(true);
  });

  it("sends the cards' details and files as the server schema expects, with durations for recordings only", async () => {
    const { deps } = fakeDeps();
    const clip = { ...media("a1", "VOICE", 5), source: "recording" as const, durationSeconds: 24 };
    await runSubmission({ ...contributor, cards: [{ id: "c1", open: true, approxDateText: "1985", place: "", note: "  ", media: [clip, media("p1", "PHOTO", 10)] }] }, deps, { origin: "https://x" });
    expect(deps.createSubmission).toHaveBeenCalledWith({
      name: "Kay", relationship: "", email: "kay@example.com", visibility: "PUBLIC", contactOptIn: true, mailingListOptIn: false, notifyWhenPosted: true,
      memories: [{ approxDateText: "1985", place: "", note: "  ", files: [{ name: "a1.bin", type: "audio/webm", size: 5, durationSeconds: 24 }, { name: "p1.bin", type: "image/jpeg", size: 10 }] }],
    });
  });

  it("progress text", () => {
    expect(progressText(2, 5, 40)).toBe("Sending file 2 of 5 · 40% done");
    expect(progressText(1, 1, 0)).toBe("Sending file 1 of 1 · 0% done");
  });
});
