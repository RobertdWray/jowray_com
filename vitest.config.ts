import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    env: { LOG_LEVEL: "silent" },
    include: ["__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // `import "server-only"` throws outside React Server Components; tests
      // import server modules through this empty stub instead.
      "server-only": `${root}__tests__/stubs/server-only.ts`,
      "@": root,
    },
  },
});
