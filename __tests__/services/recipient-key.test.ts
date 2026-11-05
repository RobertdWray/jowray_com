import { describe, expect, it } from "vitest";

import { recipientKey } from "@/services/email/recipient-key";

describe("recipientKey (issue #46 D3: the per-recipient cap counts one inbox once)", () => {
  it("lower-cases and trims", () => {
    expect(recipientKey("  Person@Example.COM ")).toBe("person@example.com");
  });

  it("drops a +tag sub-address on any domain", () => {
    expect(recipientKey("person+1@example.com")).toBe("person@example.com");
    expect(recipientKey("person+a+b@example.com")).toBe("person@example.com");
    expect(recipientKey("PERSON+Tag@Example.org")).toBe("person@example.org");
  });

  it("ignores dots in the local part only for Gmail, and folds googlemail.com into gmail.com (one inbox, one key)", () => {
    expect(recipientKey("first.last@gmail.com")).toBe("firstlast@gmail.com");
    expect(recipientKey("f.i.r.s.t+promo@googlemail.com")).toBe("first@gmail.com");
    expect(recipientKey("First@GoogleMail.com")).toBe("first@gmail.com");
    expect(recipientKey("first.last@example.com")).toBe("first.last@example.com");
  });

  it("splits at the last @ and leaves an address without one as typed (lower-cased)", () => {
    expect(recipientKey('"a@b"+tag@example.com')).toBe('"a@b"@example.com');
    expect(recipientKey("Not-An-Address")).toBe("not-an-address");
  });

  it("is idempotent", () => {
    const once = recipientKey("First.Last+x@Gmail.com");
    expect(recipientKey(once)).toBe(once);
  });
});
