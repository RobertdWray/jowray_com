import { describe, expect, it } from "vitest";

import { createInvitesInputSchema, inviteRowSchema, MAX_INVITES_PER_BATCH } from "@/lib/validations/invite";
import { NAME_REQUIRED_MESSAGE } from "@/lib/validations/memory";

const row = { firstName: "Alice", lastName: "Example", email: "alice@example.com" };

describe("invite validation", () => {
  it("trims names and normalizes emails in the parsed batch", () => {
    expect(createInvitesInputSchema.parse({
      invites: [{ firstName: " Alice ", lastName: " Example ", email: " ALICE@Example.com " }],
    })).toEqual({ invites: [row] });
  });

  it.each(["", "   ", "\t\n", null, undefined])("treats blank lastName %j as absent", (lastName) => {
    expect(inviteRowSchema.parse({ ...row, lastName }).lastName).toBeUndefined();
  });

  it("allows an omitted last name", () => {
    expect(inviteRowSchema.parse({ firstName: "Alice", email: row.email }).lastName).toBeUndefined();
  });

  it("accepts a trimmed joined name of exactly 120 characters", () => {
    const firstName = "A".repeat(60);
    const lastName = "B".repeat(59);
    expect(createInvitesInputSchema.parse({ invites: [{ ...row, firstName: ` ${firstName} `, lastName: ` ${lastName} ` }] }).invites)
      .toEqual([{ ...row, firstName, lastName }]);
  });

  it("rejects a 121-character joined name at the row's lastName without echoing names", () => {
    const firstName = "A".repeat(60);
    const lastName = "B".repeat(60);
    const result = createInvitesInputSchema.safeParse({ invites: [row, { email: "bob@example.com", firstName, lastName }] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(["invites", 1, "lastName"]);
      expect(result.error.issues[0].message).not.toContain(firstName);
      expect(result.error.issues[0].message).not.toContain(lastName);
    }
  });

  it("accepts a first name alone at 120 characters", () => {
    const firstName = "A".repeat(120);
    expect(createInvitesInputSchema.parse({ invites: [{ firstName, email: row.email }] }).invites)
      .toEqual([{ firstName, email: row.email }]);
  });

  it.each(["", "   ", null, undefined])("rejects missing firstName %j with the shared message", (firstName) => {
    const result = inviteRowSchema.safeParse({ ...row, firstName });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["firstName"], message: NAME_REQUIRED_MESSAGE }));
    }
  });

  it("rejects an invalid email", () => {
    expect(inviteRowSchema.safeParse({ ...row, email: "not-an-email" }).success).toBe(false);
  });

  it.each([42, false, {}])("rejects a non-string lastName %j", (lastName) => {
    expect(inviteRowSchema.safeParse({ ...row, lastName }).success).toBe(false);
  });

  it.each([0, 201])("rejects a batch of %i rows", (length) => {
    const invites = Array.from({ length }, (_, index) => ({ ...row, email: `person-${index}@example.com` }));
    expect(createInvitesInputSchema.safeParse({ invites }).success).toBe(false);
  });

  it("accepts the full 200-row batch limit", () => {
    const invites = Array.from({ length: 200 }, (_, index) => ({ ...row, email: `person-${index}@example.com` }));
    expect(createInvitesInputSchema.parse({ invites }).invites).toHaveLength(MAX_INVITES_PER_BATCH);
  });

  it("rejects duplicate normalized emails at the later index without echoing the email", () => {
    const result = createInvitesInputSchema.safeParse({
      invites: [{ ...row, email: "A@Example.com " }, { ...row, email: "a@example.com" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(["invites", 1, "email"]);
      expect(result.error.issues[0].message.toLowerCase()).not.toContain("a@example.com");
    }
  });

  it.each([undefined, false, true])("accepts optional boolean rotate %j", (rotate) => {
    expect(createInvitesInputSchema.parse({ invites: [row], rotate }).rotate).toBe(rotate);
  });

  it.each(["true", "false", 1, null])("rejects non-boolean rotate %j", (rotate) => {
    expect(createInvitesInputSchema.safeParse({ invites: [row], rotate }).success).toBe(false);
  });
});
