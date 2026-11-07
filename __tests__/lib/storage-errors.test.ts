import { describe, expect, it } from "vitest";

import { RangeNotHonouredError, ShortReadError } from "@/lib/storage-errors";

describe("storage range errors", () => {
  it.each([
    { ErrorClass: RangeNotHonouredError, name: "RangeNotHonouredError", message: "Storage did not honour the requested byte range." },
    { ErrorClass: ShortReadError, name: "ShortReadError", message: "Storage returned fewer bytes than its Content-Range promised." },
  ])("$name is distinguishable with a fixed, ids-free message", ({ ErrorClass, name, message }) => {
    const error = new ErrorClass();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.message).toBe(message);
  });
});
