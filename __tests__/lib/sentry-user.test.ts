import { beforeEach, describe, expect, it, vi } from "vitest";

const setUserMock = vi.fn();
const setTagMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({ setUser: (...a: unknown[]) => setUserMock(...a), setTag: (...a: unknown[]) => setTagMock(...a) }));

import { clearContributor, identifyContributor, tagIds } from "@/lib/sentry/user";

beforeEach(() => {
  setUserMock.mockClear();
  setTagMock.mockClear();
});

describe("identifyContributor (plan §8.1: email is the key)", () => {
  it("sets email, the name as username and the contributor id when known", () => {
    identifyContributor({ id: "con_1", email: "sentry-test@jowray.com", name: "Sentry Test" });
    expect(setUserMock).toHaveBeenCalledWith({ id: "con_1", email: "sentry-test@jowray.com", username: "Sentry Test" });
  });

  it("omits the id and username when they are missing", () => {
    identifyContributor({ email: "sentry-test@jowray.com", name: null });
    expect(setUserMock).toHaveBeenCalledWith({ email: "sentry-test@jowray.com" });
    identifyContributor({ id: null, email: "sentry-test@jowray.com" });
    expect(setUserMock).toHaveBeenLastCalledWith({ email: "sentry-test@jowray.com" });
  });

  it("sets nothing without an email (ruling 6: no identity without the key)", () => {
    identifyContributor({ id: "con_1", email: null, name: "Nameless" });
    identifyContributor({ email: "", name: "Blank" });
    identifyContributor({});
    expect(setUserMock).not.toHaveBeenCalled();
  });

  it("clearContributor unsets the user", () => {
    clearContributor();
    expect(setUserMock).toHaveBeenCalledWith(null);
  });
});

describe("tagIds (ids are tags, never user.id)", () => {
  it("sets memory_id, media_id and submission_id tags for the ids given", () => {
    tagIds({ memoryId: "mem_1", mediaId: "med_1", submissionId: "sub_1" });
    expect(setTagMock.mock.calls).toEqual([
      ["memory_id", "mem_1"],
      ["media_id", "med_1"],
      ["submission_id", "sub_1"],
    ]);
  });

  it("skips ids that are missing or null", () => {
    tagIds({ memoryId: "mem_1", mediaId: null });
    expect(setTagMock.mock.calls).toEqual([["memory_id", "mem_1"]]);
    expect(setUserMock).not.toHaveBeenCalled();
  });
});
