import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";

// Same precedence as Next.js: .env.local overrides .env, so local work hits
// the Neon `dev` branch while Vercel builds get their own branch's values.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // process.env, not env(): env() throws when the variable is missing, which
    // would break `prisma generate` in CI and in worker worktrees. Only the
    // direct (unpooled) URL: migrations must never run through PgBouncer.
    url: process.env.DATABASE_URL_UNPOOLED ?? "",
  },
});
