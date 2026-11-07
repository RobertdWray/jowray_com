// Like prisma/seed.ts, this standalone CLI builds a client only after its env guard.
import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "../../../generated/prisma/client";

import { assertReadbackHost, HarnessError, isMain, parseReadbackArgs, publicError, summarizeMemory } from "./lib";

async function main(): Promise<void> {
  const { memoryId, expectHost } = parseReadbackArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { throw new HarnessError("DATABASE_URL is required."); }
  assertReadbackHost(connectionString, expectHost);
  const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString }), log: [] });
  try {
    const memory = await db.memory.findUnique({
      where: { id: memoryId },
      select: {
        id: true, memorialId: true, contributorId: true, submissionId: true,
        status: true, analysisStatus: true, type: true, consentedAt: true,
        latitude: true, longitude: true,
        media: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true, status: true, mimeType: true, sizeBytes: true, addedVia: true,
            checksumSha256: true, declaredSha256: true, latitude: true, longitude: true,
          },
        },
        revisions: {
          where: { changedVia: "ADMIN" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, changedVia: true, before: true, after: true },
        },
        emails: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { emailType: true, status: true, errorMessage: true },
        },
      },
    });
    if (!memory) { throw new HarnessError("Memory not found on the guarded branch."); }
    console.log(JSON.stringify(summarizeMemory(memory), null, 2));
  } finally {
    await db.$disconnect();
  }
}

if (isMain(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`readback: ${publicError(error)}`);
    process.exitCode = 1;
  });
}
