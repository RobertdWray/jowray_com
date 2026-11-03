import { describe, expect, it } from "vitest";

// `server/config/env.ts` starts with `import "server-only"`; importing it here
// proves the Vitest alias to the empty stub works.
import { getSiteEnv } from "@/server/config/env";

describe("test harness", () => {
  it("imports a server-only module through the stub alias", () => {
    expect(typeof getSiteEnv).toBe("function");
  });
});
