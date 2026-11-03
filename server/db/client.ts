import "server-only";

import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "@/generated/prisma/client";
import { getDbEnv } from "@/server/config/env";

// One client per process, created on first use. Nothing runs at module scope,
// so a build with no DATABASE_URL never opens a connection (Cache Components
// prerendering, CI, worker worktrees).
const globalForPrisma = globalThis as typeof globalThis & { __jowrayPrisma?: PrismaClient };

export function getDb(): PrismaClient {
  if (!globalForPrisma.__jowrayPrisma) {
    const adapter = new PrismaNeon({ connectionString: getDbEnv().DATABASE_URL });
    globalForPrisma.__jowrayPrisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.__jowrayPrisma;
}
