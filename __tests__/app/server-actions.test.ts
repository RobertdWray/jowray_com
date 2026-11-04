import { describe, expect, it, vi } from "vitest";

/**
 * Every Server Function is wrapped with `instrumentedAction` (plan §8.5):
 * name, the raw input and a thunk that calls the feature. Features are mocked;
 * the wrapper is mocked to record its arguments and run the thunk.
 */
const wrapped: Array<{ name: string; input: unknown }> = [];
vi.mock("@/lib/sentry/server-action", () => ({
  instrumentedAction: async (name: string, input: unknown, run: () => Promise<unknown>) => {
    wrapped.push({ name, input });
    return run();
  },
}));

const feature = (name: string) => vi.fn(async (input: unknown) => ({ feature: name, input }));
const features = {
  createSubmission: feature("createSubmission"),
  issueUploadTicket: feature("issueUploadTicket"),
  completeSubmission: feature("completeSubmission"),
  finalizeUpload: feature("finalizeUpload"),
  updateMemoryFromClaim: feature("updateMemoryFromClaim"),
  createUploadTicket: feature("createUploadTicket"),
  createReplacementTicket: feature("createReplacementTicket"),
  removeMediaFromClaim: feature("removeMediaFromClaim"),
  cancelReservation: feature("cancelReservation"),
  updateMediaFromClaim: feature("updateMediaFromClaim"),
};
vi.mock("@/features/memories/create-submission", () => ({ createSubmission: (i: unknown) => features.createSubmission(i) }));
vi.mock("@/features/memories/issue-upload-ticket", () => ({ issueUploadTicket: (i: unknown) => features.issueUploadTicket(i) }));
vi.mock("@/features/memories/complete-submission", () => ({ completeSubmission: (i: unknown) => features.completeSubmission(i) }));
vi.mock("@/features/memories/ingest-upload", () => ({ finalizeUpload: (i: unknown) => features.finalizeUpload(i) }));
vi.mock("@/features/memories/claim", () => ({
  updateMemoryFromClaim: (i: unknown) => features.updateMemoryFromClaim(i),
  removeMediaFromClaim: (i: unknown) => features.removeMediaFromClaim(i),
  cancelReservation: (i: unknown) => features.cancelReservation(i),
  updateMediaFromClaim: (i: unknown) => features.updateMediaFromClaim(i),
}));
vi.mock("@/features/memories/create-memory", () => ({
  createUploadTicket: (i: unknown) => features.createUploadTicket(i),
  createReplacementTicket: (i: unknown) => features.createReplacementTicket(i),
}));

import * as claimActions from "@/app/m/[claimToken]/actions";
import * as shareActions from "@/app/share/actions";

const TICKET = { mediaId: "med_1", memoryId: "mem_1", pathname: "p", mimeType: "image/jpeg", maxBytes: 1, expiresAt: 1, sig: "s" };

describe("Server Functions are instrumented by name and pass the input through", () => {
  const cases: Array<[string, (input: never) => Promise<unknown>, unknown, keyof typeof features]> = [
    ["createSubmission", shareActions.createSubmission, { memories: [] }, "createSubmission"],
    ["issueUploadTicket", shareActions.issueUploadTicket, { claimToken: "t", mediaId: "m" }, "issueUploadTicket"],
    ["completeSubmission", shareActions.completeSubmission, { claimTokens: ["t"] }, "completeSubmission"],
    ["finalizeUpload", shareActions.finalizeUpload, { ticket: TICKET, claimToken: "t" }, "finalizeUpload"],
    ["updateMemory", claimActions.updateMemory, { claimToken: "t", changes: {} }, "updateMemoryFromClaim"],
    ["addFileTicket", claimActions.addFileTicket, { claimToken: "t" }, "createUploadTicket"],
    ["replaceFileTicket", claimActions.replaceFileTicket, { claimToken: "t" }, "createReplacementTicket"],
    ["finalizeAddedFile", claimActions.finalizeAddedFile, { ticket: TICKET, claimToken: "t" }, "finalizeUpload"],
    ["removeFile", claimActions.removeFile, { claimToken: "t", mediaId: "m" }, "removeMediaFromClaim"],
    ["cancelReservation", claimActions.cancelReservation, { claimToken: "t", mediaId: "m" }, "cancelReservation"],
    ["retryUploadTicket", claimActions.retryUploadTicket, { claimToken: "t", mediaId: "m" }, "issueUploadTicket"],
    ["updateMediaWords", claimActions.updateMediaWords, { claimToken: "t", mediaId: "m", changes: {} }, "updateMediaFromClaim"],
  ];

  it.each(cases)("%s", async (name, action, input, featureName) => {
    wrapped.length = 0;
    const result = await action(input as never);
    expect(wrapped).toEqual([{ name, input }]);
    expect(features[featureName]).toHaveBeenLastCalledWith(input);
    expect(result).toEqual({ feature: featureName, input });
  });
});
