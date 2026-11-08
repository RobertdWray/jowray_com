import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * Two projects, one command (`npm run test:run`, also what CI runs).
 *
 * - `unit`: everything outside `__tests__/integration/`, with mocked databases, in parallel.
 * - `integration`: the real-Postgres suites (TEST_DATABASE_URL), one file at a time. They share one database, and
 *   `budget-concurrency.test.ts` truncates `Contributor` and `Memory` (ACCESS EXCLUSIVE, cascading) before each case;
 *   any other suite's open transaction that has inserted into one of those tables and then needs another deadlocks
 *   with it (Postgres 40P01, seen as Prisma P2034). Running these files one after another removes that interleaving
 *   at its source (TCR round 1 regression review). Each file still runs its own writers concurrently where a case
 *   needs a real race. `fileParallelism: false` gives the project one worker, and Vitest runs such a project's files
 *   in their own sequential group after the parallel one.
 */
export default defineConfig({
  test: {
    environment: "node",
    env: { LOG_LEVEL: "silent" },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["__tests__/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "__tests__/integration/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["__tests__/integration/**/*.test.ts"],
          fileParallelism: false,
        },
      },
    ],
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
