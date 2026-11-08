import { describe, expect, it } from "vitest";

import type { RememberedContributor } from "@/lib/remembered-contributor";
import { initialContributor, type SharePrefill } from "@/lib/share-prefill";

const prefill: SharePrefill = { firstName: "Bob", name: "Bob Sample", email: "bob@example.com" };
const remembered: RememberedContributor = { name: "Alice Example", email: "alice@example.com", relationship: "neighbour" };
const samePerson: RememberedContributor = { name: "Bobby Sample", email: "bob@example.com", relationship: "former student" };

describe("initialContributor", () => {
  it("starts empty when there is no invite, remembered contributor or draft", () => {
    expect(initialContributor({ draft: null, prefill: null, remembered: null })).toEqual({
      name: "", email: "", relationship: "", source: "none",
    });
  });

  it("uses a draft's name and relationship without inventing an email", () => {
    expect(initialContributor({
      draft: { name: "Alice Example", relationship: "neighbour" }, prefill: null, remembered: null,
    })).toEqual({ name: "Alice Example", email: "", relationship: "neighbour", source: "draft" });
  });

  it("keeps a relationship-only draft without claiming a named identity", () => {
    expect(initialContributor({
      draft: { name: "", relationship: "neighbour" }, prefill: null, remembered: null,
    })).toEqual({ name: "", email: "", relationship: "neighbour", source: "none" });
  });

  it("keeps the existing draft overrides when there is no invite", () => {
    expect(initialContributor({
      draft: { name: "Alice Example Updated", relationship: "family friend" }, prefill: null, remembered,
    })).toEqual({ name: "Alice Example Updated", email: "alice@example.com", relationship: "family friend", source: "remembered" });
  });

  it("uses the invite when nothing is remembered", () => {
    expect(initialContributor({ draft: null, prefill, remembered: null })).toEqual({
      name: "Bob Sample", email: "bob@example.com", relationship: "", source: "invite",
    });
  });

  it("does not pair invite B with remembered A or draft A on a shared device (Oscar case)", () => {
    expect(initialContributor({
      draft: { name: "Alice Example", relationship: "family friend" }, prefill, remembered,
    })).toEqual({ name: "Bob Sample", email: "bob@example.com", relationship: "", source: "invite" });
  });

  it("ignores a different person's draft even when nothing is remembered", () => {
    expect(initialContributor({
      draft: { name: "Alice Example", relationship: "family friend" }, prefill, remembered: null,
    })).toEqual({ name: "Bob Sample", email: "bob@example.com", relationship: "", source: "invite" });
  });

  it.each([null, remembered])("keeps a matching draft relationship with invite identity (remembered: %j)", (previous) => {
    expect(initialContributor({
      draft: { name: "  bOB sAMPLE  ", relationship: "family friend" }, prefill, remembered: previous,
    })).toEqual({ name: "Bob Sample", email: "bob@example.com", relationship: "family friend", source: "invite" });
  });

  it("does not trust a remembered name without a matching email", () => {
    expect(initialContributor({
      draft: null, prefill, remembered: { name: "Bob Sample", relationship: "neighbour" },
    })).toEqual({ name: "Bob Sample", email: "bob@example.com", relationship: "", source: "invite" });
  });

  it("uses the remembered name and relationship when the emails match", () => {
    expect(initialContributor({ draft: null, prefill, remembered: samePerson })).toEqual({
      name: "Bobby Sample", email: "bob@example.com", relationship: "former student", source: "remembered",
    });
  });

  it("compares emails without case or surrounding spaces and keeps the invite email value", () => {
    expect(initialContributor({
      draft: null,
      prefill: { ...prefill, email: " BOB@example.com " },
      remembered: { ...samePerson, email: "  bob@EXAMPLE.COM  " },
    })).toEqual({ name: "Bobby Sample", email: " BOB@example.com ", relationship: "former student", source: "remembered" });
  });

  it.each([undefined, "", " \t "])("falls back to the invite name when the matching remembered name is blank: %j", (name) => {
    expect(initialContributor({ draft: null, prefill, remembered: { ...samePerson, name } })).toEqual({
      name: "Bob Sample", email: "bob@example.com", relationship: "former student", source: "remembered",
    });
  });

  it("uses a draft relationship only when its name matches the remembered identity", () => {
    expect(initialContributor({
      draft: { name: "  bOBBY sAMPLE  ", relationship: "family friend" }, prefill, remembered: samePerson,
    })).toEqual({ name: "Bobby Sample", email: "bob@example.com", relationship: "family friend", source: "remembered" });
  });

  it.each(["Alice Example", "Bob Sample"])("keeps the remembered relationship when the draft name is %s", (name) => {
    expect(initialContributor({
      draft: { name, relationship: "family friend" }, prefill, remembered: samePerson,
    })).toEqual({ name: "Bobby Sample", email: "bob@example.com", relationship: "former student", source: "remembered" });
  });

  it("matches the draft against the invite name when the remembered name is blank", () => {
    expect(initialContributor({
      draft: { name: "  bOB sAMPLE  ", relationship: "family friend" },
      prefill, remembered: { ...samePerson, name: "" },
    })).toEqual({ name: "Bob Sample", email: "bob@example.com", relationship: "family friend", source: "remembered" });
  });

  it.each(["", " \t "])("keeps the remembered relationship when the matching draft relationship is blank: %j", (relationship) => {
    expect(initialContributor({
      draft: { name: "Bobby Sample", relationship }, prefill, remembered: samePerson,
    })).toEqual({ name: "Bobby Sample", email: "bob@example.com", relationship: "former student", source: "remembered" });
  });

  it("uses an empty relationship when matching identity has none to restore", () => {
    expect(initialContributor({ draft: null, prefill, remembered: { email: "bob@example.com" } })).toEqual({
      name: "Bob Sample", email: "bob@example.com", relationship: "", source: "remembered",
    });
  });

  it.each(["", " \t "])("never replaces an invite identity with a blank draft name: %j", (name) => {
    expect(initialContributor({
      draft: { name, relationship: "family friend" }, prefill, remembered,
    })).toEqual({ name: "Bob Sample", email: "bob@example.com", relationship: "", source: "invite" });
    expect(initialContributor({
      draft: { name, relationship: "family friend" }, prefill, remembered: samePerson,
    })).toEqual({ name: "Bobby Sample", email: "bob@example.com", relationship: "former student", source: "remembered" });
  });

  it("does not replace a remembered name with an empty draft name without an invite", () => {
    expect(initialContributor({ draft: { name: "", relationship: "" }, prefill: null, remembered })).toEqual({
      name: "Alice Example", email: "alice@example.com", relationship: "neighbour", source: "remembered",
    });
  });

  const drafts = [null, { name: "", relationship: "" }, { name: "Alice Example", relationship: "" },
    { name: "", relationship: "family friend" }, { name: "Alice Example Updated", relationship: "family friend" }];
  const previousContributors: (RememberedContributor | null)[] = [null, {}, remembered,
    { name: "Alice Example" }, { email: "alice@example.com" }, { relationship: "neighbour" },
    { name: "", email: "", relationship: "" }];

  it.each(drafts.flatMap((draft) => previousContributors.map((previous) => ({ draft, previous }))))(
    "preserves today's no-prefill field expressions for %j",
    ({ draft, previous }) => {
      expect(initialContributor({ draft, prefill: null, remembered: previous })).toEqual({
        name: draft?.name || previous?.name || "",
        email: previous?.email || "",
        relationship: draft?.relationship || previous?.relationship || "",
        source: previous ? "remembered" : draft?.name ? "draft" : "none",
      });
    },
  );
});
